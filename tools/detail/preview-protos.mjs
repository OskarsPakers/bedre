#!/usr/bin/env node
// Renders tools/.cache/detail/preview-<slug>.png for every analysed prototype: hillshaded top view of the mesh height
// grid | V1 grid mesh | V2 fitted parts | Track A (OSM parts / outline) if available.
//   node tools/detail/preview-protos.mjs [slug ...] [--osm]
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './i3s.mjs';
import { decodeGrid, gridToTris, partsToTris, gzipSize } from './shape.mjs';
import { fitParts, partsError } from './fit.mjs';
import * as R from './render.mjs';
import { game, ANALYSIS, PROTOTYPES } from './build-detail.mjs';

const argv = process.argv.slice(2);
const useOsm = argv.includes('--osm');
const only = argv.filter((a) => !a.startsWith('--'));
let osmIdx = null;
if (useOsm) {
  const { indexOsmByBuilding, osmPartsOf } = await import('./osm3d.mjs');
  osmIdx = { idx: await indexOsmByBuilding(game.buildings), osmPartsOf };
}
const synth = (slug) => path.join(ANALYSIS, `synth-${slug}.json`);

const rows = [];
for (const [slug, proto] of Object.entries(PROTOTYPES)) {
  if (only.length && !only.includes(slug)) continue;
  const f = fs.readdirSync(ANALYSIS).filter((n) => { try { return JSON.parse(fs.readFileSync(path.join(ANALYSIS, n))).slug === slug; } catch { return false; } })[0];
  if (!f) { console.log('no analysis for', slug); continue; }
  const rec = JSON.parse(fs.readFileSync(path.join(ANALYSIS, f)));
  const g = decodeGrid(rec.grid);
  const t0 = Date.now();
  const parts = fitParts(g, { eps: 0.8, minArea: 2 });
  const fitMs = Date.now() - t0;
  const err = partsError(g, parts);
  const v1 = gridToTris(g);
  const v2 = partsToTris(parts);
  let osmParts = null, osmTris = null;
  if (osmIdx) {
    const b = game.buildings.find((b) => b.id === rec.id);
    const rr = b && osmIdx.idx.get(b.id);
    osmParts = osmIdx.osmPartsOf(rr);
    if (osmParts) osmTris = partsToTris(osmParts, [200, 190, 175], [120, 150, 190]);
  }
  const maxH = rec.max;
  const bx = g.x0 + (g.w * g.cell) / 2, bz = g.z0 + (g.h * g.cell) / 2;
  const ext = Math.max(g.w * g.cell, g.h * g.cell, maxH * 1.15);
  const view = { yaw: 35, pitch: 40, cx: bx, cy: maxH / 3, cz: bz, scale: 360 / ext, yoff: 0.58 };
  const panel = 480;
  const panels = [];
  const hs = R.hillshade({ w: g.w, h: g.h, cells: g.cells, cell: g.cell }, Math.max(1, Math.floor(panel / Math.max(g.w, g.h))));
  panels.push(hs);
  panels.push(R.renderTris(v1, panel, 440, view));
  panels.push(R.renderTris(v2, panel, 440, view));
  if (osmTris) panels.push(R.renderTris(osmTris, panel, 440, view));
  else if (osmIdx) { const c = new R.Canvas(panel, 440); c.text('NO OSM 3D DATA', 150, 200); panels.push(c); }
  const W = panel * panels.length, H = 470;
  const cv = new R.Canvas(W, H);
  panels.forEach((p, i) => cv.blit(p, i * panel, 28));
  const v2json = JSON.stringify(parts);
  const label = `${slug.toUpperCase()}  MESH MAX ${rec.max} M P90 ${rec.p90}  GRID ${rec.grid.w}X${rec.grid.h}@${g.cell}  V1 ${gzipSize(rec.grid.data)} B GZ   V2 ${parts.length} PARTS ${gzipSize(v2json)} B GZ RMS ${err.rms.toFixed(1)} M`;
  cv.text(label, 6, 6, [230, 230, 230], 2);
  ['MESH HEIGHT GRID (HILLSHADE)', 'V1 GRID MESH', 'V2 STACKED PRISMS + ROOFS', osmIdx ? 'TRACK A: OSM PARTS' : ''].forEach((t, i) => cv.text(t, i * panel + 6, 450, [150, 200, 255], 2));
  const out = path.join(CACHE, `preview-${slug}.png`);
  R.writePng(out, cv.w, cv.h, cv.px);
  rows.push({ slug, id: rec.id, name: proto.name, max: rec.max, p90: rec.p90, grid: `${rec.grid.w}x${rec.grid.h}@${g.cell}`, v1gz: gzipSize(rec.grid.data), v2parts: parts.length, v2gz: gzipSize(v2json), v2raw: v2json.length, v2rms: +err.rms.toFixed(2), v2p95: +err.p95.toFixed(2), fitMs, osmParts: osmParts ? osmParts.length : 0 });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
