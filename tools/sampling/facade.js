// Wall edges exactly as the game's builders emit them, and their grouping into FACADE RUNS (maximal almost-straight chains of edges).
// Shared by the building builder (render side) and the measurement page (sampling side), so a run index means the same wall in both.
// Edge key k = ring index (flat extrusions) or running edge number over the shape's outline loops (shaped buildings; same counter as buildShapeGeometry).

/** flat extrusion: ring edges (building-local metres), base 0. */
export function wallEdgesFlat(ring) {
  const out = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n]; const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    out.push({ k: i, x0, z0, x1, z1, y0: 0, len });
  }
  return out;
}
/** shaped building: outline loops of the shapes record (same skip rules as buildShapeGeometry). py/px/pz = vertex accessors in metres. */
export function wallEdgesShape(S, rec) {
  const inv = 1 / S.q, vb = rec.ov * 3, L = S.L, out = [];
  const px = (i) => S.V[vb + i * 3] * inv, py = (i) => S.V[vb + i * 3 + 1] * inv, pz = (i) => S.V[vb + i * 3 + 2] * inv;
  let p = rec.ol, ek = 0; const end = rec.ol + rec.nl;
  while (p < end) {
    const len = L[p], y0 = L[p + 1] * inv; p += 3;
    for (let i = 0; i < len; i++) {
      const A = L[p + i], B = L[p + ((i + 1) % len)]; const k = ek++;
      const ya = py(A), yb = py(B);
      if (ya - y0 < 0.05 && yb - y0 < 0.05) continue;
      const ex = px(B) - px(A), ez = pz(B) - pz(A), el = Math.hypot(ex, ez);
      if (el < 0.01) continue;
      out.push({ k, x0: px(A), z0: pz(A), x1: px(B), z1: pz(B), y0, top: Math.max(ya, yb), len: el });
    }
    p += len;
  }
  return out;
}
const ang = (ax, az, bx, bz) => Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1))));
/**
 * Group edges into runs. Returns { runs: [{ i0 (first edge idx), edges: [edge idx...], len, a:[x,z], b:[x,z], nx, nz }], of: Map(k -> { run, u0 }) }.
 * An edge continues the run when it starts where the previous one ended and turns < 12 deg (< 22 deg from the run's first edge); a closed ring's last and first run are joined when they continue each other.
 */
export function facadeRuns(edges) {
  const runs = []; let cur = null, prev = null;
  const D = (e) => [e.x1 - e.x0, e.z1 - e.z0];
  edges.forEach((e, idx) => {
    const joins = cur && prev && Math.hypot(prev.x1 - e.x0, prev.z1 - e.z0) < 0.06 && ang(...D(prev), ...D(e)) < 0.21 && ang(...D(edges[cur.edges[0]]), ...D(e)) < 0.385;
    if (!joins) { cur = { edges: [], len: 0 }; runs.push(cur); }
    cur.edges.push(idx); cur.len += e.len; prev = e;
  });
  if (runs.length > 1) { // wrap-around: the ring's first edge may continue the last run
    const f = runs[0], l = runs[runs.length - 1], fe = edges[f.edges[0]], le = edges[l.edges[l.edges.length - 1]];
    if (f !== l && Math.hypot(le.x1 - fe.x0, le.z1 - fe.z0) < 0.06 && ang(...D(le), ...D(fe)) < 0.21 && ang(...D(edges[l.edges[0]]), ...D(fe)) < 0.385) {
      l.edges.push(...f.edges); l.len += f.len; runs.shift();
    }
  }
  const of = new Map();
  runs.forEach((r, ri) => {
    let u = 0; for (const ei of r.edges) { const e = edges[ei]; of.set(e.k, { run: ri, u0: u }); u += e.len; }
    const e0 = edges[r.edges[0]], e1 = edges[r.edges[r.edges.length - 1]];
    r.a = [e0.x0, e0.z0]; r.b = [e1.x1, e1.z1]; const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], cl = Math.hypot(dx, dz) || 1;
    r.nx = dz / cl; r.nz = -dx / cl; r.chord = cl;
  });
  return { runs, of };
}
