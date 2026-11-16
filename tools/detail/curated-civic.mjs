// Curated parametric civic landmarks (owner: civic agent). Extends the kit of curated.mjs (Comp: prisms, mansards, gables, stepped gables, pyramids) with
// cylinders / cones / domes, barrel vaults with glazed gables, colonnades + pediments, clock faces, curtain-wall slabs, canopies and cable pylons.
//
// Same frame and return shape as curated.mjs: world (x east, z south) = O + u*U + v*V; most buildings here use O = (0,0), theta = 0, i.e. (u, v) = world (x, z)
// so the numbers in the specs are the world coordinates measured from the height grids (tools/detail/region-map.mjs prints them).
// Materials: 0 flat roof, 1 pitched roof, 2 wall (window grid of the hero's facade style), 3 accent = whole spire / dome (hero.dome colour),
//            5 accent2 (hero.accent colour: clock faces, gilding), 6 plain wall-coloured face (no windows: columns, pilasters, tympana, parapets),
//            7 glass (tinted panes, curtain walls, glazed gables), 8 dark trim (clock hands, frames, mullions).
// Every builder takes (hero, ctx) with ctx = { ring (footprint of the host cadastre piece, absolute), key, d (detail record) } and returns the curated mesh
// ({ verts, tris, loops: [], vol, hmax, eave, area }); `features` builders (Features) return an extra Comp that build-meshes.mjs merges into a measured mesh.
import { Comp } from './curated.mjs';
import { pack } from './planar.mjs';
import { minBox } from '../../src/geo.js';

const TAU = Math.PI * 2;
const R4 = (u0, u1, v0, v1) => ({ u0, u1, v0, v1 });

export class Civic extends Comp {
  constructor(O = [0, 0], th = 0) { super(O, th); }
  /** n-gon (or any convex / star-shaped about its centre) closed polygon of [u, v] points, walls from y0 to y1 with outward normals; mat 2 (windows) by default */
  polyWalls(pts, y0, y1, mat = 2) {
    let cu = 0, cv = 0; for (const [u, v] of pts) { cu += u; cv += v; } cu /= pts.length; cv /= pts.length;
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
      const mu = (a[0] + b[0]) / 2 - cu, mv = (a[1] + b[1]) / 2 - cv;
      this.quad([a[0], a[1], y0], [b[0], b[1], y0], [b[0], b[1], y1], [a[0], a[1], y1], mat, [mu, 0, mv]);
    }
  }
  polyCap(pts, y, mat = 0, up = 1) {
    const ids = pts.map(([u, v]) => this.vtx(u, v, y));
    for (let i = 1; i < ids.length - 1; i++) this.tri(ids[0], ids[i], ids[i + 1], mat, [0, up, 0]);
  }
  ngon(cu, cv, r, seg, rot = 0) { const o = []; for (let i = 0; i < seg; i++) { const a = rot + (i / seg) * TAU; o.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]); } return o; }
  /** cylinder / drum (optionally tapering to r1) from y0 to y1; cap = false | material of the flat top */
  cyl(cu, cv, r, y0, y1, o = {}) {
    const seg = o.seg || 16, r1 = o.r1 ?? r, mat = o.mat ?? 2, rot = o.rot || 0;
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * TAU, a1 = rot + ((i + 1) / seg) * TAU, am = (a0 + a1) / 2;
      const p = (a, rr, y) => [cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, y];
      this.quad(p(a0, r, y0), p(a1, r, y0), p(a1, r1, y1), p(a0, r1, y1), mat, [Math.cos(am), (r - r1) / Math.max(0.01, y1 - y0), Math.sin(am)]);
    }
    if (o.cap !== false && o.cap !== undefined) this.polyCap(this.ngon(cu, cv, r1, seg, rot), y1, o.cap === true ? 0 : o.cap);
    this.parts.push({ h: (u, v) => (Math.hypot(u - cu, v - cv) <= Math.max(r, r1) ? y1 : -1) });
  }
  /** cone from radius r0 at y0 up to radius r1 (0 = apex) at y1 */
  cone(cu, cv, r0, y0, y1, o = {}) {
    const seg = o.seg || 16, r1 = o.r1 ?? 0, mat = o.mat ?? 3, rot = o.rot || 0;
    const apex = r1 < 0.02 ? this.vtx(cu, cv, y1) : -1;
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * TAU, a1 = rot + ((i + 1) / seg) * TAU, am = (a0 + a1) / 2;
      const want = [Math.cos(am) * (y1 - y0), r0 - r1, Math.sin(am) * (y1 - y0)];
      const p0 = this.vtx(cu + Math.cos(a0) * r0, cv + Math.sin(a0) * r0, y0), p1 = this.vtx(cu + Math.cos(a1) * r0, cv + Math.sin(a1) * r0, y0);
      if (apex >= 0) this.tri(p0, p1, apex, mat, want);
      else { const q0 = this.vtx(cu + Math.cos(a0) * r1, cv + Math.sin(a0) * r1, y1), q1 = this.vtx(cu + Math.cos(a1) * r1, cv + Math.sin(a1) * r1, y1); this.tri(p0, p1, q1, mat, want); this.tri(p0, q1, q0, mat, want); }
    }
    this.parts.push({ h: (u, v) => { const d = Math.hypot(u - cu, v - cv); return d > r0 ? -1 : y0 + (y1 - y0) * (1 - Math.max(0, d - r1) / Math.max(0.01, r0 - r1)) * (d <= r1 ? 1 : 1); } });
  }
  /** lathe profile [[r, y], ...] bottom -> top (absolute y); last radius 0 closes at the apex */
  lathe(cu, cv, prof, o = {}) {
    const seg = o.seg || 16, mat = o.mat ?? 3, rot = o.rot || 0;
    for (let k = 0; k < prof.length - 1; k++) {
      const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
      if (Math.abs(r0) < 0.01 && Math.abs(r1) < 0.01) continue;
      if (Math.abs(y1 - y0) < 1e-4 && Math.abs(r0 - r1) < 1e-4) continue;
      this.cone(cu, cv, r0, y0, y1, { seg, r1, mat, rot, _skipPart: true });
      this.parts.pop();
    }
    let hmax = 0, rmax = 0; for (const [r, y] of prof) { hmax = Math.max(hmax, y); rmax = Math.max(rmax, r); }
    this.parts.push({ h: (u, v) => { const d = Math.hypot(u - cu, v - cv); if (d > rmax) return -1; let best = -1; for (let k = 0; k < prof.length - 1; k++) { const [r0, y0] = prof[k], [r1, y1] = prof[k + 1]; const lo = Math.min(r0, r1), hi = Math.max(r0, r1); if (d >= lo && d <= hi) { const t = hi - lo < 1e-6 ? 1 : (d - r0) / (r1 - r0); best = Math.max(best, y0 + (y1 - y0) * Math.max(0, Math.min(1, t))); } } return best; } });
  }
  /** hemispherical / elliptical dome of base radius r, rise `rise`, from y0; rings along the meridian */
  dome(cu, cv, r, y0, rise = r, o = {}) {
    const rings = o.rings || 5, prof = [];
    for (let k = 0; k <= rings; k++) { const a = (k / rings) * Math.PI / 2; prof.push([k === rings ? 0 : Math.cos(a) * r, y0 + Math.sin(a) * rise]); }
    this.lathe(cu, cv, prof, { seg: o.seg || 16, mat: o.mat ?? 3 });
  }
  /** barrel vault over rect r (ridge along `axis` 'u' | 'v'): section = circular segment springing at y0 with half chord hw and crown y0 + rise (`seg: true`) or a semi-ellipse;
   *  gable ends: o.ends = { lo, hi } = 'glass' | 'wall' | falsy; glazed ends start above o.sill (solid wall below). Walls below y0 are NOT added. */
  vault(r, y0, rise, axis, o = {}) {
    const N = o.n || 12, ends = o.ends || {}, sill = o.sill ?? 3;
    const along = axis === 'u', c = along ? (r.v0 + r.v1) / 2 : (r.u0 + r.u1) / 2, hw = along ? (r.v1 - r.v0) / 2 : (r.u1 - r.u0) / 2;
    const a0 = along ? r.u0 : r.v0, a1 = along ? r.u1 : r.v1, mat = o.mat ?? 1;
    let sec; // [offset, y] for t in 0..1, left -> right over the crown
    if (o.segmental) { const R = (hw * hw + rise * rise) / (2 * rise), yc = y0 + rise - R, ph = Math.asin(Math.min(1, hw / R)); sec = (t) => { const a = -ph + 2 * ph * t; return [R * Math.sin(a), yc + R * Math.cos(a)]; }; }
    else sec = (t) => { const a = Math.PI * (1 - t); return [hw * Math.cos(a), y0 + rise * Math.sin(a)]; }; // a: pi -> 0 gives offset -hw -> +hw
    const pts = []; for (let i = 0; i <= N; i++) pts.push(sec(i / N));
    const P = (off, a, y) => (along ? [a, c + off, y] : [c + off, a, y]);
    for (let i = 0; i < N; i++) {
      const [o0, y_0] = pts[i], [o1, y_1] = pts[i + 1], dO = o1 - o0, dY = y_1 - y_0;
      const nO = -dY, nY = dO; // outward normal in (offset, y)
      this.quad(P(o0, a0, y_0), P(o1, a0, y_1), P(o1, a1, y_1), P(o0, a1, y_0), mat, along ? [0, nY, nO] : [nO, nY, 0]);
    }
    for (const [end, a, s] of [[ends.lo, a0, -1], [ends.hi, a1, 1]]) {
      if (!end) continue;
      const m = end === 'glass' ? 7 : (o.wallMat ?? 2), ya = end === 'glass' ? sill : y0;
      const poly = [[-hw, ya], ...pts.map((p) => [p[0], p[1]]), [hw, ya]];
      const ids = poly.map(([off, y]) => { const q = P(off, a, y); return this.vtx(q[0], q[1], q[2]); });
      const base = this.vtx(...P(0, a, ya));
      const want = along ? [s, 0, 0] : [0, 0, s];
      for (let i = 0; i < ids.length - 1; i++) this.tri(ids[i], ids[i + 1], base, m, want);
      this.tri(ids[ids.length - 1], ids[0], base, m, want);
    }
    const ys = pts.map((p) => p[1]);
    this.parts.push({ h: (u, v) => { const x = along ? v : u, a = along ? u : v; if (a < a0 || a > a1 || Math.abs(x - c) > hw) return -1; const f = Math.abs(x - c) / hw; let best = y0; for (let i = 0; i < N; i++) { const lo = Math.min(Math.abs(pts[i][0]), Math.abs(pts[i + 1][0])) / hw, hi = Math.max(Math.abs(pts[i][0]), Math.abs(pts[i + 1][0])) / hw; if (f >= lo && f <= hi) best = Math.max(best, Math.min(...ys.slice(i, i + 2)) + 0.5 * Math.abs(ys[i + 1] - ys[i])); } return best; } });
  }
  /** row of n columns (8-gon prisms, plain wall colour) from [u0, v0] to [u1, v1] */
  colonnade(u0, v0, u1, v1, n, r, y0, y1, o = {}) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1), u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
      this.cyl(u, v, r, y0, y1, { seg: o.seg || 8, mat: 6, cap: false });
      if (o.capital !== false) this.cyl(u, v, r * 1.35, y1 - 0.45, y1, { seg: o.seg || 8, mat: 6, cap: 6 });
    }
  }
  /** vertical rectangular panel on a wall: centre [u, v], facing direction [du, dv] (unit), bottom y0 / top y1, width w, mat; sits `off` proud of the plane */
  panel(u, v, du, dv, y0, y1, w, mat, off = 0.12) {
    const tu = -dv, tv = du, hu = w / 2;
    this.quad([u + tu * -hu + du * off, v + tv * -hu + dv * off, y0], [u + tu * hu + du * off, v + tv * hu + dv * off, y0], [u + tu * hu + du * off, v + tv * hu + dv * off, y1], [u + tu * -hu + du * off, v + tv * -hu + dv * off, y1], mat, [du, 0, dv]);
  }
  /** clock face on a wall: disc (cream, mat 5) + two hands (mat 8); centre [u, v] on the wall plane, facing [du, dv], height yc, radius r */
  clock(u, v, du, dv, yc, r, t = [10, 10]) {
    const tu = -dv, tv = du, off = 0.14, N = 14;
    const P = (s, y, o2 = 0) => [u + tu * s + du * (off + o2), v + tv * s + dv * (off + o2), yc + y];
    const ids = []; for (let i = 0; i < N; i++) { const a = (i / N) * TAU; const p = P(Math.cos(a) * r, Math.sin(a) * r); ids.push(this.vtx(p[0], p[1], p[2])); }
    const c0 = this.vtx(...P(0, 0));
    for (let i = 0; i < N; i++) this.tri(c0, ids[i], ids[(i + 1) % N], 5, [du, 0, dv]);
    const hand = (ang, len, w) => { // ang in degrees clockwise from 12
      const a = (ang * Math.PI) / 180, sx = Math.sin(a), sy = Math.cos(a), nx = sy, ny = -sx;
      const q = [[-nx * w / 2, -ny * w / 2], [nx * w / 2, ny * w / 2], [sx * len + nx * w / 2, sy * len + ny * w / 2], [sx * len - nx * w / 2, sy * len - ny * w / 2]].map(([s, y]) => this.vtx(...P(s, y, 0.05)));
      this.tri(q[0], q[1], q[2], 8, [du, 0, dv]); this.tri(q[0], q[2], q[3], 8, [du, 0, dv]);
    };
    hand((t[0] % 12) * 30 + t[1] * 0.5, r * 0.55, r * 0.14); hand(t[1] * 6, r * 0.82, r * 0.1);
  }
  /** four clock faces on a square tower of half width `half` centred (cu, cv) */
  clockFaces(cu, cv, half, yc, r) { for (const [du, dv] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) this.clock(cu + du * half, cv + dv * half, du, dv, yc, r); }
  /** box with an arbitrary wall material per side set: o.sidesMat = { u0: m, ... } (default 2) */
  boxM(r, y1, o = {}) {
    const y0 = o.y0 || 0, { u0, u1, v0, v1 } = r, sm = o.sidesMat || {}, m = (k) => sm[k] ?? 2;
    const s = o.sides || { u0: 1, u1: 1, v0: 1, v1: 1 };
    if (s.v0) this.quad([u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1], m('v0'), [0, 0, -1]);
    if (s.v1) this.quad([u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1], m('v1'), [0, 0, 1]);
    if (s.u0) this.quad([u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1], m('u0'), [-1, 0, 0]);
    if (s.u1) this.quad([u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1], m('u1'), [1, 0, 0]);
    if (o.cap !== false) this.cap(r, y1, o.mat ?? 0);
    this.parts.push({ h: (u, v) => (u >= u0 && u <= u1 && v >= v0 && v <= v1 ? y1 : -1) });
  }
  finish(bounds) { const r = this.result(bounds); return r; }
}

// shared helpers -----------------------------------------------------------------------------------------------------------------------------------
/** oriented footprint of the host cadastre piece from ctx.ring: { cu, cv, L, W, th (deg), O } -> a Civic in that frame (u along the long side, v across) */
export function frameOf(ring) {
  const mb = minBox(ring);
  const th = (Math.atan2(mb.uz, mb.ux) * 180) / Math.PI;
  return { mb, th, L: mb.L, W: mb.W, cu: mb.cu, cv: mb.cv };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Rīgas Centrālā stacija, part 1: the head building on Stacijas laukums with the clock tower. Host 49614810. Measured (height grid, 1 m): block x 318-392 z 487-510 wall 14 m
 *  (raised glazed strip x 321-378 z 504-511 to 18.5), the tower is a 9.5 m square shaft at x 369.5-379.5 z 483.5-492.5 rising to 50.2 m. */
export function stationHead() {
  const C = new Civic();
  const blk = R4(318, 392, 487, 510);
  C.boxM(blk, 14.0, { sidesMat: {} });
  // raised south strip (concourse clerestory): taller block with a long glazed north face
  const up = R4(321, 378, 503.5, 511);
  C.boxM(up, 18.4, { sides: { u0: 1, u1: 1, v0: 0, v1: 1 }, cap: true });
  C.panel(349.5, 503.5, 0, -1, 15.0, 18.0, 52, 7, 0.1);
  C.panel(349.5, 503.5, 0, -1, 4.0, 12.0, 70, 7, 0.1);   // ground-floor glazed arcade on the square side of the head block (the front looks onto the square at z = 487)
  // roof plant boxes on the head block
  C.boxM(R4(334, 346, 494, 500), 16.4);
  C.boxM(R4(352, 362, 492, 498), 15.8);
  // the clock tower: plain square shaft with a glazed slit on each face, clock stage, crown
  const cu = 374.5, cv = 488.0, h = 4.7;
  C.boxM(R4(cu - h - 0.8, cu + h + 0.8, cv - h - 0.8, cv + h + 0.8), 5.0, { mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } });
  C.boxM(R4(cu - h, cu + h, cv - h, cv + h), 38.4, { y0: 5.0, cap: false, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } }); // plain shaft
  C.boxM(R4(cu - h - 0.5, cu + h + 0.5, cv - h - 0.5, cv + h + 0.5), 39.3, { y0: 38.4, mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } }); // cornice under the clock stage
  C.boxM(R4(cu - h, cu + h, cv - h, cv + h), 47.2, { y0: 39.3, mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 }, cap: false }); // clock stage (plain)
  for (const [du, dv] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    C.panel(cu + du * h, cv + dv * h, du, dv, 9, 34, 1.7, 7, 0.1);                 // tall glazed slit
    C.panel(cu + du * h, cv + dv * h, du, dv, 6, 34, 0.5, 6, 0.0);                  // (spacer)
  }
  C.clockFaces(cu, cv, h, 43.2, 3.0);
  C.boxM(R4(cu - h - 0.6, cu + h + 0.6, cv - h - 0.6, cv + h + 0.6), 48.2, { y0: 47.2, mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } }); // crown cornice
  C.pyramid(cu, cv, h - 0.8, h - 0.8, 48.2, 2.2, 1);
  return C.finish({ u0: 300, u1: 400, v0: 480, v1: 520 });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Rīgas Centrālā stacija, part 2: the main hall (host 49614666). Measured: x 309-392, z 511-541, roof 11-13 m (flat), the middle bay a little higher (13.2). */
export function stationHall() {
  const C = new Civic();
  const hall = R4(309, 390, 511, 541);
  C.boxM(hall, 11.6);
  C.boxM(R4(332, 386, 517, 528), 13.3);                           // raised middle bay
  // big glazed front towards the tracks (south), glazed west gable, piers between the bays
  const bays = 8, x0 = 313, x1 = 387, bw = (x1 - x0) / bays;
  for (let i = 0; i < bays; i++) C.panel(x0 + bw * (i + 0.5), 541, 0, 1, 2.2, 9.6, bw - 1.4, 7, 0.12);
  C.panel(309, 526, -1, 0, 2.2, 9.4, 22, 7, 0.12);
  // skylight lanterns on the roof (glass sides)
  for (const u of [318, 343, 366]) C.boxM(R4(u, u + 14, 521, 527), 14.9, { y0: 13.3, sidesMat: { u0: 7, u1: 7, v0: 7, v1: 7 } });
  C.boxM(R4(322, 336, 529, 535), 13.0, { y0: 11.6, sidesMat: { u0: 7, u1: 7, v0: 7, v1: 7 } });
  return C.finish({ u0: 300, u1: 400, v0: 500, v1: 550 });
}
/** Rīgas Centrālā stacija, part 3: the east wing (host 49615281). Measured: x 392-470, z 508-536, flat roof 14-15 m. Glazed front on the square side (north). */
export function stationWing() {
  const C = new Civic();
  const w = R4(392, 470, 508, 536);
  C.boxM(w, 14.6);
  const bays = 7, x0 = 397, x1 = 465, bw = (x1 - x0) / bays;
  for (let i = 0; i < bays; i++) { C.panel(x0 + bw * (i + 0.5), 508, 0, -1, 2.8, 12.6, bw - 1.2, 7, 0.12); }
  C.boxM(R4(396, 466, 505.6, 508), 3.0, { mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } });   // low entrance porch with a flat roof
  for (const u of [403, 425, 447]) C.boxM(R4(u, u + 12, 516, 524), 16.4, { y0: 14.6, sidesMat: { u0: 7, u1: 7, v0: 7, v1: 7 } });
  C.panel(470, 522, 1, 0, 2.5, 10.5, 18, 7, 0.12);
  return C.finish({ u0: 385, u1: 475, v0: 498, v1: 540 });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Centrāltirgus: four former zeppelin hangars, parallel (axis 61 deg), 38 m wide segmental vaults 72 m long, apex 20.5 m, glazed gables, glazed ridge lantern.
 *  Spec = world-frame (u along the ridge, v across) measured from the height grids: [v centre, u centre]. */
const VAULT_TH = 61, VAULTS = [[257.5, 798], [314, 805], [368.5, 807], [422.5, 807.5]];
export function marketVault(hero, ctx) {
  const th = (VAULT_TH * Math.PI) / 180, ux = Math.cos(th), uz = Math.sin(th);
  let cx = 0, cz = 0; for (const [x, z] of ctx.ring) { cx += x; cz += z; } cx /= ctx.ring.length; cz /= ctx.ring.length;
  const pu = cx * ux + cz * uz, pv = -cx * uz + cz * ux;
  let best = VAULTS[0], bd = 1e9; for (const s of VAULTS) { const d = Math.hypot(s[0] - pv, s[1] - pu); if (d < bd) { bd = d; best = s; } }
  const [vc, uc] = best, hw = 19.2, L = 36;
  const C = new Civic([0, 0], VAULT_TH);
  const r = R4(uc - L, uc + L, vc - hw, vc + hw);
  const y0 = 7.4, rise = 20.4 - y0;
  C.walls(r, 0, y0, { v0: 1, v1: 1 });
  C.walls(r, 0, 3.4, { u0: 1, u1: 1 });
  C.vault(r, y0, rise, 'u', { segmental: true, ends: { lo: 'glass', hi: 'glass' }, sill: 3.4, n: 14 });
  // roof lantern along the ridge (glazed long sides, flat top)
  C.boxM(R4(uc - L + 4, uc + L - 4, vc - 1.9, vc + 1.9), 22.6, { y0: 19.6, sidesMat: { u0: 2, u1: 2, v0: 7, v1: 7 } });
  // low lean-to market stalls on the long side (measured 6-7 m flat roofs) are separate cadastre pieces and stay as they are
  return C.finish({ u0: uc - L - 2, u1: uc + L + 2, v0: vc - hw - 2, v1: vc + hw + 2 });
}


/** Centrāltirgus 5th (meat) pavilion, host 49615202 (5491 m2 cadastre piece, 0.5 m height grid: a 20 m crown, symmetric section, ridge running ~151 deg = CROSSWISE to the other four,
 *  which run 61 deg). Same hangar vault, oriented from the footprint's own minimum box so the ridge follows the measured ridge. */
export function marketVaultMeasured(hero, ctx) {
  const mb = minBox(ctx.ring), th = (Math.atan2(mb.uz, mb.ux) * 180) / Math.PI;
  const C = new Civic([0, 0], th), hl = mb.L / 2 - 0.4, hw = Math.min(mb.W / 2 - 0.4, 19.5);
  const r = R4(mb.cu - hl, mb.cu + hl, mb.cv - hw, mb.cv + hw), y0 = 7.4, rise = 20.4 - y0;
  C.walls(r, 0, y0, { v0: 1, v1: 1 });
  C.walls(r, 0, 3.4, { u0: 1, u1: 1 });
  C.vault(r, y0, rise, 'u', { segmental: true, ends: { lo: 'glass', hi: 'glass' }, sill: 3.4, n: 14 });
  C.boxM(R4(mb.cu - hl + 4, mb.cu + hl - 4, mb.cv - 1.9, mb.cv + 1.9), 22.6, { y0: 19.6, sidesMat: { u0: 2, u1: 2, v0: 7, v1: 7 } });
  return C.finish({ u0: mb.cu - hl - 2, u1: mb.cu + hl + 2, v0: mb.cv - hw - 2, v1: mb.cv + hw + 2 });
}
/** Stacijas laukums 2 (49614921): the low platform building the mesh crumpled (22 mast spikes over a 5.6 m shed). A plain oriented box with a glazed long side and two skylights. */
export function platformShed(hero, ctx) {
  const mb = minBox(ctx.ring), th = (Math.atan2(mb.uz, mb.ux) * 180) / Math.PI, h = Math.min(7, Math.max(4.5, (ctx.d && ctx.d.h) || 5.6));
  const C = new Civic([0, 0], th), hl = mb.L / 2, hw = mb.W / 2;
  const r = R4(mb.cu - hl, mb.cu + hl, mb.cv - hw, mb.cv + hw);
  C.boxM(r, h);
  C.panel(mb.cu, mb.cv + hw, 0, 1, 1.4, h - 1.2, mb.L - 4, 7, 0.1);
  C.panel(mb.cu, mb.cv - hw, 0, -1, 1.4, h - 1.2, mb.L - 4, 7, 0.1);
  for (const t of [-0.3, 0.3]) C.boxM(R4(mb.cu + mb.L * t - 6, mb.cu + mb.L * t + 6, mb.cv - 2, mb.cv + 2), h + 1.3, { y0: h, sidesMat: { u0: 7, u1: 7, v0: 7, v1: 7 } });
  return C.finish({ u0: mb.cu - hl - 2, u1: mb.cu + hl + 2, v0: mb.cv - hw - 2, v1: mb.cv + hw + 2 });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// FEATURES: extra geometry merged by build-meshes.mjs into the MEASURED mesh of a hero (hero.features = name). Same frame conventions as above.
/** triangular pediment facing +u (ridge along u), over rect r at height y, rise `rise`: tympanum (plain) + two roof planes */
function pedimentU(C, r, y, rise) {
  const vc = (r.v0 + r.v1) / 2;
  C.quad([r.u0, r.v0, y], [r.u1, r.v0, y], [r.u1, vc, y + rise], [r.u0, vc, y + rise], 1, [0, r.v1 - r.v0, -2 * rise]);
  C.quad([r.u1, r.v1, y], [r.u0, r.v1, y], [r.u0, vc, y + rise], [r.u1, vc, y + rise], 1, [0, r.v1 - r.v0, 2 * rise]);
  const a = C.vtx(r.u1, r.v0, y), b = C.vtx(r.u1, r.v1, y), c = C.vtx(r.u1, vc, y + rise);
  C.tri(a, b, c, 6, [1, 0, 0]);
}
/** Nacionālā opera: six-column portico with pediment on the front (+u side in the th = -30 frame, front plane u = -30.5, v 224-258) in front of the measured foyer block */
export function featOpera() {
  const C = new Civic([0, 0], -30);
  const u0 = -37, u1 = -30.2, v0 = 223.5, v1 = 258.5;
  C.boxM(R4(u0, u1 + 0.8, v0 - 1, v1 + 1), 1.2, { mat: 6, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } }); // podium
  C.colonnade(u1 - 0.6, v0 + 1.5, u1 - 0.6, v1 - 1.5, 6, 0.95, 1.2, 14.6);
  C.boxM(R4(u0, u1 + 0.2, v0, v1), 16.4, { y0: 14.6, mat: 6, cap: false, sidesMat: { u0: 6, u1: 6, v0: 6, v1: 6 } }); // entablature
  pedimentU(C, R4(u0, u1 + 0.2, v0 - 0.4, v1 + 0.4), 16.4, 5.2);
  return C.finish({ u0: -42, u1: -26, v0: 218, v1: 264 });
}
export const FEATURES = { opera: featOpera };

export const CURATED_CIVIC = { stationhead: stationHead, stationhall: stationHall, stationwing: stationWing, marketvault: marketVault, marketmeat: marketVaultMeasured, platformshed: platformShed };
