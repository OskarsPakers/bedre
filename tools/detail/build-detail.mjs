#!/usr/bin/env node
// Builds tools/detail/data/riga-detail.json from the I3S reality mesh (used only as a measuring instrument).
//
//   node tools/detail/build-detail.mjs analyze [--set=proto|notable|all] [--limit=N]
//        footprint -> height grid for each selected building (cached in tools/.cache/detail/analysis/<id>.json)
//   node tools/detail/build-detail.mjs assemble [--variant=grid|parts|both] [--out=tools/detail/data/riga-detail.json]
//        analysis cache (+ OSM parts for roof info) -> riga-detail.json
//
// Resolution: "fine" (notable buildings) = 0.5 m cells from mesh nodes with <= ~0.4 m vertex spacing;
//             "coarse" (all other buildings) = 1 m cells from nodes with <= ~1 m spacing.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE, openLayers, localToMerc, netStats } from './i3s.mjs';
import { buildDsm, footprintGrid, heightAbove, heightStats, bboxOf, pip, quant } from './dsm.mjs';
import { encodeGrid, decodeGrid, gzipSize, rle as rleBytes } from './shape.mjs';
import { fitParts, partsError } from './fit.mjs';
import { HEROES } from './heroes.mjs';

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; }));
const cmd = process.argv[2] || 'analyze';
const ANALYSIS = path.join(CACHE, 'analysis');
fs.mkdirSync(ANALYSIS, { recursive: true });
export const MAP = args.map || 'centrs'; // --map=<slug>: any map of tools/maps.mjs (a district is another bounds rectangle in the shared projection)
const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', MAP === 'centrs' ? '' : MAP, 'riga.json'), 'utf8'));

export const PROTOTYPES = {
  stpeter: { pt: [-242.7, 444.2], name: 'Sv. Pētera baznīca' },
  dome: { pt: [-517.7, 267.7], name: 'Rīgas Doms' },
  powder: { pt: [-280.6, 31.1], name: 'Pulvertornis' },
  nativity: { pt: [136.7, -271.6], name: 'Kristus Piedzimšanas pareizticīgo katedrāle' },
  oldgertrude: { pt: [506.6, -719.9], name: 'Vecā Ģertrūdes baznīca' },
  newgertrude: { bid: 49622206, name: 'Jaunā Ģertrūdes baznīca (Lāčplēša iela 37; matched by position/OSM unnamed church)' },
  artmuseum: { osm: 87971760, name: 'Latvijas Nacionālais mākslas muzejs' },
  opera: { osm: 87180030, name: 'Latvijas Nacionālā opera un balets' },
  freedom: { synth: [-2.25, 4.25, 6], name: 'Brīvības piemineklis (synthetic octagon footprint, no cadastre building)' },
  nouveau: { bid: 49618813, name: 'Alberta iela 13 (Art Nouveau)' },
  oldtown: { osm: 87495471, name: 'Melngalvju nams (Old Town)' },
  catshouse: { osm: 1307300, name: 'Kaķu nams (Old Town)' },
};

function osmCentroidById(id) {
  const f = path.join(CACHE, 'osm_buildings_full.json');
  const el = JSON.parse(fs.readFileSync(f, 'utf8')).elements.find((e) => e.id === id);
  const M_LON = 111320 * Math.cos((56.9515 * Math.PI) / 180);
  if (!el.geometry && el.bounds) { const b = el.bounds; return [((b.minlon + b.maxlon) / 2 - 24.1133) * M_LON, -((b.minlat + b.maxlat) / 2 - 56.9515) * 111320]; }
  const pts = el.geometry;
  return [pts.reduce((s, p) => s + (p.lon - 24.1133) * M_LON, 0) / pts.length, pts.reduce((s, p) => s - (p.lat - 56.9515) * 111320, 0) / pts.length];
}

function loadNamedOsm() {
  const f = path.join(CACHE, 'osm_buildings_full.json');
  const src = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).elements : JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '.cache', 'osm_buildings.json'), 'utf8')).elements;
  return src.filter((e) => e.tags?.name && e.geometry);
}
export function notableSet() {
  const ids = new Map(); // id -> reason
  const add = (id, why) => { if (!ids.has(id)) ids.set(id, why); };
  for (const b of game.buildings) {
    if (b.t === 'rel') add(b.id, 'rel');
    else if (b.t === 'pub') add(b.id, 'pub');
    if (b.h >= 25) add(b.id, 'h>=25');
  }
  for (const l of game.landmarks) {
    const c = game.buildings.filter((b) => pip(l.x, l.z, b.p));
    for (const b of c) add(b.id, 'landmark:' + l.n);
  }
  // buildings added by the map extension (outside the original +-1200 m box): named / big public ones are notable too
  for (const b of game.buildings) {
    if (MAP === 'centrs' && Math.abs(b.p[0][0]) <= 1200 && Math.abs(b.p[0][1]) <= 1200) continue;
    if (b.n && !/\s\d+[A-Za-zĀ-ž]?(\s|$|\/)/.test(b.n) && b.t !== 'aux' && b.h >= 12) add(b.id, 'named-ext');
    else if (b.h >= 40) add(b.id, 'h>=40-ext');
  }
  for (const h of HEROES) for (const id of h.ids) add(id, 'hero'); // curated landmarks are always measured at 0.5 m
  const R = { x: 24.1133, lat: 56.9515 };
  const M_LON = 111320 * Math.cos((R.lat * Math.PI) / 180);
  for (const e of loadNamedOsm()) {
    const g = e.geometry;
    const cx = g.reduce((s, p) => s + (p.lon - R.x) * M_LON, 0) / g.length;
    const cz = g.reduce((s, p) => s - (p.lat - R.lat) * 111320, 0) / g.length;
    for (const b of game.buildings) { if (b.t !== 'aux' && pip(cx, cz, b.p)) { add(b.id, 'osmname:' + e.tags.name); break; } }
  }
  return ids;
}

function selectBuildings() {
  const set = args.set || 'proto';
  if (set === 'proto') {
    const out = [];
    for (const [slug, p] of Object.entries(PROTOTYPES)) {
      if (p.synth) {
        const [cx, cz, r] = p.synth;
        const ring = Array.from({ length: 8 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 4 + Math.PI / 8), cz + r * Math.sin((i * Math.PI) / 4 + Math.PI / 8)]);
        out.push({ b: { id: 'synth-' + slug, p: ring, h: 42, t: 'pub' }, slug, fine: true });
        continue;
      }
      if (p.bid) { out.push({ b: game.buildings.find((b) => b.id === p.bid), slug, fine: true }); continue; }
      const pt = p.pt || osmCentroidById(p.osm);
      const cands = game.buildings.filter((b) => pip(pt[0], pt[1], b.p)).sort((a, b) => b.h - a.h);
      if (cands[0]) out.push({ b: cands[0], slug, fine: true });
      else console.log('prototype not found', slug);
    }
    return out;
  }
  if (set === 'notable') { const n = notableSet(); return game.buildings.filter((b) => n.has(b.id)).map((b) => ({ b, fine: true })); }
  const n = notableSet();
  return game.buildings.map((b) => ({ b, fine: n.has(b.id) }));
}

async function analyze() {
  let sel = selectBuildings();
  if (args.limit) sel = sel.slice(0, Number(args.limit));
  const todo = sel.filter((s) => !fs.existsSync(path.join(ANALYSIS, `${s.b.id}${s.fine ? '' : '.c'}.json`)));
  console.log(`selected ${sel.length}, to analyse ${todo.length}`);
  const bd = game.meta.bounds || { minX: -1200, maxX: 1200, minZ: -1200, maxZ: 1200 };
  const [a, c] = [localToMerc(bd.minX - 100, bd.maxZ + 100), localToMerc(bd.maxX + 100, bd.minZ - 100)];
  const layers = (await openLayers([a[0], a[1], c[0], c[1]])).filter((l) => !/^Pazeme/i.test(l.name));
  console.log('layers:', layers.map((l) => l.name).join(', '));
  const t0 = Date.now();
  // group into 250 m tiles per resolution class so that nodes are reused in memory-like fashion (disk cache anyway)
  for (const fine of [true, false]) {
    const list = todo.filter((s) => s.fine === fine);
    const tiles = new Map();
    for (const s of list) {
      const bb = bboxOf(s.b.p);
      const key = fine ? `f${s.b.id}` : `${Math.floor((bb.minX + bb.maxX) / 2 / 250)},${Math.floor((bb.minZ + bb.maxZ) / 2 / 250)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(s);
    }
    let done = 0;
    for (const [, items] of tiles) {
      // fine buildings: one DSM per building; coarse: one DSM per tile
      const bbs = items.map((s) => bboxOf(s.b.p));
      const box = {
        minX: Math.min(...bbs.map((b) => b.minX)) - 8, maxX: Math.max(...bbs.map((b) => b.maxX)) + 8,
        minZ: Math.min(...bbs.map((b) => b.minZ)) - 8, maxZ: Math.max(...bbs.map((b) => b.maxZ)) + 8,
      };
      const cell = fine ? 0.5 : 1.0, spacing = fine ? 0.55 : 1.0;
      let r;
      try { r = await buildDsm(layers, box, cell, spacing); } catch (e) { console.log('DSM failed', items[0].b.id, e.message); continue; }
      for (const s of items) {
        const fg = footprintGrid(r.raster, s.b.p);
        const rec = { id: s.b.id, fine, cell, slug: s.slug, layers: r.info.map((i) => i.layer) };
        if (Number.isNaN(fg.ground)) {
          rec.ok = false;
        } else {
          const hab = heightAbove(fg);
          const st = heightStats(fg);
          Object.assign(rec, { ok: st.cover > 0.2, ground: round(fg.ground, 2), ringN: fg.ringN, max: round(st.max, 1), p90: round(st.p90, 1), p50: round(st.p50, 1), p98: round(st.p98, 1), p10: round(st.p10, 1), cover: round(st.cover, 3) });
          const g = encodeGrid(fg, hab, 0.5);
          delete g._raw;
          rec.grid = g;
        }
        fs.writeFileSync(path.join(ANALYSIS, `${s.b.id}${fine ? '' : '.c'}.json`), JSON.stringify(rec));
        done++;
      }
      if (done % 20 < items.length) console.log(`${fine ? 'fine' : 'coarse'} ${done}/${list.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s  net ${(netStats.bytesWire / 1e6).toFixed(0)} MB wire / ${netStats.requests} req`);
    }
  }
  console.log('done in', ((Date.now() - t0) / 1000).toFixed(0), 's', JSON.stringify(netStats));
}
const round = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);


// ---------------------------------------------------------------- assemble
const LICENSE = {
  note: 'Recorded verbatim from the public ArcGIS Online metadata; not a legal conclusion. The mesh is used only as a measuring instrument (heights/shapes); no mesh or texture is shipped.',
  webScene: { itemId: '0f550060386a435da391357ccf89d269', title: 'Vecpilsetas_un_apbuves_aizsardzibas_teritoriju_REALITATES_MODELIS', owner: 'GeoRiga', snippet: 'Rīgas realitātes modelis apbūves aizsardzības teritorijām (pilsētbūvnieciskajiem ansambļiem)', accessInformation: 'Rīgas valstspilsētas pašvaldība', licenseInfo: '', description: '' },
  sceneServiceItems: [
    { example: 'region_4_11122023_WGS / BOLDEREJA_WGS_WEB_MERC / aldara_parks_WGS', accessInformation: 'Rīgas valstspilsētas pašvaldība', licenseInfo: '' },
    { example: 'vecriga_lod_rebuilt_wgs (item owner janis.akmentins_RPP)', accessInformation: 'Generated with Agisoft Metashape', licenseInfo: null, description: '' },
  ],
  layerCopyrightText: { 'vecriga_lod_rebuilt_wgs, region_3_wgs, Region_1_11122023_wgs, region_4_11122023_WGS and the other Metashape layers': 'Generated with Agisoft Metashape', centraltirgus_wgs: 'description: "This layer contains a reality mesh created with Bentley ContextCapture."; copyrightText: (none)' },
  otherLgiaItemsInSameOrg: '© Latvijas Ģeotelpiskās informācijas aģentūra, 2021 (accessInformation of the LGIA 3D Mesh / LGIA_EKAS_LOD2 items, not used here)',
  osm: 'Contains data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright',
};

function loadAnalysis() {
  const fine = new Map(), coarse = new Map();
  for (const f of fs.readdirSync(ANALYSIS)) {
    const rec = JSON.parse(fs.readFileSync(path.join(ANALYSIS, f), 'utf8'));
    (f.endsWith('.c.json') ? coarse : fine).set(rec.id, rec);
  }
  return { fine, coarse };
}
const mb = (n) => (n / 1e6).toFixed(2) + ' MB';

/** re-quantise an encoded grid to a coarser height step (smaller after RLE + gzip) */
function requant(g, scale) {
  if (scale === g.scale) return g;
  const d = decodeGrid(g);
  const bytes = new Uint8Array(g.w * g.h);
  for (let k = 0; k < bytes.length; k++) { const v = d.cells[k]; if (!Number.isNaN(v)) bytes[k] = Math.min(255, Math.round(v / scale) + 1); }
  return { x0: g.x0, z0: g.z0, cell: g.cell, w: g.w, h: g.h, scale, data: Buffer.from(rleBytes(bytes)).toString('base64') };
}
async function assemble() {
  const { fine, coarse } = loadAnalysis();
  const notable = notableSet();
  const heights = {}, heightsP50 = {}, outB = {};
  const diffs = [], diffsByT = {};
  let withMesh = 0, noMesh = 0, lowCover = 0;
  const fitStats = [];
  for (const b of game.buildings) {
    const rec = fine.get(b.id) || coarse.get(b.id);
    if (!rec || !rec.ok) { noMesh++; continue; }
    if (rec.cover < 0.5) { lowCover++; continue; }
    withMesh++;
    heights[b.id] = rec.p90;
    heightsP50[b.id] = rec.p50;
    const d = rec.p90 - b.h;
    diffs.push(d);
    (diffsByT[b.t] = diffsByT[b.t] || []).push(d);
  }
  const grids = {}, parts = {};
  for (const b of game.buildings) {
    const rec = fine.get(b.id);
    if (!notable.has(b.id) || !rec || !rec.ok || rec.cover < 0.5) continue;
    const g = decodeGrid(rec.grid);
    const ps = fitParts(g, { eps: Number(args.eps || 0.8), minArea: 2 });
    const err = partsError(g, ps);
    fitStats.push({ id: b.id, parts: ps.length, rms: err.rms });
    parts[b.id] = ps;
    grids[b.id] = rec.grid;
    outB[b.id] = { src: 'mesh', ground: rec.ground, hmax: rec.max, h: rec.p90, ...(notable.get ? {} : {}) };
  }
  // coarse (1 m) grids for every other building, only where the roof has relief (p90 - p10 > 2 m); flat-roofed boxes need `heights` only
  const coarseGrids = {};
  let coarseFlat = 0;
  for (const b of game.buildings) {
    const rec = coarse.get(b.id);
    if (!rec || !rec.ok || rec.cover < 0.5 || outB[b.id]) continue;
    if (rec.p90 - rec.p10 <= Number(args.relief || 3.5)) { coarseFlat++; continue; }
    coarseGrids[b.id] = { ground: rec.ground, hmax: rec.max, h: rec.p90, grid: requant(rec.grid, Number(args.coarseScale || 1.0)) };
  }
  const q = (arr, p) => quant(arr, p);
  const stats = (arr) => ({ n: arr.length, mean: +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2), p05: q(arr, 0.05), p25: q(arr, 0.25), p50: q(arr, 0.5), p75: q(arr, 0.75), p95: q(arr, 0.95), absP50: q(arr.map(Math.abs), 0.5), absP90: q(arr.map(Math.abs), 0.9), within2m: +(arr.filter((v) => Math.abs(v) <= 2).length / arr.length).toFixed(3), within4m: +(arr.filter((v) => Math.abs(v) <= 4).length / arr.length).toFixed(3) });
  const heightReport = { all: stats(diffs), byType: Object.fromEntries(Object.entries(diffsByT).map(([k, v]) => [k, stats(v)])), mesh_p90_minus_riga_h: true };

  // variant sizes
  const mk = (o) => JSON.stringify(o);
  const sizes = {};
  const heightsJson = mk(heights);
  const A = {}, B = {};
  for (const id of Object.keys(grids)) { A[id] = { src: 'mesh', ground: outB[id].ground, h: outB[id].h, grid: grids[id] }; B[id] = { src: 'mesh', ground: outB[id].ground, h: outB[id].h, parts: parts[id] }; }
  sizes.heightsOnly = { raw: heightsJson.length, gz: gzipSize(heightsJson) };
  sizes.notableGrid05m = { n: Object.keys(A).length, raw: mk(A).length, gz: gzipSize(mk(A)) };
  sizes.notablePartsV2 = { n: Object.keys(B).length, raw: mk(B).length, gz: gzipSize(mk(B)) };
  sizes.allOtherGrid1m_reliefOnly = { n: Object.keys(coarseGrids).length, raw: mk(coarseGrids).length, gz: gzipSize(mk(coarseGrids)) };
  const avgParts = Object.values(parts).reduce((s, p) => s + p.length, 0) / Math.max(1, Object.keys(parts).length);
  const rmsAll = fitStats.map((f) => f.rms);

  // OSM fallback parts for buildings without usable mesh coverage (only if the OSM cache is complete)
  const osmFallback = {}, osmParts = {};
  try {
    const { indexOsmByBuilding, osmPartsOf } = await import('./osm3d.mjs');
    const idx = await indexOsmByBuilding(game.buildings);
    for (const b of game.buildings) {
      const rec = idx.get(b.id);
      if (heights[b.id] == null) { const ps = osmPartsOf(rec); if (ps) osmFallback[b.id] = { src: 'osm', parts: ps }; }
      if (rec && rec.parts.length >= 2) osmParts[b.id] = rec.parts; // genuine Simple-3D-Buildings tagging (>= 2 building:part)
    }
  } catch (e) { console.log('osm fallback skipped:', e.message); }

  const variant = args.variant || 'hybrid';
  const out = {
    meta: {
      name: 'riga-detail', version: 1, generated: new Date().toISOString(),
      coords: 'same as riga.json: x metres east / z metres south of origin (lat 56.9515, lon 24.1133), equirectangular; y = metres above local ground',
      origin: game.meta.origin,
      sources: ['Riga reality mesh (ArcGIS I3S integrated mesh layers, Agisoft Metashape / Bentley ContextCapture) - measured only, not redistributed', 'OpenStreetMap contributors (ODbL) - building:part roof info as fallback', 'Riga city cadastre footprints via riga.json'],
      license: LICENSE,
      schema: {
        heights: '{ "<id>": metres } robust main-body height (90th percentile of mesh height above ground inside the footprint) for every building with mesh coverage >= 50 %',
        'buildings["<id>"].src': '"mesh" (height grid measured from the reality mesh) | "osm" (parts from OSM Simple-3D tags, only where there is no mesh)',
        'buildings["<id>"].ground': 'ground elevation (m a.s.l., mesh datum) estimated from the ring 1..4.5 m outside the footprint; informational',
        'buildings["<id>"].h': '= heights[id]; hmax = absolute max (spire tips etc.)',
        'buildings["<id>"].grid': '{x0,z0,cell,w,h,scale,data}: cell (i,j) covers x in [x0+i*cell, x0+(i+1)*cell), z in [z0+j*cell, ...). data = base64 of byte pairs [count,value] (run-length). Decoded array length w*h, row-major (j*w+i). value 0 = outside the footprint / no cell; otherwise height above ground = (value-1)*scale metres. Walls are vertical at the footprint polygon (the renderer clips the roof surface to riga.json p).',
        'buildings["<id>"].osm': 'same part schema as `parts`, taken from OpenStreetMap building:part ways (>= 2 parts) - hand-modelled, clean, preferred over fitted shapes when present; optional col = roof colour',
        'heightsP50': '{ "<id>": metres } median mesh height inside the footprint (volume-ish height; use for flat-roofed extrusions of pitched-roof buildings)',
        'buildings["<id>"].parts': '[{p:[[x,z]..] ring, y0,y1: metres above ground (prism from y0 to y1), roof:{shape,h,dir?}}]. roof.shape in flat|gabled|hipped|skillion|pyramid|cone|dome|onion; roof.h = roof rise above y1 (m); roof.dir = ridge direction in degrees from +x (east) towards +z (south) (gabled/hipped: ridge axis; skillion: the high side is to the left of this direction when facing along it, i.e. +90 deg). pyramid/cone/dome/onion are centred on the ring centroid and scale the ring to the apex. Optional col = "#rrggbb" roof colour.',
        'optional': 'wall / roofCol colour fields are not produced (textures not sampled in this spike)',
      },
      stats: { coarseFlatSkipped: coarseFlat, buildingsWithOsmParts: Object.keys(osmParts).length, buildingsInGame: game.buildings.length, withMeshHeight: withMesh, noMeshOrNoCover: noMesh, lowCover, notableBuildings: notable.size, notableWithMesh: Object.keys(grids).length, avgPartsPerNotable: +avgParts.toFixed(1), v2RmsMedian: q(rmsAll, 0.5), v2RmsP90: q(rmsAll, 0.9) },
      heightVsRigaH: heightReport,
      variantSizesBytes: sizes,
    },
    heights,
    heightsP50,
    buildings: {},
  };
  for (const id of Object.keys(grids)) {
    const e = { src: 'mesh', ground: outB[id].ground, h: outB[id].h, hmax: outB[id].hmax };
    if (variant !== 'parts') e.grid = grids[id];
    if (variant !== 'grid') e.parts = parts[id];
    out.buildings[id] = e;
  }
  if (!args['no-coarse']) for (const [id, v] of Object.entries(coarseGrids)) out.buildings[id] = { src: 'mesh', ground: v.ground, h: v.h, hmax: v.hmax, grid: v.grid };
  if (!args['no-osm']) {
    for (const [id, ps] of Object.entries(osmParts)) { if (!out.buildings[id]) out.buildings[id] = { src: 'mesh', h: heights[id] }; out.buildings[id].osm = ps; }
  }
  if (!args['no-osm']) for (const [id, v] of Object.entries(osmFallback)) if (!out.buildings[id]) out.buildings[id] = v;
  const outFile = path.resolve(ROOT, args.out || (MAP === 'centrs' ? 'tools/detail/data/riga-detail.json' : `tools/detail/data/riga-detail-${MAP}.json`));
  const json = JSON.stringify(out);
  fs.writeFileSync(outFile, json);
  console.log(JSON.stringify({ variant, file: outFile, bytes: json.length, gz: gzipSize(json), sizes, stats: out.meta.stats, heightVsRigaH: heightReport.all }, null, 1));
  fs.writeFileSync(path.join(CACHE, 'height-report.json'), JSON.stringify(heightReport, null, 1));
}

if (process.argv[1] === new URL(import.meta.url).pathname && cmd === 'analyze') await analyze();
if (process.argv[1] === new URL(import.meta.url).pathname && cmd === 'assemble') await assemble();
export { ANALYSIS, game, args, round, quant };
