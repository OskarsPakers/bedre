import fs from 'node:fs'; import path from 'node:path';
import { loadMap, loadGround, pip, QC } from './lib.mjs';
const slug = process.argv[2] || 'centrs'; const M = loadMap(slug); const b = M.bounds; const G = await loadGround(slug); const gw = G.w, gh = G.h;
const near = new Uint8Array(gw * gh);
const mark = (x, z, r) => { for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (di * di + dj * dj > r * r) continue; const i = Math.floor(x - b.minX + di), j = Math.floor(z - b.minZ + dj); if (i >= 0 && j >= 0 && i < gw && j < gh) near[j * gw + i] = 1; } };
for (const r of M.city.roads) { if (r.tn) continue; const rad = Math.ceil((r.w || 4) / 2 + 3); for (let s = 0; s + 1 < r.p.length; s++) { const [ax, az] = r.p[s], [bx, bz] = r.p[s + 1]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5)); for (let t = 0; t <= n; t++) mark(ax + (bx - ax) * t / n, az + (bz - az) * t / n, rad); } }
const paint = (ring) => { let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); } for (let j = Math.max(0, Math.floor(c - b.minZ)); j < Math.min(gh, Math.ceil(f - b.minZ)); j++) for (let i = Math.max(0, Math.floor(a - b.minX)); i < Math.min(gw, Math.ceil(e - b.minX)); i++) if (pip(b.minX + i + .5, b.minZ + j + .5, ring)) near[j * gw + i] = 1; };
for (const ar of M.city.areas) if (['pkg', 'sq', 'rail', 'plat', 'brg', 'pier', 'sta', 'ind', 'con', 'pit'].includes(ar.c)) paint(ar.p);
// dilate buildings (yards next to buildings are asphalt without roads)
const bl = new Uint8Array(gw * gh); for (const g of M.game) { if (!g.ring.length) continue; let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of g.ring) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); } for (let j = Math.max(0, Math.floor(c - b.minZ - 1)); j < Math.min(gh, Math.ceil(f - b.minZ + 1)); j++) for (let i = Math.max(0, Math.floor(a - b.minX - 1)); i < Math.min(gw, Math.ceil(e - b.minX + 1)); i++) if (pip(b.minX + i + .5, b.minZ + j + .5, g.ring)) bl[j * gw + i] = 1; }
const cand = new Uint8Array(gw * gh); let nAs = 0, nFar = 0;
for (let k = 0; k < gw * gh; k++) if (G.cls[k] === 3) { nAs++; if (!near[k]) { nFar++; cand[k] = 1; } }
// open 3x3 to keep corridor-ish blobs; components
const lab = new Int32Array(gw * gh), out = [];
for (let k0 = 0; k0 < gw * gh; k0++) { if (!cand[k0] || lab[k0]) continue; const st = [k0]; lab[k0] = 1; let n = 0, sx = 0, sz = 0, mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9, nb = 0; while (st.length) { const k = st.pop(); n++; const i = k % gw, j = (k / gw) | 0; sx += i; sz += j; mnx = Math.min(mnx, i); mxx = Math.max(mxx, i); mnz = Math.min(mnz, j); mxz = Math.max(mxz, j); for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const kk = jj * gw + ii; if (cand[kk] && !lab[kk]) { lab[kk] = 1; st.push(kk); } } } if (n >= 400) out.push({ x: Math.round(b.minX + sx / n), z: Math.round(b.minZ + sz / n), area: n, bw: mxx - mnx + 1, bh: mxz - mnz + 1 }); }
out.sort((p, q) => q.area - p.area);
const res = { slug, asphaltCells: nAs, asphaltFarFromRoad: nFar, comps: out.slice(0, 20), nComps: out.length };
fs.writeFileSync(path.join(QC, `streets-${slug}.json`), JSON.stringify(res)); console.log(slug, nAs, nFar, out.length, JSON.stringify(out.slice(0, 8)));
