#!/usr/bin/env node
// Vertical sanity check: mesh-derived heights vs known/OSM heights for notable buildings (needs `build-detail.mjs analyze`).
import fs from 'node:fs';
import path from 'node:path';
import { loadOsm, elementRings, ringCentroid } from './fetch-osm-parts.mjs';
import { ANALYSIS, game } from './build-detail.mjs';
import { pip } from './dsm.mjs';
const KNOWN = [
  ['St Peter spire', 'way', 45069779, 123, 'max'],
  ['Riga Dome tower', 'way', 45105364, 90, 'max'],
  ['Hotel Latvija (Radisson)', 'relation', 6210668, 95, 'max'],
  ['Academy of Sciences', 'way', 87570115, 107, 'max'],
  ['Powder Tower', 'way', 45018613, 37, 'max'],
  ['Nativity cathedral', 'way', 87872119, 40, 'max'],
  ['Old St Gertrude', 'way', 129820711, 65, 'max'],
  ['St Jacob cathedral', 'way', 171924063, 80, 'max'],
];
const { buildings } = await loadOsm();
const rec = (id) => { for (const f of [`${id}.json`, `${id}.c.json`]) { const p = path.join(ANALYSIS, f); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p)); } };
const rows = [];
for (const [label, type, id, known, stat] of KNOWN) {
  const el = buildings.find((e) => e.id === id && e.type === type);
  let pt;
  if (el) { const rings = elementRings(el); if (rings.length) pt = ringCentroid(rings[0]); else if (el.bounds) { const M = 111320 * Math.cos((56.9515 * Math.PI) / 180); pt = [((el.bounds.minlon + el.bounds.maxlon) / 2 - 24.1133) * M, -((el.bounds.minlat + el.bounds.maxlat) / 2 - 56.9515) * 111320]; } }
  const b = pt && game.buildings.filter((b) => pip(pt[0], pt[1], b.p)).sort((a, b) => b.h - a.h)[0];
  const r = b && rec(b.id);
  rows.push({ label, knownM: known, gameId: b?.id, rigaJsonH: b?.h, meshMax: r?.max, meshP90: r?.p90, diffMax: r ? +(r.max - known).toFixed(1) : null });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
fs.writeFileSync(path.join(path.dirname(ANALYSIS), 'validate-heights.json'), JSON.stringify(rows, null, 1));
