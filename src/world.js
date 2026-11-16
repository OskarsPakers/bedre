// World: ground, buildings, props, swallowable object registry + spatial grid + fall animation.
import * as THREE from 'three';
import { CFG } from './config.js';
import { createGround } from './ground.js';
import { groundTier } from './quality.js';
import { buildBuildings } from './buildings.js';
import { Blockers, scatterProps } from './scatter.js';
import {
  PROP_DEFS, CAR_TINTS, BUS_TINTS, TRAM_TINTS, TREE_TINTS, PINE_TINTS, KIOSK_TINTS, PARASOL_TINTS, STALL_TINTS, BIKE_TINTS, SCOOTER_TINTS, BIRD_TINTS,
} from './propModels.js';
import { mulberry32 } from './rng.js';
import { LIFE } from './config.js';
import { bus } from './events.js';
import { Effects } from './effects.js';
import { RoadNet, Traffic, planMovers, moverParks, moverFromRecord, moverRecord, netSignature } from './traffic.js';
import { generateRequested } from './placements.js';
import { MOVER_STRIDE } from '../worker/mp/table.js';
import { rigaProps } from './riga.js';

const CELL = 24;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);
function shuffleInPlace(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
}

export class World {
  constructor(scene, data) {
    this.scene = scene;
    this.data = data;
    this.bounds = data.meta.bounds;
    this.objects = [];
    this.grid = new Map();
    this.falling = new Set();
    this.wobbling = new Set();
    this.dirtyMeshes = new Set();
    this.counts = { props: 0, buildings: 0, remainingProps: 0, remainingBuildings: 0 };
    this.onUpdate = [];          // per-sim-step hooks fn(dt, time)  (audio, level watcher, ...)
    this.holesRef = null;        // () => Hole[]   (set by life.js; used for mover panic)
    this._qx = 0; this._qz = 0;  // centre of the last query (wobble lean direction)
    this.fx = new Effects(scene);
    this.traffic = new Traffic(this);
    this.net = new RoadNet(data);

    this.ground = createGround(data, groundTier());
    scene.add(this.ground);

    const b = buildBuildings(data);
    // placement file (worker/mp/table.js): the canonical object list. Valid -> props + movers are built FROM it and every building takes its
    // canonical fit / value from it (float geometry math differs between JS engines); otherwise the procedural scatter runs (generator / fallback).
    this.generate = generateRequested();
    const pr = data.placements || null;
    let pt = (!this.generate && pr && pr.table) || null;
    let why = pr ? pr.reason : null;
    if (pt) { why = this._checkPlacements(pt, b.items, data); if (why) pt = null; }
    this.placements = { source: pt ? 'file' : 'procedural', hash: pt ? pt.hash : null, reason: this.generate ? 'generate' : (why || (pr ? null : 'none')), table: pt };
    if (pt) for (let i = 0; i < b.items.length; i++) { b.items[i].fit = pt.fit[i]; b.items[i].value = pt.value[i]; }
    this.buildingMesh = b.mesh;
    scene.add(b.mesh);
    this.buildingItems = b.items;
    this.shapeStats = b.stats;
    this.detail = 2;
    for (let i = 0; i < b.items.length; i++) {
      const it = b.items[i];
      this._add({
        kind: 'building', cls: 'building', x: it.x, z: it.z, fit: it.fit, value: it.value, h: it.h, wallCol: it.wallCol,
        name: it.name, landmark: it.landmark, bt: it.t, yaw: 0, s: 1, batchId: it.batchId, isBuilding: true,
      });
    }
    this.blockers = new Blockers(b.items.map((it) => it.ring), data.water);
    if (pt && pt.meta.spawn) this.spawn = pt.meta.spawn;
    else { const bb = this.bounds, dist = data.meta.slug && data.meta.slug !== 'centrs'; this.spawn = this.findSpawn(dist ? (bb.minX + bb.maxX) / 2 : 0, dist ? (bb.minZ + bb.maxZ) / 2 : 0); } // district maps: map middle; centre: origin as before
    this._buildProps(data, pt);
    if (pt) { // ids must be exactly the file's indices (the server's table): any drift disables online instead of desyncing it
      let bad = this.objects.length !== pt.n;
      for (let i = pt.nB; !bad && i < pt.n; i++) if (this.objects[i].kind !== pt.kinds[pt.kind[i]] || this.objects[i].x !== pt.x[i] && !(pt.flags[i] & 1)) bad = true;
      if (bad) { console.warn('[placements] object ids drifted from the file: online disabled'); this.placements.hash = null; this.placements.reason = 'order'; }
    }
    shuffleInPlace(this.traffic.list, mulberry32(CFG.seed + 3));
    this.counts.props = this.objects.length - b.items.length;
    this.counts.buildings = b.items.length;
    this.resetCounts();
  }

  /** quality tier: at `low` the relief (non-notable) shaped buildings switch to their flat-extrusion variant (geometry ids only, no rebuild) */
  setDetail(level) {
    if (level === this.detail) return;
    this.detail = level;
    const mesh = this.buildingMesh;
    for (const it of this.buildingItems) if (it.gidBox >= 0) mesh.setGeometryIdAt(it.batchId, level === 0 ? it.gidBox : it.gidShape);
  }

  resetCounts() {
    this.counts.remainingBuildings = this.counts.buildings;
    this.counts.remainingProps = this.counts.props;
  }

  _add(o) {
    o.id = this.objects.length;
    o.state = 0; o.t = 0; o.dur = 1; o.wob = 0; o.wobT = 0;
    this.objects.push(o);
    const k = Math.floor(o.x / CELL) * 100003 + Math.floor(o.z / CELL);
    o.cell = k;
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(o);
    return o;
  }

  /** Does the placement file belong to these buildings / this road graph? Returns null when fine, else a reason string. */
  _checkPlacements(pt, items, data) {
    if (pt.nB !== items.length) return 'buildings';
    for (let i = 0; i < items.length; i++) {
      if (!(pt.flags[i] & 2) || Math.abs(pt.x[i] - items[i].x) > 0.1 || Math.abs(pt.z[i] - items[i].z) > 0.1) return 'buildings';
    }
    const sig = netSignature(this.net, data), want = pt.meta.roads || {};
    for (const k of Object.keys(sig)) if (sig[k] !== want[k]) return 'roads';
    return null;
  }

  /** Placements from the file: one entry per object id >= nB, in id order (which regroups to exactly the same ids). */
  _placementsFromFile(pt, data) {
    const out = [], parks = moverParks(data);
    let mi = 0;
    for (let i = pt.nB; i < pt.n; i++) {
      const p = { kind: pt.kinds[pt.kind[i]], x: pt.x[i], z: pt.z[i], yaw: pt.yaw[i], s: pt.s[i], tint: pt.tint[i] === 65535 ? undefined : pt.tint[i] / 4094, fit: pt.fit[i], value: pt.value[i], name: null, landmark: !!(pt.flags[i] & 4) };
      if (pt.flags[i] & 1) {
        p.m = moverFromRecord(pt.movers.subarray(mi * MOVER_STRIDE, (mi + 1) * MOVER_STRIDE), this.net, parks, p, this.blockers);
        mi++;
      }
      out.push(p);
    }
    for (const [id, name] of pt.meta.names || []) if (id >= pt.nB) out[id - pt.nB].name = name;
    return out;
  }

  _buildProps(data, pt) {
    let placements;
    if (pt) placements = this._placementsFromFile(pt, data);
    else {
      placements = this._planProcedural(data);
      if (this.generate) for (const p of placements) if (p.m) p.rec = moverRecord(p);
    }
    this._instantiate(placements);
  }

  /** The procedural scatter (generator + fallback). Engine-dependent: never the source of truth for online play. */
  _planProcedural(data) {
    const VEH = new Set(['car', 'van', 'bus', 'tram', 'kiosk']);
    const placements = scatterProps(data, this.blockers).filter((p) =>
      !(VEH.has(p.kind) && Math.hypot(p.x - this.spawn[0], p.z - this.spawn[1]) < 24));
    // standalone landmark monuments (landmarks not matched to a building)
    const lmNames = new Set(this.buildingItems.map((it) => it.lmName));
    for (const lm of data.landmarks) {
      if (lmNames.has(lm.n)) continue;
      if (/Laimas pulkstenis/i.test(lm.n)) { placements.push({ kind: 'laima', x: lm.x, z: lm.z, yaw: 0, s: 1, name: 'Laimas pulkstenis', landmark: true }); continue; }
      if (/Brīvības piemineklis/i.test(lm.n)) {
        // riga.json puts the monument ~7 m off: the reality-mesh survey (height-weighted centroid of the >10 m cells, aligned with the
        // cadastre to <1 m) puts the column at (-1.7, 4.3). Only applied where the data really is the OSM point.
        const fix = Math.hypot(lm.x - 3.4, lm.z + 1.5) < 4 ? [-1.7, 4.3] : [lm.x, lm.z];
        placements.push({ kind: 'freedom', x: fix[0], z: fix[1], yaw: 0, s: 1, name: lm.n, landmark: true }); continue; }
      const s = Math.max(0.6, (lm.h || 20) / 20);
      placements.push({ kind: 'monument', x: lm.x, z: lm.z, yaw: 0, s, name: lm.n, landmark: true });
    }
    // Rīga street flavour: stops, flags, terraces, stalls, bikes, lanterns, bridge landmarks (riga.js)
    for (const p of rigaProps({ data, blockers: this.blockers, buildingItems: this.buildingItems, net: this.net })) placements.push(p);
    // moving traffic / pedestrians (traffic.js)
    const mrng = mulberry32(CFG.seed + 77);
    const movers = planMovers(this.net, this.blockers, mrng).filter((p) =>
      !(['car', 'bus', 'tram'].includes(p.kind) && Math.hypot(p.x - this.spawn[0], p.z - this.spawn[1]) < 24));
    shuffleInPlace(movers, mrng);
    for (const p of movers) placements.push(p);
    return placements;
  }

  _instantiate(placements) {
    // generator: snap positions to the file's 1/16 m grid BEFORE chunking, so that re-grouping the file (src/world.js _placementsFromFile) reproduces exactly the same chunks and ids
    if (this.generate) for (const p of placements) { p.x = Math.round(p.x * 16) / 16; p.z = Math.round(p.z * 16) / 16; }
    const groups = new Map();
    for (const p of placements) {
      // static props (trees included) are chunked into 250 m cells so each chunk can be frustum-culled: an un-chunked instanced mesh
      // submits EVERY instance of the whole map each frame (the triangle count of a dense district map was 2-3x what is on screen).
      // Movers (cars, people, boats...) keep one mesh per kind: they travel across cells and their bounds would go stale.
      const gk = p.m ? p.kind : `${p.kind}:${Math.floor(p.x / 250)}:${Math.floor(p.z / 250)}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(p);
    }
    const rng = mulberry32(CFG.seed + 5);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.propMeshes = [];
    this.treeMeshes = [];
    const geoOfKind = new Map();
    const lowTier = groundTier() === 0; // phones / low-memory tier: simpler tree crowns
    const col = new THREE.Color();
    const tintsFor = { car: CAR_TINTS, van: CAR_TINTS, bus: BUS_TINTS, tram: TRAM_TINTS, tree: TREE_TINTS, tree2: PINE_TINTS, kiosk: KIOSK_TINTS, parasol: PARASOL_TINTS, stall: STALL_TINTS, bike: BIKE_TINTS, scooter: SCOOTER_TINTS, pigeon: BIRD_TINTS };
    for (const [, list] of groups) {
      const kind = list[0].kind;
      const def = PROP_DEFS[kind];
      let geo = geoOfKind.get(kind); if (!geo) geoOfKind.set(kind, (geo = def.make(kind === 'tree' || kind === 'tree2' ? lowTier : undefined))); // one geometry per kind, shared by every chunk
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const chunked = !list[0].m;
      mesh.frustumCulled = false;
      mesh.castShadow = !['bike', 'scooter', 'pigeon', 'swan', 'bench', 'bin', 'cafeset'].includes(kind);
      if (kind === 'tree' || kind === 'tree2') this.treeMeshes.push(mesh);
      mesh.receiveShadow = kind === 'tree' || kind === 'tree2' || def.cls === 'car' ? false : true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((p, i) => {
        if (def.tint) {
          const tints = tintsFor[kind];
          if (tints) col.set(tints[Math.floor((p.tint ?? rng()) * tints.length) % tints.length]);
          else col.set(0xffffff);
          if (kind === 'tree' || kind === 'tree2') col.multiplyScalar(0.85 + rng() * 0.3);
          mesh.setColorAt(i, col);
        }
        const val = def.value * (kind === 'tree2' ? Math.max(2, Math.round(p.s * 2.4)) : kind === 'tree' ? Math.max(1, Math.round(p.s * 1.5)) : kind === 'monument' ? p.s : 1);
        const o = this._add({
          kind, cls: def.cls, x: p.x, z: p.z, fit: p.fit ?? def.fit * p.s, value: p.value ?? Math.max(1, Math.round(val)), h: def.h * p.s,
          name: p.name || null, landmark: !!p.landmark, yaw: p.yaw, s: p.s, mesh, idx: i, isBuilding: false, moverM: p.m || null, p: this.generate ? p : null,
        });
        if (p.m) { o.mover = true; this.traffic.register(o); }
        this._write(o, o.x, 0, o.z, null, o.s);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (chunked) { mesh.computeBoundingSphere(); const bs = mesh.boundingSphere; if (bs) bs.radius += 4; mesh.frustumCulled = true; } // +4 m: objects tilt / slide while falling
      this.scene.add(mesh);
      this.propMeshes.push(mesh);
    }
  }

  /** Write the transform of an object. q = extra rotation (applied after yaw), may be null. */
  _write(o, px, py, pz, q, scale) {
    _p.set(px, py, pz);
    _q.setFromAxisAngle(_up, o.yaw);
    if (q) _q.premultiply(q);
    _s.setScalar(scale);
    _m.compose(_p, _q, _s);
    if (o.isBuilding) this.buildingMesh.setMatrixAt(o.batchId, _m);
    else { o.mesh.setMatrixAt(o.idx, _m); this.dirtyMeshes.add(o.mesh); }
  }

  _hide(o) {
    if (o.isBuilding) this.buildingMesh.setVisibleAt(o.batchId, false);
    else { o.mesh.setMatrixAt(o.idx, _zero); this.dirtyMeshes.add(o.mesh); }
  }

  /** Move an object's centre, updating its spatial-grid cell only when it crosses a cell border. */
  moveObject(o, x, z) {
    o.x = x; o.z = z;
    const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    if (k === o.cell) return;
    const old = this.grid.get(o.cell);
    if (old) { const i = old.indexOf(o); if (i >= 0) { old[i] = old[old.length - 1]; old.pop(); } }
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(o);
    o.cell = k;
  }

  /** Call objects within circle (cx,cz,r) whose centre is inside. */
  query(cx, cz, r, fn) {
    this._qx = cx; this._qz = cz;
    const x0 = Math.floor((cx - r) / CELL), x1 = Math.floor((cx + r) / CELL);
    const z0 = Math.floor((cz - r) / CELL), z1 = Math.floor((cz + r) / CELL);
    const r2 = r * r;
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const a = this.grid.get(i * 100003 + j);
      if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const o = a[n];
        if (o.state === 2) continue;
        const dx = o.x - cx, dz = o.z - cz;
        if (dx * dx + dz * dz <= r2) fn(o, Math.sqrt(dx * dx + dz * dz));
      }
    }
  }

  beginFall(o, hole) {
    const F = LIFE.fall;
    o.state = 1; o.t = 0; o.hole = hole;
    o.sx = o.x; o.sz = o.z;
    const big = Math.min(1, o.fit / Math.max(0.01, hole.radius));
    o.dur = CFG.swallow.durMin + (CFG.swallow.durMax - CFG.swallow.durMin) * big;
    if (o.isBuilding) o.dur *= 1 + F.bigBuildingSlower * Math.min(1, o.h / 70);
    o.tiltMax = o.isBuilding ? 1.0 : 1.15;
    o.spin = (Math.random() - 0.5) * 2 * F.spin * (o.isBuilding ? 1 : 2.5);
    o.leanP = o.isBuilding ? 0.2 : 0.08;
    this.falling.add(o);
    this.wobbling.delete(o);
    if (o.isBuilding) this.counts.remainingBuildings--; else this.counts.remainingProps--;
    bus.emit('swallow', o, hole);
  }

  /** Mark a too-big object as wobbling this frame (leans towards the hole that undermines it). */
  wobble(o, amount) {
    if (o.state !== 0) return;
    o.wob = Math.max(o.wob, amount);
    o.wdx = this._qx - o.x; o.wdz = this._qz - o.z;
    const l = Math.hypot(o.wdx, o.wdz) || 1;
    o.wdx /= l; o.wdz /= l;
    this.wobbling.add(o);
  }

  update(dt, time) {
    const F = LIFE.fall;
    for (const o of this.falling) {
      o.t += dt / o.dur;
      const t = Math.min(1, o.t);
      const h = o.hole;
      let dx = h.x - o.sx, dz = h.z - o.sz;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-3) { dx /= dl; dz /= dl; } else { dx = 1; dz = 0; }
      _ax.set(dz, 0, -dx);
      const lp = o.leanP;
      let px, pz, tilt, sink, yawSpin = 0;
      if (t < lp) { // anticipation: lean towards the hole and shudder before dropping
        const k = t / lp;
        tilt = F.buildingLean * k * k * (o.isBuilding ? 1 : 0.5) + Math.sin(t * 90 + o.id) * 0.012 * (o.isBuilding ? 1 : 0);
        px = o.sx; pz = o.sz; sink = 0.15 * k * (o.h > 8 ? 1 : 0.3);
      } else {
        const u = (t - lp) / (1 - lp);
        const slide = o.isBuilding ? Math.pow(Math.min(1, u / 0.9), 1.7) * F.buildingSlide : (() => { const p = Math.min(1, u / 0.7); return p * p * (3 - 2 * p); })();
        px = o.sx + (h.x - o.sx) * slide; pz = o.sz + (h.z - o.sz) * slide;
        tilt = F.buildingLean + (o.tiltMax - F.buildingLean) * Math.min(1, u * 2.2) * (2 - Math.min(1, u * 2.2));
        sink = ((o.h * 1.15 + 2.2 + h.radius * 0.2) * Math.pow(u, 2.2)) + 0.15;
        yawSpin = o.spin * u * u;
      }
      _q2.setFromAxisAngle(_ax, tilt);
      if (yawSpin) { _q.setFromAxisAngle(_up, yawSpin); _q2.multiply(_q); }
      const sc = t < lp ? 1 : 1 - 0.4 * ((t - lp) / (1 - lp));
      this._write(o, px, -sink, pz, _q2, o.s * sc);
      if (o.t >= 1) {
        o.state = 2;
        this._hide(o);
        this.falling.delete(o);
        bus.emit('landed', o, h);
      }
    }
    for (const o of this.wobbling) {
      o.wobT += dt;
      const a = o.wob;
      o.wob -= dt * 4; // decays unless refreshed
      if (o.wob <= 0) {
        o.wob = 0; o.wobT = 0;
        this._write(o, o.x, 0, o.z, null, o.s);
        this.wobbling.delete(o);
        continue;
      }
      // groaning lean towards the hole + a shudder; a little dust falls off the base
      const ph = o.wobT * 23 + o.id;
      const amt = Math.min(1, a);
      const lean = 0.03 * amt + 0.012 * amt * Math.sin(o.wobT * 6);
      _ax.set(o.wdz, 0, -o.wdx);
      _q2.setFromAxisAngle(_ax, lean);
      _q.setFromAxisAngle(_ax.set(Math.sin(ph), 0, Math.cos(ph * 1.3)).normalize(), 0.014 * amt * Math.sin(ph * 0.7));
      _q2.multiply(_q);
      this._write(o, o.x, -0.12 * amt, o.z, _q2, o.s);
      if (Math.random() < dt * 3 * amt) this.fx.dustAt(o.x - o.wdx * o.fit * 0.6, o.z - o.wdz * o.fit * 0.6, 0.3 + Math.random() * 0.8, Math.min(o.fit, 14), 1);
    }
    this.traffic.update(dt);
    this.fx.update(dt);
    for (let i = 0; i < this.onUpdate.length; i++) this.onUpdate[i](dt, time);
    this.flush();
  }

  flush() {
    for (const m of this.dirtyMeshes) m.instanceMatrix.needsUpdate = true;
    this.dirtyMeshes.clear();
  }

  reset() {
    this.falling.clear();
    this.wobbling.clear();
    this.fx.reset();
    for (const o of this.objects) {
      if (o.state === 0 && o.wob === 0) continue;
      o.state = 0; o.t = 0; o.wob = 0; o.hole = null;
      this._write(o, o.x, 0, o.z, null, o.s);
      if (o.isBuilding) this.buildingMesh.setVisibleAt(o.batchId, true);
    }
    this.resetCounts();
    this.traffic.reset();
    this.flush();
  }

  /** Walkable start: nearest road vertex to origin that is not in water / building. */
  findSpawn(ox = 0, oz = 0) {
    let best = null, bd = Infinity;
    const ok = (x, z) => this.blockers.free(x, z, 3);
    for (const r of this.data.roads) {
      if (!r.p || r.k === 'rail' || r.k === 'motorway') continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 6));
        for (let k = 0; k <= n; k++) {
          const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
          const d = Math.hypot(x - ox, z - oz);
          if (d < bd && ok(x, z)) { bd = d; best = [x, z]; }
        }
      }
    }
    if (best) return best;
    for (let rad = 0; rad < 600; rad += 4) for (let a = 0; a < 6.28; a += 0.3) {
      const x = ox + Math.cos(a) * rad, z = oz + Math.sin(a) * rad;
      if (ok(x, z)) return [x, z];
    }
    return [ox, oz];
  }
}
