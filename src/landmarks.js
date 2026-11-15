// Riga landmark decorations (stylised, original low-poly): rules that pick buildings by name / position, and geometry
// helpers that append domes, spires, vaults, gables, towers, flags and a cat to a building's GeoBuilder (so they fall with it).
import * as THREE from 'three';
import { bbox, pointInPoly, minBox } from './geo.js';

const NW = [1, 1, 1, 0];
const rgb = (c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };
const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** oriented box: centre, half extents along u (hu), up (hh), v (hv); u=(ux,uz) */
export function obox(b, cx, cy, cz, hu, hh, hv, ux, uz, col) {
  const vx = -uz, vz = ux;
  const P = (su, sy, sv) => [cx + ux * hu * su + vx * hv * sv, cy + hh * sy, cz + uz * hu * su + vz * hv * sv];
  const top = col, side = sh(col, 0.85), bot = sh(col, 0.7);
  const q = (a, bb, c, d, want, colr) => b.quad(a, bb, c, d, colr, colr, colr, colr, NW, want);
  q(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), [0, 1, 0], top);
  q(P(-1, -1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), [0, -1, 0], bot);
  q(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), [ux, 0, uz], side);
  q(P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), [-ux, 0, -uz], side);
  q(P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1), [vx, 0, vz], sh(col, 0.92));
  q(P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), [-vx, 0, -vz], sh(col, 0.78));
}

/** surface of revolution; prof = [[radius, y], ...] bottom -> top (absolute y) */
export function lathe(b, cx, cz, prof, col, seg = 8) {
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
    const dr = r1 - r0, dy = y1 - y0, nl = Math.hypot(dr, dy) || 1;
    const nr = dy / nl, ny = -dr / nl;
    const lo = sh(col, 0.85 + 0.1 * Math.min(1, k / prof.length)), hi = sh(col, 1);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const q0 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], q1 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const want = [Math.cos(am) * nr, ny, Math.sin(am) * nr];
      if (r1 < 0.02) b.tri(p0, p1, q0, lo, lo, hi, NW, want);
      else if (r0 < 0.02) b.tri(q0, q1, p0, hi, hi, lo, NW, want);
      else b.quad(p0, p1, q1, q0, lo, lo, hi, hi, NW, want);
    }
  }
}

/** triangular gable prism at face centre c, tangent u, outward normal n, width w, height ph, depth d */
function pediment(b, c, u, n, w, ph, d, y, col) {
  const L = [c[0] - u[0] * w / 2, y, c[1] - u[1] * w / 2], R = [c[0] + u[0] * w / 2, y, c[1] + u[1] * w / 2];
  const A = [c[0], y + ph, c[1]];
  const back = (p) => [p[0] - n[0] * d, p[1], p[2] - n[1] * d];
  const cc = col, c2 = sh(col, 0.85);
  b.tri(L, R, A, cc, cc, cc, NW, [n[0], 0, n[1]]);
  b.tri(back(L), back(R), back(A), c2, c2, c2, NW, [-n[0], 0, -n[1]]);
  const sl = Math.hypot(ph, w / 2);
  b.quad(R, A, back(A), back(R), c2, c2, c2, c2, NW, [u[0] * ph / sl, (w / 2) / sl, u[1] * ph / sl]);
  b.quad(A, L, back(L), back(A), c2, c2, c2, c2, NW, [-u[0] * ph / sl, (w / 2) / sl, -u[1] * ph / sl]);
}

function flag(b, x, y, z, ux, uz) {
  lathe(b, x, z, [[0.07, y], [0.07, y + 7]], rgb(0xb9b3a6), 5);
  const stripes = [[0.5, 0x9e1b32], [0.25, 0xffffff], [0.5, 0x9e1b32]];
  let yy = y + 6.9;
  for (const [hgt, c] of stripes) {
    const col = rgb(c);
    const a = [x, yy, z], bb = [x + ux * 1.8, yy, z + uz * 1.8], cc = [x + ux * 1.8, yy - hgt, z + uz * 1.8], d = [x, yy - hgt, z];
    const nx = -uz, nz = ux;
    b.quad(a, bb, cc, d, col, col, col, col, NW, [nx, 0, nz]);
    b.quad(a, d, cc, bb, col, col, col, col, NW, [-nx, 0, -nz]);
    yy -= hgt;
  }
}

function frame(ring) {
  const mb = minBox(ring);
  return { ux: mb.ux, uz: mb.uz, vx: -mb.uz, vz: mb.ux, cu: mb.cu, cv: mb.cv, L: mb.L, W: mb.W };
}
const at = (f, u, v) => [f.ux * u + f.vx * v, f.uz * u + f.vz * v];

function longestEdge(ring, towards) {
  let best = null, bs = -1e9;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 6) continue;
    const nx = dz / len, nz = -dx / len; // outward for CCW rings
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    let score = len;
    if (towards) score = len * 0.3 + (nx * (towards[0] - mx) + nz * (towards[1] - mz)) / (Math.hypot(towards[0] - mx, towards[1] - mz) || 1) * 40;
    if (score > bs) { bs = score; best = { m: [mx, mz], u: [dx / len, dz / len], n: [nx, nz], len }; }
  }
  return best;
}

/** Decide which decoration a building gets. Returns {deco, name?, wall?, h?, valueMul?, landmark?} or null. */
export function landmarkRule(it) {
  const nm = it.name || '';
  const cx = it.x, cz = it.z;
  if (/paviljons/i.test(nm) || (!nm && it.t === 'oth' && it.area > 5000 && Math.hypot(cx + 2, cz - 780) < 140)) return { deco: { kind: 'vault' }, h: Math.min(it.h, 14), wall: 0xd9d2c0, roof: 0xaebbb2 };
  if (/Piedzimšanas/.test(nm) || (/Brīvības bulvāris 23$/.test(nm) && it.t === 'rel')) return { deco: { kind: 'domes' }, h: Math.min(it.h, 19), wall: 0xeadfc4, roof: 0x4a5560, win: { floorH: 9, spacing: 4.6, frac: 0.45 } };
  // Latvian National Opera, Aspazijas bulvāris 3 (the 34 m cadastre block incl. the fly tower); portico faces Opera Square /
  // the Freedom Monument (north). Main body lowered to cornice height, the fly tower is added by the deco.
  if (/Aspazijas bulvāris 3$/.test(nm) && it.t === 'pub' && it.h > 20) return { deco: { kind: 'opera', towards: [-cx, -cz] }, name: 'Nacionālā opera', wall: 0xf3efe6, roof: 0x6f9486, landmark: true, valueMul: 2.5, h: 17, win: { floorH: 7.5, spacing: 5.2, frac: 0.55 } };
  if (/Aspazijas bulvāris 3$/.test(nm) && it.t === 'pub') return { wall: 0xefeadf, roof: 0x6f9486 }; // opera annex: same white + copper green
  if (/Pulvertornis/i.test(nm)) return { wall: 0x6e5d50 };
  if (/Pētera baznīca/i.test(nm)) return { deco: { kind: 'stepspire' }, wall: 0xc9b9a0 };
  if (/Doms|Doma/i.test(nm) && it.t === 'rel') return { deco: { kind: 'domespire' } };
  if (/^Pils laukums 2$/.test(nm)) return { deco: { kind: 'castle' }, name: 'Rīgas pils', landmark: true, valueMul: 2.5, wall: 0xe0c27a, roof: 0x8c3f2c, h: Math.max(it.h, 14) };
  if (/Rātslaukums 9$|Melngalvju/i.test(nm)) return { deco: { kind: 'gable' }, name: 'Melngalvju nams', landmark: true, valueMul: 2.5, wall: 0xa4432e, h: Math.max(it.h, 21), roof: 0x6f2f24 };
  return null;
}

/** pick the Cat House: the small building nearest the real location (Meistaru iela 10) */
export function pickCatHouse(items) {
  let best = null, bd = 60;
  for (const it of items) {
    if (it.area < 100 || it.area > 450 || it.landmark) continue;
    const d = Math.hypot(it.x + 429, it.z - 279);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}


/** black cat silhouette sitting on a tip at (x, y, z): body, head, ears, arched tail */
export function addCat(b, x, y, z) {
  const black = rgb(0x15161a);
  obox(b, x, y + 0.45, z, 0.7, 0.28, 0.2, 1, 0, black);
  obox(b, x + 0.75, y + 0.78, z, 0.25, 0.25, 0.2, 1, 0, black);
  lathe(b, x + 0.72, z - 0.13, [[0.1, y + 1.0], [0.02, y + 1.38]], black, 4);
  lathe(b, x + 0.72, z + 0.13, [[0.1, y + 1.0], [0.02, y + 1.38]], black, 4);
  obox(b, x - 0.85, y + 0.8, z, 0.12, 0.45, 0.07, 1, 0, black);
  obox(b, x - 0.75, y + 1.28, z, 0.2, 0.08, 0.07, 1, 0, black);
  obox(b, x - 0.1, y + 0.1, z, 0.15, 0.18, 0.1, 1, 0, black);
  obox(b, x + 0.5, y + 0.1, z, 0.15, 0.18, 0.1, 1, 0, black);
}

/** append decoration geometry. ring is centroid-relative; h = wall top. Returns extra height added. */
export function addDeco(b, d, ring, h, wallCol, roofCol) {
  const wall = [wallCol.r, wallCol.g, wallCol.b];
  const f = frame(ring);
  const bb = bbox(ring);
  const inside = (x, z) => pointInPoly(x, z, ring);
  switch (d.kind) {
    case 'vault': {
      const hw = f.W / 2, rise = Math.min(f.W * 0.3 + 1, 9), hl = f.L / 2;
      const c = at(f, f.cu, f.cv), col = rgb(roofCol.getHex ? roofCol.getHex() : 0xaebbb2);
      const N = 10;
      const pt = (i, sgn) => { const a = (i / N) * Math.PI; return [c[0] + f.ux * sgn * hl + f.vx * Math.cos(a) * hw, h + Math.sin(a) * rise, c[1] + f.uz * sgn * hl + f.vz * Math.cos(a) * hw]; };
      for (let i = 0; i < N; i++) {
        const am = ((i + 0.5) / N) * Math.PI;
        const want = [f.vx * Math.cos(am) * rise, hw * Math.sin(am), f.vz * Math.cos(am) * rise];
        const k = i % 2 ? 0.93 : 1, cc = sh(col, k);
        b.quad(pt(i, -1), pt(i + 1, -1), pt(i + 1, 1), pt(i, 1), cc, cc, cc, cc, NW, want);
      }
      // gable end walls (lunette)
      for (const sgn of [-1, 1]) {
        const w2 = sh(wall, 0.95);
        for (let i = 0; i < N; i++) b.tri(pt(i, sgn), pt(i + 1, sgn), [c[0] + f.ux * sgn * hl, h, c[1] + f.uz * sgn * hl], w2, w2, w2, NW, [f.ux * sgn, 0, f.uz * sgn]);
      }
      return rise;
    }
    case 'domes': {
      const gold = rgb(0xe2b23a), drum = rgb(0xe8e0cf);
      const R = Math.min(0.22 * f.W, 6);
      const dome = (x, z, r) => {
        lathe(b, x, z, [[r * 0.95, h], [r * 0.95, h + r * 1.1]], drum, 10);
        lathe(b, x, z, [[r * 1.0, h + r * 1.1], [r * 1.3, h + r * 1.5], [r * 1.25, h + r * 2.1], [r * 0.7, h + r * 2.9], [r * 0.18, h + r * 3.6], [0.02, h + r * 4.0]], gold, 10);
        lathe(b, x, z, [[0.07, h + r * 3.9], [0.07, h + r * 4.9]], gold, 4);
        obox(b, x, h + r * 4.55, z, 0.4 * r / 2, 0.04, 0.04, 1, 0, gold);
      };
      const c = at(f, f.cu, f.cv);
      if (inside(c[0], c[1])) dome(c[0], c[1], R);
      for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const p = at(f, f.cu + su * f.L * 0.3, f.cv + sv * f.W * 0.28);
        if (inside(p[0], p[1])) dome(p[0], p[1], R * 0.5);
      }
      // bell tower to one side
      const tp = at(f, f.cu - f.L * 0.38, f.cv);
      if (inside(tp[0], tp[1])) {
        obox(b, tp[0], h + 8, tp[1], 2.2, 8, 2.2, f.ux, f.uz, drum);
        lathe(b, tp[0], tp[1], [[2.6, h + 16], [2.6, h + 18]], gold, 4);
        lathe(b, tp[0], tp[1], [[1.7, h + 16], [1.9, h + 20], [0.9, h + 24], [0.02, h + 27]], gold, 8);
      }
      return R * 5;
    }
    case 'opera': {
      // neoclassical temple front: stepped podium, a row of six white Ionic-ish columns, entablature, triangular pediment
      // (tympanum + green gable roof that reads from the elevated game camera), plus the stage fly tower behind.
      const e = longestEdge(ring, d.towards);
      if (!e) return 0;
      const white = rgb(0xf6f3ea), cream = rgb(0xe9e1cc), shade = rgb(0xcfc6b2), green = rgb(0x6f9486);
      const n = e.n, u = e.u, w = Math.max(16, Math.min(e.len * 0.9, 28)), D = 7.5;
      const fx = e.m[0], fz = e.m[1];
      const F = (t, o) => [fx + u[0] * t + n[0] * o, fz + u[1] * t + n[1] * o]; // t along facade, o outwards
      // podium + three steps in front
      const base = 1.3;
      let p = F(0, D / 2 - 0.2);
      obox(b, p[0], base / 2, p[1], w / 2 + 1.2, base / 2, D / 2 + 0.2, u[0], u[1], cream);
      for (let k = 0; k < 3; k++) {
        p = F(0, D + 0.5 + k * 0.7);
        obox(b, p[0], (base * (3 - k)) / 6, p[1], w / 2 + 1.2 - k * 0.2, (base * (3 - k)) / 6, 0.35 + 0.35 * (k === 0 ? 1 : 0), u[0], u[1], k % 2 ? shade : cream);
      }
      // columns: two rows (front + a rear pair at the ends) so the portico reads as open from oblique views
      const ch = Math.max(8, Math.min(h - 4.8, 13)), cr = 0.78, y0 = base, y1 = base + ch;
      const cols = 6, span = w - 2.4;
      for (let i = 0; i < cols; i++) {
        const t = (i / (cols - 1) - 0.5) * span;
        for (const o of (i === 0 || i === cols - 1) ? [D - 1.1, 1.6] : [D - 1.1]) {
          const q = F(t, o);
          lathe(b, q[0], q[1], [[cr * 1.25, y0], [cr * 1.25, y0 + 0.5], [cr, y0 + 0.6], [cr * 0.86, y1 - 0.7], [cr * 1.3, y1 - 0.3], [cr * 1.3, y1]], white, 10);
        }
      }
      // dark loggia wall behind the columns (makes the white columns pop)
      p = F(0, 0.12);
      obox(b, p[0], y0 + ch / 2, p[1], w / 2 - 0.4, ch / 2, 0.12, u[0], u[1], rgb(0x8d8475));
      // entablature (architrave + frieze + cornice)
      p = F(0, D / 2);
      obox(b, p[0], y1 + 0.55, p[1], w / 2 + 0.2, 0.55, D / 2, u[0], u[1], white);
      obox(b, p[0], y1 + 1.35, p[1], w / 2 + 0.6, 0.25, D / 2 + 0.4, u[0], u[1], cream);
      const yp = y1 + 1.6, ph = Math.min(5.5, w * 0.2);
      // pediment prism reaching back into the main building + green gable roof planes over it
      const pc = F(0, D + 0.4);
      pediment(b, pc, u, n, w + 1.2, ph, D + 4, yp, white);
      // recessed tympanum (shaded inner triangle), slightly in front of the pediment face
      const tc = F(0, D + 0.46), hw = (w + 1.2) / 2 - 1.6;
      const TL = [tc[0] - u[0] * hw, yp + 0.45, tc[1] - u[1] * hw], TR = [tc[0] + u[0] * hw, yp + 0.45, tc[1] + u[1] * hw];
      const TA = [tc[0], yp + ph - 0.9, tc[1]];
      b.tri(TL, TR, TA, shade, shade, shade, NW, [n[0], 0, n[1]]);
      // copper-green roof skins over the pediment slopes
      const sl = Math.hypot(ph, (w + 1.2) / 2);
      const L0 = F(-(w + 1.6) / 2, D + 0.6), R0 = F((w + 1.6) / 2, D + 0.6), A0 = F(0, D + 0.6);
      const back = (q) => [q[0] - n[0] * (D + 4.4), q[1], q[2] - n[1] * (D + 4.4)];
      const Lp = [L0[0], yp - 0.05, L0[1]], Rp = [R0[0], yp - 0.05, R0[1]], Ap = [A0[0], yp + ph + 0.12, A0[1]];
      b.quad(Rp, Ap, back(Ap), back(Rp), green, green, green, green, NW, [u[0] * ph / sl, ((w + 1.2) / 2) / sl, u[1] * ph / sl]);
      b.quad(Ap, Lp, back(Lp), back(Ap), green, green, green, green, NW, [-u[0] * ph / sl, ((w + 1.2) / 2) / sl, -u[1] * ph / sl]);
      // acroteria
      for (const t of [-(w + 1.2) / 2, 0, (w + 1.2) / 2]) {
        const q = F(t, D + 0.3);
        obox(b, q[0], (t === 0 ? yp + ph : yp) + 0.6, q[1], 0.35, 0.6, 0.35, u[0], u[1], white);
      }
      // stage fly tower: a tall plain block behind the auditorium, away from the portico
      const fc = at(f, f.cu, f.cv);
      let tx = fc[0] - n[0] * f.L * 0.18, tz = fc[1] - n[1] * f.L * 0.18;
      if (!inside(tx, tz)) { tx = fc[0]; tz = fc[1]; }
      const fh = 7, fu = Math.min(f.W * 0.26, 11), fv = Math.min(f.L * 0.12, 8);
      obox(b, tx, h + fh / 2, tz, fu, fh / 2, fv, u[0], u[1], sh(white, 0.97));
      const R = (su, sv, y) => [tx + u[0] * su + n[0] * sv, y, tz + u[1] * su + n[1] * sv];
      const yr = h + fh, rr = 3.2;
      b.quad(R(-fu, fv, yr), R(fu, fv, yr), R(fu - rr, fv - rr, yr + 2.6), R(-fu + rr, fv - rr, yr + 2.6), green, green, green, green, NW, [n[0], 1, n[1]]);
      b.quad(R(fu, -fv, yr), R(-fu, -fv, yr), R(-fu + rr, -fv + rr, yr + 2.6), R(fu - rr, -fv + rr, yr + 2.6), green, green, green, green, NW, [-n[0], 1, -n[1]]);
      b.quad(R(fu, fv, yr), R(fu, -fv, yr), R(fu - rr, -fv + rr, yr + 2.6), R(fu - rr, fv - rr, yr + 2.6), sh(green, 0.9), sh(green, 0.9), sh(green, 0.9), sh(green, 0.9), NW, [u[0], 1, u[1]]);
      b.quad(R(-fu, -fv, yr), R(-fu, fv, yr), R(-fu + rr, fv - rr, yr + 2.6), R(-fu + rr, -fv + rr, yr + 2.6), sh(green, 0.9), sh(green, 0.9), sh(green, 0.9), sh(green, 0.9), NW, [-u[0], 1, -u[1]]);
      b.quad(R(-fu + rr, fv - rr, yr + 2.6), R(fu - rr, fv - rr, yr + 2.6), R(fu - rr, -fv + rr, yr + 2.6), R(-fu + rr, -fv + rr, yr + 2.6), green, green, green, green, NW, [0, 1, 0]);
      return Math.max(fh + 2.6, yp + ph - h + 1.2);
    }
    case 'stepspire': case 'domespire': {
      const r = Math.max(1.8, Math.min(0.16 * f.W, 3.6));
      let best = [0, 0], bd = -1;
      for (const [su, sv] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.4, 0], [-0.4, 0]]) {
        const p = at(f, f.cu + su * f.L, f.cv + sv * f.W);
        if (!inside(p[0], p[1])) continue;
        const dd = 1 - Math.hypot(su, sv); if (dd > bd) { bd = dd; best = p; }
      }
      const [x, z] = best, green = rgb(0x5f9d89), stone = sh(wall, 0.96);
      if (d.kind === 'stepspire') {
        const S = d.S || 90, y = h;
        lathe(b, x, z, [[r, y], [r, y + S * 0.28]], stone, 8);
        lathe(b, x, z, [[r * 1.45, y + S * 0.28], [r * 1.45, y + S * 0.31], [r * 1.05, y + S * 0.31], [r * 1.05, y + S * 0.48]], stone, 8);
        lathe(b, x, z, [[r * 1.3, y + S * 0.48], [r * 1.3, y + S * 0.5], [r * 0.95, y + S * 0.5]], stone, 8);
        lathe(b, x, z, [[r * 1.15, y + S * 0.5], [r * 0.6, y + S * 0.64], [r * 0.85, y + S * 0.66], [r * 0.4, y + S * 0.8], [r * 0.2, y + S * 0.82], [r * 0.45, y + S * 0.84], [r * 0.12, y + S * 0.92], [0.02, y + S]], green, 8);
        return S;
      }
      const S = d.S || 30, y = h;
      lathe(b, x, z, [[r, y], [r, y + S * 0.4]], stone, 8);
      lathe(b, x, z, [[r * 1.15, y + S * 0.4], [r * 1.2, y + S * 0.46], [r * 1.9, y + S * 0.6], [r * 1.6, y + S * 0.75], [r * 0.5, y + S * 0.88], [r * 0.2, y + S * 0.92], [0.02, y + S]], green, 10);
      return S;
    }
    case 'castle': {
      const red = rgb(0x8c3f2c), stone = rgb(0xdcc07a);
      const pts = [];
      for (const [su, sv] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        let best = null, bs = -1e9;
        for (const q of ring) { const u = q[0] * f.ux + q[1] * f.uz, v = q[0] * f.vx + q[1] * f.vz, s = su * (u - f.cu) + sv * (v - f.cv); if (s > bs) { bs = s; best = q; } }
        pts.push([best[0] * 0.92, best[1] * 0.92]);
      }
      pts.forEach(([x, z], i) => {
        lathe(b, x, z, [[3.2, h - 1], [3.2, h + 5]], stone, 10);
        lathe(b, x, z, [[3.7, h + 5], [3.7, h + 5.5], [0.02, h + 13]], red, 10);
        if (i === 1) flag(b, x, h + 12.5, z, f.ux, f.uz);
      });
      return 13;
    }
    case 'gable': {
      const e = longestEdge(ring);
      if (!e) return 0;
      const brick = rgb(0xa4432e), light = rgb(0xd9c9a6);
      const gw = Math.min(e.len * 0.8, 14);
      const px = e.m[0] - e.n[0] * 0.7, pz = e.m[1] - e.n[1] * 0.7;
      let y = h;
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const w = gw * (1 - i * 0.13);
        obox(b, px, y + 0.9, pz, w / 2, 0.9, 0.55, e.u[0], e.u[1], i % 2 ? brick : sh(brick, 1.06));
        obox(b, px + e.n[0] * 0.58, y + 0.9, pz + e.n[1] * 0.58, w / 2 - 0.3, 0.6, 0.05, e.u[0], e.u[1], light);
        y += 1.8;
      }
      lathe(b, px, pz, [[0.5, y], [0.15, y + 2.4]], rgb(0xd9b24a), 5);
      for (const s of [-1, 1]) lathe(b, px + e.u[0] * s * gw * 0.46, pz + e.u[1] * s * gw * 0.46, [[0.7, h], [0.7, h + 3], [0.02, h + 5]], rgb(0x6f2f24), 5);
      return y - h + 2.4;
    }
    case 'cat': {
      // corner turret + black cat silhouette
      let best = ring[0], bs = -1e9;
      for (const q of ring) { const s = q[0] * 0.7 + q[1] * 0.7; if (s > bs) { bs = s; best = q; } }
      const x = best[0] * 0.8, z = best[1] * 0.8;
      const stone = sh(wall, 0.95), black = rgb(0x15161a);
      lathe(b, x, z, [[1.5, h - 1], [1.5, h + 4.5]], stone, 8);
      lathe(b, x, z, [[1.9, h + 4.5], [1.9, h + 5], [0.02, h + 8.6]], rgb(0x5a6a62), 8);
      addCat(b, x, h + 8.4, z);
      return 10;
    }
    case 'flag': {
      const q = ring[0];
      flag(b, q[0] * 0.85, h, q[1] * 0.85, 1, 0);
      return 7;
    }
    default: return 0;
  }
}
