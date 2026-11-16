// Building-level fixes from the reality-mesh height raster and the review (docs/qa/map-review.md): phantoms (M-07), flat slabs (M-05), courts / vacant lots (M-06),
// under-rendered aux (M-20), Daugava stadium (M-03), missing buildings from OSM footprints (M-16..18). Operates on public/data/<map>/riga.json (idempotent: it
// only touches what the rules still flag), paints the freed ground into riga-ground.png and writes a report to tools/.cache/mapfix/buildings-<map>.json.
//   node tools/mapfix/buildings.mjs [slug ...]      needs tools/.cache/qa-map/{bld,missing}-<slug>.json + dsm-<slug>.f32 (tools/qa-map)
import fs from 'node:fs'; import path from 'node:path';
import { Grid, loadDsm, dtm, roughness, readGround, writeGround, loadCity, saveCity, mapInfo, cacheDir, readJson, pip, area as ringArea, SLUGS } from './lib.mjs';
import { ORIGIN } from '../maps.mjs';
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), r1 = (v) => Math.round(v * 10) / 10;
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const QC = path.join(cacheDir, 'qa-map');
// the reviewer's "date?" items: the mesh predates them (Heart of Hanza, Atea / Strēlnieku 4C complex): they keep their cadastre height
const DATE_KEEP = new Set([49618404, 49618762, 49618771]);
const COURTS = new Set([49612645, 49612201, 49612202]); // tennis courts (clay): ground art, not buildings
const STADIUM = [49612275, 49614046, 49612274];
const centroid = (r) => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
function osmFootprints(slug) {
  const files = slug === 'centrs' ? ['osm_buildings.json', 'osm_buildings_v2.json'] : [`osm_buildings_${slug}.json`];
  const out = new Map();
  for (const f of files) { const p = path.join(cacheDir, f); if (!fs.existsSync(p)) continue; for (const el of readJson(p).elements) if (el.type === 'way' && el.geometry && el.tags && (el.tags.building || el.tags['building:part'])) out.set(el.id, { id: el.id, tags: el.tags, p: el.geometry.map((n) => proj(n.lon, n.lat)) }); }
  return [...out.values()];
}
const recent = (t) => { const y = parseInt((t['start_date'] || t['construction_date'] || '').slice(0, 4)); return (y >= 2019) || /^(construction|proposed)$/.test(t.building || '') || !!t.construction || !!t['building:construction']; };
function hull(pts) { const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } up.pop(); lo.pop(); return lo.concat(up); }
/** greedy maximal axis-aligned rectangles in a boolean grid: [{i0,j0,i1,j1}] */
function rects(mask, W, H, minSide, maxN) {
  const out = [], m = Uint8Array.from(mask);
  for (let n = 0; n < maxN; n++) {
    let best = null, bestA = 0; const hgt = new Int32Array(W);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) hgt[i] = m[j * W + i] ? hgt[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= W; i++) { const h = i < W ? hgt[i] : 0; let start = i; while (st.length && st[st.length - 1][1] >= h) { const [s, hh] = st.pop(); const a = (i - s) * hh; if (a > bestA && i - s >= minSide && hh >= minSide) { bestA = a; best = { i0: s, i1: i - 1, j0: j - hh + 1, j1: j }; } start = s; } st.push([start, h]); }
    }
    if (!best) break; out.push(best);
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) m[j * W + i] = 0;
  }
  return out;
}
export async function run(slug) {
  const b = mapInfo(slug).bounds, city = loadCity(slug), g = new Grid(b);
  const B = readJson(path.join(QC, `bld-${slug}.json`)), byId = new Map(city.buildings.map((x) => [x.id, x]));
  const dsm = loadDsm(slug), DT = dtm(dsm, 44, true), RG = roughness(dsm), G = await readGround(slug);
  const osm = osmFootprints(slug);
  const oBox = osm.map((o) => { let a = 1e9, c = 1e9, e = -1e9, f = -1e9; for (const [x, z] of o.p) { a = Math.min(a, x); c = Math.min(c, z); e = Math.max(e, x); f = Math.max(f, z); } return [a, c, e, f]; });
  const evidence = (bld) => { const c = centroid(bld.p); for (let k = 0; k < osm.length; k++) { const bx = oBox[k]; if (c[0] < bx[0] - 3 || c[0] > bx[2] + 3 || c[1] < bx[1] - 3 || c[1] > bx[3] + 3) continue; if (recent(osm[k].tags) && (pip(...c, osm[k].p) || pip(...centroid(osm[k].p), bld.p))) return osm[k].tags.start_date || osm[k].tags.building; } return null; };
  const rep = { slug, removed: [], shed: [], keptDate: [], under: [], stadium: null, added: [], skipped: [] };
  const art = []; // [ring, cls | null (= neighbour majority)]
  const drop = new Set();
  for (const r of B) {
    const bd = byId.get(r.id); if (!bd || r.m50 === undefined) continue;
    if (STADIUM.includes(r.id)) continue;
    const named = !!(r.lm || (r.sight && (r.sight.tier === 0 || r.sight.tier === 'A')));
    const flat = r.cover >= 0.5 && r.n >= 20 && r.mMean <= 2.5 && r.m50 <= 1.5;
    const phantom = flat && r.rMean >= 6 && !named;
    const park = r.t === 'aux' && r.area >= 2000 && r.cover >= 0.5 && r.f3 !== undefined && r.f3 < 0.35 && r.rMean >= 2.5 && !named; // a huge aux piece that is mostly open ground (park / plaza around a real building, e.g. the plate around the Stradiņš hospital)
    const slab = r.cover >= 0.5 && r.n >= 20 && r.area >= 800 && r.m90 < 2 && r.rMax >= 2.5 && !named && r.t !== 'ind';
    if (COURTS.has(r.id)) { drop.add(r.id); art.push([bd.p, 5]); rep.removed.push([r.id, 'court', r.area]); continue; }
    if (!phantom && !slab && !park) continue;
    const ev = evidence(bd);
    if (DATE_KEEP.has(r.id) || ev) { rep.keptDate.push([r.id, bd.n, r.area, r.rMean, DATE_KEEP.has(r.id) ? 'reviewer date?' : 'OSM ' + ev]); continue; }
    if (slab || park || r.area >= 800 || (r.t === 'aux' && (r.area >= 300 || (r.mMean < 0.8 && r.m90 < 1.5)))) { drop.add(r.id); art.push([bd.p, null]); rep.removed.push([r.id, slab ? 'slab' : park ? 'park-plate' : 'phantom', r.area, r.rMean]); }
    else { bd.t = 'aux'; bd.h = 3; rep.shed.push([r.id, r.area, r.rMean]); }
  }
  // under-rendered aux podiums (M-20): the mesh shows a real volume
  for (const r of B) { const bd = byId.get(r.id); if (!bd || drop.has(r.id) || r.t !== 'aux' || r.mMean === undefined || r.cover < 0.6 || r.treeF > 0.5) continue; if (r.area >= 800 && r.mMean - r.rMean > 6 && r.m50 >= 8) { bd.h = Math.round(Math.min(45, r.m50) * 10) / 10; rep.under.push([r.id, r.area, r.rMean, bd.h]); } }
  // ---- stadium (Āgenskalns): pitch + track on the ground, low stands from the smooth mesh volumes
  const st = STADIUM.map((id) => byId.get(id)).filter(Boolean);
  if (st.length) {
    const un = g.mask(); for (const s of st) g.fill(un, [s.p], 1);
    const others = g.mask(); for (const x of city.buildings) if (!STADIUM.includes(x.id) && !(x.id >= 52000000000 && x.id < 52000001000)) g.fill(others, [x.p], 1);
    const othersD = g.dilate(others, 1);
    const near = g.dilate(un, 8), flat = g.mask(), tall = g.mask();
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) { const k = j * g.W + i; if (!un[k]) continue; const di = Math.floor(g.cx(i) - dsm.x0), dj = Math.floor(g.cz(j) - dsm.z0), q = dj * dsm.w + di, v = dsm.d[q]; if (v === v && v - DT[q] < 1.6) flat[k] = 1; }
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) { const k = j * g.W + i; if (!near[k]) continue; const di = Math.floor(g.cx(i) - dsm.x0), dj = Math.floor(g.cz(j) - dsm.z0), q = dj * dsm.w + di, v = dsm.d[q], hh = v - DT[q]; if (v === v && hh >= 2.5 && RG[q] <= 1.3 && hh <= 25 && !othersD[k]) tall[k] = 1; }
    // pitch: the flat core of the footprint; track: a 7 m band inside it
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const cells = [];
    for (let k = 0; k < flat.length; k++) if (flat[k]) { const i = k % g.W, j = (k / g.W) | 0; cells.push([i, j]); x0 = Math.min(x0, i); x1 = Math.max(x1, i); z0 = Math.min(z0, j); z1 = Math.max(z1, j); }
    const inner = g.mask(); // erode flat by 1 repeatedly via distance (chamfer)
    const dist = new Float32Array(g.W * g.H).fill(1e6); for (const [i, j] of cells) dist[j * g.W + i] = 1e3;
    const bnd = []; for (const [i, j] of cells) { const k = j * g.W + i; if (!flat[k - 1] || !flat[k + 1] || !flat[k - g.W] || !flat[k + g.W]) { dist[k] = 0; } }
    for (let pass = 0; pass < 2; pass++) { for (let j = 1; j < g.H - 1; j++) for (let i = 1; i < g.W - 1; i++) { const k = j * g.W + i; if (!flat[k]) continue; dist[k] = Math.min(dist[k], dist[k - 1] + 1, dist[k - g.W] + 1, dist[k - g.W - 1] + 1.41, dist[k - g.W + 1] + 1.41); } for (let j = g.H - 2; j > 0; j--) for (let i = g.W - 2; i > 0; i--) { const k = j * g.W + i; if (!flat[k]) continue; dist[k] = Math.min(dist[k], dist[k + 1] + 1, dist[k + g.W] + 1, dist[k + g.W + 1] + 1.41, dist[k + g.W - 1] + 1.41); } }
    let nT = 0, nP = 0; for (const [i, j] of cells) { const k = j * g.W + i; if (dist[k] <= 7) { G.cls[k] = 9; nT++; } else { G.cls[k] = 1; nP++; } void inner; }
    // stands: smooth tall mesh cells next to the footprint, minus what is flat
    const stand = g.mask(); for (let k = 0; k < stand.length; k++) stand[k] = tall[k] && !flat[k] ? 1 : 0;
    const rs = rects(stand, g.W, g.H, 5, 10).filter((rc) => (rc.i1 - rc.i0 + 1) * (rc.j1 - rc.j0 + 1) >= 80), newB = [];
    for (const rc of rs) {
      const vals = []; for (let j = rc.j0; j <= rc.j1; j++) for (let i = rc.i0; i <= rc.i1; i++) { const di = Math.floor(g.cx(i) - dsm.x0), dj = Math.floor(g.cz(j) - dsm.z0), q = dj * dsm.w + di; vals.push(dsm.d[q] - DT[q]); }
      vals.sort((a, c) => a - c); const hm = vals[Math.floor(vals.length * 0.6)];
      const X0 = g.x0 + rc.i0, X1 = g.x0 + rc.i1 + 1, Z0 = g.z0 + rc.j0, Z1 = g.z0 + rc.j1 + 1;
      newB.push({ id: 52000000000 + newB.length + 1, p: [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], h: r1(Math.max(3.5, Math.min(14, hm))), t: 'oth', n: 'Daugavas stadions (tribīne)' });
    }
    city.buildings = city.buildings.filter((x) => !STADIUM.includes(x.id) && !(x.id >= 52000000000 && x.id < 52000001000)).concat(newB);
    rep.stadium = { removed: st.length, trackCells: nT, pitchCells: nP, stands: newB.map((x) => [x.p[0][0], x.p[0][1], r1(x.p[2][0] - x.p[0][0]), r1(x.p[2][1] - x.p[0][1]), x.h]) };
    for (const s of st) byId.delete(s.id);
  }
  city.buildings = city.buildings.filter((x) => !drop.has(x.id));
  // ---- ground art for freed footprints: the neighbouring majority class (paving default)
  const cur = g.mask(); for (const x of city.buildings) g.fill(cur, [x.p], 1);
  for (const [ring, cls] of art) {
    const m = g.mask(); g.fill(m, [ring], 1); let c = cls;
    if (c === null) {
      const d6 = g.dilate(m, 6), cnt = new Array(16).fill(0);
      for (let k = 0; k < m.length; k++) if (d6[k] && !m[k] && !cur[k]) cnt[G.cls[k]]++;
      cnt[0] = 0; cnt[6] = 0; cnt[7] = 0; cnt[2] = Math.round(cnt[2] * 0.5); c = cnt.indexOf(Math.max(...cnt)); if (!cnt[c]) c = 4;
    }
    for (let k = 0; k < m.length; k++) if (m[k]) G.cls[k] = c;
  }
  // ---- missing buildings: mesh volumes without a footprint that have an OSM footprint (cadastre dropped them as small / outside)
  const MS = readJson(path.join(QC, `missing-${slug}.json`)).filter((r) => r.area >= 80 && r.canopy < 0.3 && r.maxH >= 5 && r.fill >= 0.4 && r.wall >= 0.35);
  const occ = g.mask(); for (const x of city.buildings) g.fill(occ, [x.p], 1);
  let seq = 0; const have = new Set(city.buildings.map((x) => x.id));
  for (const m of MS) {
    let hit = -1, bestD = 1e9;
    for (let k = 0; k < osm.length; k++) { const bx = oBox[k]; if (m.x < bx[0] - 6 || m.x > bx[2] + 6 || m.z < bx[1] - 6 || m.z > bx[3] + 6) continue; const c = centroid(osm[k].p), d = Math.hypot(c[0] - m.x, c[1] - m.z); if (d < bestD && d < 12) { bestD = d; hit = k; } }
    if (hit < 0) { rep.skipped.push([m.x, m.z, m.area, 'no OSM footprint']); continue; }
    const o = osm[hit], id = 51000000000 + o.id % 1000000000; if (have.has(id)) continue;
    const ring = o.p.map((p) => [r1(p[0]), r1(p[1])]); const ar = Math.abs(ringArea(ring));
    const m2 = g.mask(); g.fill(m2, [ring], 1); let ov = 0, nn = 0; for (let k = 0; k < m2.length; k++) if (m2[k]) { nn++; if (occ[k]) ov++; }
    if (ar < 40 || nn === 0 || ov / nn > 0.2) { rep.skipped.push([m.x, m.z, m.area, ar < 40 ? 'footprint < 40 m2' : 'overlaps an existing footprint']); continue; }
    const t = /garage|shed|hut|roof|carport|service/.test(o.tags.building) ? 'aux' : /industrial|warehouse|retail|commercial|office/.test(o.tags.building) ? 'ind' : 'res';
    const lv = parseFloat(o.tags['building:levels']), h = o.tags.height ? parseFloat(o.tags.height) : null;
    city.buildings.push({ id, p: ring, h: r1(Math.max(3, Math.min(60, m.meanH * 1.15))), t, n: o.tags['addr:street'] ? `${o.tags['addr:street']} ${o.tags['addr:housenumber'] || ''}`.trim() : undefined });
    if (!city.buildings[city.buildings.length - 1].n) delete city.buildings[city.buildings.length - 1].n;
    have.add(id); g.fill(occ, [ring], 1); rep.added.push([id, r1(m.x), r1(m.z), Math.round(ar), r1(m.meanH), o.tags.building, lv || h || null]); seq++;
  }
  for (const x of city.buildings) if (x.id >= 51000000000 && x.id < 52000000000) for (let k = 0; k < 0; k++); // (paint the new footprints' interior as paving: done by the ground builder's "neutral" rule already)
  saveCity(slug, city); await writeGround(slug, G);
  fs.mkdirSync(path.join(cacheDir, 'mapfix'), { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'mapfix', `buildings-${slug}.json`), JSON.stringify(rep, null, 1));
  console.log(slug, 'removed', rep.removed.length, 'shed', rep.shed.length, 'kept(date?)', rep.keptDate.length, 'under', rep.under.length, 'stadium', rep.stadium ? JSON.stringify(rep.stadium).slice(0, 160) : '-', 'added', rep.added.length, 'skipped', rep.skipped.length);
  return rep;
}
if (process.argv[1] === import.meta.filename) { const list = process.argv.slice(2).length ? process.argv.slice(2) : SLUGS; for (const s of list) await run(s); }
