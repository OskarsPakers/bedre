// Moving life: cars / taxis / buses / trolleybuses / trams drive along the real road polylines (right-hand traffic, junction
// turns via a vertex-snapped node graph; trams only on OSM tram tracks), pause at stops, follow the car in front; pedestrians
// walk footways + pavements, park strollers wander, boats / swans follow centre-lines of the water polygons, pigeons scatter.
// Movers are ordinary swallowable world objects (InstancedMesh instances); only their matrices + spatial-grid cell are touched.
import { CFG, LIFE } from './config.js';
import { pointInPoly, bbox, cleanRing } from './geo.js';
import { PEOPLE_COLORS } from './propModels.js';
import { waterRoutes } from './water.js';

const DEFAULT_W = { primary: 14, secondary: 10, tertiary: 8, residential: 7, service: 4, pedestrian: 6, footway: 2.5, tram: 3.4, water: 20 };
const KINDS = {
  car: new Set(['primary', 'secondary', 'tertiary', 'residential']),
  bus: new Set(['primary', 'secondary', 'tertiary']),
  trolley: new Set(['primary', 'secondary']),
  tram: new Set(['tram']),
  walk: new Set(['pedestrian', 'footway', 'residential', 'tertiary', 'secondary', 'primary']),
  boat: new Set(['water']),
};
const NET_OF = { car: 'car', taxi: 'car', bus: 'bus', trolley: 'trolley', tram: 'tram', walk: 'walk', boat: 'boat', swan: 'boat' };
const NET_IDX = { car: 0, bus: 1, trolley: 2, tram: 3, walk: 4, boat: 5 };
const LEN = { car: 4.6, taxi: 4.6, bus: 12, trolley: 12, tram: 25, boat: 10, swan: 1.5 };
const TRANSIT = new Set(['bus', 'trolley', 'tram']);
const key = (x, z) => (Math.round(x / 1.5) + 4000) * 10000 + (Math.round(z / 1.5) + 4000);
const TAU = Math.PI * 2;
const ctx = { inWater: null };

class Net {
  constructor(roadList, kinds, idx, minComp = 0) {
    this.idx = idx;
    this.roads = [];
    this.vmap = new Map();
    this.cum = [];
    let tot = 0;
    for (const r of roadList) {
      if (!r.p || r.p.length < 2 || !kinds.has(r.k)) continue;
      const len = [];
      let L = 0;
      for (let i = 0; i < r.p.length - 1; i++) { const d = Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]); len.push(d); L += d; }
      if (L < 8) continue;
      this.roads.push({ p: r.p, len, L, w: r.w || DEFAULT_W[r.k] || 6, k: r.k, canal: !!r.canal, foot: r.k === 'pedestrian' || r.k === 'footway', id: this.roads.length, stops: null, net: idx });
    }
    if (minComp > 0) this._keepBigComponents(minComp);
    for (const road of this.roads) {
      tot += road.L;
      this.cum.push(tot);
      for (let j = 0; j < road.p.length; j++) {
        const k = key(road.p[j][0], road.p[j][1]);
        let a = this.vmap.get(k);
        if (!a) this.vmap.set(k, (a = []));
        a.push({ road, j });
      }
    }
    this.total = tot;
  }

  _keepBigComponents(minL) {
    const par = this.roads.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const first = new Map();
    this.roads.forEach((r, i) => {
      for (const j of [0, r.p.length - 1]) {
        const k = key(r.p[j][0], r.p[j][1]);
        if (first.has(k)) par[find(i)] = find(first.get(k)); else first.set(k, i);
      }
    });
    const tot = new Map();
    this.roads.forEach((r, i) => tot.set(find(i), (tot.get(find(i)) || 0) + r.L));
    this.roads = this.roads.filter((r, i) => tot.get(find(i)) >= minL);
    this.roads.forEach((r, i) => { r.id = i; });
  }

  pick(rng) {
    const t = rng() * this.total;
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cum[mid] < t) lo = mid + 1; else hi = mid; }
    return this.roads[lo];
  }

  /** attach stop positions to nearest segment: road.stops[seg] = [offset along segment from its first vertex] */
  attachStops(pts, maxD = 14) {
    for (const [sx, sz] of pts) {
      let best = null, bd = maxD;
      for (const r of this.roads) {
        for (let i = 0; i < r.p.length - 1; i++) {
          const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
          const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((sx - x0) * dx + (sz - z0) * dz) / l2));
          const d = Math.hypot(sx - (x0 + t * dx), sz - (z0 + t * dz));
          if (d < bd) { bd = d; best = { r, i, off: t * Math.sqrt(l2) }; }
        }
      }
      if (best) {
        const r = best.r;
        if (!r.stops) r.stops = {};
        (r.stops[best.i] || (r.stops[best.i] = [])).push(best.off);
        r.stopPts = r.stopPts || [];
        r.stopPts.push([sx, sz]);
      }
    }
  }
}

export class RoadNet {
  constructor(data) {
    this.data = data;
    this.nets = {};
    const mk = (name, list, minComp) => { this.nets[name] = new Net(list, KINDS[name], NET_IDX[name], minComp); };
    mk('car', data.roads); mk('bus', data.roads); mk('trolley', data.roads); mk('walk', data.roads);
    const tw = (data.tramways || []).map((t) => ({ p: t.p, k: 'tram', w: 3.4 }));
    this.realTrams = tw.length > 0;
    mk('tram', this.realTrams ? tw : data.roads.filter((r) => r.k === 'primary').map((r) => ({ ...r, k: 'tram' })), this.realTrams ? 250 : 0);
    this.routes = waterRoutes(data);
    mk('boat', this.routes, 0);
    const stops = data.stops || [];
    this.nets.tram.attachStops(stops.filter((s) => s[2]).map((s) => [s[0], s[1]]), 12);
    this.nets.bus.attachStops(stops.filter((s) => !s[2]).map((s) => [s[0], s[1]]), 14);
    this.nets.trolley.attachStops(stops.filter((s) => !s[2]).map((s) => [s[0], s[1]]), 14);
  }
}

function laneOff(cls, road) {
  if (cls === 'tram' || cls === 'boat') return 0;
  return road.w * LIFE.movers.laneFrac;
}

function setSeg(m, road, a, dir) {
  m.road = road; m.a = a; m.dir = dir;
  m.b = a + dir;
  const [x0, z0] = road.p[a], [x1, z1] = road.p[m.b];
  const L = road.len[dir > 0 ? a : m.b] || 0.01;
  m.L = L; m.tx = (x1 - x0) / L; m.tz = (z1 - z0) / L; m.x0 = x0; m.z0 = z0;
  let lf;
  if (m.cls === 'walk') {
    lf = road.foot ? m.cw * road.w * 0.3 : m.side * (road.w / 2 + 0.9 + Math.abs(m.cw) * 0.5);
    if (!road.foot && ctx.inWater) { // keep pedestrians out of the water: try the other pavement, else the centreline
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, tx = m.tx, tz = m.tz;
      const wet = (side) => ctx.inWater(mx - tz * side * (road.w / 2 + 1.1) * dir, mz + tx * side * (road.w / 2 + 1.1) * dir);
      if (wet(m.side)) { if (!wet(-m.side)) { m.side = -m.side; lf = m.side * (road.w / 2 + 1.2); } else lf = 0; }
    }
  } else if (m.cls === 'swan') lf = m.cw * Math.max(2, road.w * 0.3);
  else lf = dir * laneOff(m.cls, road);
  m.lat = lf * dir; // lateral in travel frame (right-hand normal = (-tz, tx))
  // stop on this segment?
  m.stopS = -1; m.stopDone = false;
  if (road.stops && TRANSIT.has(m.cls)) {
    const list = road.stops[Math.min(a, m.b)];
    if (list) { const off = list[0]; m.stopS = dir > 0 ? off : L - off; }
  }
}

/** Build mover placements (kind, x, z, yaw, tint, m) for world._buildProps. */
export function planMovers(net, blockers, rng) {
  const M = LIFE.movers;
  ctx.inWater = (x, z) => blockers.inWater(x, z);
  const out = [];
  const mk = (cls, kind, n, filt) => {
    const nn = net.nets[NET_OF[cls]];
    if (!nn.roads.length) return;
    for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
      const road = nn.pick(rng);
      if (filt && !filt(road)) continue;
      const a = Math.floor(rng() * road.len.length);
      const dir = rng() < 0.5 ? 1 : -1;
      const a2 = dir > 0 ? a : a + 1;
      const m = { cls, ni: nn.idx, side: rng() < 0.5 ? -1 : 1, cw: rng() * 2 - 1, ph: rng() * 20, off: false, cool: 0, v: 0, vt: 0, cx: 0, cz: 0, yaw: 0, init: null, dwell: 0, stopS: -1, stopDone: false };
      setSeg(m, road, a2, dir);
      m.s = rng() * m.L;
      let base;
      if (cls === 'car') base = (M.carSpeed[road.k] || 6) * (0.96 + rng() * 0.08);
      else if (cls === 'bus') base = M.busSpeed * (0.97 + rng() * 0.06);
      else if (cls === 'trolley') base = M.busSpeed * 0.95 * (0.97 + rng() * 0.06);
      else if (cls === 'tram') base = M.tramSpeed;
      else if (cls === 'boat') base = kind === 'ferry' ? 3.2 : 2.3;
      else if (cls === 'swan') base = 0.5 + rng() * 0.3;
      else base = M.walkSpeed * (0.7 + rng() * 0.6);
      m.base = base; m.v = m.vt = base;
      const px = m.x0 + m.tx * m.s - m.tz * m.lat, pz = m.z0 + m.tz * m.s + m.tx * m.lat;
      if (cls === 'walk' && blockers.inBuilding(px, pz, 0.6)) continue;
      m.yaw = Math.atan2(-m.tz, m.tx);
      m.init = { road, a: m.a, dir: m.dir, s: m.s };
      const v = Math.floor(rng() * PEOPLE_COLORS.length);
      out.push({ kind: cls === 'walk' ? 'person' + v : kind, x: px, z: pz, yaw: m.yaw, tint: rng(), s: 0.92 + rng() * 0.18, m });
      i++;
    }
  };
  // cars (some of them taxis, own model)
  const nTax = Math.round(M.cars * M.taxiFrac);
  mk('car', 'car', M.cars - nTax);
  mk('car', 'taxi', nTax);
  mk('bus', 'bus', M.buses);
  mk('trolley', 'trolleybus', M.trolleys);
  mk('tram', 'tram', M.trams);
  mk('walk', 'person', M.walkers);
  const hasCanal = net.nets.boat.roads.some((r) => r.canal), hasRiver = net.nets.boat.roads.some((r) => !r.canal);
  mk('boat', 'boat', M.boats, hasCanal ? (r) => r.canal : null);
  mk('boat', 'ferry', M.ferries, hasRiver ? (r) => !r.canal : null);
  mk('swan', 'swan', M.swans, hasCanal ? (r) => r.canal : null);

  // birds: pigeons on pedestrian streets / squares, gulls along the water
  const birds = (n, kind, fromWater) => {
    const wn = net.nets.walk;
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      let x, z;
      if (fromWater) {
        const r = net.nets.boat.roads.length ? net.nets.boat.pick(rng) : null;
        if (!r) return;
        const seg = Math.floor(rng() * r.len.length), t = rng();
        const [x0, z0] = r.p[seg], [x1, z1] = r.p[seg + 1];
        x = x0 + (x1 - x0) * t + (rng() - 0.5) * r.w * 0.5; z = z0 + (z1 - z0) * t + (rng() - 0.5) * r.w * 0.5;
      } else {
        const r = wn.pick(rng);
        if (!r.foot) continue;
        const seg = Math.floor(rng() * r.len.length), t = rng();
        const [x0, z0] = r.p[seg], [x1, z1] = r.p[seg + 1];
        x = x0 + (x1 - x0) * t + (rng() - 0.5) * r.w; z = z0 + (z1 - z0) * t + (rng() - 0.5) * r.w;
        if (blockers.inBuilding(x, z, 0.8) || blockers.inWater(x, z)) continue;
      }
      const flock = fromWater ? 1 : 1 + Math.floor(rng() * 4);
      for (let f = 0; f < flock && i < n; f++, i++) {
        const bx = x + (rng() - 0.5) * 3, bz = z + (rng() - 0.5) * 3;
        const m = { cls: 'bird', hx: bx, hz: bz, st: 0, t: rng() * 5, y: 0, yaw: rng() * TAU, off: false, cool: 0, v: 0, vt: 0, base: 6, cx: 0, cz: 0, ph: rng() * 9, vx: 0, vz: 0, init: { x: bx, z: bz } };
        out.push({ kind, x: bx, z: bz, yaw: m.yaw, tint: fromWater ? 0.99 : rng() * 0.8, s: 0.9 + rng() * 0.25, m });
      }
    }
  };
  birds(M.pigeons, 'pigeon', false);
  birds(M.gulls, 'pigeon', true);

  // park strollers
  const parks = [];
  for (const pk of net.data.parks) {
    const r = cleanRing(pk.p);
    if (r.length < 3) continue;
    const b = bbox(r);
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    if (area > 1500) parks.push({ r, b, area });
  }
  if (parks.length) {
    const totA = parks.reduce((s, p) => s + p.area, 0);
    for (let i = 0, tries = 0; i < M.wanderers && tries < M.wanderers * 30; tries++) {
      let t = rng() * totA, pk = parks[0];
      for (const p of parks) { t -= p.area; if (t <= 0) { pk = p; break; } }
      const x = pk.b.x0 + rng() * (pk.b.x1 - pk.b.x0), z = pk.b.z0 + rng() * (pk.b.z1 - pk.b.z0);
      if (!pointInPoly(x, z, pk.r) || blockers.inBuilding(x, z, 1)) continue;
      const hd = rng() * TAU;
      const m = { cls: 'wander', ring: pk.r, hd, ph: rng() * 20, off: false, cool: 0, v: 0, vt: 0, base: M.wanderSpeed * (0.6 + rng() * 0.8), yaw: hd, cx: 0, cz: 0, t: rng(), init: { x, z, hd } };
      m.v = m.vt = m.base;
      out.push({ kind: 'person' + Math.floor(rng() * PEOPLE_COLORS.length), x, z, yaw: m.yaw, tint: rng(), s: 0.92 + rng() * 0.18, m });
      i++;
    }
  }
  return out;
}

export class Traffic {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.net = null;
    this.rng = Math.random;
    this.fraction = 1;
    this.time = 0;
    this.buckets = new Map();
    this.stats = { active: 0, moved: 0, dwelling: 0 };
  }

  register(o) { o.m = o.moverM; this.list.push(o); }

  setFraction(f) {
    this.fraction = f;
    const n = this.list.length;
    const keep = Math.round(n * f);
    for (let i = 0; i < n; i++) {
      const o = this.list[i], m = o.m;
      const want = i >= keep;
      if (want && !m.off) { m.off = true; if (o.state === 0) { o.state = 2; this.world._hide(o); } }
      else if (!want && m.off) { m.off = false; if (o.state === 2) { o.state = 0; this._respawn(o); } }
    }
    this.world.flush();
  }

  reset() {
    for (const o of this.list) {
      const m = o.m;
      if (m.off) { o.state = 2; this.world._hide(o); }
      this._init(o);
      if (!m.off) this._place(o, 0);
    }
  }

  _init(o) {
    const m = o.m;
    if (m.cls === 'wander') { this.world.moveObject(o, m.init.x, m.init.z); m.hd = m.init.hd; }
    else if (m.cls === 'bird') { this.world.moveObject(o, m.init.x, m.init.z); m.st = 0; m.y = 0; }
    else { setSeg(m, m.init.road, m.init.a, m.init.dir); m.s = m.init.s; }
    m.cx = m.cz = 0; m.cool = 0; m.v = m.vt = m.base; m.dwell = 0;
  }

  _respawn(o) { this._init(o); this._place(o, 0); }

  _targetXZ(m) { return [m.x0 + m.tx * m.s - m.tz * m.lat, m.z0 + m.tz * m.s + m.tx * m.lat]; }

  _place(o, dt) {
    const m = o.m;
    let x, z, y = 0;
    if (m.cls === 'wander') { x = o.x; z = o.z; m.yaw = m.hd; }
    else if (m.cls === 'bird') { x = o.x; z = o.z; y = m.y + (m.st === 0 ? Math.max(0, Math.sin(m.ph) * 0.03) : Math.sin(m.ph * 3) * 0.15); }
    else {
      const [tx, tz] = this._targetXZ(m);
      x = tx + m.cx; z = tz + m.cz;
      const want = Math.atan2(-m.tz, m.tx);
      let d = want - m.yaw;
      d -= Math.round(d / TAU) * TAU;
      m.yaw += dt > 0 ? d * Math.min(1, dt * (m.cls === 'tram' ? 5 : 9)) : d;
    }
    if (m.cls === 'walk' || m.cls === 'wander') y = Math.abs(Math.sin(m.ph)) * 0.07;
    else if (m.cls === 'swan' || m.cls === 'boat') y = Math.sin(this.time * 1.3 + m.ph) * 0.05 - 0.08;
    o.yaw = m.yaw;
    this.world.moveObject(o, x, z);
    this.world._write(o, x, y, z, null, o.s);
  }

  _advance(o, m, dt) {
    let s = m.s + m.v * dt;
    let guard = 0;
    while (s >= m.L && guard++ < 4) {
      s -= m.L;
      const road = m.road, b = m.b;
      const [ox, oz] = this._targetXZ({ ...m, s: m.L });
      const net = this.world.net.nets[NET_OF[m.cls]];
      const here = net.vmap.get(key(road.p[b][0], road.p[b][1])) || [];
      const opts = [];
      for (const { road: r2, j } of here) {
        if (j < r2.p.length - 1) opts.push({ r: r2, a: j, dir: 1 });
        if (j > 0) opts.push({ r: r2, a: j, dir: -1 });
      }
      const fwdOK = b + m.dir >= 0 && b + m.dir < road.p.length;
      let pick = null;
      const cand = opts.filter((c) => !(c.r === road && c.a === b && c.dir === -m.dir) && !(c.r === road && c.a === b && c.dir === m.dir));
      if (fwdOK && (cand.length === 0 || this.rng() > LIFE.movers.turnChance)) pick = { r: road, a: b, dir: m.dir };
      else if (cand.length) pick = cand[Math.floor(this.rng() * cand.length)];
      else pick = { r: road, a: b, dir: -m.dir };
      setSeg(m, pick.r, pick.a, pick.dir);
      const [nx, nz] = this._targetXZ({ ...m, s: 0 });
      m.cx += ox - nx; m.cz += oz - nz;
      if (Math.abs(m.cx) > 14 || Math.abs(m.cz) > 14) m.cx = m.cz = 0;
    }
    m.s = Math.min(s, m.L);
  }

  _bucketKey(m) { return ((m.ni * 7919 + m.road.id) * 600 + (Math.min(m.a, m.b) & 511)) * 2 + (m.dir > 0 ? 0 : 1); }

  update(dt) {
    const w = this.world;
    this.time += dt;
    const holes = w.holesRef ? w.holesRef() : null;
    const M = LIFE.movers, S = CFG.swallow;
    const dec = Math.exp(-3.5 * dt);
    let moved = 0, dwelling = 0;
    // car-following buckets (same net / road / segment / direction)
    for (const a of this.buckets.values()) a.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i], m = o.m;
      if (m.off || o.state !== 0 || !m.road || m.cls === 'walk' || m.cls === 'swan') continue;
      const k = this._bucketKey(m);
      let a = this.buckets.get(k);
      if (!a) this.buckets.set(k, (a = []));
      a.push(m);
    }
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i], m = o.m;
      if (m.off || o.state !== 0) continue;
      let threat = 0, hx = 0, hz = 0;
      if (holes) {
        for (let k = 0; k < holes.length; k++) {
          const h = holes[k];
          if (h.alive === false) continue;
          const dx = o.x - h.x, dz = o.z - h.z;
          if (m.cls === 'bird') {
            const R = 8 + h.radius * M.birdScare;
            if (dx * dx + dz * dz < R * R) { threat = 1; hx = dx; hz = dz; break; }
            continue;
          }
          if (h.radius * S.fitRatio <= o.fit) continue;
          const R = h.radius * M.panicRadius;
          if (dx * dx + dz * dz < R * R) { threat = 1; hx = dx; hz = dz; break; }
        }
      }
      if (m.cls === 'bird') { this._bird(o, m, dt, threat, hx, hz); this._place(o, dt); moved++; continue; }
      const walker = m.cls === 'walk' || m.cls === 'wander';
      const pm = walker ? M.panicWalk : m.cls === 'car' ? M.panicCar : 1.15;
      m.vt = m.base * (threat ? pm : 1);
      // stop dwell
      if (m.dwell > 0) { m.dwell -= dt; m.vt = 0; dwelling++; }
      else if (m.stopS >= 0 && !m.stopDone && m.s >= m.stopS - 0.5) { m.stopDone = true; m.dwell = M.stopDwell[0] + this.rng() * (M.stopDwell[1] - M.stopDwell[0]); m.vt = 0; }
      else if (m.stopS >= 0 && !m.stopDone && m.s >= m.stopS - 9) m.vt = Math.min(m.vt, Math.max(1.2, (m.stopS - m.s) * 0.9));
      // follow the vehicle ahead
      if (m.road && !walker && m.cls !== 'swan') {
        const b = this.buckets.get(this._bucketKey(m));
        if (b && b.length > 1) {
          let lead = null, ld = 1e9;
          for (let q = 0; q < b.length; q++) { const n = b[q]; if (n !== m) { const d = n.s - m.s; if (d > 0 && d < ld) { ld = d; lead = n; } } }
          if (lead) {
            const gap = ld - (LEN[m.cls] + LEN[lead.cls]) / 2 - M.followGap;
            if (gap < 14) m.vt = Math.min(m.vt, gap <= 0 ? 0 : Math.max(lead.v * 0.9, m.vt * gap / 14), gap <= 0.3 ? 0 : 99);
          }
        }
      }
      m.v += (m.vt - m.v) * Math.min(1, dt * (m.vt < m.v ? 5 : 2.5));
      m.ph += dt * (walker ? 2 + m.v * 3.2 : 0);
      m.cool -= dt;
      if (m.cls === 'wander') {
        m.t -= dt;
        if (threat && m.cool <= 0) { m.hd = Math.atan2(-hz, hx); m.cool = 0.8; }
        const nx = o.x + Math.cos(m.hd) * m.v * dt, nz = o.z - Math.sin(m.hd) * m.v * dt;
        if (m.t <= 0) { m.t = 0.3 + this.rng() * 0.5; m.hd += (this.rng() - 0.5) * 0.9; }
        const ax = o.x + Math.cos(m.hd) * 1.6, az = o.z - Math.sin(m.hd) * 1.6;
        if (!pointInPoly(ax, az, m.ring) || w.blockers.inBuilding(ax, az, 0.8)) m.hd += 1.6 + this.rng() * 1.8;
        else { o.x = nx; o.z = nz; }
      } else {
        if (threat && m.cls === 'walk' && m.cool <= 0 && m.tx * hx + m.tz * hz < 0) {
          const a = m.b, b = m.a, L = m.L;
          setSeg(m, m.road, a, -m.dir);
          m.s = Math.max(0, L - m.s); m.cool = 1.5;
        }
        this._advance(o, m, dt);
        m.cx *= dec; m.cz *= dec;
      }
      this._place(o, dt);
      moved++;
    }
    this.stats.moved = moved; this.stats.dwelling = dwelling;
  }

  _bird(o, m, dt, threat, hx, hz) {
    m.ph += dt * (m.st === 0 ? 1.5 : 22);
    if (m.st === 0) {
      m.t -= dt;
      if (m.t <= 0) { m.t = 1 + Math.random() * 4; m.yaw += (Math.random() - 0.5) * 2; }
      if (threat) {
        const l = Math.hypot(hx, hz) || 1;
        m.vx = (hx / l) * 7 + (Math.random() - 0.5) * 3; m.vz = (hz / l) * 7 + (Math.random() - 0.5) * 3;
        m.st = 1; m.t = 2.2 + Math.random() * 1.5;
        m.yaw = Math.atan2(-m.vz, m.vx);
      }
    } else if (m.st === 1) {
      m.t -= dt;
      m.y = Math.min(7, m.y + dt * 6);
      o.x += m.vx * dt; o.z += m.vz * dt;
      if (m.t <= 0) m.st = 2;
    } else {
      const dx = m.hx - o.x, dz = m.hz - o.z, d = Math.hypot(dx, dz);
      if (d < 0.8) { m.st = 0; m.y = 0; o.x = m.hx; o.z = m.hz; return; }
      const sp = 5.5;
      o.x += (dx / d) * sp * dt; o.z += (dz / d) * sp * dt;
      m.yaw = Math.atan2(-dz, dx);
      m.y = Math.max(0, Math.min(m.y, d * 0.5) - dt * 1.5);
      if (threat) { m.st = 1; m.t = 1.5; const l = Math.hypot(hx, hz) || 1; m.vx = (hx / l) * 7; m.vz = (hz / l) * 7; }
    }
  }
}
