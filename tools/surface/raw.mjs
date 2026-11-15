// Orthophoto sampling in the game's local frame + per-pixel colour classification (0.5 m).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, BOUNDS, CT, lksFromLocal } from './common.mjs';

export const C = { OTHER: 0, GRASS: 1, CANOPY: 2, ASPHALT: 3, PAVING: 4, GRAVEL: 5, WATER: 6, BALLAST: 7, SETT: 8, SHADOW: 15 };

export function loadOrtho() {
  const meta = JSON.parse(fs.readFileSync(path.join(CACHE, 'ortho', `ortho05${CT}.json`), 'utf8'));
  const rgb = fs.readFileSync(path.join(CACHE, 'ortho', `ortho05${CT}.rgb`));
  return { meta, rgb };
}

/** Resample the mosaic into the local frame at `res` m/px; returns {W,H,r,g,b} (Uint8Array each). */
export function sampleLocal(ortho, res = 0.5) {
  const { meta, rgb } = ortho;
  const W = Math.round((BOUNDS.maxX - BOUNDS.minX) / res), H = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / res);
  const r = new Uint8Array(W * H), g = new Uint8Array(W * H), b = new Uint8Array(W * H);
  const L = 32; // lattice step (cells)
  const nx = Math.ceil(W / L) + 1, ny = Math.ceil(H / L) + 1;
  const latE = new Float64Array(nx * ny), latN = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [E, N] = lksFromLocal(BOUNDS.minX + i * L * res, BOUNDS.minZ + j * L * res);
    latE[j * nx + i] = E; latN[j * nx + i] = N;
  }
  const MW = meta.W, MH = meta.H;
  for (let y = 0; y < H; y++) {
    const j = Math.floor(y / L), fy = (y + 0.5) / L - j;
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / L), fx = (x + 0.5) / L - i;
      const k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
      const E = (latE[k00] * (1 - fx) + latE[k10] * fx) * (1 - fy) + (latE[k01] * (1 - fx) + latE[k11] * fx) * fy;
      const N = (latN[k00] * (1 - fx) + latN[k10] * fx) * (1 - fy) + (latN[k01] * (1 - fx) + latN[k11] * fx) * fy;
      let px = (E - meta.E0) / meta.res - 0.5, py = (meta.N1 - N) / meta.res - 0.5;
      px = Math.max(0, Math.min(MW - 1.001, px)); py = Math.max(0, Math.min(MH - 1.001, py));
      const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
      const o = (y0 * MW + x0) * 3, o2 = o + MW * 3;
      const o_ = y * W + x;
      for (let c = 0; c < 3; c++) {
        const v = (rgb[o + c] * (1 - tx) + rgb[o + 3 + c] * tx) * (1 - ty) + (rgb[o2 + c] * (1 - tx) + rgb[o2 + 3 + c] * tx) * ty;
        (c === 0 ? r : c === 1 ? g : b)[o_] = v;
      }
    }
  }
  return { W, H, r, g, b, res };
}

/** Pure colour classification of one pixel (no vectors). */
export function classify(r, g, b, P) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
  const exg = 2 * g - r - b;
  // vegetation
  if (exg > P.exg && g >= r - 2 && g > b + 4) {
    return v < P.canopyV || g < P.canopyG ? C.CANOPY : C.GRASS;
  }
  if (v < P.shadowV) return C.SHADOW;
  // bare earth / gravel / sand: warm, saturated, mid-bright
  if (r > b + P.warmRB && r >= g - 3 && sat > P.warmSat) return C.GRAVEL;
  if (v >= P.paveV) return C.PAVING;
  return C.ASPHALT;
}
