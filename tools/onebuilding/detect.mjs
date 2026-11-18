// "Inverse procedural" step 1: detect openings (windows/doors) in the rectified elevations -> rectangles in metres (frame: u/v, y above ground).
// Method: luminance vs. local (1.5 m) background, threshold, connected components, size/fill filters, per-tier regularisation. node detect.mjs
import sharp from 'sharp'; import fs from 'node:fs';
const W = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/work/', OUT = '/Users/oskars/projects/holeio/scripts/out/onebuilding/';
async function run(name, a0, a1, flipH, o) {
  const ppm = 20, src = W + `ortho-${name}.png`; const meta = await sharp(src).metadata();
  const w = Math.round((a1 - a0) * ppm), h = Math.round(meta.height * ppm / 40);
  const { data } = await sharp(src).resize(w, h, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const N = w * h, L = new Float32Array(N), white = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; L[i] = (0.3 * r + 0.59 * g + 0.11 * b) / 255; white[i] = (r > 250 && g > 250 && b > 250) ? 1 : 0; }
  // local mean via box blur (separable, radius 1.5 m = 30 px), ignoring white background
  const R = 30, blur = (src, inv) => { const t = new Float32Array(N), out = new Float32Array(N); for (let y = 0; y < h; y++) { let s = 0, c = 0; for (let x = -R; x <= R; x++) if (x >= 0 && x < w) { const i = y * w + x; if (!white[i]) { s += src[i]; c++; } } for (let x = 0; x < w; x++) { t[y * w + x] = c ? s / c : 1; const xa = x - R, xb = x + R + 1; if (xa >= 0) { const i = y * w + xa; if (!white[i]) { s -= src[i]; c--; } } if (xb < w) { const i = y * w + xb; if (!white[i]) { s += src[i]; c++; } } } }
    for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let y = -R; y <= R; y++) if (y >= 0 && y < h) { s += t[y * w + x]; c++; } for (let y = 0; y < h; y++) { out[y * w + x] = s / c; const ya = y - R, yb = y + R + 1; if (ya >= 0) { s -= t[ya * w + x]; c--; } if (yb < h) { s += t[yb * w + x]; c++; } } } return out; };
  const B = blur(L), mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = (!white[i] && L[i] < B[i] * (o.k ?? 0.62) && L[i] < 0.5) ? 1 : 0;
  // connected components (4-neigh), bounding boxes
  const lab = new Int32Array(N), boxes = []; let nl = 0; const st = [];
  for (let s = 0; s < N; s++) { if (!mask[s] || lab[s]) continue; nl++; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, cnt = 0; st.push(s); lab[s] = nl; while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < N && mask[j] && !lab[j] && Math.abs((j % w) - x) <= 1) { lab[j] = nl; st.push(j); } } boxes.push({ x0, x1, y0, y1, cnt }); }
  const found = [];
  for (const b of boxes) { const bw = (b.x1 - b.x0 + 1) / ppm, bh = (b.y1 - b.y0 + 1) / ppm, fill = b.cnt / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)); const yTop = (o.b1 - b.y0 / ppm), yBot = (o.b1 - (b.y1 + 1) / ppm) - 0.8;
    if (bw < 0.3 || bw > 2.6 || bh < 0.5 || bh > 5.5 || fill < 0.5 || yBot < 0.3 || yBot > 25) continue;
    const c0 = flipH ? a1 - (b.x1 + 1) / ppm : a0 + b.x0 / ppm, c1 = flipH ? a1 - b.x0 / ppm : a0 + (b.x1 + 1) / ppm; found.push({ a0: +c0.toFixed(2), a1: +c1.toFixed(2), y0: +yBot.toFixed(2), y1: +(yBot + bh).toFixed(2), fill: +fill.toFixed(2) }); }
  fs.writeFileSync(W + `openings-${name}.json`, JSON.stringify(found)); console.log(name, boxes.length, 'blobs ->', found.length, 'openings');
  // overlay for review
  const ov = Buffer.from(data); const put = (x, y, c) => { if (x >= 0 && x < w && y >= 0 && y < h) { ov[(y * w + x) * 3] = c[0]; ov[(y * w + x) * 3 + 1] = c[1]; ov[(y * w + x) * 3 + 2] = c[2]; } };
  for (const f of found) { const x0 = Math.round(flipH ? (a1 - f.a1) * ppm : (f.a0 - a0) * ppm), x1 = Math.round(flipH ? (a1 - f.a0) * ppm : (f.a1 - a0) * ppm), y1 = Math.round((o.b1 - (f.y0 + 0.8)) * ppm), y0 = Math.round((o.b1 - (f.y1 + 0.8)) * ppm); for (let x = x0; x <= x1; x++) { put(x, y0, [255, 0, 0]); put(x, y1, [255, 0, 0]); } for (let y = y0; y <= y1; y++) { put(x0, y, [255, 0, 0]); put(x1, y, [255, 0, 0]); } }
  await sharp(ov, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toFile(OUT + `detect-${name}.jpg`);
}
await run('sw', -15, 95, false, { b1: 37 }); await run('n', -5, 45, true, { b1: 37 }); await run('nloggia', -5, 45, true, { b1: 37 });
