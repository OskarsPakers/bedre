// V2: fit "stacked prisms + roof primitives" to a height grid (heights above ground, NaN outside the footprint).
//
// Algorithm (per building):
//  1. greedy 1-D banding of cell heights into plateau levels (tolerance tol = max(1, 4 % of max height));
//  2. recursive layer-cake: the component (outline = outer contour of connected cells whose band >= b) becomes a prism;
//     before descending we try to explain ALL cells of the component by one roof primitive on its outline
//     (flat, gabled, hipped, skillion, pyramid, cone, dome) measured against the raw grid; if the RMS error is low the
//     primitive is accepted and recursion stops there, else the prism is capped flat at its band and the child
//     components (band >= b+1) are processed on top of it;
//  3. contours are simplified (Douglas-Peucker 0.5 m); holes are ignored (courtyards inside a footprint are rare:
//     the cadastre footprints are single rings).
// Output parts: [{p:[[x,z]..], y0, y1, roof:{shape,h,dir}}]  (metres above ground / game-local x,z)
import { polyArea, centroidOf } from './shape.mjs';
import { pip } from './dsm.mjs';

const r1 = (v) => Math.round(v * 10) / 10;

function bandLevels(values, tol) {
  const s = Float64Array.from(values).sort();
  const levels = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] <= s[i] + tol) j++;
    levels.push({ lo: s[i], hi: s[j - 1], med: s[i + Math.floor((j - i) / 2)] });
    i = j;
  }
  return levels;
}

function label(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  let n = 0;
  const comps = [];
  for (let k0 = 0; k0 < mask.length; k0++) {
    if (!mask[k0] || lab[k0] >= 0) continue;
    const stack = [k0], cells = [];
    lab[k0] = n;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const i = k % w, j = (k / w) | 0;
      if (i > 0 && mask[k - 1] && lab[k - 1] < 0) { lab[k - 1] = n; stack.push(k - 1); }
      if (i < w - 1 && mask[k + 1] && lab[k + 1] < 0) { lab[k + 1] = n; stack.push(k + 1); }
      if (j > 0 && mask[k - w] && lab[k - w] < 0) { lab[k - w] = n; stack.push(k - w); }
      if (j < h - 1 && mask[k + w] && lab[k + w] < 0) { lab[k + w] = n; stack.push(k + w); }
    }
    comps.push(cells);
    n++;
  }
  return comps;
}

/** outer contour (largest positive loop) of a set of cells, as vertex grid points [i,j]; region on the right-hand side */
function outerLoop(cells, w, h) {
  const inC = new Uint8Array(w * h);
  for (const k of cells) inC[k] = 1;
  const has = (i, j) => i >= 0 && j >= 0 && i < w && j < h && inC[j * w + i];
  const next = new Map(); // "i,j" -> list of [i2,j2]
  const addE = (a, b) => { const key = a[0] + ',' + a[1]; if (!next.has(key)) next.set(key, []); next.get(key).push(b); };
  for (const k of cells) {
    const i = k % w, j = (k / w) | 0;
    // clockwise (in i right / j down coordinates) around the cell boundary where the neighbour is empty
    if (!has(i, j - 1)) addE([i, j], [i + 1, j]);
    if (!has(i + 1, j)) addE([i + 1, j], [i + 1, j + 1]);
    if (!has(i, j + 1)) addE([i + 1, j + 1], [i, j + 1]);
    if (!has(i - 1, j)) addE([i, j + 1], [i, j]);
  }
  const loops = [];
  while (next.size) {
    const [key] = next.keys();
    let cur = key.split(',').map(Number);
    const start = cur;
    const loop = [start];
    let prevDir = null;
    for (let guard = 0; guard < 200000; guard++) {
      const k = cur[0] + ',' + cur[1];
      const outs = next.get(k);
      if (!outs || !outs.length) break;
      let pick = 0;
      if (outs.length > 1 && prevDir) { // prefer turning right (keeps the 4-connected region together)
        let best = -9;
        outs.forEach((o, ix) => {
          const d = [o[0] - cur[0], o[1] - cur[1]];
          const cr = prevDir[0] * d[1] - prevDir[1] * d[0];
          if (cr > best) { best = cr; pick = ix; }
        });
      }
      const nx = outs.splice(pick, 1)[0];
      if (!outs.length) next.delete(k);
      prevDir = [nx[0] - cur[0], nx[1] - cur[1]];
      cur = nx;
      if (cur[0] === start[0] && cur[1] === start[1]) break;
      loop.push(cur);
    }
    loops.push(loop);
  }
  // clockwise in (i right, j down) == positive shoelace sum; pick the loop with the largest |area| and positive sign
  let best = null, ba = 0;
  for (const l of loops) {
    const a = polyArea(l);
    if (a > ba) { ba = a; best = l; }
  }
  return best;
}

function dp(pts, eps) {
  const n = pts.length;
  if (n < 5) return pts;
  // closed ring: split at the two farthest apart-ish points
  let a = 0, b = 0, dm = -1;
  for (let i = 1; i < n; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > dm) { dm = d; b = i; } }
  const keep = new Uint8Array(n);
  keep[a] = keep[b] = 1;
  const rec = (s, e) => {
    if (e - s < 2) return;
    let md = 0, mi = -1;
    const A = pts[s % n], B = pts[e % n];
    const dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1e-9;
    for (let i = s + 1; i < e; i++) {
      const P = pts[i % n];
      const d = Math.abs((P[0] - A[0]) * dz - (P[1] - A[1]) * dx) / l;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi % n] = 1; rec(s, mi); rec(mi, e); }
  };
  rec(a, b);
  rec(b, a + n);
  return pts.filter((_, i) => keep[i]);
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** minimum-area rectangle of a convex hull: {ang (long axis, rad), a (half length along), b (half width across)} */
function minRect(hp) {
  let best = null;
  for (let i = 0; i < hp.length; i++) {
    const p = hp[i], q = hp[(i + 1) % hp.length];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const r of hp) { const u = r[0] * c + r[1] * s, v = -r[0] * s + r[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ang, a: (u1 - u0) / 2, b: (v1 - v0) / 2, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2 };
  }
  if (best.b > best.a) { best.ang += Math.PI / 2; [best.a, best.b] = [best.b, best.a]; }
  return best;
}

/** Try roof primitives for the cells (indices into grid) on `outline` (world coords). Returns best {shape,h,dir,rms} + flat rms. */
function fitRoof(g, cells, outline, E) {
  const { w, cell } = g;
  const hp = hull(outline);
  if (hp.length < 3) return null;
  const [cx, cz] = centroidOf(hp);
  const harea = Math.abs(polyArea(hp));
  const pts = cells.map((k) => ({ x: g.x0 + ((k % w) + 0.5) * cell, z: g.z0 + (((k / w) | 0) + 0.5) * cell, r: Math.max(0, g.cells[k] - E) }));
  const n = pts.length;
  let flat = 0, rmax = 0;
  for (const p of pts) { flat += p.r * p.r; rmax = Math.max(rmax, p.r); }
  const rmsFlat = Math.sqrt(flat / n);
  const out = { flat: rmsFlat, rmax, best: null };
  if (rmax < 1.2 || harea < 2) return out;
  const cands = [];
  const lsq = (fn) => { // robust least-squares scale h for f in [0,1]: one trimming pass drops outliers (chimneys, dormers, trees)
    const fv = pts.map(fn);
    const solve = (use) => {
      let sf = 0, sff = 0;
      for (let i = 0; i < n; i++) if (use[i]) { sf += pts[i].r * fv[i]; sff += fv[i] * fv[i]; }
      const h = sff > 1e-9 ? sf / sff : 0;
      let e = 0, c = 0;
      for (let i = 0; i < n; i++) if (use[i]) { const d = pts[i].r - h * fv[i]; e += d * d; c++; }
      return { h, rms: Math.sqrt(e / Math.max(1, c)) };
    };
    const all = new Uint8Array(n).fill(1);
    let r = solve(all);
    const thr = Math.max(1.2, 2 * r.rms);
    const use = new Uint8Array(n);
    let kept = 0;
    for (let i = 0; i < n; i++) if (Math.abs(pts[i].r - r.h * fv[i]) <= thr) { use[i] = 1; kept++; }
    r = solve(use);
    return { ...r, inl: kept / n };
  };
  // pyramid: convex polygon gauge
  const pn = hp.map((q, i) => {
    const r = hp[(i + 1) % hp.length];
    const dx = r[0] - q[0], dz = r[1] - q[1], l = Math.hypot(dx, dz) || 1e-9;
    let nx = dz / l, nz = -dx / l;
    let d = (q[0] - cx) * nx + (q[1] - cz) * nz;
    if (d < 0) { nx = -nx; nz = -nz; d = -d; }
    return [nx, nz, Math.max(d, 1e-3)];
  });
  const gauge = (p) => { let m = 0; for (const [nx, nz, d] of pn) m = Math.max(m, ((p.x - cx) * nx + (p.z - cz) * nz) / d); return m; };
  const R = Math.sqrt(harea / Math.PI);
  cands.push({ shape: 'pyramid', ...lsq((p) => Math.max(0, 1 - gauge(p))) });
  cands.push({ shape: 'cone', ...lsq((p) => Math.max(0, 1 - Math.hypot(p.x - cx, p.z - cz) / R)) });
  cands.push({ shape: 'dome', ...lsq((p) => Math.sqrt(Math.max(0, 1 - (Math.hypot(p.x - cx, p.z - cz) / R) ** 2))) });
  // planar roofs in the min-rect frame
  const mr = minRect(hp);
  const c = Math.cos(mr.ang), s = Math.sin(mr.ang);
  const uv = (p) => { const u = p.x * c + p.z * s - (cx * c + cz * s), v = -p.x * s + p.z * c - (-cx * s + cz * c); return [u, v]; };
  const a = Math.max(mr.a, 0.1), b = Math.max(mr.b, 0.1);
  const dirDeg = ((mr.ang * 180) / Math.PI + 360) % 180;
  // gabled: ridge along the long axis (u), slope across (v)
  cands.push({ shape: 'gabled', dir: dirDeg, ...lsq((p) => { const [, v] = uv(p); return Math.max(0, 1 - Math.abs(v) / b); }) });
  cands.push({ shape: 'hipped', dir: dirDeg, ...lsq((p) => { const [u, v] = uv(p); return Math.max(0, Math.min(1 - Math.abs(v) / b, (a - Math.abs(u)) / b)); }) });
  for (const sg of [1, -1]) cands.push({ shape: 'skillion', dir: (dirDeg + (sg > 0 ? 0 : 180)) % 360, ...lsq((p) => { const [, v] = uv(p); return Math.max(0, Math.min(1, (sg * v) / (2 * b) + 0.5)); }) });
  cands.sort((x, y) => x.rms - y.rms);
  out.best = cands[0];
  return out;
}

/** main entry. g = {x0,z0,cell,w,h,cells}; footprint = ring [[x,z]] (used for the base outline when the grid is clipped) */
export function fitParts(g, { minArea = 1.5, maxParts = 40, eps = 0.5 } = {}) {
  const { w, h, cell } = g;
  const vals = [];
  for (const v of g.cells) if (!Number.isNaN(v)) vals.push(v);
  if (!vals.length) return [];
  const maxH = Math.max(...vals);
  const tol = Math.max(1.0, 0.04 * maxH);
  const levels = bandLevels(vals, tol);
  const levelOf = (v) => { let lo = 0, hi = levels.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (v > levels[m].hi) lo = m + 1; else hi = m; } return lo; };
  const q = new Int16Array(w * h).fill(-1);
  for (let k = 0; k < q.length; k++) if (!Number.isNaN(g.cells[k])) q[k] = levelOf(g.cells[k]);
  const parts = [];
  const X = (i) => g.x0 + i * cell, Z = (j) => g.z0 + j * cell;
  const toWorld = (loop) => dp(loop.map(([i, j]) => [X(i), Z(j)]), eps).map(([x, z]) => [r1(x), r1(z)]);

  const process = (b, cells, y0, depth) => {
    if (parts.length >= maxParts) return;
    const loop = outerLoop(cells, w, h);
    if (!loop) return;
    let outline = toWorld(loop);
    if (outline.length < 3) return;
    const area = Math.abs(polyArea(outline));
    if (area < minArea && b > 0) return;
    // eave level = median raw height on the component boundary
    const inC = new Uint8Array(w * h);
    for (const k of cells) inC[k] = 1;
    const bh = [];
    for (const k of cells) {
      const i = k % w, j = (k / w) | 0;
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1 || !inC[k - 1] || !inC[k + 1] || !inC[k - w] || !inC[k + w]) bh.push(g.cells[k]);
    }
    bh.sort((p, r) => p - r);
    const E = Math.max(y0, bh.length ? bh[bh.length >> 1] : y0);
    const fit = fitRoof(g, cells, outline, E);
    const lvl = levels[b];
    const topLevel = lvl.med;
    // accept a primitive?
    if (fit && fit.best) {
      const f = fit.best;
      const tolRms = Math.max(0.7, 0.15 * f.h);
      if (fit.rmax < 1.2 || fit.flat <= 0.6) {
        parts.push({ p: outline, y0: r1(y0), y1: r1(E), roof: { shape: 'flat', h: 0 } });
        return;
      }
      if (f.h >= 1.2 && f.rms <= tolRms && f.rms < 0.7 * fit.flat && f.inl >= 0.85) {
        const roof = { shape: f.shape, h: r1(f.h) };
        if (f.dir != null) roof.dir = Math.round(f.dir);
        parts.push({ p: outline, y0: r1(y0), y1: r1(E), roof });
        return;
      }
    }
    // otherwise: cap this band flat and descend
    const y1 = Math.max(y0 + 0.3, Math.min(topLevel, E));
    parts.push({ p: outline, y0: r1(y0), y1: r1(y1), roof: { shape: 'flat', h: 0 } });
    if (b + 1 >= levels.length) return;
    const mask = new Uint8Array(w * h);
    for (const k of cells) if (q[k] >= b + 1) mask[k] = 1;
    for (const comp of label(mask, w, h)) process(b + 1, comp, y1, depth + 1);
  };

  const all = new Uint8Array(w * h);
  for (let k = 0; k < all.length; k++) if (q[k] >= 0) all[k] = 1;
  for (const comp of label(all, w, h)) process(0, comp, 0, 0);
  return parts;
}

export function partsError(g, parts) {
  // rasterise the fitted parts back to heights and compare with the grid: returns {rms, p95, bias}
  const { w, h, cell } = g;
  const hp = new Float32Array(w * h).fill(NaN);
  const heightAt = (part, x, z) => {
    const { p, y1, roof } = part;
    if (!pip(x, z, p)) return NaN;
    if (!roof || roof.shape === 'flat' || !roof.h) return y1;
    const [cx, cz] = centroidOf(p);
    let hh = 0;
    const hpts = hull(p);
    if (roof.shape === 'pyramid' || roof.shape === 'cone' || roof.shape === 'dome') {
      const R = Math.sqrt(Math.abs(polyArea(hpts)) / Math.PI);
      if (roof.shape === 'pyramid') {
        let m = 0;
        for (let i = 0; i < hpts.length; i++) {
          const q0 = hpts[i], r = hpts[(i + 1) % hpts.length];
          const dx = r[0] - q0[0], dz = r[1] - q0[1], l = Math.hypot(dx, dz) || 1e-9;
          let nx = dz / l, nz = -dx / l, d = (q0[0] - cx) * nx + (q0[1] - cz) * nz;
          if (d < 0) { nx = -nx; nz = -nz; d = -d; }
          m = Math.max(m, ((x - cx) * nx + (z - cz) * nz) / Math.max(d, 1e-3));
        }
        hh = Math.max(0, 1 - m);
      } else {
        const rr = Math.hypot(x - cx, z - cz) / R;
        hh = roof.shape === 'cone' ? Math.max(0, 1 - rr) : Math.sqrt(Math.max(0, 1 - rr * rr));
      }
    } else {
      const mr = minRect(hpts);
      const ang = roof.dir != null && roof.shape !== 'skillion' ? (roof.dir * Math.PI) / 180 : mr.ang;
      const c = Math.cos(ang), s = Math.sin(ang);
      const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
      const a = Math.max(mr.a, 0.1), b = Math.max(mr.b, 0.1);
      if (roof.shape === 'gabled') hh = Math.max(0, 1 - Math.abs(v) / b);
      else if (roof.shape === 'hipped') hh = Math.max(0, Math.min(1 - Math.abs(v) / b, (a - Math.abs(u)) / b));
      else {
        const sg = roof.dir != null && Math.abs(((roof.dir - (mr.ang * 180) / Math.PI) % 360 + 360) % 360 - 180) < 90 ? -1 : 1;
        hh = Math.max(0, Math.min(1, (sg * v) / (2 * b) + 0.5));
      }
    }
    return y1 + roof.h * hh;
  };
  let se = 0, n = 0, bias = 0;
  const errs = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = g.cells[j * w + i];
    if (Number.isNaN(v)) continue;
    const x = g.x0 + (i + 0.5) * cell, z = g.z0 + (j + 0.5) * cell;
    let top = 0;
    for (const part of parts) { const t = heightAt(part, x, z); if (t > top) top = t; }
    const e = top - v;
    se += e * e; bias += e; n++; errs.push(Math.abs(e));
  }
  errs.sort((a, b) => a - b);
  return { rms: Math.sqrt(se / n), bias: bias / n, p95: errs[Math.floor(errs.length * 0.95)] };
}
