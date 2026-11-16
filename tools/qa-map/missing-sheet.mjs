import fs from 'node:fs'; import sharp from 'sharp';
import { cropPair, sheet } from './crop.mjs';
import { QC, ROOT } from './lib.mjs';
const [slug, from = 0, n = 12, minCanopy = 0.3] = process.argv.slice(2);
let c = JSON.parse(fs.readFileSync(`${QC}/missing-${slug}.json`)).filter((r) => r.area >= 80 && r.canopy < +minCanopy && r.maxH >= 5 && r.fill >= 0.4 && r.wall >= 0.35);
c.sort((a, b) => b.area * b.meanH - a.area * a.meanH);
const sel = c.slice(+from, +from + +n);
const tiles = [];
for (const [i, r] of sel.entries()) {
  const [A, B] = await cropPair(slug, r.x, r.z, 110, { px: 330, marks: [{ x: r.x, z: r.z }], label: `#${+from + i} ${r.x},${r.z} A${r.area} h${r.meanH}/${r.maxH} r${r.rough} c${r.canopy} w${r.wall}` });
  tiles.push(await sharp({ create: { width: 666, height: 330, channels: 3, background: '#000' } }).composite([{ input: A, left: 0, top: 0 }, { input: B, left: 336, top: 0 }]).png().toBuffer());
}
await sheet(tiles, process.argv[7] || `/tmp/miss-${slug}-${from}.png`, 2);
console.log(sel.map((r, i) => `#${+from + i} ${r.x},${r.z} A${r.area} h${r.meanH}/${r.maxH} r${r.rough} c${r.canopy} fill${r.fill}`).join('\n'));
