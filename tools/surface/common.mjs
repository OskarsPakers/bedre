// Shared constants/helpers for the ground-surface tools (orthophoto measuring + class raster).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapBySlug } from '../maps.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = path.join(ROOT, 'tools', '.cache');
export const ORIGIN = { lat: 56.9515, lon: 24.1133 };
export const M_LAT = 111320;
export const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
// Map extent (local metres; x east, z south) of the selected map (--map <slug>, default centrs; tools/maps.mjs).
const argI = process.argv.indexOf('--map');
export const MAP_SLUG = argI >= 0 ? process.argv[argI + 1] : process.env.MAP || 'centrs';
export const MAP = mapBySlug(MAP_SLUG);
export const BOUNDS = { ...MAP.bounds };
export const CT = MAP_SLUG === 'centrs' ? '' : '_' + MAP_SLUG; // cache-name suffix
export const DATA_DIR = MAP_SLUG === 'centrs' ? path.join(ROOT, 'public', 'data') : path.join(ROOT, 'public', 'data', MAP_SLUG);
export const UA = 'riga-game-data-builder';

/** local (x east, z south) -> lon/lat */
export const toLonLat = (x, z) => [ORIGIN.lon + x / M_LON, ORIGIN.lat - z / M_LAT];

/** WGS84/GRS80 lon/lat -> LKS-92 TM (EPSG:3059): lon0 24E, k0 0.9996, FE 500000, FN -6000000 (Snyder series). */
export function lksFromLonLat(lon, lat) {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const k0 = 0.9996, lon0 = 24 * Math.PI / 180;
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = (lam - lon0) * Math.cos(phi);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  const E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const Nn = -6000000 + k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [E, Nn];
}
export const lksFromLocal = (x, z) => { const [lo, la] = toLonLat(x, z); return lksFromLonLat(lo, la); };
