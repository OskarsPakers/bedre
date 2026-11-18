// POWER-UPS: pickups that float on the map; a hole collects one by passing over it (any size). Pure rules + the spawn schedule, shared by the
// browser (solo: src/game.js) and the Worker (multiplayer: worker/mp/sim.js, worker/mp/powerups.js). No DOM / three.js here.
//
// Not part of the placement files: pickups are never swallowable objects, they have no object ids and cannot change the placement hash.
// Candidate points are the placement file's spawn candidates (street points with food + buildings around, never water / buildings / dense forest).
import { mulberry32 } from './rng.js';
import { hashSeed } from './rules.js';

export const PU_TYPES = ['magnet', 'speed', 'double', 'shield'];
export const PU = {
  magnet: { dur: 6, radius: 1.8, far: 1.3, from: 10, to: 90 },   // Magnēts: edible objects within radius x hole radius slide towards the hole (x1.8 for a small hole, tapering to x1.3 for a huge one: a magnet near-doubles the swept area of a big hole, which would break the late-game pacing)
  speed: { dur: 6, mul: 1.5 },           // Ātrums
  double: { dur: 12, mul: 2 },           // Dubultpunkti (stacks with the combo, combined cap in src/combo.js)
  shield: { dur: 8 },                    // Vairogs: bigger holes cannot swallow you
  respawn: [20, 30],                     // s after a pickup before its slot shows up somewhere else
  life: 75,                              // s an uncollected pickup stays before it moves on
  regrow: 6,                             // s between an expiry and the next spawn of the slot
  perAxis: 250,                          // active pickups ~ sqrt(map area) / this ...
  min: 6,                                // ... but at least this many
  minMove: 160,                          // a slot reappears at least this far from where it last was
};
/** Pull / reach radius factor of Magnēts for a hole of radius r. */
export const magnetFactor = (r) => PU.magnet.radius + (PU.magnet.far - PU.magnet.radius) * Math.min(1, Math.max(0, (r - PU.magnet.from) / (PU.magnet.to - PU.magnet.from)));
/** Pickup type odds (a slot's first pickup cycles through all four so every type is on the map from the start). */
export const PU_WEIGHTS = { magnet: 0.16, speed: 0.26, double: 0.3, shield: 0.28 };
export const PU_ORDER = Object.fromEntries(PU_TYPES.map((t, i) => [t, i]));
export const puBit = (type) => 1 << PU_ORDER[type];

/** Number of pickups alive at once on a map with these bounds. */
export function puCountFor(b) { return Math.max(PU.min, Math.round(Math.sqrt((b.maxX - b.minX) * (b.maxZ - b.minZ)) / PU.perAxis)); }

/** A hole picks a pickup up when its centre is this close (small holes get a generous margin so a tiny hole can collect them too). */
export const pickRadius = (holeRadius) => 1.4 + 0.8 * holeRadius;

/** Remaining seconds of each effect of one hole (counted down by tick()). */
export class Fx {
  constructor() { this.magnet = 0; this.speed = 0; this.double = 0; this.shield = 0; }
  clear() { this.magnet = this.speed = this.double = this.shield = 0; }
  apply(type) { this[type] = PU[type].dur; }       // same type again: the timer is refreshed, never stacked
  tick(dt) { for (const t of PU_TYPES) if (this[t] > 0) this[t] = Math.max(0, this[t] - dt); }
  get mask() { let m = 0; for (const t of PU_TYPES) if (this[t] > 0) m |= puBit(t); return m; }
  get speedMul() { return this.speed > 0 ? PU.speed.mul : 1; }
  get doubleMul() { return this.double > 0 ? PU.double.mul : 1; }
}

/** Candidates from a placement-file spawn list { n, x[], z[] }. */
export function candidatesFromSpawn(sp) {
  const x = new Float64Array(sp.n), z = new Float64Array(sp.n);
  for (let i = 0; i < sp.n; i++) { x[i] = sp.x[i]; z[i] = sp.z[i]; }
  return { n: sp.n, x, z };
}
/** Fallback (no placement file): street points thinned to one per 60 m cell, in a stable order. */
export function candidatesFromPoints(pts) {
  const seen = new Map();
  for (const p of pts) { const k = Math.floor(p.x / 60) * 100003 + Math.floor(p.z / 60); if (!seen.has(k)) seen.set(k, p); }
  const list = [...seen.values()].sort((a, b) => a.x - b.x || a.z - b.z);
  return { n: list.length, x: Float64Array.from(list, (p) => p.x), z: Float64Array.from(list, (p) => p.z) };
}

/**
 * The spawn schedule. `count` slots; each slot shows one pickup at a time. What a slot shows (candidate point, type) is a pure function of
 * (seed, slot, how many pickups it has shown so far): the same seed gives everybody the same sequence of places and types (daily challenge),
 * whoever collects what and whenever. Times are seconds of a round clock the caller advances (tick(now)).
 */
export class PowerupField {
  constructor({ seed, cand, count }) {
    this.seed = seed >>> 0; this.cand = cand; this.count = count;
    this.slots = [];
    for (let s = 0; s < count; s++) {
      const slot = { id: s, rng: mulberry32(hashSeed(`pu|${this.seed}|${s}`)), n: 0, state: 'wait', at: 0, type: null, x: 0, z: 0, until: 0, px: NaN, pz: NaN, delay: 0 };
      this._roll(slot);
      this.slots.push(slot);
    }
    this.picked = 0;
  }

  /** Draw the content of slot's next pickup (fixed number of draws order: place, type, respawn delay). */
  _roll(slot) {
    const c = this.cand, s = slot.id, N = this.count || 1;
    let idx = -1;
    if (c.n > 0) {
      const part = c.n >= N ? Math.ceil((c.n - s) / N) : c.n;       // candidates s, s+N, s+2N ... (interleaved in the file's x order = spread over the map)
      for (let tries = 0; tries < 8; tries++) {
        const k = Math.floor(slot.rng() * part);
        const i = c.n >= N ? s + k * N : k;
        idx = i;
        if (!(Math.hypot(c.x[i] - slot.px, c.z[i] - slot.pz) < PU.minMove)) break;
      }
    }
    const r = slot.rng();
    let acc = 0, pick = PU_TYPES[PU_TYPES.length - 1];
    for (const ty of PU_TYPES) { acc += PU_WEIGHTS[ty]; if (r < acc) { pick = ty; break; } }
    slot.nextType = slot.n === 0 ? PU_TYPES[s % PU_TYPES.length] : pick;
    if (slot.n > 0 && slot.nextType === slot.type) slot.nextType = PU_TYPES[(PU_ORDER[slot.nextType] + 1) % PU_TYPES.length];
    slot.nextDelay = PU.respawn[0] + slot.rng() * (PU.respawn[1] - PU.respawn[0]);
    slot.nextIdx = idx;
  }

  _spawn(slot, now, out) {
    const i = slot.nextIdx;
    slot.type = slot.nextType; slot.delay = slot.nextDelay;
    slot.x = i >= 0 ? this.cand.x[i] : 0; slot.z = i >= 0 ? this.cand.z[i] : 0;
    slot.px = slot.x; slot.pz = slot.z;
    slot.state = 'on'; slot.until = now + PU.life; slot.n++;
    if (i < 0) { slot.state = 'wait'; slot.at = now + 1e9; return; }   // no candidates at all (degenerate map)
    this._roll(slot);
    if (out) out.push({ k: 'spawn', slot: slot.id, type: slot.type, x: slot.x, z: slot.z, until: slot.until });
  }

  /** Advance to `now` (round seconds). Returns the events since the last call: { k: 'spawn'|'expire', slot, ... }. */
  tick(now) {
    const out = [];
    for (const s of this.slots) {
      if (s.state === 'on' && now >= s.until) { s.state = 'wait'; s.at = now + PU.regrow; out.push({ k: 'expire', slot: s.id }); }
      if (s.state === 'wait' && now >= s.at) this._spawn(s, now, out);
    }
    return out;
  }

  /** The pickup of `slot` is collected at `now`. Returns its type, or null if it was not there (already taken / expired). */
  take(slot, now) {
    const s = this.slots[slot];
    if (!s || s.state !== 'on') return null;
    s.state = 'wait'; s.at = now + s.delay; this.picked++;
    return s.type;
  }

  /** Active pickups as plain rows [slot, type, x, z, untilRound] (what the server sends). */
  list() { const o = []; for (const s of this.slots) if (s.state === 'on') o.push([s.id, s.type, s.x, s.z, s.until]); return o; }

  /** Slot whose pickup this hole (x, z, r) touches, or -1. `slack` widens the reach (server: latency allowance). */
  touching(x, z, r, slack = 0) {
    const R = pickRadius(r) + slack;
    let best = -1, bd = Infinity;
    for (const s of this.slots) {
      if (s.state !== 'on') continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= R && d < bd) { bd = d; best = s.id; }
    }
    return best;
  }

  /** Nearest active pickup within `range` of a point: { slot, x, z, type, d } or null (bots, autoplayers). */
  nearest(x, z, range, skip = null) {
    let best = null, bd = range;
    for (const s of this.slots) {
      if (s.state !== 'on' || (skip && skip(s))) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = { slot: s.id, x: s.x, z: s.z, type: s.type, d }; }
    }
    return best;
  }
}

/** Latest pickups a round of `seconds` could have collected at most: one per slot at the start, then one per slot per `respawn[0]` seconds. */
export const maxPickups = (count, seconds) => count * (1 + Math.floor(Math.max(0, seconds) / PU.respawn[0]));

/**
 * How eagerly bots detour for pickups, per difficulty (Daily = Normal): chance per decision when a pickup is within `base + 1.5 x radius` metres, and a cooldown after
 * each detour. Kept small on purpose: a bot that chases every pickup stops eating (pickups respawn forever), the detour is a side trip, not a strategy.
 */
export const BOT_PU = { easy: { chance: 0.1, range: 28, cool: 14 }, normal: { chance: 0.3, range: 42, cool: 10 }, hard: { chance: 0.55, range: 65, cool: 7 } };
export const botPuRange = (p, r) => p.range + 1.5 * r;
