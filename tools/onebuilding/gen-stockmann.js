// Stockmann department store + Forum Cinemas block, Riga (cadastre 49615504 "13. janvaara iela 8", OSM way 36823847 + building:parts). Photo-free parametric model, NO logo / wordmark (plain fascia boards).
// Frame: origin (150,604) in the game's local metres, U along the cinema glass front towards NE (A = (0.8175, -0.5760)), V outward over the NW street (VV = (A.z, -A.x)); model X = v, Z = u.
// Read from: reality-mesh rectified elevations + oblique views (scripts/out/tramcity/ref-stockmann-*.png, reading only), OSM footprint + building:part levels, Commons photos (sources-stockmann.json).
//  volumes: SW cinema end wall (pale grey panel wall, posters = plain boards), cinema block with a 56 m glass curtain wall (8 bays, 5 levels) flanked by two white/blue pylons with red sign boards,
//  glazed atrium link, the 4-level store volume to the NE with a curved NE front (dark metal-mesh cladding, two brick-red end piers, ground glazing band under a canopy, big ad boards, roof rail),
//  rooftop plant (ducts, boxes, stair tower). Heights from the mesh: cinema 22.5 m (+ plant 4.5), store parapet 16.4 m.
import { builder, TONE } from './glib.js';
export const FRAME = { O: [150, 604], th: Math.atan2(-0.5760, 0.8175) };
export const COVERS = { ids: [49615504] };
const inPoly = (x, z, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
export function build(opts = {}) {
  const lod = opts.lod ?? 0, b = builder(lod), { box, wall, curtain, quad, P } = b;
  const U = (u, v) => [v, u];                       // (u,v) -> model (x,z)
  const HC = 25.5, HS = 19.5;     // mesh heights above the street: cinema roof ~25.5 (plant to 28), curved store front 19.5, brick piers 20.6
  // ---- polygon block: walls per edge (fn(edgeIndex, A, B) -> {ops, tone, ...}), flat roof as a fan
  function poly(pts, y0, y1, edge, roofCol = true) {
    const ring = pts.map(([u, v]) => U(u, v));
    for (let i = 0; i < ring.length; i++) { let A = ring[i], B = ring[(i + 1) % ring.length]; const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, tx = B[0] - A[0], tz = B[1] - A[1], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      if (inPoly(mx + nx * 0.05, mz + nz * 0.05, ring)) [A, B] = [B, A];
      const e = edge(i, A, B, Math.hypot(B[0] - A[0], B[1] - A[1])) || {}; wall(A, B, y0, y1, e.ops || [], { tone: e.tone ?? 0, depth: e.depth ?? 0.25, split: e.split, toneAt: e.toneAt }); }
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    if (roofCol) for (let i = 0; i < ring.length; i++) { const A = ring[i], B = ring[(i + 1) % ring.length]; b.quad('roof', P(A[0], y1, A[1]), P(cx, y1, cz), P(cx, y1, cz), P(B[0], y1, B[1]), {}); }
  }
  const strip = (n, pitch, w, y0, y1, extra = {}, lead = 0) => { const o = []; const k = Math.max(1, Math.round(n / pitch)), p = n / k; for (let i = 0; i < k; i++) o.push({ s0: lead + (i + 0.5) * p - w / 2, s1: lead + (i + 0.5) * p + w / 2, y0, y1, depth: 0.2, ...extra }); return o; };
  // ================= cinema block (6 levels) + SW end wall =================
  const cin = [[-36, -24], [-36, 0], [63, 0], [63, -12], [62, -49], [36, -42.5], [0, -32.4], [-21, -26.4]].map(([u, v]) => [u, v]);
  poly(cin, 0, HC, (i, A, B, L) => ({ tone: 0, toneAt: (y) => y < 1.2 ? 2 : 0, split: [1.2], ops: [] }));
  // NW glass curtain wall u 0..56 (8 bays), standing proud 0.45 m
  { const rows = [[1.3, 4.6, 'glass'], [4.6, 5.4, 'spandrel'], [5.4, 10.4, 'glass'], [10.4, 11.0, 'spandrel'], [11.0, 15.9, 'glass'], [15.9, 16.5, 'spandrel'], [16.5, 21.0, 'glass'], [21.0, 25.3, 'glass']];
    b.box('wall', 0, 0, 0, 0.5, 1.3, 56, { tone: 2, faces: 'et' });
    curtain([0.5, 56], [0.5, 0], 1.3, HC, { pitch: 7, rows, off: 0, spandrelTone: 5 }); b.box('wall', 0, HC - 0.2, 0, 0.6, HC + 0.9, 56, { tone: 1, faces: 'ewtns' }); }
  // pylons (white / pale blue) with plain sign boards in place of the real signs
  for (const [u0, u1] of [[56, 63.5], [-8.5, 0]]) { box('wall', 0, 0, u0, 0.7, HC - 0.5, u1, { tone: 0, faces: 'swne t'.replace(/ /g, '') }); box('wall', 0.7, 14.6, u0 + 0.7, 0.85, 21.8, u1 - 0.7, { tone: 6, faces: 'e' }); box('wall', 0.7, 10.6, u0 + 0.7, 0.8, 13.4, u1 - 0.7, { tone: 1, faces: 'e' }); }
  // SW end wall: pale panel wall with two poster boards, low plinth block
  { const A = U(-36, 0), B = U(-36, -24); box('wall', 0, 6.5, -35.7, 0.15, 18, -17, { tone: 1, faces: 'e' }); box('wall', -24.2, 4.5, -36, -0.3, 19.5, -35.85, { tone: 1, faces: 's' });
    for (const k of [0, 1]) box("wall", -6 - k * 8, 6, -36.2, -2 - k * 8, 14, -35.9, { tone: 1, faces: "s" }); void A; void B;
    // glass strip next to the blue pylon (4.5 m), u -13..-8.5
    curtain([0.4, -8.5], [0.4, -13], 0.3, HC, { pitch: 2.25, rows: [[0.3, 3.7, 'glass'], [3.7, 4.4, 'spandrel'], [4.4, 22.5, 'glass']], spandrelTone: 5 }); }
  // low entrance block at the SW corner of the glass front (Stockmann side door canopy)
  box('wall', 0, 0, 0.3, 3.2, 3.8, 6, { tone: 7, faces: 'ntb' }); box('wall', 0, 3.8, 0.2, 3.6, 4.2, 6.2, { tone: 1, faces: 'snwet' });
  // ================= store volume (4 levels) with the curved NE front =================
  const store = [[62.6, -12], [62.6, -49.5], [121.3, -65.7], [122.2, -56.5], [122.7, -50.1], [123.4, -41.3], [121.8, -32.4], [118.1, -23.6], [107.6, 0.8], [82, 0.8], [78, -11.6]];
  const nStore = store.length;
  poly(store, 0, HS, (i, A, B, L) => {
    const curved = i >= 3 && i <= 7;
    if (curved) { // ground glazing band 0.5..5.6, canopy soffit, dark clad upper band with ad boards, brick piers at both ends
      const ops = []; const k = Math.max(1, Math.round(L / 3.2)), p = L / k; for (let q = 0; q < k; q++) ops.push({ s0: q * p + 0.3, s1: (q + 1) * p - 0.3, y0: 0.4, y1: 6.6, depth: 0.5 });
      const pier = i === 3 || i === 7; return { tone: pier ? 6 : 5, ops: pier ? [] : ops, toneAt: (y) => y < 0.4 ? 2 : (y < 7.0 ? 5 : pier ? 6 : 5), split: [0.4, 7.0] }; }
    const wins = L > 6 ? strip(L, 3.4, 1.7, 8.2, 10.4, { depth: 0.25 }).concat(strip(L, 3.4, 1.7, 12.2, 14.2, { depth: 0.25 })) : []; return { tone: 0, ops: wins }; });
  // canopy ring around the curved front (5.6 .. 6.2) and big ad boards on the clad band (plain light boards, NO imagery)
  { const arc = [[107.6, 0.8], [118.1, -23.6], [121.8, -32.4], [123.4, -41.3], [122.7, -50.1], [122.2, -56.5], [121.3, -65.7]];
    for (let i = 0; i + 1 < arc.length; i++) { const [u0, v0] = arc[i], [u1, v1] = arc[i + 1], tx = u1 - u0, tz = v1 - v0, l = Math.hypot(tx, tz), nu = tz / l, nv = -tx / l; // outward (towards +u) normal in (u,v)
      const o = 2.2; const q0 = [u0 + nu * o, v0 + nv * o], q1 = [u1 + nu * o, v1 + nv * o]; const Pm = (q, y) => P(q[1], y, q[0]);
      quad('wall', Pm([u0, v0], 7.0), Pm(q0, 7.0), Pm(q1, 7.0), Pm([u1, v1], 7.0), { tone: 5, n: [0, -1, 0], shade: 0.7 }); quad('wall', Pm(q0, 7.0), Pm(q0, 7.5), Pm(q1, 7.5), Pm(q1, 7.0), { tone: 5, n: [-nv, 0, -nu] }); quad('wall', Pm(q0, 7.5), Pm([u0, v0], 7.5), Pm([u1, v1], 7.5), Pm(q1, 7.5), { tone: 1, n: [0, 1, 0] });
      if (i >= 2 && i <= 4 && lod <= 1) { const m = 0.12; const a = [u0 + (u1 - u0) * 0.08 + nu * m, v0 + (v1 - v0) * 0.08 + nv * m], c = [u0 + (u1 - u0) * 0.92 + nu * m, v0 + (v1 - v0) * 0.92 + nv * m]; quad('wall', Pm(a, 9.0), Pm(c, 9.0), Pm(c, 17.8), Pm(a, 17.8), { tone: 1, n: [-nv, 0, -nu], shade: 1 }); } } }
  // roof rail around the NE front (lod0)
  { const arc = [[107.6, 0.8], [118.1, -23.6], [121.8, -32.4], [123.4, -41.3], [122.7, -50.1], [122.2, -56.5], [121.3, -65.7]];
    if (lod === 0) for (let i = 0; i + 1 < arc.length; i++) { const [u0, v0] = arc[i], [u1, v1] = arc[i + 1]; b.quad('wall', P(v0, HS + 1.1, u0), P(v1, HS + 1.1, u1), P(v1, HS + 1.2, u1), P(v0, HS + 1.2, u0), { tone: 5, n: [0, 1, 0] }); for (const [u, v] of [[u0, v0]]) box('wall', v - 0.04, HS, u - 0.04, v + 0.04, HS + 1.15, u + 0.04, { tone: 5 }); } }
  // atrium link (glass box between cinema and store, NW side)
  { const rows = [[0.3, 3.7, 'glass'], [3.7, 4.4, 'spandrel'], [4.4, HS - 0.5, 'glass']]; curtain([2.6, 62.6], [2.6, 56.1], 0.3, HS, { pitch: 3.2, rows, spandrelTone: 5 }); b.box('wall', 2.6, HS - 0.4, 56, 2.9, HS + 0.2, 62.7, { tone: 1, faces: 'et' }); }
  // ================= roof plant =================
  { const plant = [[-40, 8, 20, 44, 4.5], [-18, 8, 6, 20, 3.4], [-30, 10, 36, 52, 2.6], [-22, 14, 62.3, 70, 8.2], [-36, 22, -10, 4, 3.0]]; // [v0,v1?] see below
    const R = HC + 0.01; const boxes = [[-5, -18, 6, 20, 3.6, 5], [-22, -33, 10, 38, 2.4, 5], [-8, -24, 36, 52, 4.6, 0], [-5, -12, 52, 58, 2.8, 5], [-26, -34, 56, 64, 5.2, 0], [-12, -22, -22, -4, 3.2, 5]];
    for (const [v0, v1, u0, u1, h, tone] of boxes) box('wall', Math.min(v0, v1), R, u0, Math.max(v0, v1), R + h, u1, { tone: tone === 5 ? 5 : 0, faces: 'snwet' });
    // duct runs (round, as boxes) across the cinema roof
    if (lod <= 1) for (const [v, u0, u1] of [[-14, 8, 52], [-20, 0, 30]]) box('wall', v - 0.5, R + 0.5, u0, v + 0.5, R + 1.5, u1, { tone: 5, faces: 'snwet' });
    void plant; }
  // store roof boxes: lift / stair tower and a skylight
  box('wall', -38, HS, 70, -30, HS + 3.4, 82, { tone: 0, faces: 'snwet' }); box('wall', -18, HS, 98, -10, HS + 1.0, 106, { tone: 1, faces: 'snwet' });
  return b.finish();
}
