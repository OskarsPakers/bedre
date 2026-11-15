// False-reject check of the anti-cheat model: plays FRESH simulated rounds (not the ones the limits were generated from)
// across all modes / daily twists with several player strengths, and feeds each trace to worker/lib/validate.js.
// Legit rounds must come out 'ok' (0 false rejects, ideally 0 suspects). Also runs tampered copies as a control.
//   node tools/check-legit.mjs [--runs 36] [--no-build] [--port 5191]      (GPU=1 for the metal backend)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { openSim, simRound, root } from './sim-lib.mjs';
import { MODES } from '../src/rules.js';
import { TWISTS, dailyInfo } from '../src/daily.js';
import { validateSubmission } from '../worker/lib/validate.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('--runs', 36);
const sim = await openSim({ port: +arg('--port', 5191), noBuild: process.argv.includes('--no-build') });

const days = {};
for (let d = new Date('2026-12-01T00:00:00Z'), n = 0; n < 200 && Object.keys(days).length < TWISTS.length; d.setUTCDate(d.getUTCDate() + 1), n++) {
  const day = d.toISOString().slice(0, 10), id = dailyInfo(day).twist.id;
  if (!days[id]) days[id] = day;
}
const cases = [];
for (const mode of ['classic', 'quick']) for (const [strategy, speedMul] of [['greedy', 1], ['cluster', 1], ['greedy', 0.6], ['cluster', 0.45]]) cases.push({ mode, strategy, speedMul });
for (const tw of TWISTS) cases.push({ mode: 'daily', day: days[tw.id], strategy: tw.id.length % 2 ? 'cluster' : 'greedy', speedMul: 1 });

const results = [], runs = [];
for (const bots of ['', 'bots=0']) {
  await sim.open(bots);
  for (let i = 0; runs.filter((r) => r.bots === bots).length < RUNS / 2; i++) {
    const c = cases[i % cases.length];
    const r = await simRound(sim.page, { ...c, seconds: 400 });
    r.bots = bots; r.speedMul = c.speedMul; r.strategy = c.strategy;
    runs.push(r);
    const seconds = MODES[r.mode].seconds;
    const v = validateSubmission({ mode: r.mode, seconds, age: seconds + 5, score: r.final.score, eaten: r.final.eaten, radius: r.final.radius, rank: r.final.rank, trace: r.trace });
    results.push({ ...c, bots, score: r.final.score, ...v });
    console.log(`${v.verdict.padEnd(7)} ${r.mode}${r.twist ? '/' + r.twist : ''} ${c.strategy} x${c.speedMul}${bots ? ' nobots' : ''} score ${r.final.score} kills ${r.final.kills} ${v.reasons.join(',')}`);
  }
}
await sim.close();
writeFileSync(path.join(root, 'tools/out/sim-runs-test.json'), JSON.stringify(runs));

const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\nLEGIT rounds: ${results.length}  ok ${count('ok')}  suspect ${count('suspect')}  REJECT ${count('reject')}`);

// control: tampered copies of the legit traces must NOT pass
const tamper = {
  'final score x4 (consistent)': (r) => { const t = structuredClone(r.trace); const f = 4; t.s = t.s.map((s) => Math.round(s * f)); return { t, score: Math.round(r.final.score * f) }; },
  'only final score x10': (r) => { const t = structuredClone(r.trace); t.s[t.s.length - 1] *= 10; return { t, score: r.final.score * 10 }; },
  'score 1e6 with legit-looking trace': (r) => ({ t: structuredClone(r.trace), score: 1e6 }),
  'jump +30000 in the middle': (r) => { const t = structuredClone(r.trace); const m = Math.floor(t.s.length / 2); for (let i = m; i < t.s.length; i++) t.s[i] += 30000; return { t, score: t.s[t.s.length - 1] }; },
  'eaten count inflated': (r) => { const t = structuredClone(r.trace); t.e = t.e.map((e, i) => e + i * 400); return { t, score: r.final.score }; },
  'time compressed (fewer samples)': (r) => { const t = structuredClone(r.trace); for (const k of ['t', 's', 'r', 'e', 'k']) t[k] = t[k].filter((_, i) => i % 2); return { t, score: r.final.score }; },
};
let missed = 0, total = 0;
for (const [label, f] of Object.entries(tamper)) {
  const bad = [];
  for (const r of runs.filter((x) => x.mode === 'classic').slice(0, 6)) {
    const { t, score } = f(r);
    if (label.includes('final score x4') || label.includes('only final')) { t.kinds = r.trace.kinds; }
    const v = validateSubmission({ mode: 'classic', seconds: 300, age: 305, score, eaten: t.e[t.e.length - 1], radius: r.final.radius, rank: 1, trace: { ...t, kills: r.trace.kills, deaths: r.trace.deaths } });
    total++; if (v.verdict === 'ok') { missed++; bad.push(score); }
  }
  console.log(`tamper "${label}": ${bad.length ? 'NOT DETECTED x' + bad.length : 'all detected'}`);
}
console.log(`control: ${total - missed}/${total} tampered submissions flagged or rejected`);
process.exit(count('reject') || count('suspect') ? 1 : 0);
