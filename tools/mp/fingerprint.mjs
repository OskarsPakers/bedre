// Fingerprints of everything that decides a map's placement file (= object ids / fits / values / props / movers): the map's data +
// shapes and the world-building code. tools/mp/build-objects.mjs stamps them (public/data/placements.stamp.json) next to the files and
// tools/mp/check-objects.mjs compares, so a stale placement file can no longer ship unnoticed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS, mapPaths } from '../maps.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODE = [
  'src/world.js', 'src/scatter.js', 'src/propModels.js', 'src/riga.js', 'src/traffic.js', 'src/buildings.js', 'src/shapes.js', 'src/landmarks.js',
  'src/geo.js', 'src/config.js', 'src/maps.js', 'src/rng.js', 'src/water.js', 'src/data.js', 'src/rules.js', 'src/spawn.js', 'src/placements.js',
  'tools/maps.mjs', 'worker/mp/table.js', 'public/data/riga-areas.json',
];
export const DATA_DIR = path.join(root, 'public', 'data');
export const STAMP = path.join(DATA_DIR, 'placements.stamp.json');
export const MANIFEST = path.join(DATA_DIR, 'placements.json');
export const slugs = () => MAPS.map((m) => m.slug);
/** absolute path of a map's placement file (centre = legacy flat path) */
export const fileOf = (slug) => path.join(root, 'public', mapPaths(slug).objects);

export function fingerprint(slug) {
  const p = mapPaths(slug);
  const h = crypto.createHash('sha256');
  for (const f of [...CODE, 'public' + p.data, 'public' + p.shapes]) {
    const abs = path.join(root, f);
    h.update(f + '\0');
    if (fs.existsSync(abs)) h.update(fs.readFileSync(abs));
  }
  return h.digest('hex').slice(0, 16);
}
