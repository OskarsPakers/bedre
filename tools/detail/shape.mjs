// Height grid -> compact game geometry. Two representations:
//   V1  "grid"   quantised height grid clipped to the footprint (Uint8, base64, RLE-friendly) meshed by the renderer
//   V2  "parts"  stacked prisms (+ roof primitives) fitted to the grid   (see fitParts)
// Plus tessellators used by the preview renderer (and a reference for the game-side renderer).
import zlib from 'node:zlib';
import { pip } from './dsm.mjs';

// ================================================================ V1: grid
/**
 * fg: footprintGrid() result with heights ABOVE ground in fg.hab (Float32, NaN outside/empty).
 * Output: { x0,z0,cell,w,h,scale,data } ; data = base64 of a byte array, 0 = outside footprint / no data,
 * v>0 -> height = (v-1)*scale (so scale 0.5 => 0..127 m, 1.0 => 0..254 m).
 */
export function encodeGrid(fg, hab, scale = 0.5) {
  const bytes = new Uint8Array(fg.w * fg.h);
  for (let k = 0; k < bytes.length; k++) {
    if (!fg.inside[k]) continue;
    let v = hab[k];
    if (Number.isNaN(v)) v = 0;
    bytes[k] = Math.max(1, Math.min(255, Math.round(Math.max(0, v) / scale) + 1));
  }
  return { x0: round(fg.x0, 2), z0: round(fg.z0, 2), cell: fg.cell, w: fg.w, h: fg.h, scale, data: Buffer.from(rle(bytes)).toString('base64'), _raw: bytes };
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** simple byte RLE: [count(1..255), value]* ; runs of >=3 only worth it but keeps decoding trivial */
export function rle(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    let j = i;
    while (j < bytes.length && bytes[j] === bytes[i] && j - i < 255) j++;
    out.push(j - i, bytes[i]);
    i = j;
  }
  return out;
}
export function unrle(arr, n) {
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i + 1 < arr.length; i += 2) for (let c = 0; c < arr[i]; c++) out[p++] = arr[i + 1];
  return out;
}
export function decodeGrid(g) {
  const raw = unrle(Buffer.from(g.data, 'base64'), g.w * g.h);
  const cells = new Float32Array(g.w * g.h);
  for (let k = 0; k < raw.length; k++) cells[k] = raw[k] ? (raw[k] - 1) * g.scale : NaN;
  return { ...g, cells };
}
export function gzipSize(obj) { return zlib.gzipSync(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)), { level: 9 }).length; }

/**
 * mesh a decoded grid (reference for the game-side mesher): per cell a quad whose corner heights are the mean of the
 * adjacent cells that are within `tol` metres of the cell's own height (so plateaus stay flat and slopes stay smooth),
 * plus vertical skirts wherever neighbouring cells disagree on a shared corner, plus walls down to 0 at the footprint edge.
 */
export function gridToTris(g, col = [190, 150, 120], wallCol = [200, 190, 175], tol = 1.2) {
  const { w, h, cell, cells } = g;
  const tris = [];
  const inside = (i, j) => i >= 0 && j >= 0 && i < w && j < h && !Number.isNaN(cells[j * w + i]);
  const val = (i, j) => cells[j * w + i];
  // corner heights per cell: ch[(j*w+i)*4 + c], c = 0:(i,j) 1:(i+1,j) 2:(i+1,j+1) 3:(i,j+1)
  const ch = new Float32Array(w * h * 4);
  const offs = [[[-1, -1], [0, -1], [-1, 0], [0, 0]], [[0, -1], [1, -1], [0, 0], [1, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[-1, 0], [0, 0], [-1, 1], [0, 1]]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inside(i, j)) continue;
    const v = val(i, j);
    for (let c = 0; c < 4; c++) {
      let s = 0, n = 0;
      for (const [di, dj] of offs[c]) { const a = i + di, b = j + dj; if (inside(a, b) && Math.abs(val(a, b) - v) <= tol) { s += val(a, b); n++; } }
      ch[(j * w + i) * 4 + c] = s / n;
    }
  }
  const X = (i) => g.x0 + i * cell, Z = (j) => g.z0 + j * cell;
  const quad = (p, q, p0, q0, c) => { tris.push({ a: p, b: q, c: q0, col: c }, { a: p, b: q0, c: p0, col: c }); };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inside(i, j)) continue;
    const k = (j * w + i) * 4;
    const a = [X(i), ch[k], Z(j)], b = [X(i + 1), ch[k + 1], Z(j)], c = [X(i + 1), ch[k + 2], Z(j + 1)], d = [X(i), ch[k + 3], Z(j + 1)];
    tris.push({ a, b, c, col }, { a, b: c, c: d, col });
    // edges: [neighbour di,dj, own corner pair, neighbour corner pair]
    const edges = [[0, -1, a, b, 3, 2], [1, 0, b, c, 0, 3], [0, 1, c, d, 1, 0], [-1, 0, d, a, 2, 1]];
    for (const [di, dj, p, q, nc0, nc1] of edges) {
      const ni = i + di, nj = j + dj;
      if (!inside(ni, nj)) { quad(p, q, [p[0], 0, p[2]], [q[0], 0, q[2]], wallCol); continue; }
      if (di + dj < 0) continue; // handle each shared edge once (from the lower index side)
      const nk = (nj * w + ni) * 4;
      // neighbour corner heights along the same edge (p<->nc0? orientation: own p matches neighbour corner nc1', see offsets)
      const np = ch[nk + (di === 1 ? 0 : 1)], nq = ch[nk + (di === 1 ? 3 : 0)];
      void nc0; void nc1;
      if (Math.abs(np - p[1]) > 0.05 || Math.abs(nq - q[1]) > 0.05) {
        const pn = [p[0], np, p[2]], qn = [q[0], nq, q[2]];
        // skirt between own edge (p,q) and neighbour edge (pn,qn): draw both-sided triangles
        tris.push({ a: p, b: q, c: qn, col: wallCol }, { a: p, b: qn, c: pn, col: wallCol });
      }
    }
  }
  return tris;
}

// ================================================================ V2 tessellation (parts)
function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function centroidOf(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
/** ear-clip triangulation of a simple polygon (any winding) -> index triples */
export function earClip(p) {
  const n = p.length;
  const idx = [...Array(n).keys()];
  if (polyArea(p) < 0) idx.reverse();
  const tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2];
      if (cross(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const m of idx) {
        if (m === i0 || m === i1 || m === i2) continue;
        const q = p[m];
        if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { tris.push([idx[0], idx[1], idx[2]]); idx.splice(1, 1); }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/**
 * Tessellate a V2 part list into render triangles.
 * part: {p:[[x,z]], y0, y1, roof:{shape,h,dir}, col}
 * Roof shapes: flat | gabled | hipped | pyramid | cone | dome | onion | skillion.
 * Reference implementation for the game-side renderer (same maths).
 */
export function partsToTris(parts, wallCol = [200, 190, 175], roofCol = [170, 90, 70]) {
  const tris = [];
  for (const part of parts) {
    const p = part.p, n = p.length, y0 = part.y0, y1 = part.y1;
    const rc = part.col ? hex(part.col) : roofCol;
    // walls
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      tris.push({ a: [a[0], y0, a[1]], b: [b[0], y0, b[1]], c: [b[0], y1, b[1]], col: wallCol }, { a: [a[0], y0, a[1]], b: [b[0], y1, b[1]], c: [a[0], y1, a[1]], col: wallCol });
    }
    const roof = part.roof || { shape: 'flat', h: 0 };
    const [cx, cz] = centroidOf(p);
    const hh = roof.h || 0;
    const shape = roof.shape;
    const dirRad = ((roof.dir || 0) * Math.PI) / 180;
    if (shape === 'flat' || !hh) {
      for (const [i, j, k] of earClip(p)) tris.push({ a: [p[i][0], y1, p[i][1]], b: [p[j][0], y1, p[j][1]], c: [p[k][0], y1, p[k][1]], col: rc });
      continue;
    }
    // roof height function over the polygon, evaluated on a fan of rings (cone/pyramid/dome/onion) or by planes (gabled/hipped/skillion)
    const radial = shape === 'pyramid' || shape === 'cone' || shape === 'dome' || shape === 'onion';
    if (radial) {
      const prof = (t) => { // t: 0 at eaves .. 1 at apex  -> height fraction at normalised radius (1-t)
        const r = 1 - t;
        if (shape === 'dome') return Math.sqrt(Math.max(0, 1 - r * r));
        if (shape === 'onion') return Math.sqrt(Math.max(0, 1 - r * r)) * (1 + 0.15 * Math.sin(r * Math.PI)); // bulge
        return t;
      };
      const rings = shape === 'pyramid' || shape === 'cone' ? 1 : 6;
      let maxR = 0;
      for (const q of p) maxR = Math.max(maxR, Math.hypot(q[0] - cx, q[1] - cz));
      for (let r = 0; r < rings; r++) {
        const t0 = r / rings, t1 = (r + 1) / rings;
        const sc0 = 1 - t0, sc1 = shape === 'dome' || shape === 'onion' ? Math.max(0, Math.cos((t1 * Math.PI) / 2)) : 1 - t1;
        const s0 = shape === 'dome' || shape === 'onion' ? Math.cos((t0 * Math.PI) / 2) : sc0;
        const hy = (tt) => y1 + hh * (shape === 'dome' || shape === 'onion' ? Math.sin((tt * Math.PI) / 2) : tt);
        for (let i = 0; i < n; i++) {
          const a = p[i], b = p[(i + 1) % n];
          const A0 = [cx + (a[0] - cx) * s0, hy(t0), cz + (a[1] - cz) * s0], B0 = [cx + (b[0] - cx) * s0, hy(t0), cz + (b[1] - cz) * s0];
          const A1 = [cx + (a[0] - cx) * sc1, hy(t1), cz + (a[1] - cz) * sc1], B1 = [cx + (b[0] - cx) * sc1, hy(t1), cz + (b[1] - cz) * sc1];
          tris.push({ a: A0, b: B0, c: B1, col: rc }, { a: A0, b: B1, c: A1, col: rc });
        }
        void prof; void maxR;
      }
      continue;
    }
    // planar roofs: height(x,z) = y1 + hh * f(u,v) in the frame of roof direction (u across the ridge, v along)
    // dir = ridge direction (deg from +x/east towards +z/south); `al` = coordinate along the ridge, `ac` = across it
    const cs = Math.cos(dirRad), sn = Math.sin(dirRad);
    let amax = 0, bmax = 0;
    for (const q of p) { amax = Math.max(amax, Math.abs((q[0] - cx) * cs + (q[1] - cz) * sn)); bmax = Math.max(bmax, Math.abs(-(q[0] - cx) * sn + (q[1] - cz) * cs)); }
    const f = (x, z) => {
      const al = (x - cx) * cs + (z - cz) * sn, ac = -(x - cx) * sn + (z - cz) * cs;
      if (shape === 'gabled') return Math.max(0, 1 - Math.abs(ac) / (bmax || 1));
      if (shape === 'hipped') return Math.max(0, Math.min(1 - Math.abs(ac) / (bmax || 1), (amax - Math.abs(al)) / (bmax || 1)));
      if (shape === 'skillion') return Math.max(0, Math.min(1, ac / (2 * (bmax || 1)) + 0.5));
      return 0;
    };
    // subdivide polygon triangles to follow the planes (simple 1-level midpoint subdivision x3)
    const stack = earClip(p).map(([i, j, k]) => [p[i], p[j], p[k], 0]);
    while (stack.length) {
      const [A, B, C, d] = stack.pop();
      if (d < 3) {
        const mAB = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], mBC = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2], mCA = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2];
        stack.push([A, mAB, mCA, d + 1], [mAB, B, mBC, d + 1], [mCA, mBC, C, d + 1], [mAB, mBC, mCA, d + 1]);
      } else {
        const V = (q) => [q[0], y1 + hh * f(q[0], q[1]), q[1]];
        tris.push({ a: V(A), b: V(B), c: V(C), col: rc });
      }
    }
  }
  return tris;
}
export const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export { pip, centroidOf, polyArea };
