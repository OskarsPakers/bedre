// Small generator library for the signature buildings after the Opera (same output contract as gen.js: plain buffers per material, palette-mode UVs: u = (tone + .5) / 8).
// Model space: X = across (v), Y up (ground 0), Z = along (u); the registry (src/proto/tram/city/signature/assets.js) places it with the building's own frame.
// Zones (tone ids): 0 plaster / main wall, 1 trim / frames / bars, 2 stone base / plinth, 3 roof (own material), 4 glass (own material), 5 metal / dark, 6 accent (brick / panel / sculpture), 7 door / dark recess.
export const TONE = { wall: 0, trim: 1, base: 2, roof: 3, glass: 4, metal: 5, accent: 6, door: 7 };
export function builder(lod) {
  const B = {}; const M = (m) => B[m] || (B[m] = { p: [], n: [], uv: [], c: [], i: [] });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nz = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  let gq = 0;
  /** quad a,b,c,d counter-clockwise seen from outside. o: tone, shade, n */
  function quad(mat, a, b, c, d, o = {}) {
    let n = o.n || nz(cr(sub(b, a), sub(d, a))); if (mat === 'roof' && n[1] < 0) { [b, d] = [d, b]; n = [-n[0], -n[1], -n[2]]; }
    const m = M(mat), base = m.p.length / 3, sh = o.shade ?? 1, u = mat === 'glass' ? ((gq++ % 8) + 0.5) / 8 : ((mat === 'roof' ? 3 : o.tone ?? 0) + 0.5) / 8;
    for (const q of [a, b, c, d]) { m.p.push(...q); m.n.push(...n); m.uv.push(u, 0.5); m.c.push(sh, sh, sh); }
    m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const P = (x, y, z) => [x, y, z];
  function box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    const f = o.faces || 'sntbwe', t = o.tone ?? 0, sh = o.shade ?? 1;
    if (f.includes('s')) quad(mat, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), { tone: t, shade: sh });
    if (f.includes('n')) quad(mat, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), { tone: t, shade: sh });
    if (f.includes('w')) quad(mat, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), { tone: t, shade: sh * 0.94 });
    if (f.includes('e')) quad(mat, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), { tone: t, shade: sh * 0.94 });
    if (f.includes('t')) quad(mat, P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), { tone: t, shade: sh });
    if (f.includes('b')) quad(mat, P(x0, y0, z1), P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), { tone: t, shade: sh * 0.7 });
  }
  /** wall from A=[x,z] (viewer-left) to Bp (viewer-right) seen from outside, y0..y1, with openings {s0,s1,y0,y1,depth,glass:true|false,door,tone}: reveals + glass at depth (lod 0/1), flat glass (lod 2) */
  function wall(A, Bp, y0, y1, ops, o = {}) {
    if (lod >= 2) ops = ops.filter((q) => q.s1 - q.s0 > 6);   // LOD2: big openings only
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), t = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L], n = [-t[1], t[0]], at = (s, y, off = 0) => [A[0] + t[0] * s + n[0] * off, y, A[1] + t[1] * s + n[1] * off];
    const tone = o.tone ?? 0, depth = o.depth ?? 0.25, ysplit = o.split || [];
    const ys = [...new Set([y0, y1, ...ysplit.filter((y) => y > y0 && y < y1), ...ops.flatMap((q) => [q.y0, q.y1])])].sort((a, b) => a - b);
    for (let k = 0; k < ys.length - 1; k++) { const ya = ys[k], yb = ys[k + 1], cov = ops.filter((q) => q.y0 <= ya + 1e-6 && q.y1 >= yb - 1e-6).sort((a, b) => a.s0 - b.s0); let s = 0; const pieces = [];
      for (const q of cov) { if (q.s0 > s + 1e-4) pieces.push([s, q.s0]); s = Math.max(s, q.s1); } if (s < L - 1e-4) pieces.push([s, L]);
      const tn = o.toneAt ? o.toneAt((ya + yb) / 2) : tone;
      for (const [a, b] of pieces) quad('wall', at(a, ya), at(b, ya), at(b, yb), at(a, yb), { tone: tn, n: [n[0], 0, n[1]], shade: o.shadeAt ? o.shadeAt(ya, yb) : 1 }); }
    for (const q of ops) { const d = q.depth ?? depth, a0 = q.s0, a1 = q.s1, b0 = q.y0, b1 = q.y1;
      if (lod === 0 && d > 0.02) { const rs = q.revTone ?? 7;
        quad('wall', at(a0, b0), at(a0, b1), at(a0, b1, -d), at(a0, b0, -d), { tone: rs, shade: 0.55 }); quad('wall', at(a1, b1), at(a1, b0), at(a1, b0, -d), at(a1, b1, -d), { tone: rs, shade: 0.55 });
        quad('wall', at(a0, b1), at(a1, b1), at(a1, b1, -d), at(a0, b1, -d), { tone: rs, shade: 0.4 }); quad('wall', at(a1, b0), at(a0, b0), at(a0, b0, -d), at(a1, b0, -d), { tone: rs, shade: 0.85 }); }
      const dd = lod === 0 ? d : Math.min(d, 0.05);
      if (q.door || q.solid) quad('wall', at(a0, b0, -dd), at(a1, b0, -dd), at(a1, b1, -dd), at(a0, b1, -dd), { tone: q.tone ?? 7, n: [n[0], 0, n[1]] });
      else quad('glass', at(a0, b0, -dd), at(a1, b0, -dd), at(a1, b1, -dd), at(a0, b1, -dd), { n: [n[0], 0, n[1]] });
      if (lod === 0 && !q.door && !q.solid && !q.nobars) { const w = a1 - a0, h = b1 - b0, th = 0.04; // mullion + transom proud of the glass
        if (w > 1.2) { const s = (a0 + a1) / 2; bar(at(s - th, b0, -dd), at(s + th, b1, -dd + 0.04), n); } if (h > 1.9) { const y = b0 + h * 0.62; bar(at(a0, y - th, -dd), at(a1, y + th, -dd + 0.04), n); } } }
    return { at, n, t, L };
  }
  function bar(a, b, n) { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); quad('wall', P(x0, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z0), { tone: 1, n: [n[0], 0, n[1]], shade: 0.9 }); }
  /** curtain wall: a glass skin with a mullion grid (spandrel bands and posts) on wall A->Bp, y0..y1. cols = post pitch, rows = [[ya,yb,kind]] kind 'glass' | 'spandrel' */
  function curtain(A, Bp, y0, y1, o) {
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), t = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L], n = [-t[1], t[0]], at = (s, y, off = 0) => [A[0] + t[0] * s + n[0] * off, y, A[1] + t[1] * s + n[1] * off];
    const nc = lod >= 2 ? 1 : Math.max(1, Math.round(L / o.pitch)), pitch = L / nc, off = o.off ?? 0;
    for (const [ya, yb, kind] of o.rows) { if (yb <= y0 || ya >= y1) continue; const a = Math.max(ya, y0), b = Math.min(yb, y1);
      if (kind === 'spandrel') quad('wall', at(0, a, off), at(L, a, off), at(L, b, off), at(0, b, off), { tone: o.spandrelTone ?? 5, n: [n[0], 0, n[1]], shade: 0.8 });
      else for (let k = 0; k < nc; k++) quad('glass', at(k * pitch, a, off - 0.05), at((k + 1) * pitch, a, off - 0.05), at((k + 1) * pitch, b, off - 0.05), at(k * pitch, b, off - 0.05), { n: [n[0], 0, n[1]] }); }
    if (lod <= 1) for (let k = 0; k <= nc; k++) { const s = Math.min(L - 0.04, Math.max(0.04, k * pitch)); box2(at(s - 0.05, y0, off - 0.02), at(s + 0.05, y1, off + 0.1), 1, n); }
    if (lod === 0) for (const [ya, yb, kind] of o.rows) if (kind === 'spandrel' || kind === 'glass') { for (const y of [ya, yb]) if (y > y0 + 0.1 && y < y1 - 0.1) box2(at(0, y - 0.05, off - 0.02), at(L, y + 0.05, off + 0.08), 1, n); }
    return { at, n, t, L };
  }
  function box2(a, b, tone, n) { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); box('wall', x0, y0, z0, x1, y1, z1, { tone, faces: Math.abs(n[2]) > Math.abs(n[0]) ? (n[2] > 0 ? 'nt' : 'st') : (n[0] > 0 ? 'et' : 'wt') }); }
  const roofSlab = (x0, x1, z0, z1, y) => quad('roof', P(x0, y, z0), P(x0, y, z1), P(x1, y, z1), P(x1, y, z0), {});
  /** a flat-roofed block: 4 plain walls (no openings) + roof deck + parapet */
  function block(x0, x1, z0, z1, ya, yb, o = {}) { const tone = o.tone ?? 0; box('wall', x0, ya, z0, x1, yb, z1, { tone, faces: o.faces || 'snwe', shade: o.shade ?? 1 }); if (o.roof !== false) roofSlab(x0, x1, z0, z1, yb + 0.01);
    if (o.parapet) { const p = o.parapet, t = 0.25; for (const [a, b, c, d] of [[x0, yb, z0, x1], [x0, yb, z1 - t, x1]]) box('wall', a, b, c, d, b + p, c + t, { tone: o.ptone ?? tone, faces: 'snwet' }); box('wall', x0, yb, z0, x0 + t, yb + p, z1, { tone: o.ptone ?? tone, faces: 'snwet' }); box('wall', x1 - t, yb, z0, x1, yb + p, z1, { tone: o.ptone ?? tone, faces: 'snwet' }); } }
  const finish = () => { const out = {}; let tris = 0, verts = 0; for (const k of Object.keys(B)) { const m = B[k]; out[k] = { p: new Float32Array(m.p), n: new Float32Array(m.n), uv: new Float32Array(m.uv), c: new Float32Array(m.c), i: new Uint32Array(m.i) }; tris += m.i.length / 3; verts += m.p.length / 3; } return { mats: out, tris, verts }; };
  return { quad, box, wall, curtain, block, roofSlab, finish, P, lod };
}
