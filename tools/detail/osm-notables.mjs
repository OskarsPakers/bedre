#!/usr/bin/env node
// Track A: what does OSM know about ~30 notable buildings? Matches by OSM name (lv/en) and reports the 3D tags +
// number of building:part elements inside the outline. Output: table on stdout + tools/.cache/detail/osm-notables.json
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './i3s.mjs';
import { loadOsm, elementRings, ringCentroid, pip } from './fetch-osm-parts.mjs';

const LIST = [
  ['Latvijas Nacionālais mākslas muzejs', /Nacionālais Mākslas muzejs|National Museum of Art/i],
  ['Kristus Piedzimšanas pareizticīgo katedrāle', /Kristus Piedzimšanas/i],
  ['Vecā Sv. Ģertrūdes baznīca', /Vecā Ģertrūdes/i],
  ['Jaunā Sv. Ģertrūdes baznīca', /Jaunā.*Ģertrūd|New St.? Gertrude/i],
  ['Sv. Pētera baznīca', /^Svētā Pētera baznīca/i],
  ['Rīgas Doms', /Rīgas Doms/i],
  ['Sv. Jēkaba katedrāle', /Svētā Jēkaba katedrāle/i],
  ['Sv. Jāņa baznīca', /^Svētā Jāņa baznīca/i],
  ['Anglikāņu baznīca', /Anglikāņu baznīca/i],
  ['Sv. Aleksandra Ņevska baznīca', /Aleksandra Ņevska/i],
  ['Latvijas Nacionālā opera', /Nacionālā opera/i],
  ['Rīgas pils', /Rīgas Pils/i],
  ['Pulvertornis', /Pulvertornis/i],
  ['Melngalvju nams', /Melngalvju nams/i],
  ['Rātsnams', /Rīgas Rātsnams/i],
  ['Kaķu nams', /Kaķu nams/i],
  ['Lielā ģilde', /Lielā Ģilde/i],
  ['Mazā ģilde', /Mazā Ģilde/i],
  ['Latvijas Universitāte (galvenā ēka)', /^Latvijas Universitāte( \||$)/i],
  ['Nacionālais teātris', /Latvijas Nacionālais teātris/i],
  ['Dailes teātris', /Dailes teātris/i],
  ['Centrālā stacija', /Rīgas Centrālā stacija/i],
  ['Zinātņu akadēmija', /Zinātņu akadēmija/i],
  ['Radisson Blu Hotel Latvija', /Hotel Latvija/i],
  ['Saeima', /^Saeima( \||$)/i],
  ['Kongresu nams', /Kongresu nams/i],
  ['Splendid Palace', /Splendid Palace/i],
  ['Origo One', /Origo One/i],
  ['Latvijas Kara muzejs', /kara muzejs/i],
  ['Latvijas Mākslas akadēmija', /^Latvijas Mākslas akadēmija( \||$)/i],
  ['Rīgas Birža (mākslas muzejs)', /Rīgas Birža/i],
  ['Latvijas Okupācijas muzejs', /Okupācijas muzejs/i],
];
const { parts, buildings } = await loadOsm();
const partInfo = parts.map((p) => ({ p, rings: elementRings(p) }));
const rows = [];
for (const [label, re] of LIST) {
  const hits = buildings.filter((e) => e.tags && re.test([e.tags.name, e.tags['name:en']].filter(Boolean).join(' | ')));
  if (!hits.length) { rows.push({ label, found: false }); continue; }
  for (const e of hits.slice(0, 2)) {
    const rings = elementRings(e);
    const t = e.tags;
    const inside = rings.length ? partInfo.filter((pi) => pi.rings.some((r) => { const [cx, cz] = ringCentroid(r); return rings.some((R) => pip(cx, cz, R)); })) : [];
    const shapes = {};
    for (const pi of inside) { const s = pi.p.tags['roof:shape'] || '(none)'; shapes[s] = (shapes[s] || 0) + 1; }
    rows.push({
      label, found: true, osm: `${e.type}/${e.id}`, name: t.name, building: t.building, height: t.height, levels: t['building:levels'], roofShape: t['roof:shape'], roofHeight: t['roof:height'],
      parts: inside.length, partRoofShapes: shapes, partsWithHeight: inside.filter((pi) => pi.p.tags.height || pi.p.tags['building:levels']).length,
      anyRoofColour: !!(t['roof:colour'] || inside.some((pi) => pi.p.tags['roof:colour'])),
    });
  }
}
for (const r of rows) {
  if (!r.found) { console.log(`${r.label.padEnd(44)} NOT FOUND in OSM by name`); continue; }
  console.log(`${r.label.padEnd(44)} ${r.osm.padEnd(18)} bld=${r.building} h=${r.height ?? '-'} lv=${r.levels ?? '-'} roof=${r.roofShape ?? '-'} rh=${r.roofHeight ?? '-'}  parts=${r.parts} ${JSON.stringify(r.partRoofShapes)}`);
}
fs.writeFileSync(path.join(CACHE, 'osm-notables.json'), JSON.stringify(rows, null, 1));
