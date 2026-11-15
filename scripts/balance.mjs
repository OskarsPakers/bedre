// Bot balance + spawn density check (headless). Builds its own static copy (scripts/.dist-balance) with a build-time
// transform that exposes the Game / World / CFG objects (no source edits), serves it and runs:
//   - greedy autoplayer baseline (no bots), N runs
//   - bots-only 300 s rounds (player idle, parked off-map), N runs: all 7 bot scores, min/max ratio, deaths
//   - player-spawn density: edible objects within 60 m of the player spawn over 5 rounds
// Usage: PORT=5183 GPU=1 node scripts/balance.mjs [--runs 3] [--greedy 2] [--spawn-only] [--no-build]
//        [--set bots.difficulty=0.9,bots.speedMax=0.95]   (runtime CFG overrides)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5183;
const base = `http://localhost:${PORT}`;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const RUNS = +arg('--runs', 3), GREEDY = +arg('--greedy', has('--spawn-only') ? 0 : 2);
const sets = (arg('--set', '') || '').split(',').filter(Boolean).map((s) => s.split('='));

const dist = path.join(root, 'scripts', '.dist-balance');
if (!has('--no-build')) {
  await build({
    root, logLevel: 'error',
    build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 },
    plugins: [{
      name: 'expose-internals',
      transform(code, id) {
        if (!id.replace(/\\/g, '/').endsWith('/src/main.js')) return null;
        return code.replace('window.__game = game.api();', 'window.__game = game.api(); window.__G = game; window.__W = world; window.__CFG = CFG;');
      },
    }],
  });
}
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({
  headless: true,
  args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const G = (fn, a) => page.evaluate(fn, a);
const open = async (q) => {
  await page.goto(`${base}/?intro=0&${q}${process.env.MAP ? '&map=' + process.env.MAP : ''}`); // MAP=<slug>: balance a district
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  // the HUD is irrelevant for balance and may be mid-edit by someone else: keep the sim independent of it
  await G(() => { const g = window.__G; g._hudSync = () => {}; g._overlay = () => {}; g._flushPopup = () => {}; });
  if (sets.length) await G((sets) => { for (const [k, v] of sets) { const p = k.split('.'); let o = window.__CFG; while (p.length > 1) o = o[p.shift()]; o[p[0]] = +v; } }, sets);
};

// ---- spawn density -----------------------------------------------------------------------------------------
await open('');
const dens = [];
for (let i = 0; i < 5; i++) {
  dens.push(await G(() => {
    const g = window.__G, w = window.__W, C = window.__CFG;
    try { g.start(); } catch (e) { console.warn('start:', e.message); } g.skipIntro();
    const p = g.player, r0 = C.hole.startRadius;
    const f0 = r0 * C.swallow.fitRatio;
    let now = 0, soon = 0, near = 0, pts = 0;
    w.query(p.x, p.z, 60, (o, d) => {
      if (o.state !== 0) return;
      if (o.fit < f0) { now++; pts += o.value; if (d < 30) near++; }
      if (o.fit < f0 * 1.6) soon++;
    });
    return { x: Math.round(p.x), z: Math.round(p.z), edibleNow: now, within30: near, slightlyLarger: soon, pts };
  }));
}
console.log('player spawn density (60 m, fit < r0*fitRatio | < 1.6x):');
for (const d of dens) console.log('  ', JSON.stringify(d));
// early game: idle-free greedy player for 20 s (human-like pace): score / eaten
await open('bots=0');
const early = [];
for (let i = 0; i < 3; i++) early.push(await G(() => { const g = window.__G; try { g.start(); } catch (e) { console.warn('start:', e.message); } g.autoplay(20); return { score: Math.round(g.player.score), eaten: g.player.eaten, r: +g.player.radius.toFixed(1) }; }));
console.log('greedy first 20 s:', JSON.stringify(early));
if (has('--spawn-only')) { await browser.close(); kill(); process.exit(0); }

// ---- greedy baseline ---------------------------------------------------------------------------------------
const greedy = [];
for (let i = 0; i < GREEDY; i++) {
  if (i === 0) await open('bots=0');
  const gr = await G(() => { const g = window.__G; try { g.start(); } catch (e) { console.warn('start:', e.message); } const m = []; for (let k = 0; k < 5; k++) { g.autoplay(k < 4 ? 60 : 61); m.push(Math.round(g.player.score)); } return m; });
  greedy.push(gr[4]);
  console.log('greedy per-minute:', gr.join(' '));
}
if (GREEDY) console.log('greedy autoplayer (no bots):', greedy.join(' '));

// ---- bots-only rounds --------------------------------------------------------------------------------------
const tops = [], ratios = [];
for (let run = 0; run < RUNS; run++) {
  if (run === 0) await open(''); // later rounds re-start() on the same page: new spawns / names, like replays
  const res = await G(() => {
    const g = window.__G, p = g.player, b = g.world.bounds;
    try { g.start(); } catch (e) { console.warn('start:', e.message); } g.skipIntro();
    // take the idle player out of the round (dead, never respawns) so it neither feeds nor scares anyone
    const park = () => { p.alive = false; p.dying = null; p.respawnT = 1e9; p.x = b.maxX + 5000; p.z = b.maxZ + 5000; };
    const marks = [];
    for (const br of g.bots.brains) br._modeT = {};
    for (let t = 0; t < 300 && g.phase === 'playing'; t += 1) {
      park();
      for (let i = 0; i < 60 && g.phase === 'playing'; i++) { g.update(1 / 60, true); park(); }
      if ((t + 1) % 60 === 0) marks.push(g.bots.holes.map((h) => Math.round(h.score)));
      for (const br of g.bots.brains) { const m = br.hole.alive ? br.mode : 'dead'; (br._modeT ||= {})[m] = (br._modeT[m] || 0) + 1; }
    }
    return { marks, modes: g.bots.brains.map((b) => b._modeT), bots: g.bots.holes.map((h) => ({ name: h.name, score: Math.round(h.score), r: +h.radius.toFixed(0), k: h.kills, d: h.deaths })) };
  });
  const s = res.bots.map((b) => b.score).sort((a, b) => b - a);
  tops.push(s[0]); ratios.push(s[s.length - 1] / s[0]);
  console.log(`run ${run + 1}: ${s.join(' ')} | worst/best ${(s[s.length - 1] / s[0] * 100).toFixed(0)}% | kills ${res.bots.reduce((a, b) => a + b.k, 0)}`);
  console.log('   ', res.bots.map((b) => `${b.name}:${b.score} r${b.r} k${b.k}d${b.d}`).join(' '));
  if (has('--marks')) console.log('    per-minute:', JSON.stringify(res.marks));
  if (has('--modes')) console.log('    mode seconds:', JSON.stringify(res.modes));
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
if (RUNS) console.log(`SUMMARY top avg ${Math.round(avg(tops))}${GREEDY ? ` (${(avg(tops) / avg(greedy) * 100).toFixed(0)}% of greedy ${Math.round(avg(greedy))})` : ''}, worst/best avg ${(avg(ratios) * 100).toFixed(0)}% min ${(Math.min(...ratios) * 100).toFixed(0)}%`);
await browser.close();
kill();
process.exit(0);
