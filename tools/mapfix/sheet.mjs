// Comparison sheets. node tools/mapfix/sheet.mjs <name> <key,key,...> [--game]  ->
//   default: tools/.cache/qa-map/sheets/mapfix-<name>.png  = reference | before | after per row (the reference imagery is INTERNAL: never copy it out of tools/.cache)
//   --game : scripts/out/mapfix-<name>.png = before | after only (game images, shippable as evidence)
import fs from 'node:fs'; import sharp from 'sharp';
import { QC, ROOT } from '../qa-map/lib.mjs';
const [name, keys] = process.argv.slice(2), gameOnly = process.argv.includes('--game');
const V = JSON.parse(fs.readFileSync(`${QC}/views.json`)), W = gameOnly ? 640 : 480, H = Math.round(W * 0.625);
const lab = (t) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="18"><rect width="${W}" height="18" fill="#000" opacity=".6"/><text x="4" y="13" font-size="12" font-family="sans-serif" fill="#fff">${t.replace(/[<&]/g, '')}</text></svg>`);
const rows = keys.split(',').map((k) => V.find((v) => v.key === k)).filter(Boolean);
const cols = gameOnly ? [['before', 'game'], ['after', 'game-after']] : [['REAL', 'ref'], ['before', 'game'], ['after', 'game-after']];
const comps = [];
for (const [r, v] of rows.entries()) for (const [c, [t, d]] of cols.entries()) {
  const f = `${QC}/${d}/${v.key}.png`; if (!fs.existsSync(f)) continue;
  comps.push({ input: await sharp(f).resize(W, H).composite([{ input: lab(`${t}  ${v.key} ${v.name || ''}`), top: 0, left: 0 }]).png().toBuffer(), left: c * (W + 3), top: r * (H + 3) });
}
const out = gameOnly ? `${ROOT}/scripts/out/mapfix-${name}.png` : `${QC}/sheets/mapfix-${name}.png`;
await sharp({ create: { width: cols.length * (W + 3), height: rows.length * (H + 3), channels: 3, background: '#111' } }).composite(comps).png().toFile(out);
console.log(out);
