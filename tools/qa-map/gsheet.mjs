import fs from 'node:fs'; import sharp from 'sharp'; import { QC } from './lib.mjs';
const [out, ...keys] = process.argv.slice(2); const V = JSON.parse(fs.readFileSync(`${QC}/views.json`));
const W = 640, H = 400, comps = [];
for (const [i, k] of keys.entries()) { const v = V.find((x) => x.key === k); const lab = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20"><rect width="${W}" height="20" fill="#000" opacity=".65"/><text x="4" y="14" font-size="12" font-family="sans-serif" fill="#fff">${(v.name || k).replace(/[<&]/g, '').slice(0, 100)}</text></svg>`);
  const b = await sharp(`${QC}/game/${k}.png`).resize(W, H).composite([{ input: lab, top: 0, left: 0 }]).png().toBuffer(); comps.push({ input: b, left: (i % 2) * (W + 3), top: Math.floor(i / 2) * (H + 3) }); }
await sharp({ create: { width: 2 * W + 3, height: Math.ceil(keys.length / 2) * (H + 3), channels: 3, background: '#111' } }).composite(comps).png().toFile(out);
