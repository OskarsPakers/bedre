// contact sheet: node sheet.mjs out.jpg cols tileW "label=file" ... (files relative to scripts/out/onebuilding unless absolute)
import sharp from 'sharp'; import path from 'node:path';
const OUT = '/Users/oskars/projects/holeio/scripts/out/onebuilding/'; const [out, cols, tw, ...items] = process.argv.slice(2); const W = +tw, H = Math.round(W * 9 / 16), pad = 22, C = +cols, rows = Math.ceil(items.length / C);
const comps = [];
for (let i = 0; i < items.length; i++) { const [label, f] = items[i].split('='); const x = (i % C) * W, y = Math.floor(i / C) * (H + pad);
  comps.push({ input: await sharp(path.isAbsolute(f) ? f : OUT + f).resize(W, H, { fit: 'cover' }).toBuffer(), left: x, top: y + pad });
  comps.push({ input: Buffer.from(`<svg width="${W}" height="${pad}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Helvetica,Arial" font-size="14" fill="#fff">${label.replace(/&/g, '&amp;')}</text></svg>`), left: x, top: y }); }
await sharp({ create: { width: W * C, height: (H + pad) * rows, channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 88 }).toFile(path.isAbsolute(out) ? out : OUT + out);
