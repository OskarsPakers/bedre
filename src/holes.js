// Hole entity + swallow logic. Multiple holes supported (bots / hole-vs-hole come later).
import * as THREE from 'three';
import { CFG, radiusFromScore } from './config.js';

export class Hole {
  constructor({ id, name, color, isPlayer = false, x = 0, z = 0 }) {
    this.speedMul = 1;
    this.gainMul = 1;       // share of an object's points this hole receives (bots on easy < 1)
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
    this.score = 0;
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

  /** Come back after being swallowed: keep a fraction of score, smaller size, brief protection. */
  respawn(x, z, keep, protect) {
    this.x = x; this.z = z; this.vx = this.vz = 0;
    this.score *= keep;
    this.radius = this.targetRadius = radiusFromScore(this.score);
    this.control.mode = 'none';
    this.alive = true; this.dying = null;
    this.protectT = protect;
  }

  get speed() {
    return this.speedMul * CFG.hole.baseSpeed * Math.pow(this.radius / CFG.hole.startRadius, CFG.hole.speedExp);
  }

  setRadius(r) {
    this.radius = this.targetRadius = r;
    // keep score consistent so growth does not snap back
    const k = CFG.growth.k, e = CFG.growth.exp, r0 = CFG.hole.startRadius;
    this.score = Math.max(this.score, k * (Math.pow(r / r0, 1 / e) - 1));
  }

  addScore(v) {
    this.score += v;
    this.targetRadius = radiusFromScore(this.score);
  }

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
export function updateSwallow(world, hole, onSwallow) {
  const S = CFG.swallow;
  const r = hole.radius;
  const reach = r * S.reach;
  const maxFit = r * S.fitRatio;
  const wob = r * S.wobbleRatio;
  world.query(hole.x, hole.z, reach, (o) => {
    if (o.state !== 0) return;
    if (o.fit < maxFit) {
      world.beginFall(o, hole);
      hole.eaten++;
      hole.addScore(o.value * hole.gainMul);
      if (!hole.biggest || o.fit > hole.biggest.fit) hole.biggest = { name: o.name, kind: o.kind, fit: o.fit, value: o.value };
      onSwallow(hole, o);
    } else if (o.fit < wob && o.isBuilding) {
      world.wobble(o, Math.min(1, 0.4 + (r / o.fit)));
    }
  });
}
