// CHURCH KIT. Parametric churches built from the measured 0.5 m height grid, in the building's own axis frame (curated.mjs `Comp`):
//   * nave / aisles / transepts / chancel = greedy maximal rectangles of the footprint, each a prism (walls to the measured eave) + gable roof along its long side
//     (pyramid when nearly square, flat when the measured rise is < 1.5 m); rise and eave are read from the grid, not guessed
//   * towers = tall peaks found above the nave ridge: a square / round prism (shaft) to where the cross-section starts to shrink, then a SPIRE LOFT whose rings are the
//     MEASURED cross-sections of the peak (Douglas-Peucker on the width profile), so a needle stays a needle, a baroque helm keeps its galleries and bulbs, an onion dome stays an onion
//   * round leftovers at a nave end -> polygonal apse (8-gon prism + cone); `central` mode lofts the whole footprint to one apex (Jēzus baznīca, synagogue / old-believer domes)
//   * onion domes / spires carry a thin gilded cross (material 5) when `crosses`
// Output = same shape as curated.mjs: { verts, tris:[[a,b,c,mat]], loops:[], vol, hmax, eave, area }.  Materials: 0 flat roof, 1 pitched roof, 2 wall, 3 spire / dome, 5 cross.
import { Comp } from './curated.mjs';
import { minBox, pointInPoly } from '../../src/geo.js';

const CELL = 0.5;
const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

/** resample the world-frame Field into the (u, v) frame of the footprint's minimum box; NaN outside the ring */
function uvGrid(F, ring, mb) {
  const ux = mb.ux, uz = mb.uz;
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, z] of ring) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  u0 = Math.floor(u0 / CELL) * CELL; v0 = Math.floor(v0 / CELL) * CELL;
  const nu = Math.ceil((u1 - u0) / CELL) + 1, nv = Math.ceil((v1 - v0) / CELL) + 1;
  const H = new Float32Array(nu * nv).fill(NaN);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = u0 + (i + 0.5) * CELL, v = v0 + (j + 0.5) * CELL;
    const x = u * ux - v * uz, z = u * uz + v * ux;
    if (!pointInPoly(x, z, ring)) continue;
    const h = F.sample(x, z);
    if (!Number.isNaN(h)) H[j * nu + i] = h;
  }
  return { H, nu, nv, u0, v0 };
}

/** flood component of cells >= h containing (i0, j0); returns { cells:Int32Array of indices, bbox, area } */
function comp(G, h, i0, j0, blocked) {
  const { H, nu, nv } = G;
  const seen = new Uint8Array(nu * nv), q = [j0 * nu + i0];
  seen[q[0]] = 1;
  let ia = i0, ib = i0, ja = j0, jb = j0;
  for (let p = 0; p < q.length; p++) {
    const k = q[p], i = k % nu, j = (k / nu) | 0;
    if (i < ia) ia = i; if (i > ib) ib = i; if (j < ja) ja = j; if (j > jb) jb = j;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
      const kk = b * nu + a;
      if (seen[kk] || !(H[kk] >= h) || (blocked && blocked[kk])) continue;
      seen[kk] = 1; q.push(kk);
    }
  }
  return { cells: q, area: q.length * CELL * CELL, i0: ia, i1: ib, j0: ja, j1: jb };
}

function dpCurve(pts, tol) { // pts [[h, w]] -> kept indices (Douglas-Peucker on the width profile)
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const rec = (a, b) => {
    let md = 0, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const t = (pts[k][0] - pts[a][0]) / (pts[b][0] - pts[a][0] || 1);
      const d = Math.abs(pts[k][1] - (pts[a][1] + t * (pts[b][1] - pts[a][1])));
      if (d > md) { md = d; mi = k; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, pts.length - 1);
  return pts.map((_, k) => k).filter((k) => keep[k]);
}

/** a loft ring: n-gon around (cu, cv) with half widths (hu, hv); n = 4 -> the axis-aligned rectangle */
function ringPts(n, cu, cv, hu, hv) {
  if (n === 4) return [[cu - hu, cv - hv], [cu + hu, cv - hv], [cu + hu, cv + hv], [cu - hu, cv + hv]];
  const out = [], r = 1 / Math.cos(Math.PI / n);
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * Math.PI * 2; out.push([cu + Math.cos(a) * hu * r, cv + Math.sin(a) * hv * r]); }
  return out;
}

class Kit extends Comp {
  vtx(u, v, y) { // shared vertices (spire loft segments must form ONE connected accent patch for roof-report)
    this._vc ||= new Map();
    const key = `${u.toFixed(3)},${v.toFixed(3)},${y.toFixed(3)}`;
    let i = this._vc.get(key);
    if (i === undefined) { i = super.vtx(u, v, y); this._vc.set(key, i); }
    return i;
  }
  /** loft between two rings (arrays of [u, v]) at heights ya / yb; quads, outward normals computed from the ring centre */
  loftRings(ra, ya, rb, yb, mat, ca, cb) {
    const n = ra.length;
    const A = ra.map(([u, v]) => this.vtx(u, v, ya)), B = rb.map(([u, v]) => this.vtx(u, v, yb));
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const mu = (ra[k][0] + ra[k2][0] + rb[k][0] + rb[k2][0]) / 4 - (ca[0] + cb[0]) / 2, mv = (ra[k][1] + ra[k2][1] + rb[k][1] + rb[k2][1]) / 4 - (ca[1] + cb[1]) / 2;
      const ml = Math.hypot(mu, mv) || 1, dh = yb - ya;
      const wa = Math.hypot(ra[k][0] - ca[0], ra[k][1] - ca[1]), wb = Math.hypot(rb[k][0] - cb[0], rb[k][1] - cb[1]);
      const want = [(mu / ml) * Math.max(dh, 0.05), wa - wb, (mv / ml) * Math.max(dh, 0.05)];
      this.tri(A[k], A[k2], B[k2], mat, want); this.tri(A[k], B[k2], B[k], mat, want);
    }
  }
  fan(ra, ya, apex, mat, ca) { // ring -> apex point [u, v, y]
    const A = ra.map(([u, v]) => this.vtx(u, v, ya)), T = this.vtx(apex[0], apex[1], apex[2]);
    for (let k = 0; k < ra.length; k++) {
      const k2 = (k + 1) % ra.length;
      const mu = (ra[k][0] + ra[k2][0]) / 2 - ca[0], mv = (ra[k][1] + ra[k2][1]) / 2 - ca[1], ml = Math.hypot(mu, mv) || 1;
      const w = Math.hypot(ra[k][0] - ca[0], ra[k][1] - ca[1]);
      this.tri(A[k], A[k2], T, mat, [(mu / ml) * (apex[2] - ya), w, (mv / ml) * (apex[2] - ya)]);
    }
  }
  lid(ring, y, mat = 0) { // flat polygon lid (fan from the first vertex; convex rings only)
    const V = ring.map(([u, v]) => this.vtx(u, v, y));
    for (let k = 1; k + 1 < V.length; k++) this.tri(V[0], V[k], V[k + 1], mat, [0, 1, 0]);
  }
  /** thin gilded cross standing on (u, v, y) */
  cross(u, v, y, s = 1) {
    const w = 0.16 * s, hgt = 2.4 * s, bar = 0.7 * s;
    const mk = (r, y0, y1) => { const wl = this.wallsMat(r, y0, y1, 5); this.cap(r, y1, 5); return wl; };
    mk({ u0: u - w, u1: u + w, v0: v - w, v1: v + w }, y, y + hgt);
    mk({ u0: u - bar, u1: u + bar, v0: v - w, v1: v + w }, y + hgt * 0.62, y + hgt * 0.62 + w * 2.4);
  }
  wallsMat(r, y0, y1, mat) {
    const { u0, u1, v0, v1 } = r;
    this.quad([u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1], mat, [0, 0, -1]);
    this.quad([u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1], mat, [0, 0, 1]);
    this.quad([u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1], mat, [-1, 0, 0]);
    this.quad([u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1], mat, [1, 0, 0]);
  }
}

/** one tower / dome peak: returns { shaft, spire } description or null.  G = uv grid, (i, j) = peak cell */
function measurePeak(G, i, j, o, blocked) {
  const T = G.H[j * G.nu + i];
  const prof = []; // from the top downwards
  let prevArea = 0, base = null;
  for (let h = T - 0.25; h > 3; h -= 0.5) {
    const c = comp(G, h, i, j, blocked);
    if (prof.length >= 5) { // merged into the nave roof (half width jumps by > 3 m within 2 m, or the area explodes): the previous slice is the tower
      const ref = prof[prof.length - 4], md = ((c.i1 - c.i0 + 1) * CELL) / 2, md2 = ((c.j1 - c.j0 + 1) * CELL) / 2, rd = Math.max(ref.hu, ref.hv);
      if (Math.max(md, md2) - rd > 3 || c.area > 1.8 * ref.area + 30) { base = prof[prof.length - 1]; break; }
    }
    let su = 0, sv = 0; for (const k of c.cells) { su += k % G.nu; sv += (k / G.nu) | 0; }
    const n = c.cells.length;
    const e = { h, area: c.area, hu: ((c.i1 - c.i0 + 1) * CELL) / 2, hv: ((c.j1 - c.j0 + 1) * CELL) / 2, cu: G.u0 + (su / n + 0.5) * CELL, cv: G.v0 + (sv / n + 0.5) * CELL, cells: c.cells };
    e.fill = e.area / (4 * e.hu * e.hv);
    prof.push(e); prevArea = c.area;
  }
  if (prof.length < 4) return null;
  if (!base) base = prof[prof.length - 1];
  return { T, prof, base };
}

function addTower(C, G, pk, o) {
  const { prof, base, T } = pk;
  const hb = base.h;
  // shaft: contiguous run above the base whose area stays >= 0.8 of the base area
  let idx = prof.indexOf(base), top = idx;
  while (top > 0 && prof[top - 1].area >= 0.8 * base.area) top--;
  let shaftTop = prof[top].h;
  if (o.shaftTop) shaftTop = o.shaftTop;
  const round = (pk.round ?? (prof.slice(top, idx + 1).reduce((s, e) => s + e.fill, 0) / (idx - top + 1) < (o.roundFill ?? 0.82)));
  const n = round ? (Math.max(base.hu, base.hv) > 3 ? 12 : 8) : 4;
  const bc = [base.cu, base.cv];
  if (process.env.CHURCH_DEBUG) console.log('tower T', T.toFixed(1), 'base h', hb.toFixed(1), 'hu,hv', base.hu, base.hv, 'shaftTop', shaftTop, 'round', round, 'fills', prof.slice(top, idx + 1).map((e) => e.fill.toFixed(2)).join(','), 'profile', prof.filter((_, k) => k % 6 === 0).map((e) => e.h.toFixed(0) + ':' + e.hu + 'x' + e.hv).join(' '));
  const ring0 = ringPts(n, bc[0], bc[1], base.hu, base.hv);
  const y1 = Math.max(shaftTop, hb + 1);
  // shaft walls (ground to the shaft top)
  C.loftRings(ring0, 0, ring0, y1, 2, bc, bc);
  // spire rings from the measured profile above the shaft top
  const up = prof.filter((e) => e.h >= y1 - 0.01).reverse(); // bottom -> top
  const pts = up.map((e) => [e.h, Math.max(e.hu, e.hv)]);
  let keepIdx = pts.length > 2 ? dpCurve(pts, o.spireTol ?? 0.4) : [0, pts.length - 1];
  if (keepIdx.length > 12) keepIdx = keepIdx.filter((_, k) => k % 2 === 0 || k === keepIdx.length - 1);
  let rings = keepIdx.map((k) => up[k]);
  if (o.helm) { // curated baroque helm: [fraction of the spire height, fraction of the base half width] (galleries, bulbs, lantern, needle), centred on the measured apex
    const sh = T - y1, a0 = prof[0], bw0 = Math.max(base.hu, base.hv);
    rings = o.helm.map(([fh, fw]) => ({ h: y1 + sh * fh, hu: Math.max(0.2, bw0 * fw * (base.hu / bw0)), hv: Math.max(0.2, bw0 * fw * (base.hv / bw0)), cu: a0.cu, cv: a0.cv })).filter((e) => e.h < T - 0.3);
  }
  // the spire base is the shaft rect; scale the first measured ring up to it
  let prevR = ring0, prevH = y1, prevC = bc;
  const mat = T - y1 < 2.4 ? 1 : (o.spireMat ?? 3); // a stub roof is just roof colour, not an accent feature
  const bulbRatio = pts.length ? Math.max(...pts.map((p) => p[1])) / (base.hu > base.hv ? base.hu : base.hv) : 1;
  void bulbRatio;
  for (let k = 0; k < rings.length; k++) {
    const e = rings[k];
    if (e.h <= prevH + 0.2) continue;
    if (e.hu < 0.25 && e.hv < 0.25) break;
    const r = ringPts(n, e.cu, e.cv, Math.max(e.hu, 0.2), Math.max(e.hv, 0.2));
    C.loftRings(prevR, prevH, r, e.h, mat, prevC, [e.cu, e.cv]);
    prevR = r; prevH = e.h; prevC = [e.cu, e.cv];
  }
  const apex = [prof[0].cu, prof[0].cv, T + 0.1];
  C.fan(prevR, prevH, apex, mat, prevC);
  if (o.crosses) C.cross(apex[0], apex[1], T + 0.1, o.crossScale || 1);
  // analytic height function for volume / hmax
  const ringsH = [{ h: y1, hu: base.hu, hv: base.hv, cu: bc[0], cv: bc[1] }, ...rings.filter((e) => e.h > y1 + 0.2).map((e) => ({ h: e.h, hu: e.hu, hv: e.hv, cu: e.cu, cv: e.cv })), { h: T, hu: 0, hv: 0, cu: apex[0], cv: apex[1] }];
  C.parts.push({ h: (u, v) => {
    if (Math.abs(u - bc[0]) > base.hu || Math.abs(v - bc[1]) > base.hv) return -1;
    let best = y1;
    for (let k = 0; k + 1 < ringsH.length; k++) {
      const a = ringsH[k], b = ringsH[k + 1];
      const fit = (r) => Math.abs(u - r.cu) <= r.hu && Math.abs(v - r.cv) <= r.hv;
      for (let s = 0; s <= 4; s++) { const t = s / 4, r = { cu: a.cu + (b.cu - a.cu) * t, cv: a.cv + (b.cv - a.cv) * t, hu: a.hu + (b.hu - a.hu) * t, hv: a.hv + (b.hv - a.hv) * t }; if (fit(r)) best = Math.max(best, a.h + (b.h - a.h) * t); }
    }
    return best;
  } });
  return { rect: { u0: base.cu - base.hu - 0.6, u1: base.cu + base.hu + 0.6, v0: base.cv - base.hv - 0.6, v1: base.cv + base.hv + 0.6 }, cells: base.cells };
}

/** greedy maximal rectangles over a boolean mask; returns [{i0, i1, j0, j1}] */
function rectangles(mask, nu, nv, minArea, maxN) {
  const out = [];
  for (let n = 0; n < maxN; n++) {
    const hgt = new Int32Array(nu);
    let best = null;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) hgt[i] = mask[j * nu + i] ? hgt[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= nu; i++) {
        const cur = i < nu ? hgt[i] : 0;
        let start = i;
        while (st.length && st[st.length - 1][1] >= cur) {
          const [s, hh] = st.pop();
          const a = hh * (i - s);
          if (!best || a > best.a) best = { a, i0: s, i1: i - 1, j0: j - hh + 1, j1: j };
          start = s;
        }
        st.push([start, cur]);
      }
    }
    if (!best || best.a * CELL * CELL < minArea) break;
    out.push(best);
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) mask[j * nu + i] = 0;
  }
  return out;
}

/** main entry. F = Field (world frame), ring = cadastre ring (world), o = options (see keys below) */
export function churchFromField(F, ring, o = {}) {
  const mb = minBox(ring);
  const th = (Math.atan2(mb.uz, mb.ux) * 180) / Math.PI;
  const G = uvGrid(F, ring, mb);
  const { H, nu, nv } = G;
  const C = new Kit([0, 0], th);
  const vals = []; for (let k = 0; k < H.length; k++) if (H[k] >= 0.7) vals.push(H[k]);
  if (vals.length < 40) return null;
  const hmax = Math.max(...vals);
  const low = vals.filter((h) => h < 0.6 * hmax);
  const ridgeLevel = low.length ? pct(low, 0.85) : 0.5 * hmax;
  const margin = o.towerMargin ?? 3.5;
  const thr = Math.max(ridgeLevel + margin, (o.thrFrac ?? 0.45) * hmax);
  const footArea = vals.length * CELL * CELL;
  const blocked = new Uint8Array(nu * nv); // cells owned by towers
  const towers = [];
  const taken = new Uint8Array(nu * nv);
  if (o.central) { // whole footprint lofted to one apex
    let bi = 0, bh = -1; for (let k = 0; k < H.length; k++) if (H[k] > bh) { bh = H[k]; bi = k; }
    const pk = measurePeak(G, bi % nu, (bi / nu) | 0, o, null);
    if (!pk) return null;
    const t = addTower(C, G, { ...pk, round: o.round }, { ...o, shaftTop: o.shaftTop });
    towers.push(t);
    for (let k = 0; k < H.length; k++) if (H[k] >= 0.7) blocked[k] = 1;
  } else if (hmax >= ridgeLevel + (o.minTowerRise ?? 4.5) || o.forceTower) {
    for (let n = 0; n < (o.maxTowers ?? 3); n++) {
      let bi = -1, bh = thr;
      for (let k = 0; k < H.length; k++) if (!taken[k] && H[k] >= bh) { bh = H[k]; bi = k; }
      if (bi < 0) break;
      const pk = measurePeak(G, bi % nu, (bi / nu) | 0, o, null);
      if (!pk) { taken[bi] = 1; continue; }
      if (pk.base.area > (o.maxTowerFrac ?? 0.3) * footArea) { for (const k of pk.prof[pk.prof.length - 1].cells) taken[k] = 1; continue; } // a roof, not a tower
      if (pk.base.area < 7 && towers.length) { for (const k of pk.prof[pk.prof.length - 1].cells) taken[k] = 1; continue; }
      const t = addTower(C, G, pk, o);
      towers.push(t);
      const r = t.rect;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const u = G.u0 + (i + 0.5) * CELL, v = G.v0 + (j + 0.5) * CELL; if (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) { taken[j * nu + i] = 1; blocked[j * nu + i] = 1; } }
    }
  }
  // nave: rectangles over the footprint minus the towers
  const mask = new Uint8Array(nu * nv);
  for (let k = 0; k < H.length; k++) if (H[k] >= 1.5 && !blocked[k]) mask[k] = 1;
  const total = mask.reduce((s, x) => s + x, 0) * CELL * CELL;
  const rects = o.central ? [] : rectangles(mask, nu, nv, Math.max(10, total * 0.012), o.maxRects ?? 9);
  let eaveMax = 0;
  for (const r of rects) {
    const R = { u0: G.u0 + r.i0 * CELL, u1: G.u0 + (r.i1 + 1) * CELL, v0: G.v0 + r.j0 * CELL, v1: G.v0 + (r.j1 + 1) * CELL };
    const w = R.u1 - R.u0, d = R.v1 - R.v0;
    const axis = w >= d ? 'u' : 'v';
    const inner = []; const edge = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const h = H[j * nu + i]; if (Number.isNaN(h)) continue;
      inner.push(h);
      const across = axis === 'u' ? Math.min(j - r.j0, r.j1 - j) : Math.min(i - r.i0, r.i1 - i);
      if (across <= 1) edge.push(h);
    }
    if (inner.length < 8) continue;
    const eave = Math.max(3, Math.min(pct(edge.length ? edge : inner, 0.5), pct(inner, 0.5)));
    const ridge = pct(inner, 0.96);
    const rise = ridge - eave;
    eaveMax = Math.max(eaveMax, eave);
    C.walls(R, 0, eave);
    const sq = Math.max(w, d) / Math.min(w, d) < 1.25;
    if (rise < 1.3) C.cap(R, eave, 0), C.parts.push({ h: (u, v) => (u >= R.u0 && u <= R.u1 && v >= R.v0 && v <= R.v1 ? eave : -1) });
    else if (sq && rise > 2.5) { C.pyramid((R.u0 + R.u1) / 2, (R.v0 + R.v1) / 2, w / 2, d / 2, eave, rise, 1); }
    else {
      const ends = { lo: true, hi: true };
      C.gable(R, eave, Math.min(rise, Math.min(w, d) * 0.62), axis, ends);
    }
  }
  // apse: leftover cells (footprint minus rects minus towers) in one blob at a nave end -> 8-gon prism + cone
  if (!o.noApse && !o.central) {
    const left = new Uint8Array(nu * nv);
    const cov = new Uint8Array(nu * nv);
    for (const r of rects) for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) cov[j * nu + i] = 1;
    for (let k = 0; k < H.length; k++) if (H[k] >= 2 && !blocked[k] && !cov[k]) left[k] = 1;
    // largest connected leftover blob (compact, at the end of the nave) -> polygonal apse
    let bestComp = null; const seenL = new Uint8Array(nu * nv);
    for (let k0 = 0; k0 < H.length; k0++) {
      if (!left[k0] || seenL[k0]) continue;
      const q = [k0]; seenL[k0] = 1;
      for (let p = 0; p < q.length; p++) { const k = q[p], i = k % nu, j = (k / nu) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nu || b >= nu * 0 + nv) continue; const kk = b * nu + a; if (left[kk] && !seenL[kk]) { seenL[kk] = 1; q.push(kk); } } }
      if (!bestComp || q.length > bestComp.length) bestComp = q;
    }
    let cnt = 0, su = 0, sv = 0, hs = [];
    if (bestComp) for (const k of bestComp) { cnt++; su += k % nu; sv += (k / nu) | 0; hs.push(H[k]); }
    const compact = (() => { if (!cnt) return false; const cu0 = su / cnt, cv0 = sv / cnt; let rm = 0; for (const k of bestComp) rm = Math.max(rm, Math.hypot((k % nu) - cu0, ((k / nu) | 0) - cv0) * CELL); return rm < 1.6 * Math.sqrt((cnt * CELL * CELL) / Math.PI); })();
    if (compact && cnt * CELL * CELL > 22 && cnt * CELL * CELL < 0.2 * total) {
      const cu = G.u0 + (su / cnt + 0.5) * CELL, cv = G.v0 + (sv / cnt + 0.5) * CELL;
      let rmax = 0; for (const k of bestComp) { const u = G.u0 + ((k % nu) + 0.5) * CELL, v = G.v0 + (((k / nu) | 0) + 0.5) * CELL; rmax = Math.max(rmax, Math.hypot(u - cu, v - cv)); }
      const rad = Math.min(rmax, Math.sqrt((cnt * CELL * CELL) / Math.PI) * 1.25);
      const eave = Math.max(3, pct(hs, 0.3)), top = pct(hs, 0.95);
      const rg = ringPts(8, cu, cv, rad, rad);
      C.loftRings(rg, 0, rg, eave, 2, [cu, cv], [cu, cv]);
      if (top - eave > 1.2) { C.fan(rg, eave, [cu, cv, top], 1, [cu, cv]); C.parts.push({ h: (u, v) => { const r = Math.hypot(u - cu, v - cv); return r < rad ? eave + (top - eave) * (1 - r / rad) : -1; } }); }
      else { C.lid(rg, eave, 0); C.parts.push({ h: (u, v) => (Math.hypot(u - cu, v - cv) < rad ? eave : -1) }); }
    }
  }
  if (!C.parts.length) return null;
  return C.result({ u0: G.u0, u1: G.u0 + nu * CELL, v0: G.v0, v1: G.v0 + nv * CELL });
}

export const CHURCH_KIT = { churchFromField };

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Churches the reality mesh does not cover (no height grid): synthesise a 0.5 m height grid from the footprint and a few parameters, then run the same kit on it
 *  (so a grid-less church gets the same tower detection / nave gable / spire loft as a measured one).  spec: { eave, rise, tower?: { top, side, end: 1|-1, kind: 'needle'|'pyramid'|'onion', shaft } , dome?: { top, r } } */
export function synthChurchGrid(ring, spec) {
  const mb = minBox(ring), ux = mb.ux, uz = mb.uz;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 = Math.floor(x0 - 1); z0 = Math.floor(z0 - 1);
  const w = Math.ceil(x1 - x0 + 2) * 2, h = Math.ceil(z1 - z0 + 2) * 2;
  const cu = mb.cu, cv = mb.cv, hl = mb.L / 2, hw = mb.W / 2;
  const t = spec.tower, dm = spec.dome;
  const bytes = new Uint8Array(w * h);
  let p90 = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + (i + 0.5) * 0.5, z = z0 + (j + 0.5) * 0.5;
    if (!pointInPoly(x, z, ring)) continue;
    const u = x * ux + z * uz - cu, v = -x * uz + z * ux - cv;
    let y = spec.eave + (spec.rise ?? 0) * Math.max(0, 1 - Math.abs(v) / hw);
    if (t) {
      const tu = t.end * (hl - t.side), du = Math.abs(u - tu), dv = Math.abs(v), s = t.side;
      if (du <= s && dv <= s) {
        const shaft = t.shaft ?? spec.eave + (spec.rise ?? 0) + 4;
        if (t.kind === 'onion') { const r = Math.hypot(du, dv) / s; y = Math.max(y, shaft + (r < 1 ? (t.top - shaft) * Math.sqrt(Math.max(0, 1 - r * r)) * (1 + 0.15 * Math.sin(r * 3)) : 0)); }
        else { const f = Math.max(du, dv) / s; y = Math.max(y, f < 1 ? shaft + (t.top - shaft) * (1 - f) : shaft); }
      }
    }
    if (dm) { const r = Math.hypot(u - (dm.u || 0), v - (dm.v || 0)); if (r < dm.r) y = Math.max(y, spec.eave + spec.rise + (dm.top - spec.eave - spec.rise) * Math.sqrt(Math.max(0, 1 - (r / dm.r) ** 2))); }
    bytes[j * w + i] = Math.round(y / 0.5) + 1; p90.push(y);
  }
  const rle = []; for (let k = 0; k < bytes.length;) { let n = 1; while (k + n < bytes.length && bytes[k + n] === bytes[k] && n < 255) n++; rle.push(n, bytes[k]); k += n; }
  p90.sort((a, b) => a - b);
  return { grid: { x0, z0, cell: 0.5, w, h, scale: 0.5, data: Buffer.from(rle).toString('base64') }, hmax: p90[p90.length - 1], h90: p90[Math.floor(p90.length * 0.9)] };
}
