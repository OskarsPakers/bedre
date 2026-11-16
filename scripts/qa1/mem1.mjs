// Leak / state-reset check over repeated rounds in ONE page (uses ?time=12 only to shorten rounds: unranked, memory/reset test only)
import { launch, newPage, sleep, note, frameStats } from './lib.mjs';
const map = process.argv[2] || 'centrs';
const N = +process.argv[3] || 10;
const b = await launch();
const p = await newPage(b, { tag: 'mem-' + map, locale: 'en-US' });
await p.openGame(`map=${map}&time=14&intro=0`);
const snap = () => p.evaluate(() => { const L = window.__life, g = window.__game; const r = L.renderer.info; return { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, geo: r.memory.geometries, tex: r.memory.textures, calls: r.render.calls, tri: r.render.triangles, objs: L.world.objects.length, remP: g.counts.remainingProps, remB: g.counts.remainingBuildings, falling: g.counts.falling, movers: L.traffic.list.length, dom: document.getElementsByTagName('*').length, labels: document.getElementById('labels').children.length, feed: document.getElementById('feed').children.length, popups: document.getElementById('popups').children.length, holes: g.holes.length }; });
note(`mem0 ${JSON.stringify(await snap())}`);
for (let r = 1; r <= N; r++) {
  await p.click(r === 1 ? '#play' : '#again');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const st = await p.evaluate(() => window.__game.state.phase);
    if (st === 'ended') break;
    const a = (Date.now() - t0) / 400; await p.mouse.move(640 + Math.cos(a) * 260, 400 + Math.sin(a * 0.7) * 160); await sleep(120);
  }
  await sleep(2500);
  const s = await snap(); const fs = await frameStats(p);
  note(`round ${r} ${JSON.stringify(s)} fps avg=${fs.avg.toFixed(1)} p99=${fs.p99.toFixed(1)} max=${fs.max.toFixed(0)} score=${await p.evaluate(() => document.getElementById('r-score').textContent)}`);
  if (r === 3) await p.shot('mem-results-r3');
}
note('errs ' + p.errs.length);
await b.close();
