// The route as a 1-D world: raw OSM track vertices -> smooth Catmull-Rom centre line sampled every metre, with heading, curvature, a speed-limit
// profile (curves, stops) and the stops projected onto it. Pure maths + THREE.CatmullRomCurve3 (no DOM), so scripts can run it under node.
import * as THREE from 'three';

export const SPEED = { max: 13.9, aLat: 1.15, vCurveMin: 4.4, comfortDecel: 0.9, switchV: 8.3 };   // m/s (13.9 = 50 km/h); lateral accel the curve limit allows
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const DS = 1;                                                                        // sample spacing, metres

export function buildTrack(route, opts = {}) {
  const pts = route.path.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, pts.length * 24);
  curve.updateArcLengths();
  const L = curve.getLength();
  const n = Math.floor(L / DS);
  let sp = curve.getSpacedPoints(n);   // n + 1 points, equal arc length
  // A tram cannot take a corner tighter than ~7 m: OSM junction corners are often one or two vertices (R of a few metres once splined). Where the 3 m-scale radius
  // is below RMIN the dense line is relaxed (each point pulled towards the mean of its neighbours 3 m either side) until it fits, then resampled to equal arc length.
  // The line moves < ~2 m at such a corner; stops / switches keep their position within that.
  const RMIN = opts.rmin ?? 7.2;
  if (RMIN > 0) {
    const m = Math.round(L / 0.5), dense = curve.getSpacedPoints(m), K = 3;   // dense points every L/m ~ 0.5 m; K points = ~1.5 m either side: the scale of one tram module (2.52 m), which is what decides how far a body sags
    const px = dense.map((q) => q.x), pz = dense.map((q) => q.z), M = dense.length;
    const kapAt = (i) => { const a = Math.atan2(pz[i] - pz[i - K], px[i] - px[i - K]), b = Math.atan2(pz[i + K] - pz[i], px[i + K] - px[i]); let d = b - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return Math.abs(d) / (Math.hypot(px[i + K] - px[i - K], pz[i + K] - pz[i - K]) / 2 + 1e-9); };
    const kmax = 1 / RMIN;   // local radius below RMIN (default 7.2 m: a module chord of 2.52 m then sags 0.11 m)
    const pin = new Uint8Array(M), ox = px.slice(), oz = pz.slice(), BUDGET = 2.5;   // a point never moves more than 2.5 m from the OSM line (so a stop stays beside its platform)
    for (let it = 0; it < 300; it++) {
      let worst = 0; const bad = [];
      for (let i = K + 1; i < M - K - 1; i++) { const k = kapAt(i); if (k > worst) worst = k; if (k > kmax * 0.98) bad.push(i); }
      if (!bad.length) break;
      const nx = [], nz = [];
      for (const i of bad) for (let j = i - 4; j <= i + 4; j++) if (j > 6 && j < M - 7 && !pin[j]) { nx[j] = 0.5 * px[j] + 0.25 * (px[j - 6] + px[j + 6]); nz[j] = 0.5 * pz[j] + 0.25 * (pz[j - 6] + pz[j + 6]); }
      for (const j in nx) { let dx = nx[j] - ox[j], dz = nz[j] - oz[j]; const d = Math.hypot(dx, dz); if (d > BUDGET) { dx *= BUDGET / d; dz *= BUDGET / d; } px[j] = ox[j] + dx; pz[j] = oz[j] + dz; }
    }
    // resample to equal arc length
    const cum = [0]; for (let i = 1; i < M; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
    const L2 = cum[M - 1], n2 = Math.floor(L2 / DS); sp = [];
    for (let k = 0, j = 0; k <= n2; k++) { const d = (k / n2) * L2; while (j < M - 2 && cum[j + 1] < d) j++; const u = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]); sp.push({ x: px[j] + (px[j + 1] - px[j]) * u, z: pz[j] + (pz[j + 1] - pz[j]) * u }); }
  }
  const Lt = RMIN > 0 ? (() => { let a = 0; for (let i = 1; i < sp.length; i++) a += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].z - sp[i - 1].z); return a; })() : L;
  const ds = Lt / (sp.length - 1);
  const N = sp.length;
  const x = new Float64Array(N), z = new Float64Array(N), yaw = new Float64Array(N), kap = new Float64Array(N), lim = new Float64Array(N);
  for (let i = 0; i < N; i++) { x[i] = sp[i].x; z[i] = sp[i].z; }
  // heading of the tangent (central difference over +-2 m); continuous (unwrapped) so interpolation never jumps
  const hd = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2); hd[i] = Math.atan2(z[b] - z[a], x[b] - x[a]); }
  for (let i = 1; i < N; i++) { let d = hd[i] - hd[i - 1]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; hd[i] = hd[i - 1] + d; }
  // curvature = d(heading)/ds smoothed over ~+-10 m (OSM vertices ~30 m apart: raw curvature is noisy)
  const W = 10;
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - W), b = Math.min(N - 1, i + W); kap[i] = (hd[b] - hd[a]) / ((b - a) * ds); }
  for (let i = 0; i < N; i++) yaw[i] = hd[i];

  const T = {
    n: N, ds, length: Lt, x, z, yaw, kap, lim, stops: [],
    /** index (float) of s */
    _f(s) { return Math.min(N - 1.0001, Math.max(0, s / ds)); },
    /** {x, z, yaw} at arc length s (clamped; beyond the ends it extrapolates straight so a long tram can stand on the first metres) */
    at(s, out = {}) {
      if (s < 0 || s > Lt) {
        const e = s < 0 ? 0 : N - 1, d = s < 0 ? s : s - Lt;
        out.x = x[e] + Math.cos(yaw[e]) * d; out.z = z[e] + Math.sin(yaw[e]) * d; out.yaw = yaw[e]; return out;
      }
      const f = T._f(s), i = Math.floor(f), u = f - i;
      out.x = x[i] + (x[i + 1] - x[i]) * u; out.z = z[i] + (z[i + 1] - z[i]) * u; out.yaw = yaw[i] + (yaw[i + 1] - yaw[i]) * u;
      return out;
    },
    curvature(s) { const f = T._f(s), i = Math.floor(f); return kap[i] + (kap[i + 1] - kap[i]) * (f - i); },
    limit(s) { const f = T._f(s), i = Math.floor(f); return lim[i] + (lim[i + 1] - lim[i]) * (f - i); },
    /** nearest point of the centre line to (px, pz) within [s0, s1] (search window, metres): {s, d} (exact distance to the polyline, s refined on the segment) */
    nearest(px, pz, s0 = 0, s1 = Lt) {
      let best = -1, bd = 1e18;
      for (let i = Math.max(0, Math.floor(s0 / ds)); i <= Math.min(N - 1, Math.ceil(s1 / ds)); i++) { const d = (x[i] - px) ** 2 + (z[i] - pz) ** 2; if (d < bd) { bd = d; best = i; } }
      let bs = best * ds, dd = Math.sqrt(bd);
      for (const j of [best - 1, best]) {   // refine on the two segments around the closest sample
        if (j < 0 || j + 1 >= N) continue;
        const ax = x[j + 1] - x[j], az = z[j + 1] - z[j], l2 = ax * ax + az * az; if (!l2) continue;
        const u = clamp01(((px - x[j]) * ax + (pz - z[j]) * az) / l2), d = Math.hypot(x[j] + ax * u - px, z[j] + az * u - pz);
        if (d < dd) { dd = d; bs = (j + u) * ds; }
      }
      return { s: bs, d: dd };
    },
  };

  // stops: projected in order, each strictly after the previous one (the same place is passed in both directions on a loop route)
  let from = 0;
  for (const st of route.stops) {
    const r = T.nearest(st.x, st.z, from, Lt);
    T.stops.push({ name: st.name, s: r.s, offTrack: r.d });
    from = r.s + 60;
  }
  // speed-limit profile: line speed, curve limit, switches (facing points: 30 km/h over 8 m before .. 14 m after), stop approach limits; then made brakeable
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kap[i]);
    lim[i] = Math.min(SPEED.max, k > 1e-4 ? Math.max(SPEED.vCurveMin, Math.sqrt(SPEED.aLat / k)) : SPEED.max);
  }
  T.switches = [];
  for (const sw of route.switches || []) {
    const r = T.nearest(sw.x, sw.z); if (r.d > 3) continue;
    T.switches.push(r.s);
    for (let i = Math.max(0, Math.floor((r.s - 8) / ds)); i <= Math.min(N - 1, Math.ceil((r.s + 14) / ds)); i++) lim[i] = Math.min(lim[i], SPEED.switchV);
  }
  // restriction zones (curves / switches below 36 km/h) for the speed boards: { s0, s1, v } (before the stop approach caps, so a stop does not make a "zone")
  T.zones = [];
  for (let i = 0, z = null; i < N; i++) {
    if (lim[i] < 10) { if (!z) z = { s0: i * ds, s1: i * ds, v: lim[i] }; z.s1 = i * ds; z.v = Math.min(z.v, lim[i]); }
    else if (z && i * ds - z.s1 > 30) { T.zones.push(z); z = null; }
    if (i === N - 1 && z) T.zones.push(z);
  }
  // nearest-sample grid (8 m cells) for fast "is (x, z) within d metres of the track": T.project(x, z, maxD) -> { s, d } | null
  const cell = 8, grid = new Map(), ck = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < N; i++) { const k = ck(Math.floor(x[i] / cell), Math.floor(z[i] / cell)); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); }
  T.project = (px, pz, maxD = 6) => {
    const cx = Math.floor(px / cell), cz = Math.floor(pz / cell), rc = Math.ceil(maxD / cell); let best = -1, bd = maxD * maxD;
    for (let a = cx - rc; a <= cx + rc; a++) for (let b = cz - rc; b <= cz + rc; b++) { const l = grid.get(ck(a, b)); if (!l) continue; for (const i of l) { const d = (x[i] - px) ** 2 + (z[i] - pz) ** 2; if (d < bd) { bd = d; best = i; } } }
    if (best < 0) return null;
    return { s: best * ds, d: Math.sqrt(bd), i: best };
  };
  for (const st of T.stops) {
    for (let i = 0; i < N; i++) {
      const d = i * ds - st.s;                     // + = past the stop line
      if (d >= -40 && d <= 18) lim[i] = Math.min(lim[i], 6.9);        // 25 km/h in the platform area
      else if (d >= -100 && d < -40) lim[i] = Math.min(lim[i], 11.1);  // 40 km/h on the approach
    }
  }
  // ends of the track: the run never needs to go there at speed
  lim[N - 1] = Math.min(lim[N - 1], 6.9);
  const a = SPEED.comfortDecel;
  for (let i = N - 2; i >= 0; i--) lim[i] = Math.min(lim[i], Math.sqrt(lim[i + 1] * lim[i + 1] + 2 * a * ds));
  return T;
}

/** Ideal (limit-following, comfortably braked, stopping at every stop) time between two s values, seconds. Used for the timetable and by the autopilot. */
export function idealProfile(T, s0, s1, aAcc = 0.85, aBrk = SPEED.comfortDecel * 0.9) {
  const i0 = Math.floor(s0 / T.ds), i1 = Math.floor(s1 / T.ds), n = i1 - i0 + 1;
  const vf = new Float64Array(n), vb = new Float64Array(n);
  vf[0] = 0;
  for (let k = 1; k < n; k++) vf[k] = Math.min(T.lim[i0 + k] * 0.97, Math.sqrt(vf[k - 1] ** 2 + 2 * aAcc * T.ds));
  vb[n - 1] = 0;
  for (let k = n - 2; k >= 0; k--) vb[k] = Math.min(vf[k], Math.sqrt(vb[k + 1] ** 2 + 2 * aBrk * T.ds));
  let time = 0;
  for (let k = 0; k < n - 1; k++) { const v = (vb[k] + vb[k + 1]) / 2; time += T.ds / Math.max(0.5, v); }
  return { time, v: vb, i0 };
}
