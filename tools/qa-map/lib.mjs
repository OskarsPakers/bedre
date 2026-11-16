import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';
import { MAPS } from '../maps.mjs';
export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const QC = process.env.QA_DIR ? path.resolve(process.env.QA_DIR) : path.join(ROOT, 'tools/.cache/qa-map'); // QA_DIR=tools/.cache/qa-map-after re-runs every check against the fixed game
export const AN = path.join(ROOT, 'tools/.cache/detail/analysis');
export const pubDir = (slug) => path.join(ROOT, 'public/data', slug === 'centrs' ? '' : slug);
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export function pip(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function distToRing(x, z, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz)); if (d < best) best = d;
  }
  return best;
}
export function area(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return Math.abs(s) / 2; }
export function bbox(r) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, z] of r) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } return { minX: a, minZ: b, maxX: c, maxZ: d }; }
export function quant(arr, q) { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; }
export function loadDsm(slug) {
  const m = readJson(path.join(QC, `dsm-${slug}.json`));
  const b = fs.readFileSync(path.join(QC, `dsm-${slug}.f32`));
  const d = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  return { ...m, d, at(x, z) { const i = Math.floor((x - m.x0) / m.cell), j = Math.floor((z - m.z0) / m.cell); return i < 0 || j < 0 || i >= m.w || j >= m.h ? NaN : d[j * m.w + i]; } };
}
/** rough terrain: grey opening on a 4 m grid (window ~ +-win m), bilinear back to 1 m. returns Float32 same size as dsm */
export function dtm(dsm, win = 48, erodeOnly = false) {
  const { w, h, d } = dsm, S = 4;
  const cw = Math.ceil(w / S), ch = Math.ceil(h / S);
  let mn = new Float32Array(cw * ch).fill(1e9);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = d[j * w + i]; if (v === v) { const k = ((j / S) | 0) * cw + ((i / S) | 0); if (v < mn[k]) mn[k] = v; } }
  const r = Math.round(win / S);
  const pass = (src, fn, horiz) => { const out = new Float32Array(src.length); for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { let v = fn === Math.min ? 1e9 : -1e9; for (let t = -r; t <= r; t++) { const ii = horiz ? i + t : i, jj = horiz ? j : j + t; if (ii < 0 || jj < 0 || ii >= cw || jj >= ch) continue; const s = src[jj * cw + ii]; v = fn(v, s); } out[j * cw + i] = v; } return out; };
  // erosion on cells without data stay 1e9 -> treat as +inf, fine for min; for dilation ignore -1e9
  let e = pass(pass(mn, Math.min, true), Math.min, false);
  let o = erodeOnly ? e : pass(pass(e, Math.max, true), Math.max, false);
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const fx = Math.min(cw - 1, i / S - 0.5), fz = Math.min(ch - 1, j / S - 0.5), x0 = Math.max(0, Math.floor(fx)), z0 = Math.max(0, Math.floor(fz)), x1 = Math.min(cw - 1, x0 + 1), z1 = Math.min(ch - 1, z0 + 1), tx = Math.max(0, fx - x0), tz = Math.max(0, fz - z0);
    const g = (a, b) => { const v = o[b * cw + a]; return v > 1e8 || v < -1e8 ? NaN : v; };
    const v00 = g(x0, z0), v10 = g(x1, z0), v01 = g(x0, z1), v11 = g(x1, z1);
    out[j * w + i] = (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
  }
  return out;
}
export async function loadGround(slug) {
  const f = path.join(pubDir(slug), 'riga-ground.png');
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const cls = new Uint8Array(info.width * info.height);
  for (let k = 0; k < cls.length; k++) cls[k] = Math.round(data[k * info.channels] / 16);
  return { cls, w: info.width, h: info.height };
}
export function loadMap(slug) {
  const m = MAPS.find((x) => x.slug === slug);
  const city = readJson(path.join(pubDir(slug), 'riga.json'));
  const game = readJson(path.join(QC, `game-${slug}.json`));
  return { slug, bounds: m.bounds, city, game, gameById: new Map(game.map((g) => [g.id, g])) };
}
export function loadAnalysis(id) {
  for (const f of [`${id}.json`, `${id}.c.json`]) { const p = path.join(AN, f); if (fs.existsSync(p)) { const j = readJson(p); delete j.grid; return j; } }
  return null;
}
/** roughness raster: 5x5 mean of capped |laplacian| (m). roofs ~0-0.3, tree crowns ~0.8+ */
export function roughness(dsm) {
  const { w, h, d } = dsm; const L = new Float32Array(w * h).fill(NaN);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = j * w + i, c = d[k]; if (c !== c) continue;
    const a = d[k - 1], b = d[k + 1], u = d[k - w], v = d[k + w]; if (a !== a || b !== b || u !== u || v !== v) continue;
    L[k] = Math.min(3, Math.abs(a + b - 2 * c) + Math.abs(u + v - 2 * c));
  }
  const tmp = new Float32Array(w * h).fill(NaN), out = new Float32Array(w * h).fill(NaN);
  for (let j = 0; j < h; j++) for (let i = 2; i < w - 2; i++) { let s = 0, n = 0; for (let t = -2; t <= 2; t++) { const v = L[j * w + i + t]; if (v === v) { s += v; n++; } } if (n >= 3) tmp[j * w + i] = s / n; }
  for (let j = 2; j < h - 2; j++) for (let i = 0; i < w; i++) { let s = 0, n = 0; for (let t = -2; t <= 2; t++) { const v = tmp[(j + t) * w + i]; if (v === v) { s += v; n++; } } if (n >= 3) out[j * w + i] = s / n; }
  return out;
}
import zlib from 'node:zlib';
export function loadRecs(slug) {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(pubDir(slug), 'riga-shapes.bin.gz')));
  const hl = buf.readUInt32LE(4); const head = JSON.parse(buf.slice(8, 8 + hl).toString());
  const ST = head.stride || 10, recs = new Map();
  for (let i = 0; i < head.b.length / ST; i++) { const r = head.b.slice(i * ST, i * ST + ST); recs.set(r[0], { id: r[0], nv: r[1], nt: r[2], nl: r[3], src: r[4], vol: r[5], hmax: r[6] / 10, eave: r[7] / 10, roofRGB: r[8], wallRGB: r[9] || 0, style: r[12] || 0, flags: r[13] || 0 }); }
  return recs;
}
