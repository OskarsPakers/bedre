// Pure planning of what is on the route besides stops: level crossings (roads / paths that cross the track), traffic signals at some of them, block signals
// (stop-departure signals and mid-leg ones), pedestrian hazards. Runs under node (tests) and in the browser on the loaded map data.
const ROAD_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'pedestrian', 'footway', 'cycleway', 'path', 'living_street', 'unclassified']);
const CAR_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified']);

/** roads: [{ p: [[x,z]...], k }] -> crossings [{ s, x, z, kind: 'car'|'foot', k }] sorted by s (roads running along the track for > 16 m are shared corridor, not crossings) */
export function findCrossings(track, roads) {
  const out = [];
  for (const r of roads) {
    if (!r.p || !ROAD_KINDS.has(r.k)) continue;
    let run = null;
    const flush = () => { if (run && run.n && run.s1 - run.s0 < 16) { out.push({ s: (run.s0 + run.s1) / 2, x: run.x / run.n, z: run.z / run.n, kind: CAR_KINDS.has(r.k) ? 'car' : 'foot', k: r.k }); } run = null; };
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n, q = track.project(x, z, 1.9);
        if (q) { if (!run) run = { s0: q.s, s1: q.s, x: 0, z: 0, n: 0 }; run.s1 = q.s; run.s0 = Math.min(run.s0, q.s); run.x += x; run.z += z; run.n++; } else flush();
      }
    }
    flush();
  }
  out.sort((a, b) => a.s - b.s);
  // merge duplicates (two road polylines meeting at the crossing)
  const m = [];
  for (const c of out) { const l = m[m.length - 1]; if (l && Math.abs(c.s - l.s) < 12 && (l.kind === c.kind || l.kind === 'car')) continue; m.push(c); }
  return m;
}

/** @returns { crossings, signals: [{ s, kind: 'road'|'block', cross? }], peds: [{ s, x, z, side }] } */
export function planHazards(track, roads, stops, { seed = 1 } = {}) {
  const L = track.length, cross = findCrossings(track, roads || []);
  const nearStop = (s, before = 120, after = 60) => stops.some((st) => s > st.s - before && s < st.s + after);
  const flat = (s) => Math.abs(track.curvature(s)) < 0.012;
  const signals = [], peds = [];
  // traffic signals (the tram's own, at crossings of real roads for cars)
  let last = -1e9;
  for (const c of cross) {
    if (c.kind !== 'car' || c.k === 'living_street' || c.s < 90 || c.s > L - 150 || !flat(c.s) || nearStop(c.s, 130, 70) || c.s - last < 380) continue;
    signals.push({ s: c.s - 9, kind: 'road', cross: { x: c.x, z: c.z, s: c.s } }); last = c.s;
  }
  // pedestrian hazards: crossings (any kind) away from signals and stops
  last = -1e9;
  for (const c of cross) {
    if (c.s < 120 || c.s > L - 160 || !flat(c.s) || nearStop(c.s, 150, 130) || c.s - last < 420 || signals.some((g) => Math.abs(g.cross.s - c.s) < 110)) continue;
    peds.push({ s: c.s, x: c.x, z: c.z, side: peds.length % 2 ? 1 : -1 }); last = c.s;
  }
  // block signals: a departure signal 40 m beyond each stop (except the last), then one every ~330 m where the gap is long
  const sig = [];
  stops.forEach((st, i) => { if (i < stops.length - 1 && st.s + 40 < L) sig.push(st.s + 40); });
  sig.sort((a, b) => a - b);
  const all = [...sig];
  for (let i = 0; i < sig.length; i++) { const a = sig[i], b = i + 1 < sig.length ? sig[i + 1] : L - 60; for (let s = a + 330; s < b - 140; s += 330) all.push(s); }
  all.sort((a, b) => a - b);
  for (const s0 of all) {
    let s = s0; for (let k = 0; k < 8 && (!flat(s) || nearStop(s, 50, 8) || signals.some((g) => Math.abs(g.s - s) < 45)); k++) s += 12;
    if (s > L - 40) continue;
    signals.push({ s, kind: 'block' });
  }
  signals.sort((a, b) => a.s - b.s);
  // fallback: a route without any suitable crossing still gets one pedestrian hazard per ~900 m (a path through the forest)
  const have = () => peds.map((q) => q.s).sort((a, b) => a - b);
  for (let s = 450; s < L - 300; s += 150) {
    const h = have(), ok = h.every((q) => Math.abs(q - s) > 1100);
    if (ok && !nearStop(s, 150, 130) && flat(s) && !signals.some((g) => g.kind === 'road' && Math.abs(g.s - s) < 110)) { const p = {}; track.at(s, p); peds.push({ s, x: p.x, z: p.z, side: peds.length % 2 ? 1 : -1, synthetic: true }); }
  }
  peds.sort((a, b) => a.s - b.s);
  return { crossings: cross, signals, peds };
}
