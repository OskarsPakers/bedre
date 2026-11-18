// The tram game's own city: re-builds every building of the engine's world as the tram game's own meshes (street-level detail near the tracks, cheap re-skin beyond).
//   const city = await buildTramCity({ THREE, scene, world, data, slug, routes })      -> { group, update(camera), stats }
// Input is the engine's building BATCH (read only: positions / normals / colours of each building's geometry): its roofs, spires and domes are kept (re-coloured), its
// ground-based wall faces are replaced by this module's facades (shader window grid for every building, relief geometry for corridor buildings). The hole game is not
// involved: this module is imported by the tram game only; nothing in src/buildings.js etc. is touched.
import * as THREE from 'three';
import { Acc } from './acc.js';
import { archExtras, emitLo, emitFromPlan, planGeneric, planMeasured, chimney, portico, archGable, grandFacade, lin } from './facade.js';
import { makeLoMaterial, makeHiMaterial } from './material.js';
import { loadLook, loadCorridor, loadFacades, restore } from './look.js';
import { CURATED } from './curated.js';
import { sigFacade, tower } from './signature/gen.js';
import { ASSETS } from './signature/assets.js';
import { loadSigAsset, buildSigGeometries } from './signature/asset.js';

const SIGA = typeof location === 'undefined' || new URLSearchParams(location.search).get('sig') !== '0';   // ?sig=0: no packed signature assets (round-4 recipes only)
const SIGLOD = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('siglod');   // ?siglod=0|1|2 forces one LOD of the signature assets (sheets)
const R4 = typeof location === 'undefined' || new URLSearchParams(location.search).get('r4') !== '0';   // ?r4=0: round-3 look (no signature recipes / archetypes) for before / after sheets
const CH = 150;                      // chunk size, metres
const CORRIDOR_DETAIL = 72;          // an edge gets relief geometry only within this distance of a track
const PLASTER = [0xd9cdb0, 0xe0d4b8, 0xcfc4a8, 0xe3d9c2, 0xd6c3a0, 0xc9b8a0, 0xdcd2c4, 0xd8c8a8, 0xe4d2a8, 0xcdbfae, 0xc9c8c2, 0xdcbfb0, 0xd6b784, 0xe6dca8, 0xbcc4b4, 0xc3c9cf, 0xd3cfc6, 0xdfc6b4];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)); return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
function inPoly(x, z, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }

function matchRun(runs, E) {
  let best = null, bp = 0.9;
  for (const r of runs) {
    const tx = (r.b[0] - r.a[0]) / r.len, tz = (r.b[1] - r.a[1]) / r.len; if (tx * E.dx + tz * E.dz < 0.97) continue;
    const rx = E.lx - r.a[0], rz = E.lz - r.a[1], perp = Math.abs(rx * tz - rz * tx), uOff = rx * tx + rz * tz;
    if (perp < bp && uOff > -0.9 && uOff + E.len < r.len + 0.9) { bp = perp; best = { r, rows: r.rows, col: r.col, uOff }; }
  }
  return best;
}

export async function buildTramCity({ scene, world, slug, routes = [], phone = false }) {
  const t0 = performance.now();
  const [look, corridor, facades, sigLoaded] = await Promise.all([loadLook(slug), loadCorridor(slug), loadFacades(slug), SIGA ? Promise.all(Object.entries(ASSETS).filter(([, a]) => a.maps.includes(slug)).map(async ([k, a]) => [k, a, await loadSigAsset(a.file)])) : []]);
  const sigReady = sigLoaded.filter((e) => e[2]), sigHide = new Set(); for (const [, a] of sigReady) for (const id of a.ids) sigHide.add(id);
  const tLoad = performance.now() - t0;
  const bm = world.buildingMesh, G = bm.geometry, items = world.buildingItems;
  const P = G.attributes.position.array, N = G.attributes.normal.array, C = G.attributes.color.array, W = G.attributes.aWin.array, IDX = G.index.array, ns = G.attributes.normal.itemSize;
  bm.visible = false; // the hole game's mesh is never drawn here (its geometry is only read below)

  const tracks = []; for (const r of routes) if (r.map === slug) { tracks.push(r.path); for (const a of r.ai || []) tracks.push(a.path); }
  const trackDist = (x, z) => { let b = Infinity; for (const p of tracks) for (let i = 0; i + 1 < p.length; i++) { if (Math.abs(p[i][0] - x) > 400 || Math.abs(p[i][1] - z) > 400) continue; const d = segD(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]); if (d < b) b = d; } return b; };

  // corridor buildings' rings for the "is this wall a party wall / courtyard" test
  const cor = items.filter((it) => corridor.has(it.id));
  const boxes = cor.map((it) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of it.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; });
  const covered = (x, z, self) => { for (let i = 0; i < cor.length; i++) { const b = boxes[i]; if (cor[i] !== self && x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inPoly(x, z, cor[i].ring)) return true; } return false; };

  const chunks = new Map();
  const chunkOf = (x, z) => { const k = Math.floor(x / CH) + ',' + Math.floor(z / CH); let c = chunks.get(k); if (!c) chunks.set(k, (c = { lo: new Acc(true), hi: new Acc(false), x0: Math.floor(x / CH) * CH, z0: Math.floor(z / CH) * CH })); return c; };
  const stats = { heroes: 0, measuredEdges: 0, genericEdges: 0, measuredWindows: 0, colourEdges: 0, buildings: 0, corridor: 0, sampledWall: 0, sampledRoof: 0, curated: 0, edgesLo: 0, edgesHi: 0, hiTris: 0, rhythm: 0 };
  const range = {}; const noA = [0, 0, 0, 0], noB = [0, 0, 0, 0];
  const tri3 = [0, 0, 0], key = (v) => Math.round(v * 100);

  for (const it of items) {
    if (it.gidShape == null || it.gidShape < 0) continue;
    stats.buildings++;
    if (sigHide.has(it.id)) { stats.sigHidden = (stats.sigHidden || 0) + 1; continue; }   // replaced by a packed signature asset
    bm.getGeometryRangeAt(it.gidShape, range);
    const ic = range.indexCount, is = range.indexStart;
    const ch = chunkOf(it.x, it.z), lo = ch.lo, hi = ch.hi;
    const rec = look.get(it.id) || null, cur = CURATED[it.id] || null;
    const isCor = corridor.has(it.id);
    const rnd = mulberry(it.id | 0);
    // ---- read the engine geometry: vertical ground-based faces -> edges, everything else passes through
    const edges = new Map(); const pass = []; let wallTopMax = 0, roofMax = 0, wallBright = 0, wallEng = [0.7, 0.7, 0.7], frac = 1, floorH = 3.3, spacing = 3.2;
    for (let t = 0; t < ic; t += 3) {
      const a = IDX[is + t], b = IDX[is + t + 1], c = IDX[is + t + 2];
      const ny = (N[a * ns + 1] + N[b * ns + 1] + N[c * ns + 1]) / 381;
      for (const v of [a, b, c]) roofMax = Math.max(roofMax, P[v * 3 + 1]);
      if (Math.abs(ny) < 0.2) {
        // longest horizontal pair
        const V = [a, b, c]; let bi = 0, bj = 1, bd = -1;
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const d = Math.hypot(P[V[i] * 3] - P[V[j] * 3], P[V[i] * 3 + 2] - P[V[j] * 3 + 2]); if (d > bd) { bd = d; bi = i; bj = j; } }
        if (bd > 0.05) {
          const va = V[bi], vb = V[bj]; let ax = P[va * 3], az = P[va * 3 + 2], bx = P[vb * 3], bz = P[vb * 3 + 2];
          if (ax > bx || (ax === bx && az > bz)) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
          const k = key(ax) + ',' + key(az) + ',' + key(bx) + ',' + key(bz);
          let e = edges.get(k);
          if (!e) edges.set(k, (e = { ax, az, bx, bz, minY: 1e9, maxY: -1e9, nx: 0, nz: 0, tris: [] }));
          for (const v of V) { e.minY = Math.min(e.minY, P[v * 3 + 1]); e.maxY = Math.max(e.maxY, P[v * 3 + 1]); const br = C[v * 4] + C[v * 4 + 1] + C[v * 4 + 2]; if (br > wallBright) { wallBright = br; wallEng = [C[v * 4] / 255, C[v * 4 + 1] / 255, C[v * 4 + 2] / 255]; } }
          e.nx += N[a * ns] + N[b * ns] + N[c * ns]; e.nz += N[a * ns + 2] + N[b * ns + 2] + N[c * ns + 2]; e.tris.push(a, b, c);
          const w = W[va * 4 + 3]; if (w > 0) { frac = w / 255; floorH = Math.max(2, W[va * 4] / 255 * 12); spacing = Math.max(1.8, W[va * 4 + 2] / 255 * 8); }
          continue;
        }
      }
      pass.push(a, b, c);
    }
    // ---- colours: curated > sampled (chroma restored) > engine
    let wall = wallEng, roofRef = new THREE.Color(it.roofHex || 0x808080);
    let roofCol = null, trim = null;
    if (cur) { stats.curated++; if (cur.wall) wall = lin(cur.wall); if (cur.roof) roofCol = lin(cur.roof); if (cur.trim) trim = lin(cur.trim); }
    if (rec) {
      if (!cur || !cur.wall) if (rec.wall >= 0) { wall = lin(restore(rec.wall)); stats.sampledWall++; }
      if (!roofCol && rec.roof >= 0) { roofCol = lin(rec.roof); stats.sampledRoof++; }
      if (!trim && rec.trim >= 0 && rec.nF) trim = lin(restore(rec.trim));
    }
    // engine walls that are dark grey (no sampled colour): a warm plaster palette picked by id, never the engine's graphite
    if (!(cur && cur.wall) && !(rec && rec.wall >= 0) && wall[0] + wall[1] + wall[2] < 1.3) wall = lin(PLASTER[Math.abs(it.id) % PLASTER.length]);
    const lite = wall.map((v) => Math.min(1, v * 1.12 + 0.03)); trim = trim ? trim.map((v, i) => v * 0.4 + lite[i] * 0.6) : lite;
    const B = {
      wall, trim, plinth: wall.map((v) => v * 0.8), stone: wall.map((v) => v * 0.7), shopTrim: trim, roofCol: roofCol || [roofRef.r, roofRef.g, roofRef.b],
      win: frac > 0.2 || !!(rec && rec.nF) || !!(cur && cur.win), nF: rec && rec.nF ? rec.nF : 0, fh: rec && rec.fh ? rec.fh : Math.max(3.0, Math.min(4.2, floorH)), sp: Math.max(2.2, Math.min(4.2, rec && rec.sp ? rec.sp : spacing)),
      ww: rec && rec.ww ? rec.ww : 0.42, wh: rec && rec.wh ? rec.wh : 0.6, wy: rec && rec.wy ? rec.wy : 0.22,
      gh: cur && cur.gh ? cur.gh : rec && rec.nF ? rec.gh : (isCor && it.h > 9 && (it.t === 'res' || it.t === 'com' || it.t === 'oth') ? 3.9 : 0),
      co: cur && cur.co ? cur.co : rec && rec.nF ? rec.co : (it.h > 10 ? 0.7 : 0),
      hash: rnd(), roofRise: 0, balc: isCor && rnd() < 0.5 && it.t === 'res', shopAwn: true,
    };
    { const hv = B.hash; B.arch = !R4 || !isCor || cur ? null : it.h >= 13 && (it.t === 'res' || it.t === 'com') && hv < 0.38 ? 'nouveau' : it.h >= 10 && hv < 0.72 ? 'eclectic' : it.h >= 9 && hv >= 0.9 ? 'func' : null; B.roofCol = B.roofCol || roofCol || [0.3, 0.3, 0.3]; }
    if (B.arch) { const wh = [0.92, 0.9, 0.84], mixc = (a, b, k) => a.map((v, i) => v * (1 - k) + b[i] * k);
      if (B.arch === 'nouveau') { B.trim = mixc(B.trim, wh, 0.6); B.shopTrim = B.trim; B.plinth = B.wall.map((v) => v * 0.6); B.co = Math.max(B.co, 1.1); }
      else if (B.arch === 'eclectic') { B.trim = mixc(B.trim, wh, 0.4); B.shopTrim = B.trim; B.plinth = B.wall.map((v) => v * 0.68); B.stone = B.plinth; }
      else { B.trim = B.wall.map((v) => Math.max(0, v * 0.78)); B.shopTrim = B.trim; } }
    if (cur && cur.sp) B.sp = cur.sp; if (cur && cur.ww) B.ww = cur.ww;
    if (rec && rec.nF && rec.ww && !(cur && cur.ww)) { B.ww = Math.max(0.25, Math.min(0.8, rec.ww)); stats.rhythm++; }
    // ---- engine ground-based wall faces -> own facades
    const E_list = [];
    for (const e of edges.values()) {
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      if (len >= 1.5 && (e.minY <= 0.35 || (cur && cur.forceEdges)) && e.maxY - e.minY > 1.2) {
        let dx = (e.bx - e.ax) / len, dz = (e.bz - e.az) / len; let nx = dz, nz = -dx;
        if (nx * e.nx + nz * e.nz < 0) { dx = -dx; dz = -dz; nx = -nx; nz = -nz; }
        const sx = dx > 0 || (dx === 0 && dz > 0) ? e.ax : e.bx, sz = dx > 0 || (dx === 0 && dz > 0) ? e.az : e.bz;
        // start point = the end the direction leaves from
        const ex = e.ax * dx + e.az * dz <= e.bx * dx + e.bz * dz ? [e.ax, e.az] : [e.bx, e.bz];
        E_list.push({ ax: ex[0] + it.x, az: ex[1] + it.z, lx: ex[0], lz: ex[1], dx, dz, nx, nz, len, y0: e.minY, top: e.maxY });
        wallTopMax = Math.max(wallTopMax, e.maxY);
      } else for (const v of e.tris) pass.push(v);
    }
    B.roofRise = roofMax - wallTopMax; B.ww = Math.min(B.ww, 1.35 / Math.max(2.2, B.sp)); B.wh = Math.min(B.wh, 2.0 / Math.max(2.8, B.fh));
    // ---- pass-through faces (roofs, spires, small wall pieces): roof-coloured faces re-coloured
    const r0 = (v) => (C[v * 4] + C[v * 4 + 1] + C[v * 4 + 2]) / 255;
    const tol = 3.5 / 255, rr = roofRef.r, rg = roofRef.g, rb = roofRef.b;
    const winFh = Math.max(2.6, B.fh), winA = [255, Math.round(winFh / 6 * 255), 0, Math.round(B.ww * 255)], winB = [Math.round(B.wh * 255), Math.round(B.wy * 255), 0, Math.round(B.hash * 255)];
    for (let t = 0; t < pass.length; t += 3) {
      // large vertical wall faces that are not ground-based (setbacks, floating masses, e.g. Stockmann) get the shader window grid too
      let winPass = false;
      if ((isCor || cur) && B.win) { const a = pass[t], b2 = pass[t + 1], c2 = pass[t + 2];
        if (Math.abs(N[a * ns + 1]) < 40 && Math.abs(N[b2 * ns + 1]) < 40 && Math.abs(N[c2 * ns + 1]) < 40) {
          const h1 = Math.hypot(P[a * 3] - P[b2 * 3], P[a * 3 + 2] - P[b2 * 3 + 2]), h2 = Math.hypot(P[b2 * 3] - P[c2 * 3], P[b2 * 3 + 2] - P[c2 * 3 + 2]), h3 = Math.hypot(P[a * 3] - P[c2 * 3], P[a * 3 + 2] - P[c2 * 3 + 2]);
          const yh = Math.max(P[a * 3 + 1], P[b2 * 3 + 1], P[c2 * 3 + 1]) - Math.min(P[a * 3 + 1], P[b2 * 3 + 1], P[c2 * 3 + 1]);
          winPass = Math.max(h1, h2, h3) >= 2.5 && yh >= 2 && r0(a) + r0(b2) + r0(c2) > 0.6; } }
      if (winPass) stats.winPass = (stats.winPass || 0) + 1;
      for (let q = 0; q < 3; q++) {
        const v = pass[t + q];
        let r = C[v * 4] / 255, g = C[v * 4 + 1] / 255, b = C[v * 4 + 2] / 255;
        if (roofCol && Math.abs(r - rr) < tol && Math.abs(g - rg) < tol && Math.abs(b - rb) < tol) { r = roofCol[0]; g = roofCol[1]; b = roofCol[2]; }
        else if (cur && cur.forceEdges && Math.abs(N[v * ns + 1]) < 120 && r + g + b < 1.4) { r = wall[0] * 0.8; g = wall[1] * 0.8; b = wall[2] * 0.8; }
        else if (Math.abs(N[v * ns + 1]) < 51 && Math.abs(r - wallEng[0] * 0.78) + Math.abs(g - wallEng[1] * 0.78) + Math.abs(b - wallEng[2] * 0.78) < 0.06) { r = wall[0] * 0.85; g = wall[1] * 0.85; b = wall[2] * 0.85; }
        else if (Math.abs(N[v * ns + 1]) < 51 && Math.abs(r - wallEng[0]) + Math.abs(g - wallEng[1]) + Math.abs(b - wallEng[2]) < 0.06) { r = wall[0]; g = wall[1]; b = wall[2]; }
        if (winPass) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], fa = pass[t], nl = Math.hypot(N[fa * ns], N[fa * ns + 2]) || 1, tx = N[fa * ns + 2] / nl, tz = -N[fa * ns] / nl;
          lo.vert(x + it.x, y, z + it.z, [N[v * ns] / 127, N[v * ns + 1] / 127, N[v * ns + 2] / 127], [r, g, b], 1, [(x * tx + z * tz) / B.sp + 1000, y / winFh, Math.max(0.4, wallTopMax || roofMax) - y + 0.6, y], winA, winB); }
        else lo.raw(P[v * 3] + it.x, P[v * 3 + 1], P[v * 3 + 2] + it.z, N[v * ns] / 127, N[v * ns + 1] / 127, N[v * ns + 2] / 127, [r, g, b], noA, noB);
      }
      const n0 = lo.n - 3; lo.idx.push(n0, n0 + 1, n0 + 2);
    }
    // ---- facades
    if (isCor) stats.corridor++;
    let porticoEdge = null;
    if (R4 && cur && cur.portico && cur.portico.dir) { let bp = -1e9; for (const E of E_list) { if (E.len >= 14 && E.nx * cur.portico.dir[0] + E.nz * cur.portico.dir[1] > 0.95) { const pr = E.ax * cur.portico.dir[0] + E.az * cur.portico.dir[1]; if (pr > bp) { bp = pr; porticoEdge = E; } } } }
    else if (cur && cur.portico) { const tx = -it.x, tz = -it.z, tl = Math.hypot(tx, tz) || 1; let bs = 0.4; for (const E of E_list) { const sc = (E.nx * tx + E.nz * tz) / tl; if (E.len >= 14 && sc > bs) { if (!porticoEdge || E.len * sc > porticoEdge.len * bs) { porticoEdge = E; bs = sc; } } } }
    const hi0 = hi.idx.length;
    const fruns = facades.get(it.id) || null; let bldWall = null;
    if (fruns) { const cs = fruns.filter((r) => r.col != null).sort((p, q) => q.len - p.len); if (cs.length) bldWall = lin(cs[0].col); }
    for (const E of E_list) {
      if (R4 && cur && cur.sig && E.len >= 2.5) { sigFacade(lo, hi, E, B, cur.sig, it.id); stats.sigEdges = (stats.sigEdges || 0) + 1; continue; }
      if (cur && cur.grand && E.len >= 5) { grandFacade(lo, E, B, cur.grand); stats.grandEdges = (stats.grandEdges || 0) + 1; continue; }
      let detailed = false;
      if (isCor) {
        const mx = E.ax + E.dx * E.len / 2, mz = E.az + E.dz * E.len / 2;
        detailed = trackDist(mx, mz) <= CORRIDOR_DETAIL && !covered(mx + E.nx * 1.0, mz + E.nz * 1.0, it) && !covered(mx + E.nx * 7, mz + E.nz * 7, it);
      }
      stats.edgesLo++;
      if (detailed && E.len >= 2.4) {
        const run = fruns && !(cur && cur.generic) ? matchRun(fruns, E) : null; let Be = B;
        if (run && run.col != null && !(cur && cur.wall)) { const w = lin(run.col), lt = w.map((v) => Math.min(1, v * 1.12 + 0.03)); Be = { ...B, wall: w, trim: cur && cur.trim ? B.trim : lt, plinth: w.map((v) => v * 0.8), stone: w.map((v) => v * 0.7), shopTrim: cur && cur.trim ? B.trim : lt }; stats.colourEdges++; }
        else if (bldWall && !(cur && cur.wall)) { const w = bldWall, lt = w.map((v) => Math.min(1, v * 1.12 + 0.03)); Be = { ...B, wall: w, trim: lt, plinth: w.map((v) => v * 0.8), stone: w.map((v) => v * 0.7), shopTrim: lt }; }
        const plan = run && run.rows ? planMeasured(E, Be, run.r, run.uOff) : planGeneric(E, Be);
        if (cur && cur.portico && E === porticoEdge) { plan.wins = []; plan.ground = []; plan.gk = 2; }
        if (plan.measured) { stats.measuredEdges++; stats.measuredWindows += plan.wins.length; } else stats.genericEdges++;
        emitFromPlan(lo, hi, E, Be, plan, rnd, true); stats.edgesHi++;
        if (B.arch && plan.wins.length) archExtras(hi, E, Be, plan, B.arch, rnd);
      } else emitLo(lo, E, B, detailed);
    }
    if (cur && cur.portico && porticoEdge) { portico(lo, porticoEdge, { ...cur.portico, roof: lin(cur.roof) }); stats.heroes++; stats.porticoAt = [Math.round(porticoEdge.ax), Math.round(porticoEdge.az), +porticoEdge.nx.toFixed(2), +porticoEdge.nz.toFixed(2), +porticoEdge.len.toFixed(1)]; }
    if (R4 && (B.arch === 'nouveau' || (cur && cur.turret)) && E_list.length > 1 && it.h > 12) { // corner turret where two street-facing walls meet
      let done = false;
      for (let i = 0; i < E_list.length && !done; i++) for (let j = 0; j < E_list.length && !done; j++) { const A = E_list[i], C = E_list[j]; if (i === j || A.len < 5 || C.len < 5) continue;
        const ex = A.ax + A.dx * A.len, ez = A.az + A.dz * A.len; if (Math.hypot(ex - C.ax, ez - C.az) > 0.5) continue; const dt = A.nx * C.nx + A.nz * C.nz; if (dt > 0.45 || dt < -0.3) continue;
        const mx = ex + (A.nx + C.nx) * 0.5, mz = ez + (A.nz + C.nz) * 0.5; if (trackDist(mx, mz) > 50) continue; if (covered(ex - (A.nx + C.nx) * 0.4, ez - (A.nz + C.nz) * 0.4, it) && false) continue;
        const nl = Math.hypot(A.nx + C.nx, A.nz + C.nz) || 1, r = 1.8, tx = ex + (A.nx + C.nx) / nl * 0.35, tz = ez + (A.nz + C.nz) / nl * 0.35, top = A.top;
        tower(lo, tx, tz, top - 7.5, top + 0.4, top + 5.2 + (rnd() < 0.5 ? 1 : 0), r, wall, B.roofCol, { n: 9, dome: rnd() < 0.5, windows: 3, wy: 0.15, cornice: true, trim: B.trim, spire: 2.0 }); done = true; stats.turrets = (stats.turrets || 0) + 1; }
    }
    if (cur && cur.hangar && E_list.length) { const L = E_list.filter((E) => E.len > 12).sort((p, q) => p.len - q.len).slice(0, 2); for (const E of L) { archGable(lo, E); stats.heroes++; } }
    if (isCor && !cur && E_list.length && it.h > 6 && B.roofRise < 6) { // chimneys on two corners of the roof
      const top = wallTopMax + 0.2;
      const E = E_list.reduce((a, b) => (b.len > a.len ? b : a));
      for (let k = 0; k < (it.h > 12 ? 2 : 1); k++) { const u = E.len * (0.25 + 0.5 * k + rnd() * 0.1), off = -1.6; chimney(hi, E.ax + E.dx * u + E.nx * off, E.az + E.dz * u + E.nz * off, top - 1.4, top + 1.0 + rnd() * 0.4, lin(0x8a5a48)); }
    }
    stats.hiTris += (hi.idx.length - hi0) / 3;
  }

  // ---- meshes
  const lom = makeLoMaterial(), him = makeHiMaterial();
  const group = new THREE.Group(); group.name = 'tram-city';
  const list = [];
  let tris = 0;
  for (const c of chunks.values()) {
    const e = { x0: c.x0, z0: c.z0, lo: null, hi: null };
    if (c.lo.idx.length) { const m = new THREE.Mesh(c.lo.geometry(), lom); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); e.lo = m; tris += c.lo.idx.length / 3; }
    if (c.hi.idx.length) { const m = new THREE.Mesh(c.hi.geometry(), him); m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); e.hi = m; tris += c.hi.idx.length / 3; }
    list.push(e);
    c.lo = c.hi = null;
  }
  // ---- packed signature assets: one mesh per LOD, switched by distance (update)
  const sigs = [];
  for (const [k, a, asset] of sigReady) {
    const geos = buildSigGeometries(asset, a.pal, { flood: a.flood }), A = [Math.cos(a.th), Math.sin(a.th)], VV = [A[1], -A[0]];
    const g = new THREE.Group(); g.name = 'sig-' + k; g.matrixAutoUpdate = false; g.matrix.set(VV[0], 0, A[0], a.O[0], 0, 1, 0, 0, VV[1], 0, A[1], a.O[1], 0, 0, 0, 1); g.matrixWorldNeedsUpdate = true;
    const ms = geos.map((q, i) => { const m = new THREE.Mesh(q.geo, lom); m.castShadow = i < 2; m.receiveShadow = true; m.visible = i === 2; g.add(m); return m; });
    scene.add(g); g.updateMatrixWorld(true);
    const c = a.centre, cw = [a.O[0] + c[2] * A[0] + c[0] * VV[0], a.O[1] + c[2] * A[1] + c[0] * VV[1]];
    sigs.push({ k, a, g, ms, geos, cw, lod: 2, bytes: asset.bytes }); tris += geos[2].tris;
  }
  stats.sig = sigs.map((s) => ({ k: s.k, tris: s.geos.map((q) => q.tris), bytes: s.bytes }));
  scene.add(group);
  stats.chunks = list.length; stats.tris = Math.round(tris); stats.buildMs = Math.round(performance.now() - t0); stats.loadMs = Math.round(tLoad);
  let hiDist = phone ? 95 : 130; const sigK = phone ? 0.65 : 1;
  return {
    group, stats, list, sigs,
    setHiDistance(d) { hiDist = d; },
    /** assertion helper: no city geometry below 4.6 m within `clear` metres of any track centre line (raw OSM track of every route of this map). Returns { checked, violations, worst } */
    checkClearance(clear = 1.6) {
      let checked = 0, violations = 0, worst = 1e9, where = null;
      for (const s of sigs) { const g = s.geos[0].geo, P0 = g.attributes.position.array, M = s.g.matrix.elements; for (let i = 0; i < P0.length; i += 3) { const y = P0[i + 1]; if (y > 4.6 || y < 0.15) continue; const x = M[0] * P0[i] + M[8] * P0[i + 2] + M[12], z = M[2] * P0[i] + M[10] * P0[i + 2] + M[14], d = trackDist(x, z); checked++; if (d < clear) { violations++; if (d < worst) { worst = d; where = [Math.round(x), Math.round(z), +y.toFixed(1), s.k]; } } } }
      for (const e of list) for (const m of [e.lo, e.hi]) {
        if (!m) continue; const P = m.geometry.attributes.position.array;
        for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; if (y > 4.6 || y < 0.15) continue; const d = trackDist(P[i], P[i + 2]); checked++; if (d < clear) { violations++; if (d < worst) { worst = d; where = [Math.round(P[i]), Math.round(P[i + 2])]; } } }
      }
      return { checked, violations, worst: +worst.toFixed(2), where };
    },
    /** per frame: relief geometry only within hiDist of the camera (chunk box distance); no allocation */
    update(camera) {
      const cx = camera.position.x, cz = camera.position.z, d2 = hiDist * hiDist;
      for (const s of sigs) { const d = Math.hypot(cx - s.cw[0], cz - s.cw[1]) - s.a.radius, want = SIGLOD != null && SIGLOD !== '' ? +SIGLOD : d < s.a.dist[0] * sigK ? 0 : d < s.a.dist[1] * sigK ? 1 : 2; if (want !== s.lod) { s.ms[s.lod].visible = false; s.ms[want].visible = true; s.lod = want; } }
      for (let i = 0; i < list.length; i++) {
        const e = list[i]; if (!e.hi) continue;
        const dx = Math.max(e.x0 - cx, 0, cx - (e.x0 + CH)), dz = Math.max(e.z0 - cz, 0, cz - (e.z0 + CH));
        e.hi.visible = dx * dx + dz * dz < d2;
      }
    },
  };
}
