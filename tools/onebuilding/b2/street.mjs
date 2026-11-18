// street-level perspective views: node street.mjs <slug> [prefix]
import { run, OUT, save } from './lib2.mjs';
const slug = process.argv[2], only = process.argv[3] || '';
const G = { stockmann: -0.3, bernu: 3.9 }[slug];
const V = { // name: [camx, camz, eye m above ground, tx, tz, t height above ground, fov]
  stockmann: {
    'street-sw-glazed': [118, 548, 4, 158, 597, 10, 62], 'street-mid': [215, 528, 3, 188, 578, 10, 62], 'street-ne-corner': [300, 535, 3, 262, 565, 8, 62],
    'street-curve-front': [292, 538, 3, 256, 573, 9, 60], 'rail-sw': [140, 656, 3, 178, 622, 9, 62], 'rail-ne': [255, 645, 13, 235, 603, 13, 62], 'end-sw': [95, 660, 3, 128, 632, 10, 55] },
  bernu: {
    'street-sw-main': [1233, -603, 2.5, 1256, -611, 9, 80],
    'street-nw': [1252, -676, 3, 1260, -648, 8, 75], 'street-nw-right': [1275, -680, 3, 1275, -655, 8, 75] } }[slug];
await run(slug, async pg => { for (const [k, [cx, cz, eh, tx, tz, th, fov]] of Object.entries(V)) { if (!k.startsWith(only)) continue; const r = await pg.evaluate(([p, l, fov]) => __d.view(p, l, fov, 1600, 1000), [[cx, G + eh, cz], [tx, G + th, tz], fov]); save(OUT + `ref-${slug}-street-${k.replace(/^street-/, '')}.png`, r); console.log(k); } });
