// Generates worker/lib/limits.js: the empirical ceilings of the anti-cheat plausibility model, PER MAP.
//   node tools/gen-limits.mjs [--runs 8] [--maps centrs,agenskalns,mezaparks,purvciems] [--merge-max] [--no-build] [--port 5191]      (GPU=1 for the metal backend)
//   --modes quick: only play those modes (use with --merge-max)
//   --difficulties easy,normal,hard (default all): bot difficulty levels played in classic / quick WITH bots (the daily challenge is always normal; the
//     no-bots upper bound is difficulty-independent). Weaker bots leave more food and fewer rivals to the player, so ALL levels must be covered.
//   Typical release run (never tightens): GPU=1 node tools/gen-limits.mjs --runs 8 --merge-max
//   --merge-max: keep the maxima already in limits.js (add rounds to a map without ever tightening its ceilings)
// Format 2 (scoring rules 2: combos + power-ups): `s` samples are POINTS (multiplied), the radius band of an interval comes from the growth MASS `m`
// (the radius never follows the points), and every mode also records the best combo and the most pickups an autoplayer reached (informational; the
// validator bounds pickups by the spawn schedule, worker/lib/validate.js). The autoplayers chase power-ups and keep combos like a strong player.
// Method: play many full rounds with two autoplayers (the game's greedy bot and a stronger cluster-aware greedy), with
// and without opponents (without bots there is nothing to compete for the food, so it is the upper bound), in every mode
// (daily twists too, centre only: the daily challenge is only played on the centre map); take the maximum score gain per 10 s
// for each radius band, the maximum eaten count per 10 s, the maximum final score per mode, the biggest duel gain, and the value
// range of every object kind on the map. Maps NOT listed in --maps keep their existing entry in worker/lib/limits.js.
// worker/lib/validate.js multiplies these maxima by SOFT x2 (hidden) / HARD x3 (rejected). Re-run for a map after changing its
// balance (growth, values, tools/maps.mjs multipliers, buildings) and commit the result. Raw runs: tools/out/sim-runs-train[-<slug>].json.
import { writeFileSync } from 'node:fs';
import { LIMITS as OLD } from '../worker/lib/limits.js';
import { writeLimits } from './write-limits.mjs';
import { MAP_SLUGS } from '../tools/maps.mjs';
import path from 'node:path';
import { openSim, simRound, root } from './sim-lib.mjs';
import { MODES, radiusAt, TRACE_STEP } from '../src/rules.js';
import { TWISTS, dailyInfo } from '../src/daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('--runs', 8);
const BANDS = [2.2, 3.5, 5.5, 8, 12, 18, 28, 42, 62, 90, 130]; // = CFG.levels
const bandOf = (r) => { let i = 0; while (i < BANDS.length - 1 && r >= BANDS[i + 1]) i++; return i; };

// a calendar day for each daily twist
const dayFor = {};
for (let d = new Date('2026-11-01T00:00:00Z'), n = 0; n < 200 && Object.keys(dayFor).length < TWISTS.length; d.setUTCDate(d.getUTCDate() + 1), n++) {
  const day = d.toISOString().slice(0, 10), id = dailyInfo(day).twist.id;
  if (!dayFor[id]) dayFor[id] = day;
}

const BANDS_ = BANDS;
const MODE_FILTER = (arg('--modes', 'classic,quick,daily') || '').split(','); // e.g. --modes quick --merge-max: widen one mode's calibration cheaply
const DIFFS = (arg('--difficulties', 'easy,normal,hard') || '').split(',').filter((d) => ['easy', 'normal', 'hard'].includes(d));
const wanted = (arg('--maps', MAP_SLUGS.join(',')) || '').split(',').filter((m) => MAP_SLUGS.includes(m));
const sim = await openSim({ port: +arg('--port', 5191), noBuild: process.argv.includes('--no-build') });
const maps = JSON.parse(JSON.stringify(OLD.maps || {}));
let totalRuns = 0;

for (const slug of wanted) {
  const runs = [];
  let values = null;
  const plan = [];
  for (const mode of ['classic', 'quick']) if (MODE_FILTER.includes(mode)) for (const difficulty of DIFFS) plan.push({ mode, day: null, difficulty });
  if (slug === 'centrs' && MODE_FILTER.includes('daily')) for (const tw of TWISTS) plan.push({ mode: 'daily', day: dayFor[tw.id], difficulty: 'normal' });
  for (const bots of ['', 'bots=0']) {
    await sim.open(`${bots}${bots ? '&' : ''}map=${slug}`);
    for (const { mode, day, difficulty } of plan) {
      if (bots && mode !== 'daily' && difficulty !== DIFFS[0]) continue;   // without bots the difficulty is irrelevant: play it once
      for (const strategy of ['greedy', 'cluster']) {
        const n = mode === 'daily' ? Math.max(1, Math.round(RUNS / 4)) : RUNS;
        for (let i = 0; i < n; i++) {
          const r = await simRound(sim.page, { mode, day, strategy, difficulty, collectValues: !values });
          if (r.values) { values = r.values; delete r.values; }
          r.variant = `${strategy}${bots ? '+nobots' : ''}`;
          runs.push(r);
          process.stdout.write(`${slug} ${mode}${day ? '/' + r.twist : ''} ${difficulty} ${r.variant} score ${r.final.score} r ${r.final.radius}\n`);
        }
      }
    }
  }
  writeFileSync(path.join(root, `tools/out/sim-runs-train${slug === 'centrs' ? '' : '-' + slug}.json`), JSON.stringify(runs));
  maps[slug] = computeMap(runs, values, slug);
  if (process.argv.includes('--merge-max') && OLD.maps && OLD.maps[slug]) maps[slug] = mergeMax(OLD.maps[slug], maps[slug]); // keep the earlier ceilings when only adding rounds (wider set => never tighter)
  totalRuns += runs.length;
}
await sim.close();
// re-read limits.js right before writing, so several gen-limits processes (one per map, different --port, all but the first with --no-build) can run in parallel
const fresh = (await import('../worker/lib/limits.js?t=' + Date.now())).LIMITS;
for (const m of MAP_SLUGS) if (!wanted.includes(m) && fresh.maps && fresh.maps[m]) maps[m] = fresh.maps[m];
writeLimits({ format: 2, rules: 2, generated: new Date().toISOString().slice(0, 10), runs: MAP_SLUGS.reduce((n, m) => n + ((maps[m] && maps[m].runs) || 0), 0), bands: BANDS, maps });
console.log('wrote worker/lib/limits.js for', wanted.join(', '));
process.exit(0);

function mergeMax(a, b) {
  const mx = (x, y) => (Array.isArray(x) ? x.map((v, i) => Math.max(v, y[i] ?? 0)) : Math.max(x, y));
  const modes = {};
  for (const m of new Set([...Object.keys(a.modes), ...Object.keys(b.modes)])) {
    const x = a.modes[m], y = b.modes[m];
    modes[m] = x && y ? { gain: mx(x.gain, y.gain), eaten10: mx(x.eaten10, y.eaten10), cap: mx(x.cap, y.cap), maxKills: mx(x.maxKills, y.maxKills), killMax: mx(x.killMax, y.killMax), combo: mx(x.combo || 0, y.combo || 0), picks: mx(x.picks || 0, y.picks || 0) } : (x || y);
  }
  const value = {};
  for (const k of new Set([...Object.keys(a.value), ...Object.keys(b.value)])) { const x = a.value[k], y = b.value[k]; value[k] = x && y ? [Math.min(x[0], y[0]), Math.max(x[1], y[1])] : (x || y); }
  return { runs: a.runs + b.runs, generated: b.generated, modes, value, valueOther: Math.max(a.valueOther, b.valueOther) };
}

function computeMap(runs, values, slug) {
  const modes = {};
  let killMax = 0;
  for (const mode of ['classic', 'quick', 'daily']) {
    const rs = runs.filter((r) => r.mode === mode);
    if (!rs.length) continue;
    const gain = new Array(BANDS_.length).fill(0), seen = new Array(BANDS_.length).fill(0);
    let eaten10 = 0, cap = 0, maxKills = 0, combo = 0, picks = 0;
    for (const r of rs) {
      const tr = r.trace;
      let pS = 0, pE = 0, pK = 0, pT = 0, pM = 0;
      for (let i = 0; i < tr.t.length; i++) {
        const stretch = Math.max(1, (tr.t[i] - pT) / TRACE_STEP);
        const b = bandOf(radiusAt(pM, MODES[mode].growthK));
        if (tr.k[i] === pK) { gain[b] = Math.max(gain[b], (tr.s[i] - pS) / stretch); seen[b]++; }
        eaten10 = Math.max(eaten10, (tr.e[i] - pE) / stretch);
        pS = tr.s[i]; pE = tr.e[i]; pK = tr.k[i]; pT = tr.t[i]; pM = tr.m ? tr.m[i] : tr.s[i];
      }
      cap = Math.max(cap, r.final.score); maxKills = Math.max(maxKills, r.final.kills);
      combo = Math.max(combo, tr.c ? tr.c[tr.c.length - 1] : 0);
      picks = Math.max(picks, tr.u ? ['magnet', 'speed', 'double', 'shield'].reduce((a, k) => a + tr.u[k][tr.u[k].length - 1], 0) : 0);
      killMax = Math.max(killMax, ...r.killGains, ...(r.botScores.length ? [Math.max(...r.botScores) * 0.5] : [0]));
    }
    for (let b = 0; b < BANDS_.length; b++) {   // unobserved bands: carry the lower band forward (x1.5); table is non-decreasing
      if (!seen[b]) gain[b] = (b ? gain[b - 1] : 50) * 1.5;
      if (b) gain[b] = Math.max(gain[b], gain[b - 1]);
    }
    modes[mode] = { gain: gain.map((v) => Math.ceil(v)), eaten10: Math.ceil(eaten10), cap: Math.ceil(cap), maxKills: Math.max(40, maxKills), combo: Math.ceil(combo), picks };
    console.log(slug, mode, JSON.stringify(modes[mode]), 'runs', rs.length);
  }
  for (const m of Object.values(modes)) m.killMax = Math.ceil(killMax);
  const value = {};
  for (const [k, [lo, hi]] of Object.entries(values)) value[k] = [Math.floor(lo), Math.ceil(hi * (k === 'building' || k === 'landmark' ? 1.3 : 1))];
  const valueOther = Math.ceil(Math.max(...Object.values(value).map((v) => v[1])));
  return { runs: runs.length, generated: new Date().toISOString().slice(0, 10), modes, value, valueOther };
}
