// rectified orthographic elevations + depth pass: node elev.mjs <slug> [prefix]  -> tools/.cache/onebuilding/work-<slug>/ortho-*.png, depth-*.png
import { run, WORK, save, OUT } from './lib2.mjs'; import fs from 'node:fs';
const slug = process.argv[2], only = process.argv[3] || ''; const G = { stockmann: -0.3, bernu: 3.9 }[slug], H = 30;
const E = { // name: {cx,cz,dx,dz (view dir into wall), w, clip, range, ppm}
  stockmann: { 'nw-street': { cx: 165, cz: 592.8, dx: 0.609, dz: 0.793, w: 100, clip: 4, range: 14 }, 'ne-curved': { cx: 262, cz: 565, dx: -0.685, dz: 0.729, w: 70, clip: 15, range: 22 },
    'se-rail': { cx: 197, cz: 620.5, dx: -0.344, dz: -0.940, w: 150, clip: 3, range: 12 }, 'sw-end': { cx: 127.5, cz: 635.7, dx: 0.95, dz: -0.32, w: 40, clip: 3, range: 12 } },
  bernu: { 'sw-matisa': { cx: 1254.4, cz: -607.4, dx: 0.765, dz: -0.644, w: 60, clip: 4, range: 14 }, 'nw': { cx: 1259, cz: -646, dx: 0.684, dz: 0.730, w: 60, clip: 4, range: 14 } } }[slug];
await run(slug, async pg => { for (const [k, o] of Object.entries(E)) { if (!k.startsWith(only)) continue; const [c, d] = await pg.evaluate(o => __d.elev(o), { ...o, y0: G, y1: G + H, ppm: 30 });
  save(WORK(slug) + `ortho-${k}.png`, c); save(WORK(slug) + `depth-${k}.png`, d); fs.copyFileSync(WORK(slug) + `ortho-${k}.png`, OUT + `ref-${slug}-elev-${k}.png`); console.log(k); } });
