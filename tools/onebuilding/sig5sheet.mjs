// Compose the round-5 sheets of one building from scripts/out/tramcity/sig5-<slug>-*.png:  node tools/onebuilding/sig5sheet.mjs <slug> [reference.png ...]
//   sig5-<slug>-compare.png : (reference | round 4 | new) x (cab, chase, 3/4);  -themes.png : day / evening / winter x cab, 3/4;  -lods.png : LOD0 / LOD1 / LOD2 / wireframe;  -hero.png
import sharp from 'sharp'; import fs from 'node:fs';
const slug = process.argv[2], refs = process.argv.slice(3), D = 'scripts/out/tramcity/', f = (n) => `${D}sig5-${slug}-${n}.png`;
const W = 640, H = 360;
async function cell(path, label) { let img = fs.existsSync(path) ? sharp(path).resize(W, H, { fit: 'cover' }) : sharp({ create: { width: W, height: H, channels: 3, background: '#222' } });
  const svg = Buffer.from(`<svg width="${W}" height="${H}"><rect x="0" y="0" width="${Math.min(W, 12 + label.length * 8.5)}" height="22" fill="#000" opacity="0.65"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#fff">${label}</text></svg>`);
  return sharp(await img.png().toBuffer()).composite([{ input: svg }]).png().toBuffer(); }
async function grid(rows, out) { const cols = Math.max(...rows.map((r) => r.length)); const comps = []; for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) comps.push({ input: await cell(rows[r][0 + c][0], rows[r][c][1]), left: c * W, top: r * H });
  await sharp({ create: { width: cols * W, height: rows.length * H, channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 88 }).toFile(out); console.log(out); }
const ref = (i) => refs[i] || '';
await grid([[[ref(0), 'real mesh (reference, owner only)'], [f('r4-cab'), 'round 4 cab'], [f('new-cab'), 'new cab']], [[ref(1), 'real mesh (other view)'], [f('r4-chase'), 'round 4 chase'], [f('new-chase'), 'new chase']], [[ref(2), 'real mesh (3/4)'], [f('r4-3q'), 'round 4 3/4'], [f('new-a3q'), 'new 3/4']]], `${D}sig5-${slug}-compare.jpg`);
await grid([[[f('new-cab'), 'cab day'], [f('new-cab-evening'), 'cab evening'], [f('new-cab-winter'), 'cab winter']], [[f('new-a3q'), '3/4 day'], [f('new-a3q-evening'), '3/4 evening'], [f('new-a3q-winter'), '3/4 winter']], [[f('new-b3q'), '3/4 other side day'], [f('new-b3q-evening'), 'evening'], [f('new-b3q-winter'), 'winter']]], `${D}sig5-${slug}-themes.jpg`);
await grid([[[f('lod0'), 'LOD0'], [f('lod1'), 'LOD1'], [f('lod2'), 'LOD2']], [[f('wire'), 'wireframe LOD0'], [f('new-hero'), 'hero day'], [f('new-hero-evening'), 'hero evening']]], `${D}sig5-${slug}-lods.jpg`);
