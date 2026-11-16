// Curated parametric heroes: buildings whose plane-fitted mesh is too crumpled (wavy walls, patchwork roofs) are rebuilt as clean prisms + roof primitives
// squared to the building's main axis. Every dimension below was MEASURED from the reality-mesh height grid (rotated into the building frame, see the
// notes per building); only the regularisation (straight walls, symmetric wings, clean mansards / gables, stepped gables, a prism + pyramid spire) is
// curated. Same return shape as parts.mjs / planar.mjs: { verts, tris:[[a,b,c,mat]], loops:[], vol, hmax, eave, area }.
//
// Frame: world (x east, z south) = O + u*U + v*V with U = (cos th, sin th), V = (-sin th, cos th); y = metres above local ground.
// Materials: 0 flat roof, 1 pitched roof, 2 wall (windows), 3 accent (lantern cap / spire = whole features), 5 gilded accent.
import { pack } from './planar.mjs';

class Comp {
  constructor(O, thDeg) {
    this.O = O; const th = (thDeg * Math.PI) / 180;
    this.U = [Math.cos(th), Math.sin(th)]; this.V = [-Math.sin(th), Math.cos(th)];
    this.P = []; this.tris = []; this.parts = [];
  }
  W(u, v) { return [this.O[0] + u * this.U[0] + v * this.V[0], this.O[1] + u * this.U[1] + v * this.V[1]]; }
  vtx(u, v, y) { const [x, z] = this.W(u, v); this.P.push([x, y, z]); return this.P.length - 1; }
  /** want = [wu, wy, wv] in frame coordinates */
  tri(a, b, c, mat, want) {
    const A = this.P[a], B = this.P[b], C = this.P[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-6) return;
    const wx = want[0] * this.U[0] + want[2] * this.V[0], wz = want[0] * this.U[1] + want[2] * this.V[1];
    if (nx * wx + ny * want[1] + nz * wz >= 0) this.tris.push([a, b, c, mat]); else this.tris.push([a, c, b, mat]);
  }
  quad(p0, p1, p2, p3, mat, want) { // corners [u,v,y]
    const a = this.vtx(...p0), b = this.vtx(...p1), c = this.vtx(...p2), d = this.vtx(...p3);
    this.tri(a, b, c, mat, want); this.tri(a, c, d, mat, want);
  }
  /** vertical walls of a rectangle, from y0 to y1; sides = which of u0,u1,v0,v1 get a wall */
  walls(r, y0, y1, sides = { u0: 1, u1: 1, v0: 1, v1: 1 }) {
    const { u0, u1, v0, v1 } = r;
    if (sides.v0) this.quad([u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1], 2, [0, 0, -1]);
    if (sides.v1) this.quad([u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1], 2, [0, 0, 1]);
    if (sides.u0) this.quad([u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1], 2, [-1, 0, 0]);
    if (sides.u1) this.quad([u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1], 2, [1, 0, 0]);
  }
  cap(r, y, mat = 0) { this.quad([r.u0, r.v0, y], [r.u1, r.v0, y], [r.u1, r.v1, y], [r.u0, r.v1, y], mat, [0, 1, 0]); }
  /** a prism with a flat roof */
  box(r, y1, o = {}) {
    const y0 = o.y0 || 0;
    this.walls(r, y0, y1, o.sides);
    if (o.cap !== false) this.cap(r, y1, o.mat ?? 0);
    this.parts.push({ h: (u, v) => (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1 ? y1 : -1) });
  }
  /** mansard step: sloped faces from rect `a` at height ya to rect `b` (inside a) at height yb; sides = which slopes exist; cap = flat top */
  loft(a, ya, b, yb, o = {}) {
    const sides = o.sides || { u0: 1, u1: 1, v0: 1, v1: 1 }, mat = o.mat ?? 1, dy = yb - ya;
    if (sides.v0) this.quad([a.u0, a.v0, ya], [a.u1, a.v0, ya], [b.u1, b.v0, yb], [b.u0, b.v0, yb], mat, [0, b.v0 - a.v0, -dy]);
    if (sides.v1) this.quad([a.u1, a.v1, ya], [a.u0, a.v1, ya], [b.u0, b.v1, yb], [b.u1, b.v1, yb], mat, [0, a.v1 - b.v1, dy]);
    if (sides.u0) this.quad([a.u0, a.v1, ya], [a.u0, a.v0, ya], [b.u0, b.v0, yb], [b.u0, b.v1, yb], mat, [-dy, b.u0 - a.u0, 0]);
    if (sides.u1) this.quad([a.u1, a.v0, ya], [a.u1, a.v1, ya], [b.u1, b.v1, yb], [b.u1, b.v0, yb], mat, [dy, a.u1 - b.u1, 0]);
    if (o.cap !== false) this.cap(b, yb, mat === 3 ? 3 : 0);
    const ins = { u0: b.u0 - a.u0, u1: a.u1 - b.u1, v0: b.v0 - a.v0, v1: a.v1 - b.v1 };
    this.parts.push({ h: (u, v) => {
      if (u < a.u0 || u > a.u1 || v < a.v0 || v > a.v1) return -1;
      let t = 1;
      for (const k of ['u0', 'u1', 'v0', 'v1']) if (sides[k] && ins[k] > 1e-6) { const d = k === 'u0' ? u - a.u0 : k === 'u1' ? a.u1 - u : k === 'v0' ? v - a.v0 : a.v1 - v; t = Math.min(t, d / ins[k]); }
      return ya + dy * Math.max(0, Math.min(1, t));
    } });
  }
  /** gabled roof over rect r at height y, ridge along `axis` ('u' | 'v'); gable-end walls (mat 2) at the ends listed in ends = { lo, hi } */
  gable(r, y, rise, axis, ends = {}, ridgeAt = null) {
    const lo = ends.lo, hi = ends.hi;
    if (axis === 'u') {
      const vc = ridgeAt ?? (r.v0 + r.v1) / 2, yr = y + rise, hv0 = vc - r.v0, hv1 = r.v1 - vc;
      this.quad([r.u0, r.v0, y], [r.u1, r.v0, y], [r.u1, vc, yr], [r.u0, vc, yr], 1, [0, hv0, -rise]);
      this.quad([r.u1, r.v1, y], [r.u0, r.v1, y], [r.u0, vc, yr], [r.u1, vc, yr], 1, [0, hv1, rise]);
      for (const [on, uu, s] of [[lo, r.u0, -1], [hi, r.u1, 1]]) if (on) { const a = this.vtx(uu, r.v0, y), b = this.vtx(uu, r.v1, y), c = this.vtx(uu, vc, yr); this.tri(a, b, c, 2, [s, 0, 0]); }
      this.parts.push({ h: (u, v) => (u < r.u0 || u > r.u1 || v < r.v0 || v > r.v1 ? -1 : y + rise * Math.max(0, 1 - (v < vc ? (vc - v) / hv0 : (v - vc) / hv1))) });
    } else {
      const uc = ridgeAt ?? (r.u0 + r.u1) / 2, yr = y + rise, hu0 = uc - r.u0, hu1 = r.u1 - uc;
      this.quad([r.u0, r.v1, y], [r.u0, r.v0, y], [uc, r.v0, yr], [uc, r.v1, yr], 1, [-rise, hu0, 0]);
      this.quad([r.u1, r.v0, y], [r.u1, r.v1, y], [uc, r.v1, yr], [uc, r.v0, yr], 1, [rise, hu1, 0]);
      for (const [on, vv, s] of [[lo, r.v0, -1], [hi, r.v1, 1]]) if (on) { const a = this.vtx(r.u0, vv, y), b = this.vtx(r.u1, vv, y), c = this.vtx(uc, vv, yr); this.tri(a, b, c, 2, [0, 0, s]); }
      this.parts.push({ h: (u, v) => (u < r.u0 || u > r.u1 || v < r.v0 || v > r.v1 ? -1 : y + rise * Math.max(0, 1 - (u < uc ? (uc - u) / hu0 : (u - uc) / hu1))) });
    }
  }
  /** square pyramid (spire / lantern cap) */
  pyramid(cu, cv, hu, hv, y, rise, mat = 3) {
    const apex = this.vtx(cu, cv, y + rise);
    const c = [[cu - hu, cv - hv], [cu + hu, cv - hv], [cu + hu, cv + hv], [cu - hu, cv + hv]].map(([u, v]) => this.vtx(u, v, y));
    const nrm = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) { const [su, sv] = nrm[i]; this.tri(c[i], c[(i + 1) % 4], apex, mat, [su * rise, hu, sv * rise]); }
    this.parts.push({ h: (u, v) => (Math.abs(u - cu) > hu || Math.abs(v - cv) > hv ? -1 : y + rise * (1 - Math.max(Math.abs(u - cu) / hu, Math.abs(v - cv) / hv))) });
  }
  /** stepped gable parapet standing proud of a gable-end face: face at coordinate `at` along axis ('u' = face normal along u, 'v' = along v), centred at c, half width hw,
   *  eave height y, rise `rise`, n steps, `dir` = +1 / -1 outward */
  stepGable(face, at, dir, c, hw, y, rise, n, thick = 0.7) {
    for (let k = 0; k < n; k++) {
      const w = hw * (1 - k / n), top = y + (rise * (k + 1)) / n + 0.35, bot = y + (rise * k) / n - 0.2;
      const a0 = dir > 0 ? at - thick : at - 0.25, a1 = dir > 0 ? at + 0.25 : at + thick; // 0.25 m proud of the gable face
      const r = face === 'v' ? { u0: c - w, u1: c + w, v0: a0, v1: a1 } : { v0: c - w, v1: c + w, u0: a0, u1: a1 };
      this.walls(r, Math.max(bot, y - 0.4), top, face === 'v' ? { u0: 1, u1: 1, v0: dir < 0, v1: dir > 0 } : { v0: 1, v1: 1, u0: dir < 0, u1: dir > 0 });
      this.cap(r, top, 6);
    }
    // finial block on top
    const t = y + rise + 0.35 + 0.9, w = 0.45;
    const r = face === 'v' ? { u0: c - w, u1: c + w, v0: dir > 0 ? at - thick : at - 0.25, v1: dir > 0 ? at + 0.25 : at + thick } : { v0: c - w, v1: c + w, u0: dir > 0 ? at - thick : at - 0.25, u1: dir > 0 ? at + 0.25 : at + thick };
    this.walls(r, y + rise + 0.2, t); this.cap(r, t, 6);
  }
  result(bounds) {
    // volume + footprint area from the analytic height functions (overlap-safe), cell 0.5 m
    const { u0, u1, v0, v1 } = bounds, cell = 0.5;
    let vol = 0, area = 0, hmax = 0;
    for (let v = v0 + cell / 2; v < v1; v += cell) for (let u = u0 + cell / 2; u < u1; u += cell) {
      let h = -1; for (const p of this.parts) { const q = p.h(u, v); if (q > h) h = q; }
      if (h > 1) { vol += h * cell * cell; area += cell * cell; hmax = Math.max(hmax, h); }
    }
    const packed = pack(this.P, this.tris);
    return { verts: packed.verts, tris: packed.tris, loops: [], vol, hmax, eave: 0, area, info: { curated: true } };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Latvijas Nacionālais mākslas muzejs (id 49615452). Frame: O = (-12.9, -474.4), th = -47.5 deg (measured: the facade, wings and pavilions are all within 1 m of this axis),
 *  u along the facade (symmetric about u = 0.7), v towards the park (south-east). Measured: pavilions u = 0.7 +- [32.0, 41.1], wings +- [9.85, 32.0], central block +- 9.85;
 *  v: central [-14.6, 9.3], pavilions [-12.2, 7.2], wings [-10.8, 6.7]; wall tops 19.7 (wings) / 23.0 (pavilions) / 26.5 (central); roofs peak at 23.4 / 26.0 / 35.2 (+ lantern 40). */
export function artMuseum() {
  const C = new Comp([-12.9, -474.4], -47.5);
  const c0 = 0.7;
  const R = (a, b, v0, v1) => ({ u0: c0 + a, u1: c0 + b, v0, v1 });
  for (const sg of [-1, 1]) {
    const S = (a, b) => (sg < 0 ? R(-b, -a, 0, 0) : R(a, b, 0, 0)); // mirrored u range
    // end pavilion: walls 23.0, mansard to 26.0 with a flat top
    const pv = { u0: S(32.0, 41.1).u0, u1: S(32.0, 41.1).u1, v0: -12.2, v1: 7.2 };
    C.walls(pv, 0, 23.0);
    C.loft(pv, 23.0, { u0: pv.u0 + 3.0, u1: pv.u1 - 3.0, v0: pv.v0 + 4.6, v1: pv.v1 - 4.2 }, 26.0);
    // wing between pavilion and central block: walls 19.7 (front and back only, the ends are inside the neighbours), shallow mansard + glazed skylight ridge
    const wg = { u0: S(9.85, 32.0).u0, u1: S(9.85, 32.0).u1, v0: -10.8, v1: 6.7 };
    C.walls(wg, 0, 19.7, { v0: 1, v1: 1 });
    const wmid = { u0: wg.u0, u1: wg.u1, v0: -10.8 + 5.7, v1: 6.7 - 5.7 };
    C.loft(wg, 19.7, wmid, 22.4, { sides: { v0: 1, v1: 1 }, cap: false });
    C.loft(wmid, 22.4, { u0: wg.u0, u1: wg.u1, v0: wmid.v0 + 1.4, v1: wmid.v1 - 1.4 }, 23.4, { sides: { v0: 1, v1: 1 } });
  }
  // central pavilion: walls 26.5, convex mansard in four rings to a flat top at 35.2, lantern 35.2 -> 37.9 with a pyramid cap to 40.0
  const cb = R(-9.85, 9.85, -14.6, 9.3), cv = (cb.v0 + cb.v1) / 2, cu = (cb.u0 + cb.u1) / 2;
  C.walls(cb, 0, 26.5);
  const ring = (s) => ({ u0: cu - 9.85 * s, u1: cu + 9.85 * s, v0: cv - 11.95 * s, v1: cv + 11.95 * s });
  const prof = [[1, 26.5], [0.72, 29.8], [0.42, 33.0], [0.18, 35.2]];
  for (let i = 0; i < 3; i++) C.loft(ring(prof[i][0]), prof[i][1], ring(prof[i + 1][0]), prof[i + 1][1], { cap: i === 2 });
  C.walls({ u0: cu - 2.3, u1: cu + 2.3, v0: cv - 2.3, v1: cv + 2.3 }, 35.2, 37.9);
  C.pyramid(cu, cv, 2.5, 2.5, 37.9, 2.1, 3);
  // entrance portico + triangular pediment on the park side (ridge along v, gable facing the park)
  const po = R(-6.5, 6.5, 9.3, 13.0);
  C.walls(po, 0, 20.0, { u0: 1, u1: 1, v1: 1 });
  C.gable(po, 20.0, 6.2, 'v', { hi: true });
  return C.result({ u0: c0 - 43, u1: c0 + 43, v0: -16, v1: 14 });
}
export const ART_MUSEUM_AREA = 0;

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** Latvijas Mākslas akadēmija (ids 49615853 + 49615877, Kalpaka bulvāris 13). Frame: O = (-105, -385), th = -49.8 deg (cadastre edges at -49.7 / 40.4).
 *  Measured (u, v): north bar u [-27, 34.5] v [-25.2, -11.3] eave 19 ridge 26 along u; west cross-wing u [-34, -20] v [-25.4, 6.5] eave 18 ridge 25.5 along v;
 *  main steep gable u [-34, -7] v [-1.3, 14.5] eave 19.5 ridge 30 along u; east wing u [26, 43] v [-25.4, -0.8] eave 19.5 ridge 26 along v; south wing u [-28, -14.5] v [14.5, 42.2]
 *  eave 15 ridge 20; tower spire on the main ridge at (-21.2, 6.5), tip 45.1 m. */
export function artAcademy() {
  const C = new Comp([-105, -385], -49.8);
  const R = (u0, u1, v0, v1) => ({ u0, u1, v0, v1 });
  // north bar (ridge along u; its west end sits inside the cross-wing, its east end inside the east wing)
  const N = R(-27, 34.5, -25.2, -11.3);
  C.walls(N, 0, 19.0, { v0: 1, v1: 1 });
  C.gable(N, 19.0, 7.0, 'u', {});
  // west cross-wing
  const Wn = R(-34, -20, -25.4, -1.3);
  C.walls(Wn, 0, 18.0);
  C.gable(R(-34, -20, -25.4, 6.5), 18.0, 7.5, 'v', { lo: true });
  // main steep gable (the tall roof with the tower)
  const GW = R(-34, -7, -1.3, 14.5);
  C.walls(GW, 0, 19.5);
  C.gable(GW, 19.5, 10.5, 'u', { lo: true, hi: true });
  // east wing
  const E = R(26, 43, -25.4, -0.8);
  C.walls(E, 0, 19.5);
  C.gable(E, 19.5, 6.5, 'v', { lo: true, hi: true });
  // link block between the bar and the main gable (flat roof, seen from the courtyard) and the low courtyard range
  C.box(R(-20, -7.5, -11.3, -1.3), 17.5);
  C.box(R(-7, 25, -11.3, -6.0), 8.5);
  // south wing (ridge along v) + its lower cross block
  const S1 = R(-28, -14.5, 14.5, 42.2);
  C.walls(S1, 0, 15.0);
  C.gable(S1, 15.0, 5.0, 'v', { hi: true });
  const S2 = R(-29.5, -8, 31, 42.2);
  C.walls(S2, 0, 14.0);
  C.gable(S2, 14.0, 3.5, 'u', { lo: true, hi: true });
  // stepped gables on the exposed gable ends (stand 0.25 m proud of the gable face)
  C.stepGable('u', -34, -1, 6.6, 7.9, 19.5, 10.5, 6);
  C.stepGable('u', -7, 1, 6.6, 7.9, 19.5, 10.5, 5);
  C.stepGable('v', -25.4, -1, -27, 7, 18.0, 7.5, 4);
  C.stepGable('v', -25.4, -1, 34.5, 8.5, 19.5, 6.5, 4);
  C.stepGable('v', -0.8, 1, 34.5, 8.5, 19.5, 6.5, 4);
  // slim tower: square shaft through the main ridge + tall pyramid spire (tip 45.1 m)
  const tu = -21.2, tv = 6.5;
  C.walls(R(tu - 2.3, tu + 2.3, tv - 2.3, tv + 2.3), 22.0, 34.5);
  C.pyramid(tu, tv, 2.3, 2.3, 34.5, 10.6, 3);
  return C.result({ u0: -36, u1: 45, v0: -27, v1: 44 });
}

export const CURATED = { artmuseum: artMuseum, artacademy: artAcademy };
