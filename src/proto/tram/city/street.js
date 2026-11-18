// The tram game's street layer (round 3): sett track bed, kerbs, centre lines, parked cars, street trees. Own code, own meshes; the engine's world is only READ
// (ground class raster = orthophoto classes, roads, objects), except that engine trees near the tracks are scaled to zero and re-drawn here with a better model.
// Everything is placed from data that is already in the repo: the measured ground-class raster (SETT / ASPHALT / GRASS ...) decides where the bed is cobbled and where
// a kerb stands (asphalt -> non-asphalt transition next to an OSM road); parked cars are placed by rule along those measured kerbs (NOT from mesh blobs), trees at the
// engine's (OSM) tree positions.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROUND_CLASS as G } from '../../../ground.js';
import { PROP_DEFS, CAR_TINTS } from '../../../propModels.js';
import { makeHiMaterial } from './material.js';

const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rightOf = (yaw) => [-Math.sin(yaw), Math.cos(yaw)];

function rasterOf(data) {
  const R = data.groundRaster, b = data.meta && data.meta.bounds; if (!R || !b) return null;
  const rx = R.W / (b.maxX - b.minX), rz = R.H / (b.maxZ - b.minZ);
  return (x, z) => { const i = Math.floor((x - b.minX) * rx), j = Math.floor((z - b.minZ) * rz); return i < 0 || j < 0 || i >= R.W || j >= R.H ? 0 : R.cls[j * R.W + i]; };
}
function pointHash(tracks, step = 5, cell = 40) {
  const m = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
  for (const T of tracks) for (let s = 0, p = {}; s < T.length; s += step) { T.at(s, p); const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell)); let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(p.x, p.z); }
  return (x, z, d) => { const rc = Math.ceil(d / cell); const cx = Math.floor(x / cell), cz = Math.floor(z / cell), d2 = d * d; for (let a = cx - rc; a <= cx + rc; a++) for (let b = cz - rc; b <= cz + rc; b++) { const l = m.get(key(a, b)); if (!l) continue; for (let i = 0; i < l.length; i += 2) if ((l[i] - x) ** 2 + (l[i + 1] - z) ** 2 < d2) return true; } return false; };
}

// ---- sett texture (procedural, tiling; stones ~9 x 12 cm in a 1.6 m tile) -----------------------------------------------------------------
let _sett = null;
function settTexture() {
  if (_sett) return _sett;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const r = mulberry(7);
  g.fillStyle = '#9a9b9f'; g.fillRect(0, 0, S, S);
  const rows = 22, rh = S / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 20; const off = r() * 10;
    while (x < S + 20) {
      const w = 18 + r() * 12, sh = 196 + r() * 50, tone = r();
      const R = sh - (tone < 0.5 ? 4 : -6), Gc = sh - 2 + (tone < 0.3 ? 4 : 0), B = sh + 4 + (tone > 0.75 ? 6 : 0);
      g.fillStyle = `rgb(${R},${Gc},${B})`;
      const x0 = x + off * 0 + 1.5, y0 = y * rh + 1.5, ww = w - 3, hh = rh - 3;
      g.beginPath(); g.moveTo(x0 + 3, y0); g.lineTo(x0 + ww - 3, y0 + 1); g.quadraticCurveTo(x0 + ww, y0 + hh / 2, x0 + ww - 3, y0 + hh); g.lineTo(x0 + 3, y0 + hh - 1); g.quadraticCurveTo(x0, y0 + hh / 2, x0 + 3, y0); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x0 + 3, y0, ww - 6, 2);
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (_sett = t);
}

function ribbonGeo(pts, y, halfW, vScale, uRep) {   // pts: [{x,z,yaw,s}]
  const pos = [], uv = [], idx = [];
  pts.forEach((p, i) => {
    const [rx, rz] = rightOf(p.yaw);
    pos.push(p.x - rx * halfW, y, p.z - rz * halfW, p.x + rx * halfW, y, p.z + rz * halfW);
    uv.push(0, p.s * vScale, uRep, p.s * vScale);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
  return g;
}

// ---- tree models: trunk + 2-3 layered faceted crowns (deciduous), tiered cones (spruce) -------------------------------------------------------
function colourise(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const c = fn(p.getX(i), p.getY(i), p.getZ(i), i); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const lin1 = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const L = (h) => hex(h).map(lin1);
function blob(r, sx, sy, sz, x, y, z, seed, lo, hi, low = false) {
  const g0 = new THREE.IcosahedronGeometry(r, low ? 0 : 1).toNonIndexed(), p = g0.attributes.position, rnd = mulberry(seed);
  // jitter shared corners the same way (hash of the rounded position) so the facets stay closed
  const jit = (x0, y0, z0, k) => { const h = Math.sin(x0 * 12.9898 + y0 * 78.233 + z0 * 37.719 + seed) * 43758.5453; return (h - Math.floor(h) - 0.5) * k; };
  for (let i = 0; i < p.count; i++) { const x0 = p.getX(i), y0 = p.getY(i), z0 = p.getZ(i), k = r * 0.28; p.setXYZ(i, x0 * sx * (1 + jit(x0, y0, z0, 0.28)) + x, y0 * sy * (1 + jit(z0, x0, y0, 0.22)) + y, z0 * sz * (1 + jit(y0, z0, x0, 0.28)) + z); }
  g0.deleteAttribute('uv'); g0.computeVertexNormals();
  const ymin = y - r * sy, ymax = y + r * sy;
  return colourise(g0, (px, py) => { const t = Math.max(0, Math.min(1, (py - ymin) / (ymax - ymin))); return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t]; });
}
function trunkGeo(h, r0, r1, col) { const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true); g.translate(0, h / 2, 0); return colourise(g, (x, y) => col.map((v) => v * (0.8 + 0.2 * (y / h)))); }
function treeModels(low) {
  const trunk = L(0x5b4636), M = {};
  const dec = (seed, o) => {
    const lo = L(o.lo), hi = L(o.hi), hi2 = L(o.hi2 || o.hi);
    return mergeGeometries([trunkGeo(o.th, 0.22, 0.14, trunk), blob(o.r, o.sx, o.sy, o.sx, 0, o.th + o.r * o.sy * 0.55, 0, seed, lo, hi, low), blob(o.r * 0.78, 1, 0.9, 1, o.r * 0.55, o.th + o.r * o.sy * 0.15, o.r * 0.1, seed + 1, lo, hi2, true), blob(o.r * 0.7, 1, 0.9, 1, -o.r * 0.5, o.th + o.r * o.sy * 0.25, -o.r * 0.25, seed + 2, lo, hi2, true)].slice(0, low ? 3 : 4));
  };
  M.linden = dec(11, { th: 3.1, r: 2.9, sx: 1.0, sy: 1.15, lo: 0x31592b, hi: 0x6c9a45, hi2: 0x5c8a3d });
  M.maple = dec(23, { th: 2.4, r: 2.4, sx: 0.85, sy: 1.5, lo: 0x3d6130, hi: 0x86a84c, hi2: 0x6f9642 });
  M.round = dec(37, { th: 2.0, r: 2.6, sx: 1.2, sy: 0.95, lo: 0x35592d, hi: 0x729f48, hi2: 0x5f8d3f });
  const sp = [], s0 = L(0x1f4a30), s1 = L(0x3b7048);
  sp.push(trunkGeo(1.5, 0.2, 0.14, trunk));
  for (let k = 0; k < (low ? 3 : 4); k++) { const rr = 2.1 - k * 0.42, hh = 3.4, y = 1.2 + k * 2.1; const c = new THREE.ConeGeometry(rr, hh, 7).toNonIndexed(); c.translate(0, y + hh / 2, 0); sp.push(colourise(c, (x, py) => { const t = (py - y) / hh; return [s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t, s0[2] + (s1[2] - s0[2]) * t]; })); }
  M.spruce = mergeGeometries(sp);
  for (const k of Object.keys(M)) { M[k].computeBoundingBox(); }
  return M;
}
const TREE_H = { linden: 3.1 + 2.9 * 1.15 * 1.55 + 0.4, maple: 2.4 + 2.4 * 1.5 * 1.55, round: 2.0 + 2.6 * 0.95 * 1.55, spruce: 1.2 + 3 * 2.1 + 3.4 };

// ---------------------------------------------------------------------------------------------------------------------------------------
/** street layer of one route (setts, kerbs, centre lines, parked cars) + the street trees of the whole map (once). Returns { group, stats, dispose() } */
export function buildStreet({ THREE: _T, scene, S, tracks, mapTracks, phone = false }) {
  const t0 = performance.now(), data = S.data, world = S.world, cls = rasterOf(data), stats = { settM: 0, settRuns: 0, kerbM: 0, cars: 0, trees: 0, treesOwn: 0, centreM: 0, marks: 0 };
  const group = new THREE.Group(); group.name = 'tram-street';
  const hiMat = makeHiMaterial();
  if (!cls) return { group, stats };
  const rnd = mulberry(1234);
  const near = pointHash(tracks, 5, 40);
  // ---- 1. sett bed: where the measured ground classes along the track are street (not grass / ballast), per 2 m, majority-filtered
  const settPts = [];
  for (const T of tracks) {
    const n = Math.floor(T.length / 2), flag = new Uint8Array(n + 1), p = {};
    for (let i = 0; i <= n; i++) {
      T.at(i * 2, p); const [rx, rz] = rightOf(p.yaw); let g = 0, st = 0, ba = 0, tot = 0;
      for (let o = -2.4; o <= 2.41; o += 0.8) { const c = cls(p.x + rx * o, p.z + rz * o); tot++; if (c === G.GRASS || c === G.CANOPY || c === G.FOREST) g++; else if (c === G.BALLAST || c === G.GRAVEL) ba++; else st++; }
      flag[i] = g <= 2 && ba <= 3 ? 1 : 0;
    }
    const f2 = new Uint8Array(n + 1);   // majority filter +-12 m
    for (let i = 0; i <= n; i++) { let a = 0, c = 0; for (let k = Math.max(0, i - 6); k <= Math.min(n, i + 6); k++) { a += flag[k]; c++; } f2[i] = a * 2 > c ? 1 : 0; }
    let run = null;
    for (let i = 0; i <= n + 1; i++) {
      if (i <= n && f2[i]) { T.at(i * 2, p); (run || (run = [])).push({ x: p.x, z: p.z, yaw: p.yaw, s: i * 2 }); }
      else if (run) { if (run.length > 3) { settPts.push(run); stats.settM += (run.length - 1) * 2; stats.settRuns++; } run = null; }
    }
  }
  if (settPts.length) {
    const tex = settTexture(), mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const geos = settPts.map((r) => ribbonGeo(r, 0.138, 1.72, 1 / 1.6, 2.15));
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true; m.frustumCulled = false; m.name = 'setts'; group.add(m);
  }

  // ---- 2. kerbs along OSM carriageways (validated by the measured raster) + dashed centre lines + parked cars
  const roads = (data.roads || []).filter((r) => r.k === 'primary' || r.k === 'secondary' || r.k === 'tertiary' || r.k === 'residential' || r.k === 'pedestrian');
  const kp = [], kidx = [], mp = [], mi = [];
  const slots = [];
  const crossings = data.crossings || [], stops = data.stops || [];
  const awayFrom = (arr, x, z, d) => { for (const c of arr) if ((c[0] - x) ** 2 + (c[1] - z) ** 2 < d * d) return true; return false; };
  const parked = []; for (const o of world.objects) if (o.cls === 'car' && !o.mover) parked.push([o.x, o.z]);
  const KC = [0.62, 0.61, 0.58], KT = [0.78, 0.77, 0.74];
  const kcol = [];
  const addKerb = (a, b, sgn, nx, nz) => {   // a,b: [x,z] on the carriageway edge; kerb stone: top 14 cm high, 16 cm wide, set outwards
    const h = 0.14, w = 0.17, ax = a[0] + nx * sgn * w, az = a[1] + nz * sgn * w, bx = b[0] + nx * sgn * w, bz = b[1] + nz * sgn * w;
    const base = kp.length / 3;
    kp.push(a[0], 0, a[1], b[0], 0, b[1], b[0], h, b[1], a[0], h, a[1], ax, h, az, bx, h, bz);
    for (let q = 0; q < 6; q++) kcol.push(...(q < 4 ? KC : KT));
    kidx.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 3, base + 2, base + 5, base + 3, base + 5, base + 4);
  };
  for (const r of roads) {
    const w = r.w || 7; if (w < 5) continue; const pts = r.p;
    // quick reject: any vertex within 110 m of a track?
    let ok = false; for (const q of pts) if (near(q[0], q[1], 110)) { ok = true; break; } if (!ok) continue;
    const dashed = !r.ow && w >= 7 && r.k !== 'pedestrian';
    let sAcc = 0;
    const runs = [[], []];                      // one chain per side: [{ x, z, nx, nz, off }]
    const flush = (side) => {
      const run = runs[side]; runs[side] = [];
      if (run.length < 3) return;
      const sgn = side ? 1 : -1;
      // smooth the measured edge offset along the chain
      for (let k = 0; k < run.length; k++) { let a = 0, c = 0; for (let j = Math.max(0, k - 3); j <= Math.min(run.length - 1, k + 3); j++) { a += run[j].off; c++; } run[k].so = a / c; }
      const E = run.map((q) => [q.x + q.nx * sgn * q.so, q.z + q.nz * sgn * q.so]);
      for (let k = 0; k + 1 < E.length; k++) { addKerb(E[k], E[k + 1], sgn, run[k].nx, run[k].nz); stats.kerbM += 1.5; }
      // parked cars along this kerb
      if (r.k === 'pedestrian' || run.length < 9) return;
      if (w < 8 && ((r.p[0][0] * 7 + r.p[0][1] * 13 | 0) & 1) !== side) return;
      const len = (run.length - 1) * 1.5; let s = 6;
      while (s < len - 6) {
        const f = s / 1.5, k0 = Math.min(run.length - 2, Math.floor(f)), u = f - k0, q0 = run[k0], q1 = run[k0 + 1];
        const px = E[k0][0] + (E[k0 + 1][0] - E[k0][0]) * u, pz = E[k0][1] + (E[k0 + 1][1] - E[k0][1]) * u;
        let dx = E[k0 + 1][0] - E[k0][0], dz = E[k0 + 1][1] - E[k0][1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const cx = px - q0.nx * sgn * 1.15, cz = pz - q0.nz * sgn * 1.15;
        const step = 5.7 + rnd() * 1.6;
        if (rnd() < 0.62 && !near2(cx, cz, 4.6) && !awayFrom(crossings, cx, cz, 17) && !awayFrom(stops, cx, cz, 16) && !awayFrom(parked, cx, cz, 3.4) && !(world.blockers && world.blockers.inBuilding(cx, cz, 0.3))
          && cls(cx, cz) === G.ASPHALT) slots.push({ x: cx, z: cz, yaw: -Math.atan2(dz, dx) + (rnd() < 0.5 ? 0 : 0), tint: rnd() });
        s += step;
      }
    };
    const near2 = (x, z, d) => (mapTracks || tracks).some((T) => T.project(x, z, d));
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1], sl = Math.hypot(bx - ax, bz - az); if (sl < 0.5) continue;
      const dx = (bx - ax) / sl, dz = (bz - az) / sl, nx = -dz, nz = dx;
      for (let t = 0; t < sl; t += 1.5) {
        const x = ax + dx * t, z = az + dz * t;
        if (!near(x, z, 110)) { flush(0); flush(1); continue; }
        for (let side = 0; side < 2; side++) {
          const sgn = side ? 1 : -1; let found = -1;
          for (let o = w / 2 - 2.2; o <= w / 2 + 2.2; o += 0.5) { const c1 = cls(x + nx * sgn * (o - 0.6), z + nz * sgn * (o - 0.6)), c2 = cls(x + nx * sgn * (o + 0.6), z + nz * sgn * (o + 0.6)); if ((c1 === G.ASPHALT || c1 === G.SETT) && c2 !== G.ASPHALT && c2 !== G.SETT && c2 !== G.WATER && c2 !== G.GRASS + 99) { found = o; break; } }
          const track2 = near2(x + nx * sgn * (found + 0.1), z + nz * sgn * (found + 0.1), 2.6);
          if (found < 0 || track2) flush(side); else runs[side].push({ x, z, nx, nz, off: found });
        }
        // dashed centre line on two-way roads
        if (dashed && ((sAcc + t) % 9) < 3.2 && cls(x, z) === G.ASPHALT && !near2(x, z, 3.2) && cls(x + nx * 2.5, z + nz * 2.5) === G.ASPHALT && cls(x - nx * 2.5, z - nz * 2.5) === G.ASPHALT && !awayFrom(crossings, x, z, 8)) {
          const hw = 0.07, l = Math.min(3.2, sl - t), base = mp.length / 3;
          mp.push(x - nx * hw, 0.02, z - nz * hw, x + nx * hw, 0.02, z + nz * hw, x + dx * l + nx * hw, 0.02, z + dz * l + nz * hw, x + dx * l - nx * hw, 0.02, z + dz * l - nz * hw);
          mi.push(base, base + 2, base + 1, base, base + 3, base + 2); stats.centreM += l;
        }
      }
      sAcc += sl;
    }
    flush(0); flush(1);
  }
  if (kp.length) {   // kerbs: split into 160 m cells so that the frustum culls them (one route-long mesh was drawn whole, 25 k triangles, every frame)
    const kc = kcol.map((v) => lin1(v)), mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), cellsK = new Map();
    for (let t = 0; t < kidx.length; t += 3) { const v = kidx[t]; const k = Math.floor(kp[v * 3] / 160) + ',' + Math.floor(kp[v * 3 + 2] / 160); let c = cellsK.get(k); if (!c) cellsK.set(k, (c = { map: new Map(), p: [], c: [], i: [] })); for (let q = 0; q < 3; q++) { const o = kidx[t + q]; let n = c.map.get(o); if (n == null) { n = c.p.length / 3; c.map.set(o, n); c.p.push(kp[o * 3], kp[o * 3 + 1], kp[o * 3 + 2]); c.c.push(kc[o * 3], kc[o * 3 + 1], kc[o * 3 + 2]); } c.i.push(n); } }
    for (const c of cellsK.values()) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(c.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c.c, 3)); g.setIndex(c.i); g.computeVertexNormals(); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = 'kerbs'; group.add(m); }
  }
  if (mp.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3)); g.setIndex(mi); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xe9e6dc, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide })); m.frustumCulled = false; m.name = 'centre-lines'; group.add(m);
  }

  // ---- 3. parked cars (the engine's own car model, varied colours, static instances; 300 m chunks)
  if (slots.length) {
    const geo = PROP_DEFS.car.make(), cm = new THREE.MeshLambertMaterial({ vertexColors: true }), cells = new Map(); const col = new THREE.Color();
    for (const [si, sl] of slots.entries()) { if (phone && si % 2) continue; const k = Math.floor(sl.x / 300) + ',' + Math.floor(sl.z / 300); (cells.get(k) || cells.set(k, []).get(k)).push(sl); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(geo, cm, list.length); im.castShadow = true;
      list.forEach((sl, i) => {
        q.setFromAxisAngle(up, sl.yaw); const k = 0.92 + (sl.tint * 7 % 1) * 0.16; sc.set(k, k, k); m4.compose(new THREE.Vector3(sl.x, 0, sl.z), q, sc); im.setMatrixAt(i, m4);
        col.set(CAR_TINTS[Math.floor(sl.tint * CAR_TINTS.length) % CAR_TINTS.length]); col.multiplyScalar(0.8 + (sl.tint * 13 % 1) * 0.3); im.setColorAt(i, col);
      });
      im.computeBoundingSphere(); im.boundingSphere.radius += 3; im.frustumCulled = true; group.add(im);
    }
    stats.cars = phone ? Math.ceil(slots.length / 2) : slots.length;
  }

  // ---- 4. street trees of the whole map (once): engine trees within 80 m of any route are replaced by own models at the same positions
  if (!S.__ownTrees) {
    S.__ownTrees = true;
    const nearMap = pointHash(mapTracks || tracks, 6, 40), models = treeModels(true), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const byKind = { linden: [], maple: [], round: [], spruce: [] }, touched = new Set();
    for (const o of world.objects) {
      if (o.isBuilding || (o.kind !== 'tree' && o.kind !== 'tree2') || !o.mesh) continue;
      if (!nearMap(o.x, o.z, phone ? 50 : 62)) continue;
      const h = rnd();
      const sp = o.kind === 'tree2' ? 'spruce' : h < 0.45 ? 'linden' : h < 0.75 ? 'maple' : 'round';
      byKind[sp].push(o); o.mesh.setMatrixAt(o.idx, zero); touched.add(o.mesh); stats.trees++;
    }
    for (const mm of touched) mm.instanceMatrix.needsUpdate = true;
    const tg = new THREE.Group(); tg.name = 'tram-trees'; const col = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    for (const [sp, list] of Object.entries(byKind)) {
      if (!list.length) continue;
      const cells = new Map(); for (const o of list) { const k = Math.floor(o.x / 250) + ',' + Math.floor(o.z / 250); (cells.get(k) || cells.set(k, []).get(k)).push(o); }
      for (const cl of cells.values()) {
        const im = new THREE.InstancedMesh(models[sp], hiMat, cl.length); im.castShadow = false;
        cl.forEach((o, i) => {
          const hh = Math.max(4.2, o.h * (sp === 'spruce' ? 1.0 : 1.3)), k = hh / TREE_H[sp]; let w = 0.55 + rnd() * 0.2;
          // clearance: crown radius (about 3.6 * k * w for broadleaves, 2.1 * k for spruce) must stay 1.9 m clear of every track centre line
          let dmin = 99; for (const T of mapTracks || tracks) { const pr = T.project(o.x, o.z, 9); if (pr && pr.d < dmin) dmin = pr.d; }
          const R0 = (sp === "spruce" ? 2.2 : 4.2) * k; if (dmin < 99) { const wmax = (dmin - 1.9) / R0; if (sp === 'spruce') { if (wmax < 1) w = 0; } else w = Math.min(w, wmax); }
          if (w < 0.3) w = 0;
          q.setFromAxisAngle(up, rnd() * 6.28); sc.set(k * (sp === 'spruce' ? 1 : w), w ? k : 0, k * (sp === 'spruce' ? 1 : w)); m4.compose(new THREE.Vector3(o.x, 0, o.z), q, sc); im.setMatrixAt(i, m4);
          col.setRGB(0.88 + rnd() * 0.24, 0.92 + rnd() * 0.16, 0.85 + rnd() * 0.25); im.setColorAt(i, col);
        });
        im.computeBoundingSphere(); im.boundingSphere.radius += 2; im.frustumCulled = true; tg.add(im); stats.treesOwn++;
      }
    }
    scene.add(tg); S.__ownTreeGroup = tg;
  }
  stats.ms = Math.round(performance.now() - t0);
  /** assertion helper: instanced street objects (cars, trees; bounding-box axis points, conservative) and kerb / marking vertices between 0.15 and 4.6 m must stay `clear` metres from every track of this route's map */
  const check = (clear = 1.6, detail = false) => {
    let checked = 0, violations = 0; const where = []; const v = new THREE.Vector3(), M = new THREE.Matrix4(), all = mapTracks || tracks, hit = (x, z) => all.some((T) => T.project(x, z, clear));
    for (const root of [group, S.__ownTreeGroup]) if (root) root.traverse((o) => {
      if (o.name === 'setts') return;
      if (o.isInstancedMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox, ex = [[bb.min.x, 0], [bb.max.x, 0], [0, bb.min.z], [0, bb.max.z], [0, 0]];
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); if (M.elements[5] === 0 || M.elements[0] === 0 && M.elements[10] === 0) continue; let bad = false; for (const [px, pz] of ex) { v.set(px, 1, pz).applyMatrix4(M); if (hit(v.x, v.z)) bad = true; } checked++; if (bad) { violations++; if (detail) where.push([o.name || o.parent?.name || 'inst', Math.round(v.x), Math.round(v.z)]); } } }
      else if (o.isMesh) { const P = o.geometry.attributes.position.array; for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; if (y < 0.15 || y > 4.6) continue; checked++; if (hit(P[i], P[i + 2])) { violations++; if (detail) where.push([o.name, Math.round(P[i]), Math.round(P[i + 2])]); } } }
    });
    return detail ? { checked, violations, where: where.slice(0, 12) } : { checked, violations };
  };
  return { group, stats, check };
}
