// Hole entity + swallow logic. Multiple holes supported (bots / hole-vs-hole come later).
import * as THREE from 'three';
import { CFG, radiusFromScore, scoreFromRadius } from './config.js';
import { Combo, comboWeight, totalMult } from './combo.js';
import { Fx, magnetFactor } from './powerups.js';

// Two numbers per hole (COMBOS): `mass` = unmultiplied swallowed value, the ONLY thing the growth formula (radius) looks at;
// `score` = points (mass x combo x Dubultpunkti), what the leaderboards, the HUD and the ranking show.

export class Hole {
  constructor({ id, name, color, isPlayer = false, x = 0, z = 0 }) {
    this.speedMul = 1;
    this.gainMul = 1;       // share of an object's value this hole receives (bots on easy < 1)
    this.comboScale = 1;    // bots on easy build their combo counter a little slower (src/combo.js BOT_COMBO_SCALE)
    this.combo = new Combo();
    this.fx = new Fx();     // remaining seconds of the power-up effects (src/powerups.js)
    this.boost = 1;         // speed multiplier of Ātrums (set by the game each frame)
    this.id = id;
    this.name = name;
    this.color = new THREE.Color(color);
    this.isPlayer = isPlayer;
    this.alive = true;
    // control: dir (x,z unit-ish) or target point; set each frame by input/AI
    this.control = { mode: 'none', x: 0, z: 0 };
    this.reset(x, z);
  }

  reset(x, z) {
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.score = 0;         // points
    this.mass = 0;          // growth value (drives the radius)
    this.rawEaten = 0;      // cumulative value of everything swallowed (anti-cheat trace)
    this.swPts = 0;         // cumulative multiplied points of swallows (anti-cheat trace)
    this.picks = { magnet: 0, speed: 0, double: 0, shield: 0 };   // power-ups collected this round
    this.combo.reset(); this.fx.clear(); this.boost = 1;
    this.radius = this.targetRadius = CFG.hole.startRadius;
    this.eaten = 0;
    this.biggest = null; // { name, kind, fit, value }
    this.control.mode = 'none';
    this.alive = true;
    this.dying = null;      // { by, t, x0, z0, r0, a0 } while being swallowed by another hole
    this.protectT = 0;      // spawn protection seconds left
    this.respawnT = 0;
    this.kills = 0; this.deaths = 0;
  }

  /** Come back after being swallowed: keep a fraction of mass AND points (same fraction: the size follows the mass), smaller size, brief protection. */
  respawn(x, z, keep, protect) {
    this.x = x; this.z = z; this.vx = this.vz = 0;
    this.score *= keep; this.mass *= keep;
    this.combo.drop(); this.fx.clear(); this.boost = 1;
    this.radius = this.targetRadius = radiusFromScore(this.mass);
    this.control.mode = 'none';
    this.alive = true; this.dying = null;
    this.protectT = protect;
  }

  get speed() {
    return this.boost * this.speedMul * CFG.hole.baseSpeed * Math.pow(this.radius / CFG.hole.startRadius, CFG.hole.speedExp);
  }

  setRadius(r) {
    this.radius = this.targetRadius = r;
    // keep mass / score consistent so growth does not snap back
    const m = scoreFromRadius(r);
    this.mass = Math.max(this.mass, m);
    this.score = Math.max(this.score, m);
  }

  /** Plain value without a combo (duel gains, tests): mass and points rise together. */
  addScore(v, pts = v) {
    this.mass += v; this.score += pts;
    this.targetRadius = radiusFromScore(this.mass);
  }

  /**
   * A swallow of object `o` at clock `now` (seconds): mass grows by the plain value, points by value x combo x Dubultpunkti.
   * Returns { mass, pts, mult, step } for the HUD.
   */
  award(o, now) {
    const mass = o.value * this.gainMul;
    const c = this.combo.hit(now, comboWeight(o.isBuilding, o.fit, o.value) * this.comboScale, this.radius);
    const mult = totalMult(c.mult, this.fx.doubleMul);
    const pts = mass * mult;
    this.mass += mass; this.score += pts;
    this.rawEaten += mass; this.swPts += pts;
    this.targetRadius = radiusFromScore(this.mass);
    return { mass, pts, mult, step: c.step };
  }

  /** Pick up a power-up (the effect starts / refreshes). */
  pick(type) { this.fx.apply(type); this.picks[type]++; }

  update(dt, bounds) {
    const c = this.control;
    let dx = 0, dz = 0, mag = 0;
    if (c.mode === 'dir') {
      const l = Math.hypot(c.x, c.z);
      if (l > 0.001) { dx = c.x / l; dz = c.z / l; mag = Math.min(1, l); }
    } else if (c.mode === 'target') {
      const tx = c.x - this.x, tz = c.z - this.z, l = Math.hypot(tx, tz);
      const slow = Math.max(this.radius * 0.5, 1);
      if (l > 0.05) { dx = tx / l; dz = tz / l; mag = Math.min(1, l / slow); }
    }
    const k = 1 - Math.exp(-CFG.hole.accel * dt);
    this.vx += (dx * mag * this.speed - this.vx) * k;
    this.vz += (dz * mag * this.speed - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const m = 0; // holes may reach the very edge of the map
    this.x = Math.min(bounds.maxX - m, Math.max(bounds.minX + m, this.x));
    this.z = Math.min(bounds.maxZ - m, Math.max(bounds.minZ + m, this.z));
    this.radius += (this.targetRadius - this.radius) * (1 - Math.exp(-CFG.hole.radiusSmooth * dt));
  }
}

/**
 * Swallow everything this hole can swallow. onSwallow(hole, obj) is called per object.
 */
/**
 * Magnēts: edible objects (not movers: they drive themselves) between the hole's mouth and radius x `reach` slide towards the hole.
 * `reach` = PU.magnet.radius. The normal swallow loop then takes them when they arrive.
 */
export function pullObjects(world, hole, dt, reach = magnetFactor(hole.radius)) {
  const r = hole.radius, maxFit = r * CFG.swallow.fitRatio, mouth = r * CFG.swallow.reach * 0.55;
  const step = (hole.speed * 0.9 + 6 + r * 0.6) * dt;
  const list = _pull; list.length = 0;
  world.query(hole.x, hole.z, r * reach, (o, d) => {
    if (o.state !== 0 || o.mover || o.fit >= maxFit || d <= mouth) return;
    list.push(o, d);
  });
  for (let i = 0; i < list.length; i += 2) {   // (moved after the query: moveObject edits the grid cells the query walks)
    const o = list[i], d = list[i + 1], k = Math.min(step, d - mouth) / d;
    if (o.hx === undefined) { o.hx = o.x; o.hz = o.z; MOVED.add(o); }   // remembered: a new round puts every pulled object back (restoreMoved)
    const nx = o.x + (hole.x - o.x) * k, nz = o.z + (hole.z - o.z) * k;
    world.moveObject(o, nx, nz);
    world._write(o, nx, 0, nz, null, o.s);
  }
}
const _pull = [];
const MOVED = new Set();
/** A new round: everything Magnēts pulled goes back to where the placement file put it (call right after world.reset()). */
export function restoreMoved(world) {
  for (const o of MOVED) {
    if (o.hx !== undefined) { world.moveObject(o, o.hx, o.hz); if (o.state === 0) world._write(o, o.hx, 0, o.hz, null, o.s); }
    o.hx = o.hz = undefined;
  }
  MOVED.clear();
}

export function updateSwallow(world, hole, onSwallow, now = 0) {
  const S = CFG.swallow;
  const r = hole.radius;
  const reach = r * S.reach;
  const maxFit = r * S.fitRatio;
  const wob = r * S.wobbleRatio;
  world.query(hole.x, hole.z, reach, (o) => {
    if (o.state !== 0) return;
    if (o.fit < maxFit) {
      const res = hole.award(o, now);     // (first: the swallow sound reads the hole's combo counter)
      world.beginFall(o, hole);
      hole.eaten++;
      if (!hole.biggest || o.fit > hole.biggest.fit) hole.biggest = { name: o.name, kind: o.kind, fit: o.fit, value: o.value };
      onSwallow(hole, o, res);
    } else if (o.fit < wob && o.isBuilding) {
      world.wobble(o, Math.min(1, 0.4 + (r / o.fit)));
    }
  });
}
