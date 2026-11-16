// Setup-only (hooks used after finding suspicions by scan): look at specific coordinates. usage: node spot.mjs map x z tag [radius]
import { launch, newPage, sleep, note } from './lib.mjs';
const [map, xs, zs, tag, rs] = process.argv.slice(2);
const b = await launch();
const p = await newPage(b, { tag: 'spot', locale: 'en-US' });
await p.openGame(`map=${map}&autostart=1&intro=0&mode=free`);
await sleep(1200);
const x = +xs, z = +zs;
const info = await p.evaluate(({ x, z }) => {
  const d = window.__life.world.data; const pip = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  return d.buildings.filter((b) => pip(x, z, b.p)).map((b) => ({ id: b.id, h: b.h, t: b.t, n: b.n, npts: b.p.length }));
}, { x, z });
note(`SPOT ${map} ${x},${z} buildings here: ` + JSON.stringify(info));
await p.evaluate(({ x, z, r }) => { window.__game.teleport(x, z); if (r) window.__game.setRadius(+r); }, { x, z, r: rs });
await sleep(1500);
await p.shot('spot-' + tag);
await p.evaluate(() => window.__game.zoomBy(2.0)); await sleep(1200);
await p.shot('spot-' + tag + '-wide');
await b.close();
