// Candidate missing buildings: mesh volumes (>=4 m above local ground, smooth, >=60 m2) with no game footprint -> tools/.cache/qa-map/missing-<map>.json
import fs from 'node:fs'; import path from 'node:path';
import { loadMap, loadDsm, loadGround, dtm, roughness, pip, QC } from './lib.mjs';
const slug = process.argv[2] || 'centrs';
const M = loadMap(slug), dsm = loadDsm(slug), DT = dtm(dsm, 44, true), RG = roughness(dsm), G = await loadGround(slug);
const { w, h, x0, z0, d } = dsm; const b = M.bounds;
const N = w * h;
// footprint mask
const bld = new Uint8Array(N);
for (const g of M.game) {
  if (!g.ring.length) continue; let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of g.ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); }
  for (let j = Math.floor(c - z0); j <= Math.ceil(f - z0); j++) for (let i = Math.floor(a - x0); i <= Math.ceil(e - x0); i++) { if (i < 0 || j < 0 || i >= w || j >= h) continue; if (pip(x0 + i + .5, z0 + j + .5, g.ring)) bld[j * w + i] = 1; }
}
const dil = (src, r) => { const t = new Uint8Array(N), o = new Uint8Array(N); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (!src[j * w + i]) continue; for (let q = -r; q <= r; q++) { const ii = i + q; if (ii >= 0 && ii < w) t[j * w + ii] = 1; } } for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (!t[j * w + i]) continue; for (let q = -r; q <= r; q++) { const jj = j + q; if (jj >= 0 && jj < h) o[jj * w + i] = 1; } } return o; };
const ero = (src, r) => { const inv = new Uint8Array(N); for (let k = 0; k < N; k++) inv[k] = src[k] ? 0 : 1; const o = dil(inv, r); for (let k = 0; k < N; k++) o[k] = o[k] ? 0 : 1; return o; };
const bldD = dil(bld, 3);
// exclusion polygons: bridges, piers, brg areas
const excl = new Uint8Array(N);
const paintPoly = (ring) => { let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); } for (let j = Math.floor(c - z0); j <= Math.ceil(f - z0); j++) for (let i = Math.floor(a - x0); i <= Math.ceil(e - x0); i++) { if (i < 0 || j < 0 || i >= w || j >= h) continue; if (pip(x0 + i + .5, z0 + j + .5, ring)) excl[j * w + i] = 1; } };
for (const ar of M.city.areas) if (ar.c === 'brg' || ar.c === 'pier' || ar.c === 'rail') paintPoly(ar.p);
for (const p of M.city.piers || []) paintPoly(p.p);
for (const r of M.city.roads) if (r.br || r.k === 'rail') { // stroke polyline buffered
  const rad = (r.w || 6) / 2 + (r.k === 'rail' ? 10 : 3);
  for (let s = 0; s + 1 < r.p.length; s++) { const [ax, az] = r.p[s], [bx, bz] = r.p[s + 1]; const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 1);
    for (let t = 0; t <= n; t++) { const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n; for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { if (di * di + dj * dj > rad * rad) continue; const i = Math.floor(x - x0 + di), j = Math.floor(z - z0 + dj); if (i >= 0 && j >= 0 && i < w && j < h) excl[j * w + i] = 1; } } } }
const mask = new Uint8Array(N);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const k = j * w + i; const v = d[k]; if (v !== v) continue; const t = DT[k]; if (t !== t) continue;
  if (v - t < 4 || bldD[k] || excl[k]) continue;
  if (!(RG[k] <= 1.3)) continue;
  const gi = i - Math.round(b.minX - x0), gj = j - Math.round(b.minZ - z0);
  if (gi >= 0 && gj >= 0 && gi < G.w && gj < G.h) { const c = G.cls[gj * G.w + gi]; if (c === 6 || c === 7) continue; }
  mask[k] = 1;
}
const open = dil(ero(mask, 1), 1);
// components
const lab = new Int32Array(N); const comps = [];
for (let k0 = 0; k0 < N; k0++) { if (!open[k0] || lab[k0]) continue; const id = comps.length + 1; const st = [k0]; lab[k0] = id; const cells = [];
  while (st.length) { const k = st.pop(); cells.push(k); const i = k % w, j = (k / w) | 0; for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; const kk = jj * w + ii; if (open[kk] && !lab[kk]) { lab[kk] = id; st.push(kk); } } }
  comps.push(cells); }
const res = [];
for (const cells of comps) {
  if (cells.length < 60) continue;
  let sx = 0, sz = 0, hm = 0, hx = 0, rg = 0, mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9, can = 0;
  for (const k of cells) { const i = k % w, j = (k / w) | 0; sx += i; sz += j; const nh = d[k] - DT[k]; hm += nh; if (nh > hx) hx = nh; rg += RG[k]; mnx = Math.min(mnx, i); mxx = Math.max(mxx, i); mnz = Math.min(mnz, j); mxz = Math.max(mxz, j);
    const gi = i - Math.round(b.minX - x0), gj = j - Math.round(b.minZ - z0); if (gi >= 0 && gj >= 0 && gi < G.w && gj < G.h && G.cls[gj * G.w + gi] === 2) can++; }
  // wall test: boundary cells whose outside neighbour 3 cells away is >=3 m lower
  let bc = 0, wc = 0; for (const k of cells) { const i = k % w, j = (k / w) | 0; for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; if (open[jj * w + ii]) continue; bc++; const o = d[Math.max(0, Math.min(h - 1, j + 3 * c)) * w + Math.max(0, Math.min(w - 1, i + 3 * a))]; if (o === o ? d[k] - o >= 3 : false) wc++; } }
  const n = cells.length; const bw = mxx - mnx + 1, bh = mxz - mnz + 1;
  res.push({ x: +(x0 + sx / n + .5).toFixed(1), z: +(z0 + sz / n + .5).toFixed(1), area: n, meanH: +(hm / n).toFixed(1), maxH: +hx.toFixed(1), rough: +(rg / n).toFixed(2), wall: +(bc ? wc / bc : 0).toFixed(2), canopy: +(can / n).toFixed(2), fill: +(n / (bw * bh)).toFixed(2), bw, bh });
}
// restrict to map bounds
const inb = res.filter((r) => r.x >= b.minX && r.x <= b.maxX && r.z >= b.minZ && r.z <= b.maxZ);
fs.writeFileSync(path.join(QC, `missing-${slug}.json`), JSON.stringify(inb));
console.log(slug, 'components >=60', res.length, 'in bounds', inb.length, 'canopy<0.3', inb.filter((r) => r.canopy < 0.3).length, 'area>=150&canopy<.3', inb.filter((r) => r.area >= 150 && r.canopy < 0.3).length);
