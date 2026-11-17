// The route as a 1-D world: raw OSM track vertices -> smooth Catmull-Rom centre line sampled every metre, with heading, curvature, a speed-limit
// profile (curves, stops) and the stops projected onto it. Pure maths + THREE.CatmullRomCurve3 (no DOM), so scripts can run it under node.
import * as THREE from 'three';

export const SPEED = { max: 13.9, aLat: 1.15, vCurveMin: 4.4, comfortDecel: 0.9 };   // m/s (13.9 = 50 km/h); lateral accel the curve limit allows
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const DS = 1;                                                                        // sample spacing, metres

export function buildTrack(route, opts = {}) {
  const pts = route.path.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, pts.length * 24);
  curve.updateArcLengths();
  const L = curve.getLength();
  const n = Math.floor(L / DS);
  const sp = curve.getSpacedPoints(n);   // n + 1 points, equal arc length
  const ds = L / n;
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
    n: N, ds, length: L, x, z, yaw, kap, lim, stops: [],
    /** index (float) of s */
    _f(s) { return Math.min(N - 1.0001, Math.max(0, s / ds)); },
    /** {x, z, yaw} at arc length s (clamped; beyond the ends it extrapolates straight so a long tram can stand on the first metres) */
    at(s, out = {}) {
      if (s < 0 || s > L) {
        const e = s < 0 ? 0 : N - 1, d = s < 0 ? s : s - L;
        out.x = x[e] + Math.cos(yaw[e]) * d; out.z = z[e] + Math.sin(yaw[e]) * d; out.yaw = yaw[e]; return out;
      }
      const f = T._f(s), i = Math.floor(f), u = f - i;
      out.x = x[i] + (x[i + 1] - x[i]) * u; out.z = z[i] + (z[i + 1] - z[i]) * u; out.yaw = yaw[i] + (yaw[i + 1] - yaw[i]) * u;
      return out;
    },
    curvature(s) { const f = T._f(s), i = Math.floor(f); return kap[i] + (kap[i + 1] - kap[i]) * (f - i); },
    limit(s) { const f = T._f(s), i = Math.floor(f); return lim[i] + (lim[i + 1] - lim[i]) * (f - i); },
    /** nearest point of the centre line to (px, pz) within [s0, s1] (search window, metres): {s, d} (exact distance to the polyline, s refined on the segment) */
    nearest(px, pz, s0 = 0, s1 = L) {
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
    const r = T.nearest(st.x, st.z, from, L);
    T.stops.push({ name: st.name, s: r.s, offTrack: r.d });
    from = r.s + 60;
  }
  // speed-limit profile: line speed, curve limit, stop approach limits; then made brakeable (a limit never drops faster than the tram can follow)
  for (let i = 0; i < N; i++) {
    const k = Math.abs(kap[i]);
    lim[i] = Math.min(SPEED.max, k > 1e-4 ? Math.max(SPEED.vCurveMin, Math.sqrt(SPEED.aLat / k)) : SPEED.max);
  }
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
