// Bake step: rectified elevations (from the dense reality mesh) -> de-lit albedo atlas + fine-detail normal map + AO/ORM, 2048x1536, plus roof / glass / palette textures.
// Output: tools/.cache/onebuilding/out/tex/*.png  (CONTAINS MUNICIPAL PIXELS: albedo/normal/orm atlases. roof/glass/palette are synthetic.)
import sharp from 'sharp'; import fs from 'node:fs';
const W = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/work/', T = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/out/tex/'; fs.mkdirSync(T, { recursive: true });
const AW = 2048, AH = 1536;
const regions = [{ name: 'sw', x: 0, y: 0, w: 2048, h: 674, ppm: 18.62 }, { name: 'n', x: 0, y: 700, w: 1024, h: 742, ppm: 20.48 }, { name: 'nloggia', x: 1024, y: 700, w: 1024, h: 742, ppm: 20.48 }];
const alb = Buffer.alloc(AW * AH * 3), nrm = Buffer.alloc(AW * AH * 3), orm = Buffer.alloc(AW * AH * 3);
for (let i = 0; i < AW * AH; i++) { alb[i * 3] = 224; alb[i * 3 + 1] = 217; alb[i * 3 + 2] = 202; nrm[i * 3] = 128; nrm[i * 3 + 1] = 128; nrm[i * 3 + 2] = 255; orm[i * 3] = 255; orm[i * 3 + 1] = 230; orm[i * 3 + 2] = 0; }
function blurMasked(L, mask, w, h, sig) { // normalised gaussian (separable via sharp on float? do box approx x3 in JS)
  const R = Math.max(1, Math.round(sig * 1.2)); let a = L.map((v, i) => v * mask[i]), m = Float32Array.from(mask);
  const pass = (src, horiz) => { const out = new Float32Array(src.length), n = horiz ? w : h, o = horiz ? h : w; for (let j = 0; j < o; j++) { let s = 0; for (let k = 0; k < n; k++) { const idx = horiz ? j * w + k : k * w + j; s += src[idx]; if (k > 2 * R) { const ib = horiz ? j * w + k - 2 * R - 1 : (k - 2 * R - 1) * w + j; s -= src[ib]; } if (k >= 2 * R) { const ic = horiz ? j * w + k - R : (k - R) * w + j; out[ic] = s / (2 * R + 1); } } } return out; };
  for (let r = 0; r < 3; r++) { a = pass(pass(a, true), false); m = pass(pass(m, true), false); } return a.map((v, i) => m[i] > 1e-3 ? v / m[i] : 0);
}
for (const r of regions) {
  const col = await sharp(W + `ortho-${r.name}.png`).resize(r.w, r.h, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const dep = await sharp(W + `depth-${r.name}.png`).resize(r.w, r.h, { fit: 'fill', kernel: 'nearest' }).removeAlpha().raw().toBuffer();
  const N = r.w * r.h, valid = new Float32Array(N), L = new Float32Array(N), D = new Float32Array(N);
  for (let i = 0; i < N; i++) { const R = col[i * 3], G = col[i * 3 + 1], B = col[i * 3 + 2]; valid[i] = (R > 250 && G > 250 && B > 250) ? 0 : 1; L[i] = 0.3 * R + 0.59 * G + 0.11 * B; const dv = dep[i * 3 + 2] > 200 ? NaN : (dep[i * 3] + dep[i * 3 + 1] / 255) / 255 * 16; D[i] = dv; if (Number.isNaN(dv)) valid[i] = 0; }
  // de-light: gain = (target / large-radius luminance)^alpha, clamped
  const Lb = blurMasked(L, valid, r.w, r.h, 3 * r.ppm); const tgt = 190, out = Buffer.alloc(N * 3);
  const gains = []; for (let i = 0; i < N; i += 97) if (valid[i]) gains.push(Lb[i]); gains.sort((a, b) => a - b); const med = gains[gains.length >> 1] || tgt; void med;
  for (let i = 0; i < N; i++) { if (!valid[i]) { out[i * 3] = 224; out[i * 3 + 1] = 217; out[i * 3 + 2] = 202; continue; } const g = Math.min(1.9, Math.max(0.75, Math.pow(tgt / Math.max(40, Lb[i]), 0.85))); for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, col[i * 3 + c] * g); }
  // white balance towards warm plaster: scale channels so the median plaster-ish pixel becomes (226,219,204)
  const ch = [[], [], []]; for (let i = 0; i < N; i += 53) if (valid[i] && L[i] > 120) for (let c = 0; c < 3; c++) ch[c].push(out[i * 3 + c]); const medc = ch.map(a => (a.sort((x, y) => x - y), a[a.length >> 1] || 200)); const wb = [234 / medc[0], 224 / medc[1], 204 / medc[2]];
  for (let i = 0; i < N; i++) if (valid[i]) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, out[i * 3 + c] * wb[c]);
  // fill invalid with nearest valid horizontally (avoid white halo) -> already plaster colour; inpaint small holes by blur of neighbours
  // normal + AO from high-passed depth (relief finer than ~0.6 m; the coarse depth is real geometry now)
  const Dv = D.map(v => Number.isNaN(v) ? 0 : v), Db = blurMasked(Dv, valid, r.w, r.h, 0.5 * r.ppm), Db2 = blurMasked(Dv, valid, r.w, r.h, 1.0);
  const H = new Float32Array(N); for (let i = 0; i < N; i++) H[i] = valid[i] ? (Dv[i] - Db[i]) : 0; // + = recessed
  const Hs = blurMasked(H, valid, r.w, r.h, 1.0); void Db2; const k = 4.0 / (1 / r.ppm); // slope strength
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = y * r.w + x, ox = ((r.y + y) * AW + r.x + x) * 3; const a = Math.min(r.w - 1, x + 1), b = Math.max(0, x - 1), c = Math.min(r.h - 1, y + 1), d = Math.max(0, y - 1);
    const dx = (Hs[y * r.w + a] - Hs[y * r.w + b]) * 0.5 * r.ppm, dy = (Hs[c * r.w + x] - Hs[d * r.w + x]) * 0.5 * r.ppm; let nx = dx * 1.2, ny = -dy * 1.2, nzv = 1; const l = Math.hypot(nx, ny, nzv); nx /= l; ny /= l; nzv /= l; // nx: depth grows away from viewer -> surface leans toward larger depth
    nrm[ox] = 128 + 127 * (valid[i] ? -nx : 0); nrm[ox + 1] = 128 + 127 * (valid[i] ? ny : 0); nrm[ox + 2] = 128 + 127 * nzv;
    const ao = valid[i] ? Math.max(0.35, 1 - Math.max(0, H[i]) * 1.8) : 1; orm[ox] = 255 * ao; orm[ox + 1] = 225; orm[ox + 2] = 0;
    alb[ox] = out[i * 3]; alb[ox + 1] = out[i * 3 + 1]; alb[ox + 2] = out[i * 3 + 2]; }
  if (r.name !== 'sw') for (const [bx0, by0, bx1, by1] of [[445, 795, 612, 1195], [1352, 795, 1522, 1195]]) { // temporary advertising banners hang on the front piers: paint them out (neighbouring plaster, blended, vertically smoothed so no row streaks)
    const k = r.w / 2000, x0 = Math.round(bx0 * k), x1 = Math.round(bx1 * k), y0 = Math.round(by0 * k), y1 = Math.round(by1 * k), Ls = [], Rs = [];
    for (let y = y0; y <= y1; y++) { const L = [0, 0, 0], Rr = [0, 0, 0]; for (let c = 0; c < 3; c++) for (let d = 2; d < 9; d++) { L[c] += alb[((r.y + y) * AW + r.x + x0 - d) * 3 + c] / 7; Rr[c] += alb[((r.y + y) * AW + r.x + x1 + d) * 3 + c] / 7; } Ls.push(L); Rs.push(Rr); }
    const sm = (A, i) => { const o = [0, 0, 0]; let n = 0; for (let j = Math.max(0, i - 40); j <= Math.min(A.length - 1, i + 40); j++) { n++; for (let c = 0; c < 3; c++) o[c] += A[j][c]; } return o.map(v => v / n); };
    for (let y = y0; y <= y1; y++) { const L = sm(Ls, y - y0), Rr = sm(Rs, y - y0);
      for (let x = x0; x <= x1; x++) { const t = (x - x0) / (x1 - x0), o = ((r.y + y) * AW + r.x + x) * 3; for (let c = 0; c < 3; c++) alb[o + c] = [222, 216, 202][c] * (0.97 + 0.03 * Math.sin(x * 0.9 + y * 0.4)) + 0 * (L[c] * (1 - t) + Rr[c] * t); nrm[o] = 128; nrm[o + 1] = 128; nrm[o + 2] = 255; orm[o] = 255; } } }
  console.log('region', r.name, 'valid', (valid.reduce((a, b) => a + b, 0) / N * 100).toFixed(0) + '%');
}
// flat swatches strip at y=1480..1520: 8 tones, 256 px wide each (u in [0,1] mapped: tone t centre at (t+0.5)/8*0.5 ... see gen.js swU)
const tones = [[226, 219, 204], [240, 236, 226], [172, 166, 156], [124, 146, 132], [60, 70, 84], [110, 112, 116], [214, 208, 196], [88, 62, 46]];
tones.forEach((c, t) => { for (let y = 1440; y < 1536; y++) for (let x = Math.round(t * 128); x < Math.round((t + 1) * 128); x++) { const o = (y * AW + x) * 3; alb[o] = c[0]; alb[o + 1] = c[1]; alb[o + 2] = c[2]; } });
await sharp(alb, { raw: { width: AW, height: AH, channels: 3 } }).png().toFile(T + 'atlas-albedo.png'); await sharp(nrm, { raw: { width: AW, height: AH, channels: 3 } }).png().toFile(T + 'atlas-normal.png'); await sharp(orm, { raw: { width: AW, height: AH, channels: 3 } }).png().toFile(T + 'atlas-orm.png');
// synthetic textures: roof (standing seams, green-grey patina), glass 8x1 (+ emissive), palette 8x1
const rf = Buffer.alloc(256 * 256 * 3); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const seam = (x % 32 < 2) ? 0.78 : 1, n = 0.94 + 0.06 * Math.sin(x * 0.7 + y * 0.31) * Math.cos(y * 0.13); const j = (y % 128 < 2) ? 0.9 : 1; const o = (y * 256 + x) * 3; rf[o] = 118 * seam * n * j; rf[o + 1] = 142 * seam * n * j; rf[o + 2] = 128 * seam * n * j; }
await sharp(rf, { raw: { width: 256, height: 256, channels: 3 } }).png().toFile(T + 'roof.png');
const gl = Buffer.alloc(8 * 3), em = Buffer.alloc(8 * 3); for (let t = 0; t < 8; t++) { const base = [[78, 92, 108], [68, 82, 100], [86, 98, 112], [60, 74, 92]][t % 4]; gl.set(base, t * 3); if (t >= 4) em.set([255, 190 + (t - 4) * 12, 120 + (t - 4) * 20], t * 3); else em.set([0, 0, 0], t * 3); }
await sharp(gl, { raw: { width: 8, height: 1, channels: 3 } }).png().toFile(T + 'glass.png'); await sharp(em, { raw: { width: 8, height: 1, channels: 3 } }).png().toFile(T + 'glass-emissive.png');
const pal = Buffer.alloc(8 * 3); tones.forEach((c, t) => pal.set(c, t * 3)); await sharp(pal, { raw: { width: 8, height: 1, channels: 3 } }).png().toFile(T + 'palette.png');
console.log('atlas done');
