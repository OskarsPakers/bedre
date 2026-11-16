// Release gate: does every sight differ from an apartment block?   node tools/detail/sights-report.mjs [--map=<slug>|all] [--list]
// Reads tools/detail/data/sights-<map>.json (tools/detail/sights.mjs), the shapes file of the map (hero styles / colours) and src/sights.js (the category treatment the game applies).
// A sight FAILS when
//   (a) it renders with facade style 0 (the apartment window grid), or
//   (b) it has no signature feature on its lead piece AND no measured non-box shape (tower / dome / vault / gable from the height grid), or
//   (c) tier A / B only: its WALL tone does not differ perceptibly (CIE76 dE < WALL_DIFF) from the area-weighted mean wall colour of its 6 nearest non-sight neighbours.
// Roof colour no longer counts (roofs are real materials only). "before" = what a shapes record alone gives (heroes / churches), "after" = record + category treatment.
// Tier A and B must have 0 failures after; tier C needs (a) and (b) only. Exit code 1 on any violation.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cleanRing, centroid } from '../../src/geo.js';
import { deltaE, WALL_DIFF, expectedWall, neighbourRef, treatmentFor } from '../../src/sights.js';
import { MAPS } from '../maps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (process.argv.find((a) => a.startsWith('--map=')) || '--map=all').slice(6);
const LIST = process.argv.includes('--list');

function loadShapes(slug) {
  const f = path.join(root, 'public/data', slug === 'centrs' ? '' : slug, 'riga-shapes.bin.gz');
  const raw = zlib.gunzipSync(fs.readFileSync(f));
  const hl = raw.readUInt32LE(4), head = JSON.parse(raw.slice(8, 8 + hl).toString()), ST = head.stride || 10;
  const recs = new Map();
  for (let i = 0; i < head.b.length / ST; i++) { const r = head.b.slice(i * ST, i * ST + ST); recs.set(r[0], { id: r[0], nt: r[2], src: r[4], hmax: r[6] / 10, eave: r[7] / 10, roofRGB: r[8], wallRGB: r[9] || 0, domeRGB: r[10] || 0, style: r[12] || 0, flags: r[13] || 0 }); }
  return recs;
}

let bad = 0;
const lines = [];
for (const m of MAPS.filter((x) => arg === 'all' || x.slug === arg)) {
  const sf = path.join(here, 'data', `sights-${m.slug}.json`);
  if (!fs.existsSync(sf)) { console.error('missing', sf, '(run tools/detail/sights.mjs)'); bad++; continue; }
  const S = JSON.parse(fs.readFileSync(sf, 'utf8'));
  const client = JSON.parse(fs.readFileSync(path.join(root, 'public/data', m.slug === 'centrs' ? '' : m.slug, 'sights.json'), 'utf8'));
  const city = JSON.parse(fs.readFileSync(path.join(root, 'public/data', m.slug === 'centrs' ? '' : m.slug, 'riga.json'), 'utf8'));
  const recs = loadShapes(m.slug);
  const B = new Map(city.buildings.map((b) => [b.id, b]));
  const tally = { A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0] }; // total, before-fail, after-fail
  const fails = [];
  const inSight = new Set(Object.keys(client.s).map(Number));
  const cen = new Map(), others = [];
  for (const b of city.buildings) {
    const c = centroid(cleanRing(b.p)); let a = 0;
    for (let i = 0; i < b.p.length; i++) { const [x0, z0] = b.p[i], [x1, z1] = b.p[(i + 1) % b.p.length]; a += x0 * z1 - x1 * z0; }
    cen.set(b.id, c);
    if (!inSight.has(b.id)) others.push({ x: c[0], z: c[1], t: b.t, area: Math.abs(a / 2) });
  }
  for (const s of S.sights) {
    const lead = B.get(s.lead); if (!lead) continue;
    const c = cen.get(s.lead), rec = recs.get(s.lead) && !(recs.get(s.lead).flags & 1) ? recs.get(s.lead) : null;
    const ce = client.s[s.lead];
    const nref = neighbourRef({ x: c[0], z: c[1] }, others, m.slug);
    const roofForm = !!rec && rec.nt >= 14 && rec.hmax - rec.eave >= 1.5; // measured pitched roof / tower / dome: not a plain box
    const strictWall = s.tier !== 'C';
    const verdict = (style, feature, wallHex) => {
      const why = [];
      if (style === 0) why.push('style0');
      if (!feature && !roofForm) why.push('plain');
      if (strictWall && !(deltaE(wallHex, nref) >= WALL_DIFF)) why.push('wall');
      return why;
    };
    const nat = expectedWall(lead.t, c[0], c[1], m.slug, 100);
    const wb = verdict(rec ? rec.style : 0, false, rec && rec.wallRGB ? rec.wallRGB : nat);
    const T = treatmentFor(ce, rec, c[0], c[1], ce[1] <= 1 ? nref : 0);
    const wa = verdict(T.style, T.feats.length > 0, T.wall != null ? T.wall : nat);
    const t = tally[s.tier];
    t[0]++; if (wb.length) t[1]++;
    if (wa.length) { t[2]++; fails.push([s, wa]); }
  }
  const tot = (i) => tally.A[i] + tally.B[i] + tally.C[i];
  lines.push(`[sights ${m.slug}] total ${tot(0)} | failing before ${tot(1)} -> after ${tot(2)} | A ${tally.A[0]}: ${tally.A[1]} -> ${tally.A[2]} | B ${tally.B[0]}: ${tally.B[1]} -> ${tally.B[2]} | C ${tally.C[0]}: ${tally.C[1]} -> ${tally.C[2]}`);
  for (const [s, w] of fails.slice(0, 25)) lines.push(`   VIOLATION tier ${s.tier} ${s.cat} ${s.name || s.lead} (${s.lead}): ${w.join(', ')}`);
  if (fails.length) bad += fails.length;
  if (LIST) {
    const wb = [];
    for (const s of S.sights) wb.push(`${s.tier} ${s.cat} ${s.name || '-'} ${s.lead}`);
    lines.push(...wb.map((x) => '   ' + x));
  }
}
for (const l of lines) console.log(l);
if (bad) { console.log(`sights-report: ${bad} violation(s)`); process.exit(1); }
console.log('sights-report: ok (tier A and B: 0 failures; tier C: non-apartment style + feature / shape)');
