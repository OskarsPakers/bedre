import fs from 'node:fs'; import path from 'node:path';
import { loadMap, loadGround, pip, QC, ROOT } from './lib.mjs';
const slug = process.argv[2] || 'centrs'; const M = loadMap(slug); const b = M.bounds; const G = await loadGround(slug);
const W = slug === 'centrs' ? 6600 : 5200, H = slug === 'centrs' ? 5400 : 5200;
const buf = fs.readFileSync(path.join(ROOT, 'tools/.cache/ortho', slug === 'centrs' ? 'local05.bin' : `local05_${slug}.bin`)); const pl = W * H;
const gw = G.w, gh = G.h; const poly = new Uint8Array(gw * gh);
for (const wt of M.city.water) { let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of wt.p) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); }
  for (let j = Math.max(0, Math.floor(c - b.minZ)); j < Math.min(gh, Math.ceil(f - b.minZ)); j++) for (let i = Math.max(0, Math.floor(a - b.minX)); i < Math.min(gw, Math.ceil(e - b.minX)); i++) { const x = b.minX + i + .5, z = b.minZ + j + .5; let ins = pip(x, z, wt.p); if (ins && wt.h) for (const ho of wt.h) if (pip(x, z, ho)) ins = false; if (ins) poly[j * gw + i] = 1; } }
const ow = new Uint8Array(gw * gh);
for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const o = (j * 2) * W + i * 2; const r = buf[o], g = buf[pl + o], bl = buf[2 * pl + o]; ow[j * gw + i] = (bl - r >= 10 && bl >= g - 6 && r + g + bl < 330) ? 1 : 0; }
// smooth: 5x5 majority
const sm = new Uint8Array(gw * gh); for (let j = 2; j < gh - 2; j++) for (let i = 2; i < gw - 2; i++) { let s = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += ow[(j + dj) * gw + i + di]; sm[j * gw + i] = s >= 14 ? 1 : 0; }
let both = 0, polyOnly = 0, orthoOnly = 0; const A = new Uint8Array(gw * gh), Bm = new Uint8Array(gw * gh);
for (let k = 0; k < gw * gh; k++) { if (poly[k] && sm[k]) both++; else if (poly[k]) { polyOnly++; A[k] = 1; } else if (sm[k]) { orthoOnly++; Bm[k] = 1; } }
const comp = (m) => { const lab = new Int32Array(gw * gh), out = []; for (let k0 = 0; k0 < gw * gh; k0++) { if (!m[k0] || lab[k0]) continue; const st = [k0]; lab[k0] = 1; let n = 0, sx = 0, sz = 0; while (st.length) { const k = st.pop(); n++; sx += k % gw; sz += (k / gw) | 0; const i = k % gw, j = (k / gw) | 0; for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const kk = jj * gw + ii; if (m[kk] && !lab[kk]) { lab[kk] = 1; st.push(kk); } } } if (n >= 300) out.push({ x: Math.round(b.minX + sx / n), z: Math.round(b.minZ + sz / n), area: n }); } return out.sort((p, q) => q.area - p.area); };
const res = { slug, polyArea: both + polyOnly, agree: +(both / (both + polyOnly)).toFixed(3), polyOnly, orthoOnly, polyNotOrtho: comp(A).slice(0, 8), orthoNotPoly: comp(Bm).slice(0, 8) };
fs.writeFileSync(path.join(QC, `shore-${slug}.json`), JSON.stringify(res)); console.log(JSON.stringify(res));
