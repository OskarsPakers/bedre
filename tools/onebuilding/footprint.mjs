import fs from 'node:fs'; import { toLocal } from './lib.mjs';
const d = JSON.parse(fs.readFileSync('tools/.cache/osm_buildings_v2.json'));
const e = d.elements.find(e => e.id === 87180030);
const pts = e.geometry.map(g => toLocal(g.lon, g.lat));
console.log(JSON.stringify(pts.map(p => [+p.x.toFixed(2), +p.z.toFixed(2)])));
