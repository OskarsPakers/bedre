// Hillshaded height map of an arbitrary region from the cached building height grids (measuring aid for curated-civic.mjs).
//   node tools/detail/region-map.mjs <x0> <z0> <x1> <z1> [--map=<slug>] [--px=4] [--out=file.png] [--sample=x,z]   (also prints heights on a coarse grid with --ascii=<m>)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, writePng } from './render.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2).filter((x) => !x.startsWith('--')).map(Number);
const opt = (k, d) => (process.argv.find((s) => s.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const MAP = opt('map', 'centrs'), px = +opt('px', 4), cellO = 0.5, ascii = +opt('ascii', 0);
const [X0, Z0, X1, Z1] = a;
export function loadRegion(MAP, X0, Z0, X1, Z1, cellO = 0.5) {
  const det = JSON.parse(fs.readFileSync(path.join(here, 'data', MAP === 'centrs' ? 'riga-detail.json' : `riga-detail-${MAP}.json`), 'utf8'));
  const w = Math.ceil((X1 - X0) / cellO), h = Math.ceil((Z1 - Z0) / cellO), H = new Float32Array(w * h).fill(NaN);
  for (const d of Object.values(det.buildings)) {
    const g = d.grid; if (!g) continue;
    if (g.x0 > X1 || g.x0 + g.w * g.cell < X0 || g.z0 > Z1 || g.z0 + g.h * g.cell < Z0) continue;
    const raw = Buffer.from(g.data, 'base64'); const n = g.w * g.h, vals = new Uint8Array(n); let p = 0;
    for (let i = 0; i + 1 < raw.length; i += 2) for (let c = 0; c < raw[i]; c++) vals[p++] = raw[i + 1];
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const r = vals[j * g.w + i]; if (!r) continue;
      const v = (r - 1) * g.scale;
      const x = g.x0 + (i + 0.5) * g.cell, z = g.z0 + (j + 0.5) * g.cell;
      const ci = Math.floor((x - X0) / cellO), cj = Math.floor((z - Z0) / cellO);
      const rr = g.cell > cellO ? Math.round(g.cell / cellO) : 1;
      for (let dj = 0; dj < rr; dj++) for (let di = 0; di < rr; di++) {
        const I = ci - (rr > 1 ? rr >> 1 : 0) + di, J = cj - (rr > 1 ? rr >> 1 : 0) + dj;
        if (I < 0 || J < 0 || I >= w || J >= h) continue;
        const k = J * w + I; if (!(H[k] >= v)) H[k] = v;
      }
    }
  }
  return { w, h, H, cell: cellO, x0: X0, z0: Z0 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const R = loadRegion(MAP, X0, Z0, X1, Z1, cellO);
  const cv = new Canvas(R.w * px, R.h * px);
  const at = (i, j) => { const v = R.H[Math.max(0, Math.min(R.h - 1, j)) * R.w + Math.max(0, Math.min(R.w - 1, i))]; return v; };
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const v = R.H[j * R.w + i]; if (Number.isNaN(v)) continue;
    const l = at(i - 1, j), r = at(i + 1, j), u = at(i, j - 1), d = at(i, j + 1);
    const dx = ((Number.isNaN(r) ? v : r) - (Number.isNaN(l) ? v : l)) / (2 * cellO), dz = ((Number.isNaN(d) ? v : d) - (Number.isNaN(u) ? v : u)) / (2 * cellO);
    const len = Math.hypot(dx, dz, 1), sh = Math.max(0, (dx * 0.5 + dz * 0.5 + 0.7) / len);
    const t = Math.min(1, v / 45);
    const base = [60 + 190 * t, 90 + 130 * (1 - Math.abs(t - 0.5) * 2), 200 - 160 * t], k = 0.45 + 0.75 * sh;
    for (let q = 0; q < px; q++) for (let s = 0; s < px; s++) cv.set(i * px + q, j * px + s, [base[0] * k, base[1] * k, base[2] * k]);
  }
  // 20 m grid ticks
  for (let x = Math.ceil(X0 / 20) * 20; x < X1; x += 20) { const X = Math.round((x - X0) / cellO) * px; for (let j = 0; j < R.h * px; j += 6) cv.set(X, j, [255, 255, 255]); if (x % 40 === 0) cv.text(String(x), X + 2, 2, [255, 255, 0], 2); }
  for (let z = Math.ceil(Z0 / 20) * 20; z < Z1; z += 20) { const Y = Math.round((z - Z0) / cellO) * px; for (let i = 0; i < R.w * px; i += 6) cv.set(i, Y, [255, 255, 255]); if (z % 40 === 0) cv.text(String(z), 2, Y + 2, [255, 255, 0], 2); }
  const file = opt('out', '/tmp/civic/region.png');
  writePng(file, cv.w, cv.h, cv.px);
  console.log('wrote', file, R.w, R.h);
  if (ascii) {
    for (let z = Z0; z < Z1; z += ascii) { let s = String(Math.round(z)).padStart(5) + ' '; for (let x = X0; x < X1; x += ascii) { const v = R.H[Math.floor((z - Z0) / cellO) * R.w + Math.floor((x - X0) / cellO)]; s += Number.isNaN(v) ? '  .' : String(Math.round(v)).padStart(3); } console.log(s); }
  }
}
