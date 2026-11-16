import sharp from 'sharp'; import { cropPair, sheet } from './crop.mjs';
// usage: node pts-sheet.mjs out slug,x,z,size,label ...
const [out, ...pts] = process.argv.slice(2); const tiles = [];
for (const p of pts) { const [slug, x, z, size, ...lab] = p.split(','); const [A, B] = await cropPair(slug, +x, +z, +size, { px: 330, label: lab.join(',') || `${slug} ${x},${z}` }); tiles.push(await sharp({ create: { width: 666, height: 330, channels: 3, background: '#000' } }).composite([{ input: A, left: 0, top: 0 }, { input: B, left: 336, top: 0 }]).png().toBuffer()); }
await sheet(tiles, out, 2);
