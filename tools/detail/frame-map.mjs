// Height map of a region rotated into a building frame (axis-aligned in (u, v) = (x cos th + z sin th, -x sin th + z cos th)), for writing curated-civic.mjs specs.
//   node tools/detail/frame-map.mjs <thDeg> <cx> <cz> <halfU> <halfV> [--map=slug] [--px=6] [--ascii=3] [--out=/tmp/civic/f.png]
// Centre (cx, cz) is given in WORLD coordinates; the ticks / ascii are in frame coordinates, `u v` printed for the centre.
import { loadRegion } from './region-map.mjs';
import { Canvas, writePng } from './render.mjs';
const a = process.argv.slice(2).filter((x) => !x.startsWith('--')).map(Number);
const opt = (k, d) => (process.argv.find((s) => s.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const [TH, cx, cz, hu, hv] = a;
const th = (TH * Math.PI) / 180, ux = Math.cos(th), uz = Math.sin(th), MAP = opt('map', 'centrs'), px = +opt('px', 6), asc = +opt('ascii', 0);
const R0 = Math.hypot(hu, hv) + 4;
const R = loadRegion(MAP, cx - R0, cz - R0, cx + R0, cz + R0, 0.5);
const at = (x, z) => { const i = Math.floor((x - R.x0) / 0.5), j = Math.floor((z - R.z0) / 0.5); return i < 0 || j < 0 || i >= R.w || j >= R.h ? NaN : R.H[j * R.w + i]; };
const uc = cx * ux + cz * uz, vc = -cx * uz + cz * ux;
const W = (u, v) => [ux * u - uz * v, uz * u + ux * v];
const step = 0.5, nu = Math.round((2 * hu) / step), nv = Math.round((2 * hv) / step);
const G = new Float32Array(nu * nv).fill(NaN);
let mx = 0;
for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const [x, z] = W(uc - hu + (i + 0.5) * step, vc - hv + (j + 0.5) * step); const h = at(x, z); G[j * nu + i] = h; if (h > mx) mx = h; }
const cv = new Canvas(nu * px, nv * px);
const g = (i, j) => G[Math.max(0, Math.min(nv - 1, j)) * nu + Math.max(0, Math.min(nu - 1, i))];
for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
  const v = G[j * nu + i]; if (Number.isNaN(v)) continue;
  const l = g(i - 1, j), r = g(i + 1, j), u = g(i, j - 1), d = g(i, j + 1);
  const dx = (Number.isNaN(r) ? v : r) - (Number.isNaN(l) ? v : l), dz = (Number.isNaN(d) ? v : d) - (Number.isNaN(u) ? v : u);
  const len = Math.hypot(dx, dz, 1), sh = Math.max(0, (dx * 0.5 + dz * 0.5 + 0.7) / len), t = Math.min(1, v / Math.max(mx, 1)), k = 0.45 + 0.75 * sh;
  const base = [60 + 190 * t, 90 + 130 * (1 - Math.abs(t - 0.5) * 2), 200 - 160 * t];
  for (let q = 0; q < px; q++) for (let s = 0; s < px; s++) cv.set(i * px + q, j * px + s, [base[0] * k, base[1] * k, base[2] * k]);
}
const tk = (hu * 2 > 120 ? 20 : 10);
for (let u = Math.ceil((uc - hu) / tk) * tk; u < uc + hu; u += tk) { const X = Math.round(((u - (uc - hu)) / step) * px); for (let j = 0; j < nv * px; j += 6) cv.set(X, j, [255, 255, 255]); cv.text(String(Math.round(u)), X + 2, 2, [255, 255, 0], 2); }
for (let v = Math.ceil((vc - hv) / tk) * tk; v < vc + hv; v += tk) { const Y = Math.round(((v - (vc - hv)) / step) * px); for (let i = 0; i < nu * px; i += 6) cv.set(i, Y, [255, 255, 255]); cv.text(String(Math.round(v)), 2, Y + 2, [255, 255, 0], 2); }
const out = opt('out', '/tmp/civic/f.png');
writePng(out, cv.w, cv.h, cv.px);
console.log(`frame th=${TH} centre u=${uc.toFixed(1)} v=${vc.toFixed(1)}  u in [${(uc - hu).toFixed(0)}, ${(uc + hu).toFixed(0)}] v in [${(vc - hv).toFixed(0)}, ${(vc + hv).toFixed(0)}] max ${mx.toFixed(1)} -> ${out}`);
if (asc) for (let v = vc - hv; v < vc + hv; v += asc) { let s = String(Math.round(v)).padStart(5) + ' '; for (let u = uc - hu; u < uc + hu; u += asc) { const [x, z] = W(u, v); const h = at(x, z); s += Number.isNaN(h) ? '  .' : String(Math.round(h)).padStart(3); } console.log(s); }
