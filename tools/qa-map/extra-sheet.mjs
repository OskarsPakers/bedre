import fs from 'node:fs'; import sharp from 'sharp';
import { cropPair, sheet } from './crop.mjs';
import { QC } from './lib.mjs';
const [slug, from = 0, n = 12, out] = process.argv.slice(2);
const B = JSON.parse(fs.readFileSync(`${QC}/bld-${slug}.json`));
let ex = B.filter((r) => r.m50 !== undefined && r.cover >= 0.7 && r.n >= 30 && r.flat >= 0.8 && r.rMean >= 3.5 && r.area >= 60);
ex.sort((a, b) => b.area * b.rMean - a.area * a.rMean);
const sel = ex.slice(+from, +from + +n); const tiles = [];
for (const [i, r] of sel.entries()) {
  const sz = Math.max(90, Math.sqrt(r.area) * 2.2);
  const [A, B2] = await cropPair(slug, r.x, r.z, sz, { px: 330, marks: [], label: `#${+from + i} ${r.id} ${(r.name || r.t).slice(0, 18)} ${r.x},${r.z} A${r.area} rend${r.rMean}` });
  tiles.push(await sharp({ create: { width: 666, height: 330, channels: 3, background: '#000' } }).composite([{ input: A, left: 0, top: 0 }, { input: B2, left: 336, top: 0 }]).png().toBuffer());
}
await sheet(tiles, out, 2);
