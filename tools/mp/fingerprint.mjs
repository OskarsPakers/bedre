// Fingerprint of everything that decides the client's object ids / fits / values (= the multiplayer object table):
// the centre map data + shapes and the world-building code. tools/mp/build-objects.mjs stamps it next to objects.bin and
// tools/mp/check-objects.mjs compares, so a stale table can no longer ship unnoticed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  'public/data/riga.json', 'public/data/riga-shapes.bin.gz',
  'src/world.js', 'src/scatter.js', 'src/propModels.js', 'src/riga.js', 'src/traffic.js', 'src/buildings.js', 'src/shapes.js', 'src/landmarks.js',
  'src/geo.js', 'src/config.js', 'src/maps.js', 'src/rng.js', 'src/water.js', 'src/data.js', 'src/rules.js', 'tools/maps.mjs',
];
export const STAMP = path.join(root, 'public', 'mp', 'objects.stamp.json');
export const BIN = path.join(root, 'public', 'mp', 'objects.bin');

export function fingerprint() {
  const h = crypto.createHash('sha256');
  for (const f of FILES) {
    const p = path.join(root, f);
    h.update(f + '\0');
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  return h.digest('hex').slice(0, 16);
}
