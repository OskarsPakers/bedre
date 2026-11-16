// Shared helpers for the map-fix pipeline (tools/mapfix): bounds-grid rasters at 1 m, polygon fill / stroke, ground png IO.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import sharp from 'sharp';
import { MAPS } from '../maps.mjs';
export { loadDsm, dtm, roughness, pip, area, bbox, quant, loadAnalysis } from '../qa-map/lib.mjs';
export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const SLUGS = ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];
export const pubDir = (slug) => path.join(ROOT, 'public/data', slug === 'centrs' ? '' : slug);
export const cacheDir = path.join(ROOT, 'tools/.cache');
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const mapInfo = (slug) => MAPS.find((m) => m.slug === slug);
export const loadCity = (slug) => readJson(path.join(pubDir(slug), 'riga.json'));
export const saveCity = (slug, city) => fs.writeFileSync(path.join(pubDir(slug), 'riga.json'), JSON.stringify(city));
/** a bounds-aligned 1 m grid */
export class Grid {
  constructor(b) { this.x0 = b.minX; this.z0 = b.minZ; this.W = Math.round(b.maxX - b.minX); this.H = Math.round(b.maxZ - b.minZ); }
  idx(x, z) { const i = Math.floor(x - this.x0), j = Math.floor(z - this.z0); return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i; }
  cx(i) { return this.x0 + i + 0.5; } cz(j) { return this.z0 + j + 0.5; }
  mask() { return new Uint8Array(this.W * this.H); }
  /** scanline even-odd fill of one or more rings */
  fill(m, rings, val = 1) {
    let zmin = 1e9, zmax = -1e9; for (const r of rings) for (const p of r) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
    const j0 = Math.max(0, Math.floor(zmin - this.z0)), j1 = Math.min(this.H - 1, Math.ceil(zmax - this.z0));
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + j + 0.5, xs = [];
      for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [ax, az] = r[a], [bx, bz] = r[b];
        if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - this.x0 - 0.5)), i1 = Math.min(this.W - 1, Math.floor(xs[k + 1] - this.x0 - 0.5));
        for (let i = i0; i <= i1; i++) m[j * this.W + i] = val;
      }
    }
  }
  stroke(m, pts, rad, val = 1) {
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.7));
      for (let t = 0; t <= n; t++) {
        const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
        const R = Math.ceil(rad);
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          if (di * di + dj * dj > rad * rad) continue;
          const i = Math.floor(x - this.x0) + di, j = Math.floor(z - this.z0) + dj;
          if (i >= 0 && j >= 0 && i < this.W && j < this.H) m[j * this.W + i] = val;
        }
      }
    }
  }
  dilate(m, r) { // square dilation, separable
    const { W, H } = this, t = new Uint8Array(m.length), o = new Uint8Array(m.length);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (!m[j * W + i]) continue; for (let q = Math.max(0, i - r); q <= Math.min(W - 1, i + r); q++) t[j * W + q] = 1; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (!t[j * W + i]) continue; for (let q = Math.max(0, j - r); q <= Math.min(H - 1, j + r); q++) o[q * W + i] = 1; }
    return o;
  }
  /** fraction of mask cells in a (2r+1)^2 window (integral image) */
  density(m, r) {
    const { W, H } = this, S = new Int32Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j++) { let row = 0; for (let i = 0; i < W; i++) { row += m[j * W + i]; S[(j + 1) * (W + 1) + i + 1] = S[j * (W + 1) + i + 1] + row; } }
    const out = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = Math.max(0, i - r), b = Math.max(0, j - r), c = Math.min(W, i + r + 1), d = Math.min(H, j + r + 1);
      out[j * W + i] = (S[d * (W + 1) + c] - S[b * (W + 1) + c] - S[d * (W + 1) + a] + S[b * (W + 1) + a]) / ((c - a) * (d - b));
    }
    return out;
  }
}
export async function readGround(slug) {
  const f = path.join(pubDir(slug), 'riga-ground.png');
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const cls = new Uint8Array(info.width * info.height);
  for (let k = 0; k < cls.length; k++) cls[k] = Math.round(data[k * info.channels] / 16);
  return { cls, W: info.width, H: info.height };
}
export async function writeGround(slug, G) {
  const px = Buffer.alloc(G.W * G.H * 3);
  for (let k = 0; k < G.cls.length; k++) px[k * 3] = G.cls[k] * 16;
  await sharp(px, { raw: { width: G.W, height: G.H, channels: 3 } }).png({ palette: true, colours: 16, compressionLevel: 9, effort: 10, dither: 0 }).toFile(path.join(pubDir(slug), 'riga-ground.png'));
}
export const hash2 = (x, z) => { let h = (Math.imul(Math.round(x * 4) | 0, 73856093) ^ Math.imul(Math.round(z * 4) | 0, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return (h ^ (h >>> 13)) >>> 0; };
