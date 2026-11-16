import fs from 'node:fs'; import path from 'node:path';
import { loadMap, loadDsm, loadGround, pip, quant, QC } from './lib.mjs';
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const M = loadMap(slug), dsm = loadDsm(slug), G = await loadGround(slug); const b = M.bounds; const { w, h, x0, z0, d } = dsm;
  const inW = new Uint8Array(w * h); // in water polygon (holes? polygons may have holes 'h')
  for (const wt of M.city.water) {
    const rings = [wt.p, ...(wt.h || [])];
    let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of wt.p) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); }
    for (let j = Math.max(0, Math.floor(c - z0)); j <= Math.min(h - 1, Math.ceil(f - z0)); j++) for (let i = Math.max(0, Math.floor(a - x0)); i <= Math.min(w - 1, Math.ceil(e - x0)); i++) {
      const x = x0 + i + .5, z = z0 + j + .5; let ins = pip(x, z, wt.p); if (ins && wt.h) for (const hole of wt.h) if (pip(x, z, hole)) ins = false; if (ins) inW[j * w + i] = 1;
    }
  }
  // bridge mask: ground areas brg/pier + bridge roads
  const ex = new Uint8Array(w * h);
  const paint = (ring) => { let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); } for (let j = Math.max(0, Math.floor(c - z0)); j <= Math.min(h - 1, Math.ceil(f - z0)); j++) for (let i = Math.max(0, Math.floor(a - x0)); i <= Math.min(w - 1, Math.ceil(e - x0)); i++) if (pip(x0 + i + .5, z0 + j + .5, ring)) ex[j * w + i] = 1; };
  for (const ar of M.city.areas) if (ar.c === 'brg' || ar.c === 'pier' || ar.c === 'island') paint(ar.p);
  for (const p of M.city.piers || []) paint(p.p);
  for (const r of M.city.roads) if (r.br) for (let s = 0; s + 1 < r.p.length; s++) { const [ax, az] = r.p[s], [bx, bz] = r.p[s + 1]; const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len); const rad = (r.w || 6) / 2 + 4; for (let t = 0; t <= n; t++) { const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n; for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const i = Math.floor(x - x0 + di), j = Math.floor(z - z0 + dj); if (i >= 0 && j >= 0 && i < w && j < h) ex[j * w + i] = 1; } } }
  const vals = []; let nW = 0, nan = 0;
  for (let k = 0; k < w * h; k++) if (inW[k]) { nW++; if (d[k] === d[k]) vals.push(d[k]); else nan++; }
  const lvl = quant(vals, 0.5);
  // land cells inside water polygon
  const land = new Uint8Array(w * h); let nl = 0;
  for (let k = 0; k < w * h; k++) if (inW[k] && !ex[k] && d[k] === d[k] && d[k] - lvl >= 1.5) { land[k] = 1; nl++; }
  // components
  const lab = new Int32Array(w * h), comps = [];
  for (let k0 = 0; k0 < w * h; k0++) { if (!land[k0] || lab[k0]) continue; const st = [k0]; lab[k0] = comps.length + 1; const cells = []; while (st.length) { const k = st.pop(); cells.push(k); const i = k % w, j = (k / w) | 0; for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; const kk = jj * w + ii; if (land[kk] && !lab[kk]) { lab[kk] = comps.length + 1; st.push(kk); } } } comps.push(cells); }
  const cs = comps.filter((c) => c.length >= 80).map((c) => { let sx = 0, sz = 0, hm = 0; for (const k of c) { sx += k % w; sz += (k / w) | 0; hm += d[k] - lvl; } return { x: +(x0 + sx / c.length).toFixed(0), z: +(z0 + sz / c.length).toFixed(0), area: c.length, meanH: +(hm / c.length).toFixed(1) }; }).sort((a, b) => b.area - a.area);
  // png class 6 vs polygon
  let both = 0, onlyPoly = 0, onlyPng = 0;
  for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) { const k = (j + Math.round(b.minZ - z0)) * w + (i + Math.round(b.minX - x0)); const p = inW[k], c = G.cls[j * G.w + i] === 6; if (p && c) both++; else if (p) onlyPoly++; else if (c) onlyPng++; }
  const res = { slug, waterPolys: M.city.water.length, waterCells: nW, meshLevel: +lvl.toFixed(2), meshNaNFrac: +(nan / Math.max(1, nW)).toFixed(2), landInWaterCells: nl, landComps: cs.slice(0, 15), png: { both, onlyPoly, onlyPng } };
  fs.writeFileSync(path.join(QC, `ground-${slug}.json`), JSON.stringify(res));
  console.log(slug, JSON.stringify({ ...res, landComps: cs.slice(0, 6) }));
}
