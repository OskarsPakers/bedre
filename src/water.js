// Water routes: a centre-line through each large water polygon (distance-transform ridge, longest path), used by boats / swans.
import { cleanRing, bbox, pointInPoly } from './geo.js';

export function waterRoutes(data, { minArea = 4000, cell = 5 } = {}) {
  if (data._routes) return data._routes;
  const out = [];
  for (const w of data.water || []) {
    const ring = w._r || (w._r = cleanRing(w.p));
    if (ring.length < 3) continue;
    const b = bbox(ring);
    const bw = b.x1 - b.x0, bh = b.z1 - b.z0;
    if (bw * bh < minArea) continue;
    const c = Math.max(cell, Math.sqrt((bw * bh) / 90000)); // cap grid size at ~90k cells
    const nx = Math.ceil(bw / c) + 2, nz = Math.ceil(bh / c) + 2;
    const inside = new Uint8Array(nx * nz);
    const holes = (w.h || []).map(cleanRing).filter((h) => h.length >= 3);
    let count = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const qx = b.x0 + (i - 0.5) * c, qz = b.z0 + (j - 0.5) * c;
      if (pointInPoly(qx, qz, ring) && !holes.some((h) => pointInPoly(qx, qz, h))) { inside[j * nx + i] = 1; count++; }
    }
    if (count < 40) continue;
    // chamfer distance transform (in cells)
    const d = new Float32Array(nx * nz);
    for (let k = 0; k < d.length; k++) d[k] = inside[k] ? 1e6 : 0;
    const R = 1, D = 1.4142;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!d[k]) continue;
      if (i > 0) d[k] = Math.min(d[k], d[k - 1] + R);
      if (j > 0) { d[k] = Math.min(d[k], d[k - nx] + R); if (i > 0) d[k] = Math.min(d[k], d[k - nx - 1] + D); if (i < nx - 1) d[k] = Math.min(d[k], d[k - nx + 1] + D); }
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; if (!d[k]) continue;
      if (i < nx - 1) d[k] = Math.min(d[k], d[k + 1] + R);
      if (j < nz - 1) { d[k] = Math.min(d[k], d[k + nx] + R); if (i < nx - 1) d[k] = Math.min(d[k], d[k + nx + 1] + D); if (i > 0) d[k] = Math.min(d[k], d[k + nx - 1] + D); }
    }
    let maxD = 0, maxK = 0;
    for (let k = 0; k < d.length; k++) if (d[k] > maxD) { maxD = d[k]; maxK = k; }
    const thr = Math.max(2, maxD * 0.55);
    const ok = (k) => d[k] >= thr;
    // BFS helper over ridge cells
    const bfs = (start) => {
      const dist = new Int32Array(nx * nz).fill(-1), par = new Int32Array(nx * nz).fill(-1);
      const q = [start]; dist[start] = 0;
      let last = start;
      for (let h = 0; h < q.length; h++) {
        const k = q[h]; last = k;
        const i = k % nx, j = (k / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const kk = jj * nx + ii;
          if (dist[kk] >= 0 || !ok(kk)) continue;
          dist[kk] = dist[k] + 1; par[kk] = k; q.push(kk);
        }
      }
      return { last, par, n: q.length };
    };
    const a = bfs(maxK), bb2 = bfs(a.last);
    if (bb2.n < 12) continue;
    const cells = [];
    for (let k = bb2.last; k >= 0; k = bb2.par[k]) cells.push(k);
    const pts = [];
    for (let n = 0; n < cells.length; n += 3) {
      const k = cells[n];
      pts.push([b.x0 + ((k % nx) - 0.5) * c, b.z0 + (((k / nx) | 0) - 0.5) * c]);
    }
    const lk = cells[cells.length - 1];
    pts.push([b.x0 + ((lk % nx) - 0.5) * c, b.z0 + (((lk / nx) | 0) - 0.5) * c]);
    // light smoothing
    for (let it = 0; it < 2; it++) for (let i = 1; i < pts.length - 1; i++) {
      pts[i] = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4];
    }
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (L < 80) continue;
    out.push({ p: pts, w: maxD * c * 2, k: 'water', L, canal: maxD * c < 22 });
  }
  data._routes = out;
  return out;
}
