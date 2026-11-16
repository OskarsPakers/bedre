// Generates tools/detail/audit-churches.md rows: node tools/detail/audit-churches.mjs  (reads riga.json / detail grids / shapes files / heroes-churches)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cleanRing, signedArea } from '../../src/geo.js';
import { CHURCH_LIST, TREAT } from './heroes-churches.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = [];
for (const map of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const pub = path.resolve(here, '../../public/data', map === 'centrs' ? '' : map);
  const city = JSON.parse(fs.readFileSync(path.join(pub, 'riga.json'), 'utf8'));
  const det = JSON.parse(fs.readFileSync(path.join(here, 'data', map === 'centrs' ? 'riga-detail.json' : `riga-detail-${map}.json`), 'utf8'));
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(pub, 'riga-shapes.bin.gz')));
  const hl = raw.readUInt32LE(4), head = JSON.parse(raw.slice(8, 8 + hl).toString()), ST = head.stride;
  const recs = new Map(); for (let i = 0; i < head.b.length / ST; i++) recs.set(head.b[i * ST], head.b.slice(i * ST, i * ST + ST));
  const by = new Map(city.buildings.map((b) => [b.id, b]));
  for (const c of CHURCH_LIST.filter((x) => (x.map || 'centrs') === map)) for (const id of c.ids) {
    const b = by.get(id); if (!b) continue;
    const d = det.buildings[id], r = recs.get(id);
    rows.push({ map, slug: c.slug, id, name: b.n || c.name, t: b.t, area: Math.round(Math.abs(signedArea(cleanRing(b.p)))), h: b.h, hmax: d && d.hmax != null ? d.hmax : null, grid: d && d.grid && d.src !== 'synth' ? d.grid.cell : null, rec: r ? { src: r[4], style: r[12], nt: r[2] } : null, kit: !!(TREAT[c.slug] && TREAT[c.slug].kit && c.ids[0] === id), synth: !!(TREAT[c.slug] && TREAT[c.slug].kit && TREAT[c.slug].kit.synth) });
  }
}
console.log(JSON.stringify(rows, null, 1));
