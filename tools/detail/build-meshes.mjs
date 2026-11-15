// Offline mesher: tools/detail/data/riga-detail.json (height grids + OSM parts) + public/data/riga.json (footprints)
//   -> public/data/riga-shapes.bin.gz  (indexed, simplified, quantised low-poly shapes + measured heights; loaded by src/shapes.js)
//
// Per building: height field (mesh grid, or OSM parts rasterised and validated against the mesh) -> courtyards (cells < OPEN m) become open
// -> light bilateral denoise -> outline (the cadastre polygon itself, or a simplified contour when there are courtyards)
// -> error-bounded TIN of the roof (boundary points from the edge height profile, interior points by greedy worst-error insertion over a
//    Bowyer-Watson Delaunay triangulation, boundary segments recovered by splitting) -> triangle materials
//    (wall-like steep faces, spire/dome faces, ordinary roof). Walls are NOT stored: the game extrudes the outline loops down to y0.
//
// File: "BSH1" | u32 headerBytes | header JSON (space padded to 4) | Int16 verts | Uint16 tris | Uint8 mats | Int16 loops   (all gzip'd; 16-bit sections are byte-plane split: n low bytes then n high bytes)
//   usage: node build-meshes.mjs [--only=<id,id>] [--stats]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cleanRing, centroid, signedArea, pointInPoly } from '../../src/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../public/data');
const OUT = path.join(pub, 'riga-shapes.bin.gz');
const Q = 16; // position quantisation: 1/16 m
const OPEN = 0.7; // cells lower than this (m) are open ground (courtyards, terraces)
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean).map(Number);

const city = JSON.parse(fs.readFileSync(path.join(pub, 'riga.json'), 'utf8'));
const detail = JSON.parse(fs.readFileSync(path.join(here, 'data', 'riga-detail.json'), 'utf8')); // spike output (build-detail.mjs assemble); input only, not shipped
const byId = new Map(city.buildings.map((b) => [b.id, b]));

// ------------------------------------------------------------------ grids / fields
function unrle(arr, n) {
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i + 1 < arr.length; i += 2) for (let c = 0; c < arr[i]; c++) out[p++] = arr[i + 1];
  return out;
}
class Field {
  constructor(x0, z0, w, h, cell) { Object.assign(this, { x0, z0, w, h, cell }); this.H = new Float32Array(w * h).fill(NaN); this.S = new Uint8Array(w * h); this.fixed = new Uint8Array(w * h); }
  static fromGrid(g) {
    const f = new Field(g.x0, g.z0, g.w, g.h, g.cell);
    const raw = unrle(Buffer.from(g.data, 'base64'), g.w * g.h);
    for (let k = 0; k < raw.length; k++) if (raw[k]) f.H[k] = (raw[k] - 1) * g.scale;
    return f;
  }
  ok(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && !Number.isNaN(this.H[j * this.w + i]); }
  cx(i) { return this.x0 + (i + 0.5) * this.cell; }
  cz(j) { return this.z0 + (j + 0.5) * this.cell; }
  /** bilinear over valid (built) cells only; falls back to the nearest valid cell */
  sample(x, z) {
    const fx = (x - this.x0) / this.cell - 0.5, fz = (z - this.z0) / this.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
    let s = 0, wsum = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const i = i0 + di, j = j0 + dj;
      if (!this.ok(i, j)) continue;
      const wgt = (di ? tx : 1 - tx) * (dj ? tz : 1 - tz);
      s += this.H[j * this.w + i] * wgt; wsum += wgt;
    }
    if (wsum > 1e-6) return s / wsum;
    for (let r = 1; r < 6; r++) {
      let best = NaN, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r + 1; j++) for (let i = i0 - r; i <= i0 + r + 1; i++) {
        if (!this.ok(i, j)) continue;
        const d = (i - fx) ** 2 + (j - fz) ** 2;
        if (d < bd) { bd = d; best = this.H[j * this.w + i]; }
      }
      if (!Number.isNaN(best)) return best;
    }
    return NaN;
  }
}

// ------------------------------------------------------------------ OSM parts -> field
function ringGauge(ring, cx, cz) { // gauge function: |p| / ring radius in the direction of p
  return (x, z) => {
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const ex = bx - ax, ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - cx) * ez - (az - cz) * ex) / den, u = ((ax - cx) * dz - (az - cz) * dx) / den;
      if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
    }
    return best === Infinity ? 1 : Math.min(1.5, 1 / best);
  };
}
function partHeightFn(part) {
  const { p, y1 } = part, roof = part.roof || { shape: 'flat', h: 0 };
  const hh = roof.h || 0;
  if (roof.shape === 'flat' || !hh) return { f: () => y1, special: false };
  let cx = 0, cz = 0;
  for (const q of p) { cx += q[0]; cz += q[1]; }
  cx /= p.length; cz /= p.length;
  if (['pyramid', 'cone', 'dome', 'onion'].includes(roof.shape)) {
    const g = ringGauge(p, cx, cz);
    const sh = roof.shape;
    return { special: true, f: (x, z) => {
      const r = Math.min(1, g(x, z));
      if (sh === 'dome') return y1 + hh * Math.sqrt(Math.max(0, 1 - r * r));
      if (sh === 'onion') return y1 + hh * Math.sqrt(Math.max(0, 1 - r * r)) * (1 + 0.12 * Math.sin(r * Math.PI));
      return y1 + hh * (1 - r);
    } };
  }
  const dirRad = ((roof.dir || 0) * Math.PI) / 180, cs = Math.cos(dirRad), sn = Math.sin(dirRad);
  let amax = 0, bmax = 0;
  for (const q of p) { amax = Math.max(amax, Math.abs((q[0] - cx) * cs + (q[1] - cz) * sn)); bmax = Math.max(bmax, Math.abs(-(q[0] - cx) * sn + (q[1] - cz) * cs)); }
  bmax = bmax || 1;
  return { special: false, f: (x, z) => {
    const al = (x - cx) * cs + (z - cz) * sn, ac = -(x - cx) * sn + (z - cz) * cs;
    let v = 0;
    if (roof.shape === 'gabled') v = Math.max(0, 1 - Math.abs(ac) / bmax);
    else if (roof.shape === 'hipped') v = Math.max(0, Math.min(1 - Math.abs(ac) / bmax, (amax - Math.abs(al)) / bmax));
    else if (roof.shape === 'skillion') v = Math.max(0, Math.min(1, ac / (2 * bmax) + 0.5));
    return y1 + hh * v;
  } };
}
/** rasterise OSM parts onto the mesh field's grid; returns {osm: Field (NaN where uncovered), coverage, rms, topOsm} */
function osmField(mesh, parts) {
  const f = new Field(mesh.x0, mesh.z0, mesh.w, mesh.h, mesh.cell);
  for (const part of parts) {
    const { f: fn, special } = partHeightFn(part);
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const [x, z] of part.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const i0 = Math.max(0, Math.floor((x0 - f.x0) / f.cell)), i1 = Math.min(f.w - 1, Math.floor((x1 - f.x0) / f.cell));
    const j0 = Math.max(0, Math.floor((z0 - f.z0) / f.cell)), j1 = Math.min(f.h - 1, Math.floor((z1 - f.z0) / f.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * f.w + i;
      if (!mesh.ok(i, j)) continue;
      const x = f.cx(i), z = f.cz(j);
      if (!pointInPoly(x, z, part.p)) continue;
      const v = fn(x, z);
      if (!(f.H[k] >= v)) { f.H[k] = v; f.S[k] = special ? 1 : 0; }
    }
  }
  let n = 0, cov = 0, se = 0, topO = 0;
  for (let k = 0; k < mesh.H.length; k++) {
    if (Number.isNaN(mesh.H[k])) continue;
    n++;
    if (Number.isNaN(f.H[k])) continue;
    cov++; se += (f.H[k] - mesh.H[k]) ** 2; topO = Math.max(topO, f.H[k]);
  }
  return { osm: f, coverage: cov / Math.max(1, n), rms: Math.sqrt(se / Math.max(1, cov)), topOsm: topO };
}

// ------------------------------------------------------------------ outline helpers
function dpClosed(pts, tol) {
  const n = pts.length;
  if (n < 5) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), tol), b = dp(pts.slice(far).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function dp(pts, tol) {
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
function nearestOnRing(ring, x, z) {
  let bd = 1e9, bp = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; bp = [px, pz]; }
  }
  return { d: bd, p: bp };
}

/** boundary of the built cells as closed loops (built cell always on the same side => outer loops positive, holes negative) */
function traceLoops(F, built) {
  const { w, h } = F;
  const isB = (i, j) => i >= 0 && j >= 0 && i < w && j < h && built[j * w + i];
  const edges = new Map(); // start key -> [end key,...]
  const key = (i, j) => j * (w + 2) + i;
  const add = (a, b) => { const k = key(a[0], a[1]); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!built[j * w + i]) continue;
    if (!isB(i, j - 1)) add([i, j], [i + 1, j]);
    if (!isB(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!isB(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!isB(i - 1, j)) add([i, j + 1], [i, j]);
  }
  const loops = [];
  for (const [k0, lst0] of edges) {
    while (lst0.length) {
      const startI = k0 % (w + 2), startJ = Math.floor(k0 / (w + 2));
      const pts = [[startI, startJ]];
      let cur = lst0.pop();
      let guard = 0;
      while (guard++ < 200000) {
        if (cur[0] === startI && cur[1] === startJ) break;
        pts.push(cur);
        const lst = edges.get(key(cur[0], cur[1]));
        if (!lst || !lst.length) break;
        cur = lst.pop();
      }
      if (pts.length >= 4) loops.push(pts.map(([i, j]) => [F.x0 + i * F.cell, F.z0 + j * F.cell]));
    }
  }
  return loops;
}

// ------------------------------------------------------------------ Delaunay (Bowyer-Watson)
class Del {
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
    // deterministic sub-millimetre jitter keeps cocircular lattice points from producing degenerate cavities
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
    const ek = (u, v) => (u < v ? u * 262144 + v : v * 262144 + u);
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = ek(u, v); const e = cnt.get(k); if (e) e.n++; else cnt.set(k, { u, v, n: 1 }); }
    this.live = keep;
    for (const e of cnt.values()) if (e.n === 1) this._add(e.u, e.v, id);
  }
  edgeSet() {
    const s = new Set();
    for (const t of this.live) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) s.add(u < v ? u * 262144 + v : v * 262144 + u);
    return s;
  }
}

// ------------------------------------------------------------------ the mesher
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function bilateral(F, passes, sigmaR, keepFixed) {
  const { w, h, H } = F;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(H);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, v = H[k];
      if (Number.isNaN(v) || (keepFixed && F.fixed[k])) continue;
      let s = 0, ws = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (!F.ok(a, b)) continue;
        const u = H[b * w + a];
        const wr = Math.exp(-((u - v) ** 2) / (2 * sigmaR * sigmaR)), wsp = di === 0 && dj === 0 ? 1.4 : di === 0 || dj === 0 ? 1 : 0.7;
        s += u * wr * wsp; ws += wr * wsp;
      }
      out[k] = s / ws;
    }
    H.set(out);
  }
}

/** returns { verts:[[x,y,z]] (abs coords), tris:[[a,b,c,mat]], loops:[{idx,mat}], vol, hmax, eave } or null */
function meshBuilding(F, ring, o) {
  const { w, h, cell } = F;
  const N = w * h;
  // ---- built / open mask
  const built = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (!Number.isNaN(F.H[k]) && F.H[k] >= OPEN) built[k] = 1;
  const comp = (pred) => { // 4-connected components of cells satisfying pred
    const id = new Int32Array(N).fill(-1), list = [];
    for (let s = 0; s < N; s++) {
      if (id[s] >= 0 || !pred(s)) continue;
      const cid = list.length, cells = [s]; id[s] = cid;
      for (let q = 0; q < cells.length; q++) {
        const k = cells[q], i = k % w, j = (k - i) / w;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < 0 || b < 0 || a >= w || b >= h) continue;
          const kk = b * w + a;
          if (id[kk] < 0 && pred(kk)) { id[kk] = cid; cells.push(kk); }
        }
      }
      list.push(cells);
    }
    return list;
  };
  const insideCell = (k) => !Number.isNaN(F.H[k]);
  const cellA = cell * cell;
  // street-level skirt between the cadastre polygon and a tall wall (footprint / mesh misalignment): not part of the building
  {
    const R = Math.max(1, Math.round(3 / cell)), mx = new Float32Array(N);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let m = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (F.ok(i + di, j + dj)) m = Math.max(m, F.H[(j + dj) * w + i + di]);
      mx[j * w + i] = m;
    }
    for (let k = 0; k < N; k++) if (built[k] && F.H[k] < 3.0 && F.H[k] < 0.2 * mx[k] && mx[k] > 8) built[k] = 0;
  }
  // drop small built islands (if there is a large part), fill small open specks later
  const bcomps = comp((k) => built[k]);
  if (!bcomps.length) return null;
  const bmax = Math.max(...bcomps.map((c) => c.length));
  for (const c of bcomps) if (c.length * cellA < 8 && c.length < bmax) for (const k of c) built[k] = 0;
  const ocomps = comp((k) => insideCell(k) && !built[k]);
  let useContour = false;
  for (const c of ocomps) {
    if (c.length * cellA >= o.openMin) useContour = true;
  }
  if (!useContour) { for (let k = 0; k < N; k++) if (insideCell(k)) built[k] = 1; }
  else {
    // small open specks (< openMin) are filled
    for (const c of ocomps) if (c.length * cellA < o.openMin) for (const k of c) built[k] = 1;
  }
  // fill heights of cells that are built-but-low from neighbours (specks), keep >= 1 m
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let k = 0; k < N; k++) {
      if (!built[k] || F.H[k] >= OPEN) continue;
      const i = k % w, j = (k - i) / w; const vals = [];
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (F.ok(a, b) && F.H[b * w + a] >= OPEN && built[b * w + a]) vals.push(F.H[b * w + a]);
      if (vals.length) { F.H[k] = median(vals); changed = true; }
    }
    if (!changed) break;
  }
  for (let k = 0; k < N; k++) if (built[k] && F.H[k] < OPEN) F.H[k] = OPEN; // isolated leftovers
  for (let k = 0; k < N; k++) if (!built[k]) F.H[k] = NaN;
  if (o.open) { // grey opening (erode then dilate over built cells): removes needles / antennas narrower than ~1.5 cells, keeps ridges and plateaus
    for (const mode of [-1, 1]) {
      const out = new Float32Array(F.H);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i; if (Number.isNaN(F.H[k]) || F.fixed[k]) continue;
        let v = F.H[k];
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!F.ok(i + di, j + dj)) continue; const u = F.H[(j + dj) * w + i + di]; v = mode < 0 ? Math.min(v, u) : Math.max(v, u); }
        out[k] = v;
      }
      F.H.set(out);
    }
  }
  { // footprint vs mesh misalignment: rim cells that fall off a cliff (street level next to a tall wall) are lifted to the wall top
    const R = cell < 0.75 ? 2 : 1, out = new Float32Array(F.H);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (Number.isNaN(F.H[k]) || F.fixed[k]) continue;
      if (F.ok(i + 1, j) && F.ok(i - 1, j) && F.ok(i, j + 1) && F.ok(i, j - 1)) continue;
      let m = F.H[k];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (F.ok(i + di, j + dj)) m = Math.max(m, F.H[(j + dj) * w + i + di]);
      if (m - F.H[k] > 2.0) out[k] = m;
    }
    F.H.set(out);
  }
  bilateral(F, 2, o.sigma, true);

  // ---- outline loops (absolute coords, outer CCW positive / holes negative)
  let loops;
  if (!useContour) loops = [ring.slice()];
  else {
    loops = traceLoops(F, built).map((l) => dpClosed(l, o.contourTol));
    loops = loops.map((l) => l.map(([x, z]) => { const n = nearestOnRing(ring, x, z); return n.d < 0.8 ? n.p : [x, z]; }));
    loops = loops.map((l) => { const r = []; for (const q of l) { const t = r[r.length - 1]; if (!t || Math.hypot(t[0] - q[0], t[1] - q[1]) > 0.05) r.push(q); } while (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) <= 0.05) r.pop(); return r; });
    loops = loops.filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 5);
    if (!loops.length) return null;
  }

  // ---- vertices on the outline, subdividing along the height profile
  const px = [], pz = [], py = [];
  const dl = new Del(1e5);
  const addV = (x, z) => { const id = dl.addPoint(x, z); px[id] = x; pz[id] = z; py[id] = Math.max(1, F.sample(x, z)); return id; };
  const posKey = new Map();
  const vid = (x, z) => { const k = `${Math.round(x * 400)},${Math.round(z * 400)}`; let id = posKey.get(k); if (id === undefined) { id = addV(x, z); posKey.set(k, id); } return id; };
  const loopIds = [];
  for (const l of loops) {
    const ids = [];
    for (let i = 0; i < l.length; i++) {
      const [ax, az] = l[i], [bx, bz] = l[(i + 1) % l.length];
      const len = Math.hypot(bx - ax, bz - az);
      ids.push(vid(ax, az));
      const n = Math.max(1, Math.ceil(len / 0.5));
      if (n < 3) continue;
      const prof = [];
      for (let s = 0; s <= n; s++) { const t = s / n; prof.push([t * len, Math.max(1, F.sample(ax + (bx - ax) * t, az + (bz - az) * t))]); }
      for (let k = 1; k < prof.length - 1; k++) { const a = prof[k - 1][1], b = prof[k][1], c = prof[k + 1][1]; prof[k][1] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); } // median-3
      const keepP = dp(prof, Math.max(0.8, o.eps * 2));
      for (const [s] of keepP) {
        if (s < 0.3 || s > len - 0.3) continue;
        const t = s / len; ids.push(vid(ax + (bx - ax) * t, az + (bz - az) * t));
      }
    }
    loopIds.push(ids);
  }
  // loop vertex budget guard
  // ---- interior refinement
  const consEdges = () => { const s = new Set(); for (const ids of loopIds) for (let i = 0; i < ids.length; i++) { const a = ids[i], b = ids[(i + 1) % ids.length]; s.add(a < b ? a * 262144 + b : b * 262144 + a); } return s; };
  const planeAt = (t, x, z) => {
    const ax = px[t.a], az = pz[t.a], bx = px[t.b] - ax, bz = pz[t.b] - az, cx = px[t.c] - ax, cz = pz[t.c] - az;
    const det = bx * cz - bz * cx;
    if (Math.abs(det) < 1e-12) return null;
    const u = ((x - ax) * cz - (z - az) * cx) / det, v = ((z - az) * bx - (x - ax) * bz) / det;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) return null;
    return py[t.a] + u * (py[t.b] - py[t.a]) + v * (py[t.c] - py[t.a]);
  };
  const vcount = () => px.length - 3;
  // slope-aware tolerance: on steep faces a one-cell horizontal shift is a large vertical error (photogrammetry staircases) -> allow more
  const tol = new Float32Array(N);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; if (!built[k]) continue;
    const g = (a, b, c, d) => (F.ok(a, b) && F.ok(c, d) ? (F.H[d * w + c] - F.H[b * w + a]) / (2 * cell) : 0);
    const gx = g(i - 1, j, i + 1, j), gz = g(i, j - 1, i, j + 1);
    tol[k] = Math.min(2.4, o.eps + 0.6 * cell * Math.hypot(gx, gz));
  }
  for (let round = 0; round < o.rounds; round++) {
    const cands = [];
    for (const t of dl.live) {
      if (t.a < 3 || t.b < 3 || t.c < 3) continue;
      const xs = [px[t.a], px[t.b], px[t.c]], zs = [pz[t.a], pz[t.b], pz[t.c]];
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - F.x0) / cell - 0.5)), i1 = Math.min(w - 1, Math.ceil((Math.max(...xs) - F.x0) / cell - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - F.z0) / cell - 0.5)), j1 = Math.min(h - 1, Math.ceil((Math.max(...zs) - F.z0) / cell - 0.5));
      let be = 0, bx = 0, bz = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (!built[k]) continue;
        const x = F.cx(i), z = F.cz(j);
        const pl = planeAt(t, x, z);
        if (pl === null) continue;
        const e = Math.abs(F.H[k] - pl) - (tol[k] - o.eps);
        if (e > be) { be = e; bx = x; bz = z; }
      }
      if (be > o.eps) cands.push([be, bx, bz]);
    }
    if (!cands.length) break;
    cands.sort((a, b) => b[0] - a[0]);
    const room = o.maxVerts - vcount();
    if (room <= 0) break;
    const chosen = [];
    const sep2 = (cell * 1.1) ** 2;
    for (const c of cands) {
      if (chosen.length >= room) break;
      if (chosen.some((q) => (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 < sep2)) continue;
      chosen.push(c);
    }
    for (const c of chosen) { const k = `${Math.round(c[1] * 400)},${Math.round(c[2] * 400)}`; if (!posKey.has(k)) vid(c[1], c[2]); }
  }
  // ---- recover boundary segments by midpoint splitting
  for (let pass = 0; pass < 14; pass++) {
    const es = dl.edgeSet();
    let missing = 0;
    for (let li = 0; li < loopIds.length; li++) {
      const ids = loopIds[li];
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i], b = ids[(i + 1) % ids.length];
        if (es.has(a < b ? a * 262144 + b : b * 262144 + a)) continue;
        const len = Math.hypot(px[a] - px[b], pz[a] - pz[b]);
        if (len < 0.12) continue;
        const m = addV((px[a] + px[b]) / 2, (pz[a] + pz[b]) / 2);
        ids.splice(i + 1, 0, m);
        missing++; i++;
      }
    }
    if (!missing) break;
  }
  // ---- classify triangles (even-odd across constraint edges, starting from the super triangle)
  const cons = consEdges();
  const tris = dl.live;
  const emap = new Map();
  tris.forEach((t, ti) => { for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) { const k = u < v ? u * 262144 + v : v * 262144 + u; const e = emap.get(k); if (e) e.push(ti); else emap.set(k, [ti]); } });
  const par = new Int8Array(tris.length).fill(-1);
  const queue = [];
  tris.forEach((t, ti) => { if (t.a < 3 || t.b < 3 || t.c < 3) { par[ti] = 0; queue.push(ti); } });
  for (let q = 0; q < queue.length; q++) {
    const ti = queue[q], t = tris[ti];
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      const k = u < v ? u * 262144 + v : v * 262144 + u;
      const flip = cons.has(k) ? 1 : 0;
      for (const nj of emap.get(k)) if (par[nj] < 0) { par[nj] = (par[ti] + flip) & 1; queue.push(nj); }
    }
  }
  const roofTris = [];
  tris.forEach((t, ti) => {
    if (par[ti] !== 1) return;
    let { a, b, c } = t;
    const cr = (px[b] - px[a]) * (pz[c] - pz[a]) - (pz[b] - pz[a]) * (px[c] - px[a]);
    if (Math.abs(cr) < 1e-5) return;
    // normal (b-a)x(c-a) must point up (+y): n.y = (bz-az)*(cx-ax) - (bx-ax)*(cz-az)... choose orientation explicitly
    if (cr > 0) { const tmp = b; b = c; c = tmp; }
    roofTris.push([a, b, c]);
  });
  if (!roofTris.length) return null;

  // ---- materials
  const eaveVals = []; for (const ids of loopIds) for (const i of ids) eaveVals.push(py[i]);
  const eave = median(eaveVals);
  const triN = roofTris.map(([a, b, c]) => {
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a], vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return [nx, ny, nz];
  });
  // steep faces: connected steep components are facade-like (drums, parapets, steps, tower shafts) unless they taper to a point (spires)
  const mats = new Uint8Array(roofTris.length).fill(1);
  {
    const eMap = new Map();
    roofTris.forEach(([a, b, c], ti) => { if (triN[ti][1] >= 0.17) return; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * 262144 + v : v * 262144 + u; const e = eMap.get(k); if (e) e.push(ti); else eMap.set(k, [ti]); } });
    const cid = new Int32Array(roofTris.length).fill(-1);
    for (let s0 = 0; s0 < roofTris.length; s0++) {
      if (triN[s0][1] >= 0.17 || cid[s0] >= 0) continue;
      const members = [s0]; cid[s0] = s0;
      for (let q = 0; q < members.length; q++) {
        const [a, b, c] = roofTris[members[q]];
        for (const [u, v] of [[a, b], [b, c], [c, a]]) for (const nj of eMap.get(u < v ? u * 262144 + v : v * 262144 + u)) if (cid[nj] < 0) { cid[nj] = s0; members.push(nj); }
      }
      const vs = new Set(); for (const ti of members) for (const v of roofTris[ti]) vs.add(v);
      let ymin = 1e9, ymax = -1e9; for (const v of vs) { ymin = Math.min(ymin, py[v]); ymax = Math.max(ymax, py[v]); }
      const hg = ymax - ymin;
      const ext = (pred) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const v of vs) if (pred(py[v])) { x0 = Math.min(x0, px[v]); x1 = Math.max(x1, px[v]); z0 = Math.min(z0, pz[v]); z1 = Math.max(z1, pz[v]); } return Math.hypot(x1 - x0, z1 - z0); };
      const top = ext((y) => y > ymax - 0.25 * hg), bot = ext((y) => y < ymin + 0.25 * hg);
      const spire = hg >= 3 && top < 0.4 * bot && top < 3;
      if (!spire) for (const ti of members) mats[ti] = 2;
    }
  }
  // spires / domes / tower roofs: steep and high above the eaves (+ neighbours above the eaves), or OSM dome/cone/pyramid cells
  const special = new Uint8Array(roofTris.length);
  roofTris.forEach(([a, b, c], ti) => {
    if (mats[ti] !== 1) return;
    const cy = (py[a] + py[b] + py[c]) / 3;
    if (triN[ti][1] < 0.66 && cy > eave + 3.5) special[ti] = 1;
    else {
      const gx = (px[a] + px[b] + px[c]) / 3, gz = (pz[a] + pz[b] + pz[c]) / 3;
      const i = Math.floor((gx - F.x0) / cell), j = Math.floor((gz - F.z0) / cell);
      if (i >= 0 && j >= 0 && i < w && j < h && F.S[j * w + i] && cy > eave + 1.5) special[ti] = 1;
    }
  });
  const tEdge = new Map();
  roofTris.forEach(([a, b, c], ti) => { for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * 262144 + v : v * 262144 + u; const e = tEdge.get(k); if (e) e.push(ti); else tEdge.set(k, [ti]); } });
  const sp2 = Uint8Array.from(special);
  for (let pass = 0; pass < 3; pass++) {
    const cur = Uint8Array.from(sp2);
    roofTris.forEach(([a, b, c], ti) => {
      if (cur[ti] || mats[ti] !== 1) return;
      const cy = (py[a] + py[b] + py[c]) / 3;
      if (cy < eave + 2.5) return;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) for (const nj of tEdge.get(u < v ? u * 262144 + v : v * 262144 + u)) if (cur[nj]) sp2[ti] = 1;
    });
  }
  roofTris.forEach((_, ti) => { if (sp2[ti]) mats[ti] = 3; });

  // ---- volume / extremes, compact vertex arrays
  let vol = 0, hmax = 0;
  for (const [a, b, c] of roofTris) {
    const ar = Math.abs((px[b] - px[a]) * (pz[c] - pz[a]) - (pz[b] - pz[a]) * (px[c] - px[a])) / 2;
    vol += ar * (py[a] + py[b] + py[c]) / 3;
    hmax = Math.max(hmax, py[a], py[b], py[c]);
  }
  // order triangles by BFS over adjacency, renumber vertices by first use (indices become near-sequential => delta-coded in the file)
  const order = []; const seen = new Uint8Array(roofTris.length);
  for (let s0 = 0; s0 < roofTris.length; s0++) {
    if (seen[s0]) continue;
    seen[s0] = 1; const qq = [s0];
    for (let q = 0; q < qq.length; q++) {
      const ti = qq[q]; order.push(ti);
      const [a, b, c] = roofTris[ti];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) for (const nj of tEdge.get(u < v ? u * 262144 + v : v * 262144 + u)) if (!seen[nj]) { seen[nj] = 1; qq.push(nj); }
    }
  }
  const used = new Map(); const verts = [];
  const use = (i) => { let u = used.get(i); if (u === undefined) { u = verts.length; used.set(i, u); verts.push([px[i], py[i], pz[i]]); } return u; };
  const outTris = order.map((ti) => { const [a, b, c] = roofTris[ti]; return [use(a), use(b), use(c), mats[ti]]; });
  const outLoops = loopIds.map((ids) => ({ idx: ids.map(use), mat: 0 }));
  return { verts, tris: outTris, loops: outLoops, vol, hmax, eave };
}

// ------------------------------------------------------------------ main
const MIN_REG = /(\.|^)/;
void MIN_REG;
const outB = []; // per building records
const V = [], T = [], M = [], L = [];
const heightsRec = [];
for (const id of Object.keys(detail.heights)) heightsRec.push(+id, Math.round(detail.heights[id] * 10), Math.round((detail.heightsP50[id] ?? detail.heights[id]) * 10));

const stats = { mesh: 0, osm: 0, osmRejected: 0, failed: 0, tris: 0, verts: 0, contour: 0 };
const t0 = Date.now();
const ids = Object.keys(detail.buildings).filter((k) => !only.length || only.includes(+k));
let done = 0;
const rejected = [];
for (const key of ids) {
  const d = detail.buildings[key], b = byId.get(+key);
  if (!b || !(d.grid || d.osm)) continue;
  const ring0 = cleanRing(b.p || []);
  if (ring0.length < 3) continue;
  const area = Math.abs(signedArea(ring0));
  if (area < 5) continue;
  const [cx, cz] = centroid(ring0);
  if (!d.grid) continue;
  const notable = d.grid.cell < 0.75;
  const mesh = Field.fromGrid(d.grid);
  let F = mesh, src = 1, roofRGB = 0;
  if (d.osm && d.osm.length) {
    const r = osmField(mesh, d.osm);
    const topM = d.hmax ?? 0;
    const ok = r.coverage > 0.8 && r.rms < 4.2 && topM < r.topOsm * 1.05 + 1.5;
    if (ok) {
      F = new Field(mesh.x0, mesh.z0, mesh.w, mesh.h, mesh.cell);
      for (let k = 0; k < F.H.length; k++) {
        if (Number.isNaN(mesh.H[k])) continue;
        if (!Number.isNaN(r.osm.H[k])) { F.H[k] = r.osm.H[k]; F.S[k] = r.osm.S[k]; F.fixed[k] = 1; } else F.H[k] = mesh.H[k];
      }
      src = 2;
      const cp = d.osm.find((p) => p.col && p.roof && p.roof.shape !== 'flat');
      if (cp) roofRGB = parseInt(cp.col.slice(1), 16);
    } else { stats.osmRejected++; rejected.push([key, r.coverage.toFixed(2), r.rms.toFixed(1), topM, r.topOsm.toFixed(0)]); }
  }
  const opts = notable
    ? { eps: src === 2 ? 0.35 : 0.55, sigma: 0.75, open: false, rounds: 22, maxVerts: Math.min(1800, Math.round(60 + area * 0.5)), openMin: 14, contourTol: 0.42 }
    : { eps: 1.0, sigma: 1.0, open: true, rounds: 14, maxVerts: Math.min(160, Math.round(16 + area * 0.15)), openMin: 20, contourTol: 0.6 };
  let res = null;
  try { res = meshBuilding(F, ring0, opts); } catch (e) { console.warn('mesh failed', key, e.message); }
  if (!res) { stats.failed++; if (process.argv.includes('--why')) console.log('failed', key, area.toFixed(0), d.grid.w, d.grid.h); continue; }
  if (src === 2) stats.osm++; else if (notable) stats.mesh++; else stats.relief = (stats.relief || 0) + 1;
  // local coords, quantise
  const nv = res.verts.length;
  if (nv >= 32000) { stats.failed++; continue; }
  const vq = new Int16Array(nv * 3);
  res.verts.forEach(([x, y, z], i) => { vq[i * 3] = Math.round((x - cx) * Q); vq[i * 3 + 1] = Math.round(y * Q); vq[i * 3 + 2] = Math.round((z - cz) * Q); });
  const tq = new Uint16Array(res.tris.length * 3), mq = new Uint8Array(res.tris.length);
  let nextNew = 0;
  res.tris.forEach(([a, bb, c, m], i) => {
    [a, bb, c].forEach((v, k) => { if (v >= nextNew) { if (v !== nextNew) throw new Error('index order'); tq[i * 3 + k] = 0; nextNew++; } else tq[i * 3 + k] = nextNew - v; });
    mq[i] = m;
  });
  const lq = [];
  for (const l of res.loops) { lq.push(l.idx.length, 0, l.mat); for (const i of l.idx) lq.push(i); }
  V.push(vq); T.push(tq); M.push(mq); L.push(Int16Array.from(lq));
  outB.push([+key, nv, res.tris.length, lq.length, src === 2 ? 2 : notable ? 1 : 3, Math.round(res.vol), Math.round(res.hmax * 10), Math.round(res.eave * 10), roofRGB, 0]);
  stats.tris += res.tris.length; stats.verts += nv;
  if (++done % 200 === 0) console.log(`${done}/${ids.length} ${((Date.now() - t0) / 1000).toFixed(0)}s tris ${stats.tris}`);
}

const cat = (arrs, Ctor) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Ctor(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const bytesOf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
// 16-bit sections are stored as two byte planes (all low bytes, then all high bytes): the high plane is mostly zeros / constant, gzip loves it
const planes = (a) => { const b = bytesOf(a), n = a.length, o = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) { o[i] = b[i * 2]; o[n + i] = b[i * 2 + 1]; } return o; };
const parts = [pad4(planes(cat(V, Int16Array))), pad4(planes(cat(T, Uint16Array))), pad4(bytesOf(cat(M, Uint8Array))), pad4(planes(cat(L, Int16Array)))];
const header = {
  v: 1, q: Q,
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    credit: 'Building footprints, shapes and heights: © Rīgas valstspilsētas pašvaldība (georiga.eu); heights/shapes measured from the municipality reality model (mesh not shipped). Building parts: © OpenStreetMap contributors (ODbL).',
    stats,
  },
  rec: ['id', 'nv', 'nt', 'nl', 'src(1 mesh notable, 2 OSM parts, 3 mesh relief)', 'vol', 'hmax10', 'eave10', 'roofRGB', 'wallRGB'],
  b: outB.flat(),
  hs: heightsRec, // id, p90*10, p50*10
  bytes: parts.map((p) => p.length),
};
let hj = Buffer.from(JSON.stringify(header));
hj = hj.length % 4 ? Buffer.concat([hj, Buffer.from(' '.repeat(4 - (hj.length % 4)))]) : hj;
const head = Buffer.alloc(8); head.write('BSH1', 0, 'latin1'); head.writeUInt32LE(hj.length, 4);
const raw = Buffer.concat([head, hj, ...parts]);
if (!only.length) {
  fs.writeFileSync(OUT, zlib.gzipSync(raw, { level: 9 }));
  console.log(`wrote ${OUT}: raw ${raw.length} B, gz ${fs.statSync(OUT).size} B`);
}
console.log(JSON.stringify(stats), 'rejected OSM:', JSON.stringify(rejected.slice(0, 20)), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
