import fs from 'node:fs'; import sharp from 'sharp'; import { QC, ROOT } from './lib.mjs';
const V = JSON.parse(fs.readFileSync(`${QC}/views.json`));
const per = +(process.argv[2] || 4); const sel = process.argv[3] ? process.argv[3].split(',') : V.map((v) => v.key);
const list = V.filter((v) => sel.includes(v.key) && fs.existsSync(`${QC}/ref/${v.key}.png`) && fs.existsSync(`${QC}/game/${v.key}.png`));
const W = 640, H = 400; let k = 0;
for (let i = 0; i < list.length; i += per) {
  const part = list.slice(i, i + per); const comps = [];
  for (const [r, v] of part.entries()) {
    const lab = (t, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20"><rect width="${w}" height="20" fill="#000" opacity=".6"/><text x="4" y="14" font-size="12" font-family="sans-serif" fill="#fff">${t.replace(/[<&]/g, '')}</text></svg>`);
    const a = await sharp(`${QC}/ref/${v.key}.png`).resize(W, H).composite([{ input: lab('REAL (GeoRiga mesh) ' + v.name, W), top: 0, left: 0 }]).png().toBuffer();
    const b = await sharp(`${QC}/game/${v.key}.png`).resize(W, H).composite([{ input: lab('GAME ' + v.key, W), top: 0, left: 0 }]).png().toBuffer();
    comps.push({ input: a, left: 0, top: r * (H + 3) }, { input: b, left: W + 3, top: r * (H + 3) });
  }
  const f = `${QC}/sheets/${process.argv[4] || 'p'}-${k++}.png`;
  await sharp({ create: { width: 2 * W + 3, height: part.length * (H + 3), channels: 3, background: '#111' } }).composite(comps).png().toFile(f);
  console.log(f, part.map((v) => v.key).join(','));
}
