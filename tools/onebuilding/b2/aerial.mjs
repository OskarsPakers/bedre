import { run, OUT, save } from './lib2.mjs';
const slug = process.argv[2]; const C = { stockmann: { c: [205, 8, 592], ang: -19.6, dist: 150, h: 85 }, bernu: { c: [1272, 8, -628], ang: -43, dist: 120, h: 85 } }[slug];
const th = C.ang * Math.PI / 180, a = [Math.cos(th), Math.sin(th)], n = [a[1], -a[0]]; // n = one perpendicular
await run(slug, async pg => { const sides = { 'a': a, 'b': n, 'c': [-a[0], -a[1]], 'd': [-n[0], -n[1]] };
  for (const [k, d] of Object.entries(sides)) { const p = [C.c[0] + d[0] * C.dist, C.h, C.c[2] + d[1] * C.dist]; const r = await pg.evaluate(([p, l]) => __d.view(p, l, 40), [p, C.c]); save(OUT + `ref-${slug}-aerial-${k}.png`, r); console.log(k, p); } });
