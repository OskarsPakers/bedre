#!/usr/bin/env node
// Builds public/data/riga.json (central Riga map data) from the Riga cadastre + OpenStreetMap.
// Node built-ins only. Raw downloads are cached in tools/.cache/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'riga.json');

// ---------------------------------------------------------------- config
const ORIGIN = { lat: 56.9515, lon: 24.1133 };
const HALF = 1200; // metres
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const CADASTRE =
  'https://services-eu1.arcgis.com/JzVauvrMa89dBJ9D/arcgis/rest/services/Kadastra_ekas_updated/FeatureServer/0/query';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'riga-game-data-builder';
const B = { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF };

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
function lonLatBox(pad = 0) {
  const d = HALF + pad;
  return {
    minLon: ORIGIN.lon - d / M_LON,
    maxLon: ORIGIN.lon + d / M_LON,
    minLat: ORIGIN.lat - d / M_LAT,
    maxLat: ORIGIN.lat + d / M_LAT,
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

function hashStr(n) {
  let h = (Number(n) | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- cadastre
async function getCadastre() {
  return cached('cadastre.json', async () => {
    const bb = lonLatBox(0);
    const N = 4;
    const seen = new Map();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = bb.minLon + ((bb.maxLon - bb.minLon) * i) / N, x1 = bb.minLon + ((bb.maxLon - bb.minLon) * (i + 1)) / N;
        const y0 = bb.minLat + ((bb.maxLat - bb.minLat) * j) / N, y1 = bb.minLat + ((bb.maxLat - bb.minLat) * (j + 1)) / N;
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
          for (const f of feats) seen.set(f.properties.objectid_1, f);
          offset += feats.length;
          if (!feats.length || !(gj.properties && gj.properties.exceededTransferLimit)) break;
        }
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
    'osm_buildings.json',
    `(way["building"]["height"];way["building"]["building:levels"];way["building"]["name"];way["building:part"]["height"];way["building:part"]["building:levels"];);out geom;`
  );
  const osmWater = await overpass(
    'osm_water.json',
    `(way["natural"="water"];way["waterway"="riverbank"];relation["natural"="water"];relation["waterway"="riverbank"];relation["water"~"river|canal|lake|pond"]["type"="multipolygon"];);out geom;`
  );
  const osmParks = await overpass(
    'osm_parks.json',
    `(way["leisure"~"^(park|garden)$"];way["landuse"~"^(grass|recreation_ground|village_green)$"];relation["leisure"~"^(park|garden)$"];relation["landuse"~"^(grass|recreation_ground|village_green)$"];);out geom;`
  );
  const osmRoads = await overpass(
    'osm_roads.json',
    `(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|steps|cycleway)$"];way["railway"="rail"];);out geom;`
  );
  const osmMisc = await overpass(
    'osm_misc.json',
    `(node["natural"="tree"];way["natural"="tree_row"];node["name"]["tourism"="attraction"];way["name"]["tourism"="attraction"];node["name"]["historic"~"^(monument|castle|city_gate|tower|fort)$"];way["name"]["historic"~"^(monument|castle|city_gate|tower|fort)$"];node["name"]["amenity"="place_of_worship"];way["name"]["amenity"="place_of_worship"];node["name"]["man_made"="tower"];way["name"]["man_made"="tower"];);out geom;`
  );

  // ---- (iteration 3, additive) tram tracks + public transport stops; failure here must not break the base build
  let osmTransit = null;
  try {
    osmTransit = await overpass(
      'osm_transit.json',
      `(way["railway"="tram"];node["highway"="bus_stop"];node["railway"="tram_stop"];node["public_transport"="stop_position"]["tram"="yes"];);out geom;`
    );
  } catch (e) { log('transit query failed (continuing without tramways/stops):', e.message); }

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

  // ---- water
  const water = [];
  for (const el of osmWater.elements) {
    const wt = el.tags || {};
    if (wt.covered === 'yes' || wt.tunnel === 'yes' || parseFloat(wt.layer) < 0) continue;
    for (const ring of osmRings(el)) {
      if (Math.abs(area2(ring)) < 30) continue;
      let c = clipPoly(ring);
      if (c.length < 3) continue;
      const s = simplifyRing(c, 1);
      if (!s || Math.abs(area2(s)) < 30) continue;
      water.push({ p: orient(s) });
    }
  }

  // helpers for piers / engineering structures
  const waterBB = water.map((w) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const q of w.p) { a = Math.min(a, q[0]); c = Math.max(c, q[0]); b = Math.min(b, q[1]); d = Math.max(d, q[1]); } return [a, b, c, d]; });
  const inWaterPt = (x, z) => { for (let i = 0; i < water.length; i++) { const bb = waterBB[i]; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue; if (pip([x, z], water[i].p)) return true; } return false; };
  const distWater = (x, z, lim) => {
    let best = lim;
    for (let i = 0; i < water.length; i++) {
      const bb = waterBB[i];
      if (x < bb[0] - lim || x > bb[2] + lim || z < bb[1] - lim || z > bb[3] + lim) continue;
      const P = water[i].p;
      for (let k = 0; k < P.length; k++) {
        const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % P.length];
        const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
        best = Math.min(best, Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)));
      }
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
  // ---- parks
  const parks = [];
  for (const el of osmParks.elements) {
    for (const ring of osmRings(el)) {
      if (Math.abs(area2(ring)) < 20) continue;
      const c = clipPoly(ring);
      if (c.length < 3) continue;
      const s = simplifyRing(c, 1);
      if (!s || Math.abs(area2(s)) < 20) continue;
      parks.push({ p: orient(s) });
    }
  }

  // ---- roads
  const roads = [];
  const DEF_W = { motorway: 14, primary: 14, secondary: 11, tertiary: 9, residential: 7, service: 4, pedestrian: 5, footway: 2, rail: 3 };
  const KMAP = {
    motorway: 'motorway', motorway_link: 'motorway', trunk: 'primary', trunk_link: 'primary',
    primary: 'primary', primary_link: 'primary', secondary: 'secondary', secondary_link: 'secondary',
    tertiary: 'tertiary', tertiary_link: 'tertiary', unclassified: 'residential', residential: 'residential',
    living_street: 'residential', service: 'service', pedestrian: 'pedestrian',
    footway: 'footway', path: 'footway', steps: 'footway', cycleway: 'footway',
  };
  for (const el of osmRoads.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    let k;
    if (tags.railway === 'rail') {
      if (tags.tunnel === 'yes') continue;
      k = 'rail';
    } else {
      k = KMAP[tags.highway];
      if (!k) continue;
      if (tags.tunnel === 'yes' && (k === 'footway' || k === 'service')) continue;
      if (tags.area === 'yes') continue;
    }
    let w = parseHeight(tags.width);
    if (!w) {
      const lanes = parseFloat(tags.lanes);
      w = isFinite(lanes) && lanes > 0 && !['footway', 'rail', 'pedestrian'].includes(k) ? lanes * 3.4 + 0.6 : DEF_W[k];
    }
    w = Math.max(1.5, Math.min(40, w));
    const pts = geomToLocal(el.geometry);
    for (const seg of clipLine(pts)) {
      const s = dedupe(dpSimplify(dedupe(seg.map((p) => [r1(p[0]), r1(p[1])]), false), 1), false);
      if (s.length < 2) continue;
      const len = polyLen(s);
      if ((k === 'footway') && len < 15) continue;
      if (len < 2) continue;
      roads.push({ p: s, w: r1(w), k });
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

  // ---- landmarks
  const lmCand = [];
  const rankOf = (t) => (t.tourism === 'attraction' ? 0 : t.historic ? 1 : t.man_made === 'tower' ? 2 : 3);
  for (const el of osmMisc.elements) {
    const tags = el.tags || {};
    if (!tags.name || tags.natural === 'tree') continue;
    if (!(tags.tourism === 'attraction' || tags.historic || tags.amenity === 'place_of_worship' || tags.man_made === 'tower')) continue;
    let pt;
    if (el.type === 'node') pt = proj(el.lon, el.lat);
    else if (el.type === 'way' && el.geometry) pt = centroid(geomToLocal(el.geometry));
    else continue;
    if (!inBounds(pt)) continue;
    lmCand.push({ n: tags.name, pt, tags, rank: rankOf(tags) });
  }
  lmCand.sort((a, b) => a.rank - b.rank);
  const landmarks = [];
  const lmNames = new Set();
  for (const c of lmCand) {
    if (lmNames.has(c.n)) continue;
    if (landmarks.length >= 40) break;
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
  const fm = landmarks.find((l) => /Brīvības piemineklis|Freedom Monument/i.test(l.n));
  if (fm) { fm.h = 42; }
  else landmarks.unshift({ n: 'Brīvības piemineklis', x: 0, z: 0, h: 42 });

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
      name: 'Rīga centrs',
      origin: { ...ORIGIN },
      bounds: { ...B },
      generated: new Date().toISOString(),
      sources: [
        'Riga city cadastre buildings (ArcGIS Kadastra_ekas_updated FeatureServer)',
        'OpenStreetMap contributors via Overpass API (ODbL)',
      ],
      credit: 'Building footprints (cadastre), shapes and heights: © Rīgas valstspilsētas pašvaldība (georiga.eu). Roads, water, parks, trees, tram tracks, stops, names: © OpenStreetMap contributors (ODbL).',
      coords: 'x = metres east of origin, z = metres south (z = -north); equirectangular, 1 decimal',
      winding: 'polygon rings are counter-clockwise as plotted with x right, z down (shoelace sum over (x,z) is negative); not closed; single outer ring',
      stats: {},
    },
    buildings, roads, water, parks, trees, landmarks,
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
    parks: parks.length,
    trees: trees.length,
    landmarks: landmarks.length,
    tramways: tramways.length,
    stops: stops.length,
    piers: piers.length,
    structureFixes: fixStats,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const size = fs.statSync(OUT).size;
  out.meta.stats.fileBytes = size;
  log(JSON.stringify(out.meta.stats, null, 1));
  log(`wrote ${OUT} (${(size / 1048576).toFixed(2)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
