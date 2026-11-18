// Parametric Opera generator ("grammar -> geometry"). Pure JS (three-free): returns plain buffers per material, in MODEL space:
//   X = v (across, ENE), Y up (ground 0), Z = u (along the long axis, SSE).  Place in the game with rotation about Y by (90deg - 61.87deg) and offset (frame.js).
// opts: { lod: 0|1|2, uv: 'photo'|'palette' }.   The grammar numbers below are what the facade reader (me looking at the rectified elevations + detect.mjs) produced.
export const G = {
  cx: 20.4, hw: 20.2,                 // building centre line (v) and half width of the side wings
  u0: -8.4, uMain1: 28.5, u1: 55.7,   // front wall, foyer/tower boundary, end of the main body
  wingEave: 17.2, mainEave: 25.2, towerEave: 31.9, towerRidge: 35.0, mainRidge: 28.6,
  mainHW: 13.6,                        // half width of the main block (27.2 m)
  bay0: 4.86, bayPitch: 3.15, bays: [-2, 14],  // bay centres along u: bay0 + pitch*n
  porticoU: -14.9, colSpacing: 3.41, colTop: 14.2, colBase: 5.4, colD: 1.45,
  annex: { u0: 55.7, u1: 78, v0: 9.5, v1: 36, eave: 17.2, ridge: 22.4 },
  rear: { u0: 55.7, u1: 105, v0: 8, v1: 41, h: 14, ridge: 17 },
};
// atlas layout (px): SW/NE region (0,0) 2048x690 -> u in [-15,95], y in [0,36.2]; N region (0,700) 1024x742 -> v in [45,-5] (x grows as v falls); loggia region (1024,700); flat swatches strip y>=1440
export const ATLAS = { W: 2048, H: 1536 };
const TONES = { plaster: 0, trim: 1, plinth: 2, roof: 3, glass: 4, metal: 5, stone: 6, door: 7 };
export function build(opts = {}) {
  const lod = opts.lod ?? 0, photo = (opts.uv ?? 'photo') === 'photo', B = {}; // B[mat] = {p:[],n:[],uv:[],c:[],i:[]}
  const M = (m) => B[m] || (B[m] = { p: [], n: [], uv: [], c: [], i: [] });
  const swU = (tone) => photo ? [(tone + 0.5) / 8 * 2048 / 2048 * 0.5 + 0, (1480 + 20) / ATLAS.H] : [(tone + 0.5) / 8, 0.5];
  const proj = (mode, x, y, z, tone) => { // -> uv
    if (!photo || mode === 'flat') return swU(tone ?? 0);
    if (mode === 'sw') return [((z + 15) / 110 * 2048) / ATLAS.W, ((36.2 - y) * 18.62) / ATLAS.H];
    if (mode === 'n') return [((45 - x) * 20.48) / ATLAS.W, (700 + (36.2 - y) * 20.48) / ATLAS.H];
    if (mode === 'nl') return [(1024 + (45 - x) * 20.48) / ATLAS.W, (700 + (36.2 - y) * 20.48) / ATLAS.H];
    if (mode === 'roof') return [x / 3, z / 3];
    return swU(tone ?? 0);
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nz = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  // quad a,b,c,d counter-clockwise seen from outside
  function quad(mat, a, b, c, d, o = {}) {
    let n = o.n || nz(cr(sub(b, a), sub(d, a))); if (mat === 'roof' && n[1] < 0) { [b, d] = [d, b]; n = [-n[0], -n[1], -n[2]]; }
    const m = M(mat), base = m.p.length / 3, shade = o.shade ?? 1;
    const gv = mat === 'glass' ? (Math.abs(Math.floor(a[0] * 7.3 + a[1] * 3.1 + a[2] * 11.7)) % 8 + 0.5) / 8 : 0;
    for (const q of [a, b, c, d]) { m.p.push(...q); m.n.push(...n); m.uv.push(...(mat === 'glass' ? [gv, 0.5] : mat === 'roof' ? roofUV(o.roofAxis, q) : proj(o.proj, q[0], q[1], q[2], o.tone))); m.c.push(shade, shade, shade); }
    m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const roofUV = (ax, q) => { return photo ? [ (ax === 'x' ? q[2] : q[0]) / 3, (ax === 'x' ? q[0] : q[2]) / 3 ] : [0.5, 0.5]; };
  const P = (x, y, z) => [x, y, z];
  // axis aligned box (x0..x1, y0..y1, z0..z1); faces optional; mode = projection for the 4 sides
  function box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    const f = o.faces || 'sntbwe'; // s = -z side (front for porticoU), n = +z, b bottom, t top, w = -x, e = +x
    const t = o.tone ?? 0, pr = o.proj, sh = o.shade ?? 1;
    if (f.includes('s')) quad(mat, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), { proj: pr?.s ?? pr, tone: t, shade: sh });
    if (f.includes('n')) quad(mat, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), { proj: pr?.n ?? pr, tone: t, shade: sh });
    if (f.includes('w')) quad(mat, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), { proj: pr?.w ?? pr, tone: t, shade: sh });
    if (f.includes('e')) quad(mat, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), { proj: pr?.e ?? pr, tone: t, shade: sh });
    if (f.includes('t')) quad(mat, P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), { proj: 'flat', tone: t, shade: sh });
    if (f.includes('b')) quad(mat, P(x0, y0, z1), P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), { proj: 'flat', tone: t, shade: sh * 0.8 });
  }
  // A wall: viewer-left point A=[x,z], viewer-right B=[x,z]; y0..y1; openings in wall coordinates s (metres from A along wall) and y; projection mode; recess depth d.
  function wall(A, Bp, y0, y1, ops, o) {
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), t = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L], n = [-t[1], t[0]];
    const at = (s, y, off = 0) => [A[0] + t[0] * s + n[0] * off, y, A[1] + t[1] * s + n[1] * off];
    const pr = o.proj, tone = o.tone ?? 0, depth = o.depth ?? 0.3;
    const ys = [...new Set([y0, y1, ...(o.split !== false && y0 < 4.9 - 1e-6 && y1 > 4.9 + 1e-6 ? [4.9] : []), ...ops.flatMap(q => [q.y0, q.y1])])].sort((a, b) => a - b);
    for (let k = 0; k < ys.length - 1; k++) { const ya = ys[k], yb = ys[k + 1], cov = ops.filter(q => q.y0 <= ya + 1e-6 && q.y1 >= yb - 1e-6).sort((a, b) => a.s0 - b.s0); let s = 0;
      const pieces = []; for (const q of cov) { if (q.s0 > s + 1e-4) pieces.push([s, q.s0]); s = Math.max(s, q.s1); } if (s < L - 1e-4) pieces.push([s, L]);
      for (const [a, b] of pieces) quad('wall', at(a, ya), at(b, ya), at(b, yb), at(a, yb), { proj: pr, tone: (o.split !== false && yb <= 4.9 + 1e-6 && tone === 0 && opts.game) ? 2 : tone, n: [n[0], 0, n[1]] }); }
    for (const q of ops) { const d = q.depth ?? depth, a0 = q.s0, a1 = q.s1, b0 = q.y0, b1 = q.y1, nin = [-n[0], 0, -n[1]];
      if (lod === 0 || (lod === 1 && o.rev !== false)) { // reveals (jambs, sill, head)
        quad('wall', at(a0, b0), at(a0, b1), at(a0, b1, -d), at(a0, b0, -d), { proj: 'flat', tone: 0, shade: 0.55 }); quad('wall', at(a1, b1), at(a1, b0), at(a1, b0, -d), at(a1, b1, -d), { proj: 'flat', tone: 0, shade: 0.55 });
        quad('wall', at(a0, b1), at(a1, b1), at(a1, b1, -d), at(a0, b1, -d), { proj: 'flat', tone: 0, shade: 0.4 }); quad('wall', at(a1, b0), at(a0, b0), at(a0, b0, -d), at(a1, b0, -d), { proj: 'flat', tone: 0, shade: 0.85 }); }
      const gl = q.door ? 'wall' : 'glass'; quad(gl, at(a0, b0, -d), at(a1, b0, -d), at(a1, b1, -d), at(a0, b1, -d), { proj: q.door ? 'flat' : 'flat', tone: q.door ? TONES.door : TONES.glass, n: [n[0], 0, n[1]], glassLit: q.lit });
      if (lod === 0 && !q.door && !q.nobars) { const w = a1 - a0, h = b1 - b0, th = 0.05, dd = d - 0.04; // mullion + transom (frame bars, proud of the glass)
        if (w > 0.9) { const s = (a0 + a1) / 2; bar(at(s - th, b0, -dd), at(s + th, b1, -dd + 0.04), n, t); }
        if (h > 1.8) { const y = b0 + h * 0.68; bar(at(a0, y - th, -dd), at(a1, y + th, -dd + 0.04), n, t); } }
      if (q.sill && lod === 0) { const sd = 0.14; quad('wall', at(a0 - 0.1, b0 - 0.07), at(a1 + 0.1, b0 - 0.07), at(a1 + 0.1, b0 - 0.07, sd), at(a0 - 0.1, b0 - 0.07, sd), { proj: 'flat', tone: 1, n: [0, -1, 0], shade: 0.8 }); void sd; }
    }
    return { at, n, t, L };
  }
  function bar(a, b, n, t) { // thin bar between corner points a (low-left, recessed) and b, in wall frame: draw its outward face + top/bottom
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [z0, z1] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])]; const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    quad('wall', P(x0, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z0), { proj: 'flat', tone: 1, n: [n[0], 0, n[1]], shade: 0.9 }); }
  const cyl = (mat, cx, cz, r, y0, y1, seg, o = {}) => { for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
    const m = M(mat), base = m.p.length / 3; for (const [p, a, y] of [[p0, a0, y0], [p1, a1, y0], [p1, a1, y1], [p0, a0, y1]]) { m.p.push(p[0], y, p[1]); m.n.push(Math.cos(a), 0, Math.sin(a)); m.uv.push(...proj(o.proj, p[0], y, p[1], o.tone ?? 1)); m.c.push(1, 1, 1); } m.i.push(base, base + 2, base + 1, base, base + 3, base + 2); } };
  // fluted shaft: 2*flutes facets, alternating radius, flat normals
  const shaft = (mat, cx, cz, r, y0, y1, flutes, o = {}) => { const seg = flutes * 2; for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, r0 = r * (i % 2 ? 0.94 : 1), r1 = r * (i % 2 ? 1 : 0.94);
    const A = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], Bq = [cx + Math.cos(a1) * r1, y0, cz + Math.sin(a1) * r1]; quad(mat, Bq, A, [A[0], y1, A[2]], [Bq[0], y1, Bq[2]], { proj: 'flat', tone: o.tone ?? 1, shade: i % 2 ? 0.92 : 1 }); } };
  // ---- outward flipped helpers: quad() expects CCW from outside; the cyl above uses explicit order. ----
  const cx = G.cx, hw = G.hw, v0 = cx - hw, v1 = cx + hw, mv0 = cx - G.mainHW, mv1 = cx + G.mainHW, { u0, uMain1, u1 } = G;
  // ---- LOD2: masses only ----
  const mass = (x0, x1, z0, z1, ya, yb, o) => box('wall', x0, ya, z0, x1, yb, z1, { tone: o?.tone ?? 0, proj: o?.proj ?? (opts.proxy ? { s: 'n', n: 'flat', w: 'sw', e: 'sw' } : 'flat'), faces: o?.faces ?? 'snwet' });
  const roofHip = (x0, x1, z0, z1, y, rise, ridgeHalf, o = {}) => { // hip roof over rectangle, ridge along Z (long) centred; ridge half-length from ends
    const xm = (x0 + x1) / 2, ra = Math.max(0.01, ridgeHalf), zr0 = z0 + (x1 - x0) / 2 * (o.hipK ?? 1), zr1 = z1 - (x1 - x0) / 2 * (o.hipK ?? 1), yt = y + rise;
    const A = P(x0, y, z0), Bq = P(x1, y, z0), C = P(x1, y, z1), D = P(x0, y, z1), r0a = P(xm, yt, zr0), r1a = P(xm, yt, zr1);
    quad('roof', Bq, A, r0a, r0a, { roofAxis: 'z' }); // front hip (triangle as degenerate quad)
    quad('roof', D, C, r1a, r1a, { roofAxis: 'z' });
    quad('roof', A, D, r1a, r0a, { roofAxis: 'x' }); quad('roof', C, Bq, r0a, r1a, { roofAxis: 'x' }); void ra; };
  // ===== body =====
  const faces = 'nsew';
  // lower block (wings), walls built per facade below for lod<=1 ; LOD2: simple boxes
  if (lod >= 2) {
    mass(v0, v1, u0, u1, 0, G.wingEave); mass(mv0, mv1, u0, u1, G.wingEave, G.mainEave); mass(mv0, mv1, uMain1, u1, G.mainEave, G.towerEave);
    roofHip(mv0, mv1, u0, uMain1, G.mainEave, G.mainRidge - G.mainEave, 0, { hipK: 1 }); roofHip(mv0, mv1, uMain1, u1, G.towerEave, G.towerRidge - G.towerEave, 0);
    mass(G.cx - 10.2, G.cx + 10.2, G.porticoU, u0, 0, 16.8); quad('roof', P(G.cx - 10.2, 16.8, G.porticoU), P(G.cx + 10.2, 16.8, G.porticoU), P(G.cx, 19.0, G.porticoU), P(G.cx, 19.0, G.porticoU), { roofAxis: 'z' });
    const a = G.annex; mass(a.v0, a.v1, a.u0, a.u1, 0, a.eave); roofHip(a.v0, a.v1, a.u0, a.u1, a.eave, a.ridge - a.eave, 0); const r = G.rear; mass(r.v0, r.v1, r.u0, r.u1, 0, r.h); roofHip(r.v0, r.v1, r.u0, r.u1, r.h, r.ridge - r.h, 0);
    { const pu = G.porticoU, cs = G.colSpacing; for (let i = 0; i < 6; i++) { const vc = cx + cs * (i - 2.5), zc = pu + 1.6; box('wall', vc - 0.7, G.colBase, zc - 0.7, vc + 0.7, G.colTop, zc + 0.7, { tone: 1, proj: opts.proxy ? 'n' : 'flat', faces: 'snwe' }); }
      box('wall', cx - 10.4, G.colTop, pu - 0.4, cx + 10.4, G.colTop + 2.8, u0, { tone: 1, proj: opts.proxy ? { s: 'n' } : 'flat', faces: 'snwet' }); box('wall', cx - 10.4, G.colBase - 0.6, pu - 0.2, cx + 10.4, G.colBase, u0, { tone: 1, proj: 'flat' });
      const pa = pu - 0.4; quad('wall', P(cx + 10.7, G.colTop + 2.8, pa), P(cx - 10.7, G.colTop + 2.8, pa), P(cx, 19.0, pa), P(cx, 19.0, pa), { proj: 'n', n: [0, 0, -1] }); }
    const ringL = (xa, xb, za, zb, y, h, out) => { box('wall', xa - out, y, za - out, xb + out, y + h, za, { tone: 1, proj: 'flat', faces: 'sntwb' }); box('wall', xa - out, y, zb, xb + out, y + h, zb + out, { tone: 1, proj: 'flat', faces: 'sntwb' }); box('wall', xa - out, y, za, xa, y + h, zb, { tone: 1, proj: 'flat', faces: 'swtb' }); box('wall', xb, y, za, xb + out, y + h, zb, { tone: 1, proj: 'flat', faces: 'setb' }); };
    ringL(v0, v1, u0, u1, G.wingEave - 0.6, 0.6, 0.5); ringL(mv0, mv1, u0, u1, G.mainEave - 1.2, 1.2, 0.8); ringL(mv0, mv1, uMain1, u1, G.towerEave - 1.4, 1.4, 0.8);
    return finish(B);
  }
  // ----- plinth, wings, side walls -----
  const wy0 = 0, we = G.wingEave, ct0 = G.colTop;
  const bayU = []; for (let n = G.bays[0]; n <= G.bays[1]; n++) bayU.push([n, G.bay0 + G.bayPitch * n]);
  const doorsBay = new Set([1, 2, 10]);
  function longOpenings(mirror) { // openings in wall coordinates s measured from the viewer-left end; SW: s = u - u0 ; NE: s = u1 - u
    const ops = [], S = (u) => mirror ? (u1 - u) : (u - u0), add = (uc, w, y0, y1, extra = {}) => { const a = S(uc - w / 2), b = S(uc + w / 2); ops.push({ s0: Math.min(a, b), s1: Math.max(a, b), y0, y1, ...extra }); };
    for (const [n, uc] of bayU) {
      const pav = n === -2 || n === 14; // end pavilion bays: hooded windows
      add(uc, pav ? 1.9 : 1.5, pav ? 6.2 : 5.7, pav ? 9.9 : 10.3, { sill: true, depth: 0.35 });
      for (const k of [-1, 0, 1]) add(uc + k * 0.95, 0.5, 12.3, 14.3, { nobars: true, depth: 0.25 });
      if (doorsBay.has(n)) add(uc, 1.8, 0, 3.6, { door: true, depth: 0.4 }); else add(uc, 1.1, 1.8, 3.7, { depth: 0.3, nobars: false });
      for (const k of [-0.5, 0.5]) add(uc + k * 1.45 * 0.9, 0.62, 19.5, 21.9, { nobars: true, depth: 0.22, wall2: true });
    }
    return ops.filter(o => !o.wall2).concat([]);
  }
  void longOpenings;
  const longWall = (mirror) => {
    const ops = []; const S = (u) => mirror ? (u1 - u) : (u - u0), add = (uc, w, y0, y1, extra = {}) => { const a = S(uc - w / 2), b = S(uc + w / 2); ops.push({ s0: Math.min(a, b), s1: Math.max(a, b), y0, y1, ...extra }); };
    for (const [n, uc] of bayU) { const pav = n === -2 || n === 14;
      add(uc, pav ? 1.9 : 1.5, pav ? 6.2 : 5.7, pav ? 9.9 : 10.3, { sill: true, depth: 0.35 });
      for (const k of [-1, 0, 1]) add(uc + k * 0.95, 0.5, 12.3, 14.3, { nobars: true, depth: 0.25 });
      if (doorsBay.has(n) || pav) add(uc, 1.8, 0, 3.6, { door: true, depth: 0.4 }); else add(uc, 1.1, 1.8, 3.7, { depth: 0.3 }); }
    const X = mirror ? v1 : v0, A = mirror ? [X, u1] : [X, u0], Bp = mirror ? [X, u0] : [X, u1];
    const w = wall(A, Bp, 0, we, ops, { proj: 'sw', depth: 0.3, tone: 0 });
    return w;
  };
  longWall(false); longWall(true);
  // end walls of the wing block at u1 (rear, plain with a few windows) handled by annex/rear masses; front (portico side) wings:
  const frontOps = []; { const add = (vc, w, y0, y1, e = {}) => frontOps.push({ s0: (cx + 20.2 - (vc + w / 2)), s1: (cx + 20.2 - (vc - w / 2)), y0, y1, ...e }); // s from viewer-left = highest v
    for (const side of [-1, 1]) { const vc = cx + side * 17.2; add(vc, 2.1, 6.2, 9.8, { sill: true, depth: 0.35 }); for (const k of [-1, 0, 1]) add(vc + k * 0.8, 0.5, 12.3, 14.3, { nobars: true, depth: 0.25 }); add(vc, 2.0, 0.3, 3.6, { door: true, depth: 0.4 }); } }
  // front wall of the wing block between v0..mv0 and mv1..v1 and the main block front wall above wing eave, built as one wall from v1 (left) to v0 (right), seen from -Z
  wall([v1, u0], [v0, u0], 0, we, frontOps.filter(o => true), { proj: 'n', depth: 0.3 });
  // ----- main block (upper walls) -----
  const mainSW = (mirror) => { const ops = [], S = (u) => mirror ? (uMain1 - u + 0) : (u - u0); for (const [n, uc] of bayU) for (const k of [-0.5, 0.5]) { const a = uc + k * 1.3 - 0.3, b = uc + k * 1.3 + 0.3; const s0 = S(a), s1 = S(b); if (uc > u1 - 3 || uc < u0 + 1) continue; ops.push({ s0: Math.min(s0, s1), s1: Math.max(s0, s1), y0: 19.65, y1: 21.95, nobars: true, depth: 0.22 }); }
    const X = mirror ? mv1 : mv0, A = mirror ? [X, u1] : [X, u0], Bp = mirror ? [X, u0] : [X, u1]; wall(A, Bp, we, 19.6, [], { proj: 'flat', tone: 0 }); return wall(A, Bp, 19.6, G.mainEave, ops, { proj: 'sw', depth: 0.22 }); };
  mainSW(false); mainSW(true);
  wall([v1, u1], [v0, u1], 0, we, [], { proj: 'flat', tone: 0 }); quad('roof', P(v1, we, u1), P(v0, we, u1), P(mv0, 19.6, u1), P(mv1, 19.6, u1), { roofAxis: 'z' });
  // main block front wall (above wing eave), v from mv1 (left) to mv0 (right)
  { const ops = [], add = (vc, w, y0, y1, e = {}) => ops.push({ s0: (mv1 - (vc + w / 2)), s1: (mv1 - (vc - w / 2)), y0, y1, ...e }); for (let i = 0; i < 12; i++) { const vc = cx + (i - 5.5) * 1.65; add(vc, 0.6, 19.65, 21.95, { nobars: true, depth: 0.25 }); }
    wall([mv1, u0], [mv0, u0], we, 19.6, [], { proj: 'flat', tone: 0 }); wall([mv1, u0], [mv0, u0], 19.6, G.mainEave, ops, { proj: 'n', depth: 0.25 }); }
  // tower walls
  { const wl = (X, mirror) => wall(mirror ? [X, u1] : [X, uMain1], mirror ? [X, uMain1] : [X, u1], G.mainEave, G.towerEave, [], { proj: 'sw' }); wl(mv0, false); wl(mv1, true);
    wall([mv1, u1], [mv0, u1], 0, G.towerEave, [], { proj: 'flat', tone: 0 }); wall([mv0, uMain1], [mv1, uMain1], G.mainEave, G.towerEave, [], { proj: 'flat' }); }
  // ----- cornices (stacked boxes) around main and tower and wings -----
  const ring = (xa, xb, za, zb, y, h, out, o = {}) => { // rectangle ring of a box profile: 4 slabs
    const tone = 1; box('wall', xa - out, y, za - out, xb + out, y + h, za, { tone, faces: 'sntwb', proj: 'flat' }); box('wall', xa - out, y, zb, xb + out, y + h, zb + out, { tone, faces: 'sntwb', proj: 'flat' });
    box('wall', xa - out, y, za, xa, y + h, zb, { tone, faces: 'snwtb', proj: 'flat' }); box('wall', xb, y, za, xb + out, y + h, zb, { tone, faces: 'snetb', proj: 'flat' }); void o; };
  ring(v0, v1, u0, u1, we - 0.55, 0.55, 0.5); ring(v0, v1, u0, u1, we - 1.2, 0.25, 0.15);
  ring(mv0, mv1, u0, uMain1, G.mainEave - 1.3, 1.3, 0.8); ring(mv0, mv1, uMain1, u1, G.towerEave - 1.5, 1.5, 0.8);
  ring(mv0, mv1, u0, u1, 24.25, 0.3, 0.2);
  // string course lines (plinth top, piano nobile sill, upper sill)
  for (const [y, h] of [[4.9, 0.3], [11.4, 0.25], [15.0, 0.3]]) ring(v0 + 0.01, v1 - 0.01, u0 + 0.01, u1 - 0.01, y, h, 0.1);
  // pilasters between pavilions and bays (vertical strips)
  
  // dentils under the main and tower cornices and the wing cornice (corbel row)
  if (lod === 0) { const dent = (xa, xb, za, zb, y) => { const d = 0.55; for (let z = za + 0.3; z < zb - 0.2; z += d) { box('wall', xa - 0.55, y, z, xa - 0.15, y + 0.3, z + 0.28, { tone: 1, proj: 'flat', faces: 'snwb' }); box('wall', xb + 0.15, y, z, xb + 0.55, y + 0.3, z + 0.28, { tone: 1, proj: 'flat', faces: 'snwb' }); }
      for (let x = xa; x < xb; x += d) box('wall', x, y, za - 0.55, x + 0.28, y + 0.3, za - 0.15, { tone: 1, proj: 'flat', faces: 'snwe' }); };
    dent(mv0, mv1, u0, uMain1, G.mainEave - 1.7); dent(v0, v1, u0, u1, we - 0.95); dent(mv0, mv1, uMain1, u1, G.towerEave - 1.9); }
  // ----- roofs -----
  { // wing roof: sloped ring from eave rectangle (y we) up to main block footprint (y wr)
    const wr = 19.6; const Q = [[v0, u0], [v1, u0], [v1, u1], [v0, u1]], Ri = [[mv0, u0], [mv1, u0], [mv1, u1], [mv0, u1]];
    // SW slope (x from v0 up to mv0), NE slope, rear slope
    quad('roof', P(v0, we, u1), P(v0, we, u0), P(mv0, wr, u0), P(mv0, wr, u1), { roofAxis: 'x' }); quad('roof', P(v1, we, u0), P(v1, we, u1), P(mv1, wr, u1), P(mv1, wr, u0), { roofAxis: 'x' });
    quad('roof', P(v0, we, u0), P(v1, we, u0), P(mv1, wr, u0), P(mv0, wr, u0), { roofAxis: 'z' }); void Q; void Ri; }
  roofHip(mv0 - 0.3, mv1 + 0.3, u0 - 0.3, uMain1, G.mainEave, G.mainRidge - G.mainEave, 0, { hipK: 1 });
  roofHip(mv0 - 0.3, mv1 + 0.3, uMain1, u1 + 0.3, G.towerEave, G.towerRidge - G.towerEave, 0, { hipK: 1 });
  for (const zz of [38, 46]) box('wall', cx - 1.6, G.towerRidge - 0.2, zz, cx + 1.6, G.towerRidge + 0.9, zz + 4, { tone: 3, proj: 'flat', faces: 'snwet' }); // skylight lanterns
  // ----- annex and rear masses (low detail: walls w/ a few openings + hip roofs) -----
  { const a = G.annex, ops = []; const add = (uc, w, y0, y1) => ops.push({ s0: uc - w / 2 - a.u0, s1: uc + w / 2 - a.u0, y0, y1, depth: 0.25 });
    for (let k = 0; k < 6; k++) add(a.u0 + 3.6 + k * 3.2, 1.1, 5.7, 10.3); for (let k = 0; k < 6; k++) add(a.u0 + 3.6 + k * 3.2, 1.1, 1.8, 3.7); for (let k = 0; k < 6; k++) add(a.u0 + 3.1 + k * 1.8, 0.8, 12.3, 14.5);
    wall([a.v0, a.u0 + 0], [a.v0, a.u1], 0, a.eave, ops, { proj: 'sw', depth: 0.25, rev: false }); wall([a.v1, a.u1], [a.v1, a.u0], 0, a.eave, ops.map(o => ({ ...o, s0: (a.u1 - a.u0) - o.s1, s1: (a.u1 - a.u0) - o.s0 })), { proj: 'sw', depth: 0.25, rev: false });
    wall([a.v1, a.u1], [a.v0, a.u1], 0, a.eave, [], { proj: 'flat' }); roofHip(a.v0, a.v1, a.u0, a.u1, a.eave, a.ridge - a.eave, 0); ring(a.v0, a.v1, a.u0, a.u1, a.eave - 0.55, 0.55, 0.4); }
  { const r = G.rear, Lr = r.u1 - r.u0, Wr = r.v1 - r.v0, nb = Math.round(Lr / G.bayPitch), pitch = Lr / nb, tiers = lod === 0 ? [[1.8, 3.7, 1.1], [5.7, 9.2, 1.5], [10.8, 12.9, 0.95]] : [[1.8, 3.7, 1.1], [5.7, 9.2, 1.5]];
    const opsFor = (L, p, n, door) => { const o = []; for (let k = 0; k < n; k++) { const sc = (k + 0.5) * p; for (const [a, b, w] of tiers) if (door !== false || a < 10) o.push({ s0: sc - w / 2, s1: sc + w / 2, y0: a, y1: b, depth: 0.25, nobars: a > 10 }); if (door && k % 6 === 2) o.push({ s0: sc - 0.9, s1: sc + 0.9, y0: 0, y1: 3.4, depth: 0.35, door: true }); } return o; };
    wall([r.v0, r.u0], [r.v0, r.u1], 0, r.h, opsFor(Lr, pitch, nb, true), { proj: 'flat', tone: 0, depth: 0.25, rev: false }); wall([r.v1, r.u1], [r.v1, r.u0], 0, r.h, opsFor(Lr, pitch, nb, true), { proj: 'flat', tone: 0, depth: 0.25, rev: false });
    const nw = Math.round(Wr / G.bayPitch); wall([r.v1, r.u1], [r.v0, r.u1], 0, r.h, opsFor(Wr, Wr / nw, nw, false), { proj: 'flat', tone: 0, depth: 0.25, rev: false });
    roofHip(r.v0, r.v1, r.u0, r.u1, r.h, r.ridge - r.h, 0); ring(r.v0, r.v1, r.u0, r.u1, r.h - 0.55, 0.55, 0.35); }
  // ===== portico =====
  { const pu = G.porticoU, cs = G.colSpacing, vs = [0, 1, 2, 3, 4, 5].map(i => cx + cs * (i - 2.5)), pv0 = cx - 10.2, pv1 = cx + 10.2, cb = G.colBase, ct = G.colTop;
    // podium (plinth) with 5 square openings, front face towards -Z, in the front region projection
    const pops = []; for (let i = 0; i < 5; i++) { const vc = cx + cs * (i - 2); pops.push({ s0: pv1 - (vc + 0.95), s1: pv1 - (vc - 0.95), y0: 0.3, y1: 3.6, depth: 0.6, door: true }); }
    wall([pv1, pu], [pv0, pu], 0, cb - 0.6, pops, { proj: 'n', depth: 0.6 });
    box('wall', pv0, 0, pu, pv0 + 0.001, cb - 0.6, u0, { faces: 'w', tone: 2, proj: 'flat' }); box('wall', pv1 - 0.001, 0, pu, pv1, cb - 0.6, u0, { faces: 'e', tone: 2, proj: 'flat' });
    box('wall', pv0 - 0.2, cb - 0.6, pu - 0.2, pv1 + 0.2, cb, u0, { tone: 1, proj: 'flat', faces: 'snwet' }); // stylobate / balcony floor
    for (let k = 0; k < 3; k++) box('wall', pv0 - 1.4 + k * 0.1, k * 0.1, pu - 1.5 + k * 0.5, pv1 + 1.4 - k * 0.1, k * 0.1 + 0.1, pu, { tone: 2, proj: 'flat', faces: 'snwet' }); // entrance steps
    for (let i = 0; i < 5; i++) { const vc = cx + cs * (i - 2); box('wall', vc - 1.25, 3.6, pu - 0.14, vc + 1.25, 3.9, pu + 0.1, { tone: 1, proj: 'flat', faces: 'snwet' }); // door heads
      if (lod === 0) { box('wall', vc - 0.05, 0.3, pu + 0.3, vc + 0.05, 3.6, pu + 0.38, { tone: 5, proj: 'flat' }); box('wall', vc - 1.05, 0.3, pu - 0.05, vc - 0.95, 3.6, pu + 0.1, { tone: 1, proj: 'flat', faces: 'snwe' }); box('wall', vc + 0.95, 0.3, pu - 0.05, vc + 1.05, 3.6, pu + 0.1, { tone: 1, proj: 'flat', faces: 'snwe' }); } }
    // loggia back wall at u0 with 5 window groups in two tiers, in the 'nl' projection
    const lops = []; for (let i = 0; i < 5; i++) { const vc = cx + cs * (i - 2); lops.push({ s0: mv1 - (vc + 0.95), s1: mv1 - (vc - 0.95), y0: cb + 0.05, y1: 10.3, depth: 0.45, door: false }); lops.push({ s0: mv1 - (vc + 0.95), s1: mv1 - (vc - 0.95), y0: 11.2, y1: 14.0, depth: 0.3 }); }
    wall([mv1, u0 + 0.0], [mv0, u0 + 0.0], cb, 16.8, lops, { proj: 'flat', tone: 0, depth: 0.3 }); // loggia back wall: plain plaster + real openings (the photogrammetry of the loggia is melted, so no photo here)
    if (lod <= 1) for (let i = 0; i < 6; i++) { const vc = cx + cs * (i - 2.5); box('wall', vc - 0.3, cb, u0 - 0.28, vc + 0.3, 16.8, u0, { tone: 1, proj: 'flat', faces: 'snwe' }); } // loggia pilasters between the window groups
    // columns
    for (const vc of vs) { const zc = pu + 0.9 + G.colD / 2; box('wall', vc - 0.95, cb, zc - 0.95, vc + 0.95, cb + 0.3, zc + 0.95, { tone: 1, proj: 'flat', faces: 'snwet' }); if (lod === 0) shaft('wall', vc, zc, G.colD / 2, cb + 0.3, ct - 0.8, 14, { tone: 1 }); else cyl('wall', vc, zc, G.colD / 2, cb + 0.3, ct - 0.8, 10, { tone: 1, proj: 'flat' });
      box('wall', vc - 0.95, ct - 0.8, zc - 0.95, vc + 0.95, ct - 0.5, zc + 0.95, { tone: 1, proj: 'flat', faces: 'snwet' }); // capital echinus + volutes
      if (lod === 0) { cyl('wall', vc - 0.78, zc - 0.95, 0.2, ct - 0.75, ct - 0.45, 12, { tone: 1, proj: 'flat' }); cyl('wall', vc + 0.78, zc - 0.95, 0.2, ct - 0.75, ct - 0.45, 12, { tone: 1, proj: 'flat' }); }
      box('wall', vc - 1.05, ct - 0.5, zc - 1.05, vc + 1.05, ct, zc + 1.05, { tone: 1, proj: 'flat', faces: 'snwet' }); }
    // balustrade between columns (balcony) on the stylobate edge
    if (lod === 0) { for (let i = 0; i < 5; i++) { const a = vs[i] + 0.95, b = vs[i + 1] - 0.95; box('wall', a, cb, pu + 0.05, b, cb + 0.15, pu + 0.35, { tone: 1, proj: 'flat', faces: 'snt' }); for (let x = a + 0.1; x < b - 0.1; x += 0.3) box('wall', x, cb + 0.15, pu + 0.1, x + 0.14, cb + 0.95, pu + 0.3, { tone: 1, proj: 'flat', faces: 'snwe' }); box('wall', a, cb + 0.95, pu + 0.05, b, cb + 1.1, pu + 0.35, { tone: 1, proj: 'flat', faces: 'sntb' }); } }
    // entablature: architrave + frieze (carries the lettering) + cornice, full width over columns, projecting
    const za = pu - 0.2, zb = pu + 0.2 + 6.7 - 0.2; quadFrontBox(pv0 - 0.2, pv1 + 0.2, ct, ct + 0.95, za, zb, 'n'); quadFrontBox(pv0 - 0.2, pv1 + 0.2, ct + 0.95, ct + 2.45, za + 0.05, zb, 'n');
    box('wall', pv0 - 0.5, ct + 2.45, pu - 0.55, pv1 + 0.5, ct + 2.75, zb, { tone: 1, proj: 'flat', faces: 'snwetb' }); if (lod === 0) for (let x = pv0 - 0.3; x < pv1 + 0.3; x += 0.55) box('wall', x, ct + 2.15, pu - 0.45, x + 0.26, ct + 2.45, pu - 0.1, { tone: 1, proj: 'flat', faces: 'snwb' });
    // pediment: front face recessed tympanum (photo of the relief), raking cornice
    const py0 = ct + 2.75, py1 = py0 + 2.2, pa = pu - 0.55; quad('wall', P(pv1 + 0.5, py0, pa), P(pv0 - 0.5, py0, pa), P(cx, py1, pa), P(cx, py1, pa), { proj: 'n', n: [0, 0, -1] });
    quad('wall', P(pv0 - 0.5, py0, pa), P(pv1 + 0.5, py0, pa), P(pv1 + 0.5, py0, pa + 6.5), P(pv0 - 0.5, py0, pa + 6.5), { proj: 'flat', tone: 1, n: [0, -1, 0], shade: 0.8 });
    quad('roof', P(pv1 + 0.5, py0, pa + 6.5), P(pv1 + 0.5, py0, pa), P(cx, py1 + 0.15, pa), P(cx, py1 + 0.15, pa + 6.5), { roofAxis: 'z' }); quad('roof', P(pv0 - 0.5, py0, pa), P(pv0 - 0.5, py0, pa + 6.5), P(cx, py1 + 0.15, pa + 6.5), P(cx, py1 + 0.15, pa), { roofAxis: 'z' });
    if (lod === 0) { statue(cx, py1 + 0.1, pa + 0.4, 3.0, 0, { w: 1.1 }); for (const k of [-5, -2.6, 2.6, 5]) statue(cx + k, py0 + (py1 - py0) * (1 - Math.abs(k) / 10.7) + 0.05, pa + 0.5, 1.8, 0, { arm: k > 0 ? 1 : -1 }); }
  }
  // statues: pedestal, robe, torso, head, raised arm + attribute (boxes; reads as a figure from 25 m+)
  function statue(x, y, z, h, face = 0, o = {}) { const k = h / 3, w = o.w ?? 0.55 * k, d = 0.7 * w, T = 6;
    box('wall', x - w * 0.9, y, z - d * 0.9, x + w * 0.9, y + 0.28 * k, z + d * 0.9, { tone: 1, proj: 'flat', faces: 'snwet' });                 // pedestal
    box('wall', x - w * 0.62, y + 0.28 * k, z - d * 0.62, x + w * 0.62, y + 1.35 * k, z + d * 0.62, { tone: T, proj: 'flat', faces: 'snwet' });     // robe
    if (lod > 0) return; box('wall', x - w * 0.42, y + 1.35 * k, z - d * 0.42, x + w * 0.42, y + 2.1 * k, z + d * 0.42, { tone: T, proj: 'flat', faces: 'snwet' }); // torso
    box('wall', x - w * 0.2, y + 2.15 * k, z - w * 0.2, x + w * 0.2, y + 2.6 * k, z + w * 0.2, { tone: T, proj: 'flat', faces: 'snwet' });         // head
    const sx = o.arm ?? 1; box('wall', x + sx * w * 0.42, y + 2.0 * k, z - 0.07 * k, x + sx * w * 0.62, y + 2.95 * k, z + 0.07 * k, { tone: T, proj: 'flat', faces: 'snwet' }); // raised arm
    if (o.lyre) { box('wall', x - w * 0.55, y + 2.7 * k, z - 0.04 * k, x - w * 0.4, y + 3.3 * k, z + 0.04 * k, { tone: 5, proj: 'flat' }); box('wall', x - w * 0.9, y + 3.3 * k, z - 0.04 * k, x - w * 0.05, y + 3.4 * k, z + 0.04 * k, { tone: 5, proj: 'flat' }); } }
  if (lod <= 1) { const fz = u0 + 0.9; for (const s of [-1, 1]) { statue(cx + s * 12.3, G.mainEave + 0.1, fz, 3.2, 0, { arm: s }); statue(cx + s * 7.4, G.mainEave + 0.1, fz, 3.0, 0, { arm: -s }); }
    for (const s of [-1, 1]) { statue(cx + s * 9.2, ct0 + 2.75, G.porticoU + 0.5, 2.6, 0, { arm: s }); }
    for (const sx of [v0 + 0.8, v1 - 0.8]) statue(sx, G.wingEave + 0.05, u0 + 0.9, 2.6, 0); }
  // lyre group & acroteria on the front attic, frieze statues
  if (lod <= 1) { box('wall', cx - 1.5, G.mainEave, u0 + 0.2, cx + 1.5, G.mainEave + 0.9, u0 + 1.4, { tone: 1, proj: 'flat' }); statue(cx, G.mainEave + 0.9, u0 + 0.8, 3.6, 0, { lyre: true, w: 1.3 }); }
  // front attic balustrade of the main block
  if (lod === 0) { for (let x = mv0 + 0.3; x < mv1 - 0.3; x += 0.32) { if (Math.abs(x - cx) < 1.8) continue; box('wall', x, G.mainEave + 0.15, u0 + 0.2, x + 0.15, G.mainEave + 1.0, u0 + 0.5, { tone: 1, proj: 'flat', faces: 'snwe' }); } box('wall', mv0, G.mainEave + 1.0, u0 + 0.15, mv1, G.mainEave + 1.15, u0 + 0.55, { tone: 1, proj: 'flat', faces: 'sntb' }); }
  // chimney / skylights
  box('wall', cx - 0.9, G.mainRidge - 0.1, 12, cx + 0.9, G.mainRidge + 1.3, 14, { tone: 7, proj: 'flat' });
  function quadFrontBox(x0, x1, y0, y1, za, zb, pr) { box('wall', x0, y0, za, x1, y1, zb, { proj: { s: pr }, tone: 0, faces: 'sntwe' }); }
  return finish(B);
}
function finish(B) {
  const out = {}; let tris = 0, verts = 0; for (const k of Object.keys(B)) { const m = B[k]; out[k] = { p: new Float32Array(m.p), n: new Float32Array(m.n), uv: new Float32Array(m.uv), c: new Float32Array(m.c), i: new Uint32Array(m.i) }; tris += m.i.length / 3; verts += m.p.length / 3; }
  return { mats: out, tris, verts };
}
