// Facade emitters of the tram city: one wall edge of a building -> lo geometry (wall strips with baked AO + shader window attributes, cornice, string course)
// and hi geometry (window frames + sills, shop piers / awnings / signboards, door, balconies, dormers). Own code, own parameters (see docs/proto/tram.md).
const up = [0, 1, 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lin = (hex) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const AWN = [0x9a3b32, 0x2f6b4f, 0x2f4f7d, 0xb98a36, 0x6a4a7a, 0xc9c2b0].map(lin);
const SIGN = [0x2b2f33, 0xd9d2c0, 0x4a5a52, 0x7a2f2f, 0x354764, 0xe6d9a8, 0x8f2a2a, 0x1f5a45, 0x23405f, 0xc4962d, 0x2f7f86, 0xe9e4da, 0x6b3a2a, 0x9a6a8a].map(lin);
const RAIL = lin(0x4a4d52), DARK = lin(0x2a2c30), WOOD = lin(0x4a3424);

/** edge geometry helper: point at (u metres along, y, off metres out) */
function pt(E, u, y, off) { return [E.ax + E.dx * u + E.nx * off, y, E.az + E.dz * u + E.nz * off]; }
const N3 = (E) => [E.nx, 0, E.nz];
function plane(acc, E, u0, u1, y0, y1, off, col, k = 1) { acc.quad([pt(E, u0, y0, off), pt(E, u1, y0, off), pt(E, u1, y1, off), pt(E, u0, y1, off)], N3(E), col, [k, k, k, k]); }
function top(acc, E, u0, u1, y, o0, o1, col) { acc.quad([pt(E, u0, y, o0), pt(E, u1, y, o0), pt(E, u1, y, o1), pt(E, u0, y, o1)], up, col, [1, 1, 1, 1]); }
function bottom(acc, E, u0, u1, y, o0, o1, col) { acc.quad([pt(E, u0, y, o0), pt(E, u1, y, o0), pt(E, u1, y, o1), pt(E, u0, y, o1)], [0, -1, 0], col, [0.7, 0.7, 0.7, 0.7]); }
function side(acc, E, u, y0, y1, o0, o1, col, sgn) { acc.quad([pt(E, u, y0, o0), pt(E, u, y0, o1), pt(E, u, y1, o1), pt(E, u, y1, o0)], [E.dx * sgn, 0, E.dz * sgn], col, [0.85, 0.85, 0.85, 0.85]); }
/** box with its back on the wall plane: front + top + two sides */
function box(acc, E, u0, u1, y0, y1, d, col) { plane(acc, E, u0, u1, y0, y1, d, col); top(acc, E, u0, u1, y1, 0, d, col); side(acc, E, u0, y0, y1, 0, d, col, -1); side(acc, E, u1, y0, y1, 0, d, col, 1); }

/** wall rhythm of one edge from the building style B: bay count, adjusted bay width, floors */
export function rhythm(B, E) {
  const gh = B.gh > 0 && E.top - E.y0 > B.gh + 2.2 ? B.gh : 0;
  const co = E.top - E.y0 > 7 ? B.co : 0;
  const upperH = Math.max(1, E.top - E.y0 - gh - co * 0.5);
  let nUp = B.nF > 0 ? Math.max(1, B.nF) : Math.max(1, Math.round(upperH / B.fh));
  let fh = upperH / nUp; if (fh < 2.5 || fh > 5.2) { nUp = Math.max(1, Math.round(upperH / clamp(B.fh, 2.8, 4.2))); fh = upperH / nUp; }
  fh = Math.round(fh / 6 * 255) / 255 * 6;
  const nb = Math.max(1, Math.round(E.len / B.sp)); const bay = E.len / nb;
  return { gh, co, nUp, fh, nb, bay };
}

export function emitLo(lo, E, B, detailed) {
  const R = rhythm(B, E), win = B.win && E.len >= 2.4 && E.top - E.y0 > 2.6;
  const A = [win ? 255 : 0, Math.round(R.fh / 6 * 255), 0, Math.round(B.ww * 255)], Bv = [Math.round(B.wh * 255), Math.round(B.wy * 255), Math.round(R.gh / 8 * 255), Math.round(B.hash * 255)];
  const uvw = (s, y) => [s * R.nb, (y - E.y0 - R.gh) / R.fh, E.top - y, y - E.y0];
  const H = E.top - E.y0;
  const stops = detailed && H > 4.6 ? [[0, 0.8], [0.9, 0.88], [3.2, 1.0], [H - 0.8, 1.0], [H, 0.93]] : [[0, 0.82], [Math.min(3.4, H), 1.0], [H, 0.96]];
  for (let i = 0; i + 1 < stops.length; i++) {
    const ya = E.y0 + stops[i][0], yb = E.y0 + stops[i + 1][0]; if (yb - ya < 0.02) continue;
    const col = detailed && i === 0 && stops.length > 3 ? B.plinth : B.wall;
    lo.quad([pt(E, 0, ya, 0), pt(E, E.len, ya, 0), pt(E, E.len, yb, 0), pt(E, 0, yb, 0)], N3(E), col, [stops[i][1], stops[i][1], stops[i + 1][1], stops[i + 1][1]], [uvw(0, ya), uvw(1, ya), uvw(1, yb), uvw(0, yb)], A, Bv);
  }
  if (detailed && H > 7 && R.co > 0.05) { // projecting cornice
    const d = Math.min(0.55, 0.22 + R.co * 0.22), t = B.trim, y1 = E.top + 0.1;
    bottom(lo, E, 0, E.len, E.top - 0.32, 0, d, t); plane(lo, E, 0, E.len, E.top - 0.32, y1, d, t, 0.97); top(lo, E, 0, E.len, y1, d, 0, t);
  }
  if (detailed && R.gh > 1.5) { const y = E.y0 + R.gh; plane(lo, E, 0, E.len, y - 0.1, y + 0.12, 0.09, B.trim); top(lo, E, 0, E.len, y + 0.12, 0.09, 0, B.trim); }
  return R;
}

export function emitHi(hi, E, B, R, rnd) {
  const { gh, nUp, fh, nb, bay } = R, t = B.trim;
  const y0 = E.y0;
  // upper windows: jambs, lintel, sill
  const ww = B.ww * bay, wl0 = (bay - ww) / 2;
  for (let f = 0; f < nUp; f++) {
    const yb = y0 + gh + (f + B.wy) * fh, yt = yb + B.wh * fh;
    if (yt > E.top - 0.4 - 0.0) break;
    for (let b = 0; b < nb; b++) {
      const u0 = b * bay + wl0, u1 = u0 + ww;
      plane(hi, E, u0 - 0.1, u0, yb - 0.02, yt + 0.14, 0.04, t); plane(hi, E, u1, u1 + 0.1, yb - 0.02, yt + 0.14, 0.04, t); plane(hi, E, u0, u1, yt, yt + 0.14, 0.05, t);
      box(hi, E, u0 - 0.08, u1 + 0.08, yb - 0.1, yb, 0.14, t);
      if (ww > 1.1) plane(hi, E, (u0 + u1) / 2 - 0.025, (u0 + u1) / 2 + 0.025, yb, yt, 0.03, t); // mullion
    }
  }
  // balconies on the second floor (floor index 1) of some buildings: slab + railing
  if (B.balc && nUp >= 3 && bay > 2.3) {
    const yS = y0 + gh + fh * 1;
    for (let b = 1; b < nb; b += 3) {
      const uc = (b + 0.5) * bay, u0 = uc - Math.min(bay * 0.38, 0.9), u1 = uc + Math.min(bay * 0.38, 0.9);
      box(hi, E, u0, u1, yS - 0.14, yS, 0.85, t);
      plane(hi, E, u0, u1, yS, yS + 0.32, 0.85, t); plane(hi, E, u0, u1, yS + 0.92, yS + 1.0, 0.85, RAIL); side(hi, E, u0, yS + 0.92, yS + 1.0, 0, 0.85, RAIL, -1); side(hi, E, u1, yS + 0.92, yS + 1.0, 0, 0.85, RAIL, 1);
      for (let q = 0; q <= 4; q++) { const uq = u0 + ((u1 - u0) * q) / 4; plane(hi, E, uq - 0.02, uq + 0.02, yS + 0.32, yS + 0.92, 0.85, RAIL); }
    }
  }
  // ground band: piers, signboards, awnings, door
  if (gh > 1.5) {
    const gw = 0.82, pier = (1 - gw) * bay;
    for (let b = 0; b <= nb; b++) { const u = b * bay; box(hi, E, Math.max(0, u - pier / 2), Math.min(E.len, u + pier / 2), y0, y0 + gh - 0.25, 0.1, B.shopTrim); }
    const sgn = SIGN[Math.floor(rnd() * SIGN.length)], span2 = Math.max(1, Math.round(nb / Math.max(1, Math.round(nb / 2))));
    for (let b = 0; b < nb; b += span2) { const u0 = b * bay + pier / 2, u1 = Math.min(E.len - 0.1, (b + span2) * bay - pier / 2); if (u1 - u0 > 1) box(hi, E, u0, u1, y0 + gh - 0.58, y0 + gh - 0.14, 0.14, sgn); }
    if (rnd() < 0.55 && B.shopAwn) {
      const col = AWN[Math.floor(rnd() * AWN.length)], yT = y0 + gh - 0.7;
      for (let b = 0; b < nb; b += 2) {
        const u0 = b * bay + pier / 2, u1 = Math.min(E.len, (b + 2) * bay) - pier / 2; if (u1 - u0 < 1) continue;
        hi.quad([pt(E, u0, yT, 0.05), pt(E, u1, yT, 0.05), pt(E, u1, yT - 0.55, 1.15), pt(E, u0, yT - 0.55, 1.15)], [E.nx * 0.55, 0.83, E.nz * 0.55], col, [1, 1, 1, 1]);
        plane(hi, E, u0, u1, yT - 0.8, yT - 0.55, 1.15, col, 0.9);
      }
    }
    if (E.len > 5 && nb >= 3) { const uc = 1.5 * bay; plane(hi, E, uc - 0.6, uc + 0.6, y0, y0 + 2.3, 0.12, WOOD); plane(hi, E, uc - 0.72, uc + 0.72, y0 + 2.3, y0 + 2.5, 0.14, t); top(hi, E, uc - 0.75, uc + 0.75, y0 + 0.12, 0.05, 0.6, B.stone); }
  }
  // dormers on a mansard / pitched roof (roof rises above the eave by B.roofRise)
  if (B.roofRise > 1.8 && B.roofRise < 7 && bay > 2.3 && E.top - y0 > 8) {
    const yE = E.top;
    for (let b = 0; b < nb; b += 2) {
      const uc = (b + 0.5) * bay, u0 = uc - 0.65, u1 = uc + 0.65, hh = 1.45;
      plane(hi, E, u0, u1, yE + 0.05, yE + hh, 0.1, B.wall); plane(hi, E, uc - 0.4, uc + 0.4, yE + 0.35, yE + hh - 0.25, 0.14, DARK);
      side(hi, E, u0, yE, yE + hh, 0.1, -0.7, B.roofCol, -1); side(hi, E, u1, yE, yE + hh, 0.1, -0.7, B.roofCol, 1);
      hi.quad([pt(E, u0 - 0.1, yE + hh, 0.15), pt(E, u1 + 0.1, yE + hh, 0.15), pt(E, u1 + 0.1, yE + hh + 0.45, -0.7), pt(E, u0 - 0.1, yE + hh + 0.45, -0.7)], [E.nx * 0.4, 0.9, E.nz * 0.4], B.roofCol, [1, 1, 1, 1]);
    }
  }
}

/** chimney: 1.0 x 1.0 m shaft on the roof */
export function chimney(hi, x, z, yb, yt, col) {
  const h = 0.5, P = (dx, dz, y) => [x + dx, y, z + dz];
  const sides = [[[-h, -h], [h, -h], [0, -1]], [[h, -h], [h, h], [1, 0]], [[h, h], [-h, h], [0, 1]], [[-h, h], [-h, -h], [-1, 0]]];
  for (const [a, b, n] of sides) hi.quad([P(a[0], a[1], yb), P(b[0], b[1], yb), P(b[0], b[1], yt), P(a[0], a[1], yt)], [n[0], 0, n[1]], col, [0.9, 0.9, 1, 1]);
  hi.quad([P(-h - 0.08, -h - 0.08, yt), P(h + 0.08, -h - 0.08, yt), P(h + 0.08, h + 0.08, yt), P(-h - 0.08, h + 0.08, yt)], up, [0.25, 0.25, 0.27], [1, 1, 1, 1]);
}

// ===================== round 2: windows from a PLAN (measured or generic) =====================
/** generic plan for an unmeasured facade: real proportions (windows ~1.25 x 1.95 m on ~3.6 m floors, bays 2.4-3.4 m, ~40 % window share) */
export function planGeneric(E, B) {
  const gh = B.gh > 0 && E.top - E.y0 > B.gh + 2.4 ? B.gh : 0, co = E.top - E.y0 > 7 ? Math.min(B.co, 0.9) : 0;
  const upperH = Math.max(1, E.top - E.y0 - gh - co * 0.5 - 0.2);
  let nUp = B.nF > 0 ? B.nF : Math.max(1, Math.round(upperH / clamp(B.fh, 3.2, 4.0)));
  let fh = upperH / nUp; if (fh < 2.7) { nUp = Math.max(1, Math.floor(upperH / 3.0)); fh = upperH / nUp; }
  const sp = clamp(B.sp, 2.3, 3.4), nb = Math.max(1, Math.round((E.len - 1.0) / sp)), bay = (E.len - 1.0) / nb;
  const ww = clamp(B.wwM || 1.25, 0.95, 1.5), wh = clamp(fh * 0.55, 1.5, 2.1);
  const wins = [];
  for (let f = 0; f < nUp; f++) { const b = E.y0 + gh + f * fh + Math.min(0.95, fh * 0.26); for (let c = 0; c < nb; c++) wins.push({ u: 0.5 + (c + 0.5) * bay, w: ww, v0: b, v1: b + wh, f }); }
  return { gh, wins, ground: null, gk: gh > 0 ? 1 : 0, fh, nUp, measured: false, bay };
}
/** plan from a measured run: window rectangles at the measured positions, sizes clamped to sane window sizes, ground glazing from the measured ground band */
export function planMeasured(E, B, run, uOff) {
  const gh = run.gh && E.top - E.y0 > run.gh + 2.4 ? run.gh : (run.gk === 0 ? (B.gh > 0 && E.top - E.y0 > B.gh + 2.4 ? B.gh : 0) : 0);
  const wins = []; let fh = 3.5;
  if (run.rows && run.cols) {
    const cen = run.rows.map((r) => (r[0] + r[1]) / 2); if (cen.length > 1) fh = (cen[cen.length - 1] - cen[0]) / (cen.length - 1);
    run.rows.forEach((r, f) => {
      const cy = (r[0] + r[1]) / 2 + E.y0, h = clamp(r[1] - r[0], 1.5, 2.2), v0 = cy - h / 2, v1 = cy + h / 2; if (v1 > E.top - 0.45 || v0 < E.y0 + gh - 0.05) return;
      run.cols.forEach(([uc, w], k) => { if (!((run.mask[f] >> k) & 1)) return; const u = uc - uOff, ww = clamp(w, 0.9, 1.6); if (u - ww / 2 < 0.2 || u + ww / 2 > E.len - 0.2) return; wins.push({ u, w: ww, v0, v1, f }); });
    });
  }
  let ground = null;
  if (run.gc && run.gk === 1) { ground = []; for (const [uc, w] of run.gc) { const u = uc - uOff, ww = Math.min(w, 5.5); if (u - ww / 2 < 0.15 || u + ww / 2 > E.len - 0.15) continue; ground.push({ u, w: ww }); } }
  return { gh, wins, ground, gk: run.gk || 0, fh, nUp: run.rows ? run.rows.length : 0, measured: !!run.rows, bay: 3 };
}

const GLASS_A = [128, 0, 0, 0];
function glass(lo, E, u0, u1, y0, y1, shop, id, hash) {
  lo.quad([pt(E, u0, y0, 0.03), pt(E, u1, y0, 0.03), pt(E, u1, y1, 0.03), pt(E, u0, y1, 0.03)], N3(E), [0.1, 0.12, 0.15], [1, 1, 1, 1], [[id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0], [id, 0, 0, 0]], GLASS_A, [shop ? 255 : 0, 0, 0, Math.round(hash * 255)]);
}

/** wall + glass + character for one corridor edge following the plan; hi: relief */
export function emitFromPlan(lo, hi, E, B, plan, rnd, relief) {
  const H = E.top - E.y0, gh = plan.gh, trim = B.trim, wallH = H;
  // wall strips: rusticated / darker base band over the ground floor, light AO ramp, top shade
  const baseCol = B.plinth, up = [0, 1, 0];
  const stops = [[0, 0.78, baseCol], [Math.min(0.9, H), 0.86, baseCol], [gh > 1.5 ? gh : Math.min(3.2, H), 0.98, gh > 1.5 ? baseCol : B.wall], [Math.max(gh + 0.3, H - 0.9), 1.0, B.wall], [H, 0.93, B.wall]];
  const seg = [];
  for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1][0] - stops[i][0] > 0.02) seg.push([stops[i], stops[i + 1]]);
  for (const [s0, s1] of seg) { const ya = E.y0 + s0[0], yb = E.y0 + s1[0]; lo.quad([pt(E, 0, ya, 0), pt(E, E.len, ya, 0), pt(E, E.len, yb, 0), pt(E, 0, yb, 0)], N3(E), s0[2], [s0[1], s0[1], s1[1], s1[1]]); }
  // string course above the ground floor + cornice at the eave
  if (gh > 1.5) { const y = E.y0 + gh; plane(lo, E, 0, E.len, y - 0.12, y + 0.16, 0.12, trim); top(lo, E, 0, E.len, y + 0.16, 0.12, 0, trim); bottom(lo, E, 0, E.len, y - 0.12, 0, 0.12, trim); }
  if (H > 6.5 && B.co > 0.05) { const d = Math.min(0.6, 0.25 + B.co * 0.22), y1 = E.top + 0.12; bottom(lo, E, 0, E.len, E.top - 0.36, 0, d, trim); plane(lo, E, 0, E.len, E.top - 0.36, y1, d, trim, 0.97); top(lo, E, 0, E.len, y1, d, 0, trim); }
  // glazing: upper windows
  for (const w of plan.wins) glass(lo, E, w.u - w.w / 2, w.u + w.w / 2, w.v0, w.v1, false, rnd(), B.hash);
  // ground floor: shop glazing at measured columns (or a generic band), rustication joints elsewhere
  if (gh > 1.5) {
    const gl = plan.ground || (plan.gk === 1 ? (() => { const nb = Math.max(1, Math.round(E.len / 3.4)), bay = E.len / nb, a = []; for (let c = 0; c < nb; c++) a.push({ u: (c + 0.5) * bay, w: bay * 0.78 }); return a; })() : null);
    if (gl) for (const g of gl) glass(lo, E, g.u - g.w / 2, g.u + g.w / 2, E.y0 + 0.5, E.y0 + gh - 0.6, true, rnd(), B.hash);
    else if (plan.gk === 2) for (let c = 0; c * 3.2 + 1.5 < E.len; c++) { const u = 1.5 + c * 3.2; glass(lo, E, u, u + 0.9, E.y0 + 0.9, E.y0 + 2.2, false, rnd(), B.hash); }
  }
  if (!relief) return;
  // relief: frames + sills on every window, shop piers, fascia boards, sparse awnings, a door, balconies, dormers
  for (const w of plan.wins) {
    const u0 = w.u - w.w / 2, u1 = w.u + w.w / 2, yb = w.v0, yt = w.v1;
    plane(hi, E, u0 - 0.1, u0, yb - 0.02, yt + 0.14, 0.04, trim); plane(hi, E, u1, u1 + 0.1, yb - 0.02, yt + 0.14, 0.04, trim); plane(hi, E, u0, u1, yt, yt + 0.14, 0.05, trim);
    box(hi, E, u0 - 0.08, u1 + 0.08, yb - 0.1, yb, 0.14, trim);
    if (w.w > 1.15) plane(hi, E, w.u - 0.025, w.u + 0.025, yb, yt, 0.03, trim);
  }
  if (gh > 1.5) {
    const gl = plan.ground || [];
    const sgn = SIGN[Math.floor(rnd() * SIGN.length)];
    for (const g of gl) { const u0 = g.u - g.w / 2, u1 = g.u + g.w / 2; plane(hi, E, u0 - 0.2, u0, E.y0, E.y0 + gh - 0.45, 0.08, B.shopTrim); plane(hi, E, u1, u1 + 0.2, E.y0, E.y0 + gh - 0.45, 0.08, B.shopTrim); box(hi, E, u0 - 0.2, u1 + 0.2, E.y0 + gh - 0.62, E.y0 + gh - 0.12, 0.12, sgn); box(hi, E, u0, u1, E.y0, E.y0 + 0.45, 0.06, B.stone);
      if (B.shopAwn && rnd() < 0.3 && g.w > 1.6) { const col = AWN[Math.floor(rnd() * AWN.length)], yT = E.y0 + gh - 0.7; hi.quad([pt(E, u0, yT, 0.05), pt(E, u1, yT, 0.05), pt(E, u1, yT - 0.55, 1.15), pt(E, u0, yT - 0.55, 1.15)], [E.nx * 0.55, 0.83, E.nz * 0.55], col, [1, 1, 1, 1]); plane(hi, E, u0, u1, yT - 0.8, yT - 0.55, 1.15, col, 0.9); } }
    if (E.len > 5) { const gu = gl.length ? gl[0].u + gl[0].w / 2 + 0.6 : E.len * 0.2; if (gu + 0.7 < E.len) { plane(hi, E, gu - 0.55, gu + 0.55, E.y0, E.y0 + 2.3, 0.12, WOOD); plane(hi, E, gu - 0.68, gu + 0.68, E.y0 + 2.3, E.y0 + 2.5, 0.14, trim); top(hi, E, gu - 0.7, gu + 0.7, E.y0 + 0.12, 0.05, 0.6, B.stone); } }
  }
  if (B.balc && plan.nUp >= 3) { const r1 = plan.wins.filter((w) => w.f === 1); const yS = r1.length ? r1[0].v0 - 0.0 : E.y0 + gh + plan.fh;
    for (let k = 0; k < r1.length; k += 3) { const w = r1[k], u0 = w.u - 0.8, u1 = w.u + 0.8; box(hi, E, u0, u1, yS - 0.14, yS, 0.8, trim); plane(hi, E, u0, u1, yS, yS + 0.32, 0.8, trim); plane(hi, E, u0, u1, yS + 0.92, yS + 1.0, 0.8, RAIL); for (let q = 0; q <= 4; q++) { const uq = u0 + ((u1 - u0) * q) / 4; plane(hi, E, uq - 0.02, uq + 0.02, yS + 0.32, yS + 0.92, 0.8, RAIL); } } }
  if (B.roofRise > 1.8 && B.roofRise < 7 && E.top - E.y0 > 8) { const yE = E.top, step = Math.max(2, Math.round(5 / Math.max(1, plan.bay || 3)));
    const cs = plan.wins.filter((w) => w.f === plan.nUp - 1);
    for (let k = 0; k < cs.length; k += 2) { const uc = cs[k].u, u0 = uc - 0.65, u1 = uc + 0.65, hh = 1.45;
      plane(hi, E, u0, u1, yE + 0.05, yE + hh, 0.1, B.wall); plane(hi, E, uc - 0.4, uc + 0.4, yE + 0.35, yE + hh - 0.25, 0.14, DARK);
      side(hi, E, u0, yE, yE + hh, 0.1, -0.7, B.roofCol, -1); side(hi, E, u1, yE, yE + hh, 0.1, -0.7, B.roofCol, 1);
      hi.quad([pt(E, u0 - 0.1, yE + hh, 0.15), pt(E, u1 + 0.1, yE + hh, 0.15), pt(E, u1 + 0.1, yE + hh + 0.45, -0.7), pt(E, u0 - 0.1, yE + hh + 0.45, -0.7)], [E.nx * 0.4, 0.9, E.nz * 0.4], B.roofCol, [1, 1, 1, 1]); } }
}

// ===================== heroes =====================
const FROM_E = (E, u, y, off) => pt(E, u, y, off);
/** neoclassical portico on an edge: stylobate + steps, N round columns, entablature, pediment with a sculpture-group hint, tall entrance doors. White stone. */
export function portico(acc, E, o) {
  const { cols = 6, w = 16, h = 12.5, d = 4.6, col = lin(0xf1ede2), roof = lin(0x7f9a8c) } = o, uc = o.uc ?? E.len / 2, u0 = uc - w / 2, u1 = uc + w / 2, y0 = E.y0, shade = [0.9, 0.9, 1, 1];
  const dark = lin(0x3a3a3c);
  box(acc, E, u0 - 0.4, u1 + 0.4, y0, y0 + 1.1, d + 0.9, col);                                            // stylobate
  for (let s = 0; s < 3; s++) box(acc, E, u0 + 1.0 + s * 0.2, u1 - 1.0 - s * 0.2, y0, y0 + 0.3 * (s + 1), d + 1.1 + s * 0.1 - 0.0, col);   // steps hint
  plane(acc, E, uc - 2.2, uc + 2.2, y0 + 1.1, y0 + 6.6, 0.08, dark);                                       // central doors
  const r = 0.62, n = 8;
  for (let k = 0; k < cols; k++) {
    const u = u0 + 0.9 + ((w - 1.8) * k) / (cols - 1), cxm = E.ax + E.dx * u + E.nx * (d - 0.8), czm = E.az + E.dz * u + E.nz * (d - 0.8);
    for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2; acc.quad([[cxm + Math.cos(a0) * r, y0 + 1.1, czm + Math.sin(a0) * r], [cxm + Math.cos(a1) * r, y0 + 1.1, czm + Math.sin(a1) * r], [cxm + Math.cos(a1) * r, y0 + h, czm + Math.sin(a1) * r], [cxm + Math.cos(a0) * r, y0 + h, czm + Math.sin(a0) * r]], [Math.cos(am), 0, Math.sin(am)], col, shade); }
    box(acc, E, u - 0.8, u + 0.8, y0 + h, y0 + h + 0.35, d - 0.1, col); box(acc, E, u - 0.8, u + 0.8, y0 + 1.1, y0 + 1.5, d - 0.1, col);   // capital / base blocks
  }
  box(acc, E, u0 - 0.3, u1 + 0.3, y0 + h + 0.35, y0 + h + 1.7, d + 0.2, col);                             // entablature
  // pediment: triangle in front + raking cornice + roof slopes behind
  const pb = y0 + h + 1.7, ph = 3.6, t = (u, y, off) => pt(E, u, y, off);
  acc.tri([t(u0 - 0.3, pb, d + 0.2), t(u1 + 0.3, pb, d + 0.2), t(uc, pb + ph, d + 0.2)], N3(E), col, 1);
  for (const sg of [-1, 1]) { const ue = uc + sg * (w / 2 + 0.3); acc.quad([t(ue, pb, d + 0.2), t(uc, pb + ph, d + 0.2), t(uc, pb + ph, 0), t(ue, pb, 0)], [E.nx * 0.45, 0.89, E.nz * 0.45], roof, [1, 1, 1, 1]); }
  for (let k = -2; k <= 2; k++) { const hh = 0.9 + 0.5 * (2 - Math.abs(k)); box(acc, E, uc + k * 1.7 - 0.45, uc + k * 1.7 + 0.45, pb, pb + hh, d + 0.3, lin(0xd9d4c4)); }   // sculpture group hint
  // tall windows between the side columns and on the wall behind (plain dark panes)
  for (let k = 0; k < 5; k++) { const u = u0 + 2.0 + k * ((w - 4.0) / 4); if (Math.abs(u - uc) < 2.6) continue; plane(acc, E, u - 0.55, u + 0.55, y0 + 3.2, y0 + 9.0, 0.06, dark); }
}

/** barrel-vault hangar gable: glazed arch + mullions + a door band (Centrāltirgus pavilions) */
export function archGable(acc, E, o = {}) {
  const w = E.len * 0.86, u0 = (E.len - w) / 2, uc = E.len / 2, yb = E.y0 + 3.4, R = w / 2, rise = Math.min(R * 0.8, 7.5), glassC = [0.12, 0.17, 0.22], steel = lin(0x4d5a55);
  const seg = 14, P = (i) => { const a = Math.PI * (i / seg); return [uc - Math.cos(a) * R, yb + Math.sin(a) * rise]; };
  const gl = (shop) => [[1, 1, 1], shop];
  const A = [128, 0, 0, 0], B = [0, 0, 0, 120];
  for (let i = 0; i < seg; i++) { const p = P(i), q = P(i + 1); acc.quad([pt(E, p[0], yb, 0.05), pt(E, q[0], yb, 0.05), pt(E, q[0], q[1], 0.05), pt(E, p[0], p[1], 0.05)], N3(E), glassC, [1, 1, 1, 1], acc.full ? [[7, 0, 0, 0], [7, 0, 0, 0], [7, 0, 0, 0], [7, 0, 0, 0]] : null, A, B); }
  for (let k = 0; k <= 6; k++) { const u = u0 + (w * k) / 6, a = Math.acos(Math.max(-1, Math.min(1, (uc - u) / R))), top = yb + Math.sin(a) * rise; plane(acc, E, u - 0.07, u + 0.07, yb, top, 0.1, steel); }
  for (let i = 0; i < seg; i++) { const p = P(i), q = P(i + 1); acc.quad([pt(E, p[0], p[1] - 0.1, 0.12), pt(E, q[0], q[1] - 0.1, 0.12), pt(E, q[0], q[1] + 0.12, 0.12), pt(E, p[0], p[1] + 0.12, 0.12)], N3(E), steel, [1, 1, 1, 1]); }
  plane(acc, E, u0, u0 + w, E.y0 + 0.2, yb, 0.08, lin(0x55605c));
  for (let k = 0; k < 5; k++) { const u = u0 + 1.2 + k * ((w - 2.4) / 4); plane(acc, E, u - 0.9, u + 0.9, E.y0 + 0.3, E.y0 + 2.9, 0.12, lin(0x3b4642)); }
}

// ===================== round 3: grand-order facade of a landmark (Opera) =====================
// Everything goes into the lo layer (always drawn, also from far away). A[0] = 40 marks "floodlit stone" (the material adds a warm evening glow), glass quads use the
// measured-glass flag (A[0] = 128) with the shop flag set (B[0] = 200) so most of them are lit at night.
export function grandFacade(lo, E, B, o = {}) {
  const H = E.top - E.y0, y0 = E.y0, L = E.len, wall = B.wall, trim = B.trim, stone = wall.map((v) => v * 0.9);
  const gh = Math.min(o.gh ?? 6.4, H * 0.28), att = Math.min(3.4, H * 0.12), corn = 1.3, hp = H - gh - att - corn;
  const A = [40, 0, 0, 0], GA = [128, 0, 0, 0], GB = [200, 0, 0, 0], dark = [0.05, 0.075, 0.11], joint = wall.map((v) => v * 0.62);
  const U = (v, w = 0) => [v, 0, 0, 0], q = (a, b, c, d, n, col, k = 1) => lo.quad([a, b, c, d], n, col, [k, k, k, k], null, A);
  const P = (u, y, off) => pt(E, u, y, off), n3 = N3(E);
  const pl = (u0, u1, ya, yb, off, col, k = 1) => q(P(u0, ya, off), P(u1, ya, off), P(u1, yb, off), P(u0, yb, off), n3, col, k);
  const tp = (u0, u1, y, o0, o1, col) => q(P(u0, y, o0), P(u1, y, o0), P(u1, y, o1), P(u0, y, o1), up, col);
  const bx = (u0, u1, ya, yb, d, col) => { pl(u0, u1, ya, yb, d, col); tp(u0, u1, yb, 0, d, col); lo.quad([P(u0, ya, 0), P(u0, ya, d), P(u0, yb, d), P(u0, yb, 0)], [-E.dx, 0, -E.dz], col, [0.85, 0.85, 0.85, 0.85], null, A); lo.quad([P(u1, ya, 0), P(u1, ya, d), P(u1, yb, d), P(u1, yb, 0)], [E.dx, 0, E.dz], col, [0.85, 0.85, 0.85, 0.85], null, A); };
  const glass = (u0, u1, ya, yb, off, h) => lo.quad([P(u0, ya, off), P(u1, ya, off), P(u1, yb, off), P(u0, yb, off)], n3, dark, [1, 1, 1, 1], [[h, 0, 0, 0], [h, 0, 0, 0], [h, 0, 0, 0], [h, 0, 0, 0]], GA, GB);
  // wall body: darker rusticated base (horizontal joints), plain upper wall
  pl(0, L, y0, y0 + gh, 0, stone, 0.92); pl(0, L, y0 + gh, E.top, 0, wall, 1);
  for (let y = y0 + 0.7; y < y0 + gh - 0.3; y += 0.7) pl(0, L, y, y + 0.06, 0.03, joint);
  const nb = Math.max(2, Math.round(L / 4.6)), bay = L / nb, rnd = (k) => { const h = Math.sin(k * 91.7 + 3.1) * 43758.5; return h - Math.floor(h); };
  // string course on top of the base + cornice + attic band
  bx(0, L, y0 + gh - 0.2, y0 + gh + 0.35, 0.28, trim);
  for (let b = 0; b < nb; b++) {
    const u0 = b * bay, uc = u0 + bay / 2, w = Math.min(2.3, bay * 0.52);
    // ground floor: round-arched opening (door in the middle bay of a short wall, window elsewhere) in a rusticated surround
    const yb = y0 + 0.5 + (b % 2 ? 0.7 : 0), ys = y0 + gh * 0.52, r = w / 2;
    bx(uc - w / 2 - 0.25, uc + w / 2 + 0.25, yb - 0.1, ys + 0.2, 0.12, wall);
    glass(uc - w / 2, uc + w / 2, yb, ys, 0.17, 3 + b);
    const seg = 8; for (let i = 0; i < seg; i++) { const a0 = Math.PI * i / seg, a1 = Math.PI * (i + 1) / seg; lo.quad([P(uc - Math.cos(a0) * r, ys, 0.17), P(uc - Math.cos(a1) * r, ys, 0.17), P(uc - Math.cos(a1) * (r + 0.28), ys + Math.sin(a1) * (r + 0.28) * 0.9, 0.2), P(uc - Math.cos(a0) * (r + 0.28), ys + Math.sin(a0) * (r + 0.28) * 0.9, 0.2)], n3, trim, [1, 1, 1, 1], null, A); lo.tri([P(uc, ys, 0.17), P(uc - Math.cos(a0) * r, ys + Math.sin(a0) * r * 0.9, 0.17), P(uc - Math.cos(a1) * r, ys + Math.sin(a1) * r * 0.9, 0.17)], n3, dark, 1, GA, GB); }
    // piano nobile: tall window with a triangular / segmental hood, sill, between pilasters
    const wy0 = y0 + gh + 1.2, wy1 = y0 + gh + hp - 1.6, ww = Math.min(2.0, bay * 0.46);
    if (wy1 - wy0 > 2) {
      glass(uc - ww / 2, uc + ww / 2, wy0, wy1, 0.1, 40 + b);
      pl(uc - ww / 2 - 0.22, uc - ww / 2, wy0 - 0.05, wy1 + 0.2, 0.14, trim); pl(uc + ww / 2, uc + ww / 2 + 0.22, wy0 - 0.05, wy1 + 0.2, 0.14, trim); bx(uc - ww / 2 - 0.3, uc + ww / 2 + 0.3, wy1, wy1 + 0.4, 0.3, trim);
      lo.tri([P(uc - ww / 2 - 0.4, wy1 + 0.4, 0.3), P(uc + ww / 2 + 0.4, wy1 + 0.4, 0.3), P(uc, wy1 + 1.15, 0.3)], n3, trim, 1, A); bx(uc - ww / 2 - 0.25, uc + ww / 2 + 0.25, wy0 - 0.3, wy0, 0.35, trim);
      // small square window (frieze level) above
      const sy = y0 + gh + hp - 1.1; glass(uc - 0.45, uc + 0.45, sy, sy + 0.75, 0.08, 80 + b);
    }
    // attic: row of small windows
    glass(uc - 0.7, uc + 0.7, E.top - att - corn + 0.7, E.top - corn - 0.5, 0.06, 120 + b);
  }
  // giant-order pilasters between the bays (every bay boundary), capitals, entablature
  for (let b = 0; b <= nb; b++) { const u = Math.max(0.35, Math.min(L - 0.35, b * bay)); bx(u - 0.38, u + 0.38, y0 + gh + 0.35, y0 + gh + hp, 0.34, trim); bx(u - 0.55, u + 0.55, y0 + gh + hp, y0 + gh + hp + 0.35, 0.44, trim); bx(u - 0.5, u + 0.5, y0 + gh + 0.35, y0 + gh + 0.8, 0.4, trim); }
  bx(0, L, y0 + gh + hp + 0.35, y0 + gh + hp + 0.8, 0.5, trim);
  pl(0, L, y0 + gh + hp + 0.8, E.top - corn, 0.06, wall.map((v) => v * 0.97));
  bx(0, L, E.top - corn, E.top - 0.35, 0.75, trim); bx(0, L, E.top - 0.35, E.top + 0.25, 0.95, trim);
  // acroteria: a statue block on the corners and over every 3rd pilaster
  for (let b = 0; b <= nb; b += 3) { const u = Math.max(0.7, Math.min(L - 0.7, b * bay)); bx(u - 0.5, u + 0.5, E.top + 0.25, E.top + 1.1, 0.7, trim); bx(u - 0.28, u + 0.28, E.top + 1.1, E.top + 2.3, 0.45, trim); }
}

export { pt, plane, top, bottom, side, box, N3 };

/** archetype relief on top of a plan-based facade: 'nouveau' = oriels (bay windows over floors 1..n-1) + hooded / arched window heads on the top floor; 'eclectic' = pedimented hoods on the first upper floor, segmental heads above;
 *  'func' = bold floor bands (interwar / Soviet modernist). Cheap: hi layer only. */
export function archExtras(hi, E, B, plan, arch, rnd) {
  const trim = B.trim, wins = plan.wins; if (!wins.length) return;
  const nUp = plan.nUp || 1;
  if (arch === 'nouveau' && E.len > 7 && nUp >= 3) {
    const cols = wins.filter((w) => w.f === 1).map((w) => w.u).filter((u) => u > 2.2 && u < E.len - 2.2); if (cols.length) {
      const picks = [cols[Math.floor(cols.length * 0.25)], cols[Math.floor(cols.length * 0.75)]].filter((v, i, a) => v != null && a.indexOf(v) === i);
      for (const uc of picks) { const w1 = wins.find((w) => w.f === 1 && w.u === uc), ow = (w1 ? w1.w : 1.2) + 0.9, d = 0.85, f1 = Math.max(1, nUp - 2), wa = wins.find((w) => w.f === 1), wb = wins.find((w) => w.f === f1); if (!wa || !wb) continue; const ya = wa.v0 - 0.2, yb = wb.v1 + 0.45;
        box(hi, E, uc - ow / 2, uc + ow / 2, ya, yb, d, B.wall); for (let f = 1; f <= f1; f++) { const ww = wins.find((w) => w.f === f && w.u === uc) || wins.find((w) => w.f === f); if (ww) plane(hi, E, uc - ow / 2 + 0.28, uc + ow / 2 - 0.28, ww.v0, ww.v1, d + 0.03, [0.09, 0.12, 0.16]); }
        box(hi, E, uc - ow / 2 - 0.1, uc + ow / 2 + 0.1, yb, yb + 0.22, d + 0.1, trim); hi.quad([pt(E, uc - ow / 2 - 0.12, yb + 0.22, d + 0.12), pt(E, uc + ow / 2 + 0.12, yb + 0.22, d + 0.12), pt(E, uc + ow / 2, yb + 1.3, 0.05), pt(E, uc - ow / 2, yb + 1.3, 0.05)], [E.nx * 0.5, 0.85, E.nz * 0.5], B.roofCol, [1, 1, 1, 1]); }
    }
    for (const w of wins) if (w.f === nUp - 1) { const u0 = w.u - w.w / 2, u1 = w.u + w.w / 2; hi.tri([pt(E, u0 - 0.15, w.v1 + 0.14, 0.1), pt(E, u1 + 0.15, w.v1 + 0.14, 0.1), pt(E, w.u, w.v1 + 0.62, 0.1)], N3(E), trim, 1); }
  } else if (arch === 'eclectic' && nUp >= 2) {
    for (const w of wins) { const u0 = w.u - w.w / 2, u1 = w.u + w.w / 2;
      if (w.f === 1) { hi.tri([pt(E, u0 - 0.25, w.v1 + 0.3, 0.12), pt(E, u1 + 0.25, w.v1 + 0.3, 0.12), pt(E, w.u, w.v1 + 0.95, 0.12)], N3(E), trim, 1); box(hi, E, u0 - 0.22, u1 + 0.22, w.v1 + 0.14, w.v1 + 0.3, 0.16, trim); }
      else if (w.f > 1 && w.f < nUp - 1) box(hi, E, u0 - 0.18, u1 + 0.18, w.v1 + 0.12, w.v1 + 0.3, 0.14, mul(trim, 0.95)); }
  } else if (arch === 'func' && nUp >= 2) {
    const ys = new Set(wins.map((w) => w.f)); for (const f of ys) { const w = wins.find((q) => q.f === f); box(hi, E, 0, E.len, w.v0 - 0.2, w.v0 - 0.05, 0.1, trim); }
  }
}
