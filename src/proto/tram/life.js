// Street life around the tram. Built on the engine's movers (cars, buses, trolleybuses, pedestrians drive / walk their own road polylines; the engine
// itself is not touched). What this adds:
//   * clearCorridor: props that would stand on / in front of any track are hidden; the engine's own tram movers are off (our AI trams replace them);
//     dark parked cars are lightened (the engine tints some cars graphite, which reads as black at street level);
//   * yielding: a car / bus / walker that is about to enter a track corridor stops at the edge while a tram is near that crossing (at signalled crossings: while the
//     tram's signal is not red); vehicles already on the rails never stop there, and one that stays stuck on the rails > 5 s is removed;
//   * hazards: people on the rails ahead of the tram are reported to the network (collision protection + obstruction), and pedestrian crossings (a person waits at
//     the kerb, starts crossing when the tram is ~50-100 m away; the bell makes them hurry).
import * as THREE from 'three';
import { PROP_DEFS } from '../../propModels.js';

const R = { tree: 6.5, lamp: 3.2, bench: 3.2, bin: 3.2, kiosk: 5, flag: 3.5, parasol: 4, bike: 3, scooter: 3, stall: 5, bench2: 3, car: 8, van: 8, bus: 10, tram: 12, monument: 0, lantern: 3 };
const nearAny = (tracks, x, z, r) => { for (const t of tracks) if (t.project(x, z, r)) return true; return false; };

/** hide scenery near the tracks, switch off the engine's tram movers, lighten dark cars. Returns counts. */
export function clearCorridor(world, tracks) {
  const counts = { hidden: 0, trams: 0, lightened: 0 };
  const col = new THREE.Color(), lift = new THREE.Color(0xd8dde0);
  for (const o of world.objects) {
    if (o.isBuilding || o.state === 2) continue;
    if (o.mover && o.cls === 'tram') { if (o.m) o.m.off = true; o.state = 2; world._hide(o); counts.trams++; continue; }
    if ((o.cls === 'car' || o.cls === 'van') && o.mesh && o.mesh.instanceColor) {
      o.mesh.getColorAt(o.idx, col);
      if (col.r * 0.3 + col.g * 0.59 + col.b * 0.11 < 0.3) { col.lerp(lift, 0.55); o.mesh.setColorAt(o.idx, col); o.mesh.instanceColor.needsUpdate = true; counts.lightened++; }
    }
    if (o.mover) continue;
    const r = o.kind === 'shelter' ? 7 : R[o.cls];
    if (r && nearAny(tracks, o.x, o.z, r)) { o.state = 2; world._hide(o); counts.hidden++; }
  }
  world.flush();
  // the quality scaler re-enables movers through traffic.setFraction: keep the engine's trams off
  const tr = world.traffic, orig = tr.setFraction.bind(tr);
  tr.setFraction = (f) => { orig(f); for (const o of tr.list) if (o.cls === 'tram') { if (o.m) o.m.off = true; if (o.state !== 2) { o.state = 2; world._hide(o); } } world.flush(); };
  return counts;
}

class Hazard { constructor(o, r, kind) { this.o = o; this.r = r; this.kind = kind; } get x() { return this.o.x; } get z() { return this.o.z; } }

export class Life {
  /** tracks: every track a tram uses (player's first); hazards: planHazards result; net: Network */
  constructor(scene, world, tracks, net, hazards) {
    this.scene = scene; this.world = world; this.tracks = tracks; this.net = net; this.hz = hazards; this.acc = 0; this.t = 0;
    this.held = new Set(); this.dyn = []; this.removed = 0; this.holdsNow = 0;
    this.geos = [0, 1, 2, 3, 4, 5].map((i) => PROP_DEFS['person' + i].make());
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.peds = (hazards.peds || []).map((h, i) => this._ped(h, i));
    this.bellT = -99; this.nose = 0; this.v = 0;
  }
  _ped(h, i) {
    const m = new THREE.Mesh(this.geos[(i * 5 + 2) % 6], this.mat); m.castShadow = true; m.visible = false; this.scene.add(m);
    return { h, mesh: m, state: 'idle', lat: 0, dir: 1, speed: 1.4, trig: 0.88 + ((i * 37) % 25) / 100, cool: 0, haz: { x: 0, z: 0, r: 2.0, kind: 'ped' }, ph: i * 1.7 };
  }
  ringBell(t) { this.bellT = t; }
  dispose() { for (const p of this.peds) this.scene.remove(p.mesh); for (const o of this.held) this._release(o); this.held.clear(); }
  _hold(o) { const m = o.m; if (!o._hold) { o._hold = true; o._base0 = m.base; m.base = 0; this.held.add(o); } }
  _release(o) { if (o._hold) { o._hold = false; o.m.base = o._base0; this.held.delete(o); } }
  /** run = the player's Run (nose position, speed); time = seconds */
  update(dt, run, time) {
    this.t += dt; this.acc += dt; this.nose = run.noseS; this.v = run.v;
    this._peds(dt, run, time);
    if (this.acc < 0.16) return;
    const step = this.acc; this.acc = 0;
    const T0 = this.tracks[0], pp = {}; T0.at(run.noseS, pp);
    const list = this.world.traffic.list, net = this.net, signals = (this.hz.signals || []).filter((g) => g.kind === 'road');
    this.dyn.length = 0; let holds = 0;
    for (const o of list) {
      const m = o.m;
      if (m.off || o.state !== 0 || !m.road) continue;
      const c = o.cls;
      if (c !== 'car' && c !== 'bus' && c !== 'walk') continue;
      const dx = o.x - pp.x, dz = o.z - pp.z;
      if (dx > 150 || dx < -150 || dz > 150 || dz < -150) { if (o._hold) this._release(o); continue; }
      const onTrack = nearAny(this.tracks, o.x, o.z, 3.0);
      if (onTrack) {
        if (o._hold) this._release(o);
        // a vehicle / pedestrian on the rails ahead of the tram is an obstruction for the collision protection; stuck for 5 s -> removed
        const pr = T0.project(o.x, o.z, 2.4);
        if (pr) this.dyn.push(o._hz || (o._hz = new Hazard(o, c === 'walk' ? 1.2 : 2.0, c === 'walk' ? 'ped' : 'veh')));
        o._stuck = m.v < 0.3 ? (o._stuck || 0) + step : 0;
        if (o._stuck > 5) { m.off = true; o.state = 2; this.world._hide(o); this.removed++; }
        continue;
      }
      o._stuck = 0;
      // is a track corridor just ahead of it (in its direction of travel)?
      const L = c === 'walk' ? 6 : 15; let hit = null;
      for (let d = c === 'walk' ? 1.5 : 3; d <= L; d += c === 'walk' ? 1.5 : 3) { const x = o.x + m.tx * d, z = o.z + m.tz * d; if (nearAny(this.tracks, x, z, 2.5)) { hit = { x, z }; break; } }
      if (!hit) { if (o._hold) this._release(o); continue; }
      // which crossing? a signalled one decides by its aspect, otherwise a tram near the crossing
      let want;
      const sg = signals.find((g) => g.cross && (g.cross.x - hit.x) ** 2 + (g.cross.z - hit.z) ** 2 < 28 * 28);
      if (sg) want = sg.aspect !== 'r' && net.tramNear(hit.x, hit.z, 95);
      else want = net.tramNear(hit.x, hit.z, 80);
      if (want) { this._hold(o); holds++; } else this._release(o);
    }
    this.holdsNow = holds;
    this.net.dyn = this.dyn.concat(this.peds.filter((p) => p.state === 'cross' && Math.abs(p.lat) < 2.6).map((p) => p.haz));
  }
  _peds(dt, run, time) {
    const T = this.tracks[0], p = {};
    for (const q of this.peds) {
      const sC = q.h.s, d = sC - run.noseS;
      T.at(sC, p); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
      if (q.state === 'idle') {
        // appears at the kerb when the tram is within ~160 m (only ahead of it), starts to cross at its trigger distance
        if (d < 170 && d > 20) { q.state = 'wait'; q.lat = q.h.side * 6.2; q.dir = -q.h.side; q.mesh.visible = true; q.speed = 1.4; q.mesh.userData.go = false; }
        else continue;
      }
      if (q.state === 'wait') {
        if (d < (30 + 4.2 * Math.max(run.v, 3)) * q.trig && run.v > 1.0) q.state = 'cross';
        if (d < -30) { q.state = 'done'; }
      }
      if (q.state === 'cross') {
        const hurry = time - this.bellT < 12 && d < 160 && d > 0;   // the bell rung in the last 12 s while the tram is within 160 m
        const sp = hurry ? 3.6 : 1.4;
        q.speed += (sp - q.speed) * Math.min(1, dt * 4);
        q.lat += q.dir * q.speed * dt; q.ph += dt * (3 + q.speed * 2.2);
        if (q.dir * q.lat > 6.2) q.state = 'done';
        if (d < -6 && Math.abs(q.lat) < 2.2 && !q.hit) { q.hit = true; }   // (cannot normally happen: the collision protection stops the tram first)
      }
      if (q.state === 'done') { q.mesh.visible = false; if (d < -60 || d > 600) { q.state = 'idle'; q.hit = false; } continue; }
      q.mesh.position.set(p.x + rx * q.lat, 0.0 + Math.abs(Math.sin(q.ph)) * (q.state === 'cross' ? 0.07 : 0), p.z + rz * q.lat);
      q.mesh.rotation.y = q.state === 'cross' ? Math.atan2(-rz * q.dir, rx * q.dir) : Math.atan2(-rz * q.dir, rx * q.dir) + 0;
      q.haz.x = q.mesh.position.x; q.haz.z = q.mesh.position.z;
    }
  }
  /** the hazard state of the nearest pedestrian crossing ahead (for the HUD / tests): { d, state } | null */
  nextPed(maxD = 1e9) { let best = null; for (const q of this.peds) { const d = q.h.s - this.nose; if (d > -5 && d < maxD && (q.state === 'wait' || q.state === 'cross') && (!best || d < best.d)) best = { d, state: q.state, lat: q.lat }; } return best; }
}
