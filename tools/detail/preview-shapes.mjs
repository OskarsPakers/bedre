// Software-rendered previews straight from public/data/riga-shapes.bin.gz (what the game loads), no browser needed.
//   node preview-shapes.mjs <slug|id> [...] [--out=dir]     -> tools/.cache/detail/shape-<name>.png  (two views per building: 35 and 215 degrees)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as R from './render.mjs';
import { HEROES, BLOCK_IDS } from './heroes.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SHAPES || path.resolve(here, '../../public/data/riga-shapes.bin.gz');
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || path.resolve(here, '../.cache/detail');
const city = JSON.parse(fs.readFileSync(path.resolve(here, '../../public/data/riga.json'), 'utf8'));
const byId = new Map(city.buildings.map((b) => [b.id, b]));
const raw = zlib.gunzipSync(fs.readFileSync(FILE));
const hl = raw.readUInt32LE(4);
const head = JSON.parse(raw.slice(8, 8 + hl).toString());
const STRIDE = head.stride || 10;
let off = 8 + hl;
const [bv, bt, bm, bl] = head.bytes;
const nB = head.b.length / STRIDE;
let totV = 0, totT = 0, totL = 0;
for (let i = 0; i < nB; i++) { totV += head.b[i * STRIDE + 1]; totT += head.b[i * STRIDE + 2]; totL += head.b[i * STRIDE + 3]; }
const planes16 = (o, n, signed) => { const out = signed ? new Int16Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) out[i] = raw[o + i] | (raw[o + n + i] << 8); return out; };
const V = planes16(off, totV * 3, true); off += bv;
const T = planes16(off, totT * 3, false); off += bt;
const M = raw.slice(off, off + totT); off += bm;
const L = planes16(off, totL, true);
const recs = new Map();
{ let ov = 0, ot = 0, ol = 0; for (let i = 0; i < nB; i++) { const r = head.b.slice(i * STRIDE, i * STRIDE + STRIDE); recs.set(r[0], { id: r[0], nv: r[1], nt: r[2], nl: r[3], src: r[4], r, ov, ot, ol }); ov += r[1]; ot += r[2]; ol += r[3]; } }
const inv = 1 / head.q;
const COL = { 0: [112, 112, 116], 1: [180, 90, 62], 2: [214, 200, 175], 3: [95, 157, 137], 4: [205, 195, 170], 5: [227, 178, 58], 6: [60, 64, 70] };
const hex = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

function trisOf(rec, cx, cz) {
  const px = (i) => V[rec.ov * 3 + i * 3] * inv + cx, py = (i) => V[rec.ov * 3 + i * 3 + 1] * inv, pz = (i) => V[rec.ov * 3 + i * 3 + 2] * inv + cz;
  const tris = [];
  const r = rec.r;
  const cols = { ...COL };
  if (STRIDE >= 14) { if (r[8]) cols[1] = hex(r[8]); if (r[9]) { cols[2] = hex(r[9]); cols[4] = hex(r[9]); } if (r[10]) cols[3] = hex(r[10]); if (r[11]) cols[5] = hex(r[11]); }
  let next = 0;
  for (let t = 0; t < rec.nt; t++) {
    const ids = [];
    for (let k = 0; k < 3; k++) { const d = T[(rec.ot + t) * 3 + k]; ids.push(d === 0 ? next++ : next - d); }
    tris.push({ a: [px(ids[0]), py(ids[0]), pz(ids[0])], b: [px(ids[1]), py(ids[1]), pz(ids[1])], c: [px(ids[2]), py(ids[2]), pz(ids[2])], col: cols[M[rec.ot + t]] || [200, 0, 200] });
  }
  let p = rec.ol; const end = rec.ol + rec.nl;
  while (p < end) {
    const len = L[p], y0 = L[p + 1] * inv; p += 3;
    for (let i = 0; i < len; i++) {
      const A = L[p + i], B = L[p + ((i + 1) % len)];
      const a0 = [px(A), y0, pz(A)], b0 = [px(B), y0, pz(B)], a1 = [px(A), py(A), pz(A)], b1 = [px(B), py(B), pz(B)];
      const wc = cols[2];
      tris.push({ a: a0, b: b0, c: b1, col: wc }, { a: a0, b: b1, c: a1, col: wc });
    }
    p += len;
  }
  return tris;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const jobs = [];
for (const a of args) {
  if (a === 'blocks') BLOCK_IDS.forEach((id, i) => jobs.push([`block-${i + 1}`, [id]]));
  else if (a === 'heroes') for (const h of HEROES) jobs.push([h.slug, h.ids]);
  else { const h = HEROES.find((x) => x.slug === a); jobs.push(h ? [h.slug, h.ids] : [String(a), [+a]]); }
}
for (const [name, ids] of jobs) {
  let tris = [], x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, hmax = 0;
  for (const id of ids) {
    const b = byId.get(id), rec = recs.get(id);
    if (!b || !rec) { console.log('no shape for', id); continue; }
    let sx = 0, sz = 0; // centroid used by the builder (area-weighted polygon centroid); recompute like cleanRing/centroid
    let a = 0;
    const p = b.p;
    for (let i = 0; i < p.length; i++) { const [xa, za] = p[i], [xb, zb] = p[(i + 1) % p.length]; const c = xa * zb - xb * za; a += c; sx += (xa + xb) * c; sz += (za + zb) * c; }
    const cx = sx / (3 * a), cz = sz / (3 * a);
    tris = tris.concat(trisOf(rec, cx, cz));
    for (const t of tris) for (const q of [t.a, t.b, t.c]) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); hmax = Math.max(hmax, q[1]); }
  }
  if (!tris.length) continue;
  const ext = Math.max(x1 - x0, z1 - z0, hmax * 1.2);
  const cv = new R.Canvas(1500, 560);
  [35, 215].forEach((yaw, i) => {
    const view = { yaw, pitch: +(process.env.PITCH || 38), cx: (x0 + x1) / 2, cy: hmax / 3, cz: (z0 + z1) / 2, scale: 470 / ext, yoff: 0.6 };
    cv.blit(R.renderTris(tris, 740, 540, view), i * 750 + 5, 10);
  });
  cv.text(`${name} ${tris.length} TRIS`, 8, 8, [255, 255, 255], 2);
  const f = path.join(OUT, `shape-${name}.png`);
  R.writePng(f, cv.w, cv.h, cv.px);
  console.log('wrote', f, tris.length);
}
