// Route validation (pure; runs under node and in the browser tests): continuity, turn rate, no U-turn, stops on the track in order.
//   validateRoute(route) -> { ok, errors[], warnings[], length, maxTurn10 (deg per 10 m), minRadius (m), sharp: [{ s, deg, junction }], stops: [{ name, s, off }] }
import { buildTrack } from './track.js';

const DEG = 180 / Math.PI;
export function validateRoute(route, { maxTurn10 = 35, hardTurn10 = 62, minGap = 150 } = {}) {
  const errors = [], warnings = [];
  const P = route.path;
  // raw polyline: continuity + corners
  const corners = [];   // raw vertices with a real turn (junction / corner curves) -> allowed tight spots
  let raw = 0;
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); raw += d;
    if (d > 400) errors.push(`gap of ${d.toFixed(0)} m between vertices ${i - 1} and ${i}`);
    if (d < 0.05) errors.push(`duplicate vertex ${i}`);
    if (i + 1 < P.length) {
      const a = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), b = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
      let t = b - a; t -= Math.round(t / (2 * Math.PI)) * 2 * Math.PI;
      if (Math.abs(t) * DEG > 25) corners.push({ x: P[i][0], z: P[i][1], deg: Math.abs(t) * DEG });
      if (Math.abs(t) * DEG > 120) errors.push(`U-turn at vertex ${i} (${(Math.abs(t) * DEG).toFixed(0)} deg)`);
    }
  }
  const T = buildTrack(route);
  // the same place never visited twice in OPPOSITE directions (a reversing manoeuvre): vertices within 2 m with headings ~180 deg apart
  const seen = new Map();
  for (let i = 0; i < T.n; i += 3) {
    const k = Math.round(T.x[i] / 4) + ',' + Math.round(T.z[i] / 4);
    for (const j of seen.get(k) || []) {
      if (Math.hypot(T.x[i] - T.x[j], T.z[i] - T.z[j]) < 2) { let d = T.yaw[i] - T.yaw[j]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(d) > 2.6 && Math.abs(i - j) * T.ds > 20) { errors.push(`reverses over its own track near s=${(i * T.ds).toFixed(0)} m`); break; } }
    }
    (seen.get(k) || seen.set(k, []).get(k)).push(i);
  }
  // turn rate over 10 m windows
  const W = Math.round(10 / T.ds); let maxT = 0, minR = 1e9; const sharp = []; let lastS = -1e9;
  for (let i = 0; i + W < T.n; i++) {
    const turn = Math.abs(T.yaw[i + W] - T.yaw[i]) * DEG;
    if (turn > maxT) maxT = turn;
    if (turn > maxTurn10 && i * T.ds - lastS > 25 && i * T.ds > 12 && i * T.ds < T.length - 22) {
      const mx = T.x[i + (W >> 1)], mz = T.z[i + (W >> 1)];
      const junction = corners.some((c) => Math.hypot(c.x - mx, c.z - mz) < 14);
      sharp.push({ s: Math.round(i * T.ds), deg: +turn.toFixed(1), junction }); lastS = i * T.ds;
      if (!junction) errors.push(`tight spot (${turn.toFixed(0)} deg / 10 m) at s=${Math.round(i * T.ds)} m with no real corner in the data (spline artefact)`);
    }
    if (turn > hardTurn10) errors.push(`heading change ${turn.toFixed(0)} deg in 10 m at s=${Math.round(i * T.ds)} m`);
  }
  for (let i = 0; i < T.n; i++) { const k = Math.abs(T.kap[i]); if (k > 1e-4) minR = Math.min(minR, 1 / k); }
  // U-turn: more than 150 deg of heading change inside 40 m (a loop of R ~ 20 m turns 180 deg over ~63 m)
  const W4 = Math.round(40 / T.ds);
  for (let i = 0; i + W4 < T.n; i++) if (Math.abs(T.yaw[i + W4] - T.yaw[i]) * DEG > 150) { errors.push(`U-turn near s=${Math.round(i * T.ds)} m`); break; }
  // body sag: the chord of one tram module (2.52 m) against the centre line (what sets how far a rigid module cuts a corner)
  let maxSag = 0, sagAt = 0; { const a = {}, b = {}, c = {}; for (let s = 0; s + 2.52 < T.length; s += 1) { T.at(s, a); T.at(s + 2.52, b); T.at(s + 1.26, c); const d = Math.hypot((a.x + b.x) / 2 - c.x, (a.z + b.z) / 2 - c.z); if (d > maxSag) { maxSag = d; sagAt = s; } } }
  if (maxSag > 0.15) errors.push(`a 2.52 m body module would sag ${maxSag.toFixed(2)} m at s=${Math.round(sagAt)} m (corner tighter than ~5 m)`);
  // stops
  const stops = []; let prev = -1e9;
  route.stops.forEach((st, k) => {
    const r = T.nearest(st.x, st.z);
    stops.push({ name: st.name, s: r.s, off: r.d });
    if (r.d > 3.5) errors.push(`stop ${k} ${st.name} is ${r.d.toFixed(1)} m off the track`);
    if (r.s <= prev) errors.push(`stop ${k} ${st.name} is not after the previous stop`);
    else if (k && r.s - prev < minGap) errors.push(`stop ${k} ${st.name} only ${(r.s - prev).toFixed(0)} m after the previous one`);
    if (k && k < route.stops.length - 1 && (r.s < 15 || r.s > T.length - 15)) errors.push(`stop ${k} ${st.name} is at the end of the track`);
    if (Math.abs(T.curvature(r.s)) > 0.025 && !(k === 0)) warnings.push(`stop ${k} ${st.name} lies in a curve (R ${(1 / Math.abs(T.curvature(r.s))).toFixed(0)} m)`);
    prev = r.s;
  });
  for (const [a, b] of route.runs ? Object.values(route.runs) : []) if (!(a >= 0 && b < route.stops.length && b - a >= 2)) errors.push(`bad run ${a}..${b}`);
  return { ok: errors.length === 0, errors, warnings, maxSag, length: T.length, maxTurn10: maxT, minRadius: minR, sharp, stops };
}
