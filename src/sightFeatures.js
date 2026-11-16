// Signature features of sights (cheap parametric additions, one per sight): entrance canopy / portico, fly tower, roof lantern, crown, bell-cote, chimney, flag, masts, turrets,
// gables, round towers, clock tower ... They append geometry to a building's GeoBuilder (so they fall with it). Used by src/buildings.js for every sight (src/sights.js decides which).
// Spec d = { kind, base (y of the wall top / eave, m), flat (roof is flat), + per-kind options }. ring = centroid-relative CCW footprint. Returns the height added above `base`.
import * as THREE from 'three';
import { bbox, pointInPoly, minBox } from './geo.js';
import { obox, lathe } from './landmarks.js';

const NW = [1, 1, 1, 0];
const rgb = (c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };
const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LIGHT = rgb(0xeee6d2), DARK = rgb(0x2b2f35), GLASS = rgb(0xa9cde0), COPPER = rgb(0x3f8a76), WHITE = rgb(0xf4f2ea), RED = rgb(0xc8322d);
export const SF_KINDS = new Set(['canopy', 'portico', 'fly', 'cupola', 'redcross', 'flagpole', 'clocktower', 'ridge', 'crown', 'cote', 'stepgable', 'pgable', 'roundtowers', 'masts', 'chimney', 'watertower', 'porch', 'cornice', 'dome', 'mast', 'gatearch', 'turret1', 'wave', 'cat2', 'gabletrim', 'tent']);

function frame(ring) { const mb = minBox(ring); return { ux: mb.ux, uz: mb.uz, vx: -mb.uz, vz: mb.ux, cu: mb.cu, cv: mb.cv, L: mb.L, W: mb.W }; }
const at = (f, u, v) => [f.ux * u + f.vx * v, f.uz * u + f.vz * v];
/** the longest edge (the street-facing long side in practice): midpoint, unit tangent, outward normal, length */
function street(ring) {
  let best = null, bs = -1;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len > bs) { bs = len; best = { m: [(x0 + x1) / 2, (z0 + z1) / 2], u: [dx / len, dz / len], n: [dz / len, -dx / len], len, a: [x0, z0], b: [x1, z1] }; }
  }
  return best;
}
/** a point well inside the ring near (x, z): the point itself when inside, else the ring point nearest the centre scaled in */
function inside(ring, x, z) { if (pointInPoly(x, z, ring)) return [x, z]; for (const k of [0.8, 0.6, 0.4, 0.2, 0]) if (pointInPoly(x * k, z * k, ring)) return [x * k, z * k]; return [0, 0]; }

function pediment(b, c, u, n, w, ph, d, y, col, roofC) {
  const L = [c[0] - u[0] * w / 2, y, c[1] - u[1] * w / 2], R = [c[0] + u[0] * w / 2, y, c[1] + u[1] * w / 2], A = [c[0], y + ph, c[1]];
  const back = (p) => [p[0] - n[0] * d, p[1], p[2] - n[1] * d];
  const c2 = sh(col, 0.86), rc = roofC || c2;
  b.tri(L, R, A, col, col, col, NW, [n[0], 0, n[1]]);
  b.tri(back(L), back(R), back(A), c2, c2, c2, NW, [-n[0], 0, -n[1]]);
  const sl = Math.hypot(ph, w / 2);
  b.quad(R, A, back(A), back(R), rc, rc, rc, rc, NW, [u[0] * ph / sl, (w / 2) / sl, u[1] * ph / sl]);
  b.quad(A, L, back(L), back(A), rc, rc, rc, rc, NW, [-u[0] * ph / sl, (w / 2) / sl, -u[1] * ph / sl]);
}
function flagGeo(b, x, y, z, ux, uz, H = 7) {
  lathe(b, x, z, [[0.08, y], [0.08, y + H]], rgb(0xb9b3a6), 5);
  let yy = y + H - 0.1;
  for (const [hgt, c] of [[0.55, 0x9e1b32], [0.28, 0xffffff], [0.55, 0x9e1b32]]) {
    const col = rgb(c), a = [x, yy, z], bb = [x + ux * 2.0, yy, z + uz * 2.0], cc = [x + ux * 2.0, yy - hgt, z + uz * 2.0], dd = [x, yy - hgt, z];
    b.quad(a, bb, cc, dd, col, col, col, col, NW, [-uz, 0, ux]); b.quad(a, dd, cc, bb, col, col, col, col, NW, [uz, 0, -ux]);
    yy -= hgt;
  }
}
function cornerPoint(ring, su, sv, f) { // ring vertex extreme in direction (su, sv) of the frame, pulled inwards
  let best = ring[0], bs = -1e9;
  for (const q of ring) { const u = q[0] * f.ux + q[1] * f.uz, v = q[0] * f.vx + q[1] * f.vz, s = su * (u - f.cu) + sv * (v - f.cv); if (s > bs) { bs = s; best = q; } }
  return best;
}

export function addSightFeature(b, d, ring, wallCol, roofCol) {
  const wall = [wallCol.r, wallCol.g, wallCol.b], roof = [roofCol.r, roofCol.g, roofCol.b];
  const y = d.base ?? 8, f = frame(ring), e = street(ring);
  if (!e) return 0;
  const F = (t, o) => [e.m[0] + e.u[0] * t + e.n[0] * o, e.m[1] + e.u[1] * t + e.n[1] * o];
  switch (d.kind) {
    case 'canopy': { // flat entrance canopy on two posts over the middle of the street side
      const w = d.w || clamp(e.len * 0.4, 6, 14), D = 3.4, cy = clamp(y * 0.4, 3.2, 4.4), p = F(0, D / 2 - 0.2);
      obox(b, p[0], cy, p[1], w / 2, 0.22, D / 2, e.u[0], e.u[1], DARK);
      obox(b, p[0], cy + 0.3, p[1], w / 2 + 0.1, 0.1, D / 2 + 0.1, e.u[0], e.u[1], LIGHT);
      for (const s of [-1, 1]) { const q = F(s * (w / 2 - 0.5), D - 0.5); lathe(b, q[0], q[1], [[0.17, 0], [0.17, cy]], LIGHT, 6); }
      return 0;
    }
    case 'portico': { // steps + columns + entablature + pediment on the street side
      const w = d.w || clamp(e.len * 0.5, 8, 16), D = 3.6, ch = clamp(y * 0.62, 4, 9), n = w > 11 ? 6 : 4;
      let p = F(0, D / 2 - 0.4);
      obox(b, p[0], 0.3, p[1], w / 2 + 0.6, 0.3, D / 2 + 0.4, e.u[0], e.u[1], sh(LIGHT, 0.92));
      for (let i = 0; i < n; i++) { const q = F((i / (n - 1) - 0.5) * (w - 1.4), D - 0.9); lathe(b, q[0], q[1], [[0.55, 0.6], [0.45, 0.8], [0.4, ch + 0.4], [0.62, ch + 0.5], [0.62, ch + 0.9]], WHITE, 8); }
      p = F(0, D / 2 - 0.2);
      obox(b, p[0], ch + 1.2, p[1], w / 2 + 0.3, 0.3, D / 2 + 0.2, e.u[0], e.u[1], LIGHT);
      pediment(b, F(0, D + 0.1), e.u, e.n, w + 0.6, clamp(w * 0.13, 1.4, 2.4), D + 0.6, ch + 1.5, WHITE, sh(roof, 1));
      return Math.max(0, ch + 1.5 + clamp(w * 0.13, 1.4, 2.4) - y);
    }
    case 'fly': { // stage fly tower: a tall plain block behind the middle of the building
      const fu = clamp(e.len * (d.big ? 0.42 : 0.3), 4, 14), fv = clamp(f.W * 0.17, 3, 8), H = clamp(y * (d.big ? 0.85 : 0.55), 5, 14);
      const c = at(f, f.cu, f.cv), k = Math.max(f.W, f.L) * 0.1;
      const [x, z] = inside(ring, c[0] - e.n[0] * k, c[1] - e.n[1] * k);
      obox(b, x, y + H / 2, z, fu, H / 2, fv, e.u[0], e.u[1], sh(wall, 0.9));
      obox(b, x, y + H + 0.3, z, fu + 0.3, 0.3, fv + 0.3, e.u[0], e.u[1], DARK);
      return H + 0.6;
    }
    case 'cupola': { // small roof lantern with a pyramid cap at the middle
      const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), s = clamp(Math.min(f.L, f.W) * 0.07, 1.5, 2.6);
      obox(b, x, y + 1.0, z, s, 1.0, s, f.ux, f.uz, sh(wall, 1.05));
      obox(b, x, y + 2.15, z, s + 0.25, 0.15, s + 0.25, f.ux, f.uz, LIGHT);
      lathe(b, x, z, [[s * 1.55, y + 2.3], [0.05, y + 2.3 + s * 2.2]], COPPER, 4);
      return 2.3 + s * 2.2;
    }
    case 'redcross': {
      if (d.flat !== false) { // lying on the roof, readable from the steep game camera
        const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), hp = clamp(Math.min(f.L, f.W) * 0.26, 2.2, 5);
        obox(b, x, y + 0.12, z, hp, 0.12, hp, f.ux, f.uz, WHITE);
        obox(b, x, y + 0.3, z, hp * 0.8, 0.1, hp * 0.22, f.ux, f.uz, RED);
        obox(b, x, y + 0.3, z, hp * 0.22, 0.1, hp * 0.8, f.ux, f.uz, RED);
        return 0.45;
      }
      const p = F(0, 0.12), hp = 1.8, cy = clamp(y * 0.62, 3, 9);
      obox(b, p[0], cy, p[1], hp, hp, 0.1, e.u[0], e.u[1], WHITE);
      obox(b, p[0] + e.n[0] * 0.12, cy, p[1] + e.n[1] * 0.12, hp * 0.8, hp * 0.22, 0.06, e.u[0], e.u[1], RED);
      obox(b, p[0] + e.n[0] * 0.12, cy, p[1] + e.n[1] * 0.12, hp * 0.22, hp * 0.8, 0.06, e.u[0], e.u[1], RED);
      return 0;
    }
    case 'flagpole': {
      const q = cornerPoint(ring, 1, -1, f), k = 0.88;
      flagGeo(b, q[0] * k, y, q[1] * k, f.ux, f.uz, 7.5);
      return 7.5;
    }
    case 'clocktower': {
      const H = d.h || clamp(y * 0.8, 8, 14), s = 1.35, p = inside(ring, ...F(0, -Math.min(f.W * 0.3, 8)));
      obox(b, p[0], y + H / 2 - 0.5, p[1], s, H / 2 + 0.5, s, e.u[0], e.u[1], sh(wall, 1.04));
      obox(b, p[0], y + H - 0.2, p[1], s + 0.35, 0.2, s + 0.35, e.u[0], e.u[1], LIGHT);
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { // clock faces
        const cx = p[0] + e.u[0] * du * (s + 0.06) + e.n[0] * dv * (s + 0.06), cz = p[1] + e.u[1] * du * (s + 0.06) + e.n[1] * dv * (s + 0.06);
        obox(b, cx, y + H - 2.4, cz, du ? 0.05 : 0.85, 0.85, dv ? 0.05 : 0.85, e.u[0], e.u[1], WHITE);
        obox(b, cx, y + H - 2.4, cz, du ? 0.07 : 0.1, 0.55, dv ? 0.07 : 0.1, e.u[0], e.u[1], DARK);
      }
      lathe(b, p[0], p[1], [[s * 1.55, y + H], [0.06, y + H + 3.6]], rgb(d.cap || 0x3f8a76), 4);
      return H + 3.6;
    }
    case 'ridge': { // glazed ridge lantern along the long axis
      const L = f.L * (d.long ? 0.82 : 0.6), hw = clamp(f.W * 0.1, 0.9, 2.6), c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]);
      obox(b, x, y + 0.8, z, L / 2, 0.8, hw, f.ux, f.uz, GLASS);
      obox(b, x, y + 1.65, z, L / 2 + 0.2, 0.12, hw + 0.2, f.ux, f.uz, sh(roof, 1.1));
      return 1.8;
    }
    case 'crown': { // stepped crown + antenna with a red light
      const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), s = Math.min(f.L, f.W) * 0.5, col = d.glass ? rgb(0xcfe3ee) : sh(wall, 1.06);
      obox(b, x, y + 1.4, z, s * 0.62, 1.4, s * 0.62, f.ux, f.uz, col);
      obox(b, x, y + 3.5, z, s * 0.4, 0.8, s * 0.4, f.ux, f.uz, sh(col, 0.92));
      lathe(b, x, z, [[0.14, y + 4.3], [0.1, y + 12]], rgb(0xb9b3a6), 5);
      lathe(b, x, z, [[0.45, y + 11.6], [0.35, y + 12.4], [0.02, y + 12.8]], RED, 6);
      return 12.8;
    }
    case 'cote': { // bell-cote with a small cross at the front gable
      const p = F(0, -0.9), s = 0.8;
      obox(b, p[0], y + 1.1, p[1], s, 1.1, 0.5, e.u[0], e.u[1], sh(wall, 1.03));
      lathe(b, p[0], p[1], [[1.15, y + 2.2], [0.04, y + 3.6]], roof, 4);
      obox(b, p[0], y + 4.2, p[1], 0.08, 0.7, 0.08, e.u[0], e.u[1], rgb(0xe3b53c));
      obox(b, p[0], y + 4.35, p[1], 0.4, 0.07, 0.07, e.u[0], e.u[1], rgb(0xe3b53c));
      return 4.9;
    }
    case 'stepgable': { // stepped gable on the street side (walls only, trimmed in light stone)
      const steps = d.steps || 5, gw = d.w || clamp(e.len * 0.7, 5, 11), px = e.m[0] - e.n[0] * 0.5, pz = e.m[1] - e.n[1] * 0.5;
      let yy = y;
      for (let i = 0; i < steps; i++) {
        const w = gw * (1 - i / (steps + 0.7));
        obox(b, px, yy + 0.75, pz, w / 2, 0.75, 0.55, e.u[0], e.u[1], i % 2 ? wall : sh(wall, 1.05));
        obox(b, px + e.n[0] * 0.6, yy + 1.45, pz + e.n[1] * 0.6, w / 2, 0.08, 0.1, e.u[0], e.u[1], LIGHT);
        yy += 1.5;
      }
      lathe(b, px, pz, [[0.4, yy], [0.05, yy + 2]], rgb(0xd9b24a), 5);
      return yy - y + 2;
    }
    case 'gabletrim': { // House of the Blackheads: the two stepped gables of the measured shape (7 steps at -u, 5 at +u, tools/detail/build-meshes.mjs) get a light stone trim on every step
      const hl = f.L / 2, hw = f.W / 2, top = d.top || y + 8, steps = [7, 5], eave = top * 0.6;
      let ex = 0;
      [-1, 1].forEach((sg, k) => {
        const n = steps[k], c = at(f, f.cu + sg * hl, f.cv), dir = [f.vx, f.vz], col = LIGHT;
        const ox = f.ux * sg * 0.1, oz = f.uz * sg * 0.1;
        for (let i = 0; i < n; i++) {
          const w = hw * (1 - i / (n + 0.6)), y1 = eave + ((top - eave) * (i + 1)) / n, y0 = i ? eave + ((top - eave) * i) / n : eave;
          obox(b, c[0] + ox, y1 - 0.12, c[1] + oz, w, 0.12, 0.05, dir[0], dir[1], col);            // tread band
          for (const s2 of [-1, 1]) obox(b, c[0] + ox + dir[0] * s2 * (w - 0.1), (y0 + y1) / 2, c[1] + oz + dir[1] * s2 * (w - 0.1), 0.1, (y1 - y0) / 2, 0.05, dir[0], dir[1], col); // riser edges
        }
        lathe(b, c[0], c[1], [[0.45, top], [0.05, top + 2.4]], rgb(0xd9b24a), 5);
        ex = Math.max(ex, top - y + 2.4);
      });
      return ex;
    }
    case 'pgable': { // pointed gable on the street side
      const w = d.w || clamp(e.len * 0.5, 4, 9), ph = w * 0.62;
      pediment(b, F(0, 0.1), e.u, e.n, w, ph, 1.4, y, sh(wall, 1.02), roof);
      obox(b, F(0, 0.12)[0], y + ph * 0.38, F(0, 0.12)[1], w * 0.2, 0.9, 0.06, e.u[0], e.u[1], DARK);
      return ph;
    }
    case 'roundtowers': { // four round corner towers with conical roofs
      const r = clamp(Math.min(f.L, f.W) * 0.09, 2.0, 4.2), tc = sh(wall, 0.96), cone = d.roofCol ? rgb(d.roofCol) : sh(roof, 1);
      for (const [su, sv] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const q = cornerPoint(ring, su, sv, f), x = q[0] * 0.9, z = q[1] * 0.9;
        lathe(b, x, z, [[r, 0], [r, y + 3.2]], tc, 10);
        lathe(b, x, z, [[r + 0.25, y + 3.2], [r + 0.25, y + 3.6], [r * 1.12, y + 3.6], [0.04, y + 3.6 + r * 2.7]], cone, 10);
      }
      return 3.6 + r * 2.7;
    }
    case 'turret1': { // single corner turret
      const q = cornerPoint(ring, 1, 1, f), x = q[0] * 0.86, z = q[1] * 0.86, r = 1.5;
      lathe(b, x, z, [[r, y - 1], [r, y + 4.2]], sh(wall, 0.97), 8);
      lathe(b, x, z, [[r + 0.3, y + 4.2], [r + 0.3, y + 4.6], [0.03, y + 8]], COPPER, 8);
      return 8;
    }
    case 'cat2': { // Cat House: two corner turrets with black cats on their tips
      const black = rgb(0x15161a);
      let ex = 0;
      for (const [su, sv] of [[1, 1], [-1, -1]]) {
        const q = cornerPoint(ring, su, sv, f), x = q[0] * 0.86, z = q[1] * 0.86, r = 1.6, th = y + 3.8;
        lathe(b, x, z, [[r, y - 1.5], [r, th]], sh(wall, 0.97), 8);
        lathe(b, x, z, [[r + 0.3, th], [r + 0.3, th + 0.4], [0.04, th + 4.6]], rgb(0x4f8a78), 8);
        const yc = th + 4.5;
        obox(b, x, yc + 0.45, z, 0.7, 0.28, 0.2, 1, 0, black); obox(b, x + 0.75, yc + 0.78, z, 0.25, 0.25, 0.2, 1, 0, black);
        lathe(b, x + 0.72, z - 0.13, [[0.1, yc + 1.0], [0.02, yc + 1.38]], black, 4); lathe(b, x + 0.72, z + 0.13, [[0.1, yc + 1.0], [0.02, yc + 1.38]], black, 4);
        obox(b, x - 0.85, yc + 0.8, z, 0.12, 0.45, 0.07, 1, 0, black); obox(b, x - 0.75, yc + 1.28, z, 0.2, 0.08, 0.07, 1, 0, black);
        ex = Math.max(ex, th + 4.5 + 1.4 - y);
      }
      return ex;
    }
    case 'masts': { // four floodlight masts
      for (const [su, sv] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const q = cornerPoint(ring, su, sv, f), x = q[0] * 0.92, z = q[1] * 0.92, H = y + 9;
        lathe(b, x, z, [[0.25, 0], [0.18, H]], rgb(0xc9ced2), 6);
        obox(b, x, H + 0.4, z, 1.1, 0.4, 0.55, f.ux, f.uz, rgb(0xf4f2d8));
      }
      return 10;
    }
    case 'mast': { // radio mast
      const q = cornerPoint(ring, -1, 1, f), x = q[0] * 0.85, z = q[1] * 0.85;
      lathe(b, x, z, [[0.3, y], [0.12, y + 16]], rgb(0xc9ced2), 6);
      for (const k of [6, 11]) obox(b, x, y + k, z, 0.9, 0.05, 0.05, f.ux, f.uz, RED);
      return 16;
    }
    case 'chimney': {
      const H = clamp(10 + Math.sqrt(f.L * f.W) * 0.3, 18, 30), c = at(f, f.cu - f.L * 0.22, f.cv), [x, z] = inside(ring, c[0], c[1]), br = rgb(0xa4503a);
      lathe(b, x, z, [[1.25, 0], [0.9, H]], br, 10);
      lathe(b, x, z, [[0.95, H - 1.7], [0.95, H - 0.9]], rgb(0xe8e4da), 10);
      lathe(b, x, z, [[1.05, H], [1.15, H + 0.2], [1.15, H + 1.0], [0.95, H + 1.0]], sh(br, 0.7), 10);
      return H + 1;
    }
    case 'watertower': {
      const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), H = clamp(y + 12, 20, 30), r = clamp(Math.min(f.L, f.W) * 0.3, 1.8, 3);
      lathe(b, x, z, [[r, 0], [r * 0.95, H]], sh(wall, 0.95), 10);
      lathe(b, x, z, [[r * 1.1, H], [r * 2.0, H + 0.6], [r * 2.15, H + 3.2], [r * 1.9, H + 4.6], [r * 0.5, H + 6.4], [0.03, H + 7]], rgb(0xdfe5e8), 10);
      return H + 7;
    }
    case 'porch': {
      const w = 2.8, p = F(0, 0.9);
      obox(b, p[0], 1.3, p[1], w / 2, 1.3, 0.8, e.u[0], e.u[1], sh(wall, 1.12));
      pediment(b, F(0, 1.8), e.u, e.n, w + 0.6, 1.2, 1.9, 2.6, sh(wall, 1.12), roof);
      return 0;
    }
    case 'cornice': { // parapet band round the roof edge (flat roofs only)
      if (d.flat === false) return 0;
      const col = d.dark ? rgb(0x15171a) : LIGHT;
      for (let i = 0; i < ring.length; i++) {
        const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length], dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
        if (len < 0.8) continue;
        const ux = dx / len, uz = dz / len, mx = (x0 + x1) / 2 - uz * 0.0 - dz / len * 0.0, mz = (z0 + z1) / 2;
        obox(b, mx - (dz / len) * 0.22, y + 0.4, mz + (dx / len) * 0.22, len / 2, 0.4, 0.22, ux, uz, col);
      }
      return 0.8;
    }
    case 'dome': { // low copper dome on a drum at the middle
      const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), R = d.R ? Math.min(d.R, Math.min(f.L, f.W) * 0.45) : clamp(Math.min(f.L, f.W) * (d.r || 0.2), 2.5, 9);
      const dcol = d.col != null ? rgb(d.col) : COPPER;
      lathe(b, x, z, [[R, y], [R, y + R * 0.5]], d.drum != null ? rgb(d.drum) : sh(wall, 1.05), 14);
      lathe(b, x, z, [[R * 1.05, y + R * 0.5], [R * 1.0, y + R * 0.6], [R * 0.85, y + R * 1.1], [R * 0.5, y + R * 1.55], [R * 0.15, y + R * 1.85], [0.02, y + R * 2.0]], dcol, 14);
      lathe(b, x, z, [[0.1, y + R * 1.95], [0.1, y + R * 2.0 + 1.6]], rgb(0xe3b53c), 4);
      return R * 2 + 1.6;
    }
    case 'tent': { // low conical tent roof over the middle of the footprint (Tropu māja)
      const c = at(f, f.cu, f.cv), [x, z] = inside(ring, c[0], c[1]), R = Math.min(f.L, f.W) * 0.48;
      lathe(b, x, z, [[R, y - 0.3], [R * 0.98, y + 0.4], [R * 0.5, y + R * 0.22], [0.05, y + R * 0.42]], rgb(d.col || 0xb5523a), 18);
      return R * 0.42 + 0.4;
    }
    case 'gatearch': { // dark arched passage in the street front
      const p = F(0, 0.12), w = 2.6;
      obox(b, p[0], 1.9, p[1], w / 2 + 0.5, 1.9, 0.08, e.u[0], e.u[1], LIGHT);
      obox(b, p[0] + e.n[0] * 0.1, 1.8, p[1] + e.n[1] * 0.1, w / 2, 1.8, 0.06, e.u[0], e.u[1], rgb(0x23201e));
      obox(b, p[0] + e.n[0] * 0.1, 3.7, p[1] + e.n[1] * 0.1, w / 2 - 0.4, 0.35, 0.06, e.u[0], e.u[1], rgb(0x23201e));
      return 0;
    }
    case 'wave': { // wave-shaped canopy over the stage / seating
      const N = 16, L = f.L * 0.82, hv = clamp(f.W * 0.36, 3, 14), c = at(f, f.cu, f.cv);
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N - 0.5, hgt = 1.2 + 1.0 * (0.5 + 0.5 * Math.sin(i * 0.9)), cx = c[0] + f.ux * t * L, cz = c[1] + f.uz * t * L;
        obox(b, cx, y + 0.3 + hgt / 2, cz, L / N / 2 + 0.02, hgt / 2, hv, f.ux, f.uz, rgb(i % 2 ? 0xe6ecef : 0xd4dce1));
      }
      return 3;
    }
    default: return 0;
  }
}
void bbox;
