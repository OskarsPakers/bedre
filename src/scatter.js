// Deterministic placement of props along roads and in open areas.
import { CFG } from './config.js';
import { mulberry32 } from './rng.js';
import { cleanRing, bbox, pointInPoly, sampleAlong } from './geo.js';
import { PEOPLE_COLORS } from './propModels.js';

const DEFAULT_W = { motorway: 14, primary: 14, secondary: 10, tertiary: 8, residential: 7, service: 4, pedestrian: 6, footway: 2.5, rail: 4 };
const CELL = 20;

export class Blockers {
  constructor(buildingRings, water) {
    this.cells = new Map();
    this.rings = buildingRings;
    this.bbs = buildingRings.map(bbox);
    this.bbs.forEach((b, i) => {
      for (let cx = Math.floor((b.x0 - 1) / CELL); cx <= Math.floor((b.x1 + 1) / CELL); cx++)
        for (let cz = Math.floor((b.z0 - 1) / CELL); cz <= Math.floor((b.z1 + 1) / CELL); cz++) {
          const k = cx * 100003 + cz;
          let a = this.cells.get(k);
          if (!a) this.cells.set(k, (a = []));
          a.push(i);
        }
    });
    this.water = water.map((w) => ({ r: cleanRing(w.p), h: (w.h || []).map(cleanRing).filter((h) => h.length >= 3) })).filter((w) => w.r.length >= 3).map((w) => ({ r: w.r, h: w.h, b: bbox(w.r) }));
  }
  inWater(x, z) {
    for (const w of this.water) {
      if (x < w.b.x0 || x > w.b.x1 || z < w.b.z0 || z > w.b.z1) continue;
      if (pointInPoly(x, z, w.r) && !w.h.some((h) => pointInPoly(x, z, h))) return true;
    }
    return false;
  }
  /** Is (x,z) inside a building (grown by `m` metres, approximated by bbox pad for the reject)? */
  inBuilding(x, z, m = 0) {
    const a = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!a) return false;
    for (const i of a) {
      const b = this.bbs[i];
      if (x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m) continue;
      const r = this.rings[i];
      if (pointInPoly(x, z, r)) return true;
      if (m > 0) {
        for (const [dx, dz] of [[m, 0], [-m, 0], [0, m], [0, -m]]) if (pointInPoly(x + dx, z + dz, r)) return true;
      }
    }
    return false;
  }
  free(x, z, m = 0.6) { return !this.inBuilding(x, z, m) && !this.inWater(x, z); }
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function scatterProps(data, blockers) {
  const rng = mulberry32(CFG.seed + 99);
  const P = CFG.props;
  const bounds = data.meta.bounds;
  const cand = { person: [], lamp: [], bench: [], bin: [], car: [], van: [], bus: [], tram: [], kiosk: [] };
  const yawOf = (tx, tz) => Math.atan2(-tz, tx);
  const person = (x, z) => cand.person.push({ x, z, yaw: rng() * 6.28, variant: Math.floor(rng() * PEOPLE_COLORS.length) });

  for (const road of data.roads) {
    if (!road.p || road.p.length < 2 || road.k === 'rail') continue;
    const k = road.k || 'residential';
    const w = road.w || DEFAULT_W[k] || 6;
    const walk = k === 'pedestrian' || k === 'footway';
    const side = w / 2 + 0.9;
    if (!walk && k !== 'motorway') {
      // lamps both sides
      for (const s of sampleAlong(road.p, 34, rng)) for (const sg of [-1, 1]) {
        if (rng() < 0.55) cand.lamp.push({ x: s.x - s.tz * side * sg, z: s.z + s.tx * side * sg, yaw: yawOf(s.tx, s.tz) + (sg > 0 ? 0 : Math.PI) });
      }
      for (const s of sampleAlong(road.p, 55, rng)) {
        const sg = rng() < 0.5 ? -1 : 1;
        cand.bin.push({ x: s.x - s.tz * (side + 0.4) * sg, z: s.z + s.tx * (side + 0.4) * sg, yaw: rng() * 6.28 });
      }
      for (const s of sampleAlong(road.p, 70, rng)) {
        const sg = rng() < 0.5 ? -1 : 1;
        if (rng() < 0.5) cand.bench.push({ x: s.x - s.tz * (side + 0.7) * sg, z: s.z + s.tx * (side + 0.7) * sg, yaw: yawOf(s.tx, s.tz) + (sg > 0 ? 0 : Math.PI) });
      }
      // pedestrians on the pavement
      for (const s of sampleAlong(road.p, k === 'primary' || k === 'secondary' ? 16 : 24, rng)) {
        const sg = rng() < 0.5 ? -1 : 1, o = side + rng() * 0.8;
        person(s.x - s.tz * o * sg, s.z + s.tx * o * sg);
      }
    }
    if (walk) {
      for (const s of sampleAlong(road.p, k === 'pedestrian' ? 7 : 14, rng)) {
        const o = (rng() - 0.5) * w * 0.7;
        const n = rng() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) person(s.x - s.tz * o + rng() * 0.8, s.z + s.tx * o + rng() * 0.8);
      }
      for (const s of sampleAlong(road.p, 45, rng)) {
        const sg = rng() < 0.5 ? -1 : 1;
        cand.bench.push({ x: s.x - s.tz * (w / 2 + 0.7) * sg, z: s.z + s.tx * (w / 2 + 0.7) * sg, yaw: yawOf(s.tx, s.tz) + (sg > 0 ? 0 : Math.PI) });
      }
      for (const s of sampleAlong(road.p, 120, rng)) cand.kiosk.push({ x: s.x - s.tz * (w / 2 + 2.2), z: s.z + s.tx * (w / 2 + 2.2), yaw: yawOf(s.tx, s.tz) });
    }
    // parked cars
    if (!walk && w >= 4.5 && k !== 'motorway') {
      const off = w / 2 - 1.15;
      for (const s of sampleAlong(road.p, 6.5, rng, 1)) {
        for (const sg of [-1, 1]) {
          if (rng() > (k === 'primary' ? 0.12 : k === 'secondary' ? 0.35 : 0.5)) continue;
          if (w < 6 && sg > 0) continue;
          const x = s.x - s.tz * off * sg, z = s.z + s.tx * off * sg;
          const van = rng() < 0.12;
          (van ? cand.van : cand.car).push({ x, z, yaw: yawOf(s.tx, s.tz) + (sg > 0 ? Math.PI : 0), tint: rng() });
        }
      }
      // moving traffic (cars / buses / trams in the lanes) is created by traffic.js
    }
  }

  // parks: people, benches
  const parkTrees = [];
  for (const pk of data.parks) {
    const r = cleanRing(pk.p);
    if (r.length < 3) continue;
    const b = bbox(r);
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    const n = Math.min(400, Math.floor(area / 500));
    for (let i = 0; i < n; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0), z = b.z0 + rng() * (b.z1 - b.z0);
      if (!pointInPoly(x, z, r)) continue;
      const q = rng();
      if (q < 0.7) person(x, z); else if (q < 0.9) cand.bench.push({ x, z, yaw: rng() * 6.28 }); else cand.bin.push({ x, z, yaw: 0 });
    }
  }
  // scattered pedestrians in open space (squares, courtyards)
  const cx0 = bounds.minX, cz0 = bounds.minZ, W = bounds.maxX - bounds.minX, H = bounds.maxZ - bounds.minZ;
  for (let i = 0; i < P.people * 0.35; i++) {
    const x = cx0 + rng() * W, z = cz0 + rng() * H;
    if (blockers.free(x, z, 1.5)) person(x, z);
  }

  const out = [];
  const take = (key, cap, kind) => {
    const arr = shuffle(cand[key], rng);
    let n = 0;
    for (const c of arr) {
      if (n >= cap) break;
      const margin = key === 'person' ? 0.5 : key === 'tram' || key === 'bus' ? 1.5 : 0.9;
      if (!blockers.free(c.x, c.z, margin)) continue;
      out.push({ ...c, kind: typeof kind === 'function' ? kind(c) : kind, s: 0.92 + rng() * 0.18 });
      n++;
    }
  };
  take('person', P.people, (c) => 'person' + c.variant);
  take('lamp', P.lamps, 'lamp');
  take('bench', P.benches, 'bench');
  take('bin', P.bins, 'bin');
  take('car', P.cars, 'car');
  take('van', P.vans, 'van');
  take('bus', P.buses, 'bus');
  take('tram', P.trams, 'tram');
  take('kiosk', P.kiosks, 'kiosk');

  // data trees: OSM + mesh-derived crowns ([x, z] or [x, z, crownHeightM, pine?]); the rng stream per tree is unchanged (yaw, size, tint)
  const trees = [];
  for (const t of data.trees) {
    if (trees.length >= P.maxTrees) break;
    if (!blockers.free(t[0], t[1], 0.5)) continue;
    const yaw = rng() * 6.28, r1 = rng(), tint = rng();
    if (t.length > 2) {
      const pine = t[3] === 1;
      trees.push({ kind: pine ? 'tree2' : 'tree', x: t[0], z: t[1], yaw, s: pine ? Math.max(0.8, Math.min(1.5, t[2] / 14)) * (0.92 + r1 * 0.16) : Math.max(0.75, Math.min(1.45, t[2] / 8.5)) * (0.9 + r1 * 0.2), tint });
    } else trees.push({ kind: 'tree', x: t[0], z: t[1], yaw, s: 0.7 + r1 * 0.65, tint });
  }
  // dense forest (Mežaparks): ground class 10 (tools/mapfix/trees.mjs: tree-like mesh volume, dense) -> jittered pines + some broadleaf, off buildings (3 m), water, roads
  const R = data.groundRaster;
  if (R && P.forestSpacing > 0) {
    const bd = bounds, rx = R.W / (bd.maxX - bd.minX), rz = R.H / (bd.maxZ - bd.minZ);
    let n10 = 0; for (let k = 0; k < R.cls.length; k++) if (R.cls[k] === 10) n10++;
    const sp = Math.max(P.forestSpacing, Math.sqrt(n10 / (rx * rz) / (P.forestMax * 1.12))); // spacing stretches so that the budget covers the WHOLE forest, not just its first rows
    const cell = (x, z) => { const i = Math.floor((x - bd.minX) * rx), j = Math.floor((z - bd.minZ) * rz); return i < 0 || j < 0 || i >= R.W || j >= R.H ? 0 : R.cls[j * R.W + i]; };
    let n = 0;
    for (let z = bd.minZ; z < bd.maxZ && n < P.forestMax; z += sp) for (let x = bd.minX; x < bd.maxX && n < P.forestMax; x += sp) {
      const px = x + (rng() - 0.5) * sp * 0.95, pz = z + (rng() - 0.5) * sp * 0.95, q = rng(), r1 = rng(), tint = rng(), yaw = rng() * 6.28;
      if (cell(px, pz) !== 10 || !blockers.free(px, pz, 2.2)) continue;
      const pine = q < 0.86;
      trees.push({ kind: pine ? 'tree2' : 'tree', x: px, z: pz, yaw, s: pine ? 0.85 + r1 * 0.65 : 0.8 + r1 * 0.6, tint }); n++;
    }
  }
  return out.concat(trees);
}
