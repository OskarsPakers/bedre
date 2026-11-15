#!/usr/bin/env node
// Writes tools/.cache/districts-for-detail.json for the building-shapes agent: per map bounds + building ids (+ coverage hints).
// Shapes convention: write public/data/<slug>/riga-shapes.bin.gz (same format as the centre's public/data/riga-shapes.bin.gz);
// the client derives the URL from the map slug (tools/maps.mjs mapPaths(slug).shapes) and falls back to flat boxes when it is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS, mapPaths } from './maps.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = { note: 'shapes file per map: public/data/<slug>/riga-shapes.bin.gz (centrs keeps public/data/riga-shapes.bin.gz). Projection is shared by all maps (origin lat 56.9515 lon 24.1133).', maps: [] };
for (const m of MAPS) {
  const f = path.join(ROOT, 'public', mapPaths(m.slug).data);
  if (!fs.existsSync(f)) { out.maps.push({ slug: m.slug, built: false, bounds: m.bounds }); continue; }
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  out.maps.push({
    slug: m.slug, built: true, name: m.en, bounds: d.meta.bounds, shapesFile: mapPaths(m.slug).shapes.replace(/^\//, 'public/'),
    reality_mesh_coverage_expected: { centrs: 'yes (measured)', agenskalns: 'likely', mezaparks: 'likely', purvciems: 'probably not' }[m.slug],
    buildingCount: d.buildings.length, heightSource: d.meta.stats.heightSource, buildingIds: d.buildings.map((b) => b.id),
  });
}
fs.writeFileSync(path.join(ROOT, 'tools', '.cache', 'districts-for-detail.json'), JSON.stringify(out));
console.log(out.maps.map((m) => m.slug + ':' + (m.built ? m.buildingCount : 'not built')).join(' '));
