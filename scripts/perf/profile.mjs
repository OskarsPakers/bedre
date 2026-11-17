// CPU profile (CDP Profiler) of the running game at one view; prints the top self-time functions.
//   PERF_PORT=5185 GPU=1 node scripts/perf/profile.mjs --dist scripts/.dist-base --map centrs --tier high --view r30|intro|zoomout|build [--secs 6]
import { serve, launch, sleep, arg } from './lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dist = path.resolve(root, arg('--dist', 'scripts/.dist-perf')), map = arg('--map', 'centrs'), tier = arg('--tier', 'high'), view = arg('--view', 'r30'), secs = +arg('--secs', 6);
const srv = await serve(dist, +(process.env.PERF_PORT || 5185));
const browser = await launch('chromium');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
if (view === 'build') await cdp.send('Profiler.start');
await page.goto(`http://localhost:5185/?map=${map}&quality=${tier}&radio=0&sw=0&intro=0&introhold=600`, { waitUntil: 'commit' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
if (view !== 'build') {
  await page.evaluate((v) => { const g = window.__game; g.start(); if (v !== 'intro') { g.skipIntro(); g.step(6); g.setRadius(v === 'zoomout' ? 30 : 30); if (v === 'zoomout') g.zoomBy(100); g.step(1); } }, view);
  if (view === 'move') await page.evaluate(() => { const g = window.__game, G = window.__life.game, pl = G.player, W = window.__life.world, b = W.bounds; G.autopilot = true; g.setRadius(8); let k = 0;
    const steer = () => { let best = null, bs = -1; const R = Math.max(25, pl.radius * 9); W.query(pl.x, pl.z, R, (o, d) => { if (o.state !== 0 || o.fit >= pl.radius * 0.95) return; const sc = o.value / (d + pl.radius * 1.5 + 4); if (sc > bs) { bs = sc; best = o; } }); const a = k++ * 2.4; g.setTarget(Math.max(b.minX + 30, Math.min(b.maxX - 30, best ? best.x : pl.x + Math.cos(a) * 200)), Math.max(b.minZ + 30, Math.min(b.maxZ - 30, best ? best.z : pl.z + Math.sin(a) * 200))); };
    steer(); setInterval(steer, 900); });
  await sleep(1500);
  await cdp.send('Profiler.start');
  if (view === 'paint') { await page.evaluate(async () => { const g = window.__game; g.setRadius(3); g.step(0.5); const h = g.hole; for (let i = 0; i < 40; i++) { g.teleport(h.x + (i % 2 ? 40 : -40) * ((i >> 1) + 1) * 0.3, h.z + 25 * (i % 3)); g.step(0.1); await new Promise((r) => setTimeout(r, 60)); } }); }
  else await sleep(secs * 1000);
}
const { profile } = await cdp.send('Profiler.stop');
console.log('detail-paint spans', JSON.stringify(await page.evaluate(() => performance.getEntriesByName('bd:detail-paint').map((e) => Math.round(e.duration)))));
const self = new Map(), dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`${map} ${tier} ${view}: total sampled ${(total / 1000).toFixed(0)} ms`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(`${(v / 1000).toFixed(0).padStart(6)} ms ${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
const want = arg('--callers', '');
if (want) { // who calls the function `want` (self time attributed up two levels)
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const agg = new Map();
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); if (n.callFrame.functionName !== want) continue; const p1 = byId.get(parent.get(n.id)), p2 = p1 && byId.get(parent.get(p1.id)); const k = `${p1 ? p1.callFrame.functionName : '?'} < ${p2 ? p2.callFrame.functionName : '?'}`; agg.set(k, (agg.get(k) || 0) + (dt[i] || 0)); }
  console.log('callers of', want, [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join(' | '));
}
fs.writeFileSync(path.join(root, 'docs', 'perf', 'data', `profile-${map}-${tier}-${view}.json`), JSON.stringify([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)));
await browser.close(); await srv.close(); process.exit(0);
