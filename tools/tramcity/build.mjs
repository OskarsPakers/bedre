#!/usr/bin/env node
// Builds the tram game's own city data (public/data/tram/**): DERIVED PARAMETERS only (numbers, no pixels).
//   look-centrs.json.gz     per building: sampled wall / roof colour, roof class, facade rhythm (from tools/sampling/data/params-look.json)
//   corridor-<map>.json.gz  ids of the buildings within CORRIDOR m of any track of any route on that map (they get the full treatment)
// The hole game never loads these files.   node tools/tramcity/build.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'public/data/tram');
const CORRIDOR = 60;
fs.mkdirSync(OUT, { recursive: true });
const hex = (c) => (c ? (c[0] << 16) | (c[1] << 8) | c[2] : -1);
const gz = (name, obj) => { const b = zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 }); fs.writeFileSync(path.join(OUT, name), b); console.log(name, b.length, 'B gz'); };

// 1. look (centre only)
const P = JSON.parse(fs.readFileSync(path.join(root, 'tools/sampling/data/params-look.json'), 'utf8'));
const r2 = (v, k = 100) => Math.round(v * k) / k;
const rows = P.buildings.map((b) => [b.id, hex(b.w), hex(b.r), b.rc ?? -1, b.nF ?? 0, r2(b.fh ?? 0), r2(b.sp ?? 0), r2(b.ww ?? 0), r2(b.wh ?? 0), r2(b.wy ?? 0), r2(b.gh ?? 0, 10), b.gk ?? 0, r2(b.gs ?? 0), r2(b.co ?? 0, 10), b.sc ?? 0, b.pil ?? 0, hex(b.trim)]);
gz('look-centrs.json.gz', { v: 1, cols: 'id wall roof rc nF fh sp ww wh wy gh gk gs co sc pil trim', rows });

// 2. corridors
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)); return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
const routes = fs.readdirSync(path.join(root, 'src/proto/tram/routes')).map((f) => JSON.parse(fs.readFileSync(path.join(root, 'src/proto/tram/routes', f), 'utf8')));
for (const map of ['centrs', 'mezaparks']) {
  const d = JSON.parse(fs.readFileSync(path.join(root, map === 'centrs' ? 'public/data/riga.json' : `public/data/${map}/riga.json`), 'utf8'));
  const paths = [];
  for (const r of routes) if (r.map === map) { paths.push(r.path); for (const a of r.ai || []) paths.push(a.path); }
  const ids = [];
  for (const b of d.buildings) {
    const ring = b.p; let best = Infinity;
    for (const pth of paths) for (let i = 0; i + 1 < pth.length && best > CORRIDOR; i++) {
      for (let k = 0; k < ring.length; k++) { best = Math.min(best, segD(ring[k][0], ring[k][1], pth[i][0], pth[i][1], pth[i + 1][0], pth[i + 1][1])); if (best <= CORRIDOR) break; }
    }
    if (best <= CORRIDOR) ids.push(b.id);
  }
  console.log(map, 'corridor buildings', ids.length, 'of', d.buildings.length);
  gz(`corridor-${map}.json.gz`, { corridor: CORRIDOR, ids });
}
