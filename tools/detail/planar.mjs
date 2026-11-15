// Plane-fitted roofs: a denoised height grid -> clean low-poly roof (straight eaves, planar faces, straight ridges, vertical step walls, lathe domes/spires).
//
//   1. peak/lathe detection: round blobs (domes, cones, onion domes, round tower roofs) become surfaces of revolution (measured radial profile);
//   2. RANSAC plane detection on the remaining cells (tolerance ~0.35 m), residual cells joined to the nearest plane, label smoothing + small-region merge;
//   3. label-map boundaries traced as chains between junctions, simplified once (shared by both neighbours), ridge/hip/valley chains straightened onto the
//      intersection line of the two planes, junctions moved to the common point of their planes, chain ends snapped onto the outline;
//   4. constrained Delaunay triangulation of outline + chains (+ lathe base circles); components between constraints get their plane;
//   5. heights come from the planes: vertices where neighbouring planes agree are welded, elsewhere a vertical step wall is emitted (tower / drum / parapet walls).
// Returns the same structure as the old TIN mesher or null (caller falls back to the smoothed TIN).
import { mulberry32 } from '../../src/rng.js';
import { pointInPoly } from '../../src/geo.js';

// ------------------------------------------------------------------ small helpers
export function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [s, e] = st.pop();
    const [ax, az] = pts[s], [bx, bz] = pts[e];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-9;
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export function dpClosed(pts, tol) {
  const n = pts.length;
  if (n < 5) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), tol), b = dp(pts.slice(far).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
const ek = (u, v) => (u < v ? u * 262144 + v : v * 262144 + u);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** nearest point of a set of closed polylines: {d, x, z, li, ei, t} */
function nearestOnLoops(loops, x, z) {
  let best = { d: 1e9 };
  loops.forEach((ring, li) => {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { d, x: px, z: pz, li, ei: i, t };
    }
  });
  return best;
}

// ------------------------------------------------------------------ Delaunay (Bowyer-Watson)
export class Del {
  constructor(size) {
    this.px = [-size, size, 0]; this.pz = [-size, -size, size];
    this.live = [];
    this._add(0, 1, 2);
  }
  _add(a, b, c) {
    const { px, pz } = this;
    const ax = px[a], az = pz[a], bx = px[b] - ax, bz = pz[b] - az, cx = px[c] - ax, cz = pz[c] - az;
    const d = 2 * (bx * cz - bz * cx);
    const b2 = bx * bx + bz * bz, c2 = cx * cx + cz * cz;
    const ux = (cz * b2 - bz * c2) / d, uz = (bx * c2 - cx * b2) / d;
    this.live.push({ a, b, c, cx: ax + ux, cz: az + uz, r2: ux * ux + uz * uz });
  }
  addPoint(x, z) {
    const id = this.px.length;
    this.px.push(x + (((id * 7919) % 1000) / 1000 - 0.5) * 2e-5); this.pz.push(z + (((id * 104729) % 1000) / 1000 - 0.5) * 2e-5);
    this.insert(id);
    return id;
  }
  insert(id) {
    const x = this.px[id], z = this.pz[id];
    const keep = [], bad = [];
    for (const t of this.live) {
      const dx = x - t.cx, dz = z - t.cz;
      (dx * dx + dz * dz < t.r2 ? bad : keep).push(t);
    }
    const cnt = new Map();
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = ek(u, v); const e = cnt.get(k); if (e) e.n++; else cnt.set(k, { u, v, n: 1 }); }
    this.live = keep;
    for (const e of cnt.values()) if (e.n === 1) this._add(e.u, e.v, id);
  }
  edgeSet() {
    const s = new Set();
    for (const t of this.live) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) s.add(ek(u, v));
    return s;
  }
}

/** order triangles by adjacency (BFS) and renumber vertices by first use; tris: [[a,b,c,mat]]; returns {verts, tris, remap} */
export function pack(P, tris) {
  const tEdge = new Map();
  tris.forEach(([a, b, c], ti) => { for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = ek(u, v); const e = tEdge.get(k); if (e) e.push(ti); else tEdge.set(k, [ti]); } });
  const order = []; const seen = new Uint8Array(tris.length);
  for (let s0 = 0; s0 < tris.length; s0++) {
    if (seen[s0]) continue;
    seen[s0] = 1; const qq = [s0];
    for (let q = 0; q < qq.length; q++) {
      const ti = qq[q]; order.push(ti);
      const [a, b, c] = tris[ti];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) for (const nj of tEdge.get(ek(u, v))) if (!seen[nj]) { seen[nj] = 1; qq.push(nj); }
    }
  }
  const used = new Map(); const verts = [];
  const use = (i) => { let u = used.get(i); if (u === undefined) { u = verts.length; used.set(i, u); verts.push(P[i]); } return u; };
  const out = order.map((ti) => { const [a, b, c, m] = tris[ti]; return [use(a), use(b), use(c), m]; });
  return { verts, tris: out, use };
}

// ------------------------------------------------------------------ plane maths
// plane: height(x, z) = a*(x-ox) + b*(z-oz) + c
function solve3(m, r) {
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-9) return null;
  const d0 = r[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (r[1] * m[8] - m[5] * r[2]) + m[2] * (r[1] * m[7] - m[4] * r[2]);
  const d1 = m[0] * (r[1] * m[8] - m[5] * r[2]) - r[0] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * r[2] - r[1] * m[6]);
  const d2 = m[0] * (m[4] * r[2] - r[1] * m[7]) - m[1] * (m[3] * r[2] - r[1] * m[6]) + r[0] * (m[3] * m[7] - m[4] * m[6]);
  return [d0 / det, d1 / det, d2 / det];
}

/** classify + mesh. F: Field (H = metres above ground, NaN outside), built: Uint8 mask, loops: outline loops [[x,z]..] (absolute), o: options */
export function planarMesh(F, built, loops, o) {
  const { w, h, cell } = F;
  const N = w * h, cellA = cell * cell;
  const rnd = mulberry32(o.seed || 12345);
  const ox = F.x0 + (w * cell) / 2, oz = F.z0 + (h * cell) / 2;
  const X = new Float32Array(w), Z = new Float32Array(h);
  for (let i = 0; i < w; i++) X[i] = F.cx(i);
  for (let j = 0; j < h; j++) Z[j] = F.cz(j);
  const H = F.H;
  const valid = new Uint8Array(N);
  let nValid = 0;
  for (let k = 0; k < N; k++) if (built[k] && !Number.isNaN(H[k])) { valid[k] = 1; nValid++; }
  if (nValid * cellA < 20) return null; // tiny remnants (e.g. sheds squeezed against a tall wall) keep the old TIN path
  const cellAt = (x, z) => { const i = Math.floor((x - F.x0) / cell), j = Math.floor((z - F.z0) / cell); return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i; };
  const hAt = (x, z) => { const k = cellAt(x, z); return k < 0 || !valid[k] ? NaN : H[k]; };
  const label = new Int32Array(N).fill(-1); // >=0 plane id, -2 lathe disc, -1 none/outside
  const outer = loops.filter((l, i) => i === 0 || true);
  const insideOutline = (x, z) => { let c = 0; for (const l of loops) if (pointInPoly(x, z, l)) c++; return (c & 1) === 1; };

  // ---------------------------------------------------------------- 1. lathe discs (round: domes / cones / onion; square: pyramid spires)
  const lathes = [];
  const polyOf = (L) => { // base polygon of a lathe
    if (L.shape === 'sq') { const c = Math.cos(L.theta), s = Math.sin(L.theta); return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([u, v]) => [L.cx + L.R * (u * c - v * s), L.cz + L.R * (u * s + v * c)]); }
    const n = Math.max(L.R < 2.5 ? 12 : 16, Math.min(24, Math.ceil(L.R * 4.5)));
    const c = []; for (let a = 0; a < n; a++) { const ang = (a / n) * Math.PI * 2; c.push([L.cx + Math.cos(ang) * L.R, L.cz + Math.sin(ang) * L.R]); }
    return c;
  };
  const gaugeOf = (L, x, z) => { // 1 on the base polygon
    const dx = x - L.cx, dz = z - L.cz;
    if (L.shape === 'sq') { const c = Math.cos(L.theta), s = Math.sin(L.theta); return Math.max(Math.abs(dx * c + dz * s), Math.abs(-dx * s + dz * c)) / L.R; }
    return Math.hypot(dx, dz) / L.R;
  };
  if (o.lathe) {
    const Hs = new Float32Array(N).fill(NaN);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (!valid[k]) continue;
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue; const kk = b * w + a; if (valid[kk]) { s += H[kk]; n++; } }
      Hs[k] = s / n;
    }
    const R2 = Math.max(2, Math.round(2.0 / cell));
    const cands = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (!valid[k] || Hs[k] < 3.5) continue;
      let isMax = true;
      for (let dj = -R2; dj <= R2 && isMax; dj++) for (let di = -R2; di <= R2; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue; const v = Hs[b * w + a]; if (v > Hs[k] || (v === Hs[k] && (b < j || (b === j && a < i)))) { isMax = false; break; } }
      if (isMax) cands.push(k);
    }
    cands.sort((a, b) => Hs[b] - Hs[a]);
    // dominant direction of the outline (longest edge) for the square candidates
    let th0 = 0;
    { let bl = 0; for (const l of loops) for (let i = 0; i < l.length; i++) { const [ax, az] = l[i], [bx, bz] = l[(i + 1) % l.length]; const d = Math.hypot(bx - ax, bz - az); if (d > bl) { bl = d; th0 = Math.atan2(bz - az, bx - ax); } } }
    const claimed = new Uint8Array(N);
    const NA = 16, step = cell, RMAX = 16, nst = Math.ceil(RMAX / step);
    const ds = Math.max(2, Math.round(1.0 / step));
    const probe = (cx, cz, shape, theta) => { // radial statistics at gauge levels m*step
      const mean = new Float32Array(nst + ds + 2), sd = new Float32Array(nst + ds + 2), outF = new Float32Array(nst + ds + 2);
      const cs = Math.cos(theta), sn = Math.sin(theta);
      for (let m = 1; m < nst + ds + 2; m++) {
        const g = m * step; let s = 0, s2 = 0, n = 0, no = 0;
        for (let a = 0; a < NA; a++) {
          let u, v;
          if (shape === 'sq') { const t = (a / NA) * 4, side = Math.floor(t), f = t - side; [u, v] = side === 0 ? [1, -1 + 2 * f] : side === 1 ? [1 - 2 * f, 1] : side === 2 ? [-1, 1 - 2 * f] : [-1 + 2 * f, -1]; }
          else { const ang = (a / NA) * Math.PI * 2; u = Math.cos(ang); v = Math.sin(ang); }
          const val = hAt(cx + g * (u * cs - v * sn), cz + g * (u * sn + v * cs));
          if (Number.isNaN(val)) { no++; continue; }
          s += val; s2 += val * val; n++;
        }
        mean[m] = n ? s / n : 0; sd[m] = n > 1 ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : 0; outF[m] = no / NA;
      }
      return { mean, sd, outF };
    };
    for (const k of cands) {
      if (claimed[k] || lathes.length >= (o.maxLathes || 14)) continue;
      const cx = X[k % w], cz = Z[(k / w) | 0];
      let best = null;
      const trials = [['round', 0]];
      for (const dth of [0, 15, 30, 45, 60, 75]) trials.push(['sq', th0 + (dth * Math.PI) / 180]);
      for (const [shape, theta] of trials) {
        // centre refinement: the apex is rarely on a cell centre; on steep spires a 0.25 m offset is a 2 m height asymmetry
        let bx = cx, bz = cz, bs = 1e9;
        for (const dx of [-0.4, -0.2, 0, 0.2, 0.4]) for (const dz of [-0.4, -0.2, 0, 0.2, 0.4]) {
          const pr = probe(cx + dx, cz + dz, shape, theta);
          let sum = 0; for (let m = 1; m <= 8; m++) sum += pr.sd[m];
          if (sum < bs) { bs = sum; bx = cx + dx; bz = cz + dz; }
        }
        const { mean, sd, outF } = probe(bx, bz, shape, theta);
        mean[0] = Math.max(H[k], hAt(bx, bz) || 0);
        let Rb = -1, reason = '';
        for (let m = 1; m <= nst; m++) {
          if (outF[m] > 0.3) { Rb = (m - 1) * step; reason = 'outside'; break; }
          const prevD = m >= ds ? mean[m - ds] - mean[m] : 0, nextD = mean[m] - mean[m + ds];
          if (m >= 2 && nextD > Math.max(3.0, 2.2 * prevD + 1.0) && outF[m + ds] < 0.3) { Rb = m * step; reason = 'cliff'; break; }
          const sdLim = 0.5 + 0.13 * (mean[0] - mean[m]);
          if (m >= 3 && sd[m] > sdLim && sd[m - 1] > sdLim) { Rb = (m - 2) * step; reason = 'std'; break; }
          if (m >= 2 && mean[m] > mean[m - 1] + 0.8) { Rb = (m - 1) * step; reason = 'rise'; break; }
        }
        if (Rb < 0) { Rb = nst * step; reason = 'max'; }
        if (Rb < Math.max(1.2, o.latheMinR || 1.2)) continue;
        const mb = Math.round(Rb / step);
        let avgSd = 0; for (let m = 1; m <= mb; m++) avgSd += Math.max(0, sd[m] - 0.13 * (mean[0] - mean[m])); avgSd /= mb; // symmetry error beyond 13 % of the height drop
        const rise = mean[0] - mean[mb];
        if (process.env.PLANAR_WHY) console.log('  cand', cx.toFixed(0), cz.toFixed(0), 'H', H[k].toFixed(1), shape, 'Rb', Rb.toFixed(1), reason, 'rise', rise.toFixed(1), 'avgSd', avgSd.toFixed(2));
        if (rise < Math.max(2.0, 0.35 * Rb) || avgSd > 0.3 + 0.02 * rise || (reason === 'std' && Rb > 5)) continue;
        if (!best || avgSd < best.avgSd - 0.04 || (shape === 'round' && avgSd <= best.avgSd + 0.04)) best = { shape, theta, Rb, mb, mean, avgSd, reason, bx, bz };
      }
      if (!best) continue;
      const { shape, theta, Rb, mb, mean } = best;
      const lcx = best.bx, lcz = best.bz;
      const pr = []; let run = mean[0];
      for (let m = 0; m <= mb; m++) { run = Math.min(run, mean[m]); pr.push([m * step, run]); }
      let prof = [];
      if (shape === 'sq') {
        const d = dp(pr, 0.22);
        prof = d.map(([r, hh]) => [r / Rb, hh]).reverse(); // apex .. base
        if (prof.length < 2) continue;
      } else {
        const sm = pr.map((p, i) => [p[0], i === 0 || i === pr.length - 1 ? p[1] : (pr[i - 1][1] + 2 * p[1] + pr[i + 1][1]) / 4]);
        let arc = 0; const cum = [0];
        for (let i = 1; i < sm.length; i++) { arc += Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]); cum.push(arc); }
        const K = Math.max(4, Math.min(10, Math.round(arc / 1.0)));
        for (let q = 0; q <= K; q++) {
          const target = (arc * q) / K; let i = 1; while (i < cum.length - 1 && cum[i] < target) i++;
          const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
          prof.push([(sm[i - 1][0] + t * (sm[i][0] - sm[i - 1][0])) / Rb, sm[i - 1][1] + t * (sm[i][1] - sm[i - 1][1])]);
        }
      }
      prof[0][0] = 0; prof[prof.length - 1][0] = 1;
      const L = { cx: lcx, cz: lcz, R: Rb, prof, shape, theta, reason: best.reason };
      lathes.push(L);
      const i0 = Math.max(0, Math.floor((cx - Rb * 1.5 - 1 - F.x0) / cell)), i1 = Math.min(w - 1, Math.floor((cx + Rb * 1.5 + 1 - F.x0) / cell));
      const j0 = Math.max(0, Math.floor((cz - Rb * 1.5 - 1 - F.z0) / cell)), j1 = Math.min(h - 1, Math.floor((cz + Rb * 1.5 + 1 - F.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (gaugeOf(L, X[i], Z[j]) * Rb <= Rb + 0.5) claimed[j * w + i] = 1;
    }
    // keep only lathes whose base polygon lies inside the outline (shrink a little when it touches the wall); drop overlapping pairs
    const okL = [];
    for (const L of lathes) {
      const R0 = L.R; let f = 1;
      for (; f > 0.5; f -= 0.04) {
        L.R = R0 * f;
        const q = polyOf(L); let ok = true;
        for (let i = 0; i < q.length && ok; i++) { const a = q[i], b = q[(i + 1) % q.length]; for (const t of [0, 0.5]) { const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; const nx = x + (x - L.cx) * 0.06, nz = z + (z - L.cz) * 0.06; if (!insideOutline(nx, nz)) { ok = false; break; } } }
        if (ok) break;
      }
      if (f < 0.72 || !insideOutline(L.cx, L.cz)) continue;
      if (okL.some((M) => Math.hypot(M.cx - L.cx, M.cz - L.cz) < (M.R + L.R) * (M.shape === 'sq' || L.shape === 'sq' ? 1.3 : 1) + 0.3)) continue;
      okL.push(L);
    }
    lathes.length = 0; lathes.push(...okL);
    for (const L of lathes) {
      const i0 = Math.max(0, Math.floor((L.cx - L.R * 1.5 - 1 - F.x0) / cell)), i1 = Math.min(w - 1, Math.floor((L.cx + L.R * 1.5 + 1 - F.x0) / cell));
      const j0 = Math.max(0, Math.floor((L.cz - L.R * 1.5 - 1 - F.z0) / cell)), j1 = Math.min(h - 1, Math.floor((L.cz + L.R * 1.5 + 1 - F.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (valid[j * w + i] && gaugeOf(L, X[i], Z[j]) * L.R <= L.R - 0.25 * cell) label[j * w + i] = -2;
    }
  }

  // ---------------------------------------------------------------- 2. planes
  const un = new Uint8Array(N);
  let nun = 0;
  for (let k = 0; k < N; k++) if (valid[k] && label[k] === -1) { un[k] = 1; nun++; }
  const planes = [];
  const fitCells = (cells) => {
    let sxx = 0, sxz = 0, sx = 0, szz = 0, sz = 0, s1 = 0, sxh = 0, szh = 0, sh = 0;
    for (const k of cells) {
      const i = k % w, j = (k - i) / w, dx = X[i] - ox, dz = Z[j] - oz, hh = H[k];
      sxx += dx * dx; sxz += dx * dz; sx += dx; szz += dz * dz; sz += dz; s1 += 1; sxh += dx * hh; szh += dz * hh; sh += hh;
    }
    const r = solve3([sxx, sxz, sx, sxz, szz, sz, sx, sz, s1], [sxh, szh, sh]);
    return r ? { a: r[0], b: r[1], c: r[2] } : null;
  };
  const res = (p, k) => { const i = k % w, j = (k - i) / w; return H[k] - (p.a * (X[i] - ox) + p.b * (Z[j] - oz) + p.c); };
  const largestComp = (pred) => { // largest 8-connected set of cells satisfying pred (given as candidate list)
    const inSet = new Map(); // not used for speed; use stamp array
    void inSet;
    return null;
  };
  void largestComp;
  const stamp = new Int32Array(N); let stampId = 0;
  const compOf = (cells) => { // largest 8-connected component of the given cell list
    stampId++; const mark = stampId;
    for (const k of cells) stamp[k] = mark;
    const done = new Int32Array(0); void done;
    const seen = new Set();
    let best = [];
    for (const s of cells) {
      if (seen.has(s)) continue;
      const comp = [s]; seen.add(s);
      for (let q = 0; q < comp.length; q++) {
        const k = comp[q], i = k % w, j = (k - i) / w;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue;
          const kk = b * w + a;
          if (stamp[kk] === mark && !seen.has(kk)) { seen.add(kk); comp.push(kk); }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  };
  const tried = new Uint8Array(N);
  const minCells = Math.max(4, Math.round(o.minArea / cellA));
  for (let attempt = 0; attempt < (o.maxPlanes || 28) * 2 && planes.length < (o.maxPlanes || 28); attempt++) {
    const cand = [];
    for (let k = 0; k < N; k++) if (un[k] && !tried[k]) cand.push(k);
    if (cand.length < minCells) break;
    const stride = cand.length > 4000 ? 3 : cand.length > 1500 ? 2 : 1;
    let best = null;
    const RR = Math.max(2, Math.round(3.0 / cell));
    for (let t = 0; t < (o.trials || 120); t++) {
      const k0 = cand[(rnd() * cand.length) | 0], i0 = k0 % w, j0 = (k0 - i0) / w;
      const pts = [k0];
      for (let g = 0; g < 14 && pts.length < 3; g++) {
        const a = i0 + Math.round((rnd() * 2 - 1) * RR), b = j0 + Math.round((rnd() * 2 - 1) * RR);
        if (a < 0 || b < 0 || a >= w || b >= h) continue;
        const kk = b * w + a;
        if (!un[kk] || tried[kk] || pts.includes(kk)) continue;
        if (Math.abs(a - i0) + Math.abs(b - j0) < 2) continue;
        pts.push(kk);
      }
      if (pts.length < 3) continue;
      const m = [], r = [];
      for (const k of pts) { const i = k % w, j = (k - i) / w; m.push(X[i] - ox, Z[j] - oz, 1); r.push(H[k]); }
      const s = solve3(m, r);
      if (!s) continue;
      if (Math.hypot(s[0], s[1]) > o.maxSlope) continue;
      const pl = { a: s[0], b: s[1], c: s[2] };
      let cnt = 0;
      for (let q = 0; q < cand.length; q += stride) if (Math.abs(res(pl, cand[q])) < o.tol) cnt++;
      if (!best || cnt > best.cnt) best = { pl, cnt };
    }
    if (!best || best.cnt * stride < minCells) break;
    let pl = best.pl, comp = [];
    for (let it = 0; it < 3; it++) {
      const inl = [];
      for (let q = 0; q < cand.length; q++) if (Math.abs(res(pl, cand[q])) < o.tol) inl.push(cand[q]);
      comp = compOf(inl);
      if (comp.length < minCells) break;
      const np = fitCells(comp);
      if (!np) break;
      pl = np;
    }
    if (comp.length < minCells || Math.hypot(pl.a, pl.b) > o.maxSlope) { for (const k of comp.length ? comp : [cand[0]]) tried[k] = 1; continue; }
    const id = planes.length; planes.push(pl);
    for (const k of comp) { label[k] = id; un[k] = 0; nun--; }
  }
  if (!planes.length && !lathes.length) return null;

  // join residual cells: cells within 1.6 tol of a plane take the best-fitting one, the rest grow in from their neighbours
  if (planes.length) {
    for (let k = 0; k < N; k++) {
      if (!valid[k] || label[k] !== -1) continue;
      let bi = -1, bd = o.tol * 1.6;
      for (let p = 0; p < planes.length; p++) { const d = Math.abs(res(planes[p], k)); if (d < bd) { bd = d; bi = p; } }
      if (bi >= 0) label[k] = bi;
    }
    // multi-source growth (8-neighbourhood) for what is left
    let frontier = [];
    for (let k = 0; k < N; k++) if (valid[k] && label[k] >= 0) frontier.push(k);
    const grown = new Int32Array(label);
    for (let guard = 0; guard < 400 && frontier.length; guard++) {
      const next = [];
      for (const k of frontier) {
        const i = k % w, j = (k - i) / w;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue;
          const kk = b * w + a;
          if (valid[kk] && grown[kk] === -1) { grown[kk] = grown[k]; next.push(kk); }
        }
      }
      frontier = next;
    }
    for (let k = 0; k < N; k++) if (valid[k] && label[k] === -1) label[k] = grown[k];
  }
  // lathe-only buildings (towers): cells outside discs that no plane covers stay -1 => handled by plane growth; nothing else to do

  // label smoothing (mode filter) + small region merge
  for (let pass = 0; pass < 2; pass++) {
    const out = new Int32Array(label);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; const l0 = label[k];
      if (l0 < 0) continue;
      const cnt = new Map();
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue; const l = label[b * w + a]; if (l >= 0) cnt.set(l, (cnt.get(l) || 0) + 1); }
      const own = cnt.get(l0) || 0;
      let bl = l0, bc = own;
      for (const [l, c] of cnt) if (c > bc) { bc = c; bl = l; }
      if (bl !== l0 && own <= 3 && bc >= 5) out[k] = bl;
    }
    label.set(out);
  }
  const mergeSmall = (minC) => {
    for (let pass = 0; pass < 4; pass++) {
      const seen = new Uint8Array(N); let changed = false;
      for (let s = 0; s < N; s++) {
        if (seen[s] || label[s] < 0) continue;
        const l = label[s], comp = [s]; seen[s] = 1;
        const nb = new Map();
        for (let q = 0; q < comp.length; q++) {
          const k = comp[q], i = k % w, j = (k - i) / w;
          for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
            if (a < 0 || b < 0 || a >= w || b >= h) continue;
            const kk = b * w + a;
            if (label[kk] === l) { if (!seen[kk]) { seen[kk] = 1; comp.push(kk); } } else if (label[kk] >= 0) nb.set(label[kk], (nb.get(label[kk]) || 0) + 1);
          }
        }
        if (comp.length < minC && nb.size) {
          let bl = -1, bc = 0; for (const [ll, c] of nb) if (c > bc) { bc = c; bl = ll; }
          for (const k of comp) label[k] = bl; changed = true;
        }
      }
      if (!changed) break;
    }
  };
  mergeSmall(minCells);

  // fit quality (residual of every cell against its label's plane)
  let se = 0, nOK = 0, nBad = 0;
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = j * w + i;
    if (!valid[k] || label[k] < 0) continue;
    const gx = valid[k - 1] && valid[k + 1] ? Math.abs(H[k + 1] - H[k - 1]) / (2 * cell) : 9, gz = valid[k - w] && valid[k + w] ? Math.abs(H[k + w] - H[k - w]) / (2 * cell) : 9;
    if (Math.max(gx, gz) > o.maxSlope + 0.4) continue; // wall ramps between roof levels are not roof error
    const r = res(planes[label[k]], k); se += r * r; nOK++; if (Math.abs(r) > 1.2) nBad++;
  }
  const rms = nOK ? Math.sqrt(se / nOK) : 0;
  if (process.env.PLANAR_WHY) console.log('planar fit', 'rms', rms.toFixed(2), 'bad', nBad, '/', nOK, 'planes', planes.length, 'lathes', lathes.length);
  if (nOK > 30 && (rms > (o.maxRms || 1.0) || nBad / nOK > (o.maxBad || 0.3))) return null;

  if (o.debug) o.debug({ label, valid, H, w, h, cell, planes, lathes, rms });
  // refit planes on their final cells
  const byLabel = planes.map(() => []);
  for (let k = 0; k < N; k++) if (label[k] >= 0) byLabel[label[k]].push(k);
  planes.forEach((p, i) => { if (byLabel[i].length >= 4) { const np = fitCells(byLabel[i]); if (np && Math.hypot(np.a, np.b) < o.maxSlope * 1.2) planes[i] = np; } });
  const hp = (p, x, z) => p.a * (x - ox) + p.b * (z - oz) + p.c;

  // ---------------------------------------------------------------- 3. chains
  const lab = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : label[j * w + i]);
  const vkey = (i, j) => j * (w + 1) + i;
  const adj = new Map();
  const edges = [];
  const addEdge = (ia, ja, ib, jb, left, right) => {
    if (left === right) return;
    if (left < 0 && right < 0) return;
    const id = edges.length;
    edges.push({ ia, ja, ib, jb, left, right, chain: left >= 0 && right >= 0, vis: false });
    const ka = vkey(ia, ja), kb = vkey(ib, jb);
    if (!adj.has(ka)) adj.set(ka, []); if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(id); adj.get(kb).push(id);
  };
  for (let j = 0; j <= h; j++) for (let i = 0; i < w; i++) addEdge(i, j, i + 1, j, lab(i, j - 1), lab(i, j));
  for (let j = 0; j < h; j++) for (let i = 0; i <= w; i++) addEdge(i, j, i, j + 1, lab(i, j), lab(i - 1, j));
  const pairKey = (e) => (e.left < e.right ? e.left * 4096 + e.right : e.right * 4096 + e.left);
  const isJunction = (key) => {
    const es = adj.get(key).map((id) => edges[id]);
    if (es.length !== 2) return true;
    if (!es[0].chain || !es[1].chain) return true;
    return pairKey(es[0]) !== pairKey(es[1]);
  };
  const vOf = (key) => [key % (w + 1), Math.floor(key / (w + 1))];
  const chains = [];
  const walk = (startKey, eid0) => {
    const pts = [vOf(startKey)]; let cur = startKey, eid = eid0;
    const first = edges[eid0]; const startDirForward = vkey(first.ia, first.ja) === startKey;
    const pair = startDirForward ? [first.left, first.right] : [first.right, first.left];
    for (let guard = 0; guard < 100000; guard++) {
      const e = edges[eid]; e.vis = true;
      const ka = vkey(e.ia, e.ja), kb = vkey(e.ib, e.jb);
      const nxt = ka === cur ? kb : ka;
      pts.push(vOf(nxt)); cur = nxt;
      if (cur === startKey || isJunction(cur)) break;
      const es = adj.get(cur);
      const ne = es.find((id) => id !== eid && edges[id].chain && !edges[id].vis);
      if (ne === undefined) break;
      eid = ne;
    }
    return { pts, pair, closed: cur === startKey, a: startKey, b: cur };
  };
  for (const [key, es] of adj) {
    if (!es.some((id) => edges[id].chain) || !isJunction(key)) continue;
    for (const id of es) if (edges[id].chain && !edges[id].vis) chains.push(walk(key, id));
  }
  for (const e of edges) if (e.chain && !e.vis) { const c = walk(vkey(e.ia, e.ja), edges.indexOf(e)); chains.push(c); }
  const toXZ = ([i, j]) => [F.x0 + i * cell, F.z0 + j * cell];

  // outline loops + lathe circles as mutable point lists (snap points are inserted into them)
  const loopPts = loops.map((l) => l.map((q) => [q[0], q[1]]));
  const nWall = loopPts.length;
  const circles = lathes.map((L) => polyOf(L));
  const allLoops = loopPts.concat(circles);
  // junction vertex info: labels around a lattice vertex
  const around = (key) => {
    const [i, j] = vOf(key);
    const ls = [lab(i - 1, j - 1), lab(i, j - 1), lab(i - 1, j), lab(i, j)];
    return { planesAround: [...new Set(ls.filter((l) => l >= 0))], touches: ls.some((l) => l < 0) };
  };
  const inserts = new Map(); // `${li}:${ei}` -> [{t,x,z}]
  const snapToLoops = (x, z) => {
    const n = nearestOnLoops(allLoops, x, z);
    if (n.d > 2.5 * cell + 0.6) return null;
    const ring = allLoops[n.li];
    // an existing vertex close by?
    const a = ring[n.ei], b = ring[(n.ei + 1) % ring.length];
    if (Math.hypot(n.x - a[0], n.z === undefined ? 0 : n.z - a[1]) < 0.01) return { x: a[0], z: a[1] };
    if (Math.hypot(n.x - a[0], n.z - a[1]) < 0.3) return { x: a[0], z: a[1] };
    if (Math.hypot(n.x - b[0], n.z - b[1]) < 0.3) return { x: b[0], z: b[1] };
    const key = `${n.li}:${n.ei}`;
    if (!inserts.has(key)) inserts.set(key, []);
    const arr = inserts.get(key);
    for (const q of arr) if (Math.hypot(q.x - n.x, q.z - n.z) < 0.3) return { x: q.x, z: q.z };
    arr.push({ t: n.t, x: n.x, z: n.z });
    return { x: n.x, z: n.z };
  };
  const planeLine = (p, q) => { // intersection line of two planes in (x,z): A*dx + B*dz + C = 0 with d = p - q
    const A = p.a - q.a, B = p.b - q.b, C = p.c - q.c;
    return { A, B, C, g: Math.hypot(A, B) };
  };
  // junction targets
  const jTarget = new Map();
  const needJ = new Set();
  for (const ch of chains) { needJ.add(ch.a); needJ.add(ch.b); }
  for (const key of needJ) {
    const [i, j] = vOf(key); const x0 = F.x0 + i * cell, z0 = F.z0 + j * cell;
    const { planesAround, touches } = around(key);
    let tx = x0, tz = z0;
    if (planesAround.length >= 3 && !touches) {
      let sxx = 0, sxz = 0, sx = 0, szz = 0, sz = 0, s1 = 0, sxh = 0, szh = 0, sh = 0;
      for (const l of planesAround) { // y = a x + b z + c  =>  least squares for (x,z,y): minimise sum (a x + b z + c - y)^2 -> 3 unknowns, solve normal equations
        const p = planes[l]; const a = p.a, b = p.b, c = p.c - p.a * 0 - p.b * 0; // work in local coords relative to (ox,oz)
        sxx += a * a; sxz += a * b; sx += -a; szz += b * b; sz += -b; s1 += 1; sxh += -a * c; szh += -b * c; sh += c; void sxh; void szh; void sh;
      }
      // normal equations for unknown (x', z', y): residual_l = a_l x' + b_l z' - y + c_l
      const M = [0, 0, 0, 0, 0, 0, 0, 0, 0], R = [0, 0, 0];
      for (const l of planesAround) {
        const p = planes[l]; const v = [p.a, p.b, -1];
        for (let r = 0; r < 3; r++) { for (let c2 = 0; c2 < 3; c2++) M[r * 3 + c2] += v[r] * v[c2]; R[r] += -v[r] * p.c; }
      }
      void sxx; void sxz; void sx; void szz; void sz; void s1;
      const s = solve3(M, R);
      if (s) { const nx = ox + s[0], nz = oz + s[1]; if (Math.hypot(nx - x0, nz - z0) < 1.6 * cell + 0.8) { tx = nx; tz = nz; } }
    } else if (touches) {
      let px = x0, pz = z0;
      if (planesAround.length === 2) {
        const ln = planeLine(planes[planesAround[0]], planes[planesAround[1]]);
        if (ln.g > 0.12) { // move onto the ridge line first
          const d = (ln.A * (x0 - ox) + ln.B * (z0 - oz) + ln.C) / (ln.g * ln.g);
          const sx = -ln.A * d, sz = -ln.B * d;
          if (Math.hypot(sx, sz) < 1.5) { px = x0 + sx; pz = z0 + sz; }
        }
      }
      const s = snapToLoops(px, pz);
      if (s) { tx = s.x; tz = s.z; }
    }
    jTarget.set(key, [tx, tz]);
  }
  // splice snap points into the loops (sorted by t along the edge)
  {
    const byLoop = new Map();
    for (const [key, arr] of inserts) { const [li, ei] = key.split(':').map(Number); if (!byLoop.has(li)) byLoop.set(li, new Map()); byLoop.get(li).set(ei, arr.sort((a, b) => a.t - b.t)); }
    for (const [li, m] of byLoop) {
      const ring = allLoops[li], out = [];
      for (let i = 0; i < ring.length; i++) { out.push(ring[i]); const arr = m.get(i); if (arr) for (const q of arr) out.push([q.x, q.z]); }
      allLoops[li].length = 0; allLoops[li].push(...out);
    }
  }

  // chain geometry: DP, endpoints to targets, straighten onto the plane-plane line
  const chainPolys = [];
  for (const ch of chains) {
    let pts = ch.pts.map(toXZ);
    if (ch.closed) { pts = dpClosed(pts.slice(0, -1), o.dpTol); if (pts.length < 3) continue; pts.push(pts[0]); }
    else pts = dp(pts, o.dpTol);
    if (!ch.closed) {
      pts[0] = jTarget.get(ch.a) || pts[0]; pts[pts.length - 1] = jTarget.get(ch.b) || pts[pts.length - 1];
      const [pa, pb] = ch.pair; // plane ids
      if (pa >= 0 && pb >= 0 && pa !== pb) {
        const ln = planeLine(planes[pa], planes[pb]);
        if (ln.g > 0.15) {
          const dyMax = (() => { let m = 0; for (const q of pts) m = Math.max(m, Math.abs(hp(planes[pa], q[0], q[1]) - hp(planes[pb], q[0], q[1]))); return m; })();
          if (dyMax < 2.2) { // ridge / hip / valley: all vertices onto the line
            for (let i = 1; i < pts.length - 1; i++) {
              const d = (ln.A * (pts[i][0] - ox) + ln.B * (pts[i][1] - oz) + ln.C) / (ln.g * ln.g);
              const sx = -ln.A * d, sz = -ln.B * d;
              if (Math.hypot(sx, sz) < 1.2) { pts[i] = [pts[i][0] + sx, pts[i][1] + sz]; }
            }
            pts = dp(pts, 0.14);
          }
        }
      }
    }
    chainPolys.push({ pts, pair: ch.pair, closed: ch.closed });
  }

  // ---------------------------------------------------------------- 4. constrained Delaunay
  const dl = new Del(1e5);
  const px = [], pz = [];
  const posKey = new Map();
  const vid = (x, z) => {
    const k = `${Math.round(x * 400)},${Math.round(z * 400)}`;
    let id = posKey.get(k);
    if (id === undefined) { id = dl.addPoint(x, z); px[id] = x; pz[id] = z; posKey.set(k, id); }
    return id;
  };
  const cons = []; // {ids, closed, out(bool outline-type)}
  allLoops.forEach((ring, li) => {
    const ids = []; for (const [x, z] of ring) { const id = vid(x, z); if (!ids.length || ids[ids.length - 1] !== id) ids.push(id); }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    cons.push({ ids, closed: true, out: true, li });
  });
  // crossing guard: a chain edge crossing an outline edge (or another chain) is dropped
  const segX = (a, b, c, d) => {
    const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
    const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    const eps = 1e-6;
    return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
  };
  const segs = []; // accepted segments [a, b]
  for (const ring of allLoops) for (let i = 0; i < ring.length; i++) segs.push([ring[i], ring[(i + 1) % ring.length]]);
  let dropped = 0;
  for (const cp of chainPolys) {
    const ok = [];
    for (let i = 0; i + 1 < cp.pts.length; i++) {
      const a = cp.pts[i], b = cp.pts[i + 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) continue;
      let bad = false;
      for (const s of segs) if (segX(a, b, s[0], s[1])) { bad = true; break; }
      if (bad) { dropped++; continue; }
      segs.push([a, b]); ok.push([a, b]);
    }
    // consecutive accepted segments -> polylines
    let cur = null;
    for (const [a, b] of ok) {
      if (cur && Math.hypot(cur[cur.length - 1][0] - a[0], cur[cur.length - 1][1] - a[1]) < 1e-6) cur.push(b);
      else { if (cur) cons.push({ pts: cur, closed: false, out: false, pair: cp.pair }); cur = [a, b]; }
    }
    if (cur) cons.push({ pts: cur, closed: false, out: false, pair: cp.pair });
  }
  for (const c of cons) if (!c.ids) { c.ids = []; for (const [x, z] of c.pts) { const id = vid(x, z); if (!c.ids.length || c.ids[c.ids.length - 1] !== id) c.ids.push(id); } }
  // recover constraint edges by midpoint splitting
  for (let pass = 0; pass < 16; pass++) {
    const es = dl.edgeSet();
    let missing = 0;
    for (const c of cons) {
      const ids = c.ids, n = c.closed ? ids.length : ids.length - 1;
      for (let i = 0; i < n; i++) {
        const a = ids[i], b = ids[(i + 1) % ids.length];
        if (a === b || es.has(ek(a, b))) continue;
        const len = Math.hypot(px[a] - px[b], pz[a] - pz[b]);
        if (len < 0.1) continue;
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const m = dl.addPoint(mx, mz); px[m] = mx; pz[m] = mz;
        ids.splice(i + 1, 0, m);
        missing++; i++;
      }
    }
    if (!missing) break;
  }
  const outE = new Set(), allE = new Set();
  for (const c of cons) {
    const ids = c.ids, n = c.closed ? ids.length : ids.length - 1;
    for (let i = 0; i < n; i++) { const a = ids[i], b = ids[(i + 1) % ids.length]; if (a === b) continue; allE.add(ek(a, b)); if (c.out) outE.add(ek(a, b)); }
  }
  const tris = dl.live;
  const emap = new Map();
  tris.forEach((t, ti) => { for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = ek(u, v); const e = emap.get(k); if (e) e.push(ti); else emap.set(k, [ti]); } });
  const par = new Int8Array(tris.length).fill(-1);
  const queue = [];
  tris.forEach((t, ti) => { if (t.a < 3 || t.b < 3 || t.c < 3) { par[ti] = 0; queue.push(ti); } });
  for (let q = 0; q < queue.length; q++) {
    const ti = queue[q], t = tris[ti];
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      const k = ek(u, v), flip = outE.has(k) ? 1 : 0;
      for (const nj of emap.get(k)) if (par[nj] < 0) { par[nj] = (par[ti] + flip) & 1; queue.push(nj); }
    }
  }
  // components of filled triangles (not crossing any constraint edge); lathe interiors (parity 0 inside circles) are separate
  const comp = new Int32Array(tris.length).fill(-1);
  const comps = []; // {tris:[], plane}
  const triArea = (t) => Math.abs((px[t.b] - px[t.a]) * (pz[t.c] - pz[t.a]) - (pz[t.b] - pz[t.a]) * (px[t.c] - px[t.a])) / 2;
  for (let s = 0; s < tris.length; s++) {
    if (par[s] !== 1 || comp[s] >= 0) continue;
    const id = comps.length, list = [s]; comp[s] = id;
    for (let q = 0; q < list.length; q++) {
      const t = tris[list[q]];
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = ek(u, v); if (allE.has(k)) continue;
        for (const nj of emap.get(k)) if (par[nj] === 1 && comp[nj] < 0) { comp[nj] = id; list.push(nj); }
      }
    }
    comps.push({ tris: list, plane: -1 });
  }
  const sampleLabel = (x, z) => {
    const k = cellAt(x, z);
    if (k >= 0 && label[k] >= 0) return label[k];
    // nearest labelled cell
    const i0 = Math.floor((x - F.x0) / cell), j0 = Math.floor((z - F.z0) / cell);
    for (let r = 1; r <= 4; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue;
      if (label[b * w + a] >= 0) return label[b * w + a];
    }
    return -1;
  };
  for (const c of comps) {
    const score = new Map();
    for (const ti of c.tris) {
      const t = tris[ti], ar = triArea(t);
      const gx = (px[t.a] + px[t.b] + px[t.c]) / 3, gz = (pz[t.a] + pz[t.b] + pz[t.c]) / 3;
      const samples = [[gx, gz]];
      for (const v of [t.a, t.b, t.c]) samples.push([px[v] + (gx - px[v]) * 0.25, pz[v] + (gz - pz[v]) * 0.25]);
      for (const [x, z] of samples) { const l = sampleLabel(x, z); if (l >= 0) score.set(l, (score.get(l) || 0) + ar / 4); }
    }
    let bl = -1, bs = -1; for (const [l, s] of score) if (s > bs) { bs = s; bl = l; }
    c.plane = bl;
  }
  // components with no plane (only lathes cells around): take the neighbouring component's plane or give up on them
  for (const c of comps) if (c.plane < 0) c.plane = planes.length ? 0 : -1;
  if (!planes.length) { /* lathe-only footprint: no plane comps expected */ }

  // ---------------------------------------------------------------- 5. heights, welding, step walls
  const nodeKey = (v, c) => v * 4096 + c;
  const nodes = new Map(); // key -> {v, c, h, root}
  const comp2plane = comps.map((c) => (c.plane >= 0 ? planes[c.plane] : null));
  const LATHE = comps.length; // pseudo comp ids for lathe discs: LATHE + index
  const nodeId = [];
  const node = (v, c) => {
    const k = nodeKey(v, c); let n = nodes.get(k);
    if (!n) {
      let hh;
      if (c >= LATHE) hh = lathes[c - LATHE].prof[lathes[c - LATHE].prof.length - 1][1];
      else hh = comp2plane[c] ? hp(comp2plane[c], px[v], pz[v]) : 1;
      n = { v, c, h: Math.max(0.6, hh), p: nodeId.length }; nodes.set(k, n); nodeId.push(n);
    }
    return n;
  };
  // lathe disc interior: triangles with parity 0 whose all vertices are circle vertices / inside circle -> not needed (no CDT triangles are emitted for them)
  const circleOf = (li) => li - nWall;
  const parent = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const touch = (n) => { while (parent.length <= n.p) parent.push(parent.length); return n; };
  for (const c of comps) for (const ti of c.tris) { const t = tris[ti], id = comps.indexOf(c); void id; }
  const compIdx = new Map(); comps.forEach((c, i) => compIdx.set(c, i));
  const triComp = (ti) => comp[ti];
  // nodes for every filled triangle vertex
  comps.forEach((c, ci) => { for (const ti of c.tris) { const t = tris[ti]; for (const v of [t.a, t.b, t.c]) touch(node(v, ci)); } });
  // lathe base nodes on the circle vertices
  const circleIds = cons.filter((c) => c.out && c.li >= nWall);
  circleIds.forEach((c) => { const li = circleOf(c.li); for (const v of c.ids) touch(node(v, LATHE + li)); });
  const WELD = o.weld ?? 0.5;
  // neighbours across constraint edges: for each non-outline constraint edge between two comps, and each circle edge between a comp and a lathe
  const edgeSides = new Map(); // ek -> [{ti, comp}]
  comps.forEach((c, ci) => { for (const ti of c.tris) { const t = tris[ti]; for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = ek(u, v); if (!allE.has(k)) continue; if (!edgeSides.has(k)) edgeSides.set(k, []); edgeSides.get(k).push({ ti, comp: ci, u, v }); } } });
  const circleEdge = new Map(); // ek -> lathe index
  circleIds.forEach((c) => { const li = circleOf(c.li); const ids = c.ids; for (let i = 0; i < ids.length; i++) circleEdge.set(ek(ids[i], ids[(i + 1) % ids.length]), li); });
  const pairs = []; // {u,v,c1,c2,t1,t2}
  for (const [k, sides] of edgeSides) {
    if (outE.has(k) && !circleEdge.has(k)) continue; // wall of the building / courtyard handled by loops
    if (circleEdge.has(k)) { const s = sides[0]; if (s) pairs.push({ u: s.u, v: s.v, c1: s.comp, c2: LATHE + circleEdge.get(k), t1: s.ti, t2: -1 }); continue; }
    if (sides.length === 2 && sides[0].comp !== sides[1].comp) pairs.push({ u: sides[0].u, v: sides[0].v, c1: sides[0].comp, c2: sides[1].comp, t1: sides[0].ti, t2: sides[1].ti });
  }
  for (const pr of pairs) for (const x of [pr.u, pr.v]) {
    const n1 = nodes.get(nodeKey(x, pr.c1)), n2 = nodes.get(nodeKey(x, pr.c2));
    if (!n1 || !n2) continue;
    if (Math.abs(n1.h - n2.h) < WELD) { const a = find(n1.p), b = find(n2.p); if (a !== b) parent[a] = b; }
  }
  const gH = new Map(), gN = new Map();
  for (const n of nodeId) { const r = find(n.p); gH.set(r, (gH.get(r) || 0) + n.h); gN.set(r, (gN.get(r) || 0) + 1); }
  const heightOf = (n) => { const r = find(n.p); return gH.get(r) / gN.get(r); };
  const P = []; // output vertices [x, y, z]
  const groupVert = new Map();
  const gv = (n) => { const r = find(n.p); let id = groupVert.get(r); if (id === undefined) { id = P.length; P.push([px[n.v], heightOf(n), pz[n.v]]); groupVert.set(r, id); } return id; };
  const addV = (x, y, z) => { P.push([x, y, z]); return P.length - 1; };
  const outTris = [];
  // eave estimate (for roof classes)
  const loopVerts = []; // wall loops as node ids
  const wallLoops = cons.filter((c) => c.out && c.li < nWall);
  // loop vertex nodes: per loop edge find the filled triangle on it
  const loopsOut = [];
  let eaveVals = [];
  for (const c of wallLoops) {
    const ids = c.ids, n = ids.length; const seq = [];
    for (let i = 0; i < n; i++) {
      const a = ids[i], b = ids[(i + 1) % n];
      const tl = (emap.get(ek(a, b)) || []).find((ti) => par[ti] === 1);
      const ci = tl === undefined ? -1 : comp[tl];
      let na, nb;
      if (ci < 0) { // no filled triangle (degenerate): reuse any node of those vertices
        const f = (v) => { for (let cc = 0; cc < comps.length; cc++) { const q = nodes.get(nodeKey(v, cc)); if (q) return q; } return null; };
        na = f(a); nb = f(b);
        if (!na || !nb) continue;
      } else { na = node(a, ci); nb = node(b, ci); touch(na); touch(nb); }
      seq.push([gv(na), gv(nb)]);
    }
    // consecutive edges share a vertex when welded; otherwise the zero-length edge between them is kept
    const idx = [];
    for (const [ga, gb] of seq) { if (!idx.length || idx[idx.length - 1] !== ga) idx.push(ga); if (idx[idx.length - 1] !== gb) idx.push(gb); }
    while (idx.length > 1 && idx[0] === idx[idx.length - 1]) idx.pop();
    loopsOut.push({ idx, mat: 0 });
    for (const g of idx) eaveVals.push(P[g][1]);
  }
  // lazily create group vertices for all nodes now that heights are final
  const eave = median(eaveVals);
  const compSlope = comps.map((c, ci) => (comp2plane[ci] ? Math.hypot(comp2plane[ci].a, comp2plane[ci].b) : 0));
  const orient = (a, b, c, want) => { // geometric normal of P[a],P[b],P[c] against `want`
    const A = P[a], B = P[b], C = P[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return nx * want[0] + ny * want[1] + nz * want[2] >= 0;
  };
  let volume = 0;
  const pushTri = (a, b, c, mat, want) => {
    const A = P[a], B = P[b], C = P[c];
    const cr = (B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (nl < 1e-6) return;
    if (orient(a, b, c, want)) outTris.push([a, b, c, mat]); else outTris.push([a, c, b, mat]);
    if (want[1] > 0.3) volume += (Math.abs(cr) / 2) * (A[1] + B[1] + C[1]) / 3;
  };
  const UP = [0, 1, 0];
  comps.forEach((c, ci) => {
    const sl = compSlope[ci];
    for (const ti of c.tris) {
      const t = tris[ti];
      const na = node(t.a, ci), nb = node(t.b, ci), nc = node(t.c, ci);
      const a = gv(na), b = gv(nb), cc = gv(nc);
      const cy = (P[a][1] + P[b][1] + P[cc][1]) / 3;
      let mat = sl < 0.12 ? 0 : 1;
      if (sl > 0.55 && cy > eave + 3.0) mat = 3;
      pushTri(a, b, cc, mat, UP);
    }
  });
  // step walls between neighbouring components / lathe bases
  const addWallPiece = (u, v, hu1, hu2, hv1, hv2, lowSide) => { void u; void v; void hu1; void hu2; void hv1; void hv2; void lowSide; };
  void addWallPiece;
  for (const pr of pairs) {
    const n1u = nodes.get(nodeKey(pr.u, pr.c1)), n2u = nodes.get(nodeKey(pr.u, pr.c2)), n1v = nodes.get(nodeKey(pr.v, pr.c1)), n2v = nodes.get(nodeKey(pr.v, pr.c2));
    if (!n1u || !n2u || !n1v || !n2v) continue;
    const h1u = heightOf(n1u), h2u = heightOf(n2u), h1v = heightOf(n1v), h2v = heightOf(n2v);
    const dU = h1u - h2u, dV = h1v - h2v;
    if (Math.abs(dU) < 0.1 && Math.abs(dV) < 0.1) continue;
    // lower side direction: perpendicular to the edge, towards the lower comp's third vertex (use comp 1's triangle opposite vertex)
    const tt = tris[pr.t1];
    const opp = [tt.a, tt.b, tt.c].find((q) => q !== pr.u && q !== pr.v);
    const ex = px[pr.v] - px[pr.u], ez = pz[pr.v] - pz[pr.u];
    let nx = ez, nz = -ex; // candidate normal pointing to comp1 side if dot > 0
    const s1 = (px[opp] - px[pr.u]) * nx + (pz[opp] - pz[pr.u]) * nz;
    if (s1 < 0) { nx = -nx; nz = -nz; } // now (nx,nz) points toward comp 1
    const avg = (dU + dV) / 2;
    const toward = avg > 0 ? [-nx, 0, -nz] : [nx, 0, nz]; // wall faces the lower side
    const gU1 = gv(n1u), gU2 = gv(n2u), gV1 = gv(n1v), gV2 = gv(n2v);
    if (dU * dV < -1e-4 && Math.abs(dU) > 0.1 && Math.abs(dV) > 0.1) { // planes cross along the edge: two triangles meeting at the crossing
      const t = dU / (dU - dV);
      const mx = px[pr.u] + t * ex, mz = pz[pr.u] + t * ez, my = h1u + t * (h1v - h1u);
      const m = addV(mx, my, mz);
      pushTri(gU1, gU2, m, 2, toward); pushTri(gV1, gV2, m, 2, toward);
    } else {
      // quad u1,u2,v2,v1 (heights differ by sign-consistent amounts)
      if (gU1 === gU2 && gV1 === gV2) continue;
      if (gU1 === gU2) pushTri(gU1, gV2, gV1, 2, toward);
      else if (gV1 === gV2) pushTri(gU1, gU2, gV1, 2, toward);
      else { pushTri(gU1, gU2, gV2, 2, toward); pushTri(gU1, gV2, gV1, 2, toward); }
    }
  }
  // lathe surfaces
  lathes.forEach((L, li) => {
    const cons2 = circleIds.find((c) => circleOf(c.li) === li);
    if (!cons2) return;
    const ids = cons2.ids, n = ids.length;
    const base = ids.map((v) => gv(node(v, LATHE + li)));
    const top = L.prof[0][1];
    const dome = top > eave + 1.5;
    const mat = dome ? 3 : 1;
    let prev = base, prevRho = 1;
    for (let q = L.prof.length - 2; q >= 0; q--) {
      const [rho, hh] = L.prof[q];
      let cur;
      if (rho < 1e-4) { const a = addV(L.cx, hh, L.cz); cur = ids.map(() => a); }
      else cur = ids.map((v) => addV(L.cx + (px[v] - L.cx) * rho, hh, L.cz + (pz[v] - L.cz) * rho));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const mx = (px[ids[i]] + px[ids[j]]) / 2 - L.cx, mz = (pz[ids[i]] + pz[ids[j]]) / 2 - L.cz, ml = Math.hypot(mx, mz) || 1;
        const dh = prev === base ? P[base[i]][1] - hh : L.prof[q + 1][1] - hh, dr = (prevRho - rho) * L.R;
        const nr = Math.max(0.05, dh) / Math.hypot(dh, dr + 1e-6), ny = (dr) / Math.hypot(dh, dr + 1e-6);
        const want = [(mx / ml) * nr, Math.max(0.15, ny), (mz / ml) * nr];
        const a = prev[i], b = prev[j], c2 = cur[j], d = cur[i];
        if (a === b) continue;
        if (c2 === d) pushTri(a, b, c2, mat, want);
        else { pushTri(a, b, c2, mat, want); pushTri(a, c2, d, mat, want); }
      }
      prev = cur; prevRho = rho;
    }
  });
  if (!outTris.length) return null;
  let hmax = 0; for (const p of P) hmax = Math.max(hmax, p[1]);
  const packed = pack(P, outTris);
  if (process.env.PLANAR_WHY) { let bad = 0, tot = 0, mx = 0; for (const l of loopsOut) for (const g of l.idx) { const hv = hAt(P[g][0], P[g][2]); const k2 = cellAt(P[g][0], P[g][2]); tot++; if (!Number.isNaN(hv)) { const dd = Math.abs(hv - P[g][1]); mx = Math.max(mx, dd); if (dd > 1.5) bad++; } } console.log('  loop vertices', tot, 'plane-vs-grid >1.5m:', bad, 'max', mx.toFixed(1)); }
  const loopsPacked = loopsOut.map((l) => ({ idx: l.idx.map((g) => packed.use(g)), mat: 0 }));
  return { verts: packed.verts, tris: packed.tris, loops: loopsPacked, vol: volume, hmax, eave, info: { areaFilled: Math.round(tris.reduce((a, t, i) => a + (par[i] === 1 ? triArea(t) : 0), 0)), areaLoops: Math.round(loops.reduce((a, l) => { let s = 0; for (let i = 0; i < l.length; i++) { const [x0, z0] = l[i], [x1, z1] = l[(i + 1) % l.length]; s += x0 * z1 - x1 * z0; } return a + s / 2; }, 0)), planes: planes.length, lathes: lathes.length, comps: comps.length, rms, dropped } };
}
