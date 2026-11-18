import { run, BLD, OUT, WORK, save } from './lib2.mjs'; import fs from 'node:fs';
const slug = process.argv[2]; fs.mkdirSync(WORK(slug), { recursive: true });
await run(slug, async pg => { const b = BLD[slug].box;
  const g = await pg.evaluate(([b]) => __d.hgrid(b.x0, b.z0, b.x1, b.z1, 1), [b]); fs.writeFileSync(WORK(slug) + 'hgrid.json', JSON.stringify(g));
  const t = await pg.evaluate(([b]) => __d.top({ ...b, ppm: 8 }), [b]); save(OUT + `ref-${slug}-top0.png`, t); });
