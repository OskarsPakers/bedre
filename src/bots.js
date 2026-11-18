// AI opponents. Brains tick at CFG.bots.thinkHz (staggered) and only set hole.control = {mode:'target', x, z};
// movement + swallowing use the exact same rules as the player.
//
// Behaviour per tick, in priority order:
//   flee  - a hole that can eat us is close (or closing in): run away from it (bent away from map edges), still eating
//           whatever lies in the escape direction;
//   hunt  - a smaller hole is near and worth more than what we would eat in the time it takes to catch it
//           (gives up after a few seconds);
//   roam  - the neighbourhood is poor compared to another part of the map (coarse density map of edible value,
//           discounted by travel time): head there, eating along the way. Keeps bots off empty edges / water;
//   eat   - greedy target: value / distance with a cluster bonus, skipping food that lies next to bigger holes.
import { CFG } from './config.js';
import { Hole } from './holes.js';
import { mulberry32 } from './rng.js';
import { BOT_COMBO_SCALE } from './combo.js';
import { BOT_PU, botPuRange } from './powerups.js';

export const BOT_NAMES = [
  'Jānis', 'Līga', 'Kaķis', 'Rūķis', 'Laima', 'Bebrs', 'Ūdris', 'Zaķis', 'Lācis', 'Vilks', 'Pūce', 'Dzintars', 'Zane', 'Ieva',
  'Māris', 'Baiba', 'Uldis', 'Kārlis', 'Ilze', 'Gundega', 'Kurmis', 'Ezis', 'Vāvere', 'Sprīdītis', 'Čiekurs', 'Mārtiņš',
  'Dzeguze', 'Lāsma', 'Saulīte', 'Mežavīrs', 'Pelmenis', 'Rasa',
];

const TAU = Math.PI * 2;
const CELL = 80; // density map cell (m)

/** Coarse grid over the map holding object lists, to estimate "edible value" of distant areas cheaply. */
class DensityMap {
  constructor(world) { this.world = world; this.n = -1; }

  rebuild() {
    const w = this.world, b = w.bounds;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL));
    this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL));
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    for (const o of w.objects) {
      const i = this.idx(o.x, o.z);
      if (i >= 0) this.cells[i].push(o);
    }
    this.n = w.objects.length;
    this.memo = new Map(); // `${cell}:${fitBucket}` -> { t, v }
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Value of untouched objects with fit < maxFit in one cell (memoised ~2 s per size bucket). */
  cellValue(c, maxFit, now) {
    const bucket = Math.round(Math.log(maxFit) * 6);
    const key = c * 64 + (bucket & 63);
    const m = this.memo.get(key);
    if (m && now - m.t < 2 && m.t <= now) return m.v;
    const fit = Math.exp(bucket / 6);
    let v = 0;
    for (const o of this.cells[c]) if (o.state === 0 && o.fit < fit) v += o.value;
    this.memo.set(key, { t: now, v });
    return v;
  }

  /** Sum over the 3x3 block of cells around (ci,cj). */
  block(ci, cj, maxFit, now) {
    let v = 0;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      v += this.cellValue(j * this.nx + i, maxFit, now);
    }
    return v;
  }
}

class Brain {
  constructor(hole, rng, idx) {
    this.hole = hole;
    this.rng = rng;
    this.idx = idx;
    this.cands = [];
    this.personalize();
    this.reset(0);
  }

  /** Draw this bot's personality (skill, speed, reaction, aggression, aim noise) from `this.rng`. Re-run by Bots.reseed(). */
  personalize() {
    const { hole, rng, idx } = this;
    const B = CFG.bots, d = B.difficulty;
    const u = () => rng();
    this.skill = Math.min(1.25, d * (0.85 + u() * 0.3));
    hole.speedMul = Math.min(B.speedCap ?? 1.04, (B.speedMin + (B.speedMax - B.speedMin) * u()) * (0.85 + 0.15 * d));
    this.react = (B.reactMin + (B.reactMax - B.reactMin) * u()) / Math.max(0.5, d);
    this.aggr = B.aggressionMin + (B.aggressionMax - B.aggressionMin) * u();
    this.noise = B.aimNoise * Math.max(0.2, 1.4 - Math.min(1.2, d)) * (0.6 + u() * 0.8);
    this.baseGain = hole.gainMul = B.gain * (0.92 + u() * 0.16);   // growth handicap (easy: bots earn fewer points per object)
    this.nextThink = (idx / Math.max(1, B.count)) / B.thinkHz + u() * 0.1;
  }

  reset(now) {
    const h = this.hole;
    // new round (clock restarted) or respawn: think again soon, staggered
    this.nextThink = now + (this.idx / Math.max(1, CFG.bots.count)) / CFG.bots.thinkHz + this.rng() * 0.05;
    this.lastX = h.x; this.lastZ = h.z; this.lastCheck = now;
    this.goal = null; this.goalObj = null; this.goalUntil = 0;
    this.threatSince = -1; this.ban = null; this.banUntil = 0;
    this.roam = null; this.nextRoam = now + 0.5 + this.rng() * 1.5;
    this.prey = null; this.huntSince = 0; this.preyBan = null; this.preyBanUntil = 0;
    this.rate = 1; this.peak = 0; this.rateScore = h.mass; this.rateT = now;
    this.puGoal = -1; this.puUntil = 0; this.puCool = now + 15;   // (no detours in the first moments: eat first)
    this.heading = this.rng() * TAU;
    this.mode = 'eat';
  }

  think(now, holes, world, dmap) {
    const h = this.hole, r = h.radius;
    const bounds = world.bounds;
    const D = CFG.duel, B = CFG.bots;

    // ---- own eating rate (score / s), smoothed over ~2 s windows; used to judge hunts
    if (now - this.rateT >= 2) {
      const inst = Math.max(0, h.mass - this.rateScore) / (now - this.rateT);
      this.rate = this.rate * 0.5 + inst * 0.5;
      this.peak = Math.max(this.rate, (this.peak || 0) * 0.97);
      this.rateScore = h.mass; this.rateT = now;
    }

    // ---- stuck check (every ~1.5 s): barely moved while having a goal
    if (now - this.lastCheck > 1.5) {
      const moved = Math.hypot(h.x - this.lastX, h.z - this.lastZ);
      if (this.goal && moved < Math.max(0.4, r * 0.3) * (this.mode === 'eat' ? 0.5 : 1)) {
        this.ban = this.goalObj || null; this.banUntil = now + 5;
        this.goal = null; this.goalObj = null; this.roam = null;
      }
      this.lastX = h.x; this.lastZ = h.z; this.lastCheck = now;
    }

    // ---- threats (holes that could eat us) and prey
    const safe = h.protectT > 0.4;
    let threat = null, tw = 0, fx = 0, fz = 0;
    let prey = null, pv = 0;
    for (const o of holes) {
      if (o === h || !o.alive || o.dying) continue;
      const dx = h.x - o.x, dz = h.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      if (o.radius >= r * D.ratio * 0.97) {
        if (safe || o.protectT > 1) continue;
        const gap = d - o.radius * D.reach;
        const closing = Math.max(0, (o.vx * dx + o.vz * dz) / d);
        let zone = 8 + o.radius * (0.7 + 0.5 * this.skill) + closing * (1 + this.skill);
        if (this.underdog) zone *= 1.3;
        if (gap < zone) {
          const w = 1 - gap / zone + 0.2;
          fx += (dx / d) * w; fz += (dz / d) * w;
          if (w > tw) { tw = w; threat = o; }
        }
      } else if (r >= o.radius * D.ratio * (o.isBot ? 1 : B.humanRatio) * 1.02 && !safe && h.protectT <= 0 && o.protectT < 0.5) {
        if (o === this.preyBan && now < this.preyBanUntil) continue;
        if (!o.isBot && (now < B.humanGrace || now - (o.respawnedAt ?? -1e9) < B.respawnGrace)) continue; // easy: no early dogpile, no spawn camping
        if (o.fx.shield > 0) continue;                    // Vairogs: cannot be swallowed, do not chase it
        if (o.mass < h.mass * B.preyMinFrac) continue; // not worth bullying tiny holes
        const gap = d - r * D.reach;
        if (gap > Math.max(18, r * B.huntRange) * (0.5 + this.aggr * 0.7)) continue;
        const catchT = Math.max(0, gap) / Math.max(1.5, h.speed - 0.75 * o.speed) + 0.5;
        const v = (o.mass * D.gain + 3) / catchT;
        const greed = B.huntGreed - this.aggr + (this.leader && o.isBot ? B.leaderRestraint : 0);
        if (v > this.rate * greed && v > pv) { pv = v; prey = o; }
      }
    }

    let tx, tz, mode;
    if (threat) {
      if (this.threatSince < 0) this.threatSince = now;
    } else this.threatSince = -1;

    if (threat && now - this.threatSince >= this.react * (this.underdog ? 0.5 : 1)) {
      // run away from all threats, pushed off the map edges, eating what lies in that direction
      const m = 160;
      if (h.x - bounds.minX < m) fx += (1 - (h.x - bounds.minX) / m) * 1.2;
      if (bounds.maxX - h.x < m) fx -= (1 - (bounds.maxX - h.x) / m) * 1.2;
      if (h.z - bounds.minZ < m) fz += (1 - (h.z - bounds.minZ) / m) * 1.2;
      if (bounds.maxZ - h.z < m) fz -= (1 - (bounds.maxZ - h.z) / m) * 1.2;
      const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const food = this._pickTarget(world, now, holes, { dirX: fx, dirZ: fz, minDot: 0.55, range: Math.max(20, r * 4) });
      if (food) { tx = food.x; tz = food.z; } else { tx = h.x + fx * (60 + r * 2); tz = h.z + fz * (60 + r * 2); }
      this.goal = null; this.roam = null;
      mode = 'flee';
    } else if (prey) {
      if (this.prey !== prey) { this.prey = prey; this.huntSince = now; }
      if (now - this.huntSince > 4 + this.aggr * 5) {
        this.preyBan = prey; this.preyBanUntil = now + 12; this.prey = null;
      } else {
        const lead = Math.min(1.2, Math.hypot(prey.x - h.x, prey.z - h.z) / Math.max(4, h.speed)) * 0.6 * Math.min(1, this.skill);
        tx = prey.x + prey.vx * lead; tz = prey.z + prey.vz * lead;
        mode = 'hunt';
      }
    } else this.prey = null;

    if (tx === undefined && this.field) {
      // power-ups: notice one nearby (more often on hard, rarely on easy) and detour for it until it is taken or the detour times out
      const P = BOT_PU[CFG.difficulty] || BOT_PU.normal;
      const f = this.field;
      let pu = null;
      if (this.puGoal >= 0 && now < this.puUntil) { const s = f.slots[this.puGoal]; if (s && s.state === 'on') pu = { x: s.x, z: s.z }; else { this.puGoal = -1; this.puCool = now + P.cool; } }
      else if (this.puGoal >= 0) { this.puGoal = -1; this.puCool = now + P.cool; }
      if (!pu && now >= this.puCool) {
        const cand = f.nearest(h.x, h.z, botPuRange(P, r));
        if (cand && this.rng() < P.chance) { this.puGoal = cand.slot; this.puUntil = now + 4 + cand.d / Math.max(4, h.speed) * 1.3; pu = cand; }
      }
      if (pu) { tx = pu.x; tz = pu.z; mode = 'powerup'; }
    }

    if (tx === undefined) {
      this._roamCheck(world, dmap, now);
      if (this.roam) {
        const rd = Math.hypot(this.roam.x - h.x, this.roam.z - h.z);
        if (rd < Math.max(45, r * 1.5) || now > this.roam.until) this.roam = null;
        else {
          const dx = (this.roam.x - h.x) / rd, dz = (this.roam.z - h.z) / rd;
          const food = this._pickTarget(world, now, holes, { dirX: dx, dirZ: dz, minDot: 0.6, range: Math.max(18, r * 3) });
          if (food) { tx = food.x; tz = food.z; } else { tx = this.roam.x; tz = this.roam.z; }
          mode = 'roam';
        }
      }
    }

    if (tx === undefined) {
      const g = this.goalObj;
      if (g && now < this.goalUntil && g.state === 0 && g.fit < r * CFG.swallow.fitRatio && g !== this.ban) {
        tx = g.x; tz = g.z; mode = 'eat';
      } else {
        const t = this._pickTarget(world, now, holes, null);
        if (t) {
          this.goalObj = t; this.goal = t; this.goalUntil = now + 0.5 + this.rng() * 0.6;
          tx = t.x; tz = t.z; mode = 'eat';
        } else {
          // nothing edible in sight: force a roam decision, else wander towards the map centre
          this.nextRoam = Math.min(this.nextRoam, now + 0.5);
          this.goalObj = null;
          this.heading += (this.rng() - 0.5) * 0.6;
          const toC = Math.atan2(((bounds.minZ + bounds.maxZ) / 2) - h.z, ((bounds.minX + bounds.maxX) / 2) - h.x);
          const mx = Math.min(h.x - bounds.minX, bounds.maxX - h.x), mz = Math.min(h.z - bounds.minZ, bounds.maxZ - h.z);
          if (Math.min(mx, mz) < 200) this.heading = toC + (this.rng() - 0.5) * 0.8;
          const dist = 70 + r * 3;
          tx = h.x + Math.cos(this.heading) * dist; tz = h.z + Math.sin(this.heading) * dist;
          this.goal = { x: tx, z: tz };
          mode = 'wander';
        }
      }
    }

    // ---- imperfect steering
    const a = (this.rng() - 0.5) * 2 * this.noise;
    const dx = tx - h.x, dz = tz - h.z;
    const c = Math.cos(a), s = Math.sin(a);
    tx = h.x + dx * c - dz * s; tz = h.z + dx * s + dz * c;
    tx = Math.min(bounds.maxX, Math.max(bounds.minX, tx));
    tz = Math.min(bounds.maxZ, Math.max(bounds.minZ, tz));
    this.mode = mode;
    h.control.mode = 'target'; h.control.x = tx; h.control.z = tz;
  }

  /**
   * Every few seconds: compare the edible value around us with other parts of the map (3x3 blocks of 80 m cells,
   * value / (eat time + travel time)) and head for a clearly better one.
   */
  _roamCheck(world, dmap, now) {
    if (now < this.nextRoam) return;
    this.nextRoam = now + 2.5 + this.rng() * 1.5;
    const h = this.hole, r = h.radius;
    if (dmap.n !== world.objects.length) dmap.rebuild();
    const B = CFG.bots;
    // a growing hole soon fits slightly bigger things: judge areas by what fits a bit ahead
    const maxFit = r * CFG.swallow.fitRatio * 1.3;
    const ci = Math.floor((h.x - dmap.x0) / CELL), cj = Math.floor((h.z - dmap.z0) / CELL);
    const T0 = B.roamEatTime;
    const here = dmap.block(ci, cj, maxFit, now) / T0;
    const speed = Math.max(4, h.speed);
    const reach = Math.min(1400, 300 + speed * 45);
    const cr = Math.ceil(reach / CELL);
    // eating much slower than lately (area grazed bare / crowded): settle for any clearly better area
    const starving = this.rate < (this.peak || 0) * 0.3;
    let best = null, bv = here * (starving ? 1.15 : B.roamGain + 0.6 * (1.2 - Math.min(1.2, this.skill)));
    // keep the current roam goal unless something is clearly better
    if (this.roam) bv = Math.max(bv, this.roam.v * 1.15);
    for (let j = cj - cr; j <= cj + cr; j++) for (let i = ci - cr; i <= ci + cr; i++) {
      if (i < 1 || j < 1 || i >= dmap.nx - 1 || j >= dmap.nz - 1) continue;
      if ((i + j + this.idx) & 1) continue; // checkerboard: halves the work, blocks overlap anyway
      const x = dmap.x0 + (i + 0.5) * CELL, z = dmap.z0 + (j + 0.5) * CELL;
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < CELL * 1.5 || d > reach) continue;
      const v = dmap.block(i, j, maxFit, now) / (T0 + d / speed) * (0.85 + this.rng() * 0.3);
      if (v > bv) { bv = v; best = { x, z }; }
    }
    if (best) this.roam = { x: best.x, z: best.z, v: bv, until: now + 12 + Math.hypot(best.x - h.x, best.z - h.z) / speed * 1.5 };
    else if (this.roam && here * 1.5 >= this.roam.v) this.roam = null;
  }

  /**
   * Greedy-ish food choice: value / (distance + k) with a cluster bonus for the best few, skipping food that sits
   * in the mouth of a bigger hole. `dir` restricts to a cone (used while fleeing / roaming).
   */
  _pickTarget(world, now, holes, dir) {
    const h = this.hole, r = h.radius;
    const maxFit = r * CFG.swallow.fitRatio;
    const D = CFG.duel;
    const bigs = [];
    if (h.protectT <= 0.4) for (const o of holes) {
      if (o !== h && o.alive && !o.dying && o.radius >= r * D.ratio * 0.97 && o.protectT < 1) bigs.push(o);
    }
    const cands = this.cands; cands.length = 0;
    const R = dir ? dir.range : Math.max(26, r * 7) * (0.75 + 0.25 * Math.min(1.2, this.skill));
    const k = r * 1.5 + 4;
    // sights are the game's identity: bots do not go out of their way for them early in the round (the human gets to see them); a landmark counts 25 % at the start, full from 4 min on
    const lmW = Math.min(1, 0.25 + now / 240);
    let n = 0;
    world.query(h.x, h.z, R, (o, d) => {
      if (o.state !== 0 || o.fit >= maxFit || n >= 1200) return;
      if (o === this.ban && now < this.banUntil) return;
      if (dir && d > 1) {
        const dot = ((o.x - h.x) * dir.dirX + (o.z - h.z) * dir.dirZ) / d;
        if (dot < dir.minDot) return;
      }
      for (const b of bigs) {
        const bd = Math.hypot(o.x - b.x, o.z - b.z);
        if (bd < b.radius * (D.reach + 0.6) + 6) return;
      }
      cands.push(o, d, o.value * (o.landmark ? lmW : 1) / (d + k)); n++;
    });
    if (!n) return null;
    // top few by plain value density
    const top = [];
    for (let i = 0; i < n; i++) {
      const s = cands[3 * i + 2];
      if (top.length < 6) { top.push(i); top.sort((a, b) => cands[3 * b + 2] - cands[3 * a + 2]); }
      else if (s > cands[3 * top[5] + 2]) { top[5] = i; top.sort((a, b) => cands[3 * b + 2] - cands[3 * a + 2]); }
    }
    // cluster bonus: neighbour value within ~2.2 r (good players sweep clusters, not single items)
    const cr = Math.max(6, r * 2.2) * (this.skill > 0.8 ? 1 : 0.6), cr2 = cr * cr;
    let best = null, bs = -1;
    for (const i of top) {
      const o = cands[3 * i], d = cands[3 * i + 1];
      let cl = 0;
      for (let j = 0; j < n; j++) {
        const p = cands[3 * j];
        const dx = p.x - o.x, dz = p.z - o.z;
        if (dx * dx + dz * dz < cr2) cl += p.landmark ? p.value * lmW : p.value;
      }
      const sc = ((o.landmark ? o.value * lmW : o.value) * 0.5 + cl * 0.5) / (d + k) * (0.92 + this.rng() * 0.16);
      if (sc > bs) { bs = sc; best = o; }
    }
    return best;
  }
}

export class Bots {
  constructor(world, picker, count, names = BOT_NAMES) {
    this.world = world;
    this.picker = picker;
    this.rng = mulberry32(CFG.seed + 101);
    this.dmap = new DensityMap(world);
    this.field = null;               // PowerupField of the running round (set by Game)
    this.brains = [];
    this.holes = [];
    const pool = names.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (let i = 0; i < count; i++) {
      const hole = new Hole({ id: i + 1, name: pool[i % pool.length], color: CFG.holeColors[(i + 1) % CFG.holeColors.length] });
      hole.isBot = true;
      this.holes.push(hole);
      this.brains.push(new Brain(hole, this.rng, i));
    }
  }

  /**
   * Game modes (src/modes.js): use only the first `n` of the bots that were constructed (they keep their state).
   * Returns the holes that dropped out so the caller can clean their HUD tags.
   */
  setActive(n) {
    this._all ||= { holes: this.holes.slice(), brains: this.brains.slice() };
    n = Math.max(0, Math.min(n, this._all.holes.length));
    const dropped = this.holes.filter((h) => !this._all.holes.slice(0, n).includes(h));
    this.holes = this._all.holes.slice(0, n);
    this.brains = this._all.brains.slice(0, n);
    return dropped;
  }

  /**
   * Deterministic bots for the daily challenge: names + personalities from `seed` (null = the normal per-session
   * defaults: seed CFG.seed+101, random name order). Applies to every constructed bot, active or not.
   */
  reseed(seed, names = BOT_NAMES) {
    const all = this._all || { holes: this.holes, brains: this.brains };
    this.rng = mulberry32(seed == null ? CFG.seed + 101 : seed >>> 0);
    const nr = seed == null ? Math.random : mulberry32((seed ^ 0x5bd1e995) >>> 0);
    const pool = names.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(nr() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    all.brains.forEach((br, i) => { br.rng = this.rng; br.personalize(); br.hole.name = pool[i % pool.length]; });
  }

  /** Place bots spread over the map, away from the player and each other. */
  placeAll(player) {
    const placed = [player];
    this.picker.newRound();
    placed.push(this.picker.reserve()); // the human's start spot is chosen first; bots keep away from it
    // ~28 % of the bots (the left bank is ~30 % of the map) start across the Daugava
    const nLeft = this.picker.leftPts && this.picker.leftPts.length ? Math.round(this.holes.length * 0.28) : 0;
    let bi = 0;
    for (const b of this.holes) {
      const left = bi++ >= this.holes.length - nLeft;
      const [x, z] = this.picker.spread(placed, { minDist: CFG.bots.spawnMinDist, pool: left ? this.picker.leftPts : null });
      b.reset(x, z);
      placed.push(b);
    }
    this.dmap.rebuild();
    for (const br of this.brains) br.reset(0);
  }

  update(now, allHoles) {
    const iv = 1 / CFG.bots.thinkHz;
    if (!(now < this.rankAt) || now - this.rankAt > 1) { // board position (~1 Hz): leaders hold back, underdogs play safe
      this.rankAt = now;
      let s1 = 0, s2 = 0;
      for (const h of allHoles) { if (h.mass > s1) { s2 = s1; s1 = h.mass; } else if (h.mass > s2) s2 = h.mass; }
      let human = 0;
      for (const h of allHoles) if (!h.isBot && h.mass > human) human = h.mass;   // (growth value, not points: pacing is what it was before combos)
      const cs = BOT_COMBO_SCALE[CFG.difficulty] ?? 1;
      for (const br of this.brains) {
        br.hole.comboScale = cs; br.field = this.field;
        const s = br.hole.mass;
        // easy: rubber band against runaway bots (only ever slows a bot that is far ahead of the human)
        const cu = CFG.bots.catchUp;
        br.hole.gainMul = cu > 0 ? br.baseGain * Math.max(0.45, Math.min(1, 1 - cu * (s / Math.max(600, human) - 1.2))) : br.baseGain;
        br.leader = s >= s1 && s > s2 * 1.3 && s > 2000;
        br.underdog = s < s1 * CFG.bots.underdogCare;
      }
    }
    for (const br of this.brains) {
      const h = br.hole;
      if (!h.alive || h.dying) continue;
      if (now >= br.nextThink) {
        br.nextThink = now + iv * (0.85 + br.rng() * 0.3);
        br.think(now, allHoles, this.world, this.dmap);
      }
    }
  }

  onRespawn(hole, now) {
    const br = this.brains.find((b) => b.hole === hole);
    if (br) br.reset(now);
  }
}
