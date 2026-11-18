// Signature-building generators of the tram city: parametric facade grammars driven by a per-building recipe (see recipes.js). Own code; no photo pixels:
// every number is a derived / hand-set measurement (zones, bay rhythm, window shapes, colours). Big forms go to `lo` (always drawn), small relief to `hi` (near the camera).
//   kind 'order'   : stone facade with a ground band (shopfront / arches / rustication), giant pilasters, windows with hoods, balconies, cornice, attic, optional corner tower / gable / oriels
//   kind 'ribbon'  : modernist / interwar: smooth plaster, horizontal ribbon windows, continuous display glazing + canopy, parapet, rounded corner hint
//   kind 'curtain' : glass curtain wall with spandrel bands (modern office / library)
import { lin, pt, plane, top, bottom, side, box, N3 } from '../facade.js';
const up = [0, 1, 0];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const GA = [128, 0, 0, 0];
const rndOf = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function glassQ(lo, E, u0, u1, y0, y1, off, shop, id, hash, tint) {
  lo.quad([pt(E, u0, y0, off), pt(E, u1, y0, off), pt(E, u1, y1, off), pt(E, u0, y1, off)], N3(E), tint || [0.1, 0.12, 0.15], [1, 1, 1, 1], [[id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0]], GA, [shop ? 255 : 0, 0, 0, Math.round(hash * 255)]);
}
/** a wall strip with a vertical AO gradient */
function strip(acc, E, u0, u1, y0, y1, off, col, k0 = 1, k1 = 1) { acc.quad([pt(E, u0, y0, off), pt(E, u1, y0, off), pt(E, u1, y1, off), pt(E, u0, y1, off)], N3(E), col, [k0, k0, k1, k1]); }
function archGlass(lo, hi, E, uc, w, y0, y1, trim, id, hash, off = 0.1) {
  const r = w / 2, ys = y1 - r, seg = 8; glassQ(lo, E, uc - r, uc + r, y0, ys, off, false, id, hash);
  for (let i = 0; i < seg; i++) { const a0 = Math.PI * i / seg, a1 = Math.PI * (i + 1) / seg; const A0 = [uc - Math.cos(a0) * r, ys + Math.sin(a0) * r], A1 = [uc - Math.cos(a1) * r, ys + Math.sin(a1) * r];
    lo.quad([pt(E, A0[0], ys, off), pt(E, A1[0], ys, off), pt(E, A1[0], A1[1], off), pt(E, A0[0], A0[1], off)], N3(E), [0.1, 0.12, 0.15], [1, 1, 1, 1], [[id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0]], GA, [0, 0, 0, Math.round(hash * 255)]);
    const o = r + 0.22; hi.quad([pt(E, uc - Math.cos(a0) * r, ys + Math.sin(a0) * r, off + 0.03), pt(E, uc - Math.cos(a1) * r, ys + Math.sin(a1) * r, off + 0.03), pt(E, uc - Math.cos(a1) * o, ys + Math.sin(a1) * o, off + 0.05), pt(E, uc - Math.cos(a0) * o, ys + Math.sin(a0) * o, off + 0.05)], N3(E), trim, [1, 1, 1, 1]); }
}
/** round tower with a conical (or domed) roof, standing at world x,z; base y0, shaft to y1, roof up to y2 */
export function tower(acc, x, z, y0, y1, y2, r, wallCol, roofCol, o = {}) {
  const n = o.n || 10, dome = o.dome, shade = [0.92, 0.92, 1, 1];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    acc.quad([[x + c0 * r, y0, z + s0 * r], [x + c1 * r, y0, z + s1 * r], [x + c1 * r, y1, z + s1 * r], [x + c0 * r, y1, z + s0 * r]], [Math.cos(am), 0, Math.sin(am)], wallCol, shade);
    if (o.cornice) acc.quad([[x + c0 * (r + 0.35), y1 - 0.3, z + s0 * (r + 0.35)], [x + c1 * (r + 0.35), y1 - 0.3, z + s1 * (r + 0.35)], [x + c1 * (r + 0.35), y1 + 0.1, z + s1 * (r + 0.35)], [x + c0 * (r + 0.35), y1 + 0.1, z + s0 * (r + 0.35)]], [Math.cos(am), 0, Math.sin(am)], o.trim || wallCol, shade);
    if (dome) { // 3 rings of a bulb
      const prof = [[1, 0], [1.08, 0.18], [0.82, 0.42], [0.45, 0.7], [0.16, 0.9], [0, 1]]; for (let k = 0; k + 1 < prof.length; k++) { const r0 = r * prof[k][0], r1 = r * prof[k + 1][0], h0 = y1 + (y2 - y1) * prof[k][1], h1 = y1 + (y2 - y1) * prof[k + 1][1];
        acc.quad([[x + c0 * r0, h0, z + s0 * r0], [x + c1 * r0, h0, z + s1 * r0], [x + c1 * r1, h1, z + s1 * r1], [x + c0 * r1, h1, z + s0 * r1]], [Math.cos(am) * 0.7, 0.7, Math.sin(am) * 0.7], roofCol, [1, 1, 1, 1]); }
    } else acc.tri([[x + c0 * (r + 0.3), y1, z + s0 * (r + 0.3)], [x + c1 * (r + 0.3), y1, z + s1 * (r + 0.3)], [x, y2, z]], [Math.cos(am) * 0.6, 0.8, Math.sin(am) * 0.6], roofCol, 1);
  }
  if (o.windows) for (let k = 0; k < (o.windows | 0); k++) { const a = (k / o.windows) * Math.PI * 2, wy = y0 + (y1 - y0) * (o.wy ?? 0.55); const cx = x + Math.cos(a) * (r + 0.04), cz = z + Math.sin(a) * (r + 0.04), tx = -Math.sin(a), tz = Math.cos(a);
    acc.quad([[cx - tx * 0.4, wy, cz - tz * 0.4], [cx + tx * 0.4, wy, cz + tz * 0.4], [cx + tx * 0.4, wy + 1.4, cz + tz * 0.4], [cx - tx * 0.4, wy + 1.4, cz - tz * 0.4]], [Math.cos(a), 0, Math.sin(a)], [0.06, 0.08, 0.11], [1, 1, 1, 1]); }
  if (o.spire) { const sp = o.spire; acc.tri([[x - 0.25, y2, z - 0.25], [x + 0.25, y2, z - 0.25], [x, y2 + sp, z]], [0, 0.2, -1], roofCol, 1); acc.tri([[x - 0.25, y2, z + 0.25], [x + 0.25, y2, z + 0.25], [x, y2 + sp, z]], [0, 0.2, 1], roofCol, 1); acc.tri([[x - 0.25, y2, z - 0.25], [x - 0.25, y2, z + 0.25], [x, y2 + sp, z]], [-1, 0.2, 0], roofCol, 1); acc.tri([[x + 0.25, y2, z - 0.25], [x + 0.25, y2, z + 0.25], [x, y2 + sp, z]], [1, 0.2, 0], roofCol, 1); }
}

/** one wall edge of a signature building. S = recipe (colours as hex), B = the building's base style (for fallbacks) */
export function sigFacade(lo, hi, E, B, S, seed = 1) {
  const L = E.len, H = E.top - E.y0, y0 = E.y0; if (L < 2.5 || H < 3) return;
  const rnd = rndOf(seed + Math.round(E.ax * 7 + E.az * 13));
  const wall = S.wall != null ? lin(S.wall) : B.wall, trim = S.trim != null ? lin(S.trim) : B.trim, baseC = S.baseCol != null ? lin(S.baseCol) : mul(wall, 0.82), dark = [0.07, 0.09, 0.12];
  const kind = S.kind || 'order';
  if (kind === 'curtain') return curtain(lo, hi, E, S, wall, trim, rnd);
  if (kind === 'ribbon') return ribbon(lo, hi, E, S, wall, trim, baseC, rnd);
  return order(lo, hi, E, S, wall, trim, baseC, rnd, dark);
}

function order(lo, hi, E, S, wall, trim, baseC, rnd, dark) {
  const L = E.len, H = E.top - E.y0, y0 = E.y0, tc = S.tower ? 0 : 0;
  const gh = Math.min(S.gh ?? 4.2, H * 0.42), att = S.att ? Math.min(S.att, H * 0.15) : 0, co = Math.min(S.co ?? 1.1, H * 0.12), par = S.parapet || 0;
  const upper = H - gh - co - att; const fh0 = S.fh || 3.6; const nUp = Math.max(1, S.floors || Math.round(upper / fh0)); const fh = upper / nUp;
  const nb = Math.max(1, Math.round(L / (S.bay || 3.4))), bay = L / nb;
  const yU = y0 + gh, yT = y0 + H - co - att;                  // upper wall from yU to yT
  const hash = rnd();
  // wall: base zone (AO ramp) + upper + attic
  strip(lo, E, 0, L, y0, y0 + Math.min(0.9, gh), 0, baseC, 0.78, 0.9); strip(lo, E, 0, L, y0 + Math.min(0.9, gh), yU, 0, baseC, 0.92, 1);
  strip(lo, E, 0, L, yU, yT, 0, wall, 0.98, 1); if (att > 0) strip(lo, E, 0, L, yT, yT + att, 0, S.attCol != null ? lin(S.attCol) : wall, 1, 0.96); strip(lo, E, 0, L, yT + att, y0 + H, 0, wall, 0.96, 0.93);
  if (S.rust !== false && gh > 2) for (let y = y0 + 0.9; y < yU - 0.4; y += 0.62) strip(hi, E, 0, L, y, y + 0.05, 0.03, mul(baseC, 0.62));
  // string course above the base, cornice, attic band
  box(lo, E, 0, L, yU - 0.18, yU + 0.22, 0.2, trim);
  const cd = S.corniceProj ?? 0.8;
  box(lo, E, -0.2, L + 0.2, y0 + H - att - co, y0 + H - att - co + 0.28, cd * 0.55, trim); box(lo, E, -0.2, L + 0.2, y0 + H - att - 0.4, y0 + H - att + 0.08, cd, trim);
  if (att > 0) { box(lo, E, -0.2, L + 0.2, y0 + H - 0.28, y0 + H, 0.35, trim); }
  if (par > 0) { box(lo, E, 0, L, y0 + H, y0 + H + par, 0.28, trim); }
  // order: pilasters (flat) on bay boundaries
  const ev = S.pilEvery || 0;
  if (ev > 0) for (let b = 0; b <= nb; b += ev) { const u = Math.max(0.4, Math.min(L - 0.4, b * bay)); const w = S.pilW || 0.8, d = S.pilProj || 0.32;
    box(lo, E, u - w / 2, u + w / 2, yU, yT + att * 0.5, d, trim);
    box(lo, E, u - w / 2 - 0.12, u + w / 2 + 0.12, yT + att * 0.5, yT + att * 0.5 + 0.35, d + 0.1, trim);
    box(lo, E, u - w / 2 - 0.1, u + w / 2 + 0.1, yU, yU + 0.4, d + 0.08, trim);
    if (S.pilBase) box(lo, E, u - w / 2 - 0.08, u + w / 2 + 0.08, y0, yU, d * 0.7, S.pilBase === true ? mul(baseC, 1.08) : lin(S.pilBase)); }
  // ground band
  for (let b = 0; b < nb; b++) {
    const u0 = b * bay, uc = u0 + bay / 2, id = rnd() * 1000;
    const gt = S.ground || 'shop';
    if (gt === 'shop') { // big display glazing between piers, fascia band above, recessed doors on some bays
      const w = bay - (S.pier ?? 1.5), yb = y0 + 0.55, yt = yU - (S.fascia ?? 0.9) - 0.15; if (w > 0.8 && yt - yb > 1.6) {
        glassQ(lo, E, uc - w / 2, uc + w / 2, yb, yt, 0.12, true, id, rnd());
        box(hi, E, uc - w / 2 - 0.12, uc - w / 2, y0, yt + 0.1, 0.22, trim); box(hi, E, uc + w / 2, uc + w / 2 + 0.12, y0, yt + 0.1, 0.22, trim);
        box(hi, E, uc - w / 2 - 0.1, uc + w / 2 + 0.1, yb - 0.5, yb, 0.16, mul(baseC, 0.8));
        if (S.mullions !== false && w > 2.4) for (let k = 1; k < 3; k++) plane(hi, E, uc - w / 2 + (w * k) / 3 - 0.03, uc - w / 2 + (w * k) / 3 + 0.03, yb, yt, 0.14, dark);
        if (b % 3 === 1 && w > 2) { plane(hi, E, uc - 0.6, uc + 0.6, y0, y0 + 2.4, 0.16, [0.12, 0.1, 0.09]); }
      }
      const fc = S.fasciaCol != null ? (Array.isArray(S.fasciaCol) ? lin(S.fasciaCol[b % S.fasciaCol.length]) : lin(S.fasciaCol)) : mul(trim, 0.9);
      box(hi, E, u0 + 0.15, u0 + bay - 0.15, yU - (S.fascia ?? 0.9) - 0.1, yU - 0.2, 0.3, fc);
      if (S.canopy && b % 2 === 0) { const cw = bay * 0.9; hi.quad([pt(E, uc - cw / 2, yU - 1.3, 0.2), pt(E, uc + cw / 2, yU - 1.3, 0.2), pt(E, uc + cw / 2, yU - 1.3, S.canopy), pt(E, uc - cw / 2, yU - 1.3, S.canopy)], up, mul(trim, 0.7), [1, 1, 1, 1]); plane(hi, E, uc - cw / 2, uc + cw / 2, yU - 1.5, yU - 1.3, S.canopy, mul(trim, 0.6)); }
    } else if (gt === 'arch') {
      const w = Math.min(2.4, bay * 0.55); const door = (S.doorBays || []).includes(b);
      box(hi, E, uc - w / 2 - 0.3, uc + w / 2 + 0.3, y0, yU - 0.8, 0.12, mul(baseC, 1.12)); archGlass(lo, hi, E, uc, w, y0 + (door ? 0.2 : 0.7), yU - 0.8, trim, id, rnd(), 0.17);
    } else if (gt === 'window') { const w = Math.min(1.7, bay * 0.45); glassQ(lo, E, uc - w / 2, uc + w / 2, y0 + 1.0, yU - 0.8, 0.1, false, id, rnd()); box(hi, E, uc - w / 2 - 0.12, uc + w / 2 + 0.12, y0 + 0.9, y0 + 1.0, 0.16, trim); }
    // upper floors
    for (let f = 0; f < nUp; f++) {
      const fy = yU + f * fh, nobile = S.nobile != null && f === S.nobile;
      let wy0 = fy + fh * (S.wy ?? 0.2), wy1 = fy + fh * (S.wyT ?? 0.82); if (nobile) { wy0 = fy + 0.35; wy1 = fy + fh - 0.3; }
      const wt = S.win || 'flat', ww = Math.min((S.ww || 0.46) * bay * (nobile ? 1.1 : 1), 2.2), paired = wt === 'paired';
      const cuts = paired ? [-bay * 0.19, bay * 0.19] : [0], w1 = paired ? ww * 0.5 : ww;
      for (const dx of cuts) {
        const uw = uc + dx; if (uw - w1 / 2 < 0.3 || uw + w1 / 2 > L - 0.3) continue;
        const arch = wt === 'arch' || (S.archTop === f);
        if (arch) archGlass(lo, hi, E, uw, w1, wy0, wy1, trim, id + f, rnd(), 0.08); else glassQ(lo, E, uw - w1 / 2, uw + w1 / 2, wy0, wy1, 0.08, false, id + f * 7, rnd());
        box(hi, E, uw - w1 / 2 - 0.14, uw - w1 / 2, wy0 - 0.02, wy1 + 0.1, 0.14, trim); box(hi, E, uw + w1 / 2, uw + w1 / 2 + 0.14, wy0 - 0.02, wy1 + 0.1, 0.14, trim);
        box(hi, E, uw - w1 / 2 - 0.2, uw + w1 / 2 + 0.2, wy0 - 0.2, wy0, 0.26, trim);
        if (!arch) { box(hi, E, uw - w1 / 2 - 0.2, uw + w1 / 2 + 0.2, wy1, wy1 + 0.28, 0.24, trim);
          if (S.hood === 'tri' && f === (S.hoodFloor ?? 0)) hi.tri([pt(E, uw - w1 / 2 - 0.35, wy1 + 0.28, 0.24), pt(E, uw + w1 / 2 + 0.35, wy1 + 0.28, 0.24), pt(E, uw, wy1 + 0.95, 0.24)], N3(E), trim, 1); }
        plane(hi, E, uw - 0.025, uw + 0.025, wy0, wy1, 0.1, trim);
      }
      if (S.balc && S.balc.floors.includes(f) && b % (S.balc.every || 1) === 0) { const bw = Math.min(bay * 0.9, 2.6), by = wy0 - 0.05; box(hi, E, uc - bw / 2, uc + bw / 2, by - 0.18, by, 0.75, trim); plane(hi, E, uc - bw / 2, uc + bw / 2, by, by + 0.95, 0.75, mul(trim, 0.55));
        for (let q = 0; q <= 6; q++) { const uq = uc - bw / 2 + (bw * q) / 6; plane(hi, E, uq - 0.02, uq + 0.02, by, by + 0.95, 0.75, dark); } }
    }
    // attic windows
    if (att > 0) { const w = Math.min(1.1, bay * 0.3); glassQ(lo, E, uc - w / 2, uc + w / 2, yT + att * 0.25, yT + att * 0.8, 0.07, false, id + 99, rnd()); }
  }
  // corner tower / gable / oriel / roof extras
  for (const G of S.gable ? (Array.isArray(S.gable) ? S.gable : [S.gable]) : []) { const gu = G.u != null ? G.u * L : L / 2, gw = Math.min(G.w || 6, L * 0.5), gh2 = G.h || 3.5, yb = y0 + H; strip(lo, E, gu - gw / 2, gu + gw / 2, yb, yb + 0.9, 0.0, wall);
    for (const sg of [-1, 1]) lo.tri([pt(E, gu + sg * gw / 2, yb + 0.9, 0.05), pt(E, gu, yb + gh2, 0.05), pt(E, gu + sg * gw * 0.18, yb + 0.9, 0.05)], N3(E), wall, 1);
    lo.tri([pt(E, gu - gw / 2, yb + 0.9, 0.05), pt(E, gu + gw / 2, yb + 0.9, 0.05), pt(E, gu, yb + gh2, 0.05)], N3(E), wall, 1); glassQ(lo, E, gu - 0.6, gu + 0.6, yb + 0.2, yb + gh2 * 0.62, 0.08, false, 5, 0.5); }
  if (S.oriel) for (const ou of S.oriel.at) { const uc = ou * L, ow = S.oriel.w || 2.4, d = S.oriel.d || 0.9, f0 = S.oriel.from ?? 1, f1 = S.oriel.to ?? nUp - 1, ya = yU + f0 * fh + 0.4, yb2 = yU + f1 * fh + fh * 0.95;
    if (uc - ow / 2 < 0.4 || uc + ow / 2 > L - 0.4) continue;
    box(hi, E, uc - ow / 2, uc + ow / 2, ya, yb2, d, wall); for (let f = f0; f <= f1; f++) glassQ(lo, E, uc - ow / 2 + 0.3, uc + ow / 2 - 0.3, yU + f * fh + fh * 0.22, yU + f * fh + fh * 0.8, d + 0.03, false, 40 + f, 0.5);
    box(hi, E, uc - ow / 2 - 0.1, uc + ow / 2 + 0.1, yb2, yb2 + 0.25, d + 0.12, trim); hi.quad([pt(E, uc - ow / 2 - 0.15, yb2 + 0.25, d + 0.15), pt(E, uc + ow / 2 + 0.15, yb2 + 0.25, d + 0.15), pt(E, uc + ow / 2, yb2 + 1.5, 0.1), pt(E, uc - ow / 2, yb2 + 1.5, 0.1)], [E.nx * 0.5, 0.85, E.nz * 0.5], S.roofCol != null ? lin(S.roofCol) : [0.28, 0.3, 0.3], [1, 1, 1, 1]); }
  if (S.banner) { const bu = S.banner.u * L, bw = S.banner.w || 3, bh = S.banner.h || 7, by = yU + 1.2; box(lo, E, bu - bw / 2 - 0.15, bu + bw / 2 + 0.15, by - 0.15, by + bh + 0.15, 0.45, [0.2, 0.2, 0.2]); plane(lo, E, bu - bw / 2, bu + bw / 2, by, by + bh, 0.5, lin(S.banner.col || 0xa3202e)); plane(lo, E, bu - bw * 0.22, bu + bw * 0.22, by + bh * 0.3, by + bh * 0.7, 0.51, lin(0xe8e0d8)); }
  if (S.statues) for (let b = 0; b <= nb; b += S.statues) { const u = Math.max(0.7, Math.min(L - 0.7, b * bay)); box(lo, E, u - 0.5, u + 0.5, y0 + H, y0 + H + 0.9, 0.6, trim); box(lo, E, u - 0.28, u + 0.28, y0 + H + 0.9, y0 + H + 2.3, 0.4, trim); }
}

function ribbon(lo, hi, E, S, wall, trim, baseC, rnd) {
  const L = E.len, H = E.top - E.y0, y0 = E.y0;
  const gh = Math.min(S.gh ?? 3.6, H * 0.6), par = S.parapet ?? 0.5, nUp = Math.max(0, S.floors ?? Math.round((H - gh) / 3.4)), fh = nUp ? (H - gh - par) / nUp : 0, can = S.canopy ?? 1.6;
  strip(lo, E, 0, L, y0, y0 + 0.5, 0, baseC, 0.8, 0.95); strip(lo, E, 0, L, y0 + 0.5, y0 + H, 0, wall, 0.98, 0.95);
  // ground: continuous display glazing in bays, plain fascia board where a sign would be, canopy
  const nb = Math.max(1, Math.round(L / (S.bay || 4.2))), bay = L / nb, yt = y0 + gh - 0.95;
  for (let b = 0; b < nb; b++) { const u0 = b * bay, id = rnd() * 1000; glassQ(lo, E, u0 + 0.22, u0 + bay - 0.22, y0 + 0.45, yt, 0.1, true, id, rnd()); box(hi, E, u0 - 0.1, u0 + 0.1, y0, yt + 0.2, 0.2, trim); if (bay > 3) plane(hi, E, u0 + bay / 2 - 0.03, u0 + bay / 2 + 0.03, y0 + 0.45, yt, 0.12, [0.1, 0.1, 0.12]); }
  box(lo, E, 0, L, yt + 0.1, y0 + gh, 0.25, S.fasciaCol != null ? lin(S.fasciaCol) : mul(trim, 0.88));
  if (can > 0) { lo.quad([pt(E, -0.2, y0 + gh + 0.05, 0.1), pt(E, L + 0.2, y0 + gh + 0.05, 0.1), pt(E, L + 0.2, y0 + gh + 0.05, can), pt(E, -0.2, y0 + gh + 0.05, can)], up, mul(trim, 0.72), [1, 1, 1, 1]); plane(lo, E, -0.2, L + 0.2, y0 + gh - 0.18, y0 + gh + 0.05, can, mul(trim, 0.6)); lo.quad([pt(E, -0.2, y0 + gh - 0.18, 0.1), pt(E, L + 0.2, y0 + gh - 0.18, 0.1), pt(E, L + 0.2, y0 + gh - 0.18, can), pt(E, -0.2, y0 + gh - 0.18, can)], [0, -1, 0], [0.5, 0.5, 0.5], [0.7, 0.7, 0.7, 0.7]); }
  // upper floors: ribbon windows (long glazed bands split by narrow piers) over spandrel bands
  for (let f = 0; f < nUp; f++) { const fy = y0 + gh + f * fh, w0 = fy + fh * 0.3, w1 = fy + fh * 0.84; const nw = Math.max(1, Math.round(L / (S.win || 2.6))), ww = L / nw;
    for (let k = 0; k < nw; k++) { glassQ(lo, E, k * ww + 0.2, (k + 1) * ww - 0.2, w0, w1, 0.06, false, rnd() * 1000, rnd()); }
    box(hi, E, 0, L, w0 - 0.14, w0, 0.18, trim); box(hi, E, 0, L, w1, w1 + 0.1, 0.12, trim); for (let k = 0; k <= nw; k++) plane(hi, E, Math.max(0, k * ww - 0.07), Math.min(L, k * ww + 0.07), w0, w1, 0.1, trim); }
  box(lo, E, -0.1, L + 0.1, y0 + H - par - 0.1, y0 + H + 0.1, 0.35, trim);
  if (S.sign) { box(lo, E, L * 0.2, L * 0.8, y0 + H + 0.1, y0 + H + 1.3, 0.3, S.signCol != null ? lin(S.signCol) : [0.55, 0.12, 0.1]); }   // plain roof-top sign board (no lettering)
}

function curtain(lo, hi, E, S, wall, trim, rnd) {
  const L = E.len, H = E.top - E.y0, y0 = E.y0, fh = S.fh || 3.6, nUp = Math.max(1, Math.round(H / fh)), f2 = H / nUp, nb = Math.max(1, Math.round(L / (S.bay || 2.4))), bay = L / nb;
  const gc = S.glass != null ? lin(S.glass) : [0.1, 0.16, 0.2];
  strip(lo, E, 0, L, y0, y0 + H, 0, wall, 0.95, 1);
  for (let f = 0; f < nUp; f++) for (let b = 0; b < nb; b++) { const w0 = y0 + f * f2 + 0.9, w1 = y0 + (f + 1) * f2 - 0.15; glassQ(lo, E, b * bay + 0.05, (b + 1) * bay - 0.05, f ? w0 : y0 + 0.3, w1, 0.05, f === 0, rnd() * 1000, rnd(), gc); }
  for (let f = 0; f <= nUp; f++) box(hi, E, 0, L, y0 + f * f2 - 0.05, y0 + f * f2 + 0.08, 0.14, trim);
  for (let b = 0; b <= nb; b++) plane(hi, E, Math.max(0, b * bay - 0.04), Math.min(L, b * bay + 0.04), y0, y0 + H, 0.1, trim);
  box(lo, E, 0, L, y0 + H, y0 + H + 0.5, 0.25, trim);
}
