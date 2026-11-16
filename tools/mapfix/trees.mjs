// Canopy from the reality-mesh height raster: (1) ground class raster gets canopy (2) / forest (10) where the mesh shows tree-like volume
// outside buildings, carriageways, plazas and water, (2) street / yard / park trees are added to riga.json `trees` ([x, z, crownHeightM, pine?]) from crown peaks,
// (3) the forest class is turned into dense pines at runtime by src/scatter.js. Usage: node tools/mapfix/trees.mjs [slug ...]
import fs from 'node:fs'; import path from 'node:path';
import { Grid, loadDsm, dtm, roughness, readGround, writeGround, loadCity, saveCity, mapInfo, cacheDir, readJson, hash2, SLUGS } from './lib.mjs';
import { ORIGIN } from '../maps.mjs';
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), r1 = (v) => Math.round(v * 10) / 10;
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const CAP = { centrs: 17000, agenskalns: 15000, mezaparks: 2500, purvciems: 0 }; // new street / yard / park trees per map (placement-file budget)
const FOREST_MAPS = new Set(['mezaparks']);
function osmTrees(slug, b) {
  const f = path.join(cacheDir, slug === 'centrs' ? 'osm_misc.json' : `osm_misc_${slug}.json`);
  const els = readJson(f).elements, trees = [], inB = (p) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minZ && p[1] <= b.maxZ;
  for (const el of els) {
    const tags = el.tags || {};
    if (el.type === 'node' && tags.natural === 'tree') { const p = proj(el.lon, el.lat); if (inB(p)) trees.push([r1(p[0]), r1(p[1])]); }
    else if (el.type === 'way' && tags.natural === 'tree_row' && el.geometry) {
      const pts = el.geometry.map((n) => proj(n.lon, n.lat)); let carry = 0;
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], c = pts[i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); for (let d = carry; d < L; d += 8) { const t = L ? d / L : 0, p = [a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])]; if (inB(p)) trees.push([r1(p[0]), r1(p[1])]); carry = d + 8 - L; } }
    }
  }
  const seen = new Set(); return trees.filter((t) => { const k = t[0] + ',' + t[1]; if (seen.has(k)) return false; seen.add(k); return true; });
}
export async function run(slug) {
  const b = mapInfo(slug).bounds, city = loadCity(slug), g = new Grid(b), { W, H } = g;
  const G = await readGround(slug); if (G.W !== W || G.H !== H) throw new Error('ground size');
  const dsm = loadDsm(slug), DT = dtm(dsm, 44, true), RG = roughness(dsm);
  const before = { canopy: 0, obs: 0 };
  // tree-like cells on the bounds grid
  const tree = g.mask(), obs = g.mask(), height = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = g.cx(i), z = g.cz(j), di = Math.floor(x - dsm.x0), dj = Math.floor(z - dsm.z0);
    if (di < 0 || dj < 0 || di >= dsm.w || dj >= dsm.h) continue;
    const k = dj * dsm.w + di, v = dsm.d[k]; if (v !== v) continue;
    obs[j * W + i] = 1; const t = DT[k], r = RG[k];
    if (t === t && r === r && v - t >= 3 && r > 1.3) { tree[j * W + i] = 1; height[j * W + i] = v - t; }
  }
  const c0 = G.cls; let o = 0, cn = 0; for (let k = 0; k < c0.length; k++) if (obs[k]) { o++; if (c0[k] === 2 || c0[k] === 10) cn++; }
  before.canopy = cn / o; before.obs = o;
  // exclusions: buildings (+2 m roof lean), carriageways / rails / trams, plazas, water
  const bld = g.mask(); for (const bb of city.buildings) g.fill(bld, [bb.p], 1);
  const bldD = g.dilate(bld, 2);
  const road = g.mask();
  for (const r of city.roads) { if (!r.p || r.p.length < 2) continue; const walk = r.k === 'footway' || r.k === 'pedestrian'; g.stroke(road, r.p, r.k === 'rail' ? 3.2 : walk ? 0.9 : Math.max(2, (r.w || 6) / 2 - 0.3), 1); }
  for (const t of city.tramways || []) g.stroke(road, t.p, 2.2, 1);
  const plaza = g.mask(); for (const a of city.areas || []) if (['sq', 'plat', 'pier', 'brg'].includes(a.c)) g.fill(plaza, [a.p, ...(a.h || [])], 1);
  const parkM = g.mask(); for (const p of city.parks || []) g.fill(parkM, [p.p, ...(p.h || [])], 1);
  const water = g.mask(); for (const w of city.water) { g.fill(water, [w.p], 1); for (const h of w.h || []) g.fill(water, [h], 0); }
  const ok = g.mask();
  for (let k = 0; k < W * H; k++) ok[k] = tree[k] && !bldD[k] && !road[k] && !water[k] && !(plaza[k] && !parkM[k]) && G.cls[k] !== 6 && G.cls[k] !== 7 ? 1 : 0;
  // tidy: a crown cell needs company (>= 25 % of a 5x5 window)
  const dens5 = g.density(ok, 2); for (let k = 0; k < W * H; k++) if (ok[k] && dens5[k] < 0.25) ok[k] = 0;
  const okC = g.mask(); // closing by 1 for the painted class (crowns overlap)
  { const d1 = g.dilate(ok, 1); for (let k = 0; k < W * H; k++) okC[k] = d1[k] && !bldD[k] && !road[k] && !water[k] && !(plaza[k] && !parkM[k]) && G.cls[k] !== 6 && G.cls[k] !== 7 ? 1 : 0; }
  const forestD = g.density(okC, 6), forest = FOREST_MAPS.has(slug);
  let nCan = 0, nFor = 0;
  for (let k = 0; k < W * H; k++) {
    if (!okC[k]) continue;
    G.cls[k] = forest && forestD[k] >= 0.5 ? 10 : 2; if (G.cls[k] === 10) nFor++; else nCan++;
  }
  if (forest) { // large canopy blobs the mesh did not observe (layer edges / holes) but the orthophoto calls canopy: forest as well
    const cand = g.mask(); for (let k = 0; k < W * H; k++) cand[k] = (G.cls[k] === 2 || G.cls[k] === 10) && !bldD[k] && !road[k] ? 1 : 0;
    const dn = g.density(cand, 6);
    for (let k = 0; k < W * H; k++) if (G.cls[k] === 2 && !obs[k] && dn[k] >= 0.55) { G.cls[k] = 10; nFor++; nCan--; }
  }
  // forest map: all class-10 cells that are not tree-like any more are not touched; the dense-pine placement reads class 10 at runtime
  nCan = 0; nFor = 0; for (let k = 0; k < G.cls.length; k++) { if (G.cls[k] === 2) nCan++; else if (G.cls[k] === 10) nFor++; }
  let after = 0; for (let k = 0; k < G.cls.length; k++) if (obs[k] && (G.cls[k] === 2 || G.cls[k] === 10)) after++;
  await writeGround(slug, G);
  // ---- trees for riga.json
  const base = slug === 'mezaparks' ? osmTrees(slug, b) : city.trees.filter((t) => t.length === 2).map((t) => [t[0], t[1]]); // Mežaparks: the 11 m synthetic scatter is replaced by the dense forest (class 10 -> pines at runtime)
  const occ = new Map(), CELL = 12, key = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
  const near = (x, z, r) => { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const l = occ.get(Math.floor(x / CELL + a) * 100003 + Math.floor(z / CELL + c)); if (l) for (const p of l) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < r * r) return true; } return false; };
  const put = (x, z) => { const k = key(x, z); (occ.get(k) || occ.set(k, []).get(k)).push([x, z]); };
  for (const t of base) put(t[0], t[1]);
  const cap = CAP[slug]; let added = [], spacing = 0;
  if (cap > 0 && !forest) {
    // crown peaks: tallest cells first, spacing grows until the budget fits
    const cells = []; for (let k = 0; k < W * H; k++) if (ok[k] && !forestD || (ok[k])) cells.push(k);
    cells.sort((a, c) => height[c] - height[a] || a - c);
    for (const sp of [6, 7, 8, 9, 10, 12, 14]) {
      const o2 = new Map(); const nearNew = (x, z) => { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const l = o2.get(Math.floor(x / sp + a) * 100003 + Math.floor(z / sp + c)); if (l) for (const p of l) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < sp * sp) return true; } return false; };
      const res = [];
      for (const k of cells) {
        const x = g.cx(k % W), z = g.cz((k / W) | 0);
        if (near(x, z, 3.2) || nearNew(x, z)) continue;
        const kk = Math.floor(x / sp) * 100003 + Math.floor(z / sp); (o2.get(kk) || o2.set(kk, []).get(kk)).push([x, z]);
        const h = Math.max(4, Math.min(30, Math.round(height[k])));
        const pine = h >= 15 && hash2(x, z) % 3 === 0 ? 1 : 0;
        res.push(pine ? [r1(x), r1(z), h, 1] : [r1(x), r1(z), h]);
      }
      added = res; spacing = sp; if (res.length <= cap) break;
    }
    if (added.length > cap) added = added.slice(0, cap);
  }
  city.trees = base.concat(added);
  saveCity(slug, city);
  const out = { slug, canopyBefore: +before.canopy.toFixed(3), canopyAfter: +(after / o).toFixed(3), meshTreeShare: +(tree.reduce((s, v) => s + v, 0) / o).toFixed(3), classCanopyCells: nCan, classForestCells: nFor, osmTrees: base.length, added: added.length, spacing, total: city.trees.length };
  console.log(JSON.stringify(out)); return out;
}
if (process.argv[1] === import.meta.filename) { const list = process.argv.slice(2).length ? process.argv.slice(2) : SLUGS; const all = []; for (const s of list) all.push(await run(s)); fs.mkdirSync(path.join(cacheDir, 'mapfix'), { recursive: true }); fs.writeFileSync(path.join(cacheDir, 'mapfix', 'trees.json'), JSON.stringify(all)); }
