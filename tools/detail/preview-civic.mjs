// Fast software preview of curated-civic builders (no game needed):
//   node tools/detail/preview-civic.mjs <builder>[:<hostId>],<builder>... [--yaw=30 --pitch=35 --scale=6 --out=/tmp/civic/p.png --cx= --cz=]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTris, writePng } from './render.mjs';
import { CURATED_CIVIC } from './curated-civic.mjs';
import { cleanRing } from '../../src/geo.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv.slice(2);
const opt = (k, d) => (arg.find((s) => s.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const MAP = opt('map', 'centrs');
const city = JSON.parse(fs.readFileSync(path.resolve(here, '../../public/data', MAP === 'centrs' ? '' : MAP, 'riga.json'), 'utf8'));
const COL = { 0: [150, 156, 158], 1: [168, 92, 70], 2: [214, 205, 188], 3: [100, 150, 130], 5: [240, 236, 215], 6: [230, 226, 214], 7: [90, 140, 190], 8: [40, 40, 44] };
const tris = [];
let cx = 0, cz = 0, n = 0, hm = 0;
for (const spec of arg.filter((a) => !a.startsWith('--'))[0].split(',')) {
  const [name, host] = spec.split(':');
  const b = host ? city.buildings.find((q) => q.id === +host) : null;
  const ring = b ? cleanRing(b.p) : [[0, 0]];
  const res = CURATED_CIVIC[name]({}, { ring, key: host });
  hm = Math.max(hm, res.hmax);
  console.log(name, 'verts', res.verts.length, 'tris', res.tris.length, 'hmax', res.hmax.toFixed(1), 'area', Math.round(res.area), 'vol', Math.round(res.vol));
  for (const [a, bb, c, m] of res.tris) { tris.push({ a: res.verts[a], b: res.verts[bb], c: res.verts[c], col: COL[m] || [200, 100, 200] }); }
  for (const v of res.verts) { cx += v[0]; cz += v[2]; n++; }
}
cx = +opt('cx', cx / n); cz = +opt('cz', cz / n);
const cv = renderTris(tris, +opt('w', 1400), +opt('h', 900), { yaw: +opt('yaw', 30), pitch: +opt('pitch', 38), cx, cy: 8, cz, scale: +opt('scale', 6), yoff: 0.6 });
const out = opt('out', '/tmp/civic/p.png');
writePng(out, cv.w, cv.h, cv.px);
console.log('wrote', out);
