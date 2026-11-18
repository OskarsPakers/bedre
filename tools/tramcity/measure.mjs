#!/usr/bin/env node
// MEASURE facades of the corridor buildings from the rectified facade images (intermediates, 10 cm/px, tools/.cache/sampling/rect/<id>_<run>.png, made by tools/sampling/measure2.html
// from the cached city reality mesh; never shipped).  Output: derived parameters only (numbers) -> tools/.cache/tramcity/facades-raw.json
//   per facade run: floor rows (top / bottom above the ground, metres), window columns (centre u along the run + width), presence bitmask rows x columns, ground-band kind + height,
//   facade wall colour (sunlit, pavement-normalised).   node tools/tramcity/measure.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import sharp from 'sharp';
const meta = JSON.parse(fs.readFileSync('tools/.cache/sampling/meta-centrs.json', 'utf8')).buildings;
const cor = new Set(JSON.parse(zlib.gunzipSync(fs.readFileSync('public/data/tram/corridor-centrs.json.gz'))).ids);
const out = {}; let nRun = 0, nOk = 0;
const smooth = (a, k) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) { s += a[j]; n++; } return s / n; });
const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

async function measureRun(file, run) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, px = run.len / w, H = run.H;
  const valid = new Uint8Array(w * h), G = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { valid[i] = data[i * 4 + 3] > 128 ? 1 : 0; G[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; }
  let rmin = h, rmax = -1; const rv = new Float32Array(h);
  for (let r = 0; r < h; r++) { let n = 0; for (let c = 0; c < w; c++) n += valid[r * w + c]; rv[r] = n / w; if (rv[r] > 0.3) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); } }
  if (rmax - rmin < 45 || w < 40) return null;
  let vt = 0; for (let r = rmin; r <= rmax; r++) vt += rv[r]; const coverFrac = vt / (rmax - rmin + 1); if (coverFrac < 0.6) return null;
  // local contrast: darkness against the box mean (integral image of luminance over valid pixels)
  const I = new Float64Array((w + 1) * (h + 1)), Nn = new Float64Array((w + 1) * (h + 1));
  for (let r = 0; r < h; r++) { let rs = 0, rn = 0; for (let c = 0; c < w; c++) { rs += valid[r * w + c] ? G[r * w + c] : 0; rn += valid[r * w + c]; I[(r + 1) * (w + 1) + c + 1] = I[r * (w + 1) + c + 1] + rs; Nn[(r + 1) * (w + 1) + c + 1] = Nn[r * (w + 1) + c + 1] + rn; } }
  const K = 14, O = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { if (!valid[r * w + c]) continue; const r0 = Math.max(0, r - K), r1 = Math.min(h, r + K + 1), c0 = Math.max(0, c - K), c1 = Math.min(w, c + K + 1);
    const n = Nn[r1 * (w + 1) + c1] - Nn[r0 * (w + 1) + c1] - Nn[r1 * (w + 1) + c0] + Nn[r0 * (w + 1) + c0]; const sm = I[r1 * (w + 1) + c1] - I[r0 * (w + 1) + c1] - I[r1 * (w + 1) + c0] + I[r0 * (w + 1) + c0]; O[r * w + c] = n > 30 && G[r * w + c] < (sm / n) * 0.86 ? 1 : 0; }
  const Pr = new Array(h).fill(0); for (let r = 0; r < h; r++) { let n = 0, v = 0; for (let c = 0; c < w; c++) { n += O[r * w + c]; v += valid[r * w + c]; } Pr[r] = v > w * 0.35 ? n / v : 0; }
  const Ps = smooth(Pr, 2);
  // floor period: autocorrelation of the row profile over the wall rows, lags 2.6..4.8 m
  const lo = Math.round(2.6 / px), hi = Math.round(4.8 / px); const seg = Ps.slice(rmin, rmax + 1), mean = seg.reduce((a, b) => a + b, 0) / seg.length;
  let bestLag = 0, bestAc = -1; const acf = [];
  for (let lag = lo; lag <= hi; lag++) { let a = 0, n = 0; for (let r = 0; r + lag < seg.length; r++) { a += (seg[r] - mean) * (seg[r + lag] - mean); n++; } acf[lag] = n ? a / n : 0; }
  let v0 = 0; for (const x of seg) v0 += (x - mean) ** 2; v0 /= seg.length || 1;
  for (let lag = lo; lag <= hi; lag++) { const q = acf[lag] / (v0 || 1); if (q > bestAc && acf[lag] >= (acf[lag - 1] ?? -1e9) && acf[lag] >= (acf[lag + 1] ?? -1e9)) { bestAc = q; bestLag = lag; } }
  if (bestLag === 0 || bestAc < 0.12) return null;
  const per = bestLag; let bestPh = 0, bestSc = -1;
  for (let ph = 0; ph < per; ph++) { let sc = 0, n = 0; for (let r = rmax - ph; r > rmin; r -= per) { sc += Ps[r]; n++; } sc /= n || 1; if (sc > bestSc) { bestSc = sc; bestPh = ph; } }
  // floor centres from the bottom of the wall upwards
  const centres = []; for (let r = rmax - bestPh; r > rmin + per * 0.35; r -= per) centres.push(r);
  const pmax = Math.max(...centres.map((r) => Ps[r])); const floors = [];
  for (const rc of centres.slice().reverse()) {
    if (Ps[rc] < Math.max(0.05, pmax * 0.3)) { if (floors.length) floors.push({ skip: true }); continue; }
    let a = rc, b = rc; while (a > rmin && Ps[a - 1] > Ps[rc] * 0.5 && rc - a < per * 0.5) a--; while (b < rmax && Ps[b + 1] > Ps[rc] * 0.5 && b - rc < per * 0.5) b++;
    const cols = []; const Cc = new Array(w).fill(0);
    for (let c = 0; c < w; c++) { let n = 0, v = 0; for (let r = a; r <= b; r++) { n += O[r * w + c]; v += valid[r * w + c]; } Cc[c] = v > (b - a + 1) * 0.5 ? n / v : -1; }
    const Cs = smooth(Cc.map((x) => (x < 0 ? 0 : x)), 2); const cmx = Math.max(0.05, ...Cs);
    for (let c = 2; c < w - 2; c++) if (Cs[c] > cmx * 0.45 && Cs[c] >= Cs[c - 1] && Cs[c] >= Cs[c + 1] && Cs[c] > Cs[c - 2] && Cs[c] >= Cs[c + 2]) {
      const half = Cs[c] * 0.5; let l = c, rr = c; while (l > 0 && Cs[l] > half) l--; while (rr < w - 1 && Cs[rr] > half) rr++;
      const last = cols[cols.length - 1]; if (last && (c * px - last.u) < 1.3) { if (Cs[c] > last.s) { last.u = c * px; last.w = (rr - l) * px; last.s = Cs[c]; } continue; }
      cols.push({ u: c * px, w: (rr - l) * px, s: Cs[c] });
    }
    let vv = 0, tt = 0; for (let r = a; r <= b; r++) for (let c = 0; c < w; c++) { vv += valid[r * w + c]; tt++; }
    floors.push({ top: H - a * px, bot: H - (b + 1) * px, cols: cols.map((q) => [q.u - q.w / 2, q.u + q.w / 2]), cover: vv / tt, openness: Ps[rc] });
  }
  return { len: run.len, H, nBands: floors.length, floors: floors.filter((f) => !f.skip), per: per * px, ac: bestAc, rminM: 0, rmaxM: 0, px, coverFrac, rows: { rmin, rmax, h } };
}

// colour of the facade: sunlit wall pixels (not openings), pavement-normalised
async function colourRun(file, run) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, px = run.len / w; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const S = []; for (let r = 0; r < h; r += 2) for (let c = 0; c < w; c += 2) { const i = (r * w + c) * 4; if (data[i + 3] < 128) continue; S.push([lin(data[i]), lin(data[i + 1]), lin(data[i + 2])]); }
  if (S.length < 300) return null;
  const L = S.map((p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]); const idx = L.map((_, i) => i).sort((a, b) => L[a] - L[b]);
  const m = med(L); const wall = idx.filter((i) => L[i] >= m * 0.95 && L[i] <= m * 1.9 || (L[i] >= m && L[i] <= L[idx[Math.floor(idx.length * 0.92)]])); // lit wall, not the darkest openings, not specular glints
  const sel = wall.slice(Math.floor(wall.length * 0.2), Math.floor(wall.length * 0.85)); if (sel.length < 80) return null;
  const c = [0, 1, 2].map((k) => sel.reduce((a, i) => a + S[i][k], 0) / sel.length);
  return c;
}

let k = 0;
for (const b of meta) {
  if (!cor.has(b.id)) continue;
  const rec = [];
  for (const run of b.runs) {
    if (run.w == null || run.cover == null || run.cover < 0.3 || run.len < 3.5) continue;
    const f = `tools/.cache/sampling/rect/${b.id}_${run.i}.png`; if (!fs.existsSync(f)) continue;
    nRun++;
    try {
      const m = await measureRun(f, run); const col = m || run.cover > 0.55 ? await colourRun(f, run) : null;
      const e = { i: run.i, a: run.a.map((v) => Math.round(v * 100) / 100), b: run.b.map((v) => Math.round(v * 100) / 100), n: run.n.map((v) => Math.round(v * 1000) / 1000), len: Math.round(run.len * 100) / 100, g: run.g, pave: run.paveHi || run.pave || null, cover: Math.round(run.cover * 100) / 100 };
      if (m) { e.m = m; nOk++; }
      if (col) e.col = col;
      if (m || col) rec.push(e);
    } catch (e) { /* unreadable image */ }
  }
  if (rec.length) out[b.id] = { h: b.h, runs: rec };
  if (++k % 50 === 0) console.log(k, 'buildings', nRun, 'runs', nOk, 'measured');
}
fs.writeFileSync('tools/.cache/tramcity/facades-raw.json', JSON.stringify(out));
console.log('done: buildings', Object.keys(out).length, 'runs', nRun, 'with floors/windows', nOk);
