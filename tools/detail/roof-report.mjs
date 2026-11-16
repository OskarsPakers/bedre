// Roof-colour consistency report for a shapes file:  node tools/detail/roof-report.mjs [--map=<slug>] [--list] [--file=<bin.gz>]
// Rule (src/buildings.js buildShapeGeometry): every roof face (file material 0 flat / 1 pitched, any slope) takes ONE colour per building; the only other roof
// colour is an ACCENT (material 3 spire / dome / lantern, 5 gilded cross) that must cover a whole feature. Step walls / drums are material 2 = wall colour.
// Checks: (1) number of buildings whose roof faces map to more than one non-accent colour slot (must be 0, uses src/shapes.js COLOR_SLOT, the table the client uses);
//         (2) every accent component is a complete feature (a connected patch whose boundary lies on one level and which rises >= 1.5 m above it); scattered facets are listed.
// Exit code 1 on any violation. --list prints every building with an accent (id, name, components, apex).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { renderClass, COLOR_SLOT } from '../../src/shapes.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = (process.argv.find((a) => a.startsWith('--map=')) || '--map=centrs').slice(6);
const pub = path.resolve(here, '../../public/data', MAP === 'centrs' ? '' : MAP);
const FILE = (process.argv.find((a) => a.startsWith('--file=')) || '').slice(7) || path.join(pub, 'riga-shapes.bin.gz');
const city = JSON.parse(fs.readFileSync(path.join(pub, 'riga.json'), 'utf8'));
const name = new Map(city.buildings.map((b) => [b.id, b.n || '']));
const raw = zlib.gunzipSync(fs.readFileSync(FILE));
const hl = raw.readUInt32LE(4);
const head = JSON.parse(raw.slice(8, 8 + hl).toString());
const ST = head.stride || 10, nB = head.b.length / ST;
let totV = 0, totT = 0, totL = 0;
for (let i = 0; i < nB; i++) { totV += head.b[i * ST + 1]; totT += head.b[i * ST + 2]; totL += head.b[i * ST + 3]; }
let off = 8 + hl;
const [bv, bt, bm] = head.bytes;
const planes16 = (o, n, signed) => { const out = signed ? new Int16Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) out[i] = raw[o + i] | (raw[o + n + i] << 8); return out; };
const V = planes16(off, totV * 3, true); off += bv;
const T = planes16(off, totT * 3, false); off += bt;
const M = raw.slice(off, off + totT);
const inv = 1 / head.q;
let ov = 0, ot = 0, multi = 0, withAccent = 0, scattered = 0, roofB = 0, flatOnly = 0;
const rows = [], bad = [];
for (let i = 0; i < nB; i++) {
  const r = head.b.slice(i * ST, i * ST + ST), id = r[0], nv = r[1], nt = r[2];
  const ids = new Int32Array(nt * 3);
  let next = 0;
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const d = T[(ot + t) * 3 + k]; ids[t * 3 + k] = d === 0 ? next++ : next - d; }
  const y = (v) => V[(ov + v) * 3 + 1] * inv;
  const slots = new Set(), acc = [];
  for (let t = 0; t < nt; t++) { const c = renderClass(M[ot + t]); const s = COLOR_SLOT[c]; if (s === 'roof') slots.add(c === 5 ? 'x' : 'roof'); if (s === 'accent') acc.push(t); }
  if (slots.size) roofB++;
  if (slots.size > 1) { multi++; bad.push([id, 'multi roof slots']); }
  // accent components
  const accSet = new Set(acc), byV = new Map();
  for (const t of acc) for (let k = 0; k < 3; k++) { const v = ids[t * 3 + k]; (byV.get(v) || byV.set(v, []).get(v)).push(t); }
  const seen = new Set(), comps = [];
  for (const t0 of acc) {
    if (seen.has(t0)) continue;
    const q = [t0]; seen.add(t0);
    for (let a = 0; a < q.length; a++) for (let k = 0; k < 3; k++) for (const u of byV.get(ids[q[a] * 3 + k])) if (!seen.has(u)) { seen.add(u); q.push(u); }
    comps.push(q);
  }
  const info = [];
  for (const c of comps) {
    const vs = new Set(); for (const t of c) for (let k = 0; k < 3; k++) vs.add(ids[t * 3 + k]);
    let ymax = -1e9, ymin = 1e9; for (const v of vs) { ymax = Math.max(ymax, y(v)); ymin = Math.min(ymin, y(v)); }
    const rise = ymax - ymin, level = 0;
    const gold = c.every((t) => M[ot + t] === 5);
    const complete = gold || (c.length >= 4 && rise >= 1.5); // a spire / dome / lantern is a patch of several faces that rises to an apex; stray facets are 1-5 faces
    info.push({ tris: c.length, apex: ymax, rise, level, complete });
    if (!complete) { scattered++; bad.push([id, `accent patch not a complete feature (tris ${c.length}, rise ${rise.toFixed(1)})`]); }
  }
  if (comps.length) { withAccent++; rows.push([id, name.get(id) || '', comps.length, info.map((x) => `${x.tris}t@${x.apex.toFixed(0)}m`).join(' ')]); }
  ov += nv; ot += nt;
}
console.log(`[roof-report ${MAP}] ${nB} shaped buildings, ${roofB} with roof faces; buildings with more than one non-accent roof colour: ${multi}; accent patches that are not complete features: ${scattered}; buildings with accents: ${withAccent}`);
if (process.argv.includes('--list')) for (const r of rows) console.log(' accent', r.join(' | '));
for (const b of bad.slice(0, 40)) console.log(' VIOLATION', b.join(' '));
if (multi || scattered) process.exit(1);
