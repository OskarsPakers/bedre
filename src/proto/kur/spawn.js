// Street-point selection (seeded) + a small walk graph over the road data.
// Spawns are drawn from the drivable / pedestrian network (not alleys, footpaths or bridges), kept clear of buildings, water, dense forest,
// trees / cars / kiosks right at the camera, and the map edge (hazed skirt). Deterministic for a given (seed, difficulty, round, map data).
import { pointInPoly } from '../../geo.js';

const SPAWN_KINDS = new Set(['residential', 'tertiary', 'secondary', 'primary', 'pedestrian']);
const WALK_KINDS = new Set(['residential', 'tertiary', 'secondary', 'primary', 'pedestrian', 'service', 'footway']);
const SMALL = new Set(['lamp', 'bench', 'bin', 'bike', 'scooter', 'pigeon', 'flag', 'lantern', 'cafeset', 'person', 'shelter']);
const TREES = new Set(['tree', 'tree2']);
export const EDGE_MARGIN = 55;          // keep this far from the data bounds (the hazed skirt starts there)
export const MAX_WALK = 150;            // metres from the spawn the player may wander

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export class StreetPicker {
  constructor(world) {
    this.world = world; this.data = world.data;
    this.cand = this._candidates();
    // recognisable sights: landmark flagged / tier A buildings (+ named standalone monuments)
    this.sights = [];
    for (const it of world.buildingItems) if (it.landmark || (it.sight && it.sight[1] === 0)) this.sights.push({ x: it.x, z: it.z, name: it.landmark ? it.name : (it.sight[3] ? it.name : null) });
    for (const o of world.objects) if (!o.isBuilding && o.landmark && o.name) this.sights.push({ x: o.x, z: o.z, name: o.name });
    this._graph = null;
  }

  _candidates() {
    const b = this.world.bounds, out = [];
    const ok = (x, z) => x > b.minX + EDGE_MARGIN && x < b.maxX - EDGE_MARGIN && z > b.minZ + EDGE_MARGIN && z < b.maxZ - EDGE_MARGIN;
    for (const r of this.data.roads) {
      if (!r.p || r.tn || r.br || !SPAWN_KINDS.has(r.k)) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 1) continue;
        const tx = (x1 - x0) / L, tz = (z1 - z0) / L, n = Math.max(1, Math.round(L / 10));
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
          if (ok(x, z)) out.push({ x, z, tx, tz, w: r.w || 6, sw: r.sw === undefined ? 1 : r.sw });
        }
      }
    }
    return out;
  }

  /** nearest sight within `r` metres (or null) */
  sightNear(x, z, r) {
    let best = null, bd = r;
    for (const s of this.sights) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  /** Is the point a legal camera position? (all rules except the pool filter) */
  valid(x, z) {
    const W = this.world, b = W.bounds;
    if (!(x > b.minX + EDGE_MARGIN && x < b.maxX - EDGE_MARGIN && z > b.minZ + EDGE_MARGIN && z < b.maxZ - EDGE_MARGIN)) return false;
    if (!W.blockers.free(x, z, 3.2)) return false;
    let bad = false, trees = 0, blds = 0;
    W.query(x, z, 28, (o, d) => {
      if (o.isBuilding) return;
      if (TREES.has(o.kind)) trees++;
      const k = String(o.kind).replace(/^person\d+$/, 'person');
      const clear = k === 'person' ? 2.4 : SMALL.has(k) ? 0.9 : (o.fit || 1.5) + 1.3;   // props / cars / kiosks / trees right in front of the lens look broken
      if (d < clear) bad = true;
    });
    if (bad || trees > 16) return false;
    W.query(x, z, 60, (o) => { if (o.isBuilding) blds++; });
    return blds >= 3;
  }

  /** One spawn: { x, z, yaw } with yaw along the street. level: 'easy' | 'normal' | 'hard' */
  pick(rng, level = 'normal') {
    const c = this.cand;
    for (let tries = 0; tries < 4000; tries++) {
      const p = c[Math.floor(rng() * c.length)];
      const along = (rng() - 0.5) * 8;
      let x = p.x + p.tx * along, z = p.z + p.tz * along;
      // stand on the pavement when the street has one and there is room, else on the carriageway
      if (p.sw !== 0 && rng() < 0.7) {
        const side = rng() < 0.5 ? 1 : -1, off = side * (p.w / 2 + 1.2);
        const sx = x - p.tz * off, sz = z + p.tx * off;
        if (this.valid(sx, sz)) { x = sx; z = sz; }
      }
      if (!this.valid(x, z)) continue;
      const near = this.sightNear(x, z, level === 'hard' ? 220 : 120);
      if (level === 'easy' && !near) continue;
      if (level === 'hard' && near) continue;
      const dir = rng() < 0.5 ? 1 : -1;
      // the first view should look DOWN a street, not into a wall: open ground 10 and 24 m ahead along the road
      const ax = p.tx * dir, az = p.tz * dir;
      if (!this.world.blockers.free(x + ax * 10, z + az * 10, 1.2) || !this.world.blockers.free(x + ax * 24, z + az * 24, 1.2)) continue;
      return { x, z, yaw: Math.atan2(p.tx * dir, -(p.tz * dir)), road: { tx: p.tx, tz: p.tz } };
    }
    return null;
  }

  // ---- walking ---------------------------------------------------------------------------------------------------------------
  _buildGraph() {
    const nodes = [], idx = new Map(), adj = [];
    const node = (x, z) => {
      const key = Math.round(x * 2) + ',' + Math.round(z * 2);
      let i = idx.get(key);
      if (i === undefined) { i = nodes.length; idx.set(key, i); nodes.push([x, z]); adj.push([]); }
      return i;
    };
    for (const r of this.data.roads) {
      if (!r.p || r.tn || !WALK_KINDS.has(r.k)) continue;
      let prev = node(r.p[0][0], r.p[0][1]);
      for (let i = 1; i < r.p.length; i++) {
        const [x0, z0] = r.p[i - 1], [x1, z1] = r.p[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 6));
        for (let k = 1; k <= n; k++) {
          const cur = node(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
          if (cur !== prev) { adj[prev].push(cur); adj[cur].push(prev); }
          prev = cur;
        }
      }
    }
    const cell = new Map();
    nodes.forEach((p, i) => { const k = Math.floor(p[0] / 20) * 100003 + Math.floor(p[1] / 20); (cell.get(k) || cell.set(k, []).get(k)).push(i); });
    this._graph = { nodes, adj, cell };
    return this._graph;
  }
  nearestNode(x, z, maxD = 9) {
    const G = this._graph || this._buildGraph();
    let best = -1, bd = maxD;
    for (let i = Math.floor((x - maxD) / 20); i <= Math.floor((x + maxD) / 20); i++) for (let j = Math.floor((z - maxD) / 20); j <= Math.floor((z + maxD) / 20); j++) {
      for (const n of G.cell.get(i * 100003 + j) || []) { const d = Math.hypot(G.nodes[n][0] - x, G.nodes[n][1] - z); if (d < bd) { bd = d; best = n; } }
    }
    return best;
  }
  /**
   * Walk up to `hop` metres from (x,z) along the road graph in the direction (dx,dz) (unit). `origin` = spawn (the walk stays within MAX_WALK of it).
   * Returns { x, z } or null when there is no road that way.
   */
  walk(x, z, dx, dz, origin, hop = 14) {
    const G = this._graph || this._buildGraph();
    let cur = this.nearestNode(x, z);
    if (cur < 0) return null;
    let cx = G.nodes[cur][0], cz = G.nodes[cur][1];
    // standing off the centre line (pavement spawn): if the nearest node is "behind" us, first snap to it only when that is not backwards
    let moved = 0, prev = -1, hx = dx, hz = dz, first = true, steps = 0;
    while (moved < hop && steps++ < 8) {
      let best = -1, bs = first ? 0.3 : 0.5;
      for (const n of G.adj[cur]) {
        if (n === prev) continue;
        const ex = G.nodes[n][0] - cx, ez = G.nodes[n][1] - cz, l = Math.hypot(ex, ez) || 1;
        const s = (ex * hx + ez * hz) / l;
        if (s > bs) { bs = s; best = n; }
      }
      if (best < 0) break;
      const nx = G.nodes[best][0], nz = G.nodes[best][1];
      if (Math.hypot(nx - origin.x, nz - origin.z) > MAX_WALK) break;
      if (!this.world.blockers.free(nx, nz, 0.4)) break;
      const l = Math.hypot(nx - cx, nz - cz) || 1;
      moved += l; hx = (nx - cx) / l; hz = (nz - cz) / l;
      prev = cur; cur = best; cx = nx; cz = nz; first = false;
    }
    return moved > 0.5 ? { x: cx, z: cz } : null;
  }
}

// ---- independent validity audit (raw data, not the engine's Blockers) ----------------------------------------------------------
export function auditSpawn(data, x, z) {
  const b = data.meta.bounds, why = [];
  if (!(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) why.push('bounds');
  for (const bl of data.buildings) { const p = bl.p; if (!p || p.length < 3) continue; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; } if (x < x0 || x > x1 || z < z0 || z > z1) continue; if (pointInPoly(x, z, p)) { why.push('building'); break; } }
  for (const w of data.water) { if (w.p && pointInPoly(x, z, w.p) && !(w.h || []).some((h) => pointInPoly(x, z, h))) { why.push('water'); break; } }
  return why;
}
