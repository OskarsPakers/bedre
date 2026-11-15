// OSM building:part model -> clean game mesh (exact vertical prisms, planar gable/hip/skillion roofs, smooth lathe domes / onion domes / cones).
// Used for heroes whose OSM model is better than the measured mesh (e.g. the Nativity cathedral). Same return shape as planar.mjs.
// Part: { p:[[x,z]..], y0, y1, roof:{ shape, h, dir }, col? }  (y = metres above ground; dir = ridge direction, deg from +x towards +z)
import { ShapeUtils, Vector2 } from 'three';
import { pack } from './planar.mjs';

const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

/** keep the part of polygon `poly` where a*x + b*z + c >= 0 (Sutherland-Hodgman) */
function clip(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const dp = a * P[0] + b * P[1] + c, dq = a * Q[0] + b * Q[1] + c;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
  }
  return out;
}

// onion dome profile: [rho, t] rho = radius / base radius, t = height / roof height
const ONION = [[1, 0], [1.14, 0.1], [1.2, 0.24], [1.1, 0.42], [0.82, 0.6], [0.5, 0.76], [0.22, 0.89], [0.07, 0.96], [0, 1]];
const domeProfile = (K) => { const r = []; for (let k = 0; k <= K; k++) { const a = (k / K) * Math.PI / 2; r.push([Math.cos(a), Math.sin(a)]); } r[K][0] = 0; return r; };

export function partsMesh(parts, o = {}) {
  if (o.wallRoofRound === undefined) o = { ...o };
  const P = [], tris = [];
  const vtx = (x, y, z) => { P.push([x, y, z]); return P.length - 1; };
  const tri = (a, b, c, mat, want) => {
    const A = P[a], B = P[b], C = P[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-6) return;
    if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) tris.push([a, b, c, mat]); else tris.push([a, c, b, mat]);
  };
  let vol = 0, hmax = 0;
  const topFaces = []; // [x,z,y] triples for eave statistics
  for (const part of parts) {
    let ring = part.p.map((q) => [q[0], q[1]]);
    if (ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05) ring.pop();
    if (ring.length < 3) continue;
    const sgn = Math.sign(area2(ring)) || 1;
    const y0 = part.y0 || 0, y1 = Math.max(y0 + 0.1, part.y1);
    const roof = part.roof || { shape: 'flat', h: 0 };
    const hh = roof.h || 0;
    const n = ring.length;
    const [cx, cz] = [ring.reduce((s, q) => s + q[0], 0) / n, ring.reduce((s, q) => s + q[1], 0) / n];
    let maxR = 0, minR = 1e9;
    for (const q of ring) { const d = Math.hypot(q[0] - cx, q[1] - cz); maxR = Math.max(maxR, d); minR = Math.min(minR, d); }
    const round = ['dome', 'onion', 'cone'].includes(roof.shape) && hh > 0.2;
    const lowCap = round && maxR * 2 > 14 && hh < 0.25 * maxR * 2; // a shallow cap over a wide block is ordinary roof, not a gilded dome
    const domeMat = lowCap ? 1 : 3;
    let wall = ring;
    if (round && maxR / Math.max(0.1, minR) < 1.3 && n < 28) { // near-circular base: a regular polygon with enough segments (smooth drum + dome)
      const R = ring.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cz), 0) / n;
      const N = Math.max(16, Math.min(32, Math.ceil(R * 5)));
      wall = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; wall.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
    }
    const m = wall.length;
    // walls
    for (let i = 0; i < m; i++) {
      const a = wall[i], b = wall[(i + 1) % m];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      if (Math.hypot(ex, ez) < 0.05) continue;
      const want = [ez * sgn, 0, -ex * sgn];
      const a0 = vtx(a[0], y0, a[1]), b0 = vtx(b[0], y0, b[1]), b1 = vtx(b[0], y1, b[1]), a1 = vtx(a[0], y1, a[1]);
      tri(a0, b0, b1, 2, want); tri(a0, b1, a1, 2, want);
    }
    const poly = (pts, mat, y) => {
      const idx = ShapeUtils.triangulateShape(pts.map(([x, z]) => new Vector2(x, z)), []);
      const vs = pts.map(([x, z]) => vtx(x, y(x, z), z));
      for (const [i, j, k] of idx) tri(vs[i], vs[j], vs[k], mat, [0, 1, 0]);
      const ar = Math.abs(area2(pts)); vol += ar * (pts.reduce((s, q) => s + y(q[0], q[1]), 0) / pts.length);
    };
    const shape = hh > 0.2 ? roof.shape : 'flat';
    hmax = Math.max(hmax, y1 + (shape === 'flat' ? 0 : hh));
    if (shape === 'barrel') { /* handled below */ }
    if (shape === 'flat') { poly(wall, 0, () => y1); for (const q of wall) topFaces.push(y1); continue; }
    if (shape === 'gabled' || shape === 'hipped' || shape === 'skillion') {
      const th = ((roof.dir || 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
      let amax = 0, bmax = 0;
      for (const q of ring) { amax = Math.max(amax, Math.abs((q[0] - cx) * cs + (q[1] - cz) * sn)); bmax = Math.max(bmax, Math.abs(-(q[0] - cx) * sn + (q[1] - cz) * cs)); }
      bmax = bmax || 1; amax = amax || 1;
      // linear height functions of (x,z): al = (x-cx)cs + (z-cz)sn ; ac = -(x-cx)sn + (z-cz)cs
      const lin = (ka, kc, k0) => [ka * cs - kc * sn, ka * sn + kc * cs, k0 - (ka * (cx * cs + cz * sn)) - kc * (-cx * sn + cz * cs)];
      let faces = [];
      if (shape === 'gabled') faces = [{ f: lin(0, -1 / bmax, 1) }, { f: lin(0, 1 / bmax, 1) }];
      else if (shape === 'skillion') faces = [{ f: lin(0, 1 / (2 * bmax), 0.5) }];
      else {
        const fs = [lin(0, -1 / bmax, 1), lin(0, 1 / bmax, 1), lin(-1 / bmax, 0, amax / bmax), lin(1 / bmax, 0, amax / bmax)];
        faces = fs.map((f, i) => ({ f, others: fs.filter((_, j) => j !== i) }));
      }
      for (const face of faces) {
        let pl = wall;
        if (shape === 'gabled') { const first = faces[0] === face; pl = clip(wall, ...(first ? [lin(0, 1, 0)[0], lin(0, 1, 0)[1], lin(0, 1, 0)[2]] : [lin(0, -1, 0)[0], lin(0, -1, 0)[1], lin(0, -1, 0)[2]])); }
        if (face.others) for (const g of face.others) pl = clip(pl, g[0] - face.f[0], g[1] - face.f[1], g[2] - face.f[2]);
        if (pl.length < 3 || Math.abs(area2(pl)) < 0.05) continue;
        const fz = face.f;
        poly(pl, 1, (x, z) => y1 + hh * Math.max(0, fz[0] * x + fz[1] * z + fz[2]));
        for (const q of pl) topFaces.push(y1 + hh * Math.max(0, fz[0] * q[0] + fz[1] * q[1] + fz[2]));
      }
      continue;
    }
    if (shape === 'barrel') { // half-elliptic vault over an oriented rectangle (ring = 4 corners), end walls filled
      const th = ((roof.dir || 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
      let amax = 0, bmax = 0;
      for (const q of ring) { amax = Math.max(amax, Math.abs((q[0] - cx) * cs + (q[1] - cz) * sn)); bmax = Math.max(bmax, Math.abs(-(q[0] - cx) * sn + (q[1] - cz) * cs)); }
      const K = 10, P3 = (a, c, y) => vtx(cx + a * cs - c * sn, y, cz + a * sn + c * cs);
      const arc = []; for (let k = 0; k <= K; k++) { const t = -1 + (2 * k) / K; arc.push([t * bmax, y1 + hh * Math.sqrt(Math.max(0, 1 - t * t))]); }
      for (let k = 0; k < K; k++) {
        const [c0, h0] = arc[k], [c1, h1] = arc[k + 1];
        const a = P3(-amax, c0, h0), b = P3(amax, c0, h0), c = P3(amax, c1, h1), d = P3(-amax, c1, h1);
        const want = [-sn * ((c0 + c1) / 2 / bmax), 0.5 + 0.5 * (1 - Math.abs((c0 + c1) / 2 / bmax)), cs * ((c0 + c1) / 2 / bmax)];
        tri(a, b, c, 1, want); tri(a, c, d, 1, want);
      }
      for (const sgn of [-1, 1]) { // end walls under the vault ends
        const base = P3(sgn * amax, 0, y1), corners = arc.map(([cc, hy]) => P3(sgn * amax, cc, hy));
        for (let k = 0; k < K; k++) tri(base, corners[k], corners[k + 1], 2, [sgn * cs, 0, sgn * sn]);
      }
      vol += 4 * amax * bmax * (y1 + hh * 0.6);
      continue;
    }
    if (shape === 'pyramid') {
      const a0 = vtx(cx, y1 + hh, cz);
      for (let i = 0; i < m; i++) { const a = wall[i], b = wall[(i + 1) % m]; const va = vtx(a[0], y1, a[1]), vb = vtx(b[0], y1, b[1]); tri(va, vb, a0, 3, [(a[0] + b[0]) / 2 - cx, 0.6, (a[1] + b[1]) / 2 - cz]); }
      vol += Math.abs(area2(wall)) * (y1 + hh / 3);
      continue;
    }
    // dome / onion / cone: lathe over the (regular) base polygon
    const prof = roof.shape === 'onion' ? ONION.map(([r, t]) => [r, t]) : roof.shape === 'cone' ? [[1, 0], [0, 1]] : domeProfile(Math.max(5, Math.min(8, Math.round(maxR * 1.2))));
    let prev = wall.map(([x, z]) => vtx(x, y1, z));
    let prevP = prof[0];
    for (let q = 1; q < prof.length; q++) {
      const [rho, t] = prof[q];
      const cur = rho < 1e-4 ? (() => { const a = vtx(cx, y1 + hh * t, cz); return wall.map(() => a); })() : wall.map(([x, z]) => vtx(cx + (x - cx) * rho, y1 + hh * t, cz + (z - cz) * rho));
      const dr = (prevP[0] - rho) * maxR, dh = (t - prevP[1]) * hh;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const mx = (wall[i][0] + wall[j][0]) / 2 - cx, mz = (wall[i][1] + wall[j][1]) / 2 - cz, ml = Math.hypot(mx, mz) || 1;
        const l = Math.hypot(dr, dh) || 1;
        const want = [(mx / ml) * (dh / l), dr / l, (mz / ml) * (dh / l)];
        if (cur[i] === cur[j]) tri(prev[i], prev[j], cur[i], domeMat, want);
        else { tri(prev[i], prev[j], cur[j], domeMat, want); tri(prev[i], cur[j], cur[i], domeMat, want); }
      }
      prev = cur; prevP = prof[q];
    }
    vol += Math.abs(area2(wall)) * (y1 + hh * 0.5) * 0.7;
    if (o.crosses && !lowCap && roof.shape !== 'cone' && maxR < 9) { // little gilded cross on the apex (Orthodox)
      const top = y1 + hh, k = Math.max(0.8, Math.min(1.8, maxR * 0.3));
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const w = 0.12 * k;
        const quad = (x0, y0q, x1, y1q) => { const a = vtx(cx - dx * x1, top + y0q, cz - dz * x1), b = vtx(cx + dx * x1, top + y0q, cz + dz * x1), c = vtx(cx + dx * x1, top + y1q, cz + dz * x1), d = vtx(cx - dx * x1, top + y1q, cz - dz * x1); void x0; for (const sg of [1, -1]) { const want = [-dz * sg, 0, dx * sg]; tri(a, b, c, 5, want); tri(a, c, d, 5, want); } };
        quad(0, -0.2, w, 2.4 * k); quad(0, 1.5 * k, 0.8 * k, 1.5 * k + 2 * w);
      }
    }
  }
  if (!tris.length) return null;
  const packed = pack(P, tris);
  const ev = topFaces.length ? [...topFaces].sort((a, b) => a - b)[topFaces.length >> 1] : hmax * 0.6;
  return { verts: packed.verts, tris: packed.tris, loops: [], vol, hmax, eave: ev, info: { parts: parts.length } };
}
