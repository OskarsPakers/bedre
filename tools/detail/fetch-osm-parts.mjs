#!/usr/bin/env node
// Track A: OSM "Simple 3D Buildings" data. Downloads (cached) all `building:part` ways/relations and all
// `building` ways/relations (with geometry + every tag) in the game area, then reports coverage:
//   node tools/detail/fetch-osm-parts.mjs            -> downloads (if not cached) + prints coverage report
// Outputs: tools/.cache/detail/osm_parts.json, osm_buildings_full.json, osm-coverage.json
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ROOT, ORIGIN, M_LAT, M_LON } from './i3s.mjs';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'riga-game-data-builder';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HALF = 1200 + 60;
const bbox = [ORIGIN.lat - HALF / M_LAT, ORIGIN.lon - HALF / M_LON, ORIGIN.lat + HALF / M_LAT, ORIGIN.lon + HALF / M_LON].join(',');

async function overpass(file, body) {
  const f = path.join(CACHE, file);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const q = `[out:json][timeout:180][bbox:${bbox}];${body}`;
  let err;
  for (let round = 0; round < 3; round++) {
    for (const ep of OVERPASS) {
      try {
        console.log('overpass', file, ep);
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(200000),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        if (j.remark && /error|timed out/i.test(j.remark) && !(j.elements || []).length) throw new Error(j.remark);
        fs.writeFileSync(f, JSON.stringify(j));
        await sleep(2000);
        return j;
      } catch (e) {
        err = e;
        console.log('  failed:', e.message);
        await sleep(6000 * (round + 1));
      }
    }
  }
  throw err;
}

export async function loadOsm() {
  // ways: `out tags geom` is enough (geometry inline). Relations need `out body geom` to get member geometry.
  const parts = await overpass('osm_parts.json', '(way["building:part"];);out tags geom;');
  const bld = await overpass('osm_buildings_full.json', '(way["building"];);out tags geom;');
  const partsRel = await overpass('osm_parts_rel.json', '(relation["building:part"];);out body geom;');
  const bldRel = await overpass('osm_buildings_rel.json', '(relation["building"];);out body geom;');
  return { parts: parts.elements.filter((e) => e.type === 'way').concat(partsRel.elements), buildings: bld.elements.filter((e) => e.type === 'way').concat(bldRel.elements) };
}

/** OSM element -> outer ring(s) in game-local metres */
export function elementRings(el) {
  const pr = (g) => g.map((p) => [(p.lon - ORIGIN.lon) * M_LON, -(p.lat - ORIGIN.lat) * M_LAT]);
  if (el.type === 'way') return el.geometry ? [pr(el.geometry)] : [];
  // relation: stitch outer member ways
  const outers = (el.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => pr(m.geometry));
  const rings = [];
  const segs = outers.map((s) => s.slice());
  while (segs.length) {
    let cur = segs.pop();
    let grew = true;
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (same(cur[cur.length - 1], s[0])) { cur = cur.concat(s.slice(1)); segs.splice(i, 1); grew = true; break; }
        if (same(cur[cur.length - 1], s[s.length - 1])) { cur = cur.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); grew = true; break; }
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur.slice(0, -1));
  }
  return rings;
}
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function parseNum(v) {
  if (v == null) return NaN;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function ringArea(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s / 2);
}
function ringCentroid(r) {
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return [x / r.length, z / r.length];
}
function pip(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { parts, buildings } = await loadOsm();
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'riga.json'), 'utf8')).buildings;
  console.log(`OSM parts: ${parts.length}; OSM buildings: ${buildings.length}; game buildings: ${game.length}`);

  const tally = (els, key) => {
    const c = {};
    for (const e of els) { const v = e.tags?.[key]; if (v) c[v] = (c[v] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  };
  const tagKeys = ['height', 'min_height', 'building:levels', 'building:min_level', 'roof:shape', 'roof:height', 'roof:levels', 'roof:direction', 'roof:orientation', 'roof:colour', 'building:colour', 'building:material', 'roof:material'];
  const cover = (els) => Object.fromEntries(tagKeys.map((k) => [k, els.filter((e) => e.tags?.[k] != null).length]));
  console.log('tag coverage on parts:', JSON.stringify(cover(parts)));
  console.log('tag coverage on OSM buildings:', JSON.stringify(cover(buildings)));
  console.log('roof:shape on parts:', JSON.stringify(tally(parts, 'roof:shape')));
  console.log('roof:shape on buildings:', JSON.stringify(tally(buildings, 'roof:shape')));

  // match: game building <- OSM parts (part centroid inside footprint) and OSM building outline (centroid inside or best overlap)
  const gRings = game.map((b) => ({ b, bb: bboxOf(b.p) }));
  const byGame = new Map();
  for (const el of parts) {
    for (const ring of elementRings(el)) {
      const [cx, cz] = ringCentroid(ring);
      for (const g of gRings) {
        if (cx < g.bb[0] || cx > g.bb[2] || cz < g.bb[1] || cz > g.bb[3]) continue;
        if (pip(cx, cz, g.b.p)) {
          if (!byGame.has(g.b.id)) byGame.set(g.b.id, { parts: [], outline: [] });
          byGame.get(g.b.id).parts.push(el);
          break;
        }
      }
    }
  }
  for (const el of buildings) {
    if (!(el.tags && (el.tags['roof:shape'] || el.tags.height || el.tags['building:levels']))) continue;
    for (const ring of elementRings(el)) {
      const [cx, cz] = ringCentroid(ring);
      for (const g of gRings) {
        if (cx < g.bb[0] || cx > g.bb[2] || cz < g.bb[1] || cz > g.bb[3]) continue;
        if (pip(cx, cz, g.b.p)) {
          if (!byGame.has(g.b.id)) byGame.set(g.b.id, { parts: [], outline: [] });
          byGame.get(g.b.id).outline.push(el);
          break;
        }
      }
    }
  }
  const withParts = [...byGame.values()].filter((v) => v.parts.length >= 1);
  const ge2 = withParts.filter((v) => v.parts.length >= 2);
  const nonFlat = [...byGame.values()].filter((v) => [...v.parts, ...v.outline].some((e) => e.tags?.['roof:shape'] && e.tags['roof:shape'] !== 'flat'));
  const shapesInGame = {};
  for (const v of byGame.values()) for (const e of [...v.parts, ...v.outline]) { const s = e.tags?.['roof:shape']; if (s) shapesInGame[s] = (shapesInGame[s] || 0) + 1; }
  const rep = {
    osmParts: parts.length, osmBuildings: buildings.length, gameBuildings: game.length,
    gameBuildingsWithAtLeast1Part: withParts.length,
    gameBuildingsWithAtLeast2Parts: ge2.length,
    gameBuildingsWithNonFlatRoofShape: nonFlat.length,
    roofShapeCountsInGameBuildings: shapesInGame,
  };
  console.log(JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(CACHE, 'osm-coverage.json'), JSON.stringify(rep, null, 1));
  fs.writeFileSync(path.join(CACHE, 'osm-by-game.json'), JSON.stringify([...byGame.entries()].map(([id, v]) => ({ id, parts: v.parts.map((e) => ({ id: e.id, type: e.type, tags: e.tags })), outline: v.outline.map((e) => ({ id: e.id, tags: e.tags })) }))));
}

function bboxOf(r) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of r) { if (x < a) a = x; if (x > c) c = x; if (z < b) b = z; if (z > d) d = z; }
  return [a, b, c, d];
}
export { ringArea, ringCentroid, pip };
