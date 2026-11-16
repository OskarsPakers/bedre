// Spawn-point selection: candidate points on vehicle streets (free of buildings / water), scored by
// closeness to the centre and by how much food lies nearby; bots/respawns use spacing from other holes.
import { mulberry32 } from './rng.js';
import { CFG } from './config.js';
import { waterRoutes } from './water.js';

const STREETS = new Set(['residential', 'primary', 'secondary', 'tertiary', 'service', 'pedestrian']);

export class SpawnPicker {
  constructor(world, seed = 99) {
    this.world = world;
    this.rng = mulberry32(seed);
    const b = world.bounds;
    const isC = !world.data.meta.slug || world.data.meta.slug === 'centrs';
    this.playerR = isC ? 750 : Math.max(750, 0.4 * Math.min(b.maxX - b.minX, b.maxZ - b.minZ)); // how far from the preferred area the human's start may be
    this.cx = isC ? 0 : (b.minX + b.maxX) / 2; this.cz = isC ? 0 : (b.minZ + b.maxZ) / 2; // preferred player area: Freedom Monument (centre map) / map middle
    const pts = [];
    const margin = 40;
    for (const r of world.data.roads) {
      if (!r.p || !STREETS.has(r.k)) continue;
      const major = r.k !== 'pedestrian' && r.k !== 'service';
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 14));
        for (let k = 0; k < n; k++) {
          const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
          if (x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin) continue;
          if (!world.blockers.free(x, z, 3.5)) continue;
          pts.push({ x, z, major, dens: -1, round: -1 });
        }
      }
    }
    if (!pts.length) pts.push({ x: world.spawn[0], z: world.spawn[1], major: true, dens: 0, round: -1 });
    this.pts = pts;
    this.round = 0;
    // left bank (Pardaugava) candidates: points west of the river centre-line (longest non-canal water route), so some bots start there
    this.leftPts = [];
    try {
      const rt = waterRoutes(world.data).filter((r) => !r.canal).sort((a, b) => b.L - a.L)[0];
      if (rt && rt.p.length > 3) {
        const q = rt.p.slice().sort((a, c) => a[1] - c[1]);
        const xr = (z) => { // river centre x at depth z (linear interpolation along the route)
          if (z <= q[0][1]) return q[0][0];
          for (let i = 0; i < q.length - 1; i++) if (z <= q[i + 1][1]) { const t = (z - q[i][1]) / Math.max(1e-6, q[i + 1][1] - q[i][1]); return q[i][0] + (q[i + 1][0] - q[i][0]) * t; }
          return q[q.length - 1][0];
        };
        this.leftPts = pts.filter((c) => c.x < xr(c.z) - 60);
        if (this.leftPts.length < 20) this.leftPts = [];
      }
    } catch (e) { this.leftPts = []; }
  }

  /** New round: the world was reset, cached densities are stale. */
  newRound() { this.round++; this.reserved = null; }

  /** Pick the human's start before the bots are spread (they keep their distance from it); player() returns it. */
  reserve() {
    this.reserved = null;
    const [x, z] = this.player();
    this.reserved = { x, z, radius: 0 };
    return this.reserved;
  }

  /**
   * Edible things for a fresh (start-radius) hole around a point: count of untouched objects within 60 m that a
   * start hole can eat right now. Cached per round (round start only).
   */
  _density(c) {
    if (c.round === this.round && c.dens >= 0) return c.dens;
    c.dens = this._count(c.x, c.z, 60, CFG.hole.startRadius * CFG.swallow.fitRatio); // = what a start hole can eat within 60 m (scripts/spawn-check.mjs wants >= 80)
    c.round = this.round;
    return c.dens;
  }

  _count(x, z, R, maxFit) {
    let n = 0;
    this.world.query(x, z, R, (o) => { if (o.state === 0 && o.fit < maxFit) n++; });
    return n;
  }

  /** Value a hole of radius r could eat around a point right now (live, not cached: used for respawns). */
  _food(x, z, r) {
    let v = 0;
    const maxFit = r * CFG.swallow.fitRatio;
    this.world.query(x, z, Math.max(45, r * 5), (o) => { if (o.state === 0 && o.fit < maxFit) v += o.value; });
    return v;
  }

  /**
   * Good start for the human: a street near the centre with lots of small food around, away from `avoid` points.
   * Picks randomly among the few best-scoring spots so rounds do not always start on the same corner.
   */
  player(avoid = []) {
    const res = this.reserved;
    if (res && avoid.every((a) => Math.hypot(res.x - a.x, res.z - a.z) > 150)) return [res.x, res.z];
    const scored = [];
    for (const c of this.pts) {
      const d = Math.hypot(c.x - this.cx, c.z - this.cz);
      if (d > this.playerR) continue;
      const dens = this._density(c);
      if (dens < 30) continue;
      let s = Math.min(dens, 140) - d * 0.03 + (c.major ? 6 : 0);
      for (const a of avoid) s -= Math.max(0, 260 - Math.hypot(c.x - a.x, c.z - a.z)) * 0.5;
      scored.push([s, c]);
    }
    if (!scored.length) { // degenerate maps (tests / sample data): best density anywhere
      let best = this.pts[0], bd = -1;
      for (const c of this.pts) { const v = this._density(c); if (v > bd) { bd = v; best = c; } }
      return [best.x, best.z];
    }
    const rich = scored.filter(([, c]) => c.dens >= 80); // every human start should have >= 80 edible things within 60 m when the map has such spots
    if (rich.length >= 3) scored.splice(0, scored.length, ...rich);
    scored.sort((a, b) => b[0] - a[0]);
    // choose among the top spots that are at least 80 m apart (variety without giving up quality)
    const top = [];
    for (const [s, c] of scored) {
      if (s < scored[0][0] - 25) break;
      if (top.every((t) => Math.hypot(t.x - c.x, t.z - c.z) > 80)) top.push(c);
      if (top.length >= 5) break;
    }
    const c = top[Math.floor(this.rng() * top.length)];
    return [c.x, c.z];
  }

  /**
   * Spread-out point for bots / respawns: among random street points that keep `minDist` from other holes (bigger
   * holes count larger), take the one with the most food for a hole of `radius` (default: start radius).
   */
  spread(others, { samples = 140, minDist = 0, radius = 0, pool = null } = {}) {
    const src = pool && pool.length ? pool : this.pts;
    const r = Math.max(CFG.hole.startRadius, radius);
    let best = null, bs = -Infinity;
    for (let i = 0; i < samples; i++) {
      const c = src[Math.floor(this.rng() * src.length)];
      let md = others.length ? Infinity : 1e4;
      for (const o of others) md = Math.min(md, Math.hypot(c.x - o.x, c.z - o.z) - Math.max(0, (o.radius || 0) - r) * 3);
      const food = this._food(c.x, c.z, r);
      // distance only matters up to minDist (then a little more for comfort); food decides the rest
      let s = Math.min(food, 400) * 1.2 + Math.min(md, minDist * 1.3) * 0.15 + this.rng() * 10;
      if (md < minDist) s -= (minDist - md) * 3;
      if (s > bs) { bs = s; best = c; }
    }
    return [best.x, best.z];
  }
}
