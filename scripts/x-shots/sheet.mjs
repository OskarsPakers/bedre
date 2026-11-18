import sharp from 'sharp';
// node sheet.mjs out.png cols w file1 file2 ...
const [out, cols, w, ...files] = process.argv.slice(2);
const W = +w, H = Math.round(W * 9 / 16), C = +cols, rows = Math.ceil(files.length / C);
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(W, H, { fit: 'cover' }).toBuffer(), left: (i % C) * (W + 4), top: Math.floor(i / C) * (H + 4) })));
await sharp({ create: { width: C * (W + 4), height: rows * (H + 4), channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
