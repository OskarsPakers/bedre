// node flat.mjs out.png scale file1 file2 ...  : put rectified facades side by side on a magenta ground (transparent = no mesh surface in the slab)
import sharp from 'sharp';
const [out, sc, ...files] = process.argv.slice(2); const imgs = [];
for (const f of files) { const m = await sharp(f).metadata(); const w = Math.round(m.width * +sc), h = Math.round(m.height * +sc); imgs.push({ w, h, buf: await sharp(f).resize(w, h, { kernel: 'nearest' }).flatten({ background: '#d0f' }).png().toBuffer() }); }
const W = Math.max(...imgs.map((i) => i.w)), H = imgs.reduce((s, i) => s + i.h + 6, 0); let y = 0; const comp = [];
for (const i of imgs) { comp.push({ input: i.buf, left: 0, top: y }); y += i.h + 6; }
await sharp({ create: { width: W, height: H, channels: 3, background: '#222' } }).composite(comp).png().toFile(out);
