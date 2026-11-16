#!/usr/bin/env node
// Builds public/data/riga.json (central Riga map data) from the Riga cadastre + OpenStreetMap.
// Node built-ins only. Raw downloads are cached in tools/.cache/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS, mapBySlug } from './maps.mjs';
import { Grid, fillPolys, strokeLine } from './surface/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
// --map <slug> (default centrs): bounds + output folder from tools/maps.mjs; the centre keeps the legacy file names and caches
const argMap = process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : 'centrs';
const MAP = mapBySlug(argMap);
if (MAP.slug !== argMap) { console.error('unknown map', argMap, 'known:', MAPS.map((m) => m.slug).join(', ')); process.exit(1); }
const IS_CENTRE = MAP.slug === 'centrs';
const SFX = IS_CENTRE ? '_v2' : '_' + MAP.slug;
const OUT = IS_CENTRE ? path.join(ROOT, 'public', 'data', 'riga.json') : path.join(ROOT, 'public', 'data', MAP.slug, 'riga.json');

// ---------------------------------------------------------------- config
const ORIGIN = { lat: 56.9515, lon: 24.1133 };
// Map extent (local metres). Iteration 5: grown west/south-west to include the left bank (Pārdaugava).
const B0 = { minX: -1200, maxX: 1200, minZ: -1200, maxZ: 1200 }; // previous extent of the centre map (its cadastre cache is reused)
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const CADASTRE =
  'https://services-eu1.arcgis.com/JzVauvrMa89dBJ9D/arcgis/rest/services/Kadastra_ekas_updated/FeatureServer/0/query';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'riga-game-data-builder';
const B = { ...MAP.bounds };

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => Math.round(v * 10) / 10;
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const log = (...a) => console.log(...a);

async function cached(name, producer) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) {
    log(`cache hit  ${name}`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const data = await producer();
  fs.writeFileSync(f, JSON.stringify(data));
  return data;
}

async function fetchRetry(url, opts, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000), ...opts, headers: { 'User-Agent': UA, ...(opts?.headers || {}) } });
      if (res.ok) return res;
      err = new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
    } catch (e) {
      err = e;
    }
    await sleep(2000 * (i + 1));
  }
  throw err;
}

// bbox in lon/lat with padding (m)
function lonLatBox(pad = 0, b = B) {
  return {
    minLon: ORIGIN.lon + (b.minX - pad) / M_LON,
    maxLon: ORIGIN.lon + (b.maxX + pad) / M_LON,
    minLat: ORIGIN.lat - (b.maxZ + pad) / M_LAT,
    maxLat: ORIGIN.lat - (b.minZ - pad) / M_LAT,
  };
}

async function overpass(name, body) {
  return cached(name, async () => {
    const bb = lonLatBox(60);
    const bbox = `${bb.minLat},${bb.minLon},${bb.maxLat},${bb.maxLon}`;
    const q = `[out:json][timeout:180][bbox:${bbox}];${body}`;
    let err;
    for (let round = 0; round < 3; round++) {
      for (const ep of OVERPASS) {
        try {
          log(`overpass ${name} via ${ep}`);
          const res = await fetchRetry(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(q),
          }, 2);
          const j = await res.json();
          if (j.remark && /error|timed out/i.test(j.remark) && !(j.elements || []).length) throw new Error(j.remark);
          await sleep(1500);
          return j;
        } catch (e) {
          err = e;
          log('  failed:', e.message);
          await sleep(5000 * (round + 1));
        }
      }
    }
    throw err;
  });
}

// ---------------------------------------------------------------- geometry
function area2(ring) {
  // shoelace sum (x_i*z_j - x_j*z_i)/2 ; >0 means clockwise as plotted (x right, z down)
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function centroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of ring) { sx += p[0]; sz += p[1]; }
    return [sx / ring.length, sz / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
function pip(pt, ring) {
  let inside = false;
  const [x, z] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function dedupe(pts, closed) {
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  if (closed) while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
function dpSimplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0, idx = -1;
    const a = pts[s], b = pts[e];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i];
      let d;
      if (len2 === 0) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
      else {
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
      }
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(ring, eps) {
  let r = dedupe(ring.map((p) => [r1(p[0]), r1(p[1])]), true);
  if (r.length < 3) return null;
  // rotate so start is the farthest point from ring[0] -> DP on closed ring
  let fi = 0, fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; fi = i; }
  }
  const a = dpSimplify(r.slice(0, fi + 1), eps);
  const b = dpSimplify(r.slice(fi).concat([r[0]]), eps);
  let s = dedupe(a.concat(b.slice(1, -1)), true);
  if (s.length < 3) s = r;
  if (s.length < 3) return null;
  return s;
}
function orient(ring) {
  // visually counter-clockwise with x right / z down  => shoelace(x,z) negative
  return area2(ring) > 0 ? ring.slice().reverse() : ring;
}
function clipPoly(ring, b = B) {
  // Sutherland-Hodgman against rectangle
  const edges = [
    [(p) => p[0] >= b.minX, (a, c) => { const t = (b.minX - a[0]) / (c[0] - a[0]); return [b.minX, a[1] + t * (c[1] - a[1])]; }],
    [(p) => p[0] <= b.maxX, (a, c) => { const t = (b.maxX - a[0]) / (c[0] - a[0]); return [b.maxX, a[1] + t * (c[1] - a[1])]; }],
    [(p) => p[1] >= b.minZ, (a, c) => { const t = (b.minZ - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), b.minZ]; }],
    [(p) => p[1] <= b.maxZ, (a, c) => { const t = (b.maxZ - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), b.maxZ]; }],
  ];
  let out = ring;
  for (const [inside, isect] of edges) {
    const inp = out;
    out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(isect(prev, cur)); out.push(cur); }
      else if (pi) out.push(isect(prev, cur));
    }
  }
  return out;
}
function clipLine(pts, b = B) {
  // Liang-Barsky per segment; returns array of polylines
  const res = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dz, dz];
    const q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { ok = false; break; } }
      else {
        const t = q[k] / p[k];
        if (p[k] < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
        else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
      }
    }
    if (!ok) { if (cur) { res.push(cur); cur = null; } continue; }
    const a = [x0 + t0 * dx, z0 + t0 * dz], c = [x0 + t1 * dx, z0 + t1 * dz];
    if (!cur) cur = [a];
    cur.push(c);
    if (t1 < 1) { res.push(cur); cur = null; }
  }
  if (cur) res.push(cur);
  return res;
}
const polyLen = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
const inBounds = (p) => p[0] >= B.minX && p[0] <= B.maxX && p[1] >= B.minZ && p[1] <= B.maxZ;
const geomToLocal = (g) => g.map((n) => proj(n.lon, n.lat));

// stitch way geometries (arrays of [x,z]) into closed rings
function stitch(ways) {
  const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  const rings = [];
  let pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  while (pool.length) {
    let ring = pool.pop();
    let guard = true;
    while (guard && key(ring[0]) !== key(ring[ring.length - 1])) {
      guard = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const end = key(ring[ring.length - 1]);
        if (key(w[0]) === end) { ring = ring.concat(w.slice(1)); }
        else if (key(w[w.length - 1]) === end) { ring = ring.concat(w.slice().reverse().slice(1)); }
        else if (key(w[w.length - 1]) === key(ring[0])) { ring = w.concat(ring.slice(1)); }
        else if (key(w[0]) === key(ring[0])) { ring = w.slice().reverse().concat(ring.slice(1)); }
        else continue;
        pool.splice(i, 1);
        guard = true;
        break;
      }
    }
    if (key(ring[0]) === key(ring[ring.length - 1]) && ring.length >= 4) rings.push(ring.slice(0, -1));
    else rings.push({ open: ring });
  }
  return rings;
}

// OSM element -> list of outer rings (local coords)
function osmRings(el) {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return [];
    const g = geomToLocal(el.geometry);
    const f = g[0], l = g[g.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) return [];
    return [g.slice(0, -1)];
  }
  if (el.type === 'relation') {
    const outers = (el.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geomToLocal(m.geometry));
    return stitch(outers).filter((r) => Array.isArray(r));
  }
  return [];
}

// OSM element -> polygons with holes [{p: outer ring, h: [inner rings]}] (local coords; closed rings only)
function osmPolys(el) {
  if (el.type === 'way') return osmRings(el).map((p) => ({ p, h: [] }));
  if (el.type !== 'relation') return [];
  const mem = (el.members || []).filter((m) => m.type === 'way' && m.geometry);
  const outers = stitch(mem.filter((m) => m.role !== 'inner').map((m) => geomToLocal(m.geometry))).filter((r) => Array.isArray(r));
  const inners = stitch(mem.filter((m) => m.role === 'inner').map((m) => geomToLocal(m.geometry))).filter((r) => Array.isArray(r));
  const out = outers.map((p) => ({ p, h: [] }));
  for (const ih of inners) {
    const q = ih[0];
    let best = null;
    for (const o of out) if (pip(q, o.p) && (!best || Math.abs(area2(o.p)) < Math.abs(area2(best.p)))) best = o;
    if (best) best.h.push(ih);
  }
  return out;
}
// clip + simplify a polygon with holes to the map rectangle; null when it vanishes
function cleanPoly(poly, eps = 1, minArea = 20, minHole = 6) {
  const c = clipPoly(poly.p);
  if (c.length < 3) return null;
  const s = simplifyRing(c, eps);
  if (!s || Math.abs(area2(s)) < minArea) return null;
  const o = { p: orient(s) };
  const hs = [];
  for (const h of poly.h || []) {
    const hc = clipPoly(h);
    if (hc.length < 3) continue;
    const hs1 = simplifyRing(hc, eps);
    if (!hs1 || Math.abs(area2(hs1)) < minHole) continue;
    hs.push(orient(hs1).slice().reverse()); // opposite winding to the outer ring
  }
  if (hs.length) o.h = hs;
  return o;
}

function hashStr(n) {
  let h = (Number(n) | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- cadastre
async function getCadastre() {
  // iteration 5: the first (central) extent is kept byte-for-byte from the old cache (stable ids / footprints);
  // only cells that reach outside the old extent are fetched.
  return cached(`cadastre${SFX}.json`, async () => {
    const seen = new Map();
    const oldF = path.join(CACHE, 'cadastre.json');
    if (IS_CENTRE && fs.existsSync(oldF)) for (const f of JSON.parse(fs.readFileSync(oldF, 'utf8')).features) seen.set(f.properties.objectid_1, f);
    const bb = lonLatBox(0), ob = lonLatBox(0, B0);
    const NX = Math.max(1, Math.ceil((B.maxX - B.minX) / 550)), NZ = Math.max(1, Math.ceil((B.maxZ - B.minZ) / 550));
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const x0 = bb.minLon + ((bb.maxLon - bb.minLon) * i) / NX, x1 = bb.minLon + ((bb.maxLon - bb.minLon) * (i + 1)) / NX;
        const y0 = bb.minLat + ((bb.maxLat - bb.minLat) * j) / NZ, y1 = bb.minLat + ((bb.maxLat - bb.minLat) * (j + 1)) / NZ;
        if (IS_CENTRE && x0 >= ob.minLon && x1 <= ob.maxLon && y0 >= ob.minLat && y1 <= ob.maxLat) continue; // fully inside the old extent
        let offset = 0;
        for (;;) {
          const params = new URLSearchParams({
            geometry: `${x0},${y0},${x1},${y1}`,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: 'objectid_1,address,mainusetype,buildingtype,totalarea,Shape__Area',
            outSR: '4326',
            f: 'geojson',
            orderByFields: 'objectid_1',
            resultOffset: String(offset),
            resultRecordCount: '1000',
          });
          log(`cadastre tile ${i},${j} offset ${offset}`);
          const res = await fetchRetry(`${CADASTRE}?${params}`);
          const gj = await res.json();
          if (gj.error) throw new Error('cadastre: ' + JSON.stringify(gj.error));
          const feats = gj.features || [];
          for (const f of feats) if (!seen.has(f.properties.objectid_1)) seen.set(f.properties.objectid_1, f);
          offset += feats.length;
          if (!feats.length || !(gj.properties && gj.properties.exceededTransferLimit)) break;
          await sleep(400);
        }
        await sleep(400);
      }
    }
    return { type: 'FeatureCollection', features: [...seen.values()] };
  });
}

// ---------------------------------------------------------------- classification
function typeFromUse(use) {
  const code = (String(use || '').match(/^\d{4}/) || [''])[0];
  if (!code) return 'oth';
  if (code.startsWith('11')) return 'res';
  if (code === '1242') return 'aux';
  if (code.startsWith('121') || code.startsWith('122') || code.startsWith('123')) return 'com';
  if (code.startsWith('124') || code.startsWith('125')) return 'ind';
  if (code.startsWith('126')) return 'pub';
  if (code === '1272') return 'rel';
  if (code === '1274') return 'aux';
  if (code === '1271') return 'ind';
  return 'oth';
}
function parseHeight(v) {
  if (v == null) return null;
  const m = String(v).replace(',', '.').match(/[\d.]+/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!isFinite(n) || n <= 0) return null;
  return /ft|'/.test(String(v)) ? n * 0.3048 : n;
}
function osmHeight(tags) {
  const h = parseHeight(tags.height);
  if (h) return h;
  const lv = parseFloat(tags['building:levels']);
  if (isFinite(lv) && lv > 0) {
    const roofH = parseHeight(tags['roof:height']);
    const rl = parseFloat(tags['roof:levels']);
    return lv * 3.2 + 2 + (roofH || (isFinite(rl) ? rl * 1.5 : 0));
  }
  return null;
}
function heuristicHeight(t, foot, id) {
  const j = hashStr(id);
  let h;
  if (t === 'aux') h = 2.8 + j * 1.4;
  else if (t === 'rel') h = 12 + j * 8;
  else if (foot < 25) h = 3 + j * 2.5;
  else if (t === 'ind') h = 6 + j * 6;
  else if (t === 'res') h = foot < 60 ? 6 + j * 5 : 15 + j * 8;
  else if (t === 'com') h = 15 + j * 9;
  else if (t === 'pub') h = 13 + j * 9;
  else h = foot < 60 ? 5 + j * 5 : 12 + j * 9;
  return h;
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const stats = {};

  // ---- downloads
  const cad = await getCadastre();
  log('cadastre features:', cad.features.length);

  const osmB = await overpass(
    `osm_buildings${SFX}.json`,
    `(way["building"]["height"];way["building"]["building:levels"];way["building"]["name"];way["building:part"]["height"];way["building:part"]["building:levels"];);out geom;`
  );
  const osmWater = await overpass(
    `osm_water${SFX}.json`,
    `(way["natural"="water"];way["waterway"="riverbank"];relation["natural"="water"];relation["waterway"="riverbank"];relation["water"~"river|canal|lake|pond"]["type"="multipolygon"];);out geom;`
  );
  // parks, landuse, leisure, natural cover, parking (iteration 5: everything that paints the ground between roads and buildings)
  const osmCover = await overpass(
    `osm_cover${SFX}.json`,
    `(way["leisure"~"^(park|garden|playground|pitch|stadium|sports_centre|track|common|dog_park|golf_course|nature_reserve|swimming_pool|marina)$"];relation["leisure"~"^(park|garden|playground|pitch|stadium|sports_centre|track|common|dog_park|golf_course|nature_reserve|swimming_pool|marina)$"];` +
    `way["landuse"];relation["landuse"];way["natural"~"^(wood|scrub|sand|beach|grassland|heath|bare_rock|shingle|fell|wetland)$"];relation["natural"~"^(wood|scrub|sand|beach|grassland|heath|bare_rock|shingle|fell|wetland)$"];` +
    `way["amenity"~"^(parking|marketplace|bus_station)$"];relation["amenity"~"^(parking|marketplace|bus_station)$"];);out geom;`
  );
  // hard surfaces: pedestrian areas / squares / area:highway / piers / bridges / platforms
  const osmHard = await overpass(
    `osm_hard${SFX}.json`,
    `(way["highway"~"^(pedestrian|footway|steps|living_street|service|residential|unclassified|tertiary|secondary|primary|cycleway|path|track)$"]["area"="yes"];relation["highway"~"^(pedestrian|footway|steps|living_street|service|residential|unclassified|tertiary|secondary|primary|cycleway|path|track)$"]["area"="yes"];` +
    `way["area:highway"];relation["area:highway"];way["place"="square"];relation["place"="square"];way["man_made"~"^(pier|bridge|quay|groyne|breakwater)$"];relation["man_made"~"^(pier|bridge|quay)$"];` +
    `way["railway"="platform"];way["public_transport"="platform"]["area"="yes"];);out geom;`
  );
  const osmRoads = await overpass(
    `osm_roads${SFX}.json`,
    `(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|steps|cycleway)$"];way["railway"="rail"];);out geom;`
  );
  const osmCross = await overpass(
    `osm_cross${SFX}.json`,
    `(node["highway"="crossing"];way["footway"="crossing"];);out geom;`
  );
  const osmMisc = await overpass(
    `osm_misc${SFX}.json`,
    `(node["natural"="tree"];way["natural"="tree_row"];node["name"]["tourism"="attraction"];way["name"]["tourism"="attraction"];node["name"]["historic"~"^(monument|castle|city_gate|tower|fort)$"];way["name"]["historic"~"^(monument|castle|city_gate|tower|fort)$"];node["name"]["amenity"="place_of_worship"];way["name"]["amenity"="place_of_worship"];node["name"]["man_made"="tower"];way["name"]["man_made"="tower"];` +
    `way["name"~"Nacionālā bibliotēka|Saules akmens|Preses nams|pasažieru osta|Uzvaras parks|Swedbank"]["building"];way["name"~"Uzvaras parks|Pasažieru osta"]["leisure"~"park"];relation["name"~"Uzvaras parks"];);out geom;`
  );

  // ---- (iteration 3, additive) tram tracks + public transport stops; failure here must not break the base build
  let osmTransit = null;
  try {
    osmTransit = await overpass(
      `osm_transit${SFX}.json`,
      `(way["railway"="tram"];node["highway"="bus_stop"];node["railway"="tram_stop"];node["public_transport"="stop_position"]["tram"="yes"];);out geom;`
    );
  } catch (e) { log('transit query failed (continuing without tramways/stops):', e.message); }

  if (process.argv.includes('--fetch-only')) { log('fetched; exiting (--fetch-only)'); return; }

  // ---- OSM buildings index (for height/name)
  const osmBuildings = [];
  for (const el of osmB.elements) {
    if (el.type !== 'way') continue;
    const rings = osmRings(el);
    if (!rings.length) continue;
    const ring = rings[0];
    const tags = el.tags || {};
    const o = {
      ring, h: osmHeight(tags), name: tags.name || null,
      area: Math.abs(area2(ring)), c: centroid(ring), _lv: !parseHeight(tags.height), part: !!tags['building:part'] && !tags.building,
    };
    if (o.h == null && !o.name) continue;
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const p of ring) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mnz = Math.min(mnz, p[1]); mxz = Math.max(mxz, p[1]); }
    o.bb = [mnx, mnz, mxx, mxz];
    osmBuildings.push(o);
  }
  const CELL = 40;
  const grid = new Map();
  const cellKey = (i, j) => i + ',' + j;
  osmBuildings.forEach((o, idx) => {
    for (let i = Math.floor(o.bb[0] / CELL); i <= Math.floor(o.bb[2] / CELL); i++)
      for (let j = Math.floor(o.bb[1] / CELL); j <= Math.floor(o.bb[3] / CELL); j++) {
        const k = cellKey(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
  });
  function matchOsm(c) {
    const ci = Math.floor(c[0] / CELL), cj = Math.floor(c[1] / CELL);
    let best = null;
    const cand = grid.get(cellKey(ci, cj)) || [];
    for (const idx of cand) {
      const o = osmBuildings[idx];
      if (c[0] < o.bb[0] || c[0] > o.bb[2] || c[1] < o.bb[1] || c[1] > o.bb[3]) continue;
      if (pip(c, o.ring) && (!best || o.area < best.area)) best = o;
    }
    if (best) return best;
    // nearest centroid within 15 m
    let bd = 15;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const idx of grid.get(cellKey(ci + di, cj + dj)) || []) {
        const o = osmBuildings[idx];
        const d = Math.hypot(o.c[0] - c[0], o.c[1] - c[1]);
        if (d < bd) { bd = d; best = o; }
      }
    }
    return best;
  }

  // ---- water (outer rings + holes: islands such as Ķīpsala / Lucavsala)
  const water = [];
  for (const el of osmWater.elements) {
    const wt = el.tags || {};
    if (wt.covered === 'yes' || wt.tunnel === 'yes' || parseFloat(wt.layer) < 0) continue;
    for (const poly of osmPolys(el)) {
      if (Math.abs(area2(poly.p)) < 30) continue;
      const w = cleanPoly(poly, 1, 30, 20);
      if (w) water.push(w);
    }
  }

  // helpers for piers / engineering structures
  const bbOf = (ring) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const q of ring) { a = Math.min(a, q[0]); c = Math.max(c, q[0]); b = Math.min(b, q[1]); d = Math.max(d, q[1]); } return [a, b, c, d]; };
  const waterBB = water.map((w) => bbOf(w.p));
  const inWaterPt = (x, z) => {
    for (let i = 0; i < water.length; i++) {
      const bb = waterBB[i];
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (!pip([x, z], water[i].p)) continue;
      if (water[i].h && water[i].h.some((h) => pip([x, z], h))) continue;
      return true;
    }
    return false;
  };
  const distWater = (x, z, lim) => {
    let best = lim;
    const segs = (P) => {
      for (let k = 0; k < P.length; k++) {
        const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % P.length];
        const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
        best = Math.min(best, Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)));
      }
    };
    for (let i = 0; i < water.length; i++) {
      const bb = waterBB[i];
      if (x < bb[0] - lim || x > bb[2] + lim || z < bb[1] - lim || z > bb[3] + lim) continue;
      segs(water[i].p);
      for (const h of water[i].h || []) segs(h);
    }
    return best;
  };
  const boxOf = (ring) => { // edge-aligned min-area box: {L, W}
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len, uz = dz / len;
      let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
      for (const [x, z] of ring) { const u = x * ux + z * uz, v = -x * uz + z * ux; a = Math.min(a, u); b = Math.max(b, u); c = Math.min(c, v); d = Math.max(d, v); }
      const ar = (b - a) * (d - c);
      if (!best || ar < best.ar) best = { ar, L: b - a, W: d - c };
    }
    if (!best) return { L: 1, W: 1 };
    return best.W > best.L ? { L: best.W, W: best.L } : { L: best.L, W: best.W };
  };
  const piers = [];
  const fixStats = { piers: 0, lowStructures: 0, cappedHeuristic: 0, namesDropped: 0 };
  // ---- buildings
  const buildings = [];
  const hSrc = { osm_height: 0, osm_levels: 0, cadastre_area: 0, heuristic: 0 };
  const byType = {};
  let namedFromOsm = 0, dropped = { small: 0, outside: 0, bad: 0 };
  for (const f of cad.features) {
    const g = f.geometry;
    if (!g) { dropped.bad++; continue; }
    let rings;
    if (g.type === 'Polygon') rings = [g.coordinates[0]];
    else if (g.type === 'MultiPolygon') rings = g.coordinates.map((p) => p[0]);
    else { dropped.bad++; continue; }
    // largest part
    let best = null, ba = -1;
    for (const r of rings) {
      const loc = r.map((c) => proj(c[0], c[1]));
      const a = Math.abs(area2(loc));
      if (a > ba) { ba = a; best = loc; }
    }
    if (!best || best.length < 4) { dropped.bad++; continue; }
    const foot = ba;
    if (foot < 6) { dropped.small++; continue; }
    const c = centroid(best.slice(0, -1));
    if (!inBounds(c) || !isFinite(c[0])) { dropped.outside++; continue; }
    let ring = simplifyRing(best.slice(0, -1), 0.3);
    if (!ring) { dropped.bad++; continue; }
    ring = orient(ring);
    const p = f.properties;
    const id = p.objectid_1 ?? f.id;
    // cadastre "buildings" mostly over water are piers / berths / quay walls, not buildings
    {
      let wet = 0;
      for (const q of ring) if (inWaterPt(q[0], q[1])) wet++;
      if (wet / ring.length >= 0.5 || inWaterPt(c[0], c[1])) { piers.push({ p: ring.map((q) => [r1(q[0]), r1(q[1])]) }); fixStats.piers++; continue; }
    }
    let t = typeFromUse(p.mainusetype);
    // cadastre engineering works without an address (2112 streets/squares, 2141 bridges, 2142 tunnels, 2151 ports, 2420 other ...)
    {
      const code = String(p.mainusetype || '').slice(0, 4);
      const noAddr0 = !p.address || /^\s*bez adreses/i.test(String(p.address));
      if (noAddr0 && /^(21|22|24)/.test(code) && code !== '2411') {
        if (code === '2142') { fixStats.tunnelsDropped = (fixStats.tunnelsDropped || 0) + 1; continue; }
        if (code === '2151' || ((code === '2141' || code === '2420') && distWater(c[0], c[1], 10) < 8)) {
          piers.push({ p: ring.map((q) => [r1(q[0]), r1(q[1])]) }); fixStats.piers++; continue;
        }
        fixStats.engineeringFlattened = (fixStats.engineeringFlattened || 0) + 1;
        t = 'aux'; p.__flat = true;
      }
    }
    byType[t] = (byType[t] || 0) + 1;

    const om = matchOsm(c);
    let h = null, src = null;
    if (om && om.h != null) {
      h = om.h;
      src = 'osm_height';
      // distinguish levels vs explicit height
    }
    const total = Number(p.totalarea) || 0;
    if (h == null && total > 0) {
      const fl = Math.max(1, Math.min(12, Math.round(total / foot)));
      h = fl * 3.2;
      src = 'cadastre_area';
    }
    if (h == null) { h = heuristicHeight(t, foot, id); src = 'heuristic'; }
    h = Math.max(2.5, Math.min(130, h));
    if (p.__flat) h = 1.2;
    // un-typed, un-addressed, OSM-unmatched structures: quay walls / fences / ramps / sheds, not apartment blocks
    {
      const noAddr = !p.address || /^\s*bez adreses/i.test(String(p.address));
      if (!p.mainusetype && noAddr && !om) {
        const bx = boxOf(ring);
        const aspect = bx.L / Math.max(0.5, bx.W);
        const nearWater = distWater(c[0], c[1], 10) < 8;
        if (aspect > 8 || bx.W < 4 || (nearWater && aspect > 4)) { t = 'aux'; h = 1.2; fixStats.lowStructures++; }
        else if (src === 'heuristic' && h > 4) { h = 4; fixStats.cappedHeuristic++; }
      }
    }
    if (src === 'osm_height' && om && om._lv) src = 'osm_levels';
    hSrc[src]++;

    const b = { id, p: ring, h: r1(h), t };
    let name = p.address ? String(p.address).trim() : '';
    if (om && om.name && (om.area <= foot * 4 || pip(c, om.ring) === false)) { name = om.name; namedFromOsm++; }
    if (/^\s*bez adreses\s*$/i.test(name)) { name = ''; fixStats.namesDropped++; }
    if (name) b.n = name;
    buildings.push(b);
  }
  // ---- ground cover: parks (lawn), areas (landuse / hard surfaces / parking / ...), with holes
  const SURF = {
    asphalt: 'a', paved: 'p', paving_stones: 'p', 'paving_stones:30': 'p', concrete_plates: 'p', 'concrete:plates': 'p', concrete: 'c', sett: 's', cobblestone: 's', unhewn_cobblestone: 's',
    'cobblestone:flattened': 's', gravel: 'g', fine_gravel: 'g', compacted: 'g', pebblestone: 'g', dirt: 'd', ground: 'd', earth: 'd', mud: 'd', unpaved: 'd', grass: 'r', sand: 'n',
    wood: 'w', tartan: 't', artificial_turf: 't', rubber: 't', metal: 'm',
  };
  const surfOf = (tags) => SURF[tags.surface] || null;
  const parks = [], areas = [];
  const areaStats = {};
  const GREEN_LEISURE = /^(park|garden|common|dog_park|nature_reserve|golf_course)$/;
  const GREEN_LANDUSE = /^(grass|recreation_ground|village_green|meadow|flowerbed|cemetery|orchard|allotments|vineyard|farmland|plant_nursery)$/;
  const LANDUSE_CLASS = {
    residential: 'res', commercial: 'com', retail: 'com', institutional: 'com', education: 'com', religious: 'com', military: 'com', civic_amenity: 'com', garages: 'ind', industrial: 'ind', depot: 'ind', port: 'ind',
    railway: 'rail', construction: 'con', brownfield: 'con', quarry: 'con', landfill: 'con', greenfield: 'con', forest: 'wd', winter_sports: null,
  };
  function coverClass(tags) {
    if (tags.tunnel === 'yes' || tags.covered === 'yes') return null;
    if (tags.leisure && GREEN_LEISURE.test(tags.leisure)) return 'park';
    if (tags.landuse && GREEN_LANDUSE.test(tags.landuse)) return tags.landuse === 'cemetery' ? 'park' : 'park';
    if (tags.natural === 'grassland' || tags.natural === 'heath' || tags.natural === 'wetland') return 'park';
    if (tags.natural === 'wood' || tags.natural === 'scrub') return 'wd';
    if (tags.natural === 'sand' || tags.natural === 'beach' || tags.natural === 'shingle' || tags.natural === 'bare_rock' || tags.natural === 'fell') return 'sand';
    if (tags.leisure === 'playground') return 'ply';
    if (tags.leisure === 'pitch') return 'pit';
    if (tags.leisure === 'stadium' || tags.leisure === 'track' || tags.leisure === 'sports_centre') return 'sta';
    if (tags.leisure === 'swimming_pool' || tags.leisure === 'marina') return null;
    if (tags.amenity === 'parking' || tags.amenity === 'bus_station') return 'pkg';
    if (tags.amenity === 'marketplace') return 'sq';
    if (tags.landuse && LANDUSE_CLASS[tags.landuse] !== undefined) return LANDUSE_CLASS[tags.landuse];
    return null;
  }
  function hardClass(tags) {
    if (tags.tunnel === 'yes') return null;
    if (tags.man_made === 'bridge') return 'brg';
    if (tags.man_made === 'pier' || tags.man_made === 'quay' || tags.man_made === 'groyne' || tags.man_made === 'breakwater') return 'pier';
    if (tags.railway === 'platform' || tags.public_transport === 'platform') return 'plat';
    const ah = tags['area:highway'];
    const hw = tags.highway;
    if (ah) {
      if (/^(footway|pedestrian|crossing|steps|cycleway|path)$/.test(ah)) return 'sq';
      if (/^(verge|grass|green)$/.test(ah)) return 'verge';
      if (/^(kerb|traffic_island|island)$/.test(ah)) return 'island';
      return 'as'; // carriageway, service, residential, living_street, parking_lane ... asphalt
    }
    if (hw && tags.area === 'yes') {
      if (/^(pedestrian|footway|steps|path|cycleway)$/.test(hw)) return 'sq';
      return 'as';
    }
    if (tags.place === 'square') return 'sq';
    return null;
  }
  const addArea = (c, poly, tags, minA = 15) => {
    if (Math.abs(area2(poly.p)) < minA) return;
    const q = cleanPoly(poly, 0.8, minA, 5);
    if (!q) return;
    const a = { c, p: q.p.map((v) => [r1(v[0]), r1(v[1])]) };
    if (q.h) a.h = q.h.map((h) => h.map((v) => [r1(v[0]), r1(v[1])]));
    const sf = surfOf(tags);
    if (sf) a.s = sf;
    if (c === 'park') parks.push(a); else areas.push(a);
    areaStats[c] = (areaStats[c] || 0) + 1;
  };
  for (const el of osmCover.elements) {
    const tags = el.tags || {};
    const c = coverClass(tags);
    if (!c) continue;
    // very large landuse relations that reach well outside the map are fine (clipped); skip city-sized polygons made of ways without area semantic
    for (const poly of osmPolys(el)) addArea(c, poly, tags, c === 'park' ? 20 : 40);
  }
  for (const el of osmHard.elements) {
    const tags = el.tags || {};
    const c = hardClass(tags);
    if (!c) continue;
    // plain linear man_made=pier/bridge ways are lines (not closed) -> skipped by osmPolys
    for (const poly of osmPolys(el)) addArea(c, poly, tags, 8);
  }
  // paint order (low -> high); ground.js paints in array order
  const AREA_ORDER = ['res', 'com', 'ind', 'con', 'rail', 'sand', 'wd', 'ply', 'pit', 'sta', 'pkg', 'as', 'verge', 'sq', 'plat', 'island', 'pier', 'brg'];
  areas.sort((a, b) => AREA_ORDER.indexOf(a.c) - AREA_ORDER.indexOf(b.c) || Math.abs(area2(b.p)) - Math.abs(area2(a.p)));
  parks.sort((a, b) => Math.abs(area2(b.p)) - Math.abs(area2(a.p))); // big first so nested parks stay visible

  // ---- roads
  const roads = [];
  const sidewalkWays = []; // separately mapped sidewalks (footway=sidewalk) for the "road already has a mapped sidewalk" test
  const DEF_W = { motorway: 14, primary: 14, secondary: 11, tertiary: 9, residential: 7, service: 4, pedestrian: 5, footway: 2, rail: 3 };
  const KMAP = {
    motorway: 'motorway', motorway_link: 'motorway', trunk: 'primary', trunk_link: 'primary',
    primary: 'primary', primary_link: 'primary', secondary: 'secondary', secondary_link: 'secondary',
    tertiary: 'tertiary', tertiary_link: 'tertiary', unclassified: 'residential', residential: 'residential',
    living_street: 'residential', service: 'service', pedestrian: 'pedestrian',
    footway: 'footway', path: 'footway', steps: 'footway', cycleway: 'footway',
  };
  const sidewalkFlag = (tags) => {
    // 0 none, 1 both, 2 left, 3 right (direction of the way), -1 not mapped
    const yn = (x) => !/^(no|none|separate)$/.test(String(x));
    let l = null, r = null;
    const sw = tags.sidewalk;
    if (sw) {
      if (sw === 'left') { l = true; r = false; } else if (sw === 'right') { l = false; r = true; }
      else if (sw === 'both' || sw === 'yes') l = r = true; else if (!yn(sw)) l = r = false; else l = r = true;
    }
    if (tags['sidewalk:both']) l = r = yn(tags['sidewalk:both']);
    if (tags['sidewalk:left']) l = yn(tags['sidewalk:left']);
    if (tags['sidewalk:right']) r = yn(tags['sidewalk:right']);
    if (l === null && r === null) return -1;
    return l && r ? 1 : l ? 2 : r ? 3 : 0;
  };
  let sidewalkTagged = 0, bridgeRoads = 0;
  for (const el of osmRoads.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    let k, fkind = null;
    if (tags.railway === 'rail') {
      if (tags.tunnel === 'yes') continue;
      k = 'rail';
    } else {
      k = KMAP[tags.highway];
      if (!k) continue;
      if (tags.tunnel === 'yes' && (k === 'footway' || k === 'service')) continue;
      if (tags.area === 'yes') continue;
      if (k === 'footway') {
        if (tags.footway === 'sidewalk') fkind = 's';
        else if (tags.footway === 'crossing' || tags.highway === 'crossing') fkind = 'c';
        else if (tags.highway === 'steps') fkind = 't';
        else if (tags.highway === 'cycleway') fkind = 'y';
        else if (tags.highway === 'path') fkind = 'p';
      }
    }
    let w = parseHeight(tags.width);
    if (!w) {
      const lanes = parseFloat(tags.lanes);
      w = isFinite(lanes) && lanes > 0 && !['footway', 'rail', 'pedestrian'].includes(k) ? lanes * 3.4 + 0.6 : DEF_W[k];
    }
    w = Math.max(1.5, Math.min(40, w));
    const pts = geomToLocal(el.geometry);
    const sw = k === 'rail' || k === 'footway' || k === 'pedestrian' || k === 'motorway' ? 0 : sidewalkFlag(tags);
    if (sw > 0) sidewalkTagged++;
    const lanes = parseInt(tags.lanes, 10);
    const sf = surfOf(tags);
    const isBridge = tags.bridge && tags.bridge !== 'no';
    // underground stretch (tunnel / underpass / layer < 0): kept in the list (traffic) but never painted on the surface (r.tn)
    const isTunnel = k !== 'rail' && (tags.tunnel === 'yes' || tags.covered === 'yes' || parseFloat(tags.layer) < 0) && !isBridge;
    for (const seg of clipLine(pts)) {
      const s = dedupe(dpSimplify(dedupe(seg.map((p) => [r1(p[0]), r1(p[1])]), false), 1), false);
      if (s.length < 2) continue;
      const len = polyLen(s);
      if (fkind === 's') { if (len >= 6) sidewalkWays.push({ p: s, w: Math.min(w, 3) }); if (len < 15) continue; }
      if ((k === 'footway') && len < 15) continue;
      if (len < 2) continue;
      const r = { p: s, w: r1(w), k };
      if (k !== 'rail' && k !== 'footway' && k !== 'pedestrian' && k !== 'motorway') r.sw = k === 'service' && sw === -1 ? 0 : sw; // -1 = unmapped (resolved below)
      if (fkind) r.f = fkind;
      if (sf) r.s = sf;
      if (isFinite(lanes) && lanes > 0 && k !== 'footway') r.l = lanes;
      if (isBridge) { r.br = 1; bridgeRoads++; }
      if (isTunnel) r.tn = 1;
      if (tags.oneway === 'yes' || tags.oneway === '1') r.ow = 1;
      roads.push(r);
    }
  }
  // default sidewalk where unmapped: both sides for ordinary urban streets, none for service lanes; none where a separately mapped sidewalk
  // runs along that side already (it is drawn as its own footway)
  {
    const SWCELL = 30, swGrid = new Map();
    const ck = (i, j) => i + ',' + j;
    sidewalkWays.forEach((sw, idx) => {
      for (let q = 0; q < sw.p.length - 1; q++) {
        const [x0, z0] = sw.p[q], [x1, z1] = sw.p[q + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 5));
        for (let t = 0; t <= n; t++) {
          const x = x0 + ((x1 - x0) * t) / n, z = z0 + ((z1 - z0) * t) / n;
          const key = ck(Math.floor(x / SWCELL), Math.floor(z / SWCELL));
          if (!swGrid.has(key)) swGrid.set(key, []);
          swGrid.get(key).push([x, z]);
        }
      }
    });
    const nearSw = (x, z, r) => {
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++)
        for (const q of swGrid.get(ck(Math.floor(x / SWCELL) + di, Math.floor(z / SWCELL) + dj)) || []) if (Math.hypot(q[0] - x, q[1] - z) < r) return true;
      return false;
    };
    let mapped = 0, dflt = 0;
    for (const r of roads) {
      if (r.sw !== -1) continue;
      // sample along the road: left/right offsets; a side with a mapped sidewalk within ~(w/2+4) is "mapped" (no synthetic strip needed)
      let nl = 0, nr = 0, n = 0;
      for (let q = 0; q < r.p.length - 1; q++) {
        const [x0, z0] = r.p[q], [x1, z1] = r.p[q + 1];
        const L = Math.hypot(x1 - x0, z1 - z0) || 1, ux = (x1 - x0) / L, uz = (z1 - z0) / L;
        for (let d = 3; d < L; d += 8) {
          const x = x0 + ux * d, z = z0 + uz * d, off = r.w / 2 + 2;
          n++;
          if (nearSw(x + uz * off, z - ux * off, 2.8)) nl++; // left normal (x right, z down) = (uz, -ux)
          if (nearSw(x - uz * off, z + ux * off, 2.8)) nr++;
        }
      }
      const hasL = n && nl / n > 0.45, hasR = n && nr / n > 0.45;
      if (hasL && hasR) { r.sw = 0; mapped++; } else if (hasL) { r.sw = 3; mapped++; } else if (hasR) { r.sw = 2; mapped++; } else { r.sw = 1; dflt++; }
    }
    areaStats._swMapped = mapped; areaStats._swDefault = dflt;
  }
  // ---- crossings: [x, z, angleDeg (direction ACROSS the road), length, marked]
  const crossings = [];
  {
    const seenC = new Set();
    const nearRoad = (x, z) => {
      let best = null, bd = 12;
      for (const r of roads) {
        if (r.k === 'footway' || r.k === 'rail' || r.k === 'pedestrian') continue;
        for (let q = 0; q < r.p.length - 1; q++) {
          const [x0, z0] = r.p[q], [x1, z1] = r.p[q + 1];
          const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
          const d = Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
          if (d < bd) { bd = d; best = { r, ang: Math.atan2(dz, dx) }; }
        }
      }
      return best;
    };
    const ways = [];
    for (const el of osmCross.elements) {
      const tags = el.tags || {};
      const marked = !/^(unmarked|no)$/.test(tags.crossing || '') && tags['crossing:markings'] !== 'no' ? 1 : 0;
      if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
        const g = geomToLocal(el.geometry);
        const a = g[0], b = g[g.length - 1];
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!inBounds(c)) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 2 || L > 40) continue;
        ways.push(c);
        const k = r1(c[0]) + ',' + r1(c[1]);
        if (seenC.has(k)) continue; seenC.add(k);
        crossings.push([r1(c[0]), r1(c[1]), Math.round(((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 180), r1(Math.min(L, 24)), marked]);
      }
    }
    for (const el of osmCross.elements) {
      const tags = el.tags || {};
      if (el.type !== 'node') continue;
      const q = proj(el.lon, el.lat);
      if (!inBounds(q)) continue;
      if (ways.some((c) => Math.hypot(c[0] - q[0], c[1] - q[1]) < 7)) continue;
      const nr = nearRoad(q[0], q[1]);
      if (!nr || nr.r.f) continue;
      const marked = !/^(unmarked|no)$/.test(tags.crossing || '') && tags['crossing:markings'] !== 'no' ? 1 : 0;
      const k = r1(q[0]) + ',' + r1(q[1]);
      if (seenC.has(k)) continue; seenC.add(k);
      crossings.push([r1(q[0]), r1(q[1]), Math.round((((nr.ang + Math.PI / 2) * 180) / Math.PI + 360) % 180), r1(Math.min(nr.r.w + 1, 24)), marked]);
    }
  }

  // ---- trees
  const trees = [];
  for (const el of osmMisc.elements) {
    const tags = el.tags || {};
    if (el.type === 'node' && tags.natural === 'tree') {
      const p = proj(el.lon, el.lat);
      if (inBounds(p)) trees.push([r1(p[0]), r1(p[1])]);
    } else if (el.type === 'way' && tags.natural === 'tree_row' && el.geometry) {
      const pts = geomToLocal(el.geometry);
      let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = carry; d < L; d += 8) {
          const t = L ? d / L : 0;
          const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
          if (inBounds(p)) trees.push([r1(p[0]), r1(p[1])]);
          carry = d + 8 - L;
        }
      }
    }
  }
  {
    const seen = new Set();
    for (let i = trees.length - 1; i >= 0; i--) {
      const k = trees[i][0] + ',' + trees[i][1];
      if (seen.has(k)) trees.splice(i, 1); else seen.add(k);
    }
  }

  // ---- districts: forest / park cover has few mapped trees -> scatter swallowable trees (deterministic, off roads / buildings / water)
  let synthTrees = 0;
  if (!IS_CENTRE) {
    const RES = 2, gW = Math.ceil((B.maxX - B.minX) / RES), gH = Math.ceil((B.maxZ - B.minZ) / RES);
    const g = new Grid(B.minX, B.minZ, gW, gH, RES), occ = new Uint8Array(gW * gH);
    for (const b of buildings) fillPolys(g, occ, [b.p], 1);
    for (const w of water) fillPolys(g, occ, [w.p, ...(w.h || [])], 1);
    for (const r of roads) if (r.k !== 'rail' || true) strokeLine(g, occ, r.p, Math.max(1.3, (r.w || 4) / 2 + 1.2), 1);
    for (const t of trees) { const i = Math.floor(g.ix(t[0])), j = Math.floor(g.iz(t[1])); if (i >= 0 && j >= 0 && i < gW && j < gH) occ[j * gW + i] = 1; }
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const CAP = 9000;
    const scatter = (poly, step) => {
      const bb = bbOf(poly.p);
      for (let z = bb[1]; z < bb[3] && trees.length < CAP + 3000; z += step) for (let x = bb[0]; x < bb[2]; x += step) {
        const px = x + (rnd() - 0.5) * step * 0.9, pz = z + (rnd() - 0.5) * step * 0.9;
        if (!inBounds([px, pz]) || !pip([px, pz], poly.p) || (poly.h || []).some((h) => pip([px, pz], h))) continue;
        const i = Math.floor(g.ix(px)), j = Math.floor(g.iz(pz));
        if (i < 0 || j < 0 || i >= gW || j >= gH || occ[j * gW + i]) continue;
        occ[j * gW + i] = 1;
        trees.push([r1(px), r1(pz)]); synthTrees++;
      }
    };
    for (const a of areas) if (a.c === 'wd' && Math.abs(area2(a.p)) > 800) scatter(a, 11);
    for (const pk of parks) if (Math.abs(area2(pk.p)) > 2500) scatter(pk, 19);
  }

  // ---- landmarks
  const lmCand = [];
  const REQ_LM = /Nacionālā bibliotēka|Saules akmens|Preses nams|asažieru osta|Uzvaras parks/i;
  const rankOf = (t) => (t.tourism === 'attraction' ? 0 : t.historic ? 1 : t.man_made === 'tower' ? 2 : 3);
  for (const el of osmMisc.elements) {
    const tags = el.tags || {};
    if (!tags.name || tags.natural === 'tree') continue;
    const required = REQ_LM.test(tags.name) && (tags.building || tags.leisure || tags.tourism || tags.man_made);
    if (!(required || tags.tourism === 'attraction' || tags.historic || tags.amenity === 'place_of_worship' || tags.man_made === 'tower')) continue;
    let pt;
    if (el.type === 'node') pt = proj(el.lon, el.lat);
    else if (el.type === 'way' && el.geometry) pt = centroid(geomToLocal(el.geometry));
    else continue;
    if (!inBounds(pt)) continue;
    lmCand.push({ n: tags.name, pt, tags, rank: required ? -1 : rankOf(tags) });
  }
  lmCand.sort((a, b) => a.rank - b.rank);
  const landmarks = [];
  const lmNames = new Set();
  for (const c of lmCand) {
    if (lmNames.has(c.n)) continue;
    if (landmarks.length >= 56) break;
    lmNames.add(c.n);
    let h = parseHeight(c.tags.height);
    if (!h) {
      const hit = buildings.find((b) => pip(c.pt, b.p));
      if (hit && c.tags.amenity === 'place_of_worship') h = hit.h < 25 ? hit.h + 8 : hit.h; // steeple allowance
      else if (hit) h = hit.h;
    }
    if (!h) h = c.tags.amenity === 'place_of_worship' ? 30 : c.tags.historic === 'monument' ? 15 : 20;
    landmarks.push({ n: c.n, x: r1(c.pt[0]), z: r1(c.pt[1]), h: r1(Math.max(2.5, Math.min(130, h))) });
  }
  // curated additions (buildings without a usable OSM name): matched by cadastre address
  for (const c of !IS_CENTRE ? [] : [{ n: 'Saules akmens', addr: 'Balasta dambis 2', h: 123 }, { n: 'Preses nams', addr: 'Balasta dambis 2 k-2', h: 66 }, { n: 'Z-Towers', addr: 'Raņķa dambis 30', h: 123 }]) {
    if (landmarks.some((l) => l.n === c.n)) continue;
    const bd = buildings.find((q) => q.n === c.addr);
    if (!bd) continue;
    const ct = centroid(bd.p);
    landmarks.push({ n: c.n, x: r1(ct[0]), z: r1(ct[1]), h: c.h });
  }
  if (!IS_CENTRE) {
    // districts: top up with OSM-named buildings (schools, halls, markets, shops ...) so each map has plenty of named things for the album
    const have = new Set(landmarks.map((l) => l.n));
    const cands = osmBuildings.filter((o) => o.name && inBounds(o.c) && !have.has(o.name) && o.area >= 250).sort((a, b) => b.area - a.area);
    for (const o of cands) {
      if (landmarks.length >= 24) break;
      if (have.has(o.name)) continue;
      have.add(o.name);
      const hit = buildings.find((b) => pip(o.c, b.p));
      landmarks.push({ n: o.name, x: r1(o.c[0]), z: r1(o.c[1]), h: r1(Math.max(6, Math.min(60, (hit && hit.h) || o.h || 12))) });
    }
  } else {
    const fm = landmarks.find((l) => /Brīvības piemineklis|Freedom Monument/i.test(l.n));
    if (fm) { fm.h = 42; }
    else landmarks.unshift({ n: 'Brīvības piemineklis', x: 0, z: 0, h: 42 });
  }

  // ---- tramways + stops (optional arrays)
  const tramways = [], stops = [];
  if (osmTransit) {
    const seenStop = new Set();
    for (const el of osmTransit.elements) {
      const tags = el.tags || {};
      if (el.type === 'way' && tags.railway === 'tram' && el.geometry && !/^(abandoned|disused|construction)$/.test(tags.service || '')) {
        // keep runs inside the bounds
        let run = [];
        const flush = () => { if (run.length > 1) tramways.push({ p: run }); run = []; };
        for (const g of el.geometry) {
          const q = proj(g.lon, g.lat);
          if (inBounds(q)) run.push([r1(q[0]), r1(q[1])]); else flush();
        }
        flush();
      } else if (el.type === 'node' && (tags.highway === 'bus_stop' || tags.railway === 'tram_stop' || (tags.public_transport === 'stop_position' && tags.tram === 'yes'))) {
        const q = proj(el.lon, el.lat);
        if (!inBounds(q)) continue;
        const k = r1(q[0]) + ',' + r1(q[1]);
        if (seenStop.has(k)) continue;
        seenStop.add(k);
        stops.push([r1(q[0]), r1(q[1]), tags.railway === 'tram_stop' || tags.tram === 'yes' ? 1 : 0]);
      }
    }
  }

  // ---- output
  const out = {
    meta: {
      name: IS_CENTRE ? 'Rīga centrs' : 'Rīga, ' + MAP.lv,
      slug: MAP.slug,
      mapName: { lv: MAP.lv, en: MAP.en },
      mult: MAP.mult,
      focus: MAP.focus,
      origin: { ...ORIGIN },
      bounds: { ...B },
      generated: new Date().toISOString(),
      sources: [
        'Riga city cadastre buildings (ArcGIS Kadastra_ekas_updated FeatureServer)',
        'OpenStreetMap contributors via Overpass API (ODbL)',
        'LĢIA open-data orthophoto cycle 6 (2016-2018), CC BY 4.0, measured only (tools/surface -> riga-ground.png)',
      ],
      credit: 'Building footprints (cadastre), shapes and heights: © Rīgas valstspilsētas pašvaldība (georiga.eu). Roads, water, parks, land cover, crossings, trees, tram tracks, stops, names: © OpenStreetMap contributors (ODbL). Ground-cover classification raster (riga-ground.png): derived from the LĢIA orthophoto 2016-2018, CC BY 4.0 (modified).',
      coords: 'x = metres east of origin, z = metres south (z = -north); equirectangular, 1 decimal',
      winding: 'polygon rings are counter-clockwise as plotted with x right, z down (shoelace sum over (x,z) is negative); not closed; single outer ring',
      stats: {},
    },
    buildings, roads, water, parks, trees, landmarks,
    areas,             // optional (iteration 5): ground cover polygons [{c: class, p: outer, h?: holes, s?: surface}] in paint order
    crossings,         // optional: [x, z, angleDeg across the road, length, marked]
    piers,             // optional: cadastre footprints over water (piers / berths), painted as deck
    tramways, stops,   // optional (iteration 3): tramways [{p}], stops [[x,z,isTram]]
  };
  out.meta.stats = {
    buildings: buildings.length,
    buildingsByType: byType,
    heightSource: hSrc,
    cadastreFeaturesFetched: cad.features.length,
    cadastreDropped: dropped,
    buildingNamesFromOsm: namedFromOsm,
    roads: roads.length,
    roadsByKind: roads.reduce((m, r) => ((m[r.k] = (m[r.k] || 0) + 1), m), {}),
    water: water.length,
    waterWithHoles: water.filter((w) => w.h).length,
    parks: parks.length,
    parksWithHoles: parks.filter((w) => w.h).length,
    areas: areas.length,
    areasByClass: areaStats,
    crossings: crossings.length,
    roadsBridge: bridgeRoads,
    trees: trees.length,
    synthTrees,
    landmarks: landmarks.length,
    tramways: tramways.length,
    stops: stops.length,
    piers: piers.length,
    structureFixes: fixStats,
  };
  if (process.env.ROADS_ONLY) {
    // patch mode (ground work): replace ONLY roads + crossings in the existing file; buildings / trees / props / ids stay byte-identical
    const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    cur.roads = roads; cur.crossings = crossings;
    Object.assign(cur.meta.stats, { roads: out.meta.stats.roads, roadsByKind: out.meta.stats.roadsByKind, crossings: crossings.length, roadsBridge: bridgeRoads, roadsTunnel: roads.filter((r) => r.tn).length });
    fs.writeFileSync(OUT, JSON.stringify(cur));
    log(`ROADS_ONLY: patched ${OUT}: roads ${roads.length}, crossings ${crossings.length}, tunnels ${roads.filter((r) => r.tn).length}`);
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const size = fs.statSync(OUT).size;
  out.meta.stats.fileBytes = size;
  log(JSON.stringify(out.meta.stats, null, 1));
  log(`wrote ${OUT} (${(size / 1048576).toFixed(2)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
