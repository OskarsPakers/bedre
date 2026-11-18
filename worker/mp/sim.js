// Scoring (COMBOS + POWER-UPS): every hole has `mass` (the unmultiplied swallowed value: the ONLY input of the radius) and `score` (points = mass x combo
// multiplier x Dubultpunkti, capped; what the ranking and the leaderboard use). Combos are computed HERE from the times at which claims were accepted
// (see handleClaims): the client's multiplier is never trusted. Pickups: worker/mp/powerups.js.
// Authoritative room simulation (pure JS, no Cloudflare APIs: driven by the Durable Object and by scripts/test-mp-sim.mjs).
//
// What is authoritative here: the clock, every hole's score + radius, which objects are eaten, hole-vs-hole kills and respawns,
// the bots (they are simulated entirely server side) and the final ranking. Human holes MOVE on the client (responsiveness):
// the client reports its position (~12 Hz); the server only checks it against a distance budget derived from the speed formula
// and rubber-bands cheaters back. Eat claims are validated against the object table (exists, not eaten, fits, within reach of the
// server-known hole position). Movers (cars, trams, pedestrians, boats...) are simulated per client and cannot be reproduced on
// the server: a mover claim carries the mover's position as the client sees it and is checked loosely (fit, reach to that position,
// a mover-points-per-second cap). Documented trade-off, see README "Multiplayer".
import { CFG } from '../../src/config.js';
import { radiusAt } from '../../src/rules.js';
import { mulberry32 } from '../../src/rng.js';
import { F_MOVER, F_BUILDING, F_LANDMARK } from './table.js';
import { Combo, COMBO, comboWeight, totalMult } from '../../src/combo.js';
import { makeField, makeFx, fxOn, fxMask, fxRemain, speedFactor, reachFactor, doubleMul, grant, pickRadius, PU, PU_TYPES, PU_ORDER } from './powerups.js';
import { magnetFactor } from '../../src/powerups.js';

const GROWTH_K = 16;
const D = CFG.duel;
const S = CFG.swallow;
const H = CFG.hole;
const TAU = Math.PI * 2;
const CELL = 24;
const COARSE = 80;
const FIT_BUCKETS = [3, 6, 12, 25, 50, 1e9]; // coarse value map: "objects with fit < bucket limit"

export const radiusOf = (score) => radiusAt(score, GROWTH_K);
export const speedOf = (r) => H.baseSpeed * Math.pow(r / H.startRadius, H.speedExp);

export const BOT_NAMES = [
  'Jānis', 'Līga', 'Kaķis', 'Rūķis', 'Laima', 'Bebrs', 'Ūdris', 'Zaķis', 'Lācis', 'Vilks', 'Pūce', 'Dzintars', 'Zane', 'Ieva',
  'Māris', 'Baiba', 'Uldis', 'Kārlis', 'Ilze', 'Gundega', 'Kurmis', 'Ezis', 'Vāvere', 'Sprīdītis',
];

/** Uniform grid over the non-mover objects (CSR layout) + coarse value map for bot roaming. */
class StaticIndex {
  constructor(table) {
    const b = table.bounds;
    this.t = table;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL) + 1);
    this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL) + 1);
    const cells = this.nx * this.nz;
    const cnt = new Int32Array(cells + 1);
    const cellOf = new Int32Array(table.n).fill(-1);
    for (let i = 0; i < table.n; i++) {
      if (table.flags[i] & F_MOVER) continue;
      const c = this._cell(table.x[i], table.z[i]);
      if (c < 0) continue;
      cellOf[i] = c; cnt[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cnt[c + 1] += cnt[c];
    this.start = cnt;
    this.items = new Int32Array(cnt[cells]);
    const fill = cnt.slice(0, cells);
    for (let i = 0; i < table.n; i++) if (cellOf[i] >= 0) this.items[fill[cellOf[i]]++] = i;
    // coarse map
    this.cx = Math.max(1, Math.ceil((b.maxX - b.minX) / COARSE));
    this.cz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / COARSE));
    this.coarse0 = new Float32Array(FIT_BUCKETS.length * this.cx * this.cz);
    for (let i = 0; i < table.n; i++) {
      if (cellOf[i] < 0) continue;
      const ci = this._coarse(table.x[i], table.z[i]);
      if (ci < 0) continue;
      for (let k = 0; k < FIT_BUCKETS.length; k++) if (table.fit[i] < FIT_BUCKETS[k]) this.coarse0[k * this.cx * this.cz + ci] += table.value[i];
    }
  }
  _cell(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  _coarse(x, z) {
    const i = Math.floor((x - this.x0) / COARSE), j = Math.floor((z - this.z0) / COARSE);
    return i < 0 || j < 0 || i >= this.cx || j >= this.cz ? -1 : j * this.cx + i;
  }
  /** fn(id, dist) for every non-mover object within r (eaten ones are skipped by the caller via `eaten`). */
  query(cx, cz, r, eaten, fn) {
    const t = this.t;
    const i0 = Math.max(0, Math.floor((cx - r - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((cx + r - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((cz - r - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((cz + r - this.z0) / CELL));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nx + i;
      for (let n = this.start[c], e = this.start[c + 1]; n < e; n++) {
        const id = this.items[n];
        if (eaten[id]) continue;
        const dx = t.x[id] - cx, dz = t.z[id] - cz, d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(id, Math.sqrt(d2));
      }
    }
  }
}

/** A hole as the server knows it. state: 0 alive, 1 dying (being swallowed), 2 dead (waiting to respawn). */
function makeHole({ id, slot, name, bot, token }) {
  return {
    id, slot, name, bot: !!bot, token: token || null,
    x: 0, z: 0, vx: 0, vz: 0, score: 0, mass: 0, r: H.startRadius, eaten: 0, kills: 0, deaths: 0, biggest: 0,
    combo: new Combo(), comboScale: 1, fxUntil: makeFx(), picks: { magnet: 0, speed: 0, double: 0, shield: 0 }, rtt: 0, lastClaimMs: 0, lastClaimNow: 0, puBudget: 0,
    state: 0, dyingEnd: 0, respawnAt: 0, protectUntil: 0, by: -1,
    connected: !bot, discAt: 0, lastPosAt: 0, budget: 0, claimBudget: 0, moverBudget: 0, claimT: 0,
    violations: 0, rejected: 0, tx: 0, tz: 0, speedMul: 1, brain: null, dead: false,
  };
}

export class RoomSim {
  /** table: parsed object table (worker/mp/table.js); cfg: mpConfig(env); seed: any int. */
  constructor(table, cfg, seed = 1) {
    this.table = table;
    this.cfg = cfg;
    this.rng = mulberry32(seed);
    this.index = table.index || (table.index = new StaticIndex(table)); // built once per isolate
    this.eaten = new Uint8Array(table.n);
    this.coarse = Float32Array.from(this.index.coarse0);
    this.holes = [];
    this.byId = new Map();
    this.nextId = 0;
    this.phase = 'lobby';           // lobby | intro | playing | ended
    this.startAt = this.playAt = this.endAt = 0;
    this.lastTick = 0;
    this.ev = { e: [], k: [], r: [], d: [], ps: [], pp: [], px: [] };
    this.field = null;              // PowerupField (created at start())
    this.maxSpawnDens = 0;
    this.eatenList = [];            // ids in eating order (for reconnect sync)
    this.left = [];                 // humans whose hole was removed after the grace period: kept for the final ranking (not for play)
  }

  // ---- membership ----------------------------------------------------------------------------------------------
  freeSlot() {
    const used = new Set(this.holes.map((h) => h.slot));
    for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
    return this.holes.length;
  }
  humans() { return this.holes.filter((h) => !h.bot); }

  /** id/slot may be given by the lobby (so ids and colours stay what the players already saw). */
  addHuman(name, token, id = this.nextId, slot = this.freeSlot()) {
    this.nextId = Math.max(this.nextId, id + 1);
    const h = makeHole({ id, slot, name, token });
    this.holes.push(h); this.byId.set(h.id, h);
    return h;
  }
  removeHole(id) {
    const h = this.byId.get(id);
    if (!h) return;
    this.holes.splice(this.holes.indexOf(h), 1);
    this.byId.delete(id);
    h.dead = true;
    this.ev.d.push(id);
  }
  /** A human that never came back inside the grace period: the hole leaves the arena but stays in the final ranking with what it had. */
  leaveHuman(id) {
    const h = this.byId.get(id);
    if (!h || h.bot) return;
    this.removeHole(id);
    this.left.push({ id: h.id, name: h.name, slot: h.slot, token: h.token, bot: false, left: true, score: h.score, eaten: h.eaten, kills: h.kills, deaths: h.deaths, r: h.r, combo: h.combo });
  }

  // ---- round start ----------------------------------------------------------------------------------------------
  start(now, introMs, roundMs) {
    this.phase = 'intro';
    this.startAt = now; this.playAt = now + introMs; this.endAt = this.playAt + roundMs;
    const humans = this.humans();
    const nBots = Math.max(0, this.cfg.totalHoles - humans.length);
    const pool = BOT_NAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (let i = 0; i < nBots; i++) {
      const h = makeHole({ id: this.nextId++, slot: this.freeSlot(), name: pool[i % pool.length], bot: true });
      h.speedMul = Math.min(1.04, CFG.bots.speedMin + (CFG.bots.speedMax - CFG.bots.speedMin) * this.rng());
      h.brain = new BotBrain(h, this.rng, i, nBots, this.cfg.botSkill ?? 1);
      h.comboScale = this.cfg.botComboScale ?? 1;
      h.speedMul *= h.brain.speedScale;
      this.holes.push(h); this.byId.set(h.id, h);
    }
    const sp = this.table.spawn;
    const placed = [];
    if (this.cfg.testCloseSpawn && sp.n > 3) { // test hook: humans start close together (never in production)
      const first = this.pickSpawns(1, [])[0];
      placed.push(first);
      const near = [];
      for (let i = 0; i < sp.n; i++) { const d = Math.hypot(sp.x[i] - first.x, sp.z[i] - first.z); if (d >= 30) near.push([d, i]); }
      near.sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < humans.length && near.length; k++) { const i = near[(k - 1) * 3 % near.length][1]; placed.push({ x: sp.x[i], z: sp.z[i] }); }
      for (const p of this.pickSpawns(this.holes.length - placed.length, placed)) placed.push(p);
    } else {
      // humans first: equally rich start points (fairness), then the bots on whatever else is spread out
      for (const p of this.pickHumanSpawns(humans.length)) placed.push(p);
      for (const p of this.pickSpawns(this.holes.length - placed.length, placed)) placed.push(p);
    }
    // humans get the first spots in a random order, bots the rest
    // seeded Fisher-Yates within each group (humans first), never a random comparator
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const order = [...shuffle(this.holes.filter((h) => !h.bot)), ...shuffle(this.holes.filter((h) => h.bot))];
    order.forEach((h, i) => { const p = placed[i % placed.length]; h.x = p.x; h.z = p.z; h.tx = p.x; h.tz = p.z; });
    for (const h of this.holes) { h.lastMsgAt = now; h.lastPosAt = this.playAt; h.budget = 0; h.claimBudget = this.cfg.claimBurst; h.moverBudget = this.cfg.moverPointsBurst; }
    // power-ups: seeded by the room's rng (a fresh layout every round; the schedule itself is a pure function of the seed, src/powerups.js)
    this.puSeed = (this.rng() * 4294967296) >>> 0;
    this.field = makeField(this.table, this.puSeed);
    this.puAt = this.playAt;
    for (const e of this.field.tick(0)) this._puEvent(e);   // the first batch is announced by start / resume (list()), not as events
    this.ev.ps.length = 0;
    if (this.cfg.testPowerups && humans.length) this._testPowerups(humans);
    if (this.cfg.testStartMass && humans.length) { const q = humans.find((h) => h.name.startsWith('Big')) || humans[0]; q.mass = q.score = this.cfg.testStartMass; q.r = radiusOf(q.mass); }
  }

  /** TEST ONLY (MP_TEST_PU=1): the humans are found by name (scripts/smoke-mp.mjs: 'PuA', 'PuB', 'Big...'). Slot 0 (speed) halfway between A and B (a race); slots 1 (shield) / 2 (magnet) / 3 (double) 8-9 m from A, on the side away from B (so the race never crosses them). */
  _testPowerups(humans) {
    const by = (p, i) => humans.find((h) => h.name.startsWith(p)) || humans[Math.min(i, humans.length - 1)];
    const h1 = by('PuA', 1), h2 = by('PuB', 2), sl = this.field.slots;
    let dx = h1.x - h2.x, dz = h1.z - h2.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const put = (i, type, x, z) => { Object.assign(sl[i], { type, x, z, state: 'on', until: 1e9 }); };
    put(0, 'speed', (h1.x + h2.x) / 2, (h1.z + h2.z) / 2);
    put(1, 'shield', h1.x + dx * 8, h1.z + dz * 8); put(2, 'magnet', h1.x - dz * 9, h1.z + dx * 9); put(3, 'double', h1.x + dz * 9, h1.z - dx * 9);
  }

  _puEvent(e) {
    if (e.k === 'spawn') this.ev.ps.push([e.slot, PU_ORDER[e.type], round1(e.x), round1(e.z)]);
    else this.ev.px.push(e.slot);
  }
  /** Active pickups [slot, typeIdx, x, z] (start / resume frames). */
  puList() { return this.field ? this.field.list().map(([s, t, x, z]) => [s, PU_ORDER[t], round1(x), round1(z)]) : []; }

  /**
   * Start points for the humans of one room, EQUALLY rich: find the richest density level T at which n points >= sep apart still exist,
   * then pick them (random, seeded) from the band [T, T * 1.08] - nobody gets the best spot while another starts in a poor one
   * (the old "densest first" greedy gave a 2.4x (2 humans) to 4.7x (12 humans) spread of food within 60 m).
   */
  pickHumanSpawns(n) {
    const sp = this.table.spawn;
    if (n <= 0 || sp.n < n) return this.pickSpawns(Math.max(0, n), []);
    // real food around each candidate (value of what a start-size hole can swallow within 60 m), computed once per isolate
    if (!this.table._spawnFood) {
      const f = new Float32Array(sp.n), lim = H.startRadius * S.fitRatio;
      for (let i = 0; i < sp.n; i++) { let v = 0; this.index.query(sp.x[i], sp.z[i], 60, this.eaten, (id) => { if (this.table.fit[id] < lim) v += this.table.value[id]; }); f[i] = v; }
      this.table._spawnFood = f;
    }
    const dens = this.table._spawnFood;
    const idx = Array.from({ length: sp.n }, (_, i) => i).sort((a, b) => dens[b] - dens[a] || a - b);
    let sep = 0;
    const ok = (out, i) => out.every((a) => Math.hypot(a.x - sp.x[i], a.z - sp.z[i]) >= sep);
    const greedy = (list) => { const out = []; for (const i of list) { if (out.length >= n) break; if (ok(out, i)) out.push({ x: sp.x[i], z: sp.z[i], i }); } return out; };
    // richest level T per minimum separation; a larger separation wins only when it costs very little richness
    let pick = null;
    for (const sp0 of [200, 150, 110, 80, 60]) {
      sep = sp0;
      let found = -1;
      for (let k = n - 1; k < Math.min(idx.length, 1500); k++) { if (greedy(idx.slice(0, k + 1)).length >= n) { found = k; break; } }
      if (found < 0) continue;
      const T = dens[idx[found]], score = T * (1 + 0.0015 * (sp0 - 60));
      if (!pick || score > pick.score) pick = { sep: sp0, found, T, score };
    }
    if (pick) {
      sep = pick.sep;
      const { found, T } = pick;
      const band = idx.slice(0, found + 1).filter((i) => dens[i] <= T * 1.08 + 1);
      for (let a = band.length - 1; a > 0; a--) { const j = Math.floor(this.rng() * (a + 1)); [band[a], band[j]] = [band[j], band[a]]; }
      const out = greedy(band);
      let res = out;
      if (res.length < n) res = greedy([...out.map((q) => q.i), ...idx.slice(0, found + 1).reverse()]);   // short band: fill with the candidates closest above T
      if (res.length < n) res = greedy(idx.slice(0, found + 1));                                            // (always feasible by construction of `found`)
      return res.slice(0, n).map(({ x, z }) => ({ x, z }));
    }
    return this.pickSpawns(n, []);
  }

  /** Greedy spread of n start points over dense street points near the centre, `avoid` = already taken [{x,z}]. */
  pickSpawns(n, avoid) {
    const sp = this.table.spawn;
    const cand = [];
    for (let i = 0; i < sp.n; i++) cand.push([sp.dens[i] - Math.hypot(sp.x[i], sp.z[i]) * 0.03 + this.rng() * 25, i]);
    cand.sort((a, b) => b[0] - a[0]);
    const out = [];
    for (const minSep of [260, 150, 80, 30, 0]) {
      for (const [, i] of cand) {
        if (out.length >= n) break;
        const x = sp.x[i], z = sp.z[i];
        if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < minSep) || out.some((a) => Math.hypot(a.x - x, a.z - z) < minSep)) continue;
        out.push({ x, z });
      }
      if (out.length >= n) break;
    }
    while (out.length < n) out.push({ x: (this.table.bounds.minX + this.table.bounds.maxX) / 2, z: (this.table.bounds.minZ + this.table.bounds.maxZ) / 2 });
    return out;
  }

  /** Respawn point: plenty of food for the new (smaller) size, far from the leaders and from every other hole. */
  pickRespawn(h) {
    const sp = this.table.spawn;
    const r = Math.max(H.startRadius, radiusOf(h.mass));
    const others = this.holes.filter((o) => o !== h && o.state === 0);
    const leaders = others.slice().sort((a, b) => b.score - a.score).slice(0, 3);
    let best = null, bs = -Infinity;
    for (let k = 0; k < 64; k++) {
      const i = Math.floor(this.rng() * sp.n);
      const x = sp.x[i], z = sp.z[i];
      let md = 1e4, ld = 1e4;
      for (const o of others) md = Math.min(md, Math.hypot(o.x - x, o.z - z) - Math.max(0, o.r - r) * 3);
      for (const o of leaders) ld = Math.min(ld, Math.hypot(o.x - x, o.z - z));
      let food = 0;
      this.index.query(x, z, Math.max(45, r * 5), this.eaten, (id) => { if (this.table.fit[id] < r * S.fitRatio) food += this.table.value[id]; });
      let s = Math.min(food, 400) * 1.2 + Math.min(md, D.minRespawnDist * 1.3) * 0.15 + Math.min(ld, 400) * 0.25 + this.rng() * 10;
      if (md < D.minRespawnDist) s -= (D.minRespawnDist - md) * 3;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return best || { x: h.x, z: h.z };
  }

  // ---- client input (validated) -----------------------------------------------------------------------------------
  /** Returns null if accepted, or {x,z} = rubber-band target. */
  handlePos(h, x, z, now) {
    if (this.phase !== 'playing' || h.state !== 0 || h.bot) return null;
    const c = this.cfg, b = this.table.bounds;
    const dt = Math.min(2, Math.max(0, (now - h.lastPosAt) / 1000));
    h.lastPosAt = now;
    const vmax = speedOf(h.r) * c.speedTol * speedFactor(h, now);   // Ātrums raises the allowed speed while it runs
    h.budget = Math.min(h.budget + vmax * dt, vmax * c.burstSeconds + c.posSlack);
    x = Math.min(b.maxX, Math.max(b.minX, x)); z = Math.min(b.maxZ, Math.max(b.minZ, z));
    const d = Math.hypot(x - h.x, z - h.z);
    if (d <= h.budget + 0.5) {
      h.budget = Math.max(0, h.budget - d);
      if (dt > 0.01) { h.vx = (x - h.x) / dt; h.vz = (z - h.z) / dt; }
      h.x = x; h.z = z;
      return null;
    }
    h.violations++;
    return { x: h.x, z: h.z };
  }

  /**
   * Validate eat claims. statics: [id], movers: [[id,x,z]]. Returns {bad:[ids], ok:n}.
   * `ct` = the client's own timestamp (its estimate of server ms) of the batch: combos use it so network jitter / latency does not break a combo
   * (a 300 ms player keeps theirs), clamped to [now - allowance, now] where the allowance grows with the RTT the client reports (never trusted beyond 1.0 s)
   * and never goes backwards. Without `ct` the server's receipt time is used.
   */
  handleClaims(h, statics, movers, now, ct) {
    const bad = [];
    const t = this.table, c = this.cfg;
    if (this.phase !== 'playing' || h.state !== 0) {
      for (const id of statics) bad.push(id);
      for (const m of movers) bad.push(m[0]);
      return { bad, ok: 0 };
    }
    // per-hole claim budgets (refilled by server time)
    const dtc = Math.min(2, Math.max(0, (now - h.claimT) / 1000)); h.claimT = now;
    h.claimBudget = Math.min(c.claimBurst, h.claimBudget + c.claimRate * dtc);
    h.moverBudget = Math.min(c.moverPointsBurst, h.moverBudget + c.moverPointsRate * dtc);
    const vmax = speedOf(h.r) * c.speedTol * speedFactor(h, now);
    const reach = h.r * S.reach * reachFactor(h, now) + vmax * c.reachSlackSeconds + 1.5;   // Magnēts widens the reach tolerance
    const maxFit = h.r * S.fitRatio * 1.03;
    const lag = 450 + Math.min(550, 1.5 * (h.rtt || 0));
    let tMs = Math.max(h.lastClaimMs, Math.min(now, Math.max(now - lag, Number.isFinite(ct) ? ct : now)));
    // anti-exploit: the client's timeline may run FASTER than the server's receipt timeline by at most `COMBO.stampJitter` per batch. Without this a
    // client that fakes its RTT / timestamps could alternate "short gap" (lag back to 0) and "long gap, stamped early" (lag up to the cap) and keep
    // every combo alive across gaps up to window + cap; with it the extra window is bounded by the jitter allowance (measured in the combo test).
    if (h.lastClaimNow > 0) tMs = Math.max(tMs, Math.min(now, h.lastClaimMs + (now - h.lastClaimNow) - COMBO.stampJitter * 1000));
    h.lastClaimMs = tMs; h.lastClaimNow = now;
    let ok = 0;
    const take = (id, isMover, mx, mz) => {
      if (!Number.isInteger(id) || id < 0 || id >= t.n || this.eaten[id]) return false;
      const mv = (t.flags[id] & F_MOVER) !== 0;
      if (mv !== isMover) return false;
      if (h.claimBudget < 1) return false;
      h.claimBudget -= 1;
      if (t.fit[id] >= maxFit) return false;
      const px = isMover ? mx : t.x[id], pz = isMover ? mz : t.z[id];
      if (Math.hypot(px - h.x, pz - h.z) > reach) return false;
      if (isMover) { if (h.moverBudget < t.value[id]) return false; h.moverBudget -= t.value[id]; }
      this.eat(h, id, tMs);
      return true;
    };
    for (const id of statics) { if (take(id, false)) ok++; else bad.push(id); }
    for (const m of movers) { if (take(m[0], true, m[1], m[2])) ok++; else bad.push(m[0]); }
    h.rejected += bad.length;
    return { bad, ok };
  }

  /** `ms` = the time the swallow counts at (claim time for humans, server time for bots). */
  eat(h, id, ms) {
    const t = this.table;
    this.eaten[id] = 1;
    this.eatenList.push(id);
    h.eaten++;
    const mass = t.value[id];
    const c = h.combo.hit(ms / 1000, comboWeight((t.flags[id] & F_BUILDING) !== 0, t.fit[id], mass) * h.comboScale, h.r, h.bot ? 0 : COMBO.netSlack);
    const pts = mass * totalMult(c.mult, doubleMul(h, ms));
    h.mass += mass; h.score += pts;
    h.rawEaten = (h.rawEaten || 0) + mass; h.swPts = (h.swPts || 0) + pts;
    h.r = radiusOf(h.mass);
    if (t.fit[id] > h.biggest) h.biggest = t.fit[id];
    this.ev.e.push([id, h.id]);
    if (!(t.flags[id] & F_MOVER)) {
      const ci = this.index._coarse(t.x[id], t.z[id]);
      if (ci >= 0) {
        const n = this.index.cx * this.index.cz;
        for (let k = 0; k < FIT_BUCKETS.length; k++) if (t.fit[id] < FIT_BUCKETS[k]) this.coarse[k * n + ci] = Math.max(0, this.coarse[k * n + ci] - t.value[id]);
      }
    }
  }

  // ---- simulation step ----------------------------------------------------------------------------------------------
  /** Advance to wall-clock `now` (ms). Returns true while the round is running. */
  tick(now) {
    if (this.phase === 'intro' && now >= this.playAt) { this.phase = 'playing'; this.lastTick = now; for (const h of this.holes) h.lastPosAt = now; }
    if (this.phase !== 'playing') return false;
    const dt = Math.min(0.12, Math.max(0.001, (now - this.lastTick) / 1000));
    this.lastTick = now; this._now = now;
    const sec = now / 1000;
    for (const h of this.holes.slice()) {
      // a socket that went silent (dead network, frozen / evicted tab: no ping for silentAfterMs) starts the grace period too
      if (!h.bot && h.connected && h.lastMsgAt && now - h.lastMsgAt > this.cfg.silentAfterMs) { h.connected = false; h.discAt = now; }
      if (!h.bot && !h.connected && now - h.discAt > this.cfg.removeAfterMs) { this.leaveHuman(h.id); continue; }
      if (h.state === 1) { if (now >= h.dyingEnd) h.state = 2; continue; }
      if (h.state === 2) { if (now >= h.respawnAt) this.respawn(h, now); continue; }
      if (h.bot) {
        if (now < this.playAt + 600) continue;   // nobody scores in the first moments: bots hold still until the humans' first position updates can have arrived
        h.brain.maybeThink(this, sec);
        this.moveBot(h, dt);
        this.botEat(h);
      }
    }
    if (this.field) {
      for (const e of this.field.tick((now - this.playAt) / 1000)) this._puEvent(e);
      for (const h of this.holes) if (h.bot && h.state === 0) this.botPickup(h, now);
    }
    this.duels(now);
    if (now >= this.endAt) { this.phase = 'ended'; return false; }
    return true;
  }

  // ---- power-ups ------------------------------------------------------------------------------------------------------------
  grantPickup(h, slot, now) {
    const type = this.field.take(slot, (now - this.playAt) / 1000);
    if (!type) return null;
    grant(h, type, now, this.cfg.testFxScale || 1);
    this.ev.pp.push([slot, h.id, PU_ORDER[type], Math.round(PU[type].dur * 1000 * (this.cfg.testFxScale || 1))]);   // (duration in ms: the collector's badge starts with the server's number)
    return type;
  }

  /** A human CLAIMS pickups ([slot..]). Accepted when the slot is live and the hole (server-known position) is within the pickup radius + latency allowance. Returns rejected slots. */
  handlePickups(h, slots, now) {
    const bad = [];
    if (!this.field || this.phase !== 'playing' || h.state !== 0) return slots.slice();
    const vmax = speedOf(h.r) * this.cfg.speedTol * speedFactor(h, now);
    const slack = vmax * this.cfg.reachSlackSeconds + 1.5;
    for (const slot of slots) {
      const s = Number.isInteger(slot) ? this.field.slots[slot] : null;
      if (!s || s.state !== 'on' || Math.hypot(s.x - h.x, s.z - h.z) > pickRadius(h.r) + slack) { bad.push(slot); continue; }
      this.grantPickup(h, slot, now);
    }
    return bad;
  }

  botPickup(h, now) {
    const slot = this.field.touching(h.x, h.z, h.r);
    if (slot >= 0) this.grantPickup(h, slot, now);
  }

  moveBot(h, dt) {
    const dx0 = h.tx - h.x, dz0 = h.tz - h.z, l = Math.hypot(dx0, dz0);
    let dx = 0, dz = 0, mag = 0;
    const slow = Math.max(h.r * 0.5, 1);
    if (l > 0.05) { dx = dx0 / l; dz = dz0 / l; mag = Math.min(1, l / slow); }
    const k = 1 - Math.exp(-H.accel * dt);
    const sp = speedOf(h.r) * h.speedMul;
    h.vx += (dx * mag * sp - h.vx) * k; h.vz += (dz * mag * sp - h.vz) * k;
    const b = this.table.bounds;
    h.x = Math.min(b.maxX, Math.max(b.minX, h.x + h.vx * dt));
    h.z = Math.min(b.maxZ, Math.max(b.minZ, h.z + h.vz * dt));
  }

  botEat(h) {
    const t = this.table, maxFit = h.r * S.fitRatio, reach = h.r * S.reach * (h.fxUntil.magnet > this._now ? magnetFactor(h.r) : 1);
    const hit = this._hit || (this._hit = []);
    hit.length = 0;
    this.index.query(h.x, h.z, reach, this.eaten, (id) => { if (t.fit[id] < maxFit) hit.push(id); });
    for (let i = 0; i < hit.length; i++) this.eat(h, hit[i], this._now);
  }

  duels(now) {
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      if (a.state !== 0 || now < a.protectUntil) continue;
      for (let j = 0; j < hs.length; j++) {
        const b = hs[j];
        if (i === j || b.state !== 0 || now < b.protectUntil) continue;
        if (b.fxUntil.shield > now) continue;      // Vairogs: bigger holes cannot swallow you
        if (a.r < b.r * D.ratio) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.r * D.reach) this.kill(a, b, now);
      }
    }
  }

  kill(eater, victim, now) {
    const gain = victim.score * D.gain, massGain = victim.mass * D.gain;   // points follow the points, the size follows the mass
    victim.state = 1; victim.by = eater.id;
    victim.dyingEnd = now + D.dyingTime * 1000;
    victim.respawnAt = victim.dyingEnd + D.respawnDelay * 1000;
    victim.vx = victim.vz = 0;
    victim.deaths++; eater.kills++;
    eater.score += gain; eater.mass += massGain; eater.r = radiusOf(eater.mass);
    this.ev.k.push([eater.id, victim.id, Math.round(gain)]);
  }

  respawn(h, now) {
    const p = this.pickRespawn(h);
    h.score *= D.keepScore; h.mass *= D.keepScore;
    h.r = radiusOf(h.mass);
    h.combo.drop(); h.fxUntil = makeFx();
    h.x = p.x; h.z = p.z; h.tx = p.x; h.tz = p.z; h.vx = h.vz = 0;
    h.state = 0; h.by = -1;
    h.protectUntil = now + D.protect * 1000;
    h.lastPosAt = now; h.budget = 0;
    if (h.brain) h.brain.reset(now / 1000);
    this.ev.r.push([h.id, round1(h.x), round1(h.z), Math.round(h.score), Math.round(h.mass)]);
  }

  // ---- outgoing ---------------------------------------------------------------------------------------------------------
  snapshot(now) {
    const m = {
      t: 's', T: now,
      h: this.holes.map((h) => [h.id, round1(h.x), round1(h.z), Math.round(h.r * 100) / 100, Math.round(h.score), h.state, fxMask(h, now)]),
    };
    const ev = this.ev;
    if (ev.e.length) m.e = ev.e;
    if (ev.k.length) m.k = ev.k;
    if (ev.r.length) m.r = ev.r;
    if (ev.d.length) m.d = ev.d;
    if (ev.ps.length) m.ps = ev.ps;      // pickups spawned [slot, type, x, z]
    if (ev.pp.length) m.pp = ev.pp;      // collected [slot, hole, type]
    if (ev.px.length) m.px = ev.px;      // expired [slot]
    this.ev = { e: [], k: [], r: [], d: [], ps: [], pp: [], px: [] };
    return m;
  }

  ranking() {
    return [...this.holes, ...this.left].sort((a, b) => b.score - a.score || a.id - b.id).map((h, i) => ({
      rank: i + 1, id: h.id, name: h.name, slot: h.slot, bot: h.bot, score: Math.round(h.score), eaten: h.eaten,
      kills: h.kills, deaths: h.deaths, radius: Math.round(h.r * 100) / 100, bestCombo: Math.round(h.combo.best), bestMult: h.combo.bestMult, ...(h.left ? { left: true } : null),
    }));
  }
}

const round1 = (v) => Math.round(v * 10) / 10;

// ---- server bots ------------------------------------------------------------------------------------------------------
// Lighter than src/bots.js (no staggered per-bot memo maps): same priorities (flee > hunt > roam > eat), ticked at ~4 Hz.
class BotBrain {
  constructor(h, rng, idx, count, botSkill = 1) {
    this.h = h; this.rng = rng; this.idx = idx;
    const B = CFG.bots;
    this.skill = 0.85 + rng() * 0.3;
    this.react = B.reactMin + (B.reactMax - B.reactMin) * rng();
    this.aggr = B.aggressionMin + (B.aggressionMax - B.aggressionMin) * rng();
    this.noise = B.aimNoise * (0.6 + rng() * 0.8) * 0.4;
    this.hz = 4;
    // difficulty (MP.botSkill < 1): each bot gets its own level (+-22 % spread) that makes it slower, sloppier and slower to react
    this.speedScale = 1;
    this.puChance = 0.45;
    if (botSkill < 1) {
      const lvl = Math.min(1, botSkill * (0.78 + 0.44 * rng()));
      this.puChance = 0.08 + 0.3 * lvl;        // weaker bots notice pickups less often
      this.speedScale = 0.2 + 0.8 * lvl;
      this.noise *= 1.9 - lvl;
      this.react += (1 - lvl) * 0.5;
      this.skill *= Math.sqrt(lvl);
      this.hz = 4 * (0.55 + 0.45 * lvl);
    }
    this.cands = [];
    this.reset(0);
    this.nextThink = (idx / Math.max(1, count)) / this.hz + rng() * 0.1;
  }
  reset(now) {
    this.nextThink = now + 0.1 + this.rng() * 0.2;
    this.goal = -1; this.goalUntil = 0; this.banId = -1; this.banUntil = 0;
    this.threatSince = -1; this.roam = null; this.nextRoam = now + 0.5 + this.rng() * 1.5;
    this.lastX = this.h.x; this.lastZ = this.h.z; this.lastCheck = now;
    this.prey = null; this.huntSince = 0; this.preyBan = -1; this.preyBanUntil = 0;
    this.rate = 1; this.rateScore = this.h.mass; this.rateT = now;
    this.puGoal = -1; this.puUntil = 0; this.puCool = now + 15;
    this.heading = this.rng() * TAU;
  }

  maybeThink(sim, now) {
    if (now < this.nextThink) return;
    this.nextThink = now + (1 / this.hz) * (0.85 + this.rng() * 0.3);
    this.think(sim, now);
  }

  think(sim, now) {
    const h = this.h, r = h.r, t = sim.table, b = t.bounds, B = CFG.bots;
    if (now - this.rateT >= 2) {
      this.rate = this.rate * 0.5 + 0.5 * Math.max(0, h.mass - this.rateScore) / (now - this.rateT);
      this.rateScore = h.mass; this.rateT = now;
    }
    if (now - this.lastCheck > 1.5) { // stuck: barely moved while chasing a goal
      if (this.goal >= 0 && Math.hypot(h.x - this.lastX, h.z - this.lastZ) < Math.max(0.4, r * 0.3) * 0.5) {
        this.banId = this.goal; this.banUntil = now + 5; this.goal = -1; this.roam = null;
      }
      this.lastX = h.x; this.lastZ = h.z; this.lastCheck = now;
    }
    const nowMs = now * 1000;
    const safe = nowMs < h.protectUntil - 400;
    let threat = null, tw = 0, fx = 0, fz = 0, prey = null, pv = 0;
    for (const o of sim.holes) {
      if (o === h || o.state !== 0) continue;
      const dx = h.x - o.x, dz = h.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      if (o.r >= r * D.ratio * 0.97) {
        if (safe || nowMs < o.protectUntil - 1000) continue;
        const gap = d - o.r * D.reach;
        const closing = Math.max(0, (o.vx * dx + o.vz * dz) / d);
        const zone = 8 + o.r * (0.7 + 0.5 * this.skill) + closing * (1 + this.skill);
        if (gap < zone) { const w = 1 - gap / zone + 0.2; fx += (dx / d) * w; fz += (dz / d) * w; if (w > tw) { tw = w; threat = o; } }
      } else if (r >= o.r * D.ratio * 1.02 && !safe && nowMs >= h.protectUntil && nowMs >= o.protectUntil - 500) {
        if (o.id === this.preyBan && now < this.preyBanUntil) continue;
        if (!o.bot && now < sim.playAt / 1000 + (sim.cfg.botHumanGrace || 0)) continue; // no early dogpile on people: they get a quiet first minute
        if (nowMs < o.fxUntil.shield) continue;                       // Vairogs: cannot be swallowed
        if (o.mass < h.mass * B.preyMinFrac) continue;
        const gap = d - r * D.reach;
        if (gap > Math.max(18, r * B.huntRange) * (0.5 + this.aggr * 0.7)) continue;
        const catchT = Math.max(0, gap) / Math.max(1.5, speedOf(r) * h.speedMul - 0.75 * speedOf(o.r)) + 0.5;
        const v = (o.mass * D.gain + 3) / catchT;
        if (v > this.rate * (B.huntGreed - this.aggr) && v > pv) { pv = v; prey = o; }
      }
    }
    if (threat) { if (this.threatSince < 0) this.threatSince = now; } else this.threatSince = -1;

    let tx, tz;
    if (threat && now - this.threatSince >= this.react) {
      const m = 160;
      if (h.x - b.minX < m) fx += (1 - (h.x - b.minX) / m) * 1.2;
      if (b.maxX - h.x < m) fx -= (1 - (b.maxX - h.x) / m) * 1.2;
      if (h.z - b.minZ < m) fz += (1 - (h.z - b.minZ) / m) * 1.2;
      if (b.maxZ - h.z < m) fz -= (1 - (b.maxZ - h.z) / m) * 1.2;
      const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const food = this.pickFood(sim, now, { dx: fx, dz: fz, minDot: 0.55, range: Math.max(20, r * 4) });
      if (food >= 0) { tx = t.x[food]; tz = t.z[food]; } else { tx = h.x + fx * (60 + r * 2); tz = h.z + fz * (60 + r * 2); }
      this.goal = -1; this.roam = null;
    } else if (prey) {
      if (this.prey !== prey) { this.prey = prey; this.huntSince = now; }
      if (now - this.huntSince > 4 + this.aggr * 5) { this.preyBan = prey.id; this.preyBanUntil = now + 12; this.prey = null; }
      else { tx = prey.x + prey.vx * 0.4; tz = prey.z + prey.vz * 0.4; }
    } else this.prey = null;

    if (tx === undefined && sim.field) {
      // power-ups: notice one nearby and detour for it (same idea as src/bots.js: more often for the stronger bots)
      const f = sim.field;
      let pu = null;
      if (this.puGoal >= 0 && now < this.puUntil) { const q = f.slots[this.puGoal]; if (q && q.state === 'on') pu = q; else { this.puGoal = -1; this.puCool = now + 10; } }
      else if (this.puGoal >= 0) { this.puGoal = -1; this.puCool = now + 10; }
      if (!pu && now >= this.puCool) {
        const cand = f.nearest(h.x, h.z, 40 + r * 1.5);
        if (cand && this.rng() < this.puChance) { this.puGoal = cand.slot; this.puUntil = now + 4 + cand.d / Math.max(4, speedOf(r) * h.speedMul) * 1.3; pu = cand; }
      }
      if (pu) { tx = pu.x; tz = pu.z; }
    }
    if (tx === undefined) {
      this.roamCheck(sim, now);
      if (this.roam) {
        const rd = Math.hypot(this.roam.x - h.x, this.roam.z - h.z);
        if (rd < Math.max(45, r * 1.5) || now > this.roam.until) this.roam = null;
        else {
          const food = this.pickFood(sim, now, { dx: (this.roam.x - h.x) / rd, dz: (this.roam.z - h.z) / rd, minDot: 0.6, range: Math.max(18, r * 3) });
          if (food >= 0) { tx = t.x[food]; tz = t.z[food]; } else { tx = this.roam.x; tz = this.roam.z; }
        }
      }
    }
    if (tx === undefined) {
      const g = this.goal;
      if (g >= 0 && now < this.goalUntil && !sim.eaten[g] && t.fit[g] < r * S.fitRatio && g !== this.banId) { tx = t.x[g]; tz = t.z[g]; }
      else {
        const f = this.pickFood(sim, now, null);
        if (f >= 0) { this.goal = f; this.goalUntil = now + 0.5 + this.rng() * 0.6; tx = t.x[f]; tz = t.z[f]; }
        else {
          this.nextRoam = Math.min(this.nextRoam, now + 0.5);
          this.heading += (this.rng() - 0.5) * 0.6;
          const toC = Math.atan2((b.minZ + b.maxZ) / 2 - h.z, (b.minX + b.maxX) / 2 - h.x);
          if (Math.min(h.x - b.minX, b.maxX - h.x, h.z - b.minZ, b.maxZ - h.z) < 200) this.heading = toC + (this.rng() - 0.5) * 0.8;
          tx = h.x + Math.cos(this.heading) * (70 + r * 3); tz = h.z + Math.sin(this.heading) * (70 + r * 3);
        }
      }
    }
    const a = (this.rng() - 0.5) * 2 * this.noise, dx = tx - h.x, dz = tz - h.z, c = Math.cos(a), s = Math.sin(a);
    h.tx = Math.min(b.maxX, Math.max(b.minX, h.x + dx * c - dz * s));
    h.tz = Math.min(b.maxZ, Math.max(b.minZ, h.z + dx * s + dz * c));
  }

  roamCheck(sim, now) {
    if (now < this.nextRoam) return;
    this.nextRoam = now + 2.5 + this.rng() * 1.5;
    const h = this.h, ix = sim.index, n = ix.cx * ix.cz, B = CFG.bots;
    const maxFit = h.r * S.fitRatio * 1.3;
    let bk = FIT_BUCKETS.findIndex((v) => v >= maxFit); if (bk < 0) bk = FIT_BUCKETS.length - 1;
    const base = bk * n;
    const block = (ci, cj) => {
      let v = 0;
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (i >= 0 && j >= 0 && i < ix.cx && j < ix.cz) v += sim.coarse[base + j * ix.cx + i];
      return v;
    };
    const ci = Math.floor((h.x - ix.x0) / COARSE), cj = Math.floor((h.z - ix.z0) / COARSE);
    const T0 = B.roamEatTime, speed = Math.max(4, speedOf(h.r));
    const here = block(ci, cj) / T0;
    const reach = Math.min(1400, 300 + speed * 45), cr = Math.ceil(reach / COARSE);
    let best = null, bv = here * (B.roamGain + 0.6 * (1.2 - Math.min(1.2, this.skill)));
    if (this.roam) bv = Math.max(bv, this.roam.v * 1.15);
    for (let j = cj - cr; j <= cj + cr; j++) for (let i = ci - cr; i <= ci + cr; i++) {
      if (i < 1 || j < 1 || i >= ix.cx - 1 || j >= ix.cz - 1 || ((i + j + this.idx) & 1)) continue;
      const x = ix.x0 + (i + 0.5) * COARSE, z = ix.z0 + (j + 0.5) * COARSE, d = Math.hypot(x - h.x, z - h.z);
      if (d < COARSE * 1.5 || d > reach) continue;
      const v = block(i, j) / (T0 + d / speed) * (0.85 + this.rng() * 0.3);
      if (v > bv) { bv = v; best = { x, z }; }
    }
    if (best) this.roam = { x: best.x, z: best.z, v: bv, until: now + 12 + Math.hypot(best.x - h.x, best.z - h.z) / speed * 1.5 };
  }

  /** Best edible object nearby (value / distance with a cluster bonus), keeping out of the mouths of bigger holes. */
  pickFood(sim, now, dir) {
    const h = this.h, r = h.r, t = sim.table, maxFit = r * S.fitRatio, nowMs = now * 1000;
    const bigs = [];
    if (nowMs >= h.protectUntil - 400) for (const o of sim.holes) if (o !== h && o.state === 0 && o.r >= r * D.ratio * 0.97) bigs.push(o);
    const c = this.cands; c.length = 0;
    const R = dir ? dir.range : Math.max(26, r * 7) * (0.75 + 0.25 * Math.min(1.2, this.skill));
    const k = r * 1.5 + 4;
    const lmW = Math.min(1, 0.25 + Math.max(0, nowMs - sim.playAt) / 1000 / 240);   // sights: bots do not seek them early (same rule as the solo bots)
    const val = (id) => ((t.flags[id] & F_LANDMARK) ? t.value[id] * lmW : t.value[id]);
    let n = 0;
    sim.index.query(h.x, h.z, R, sim.eaten, (id, d) => {
      if (n >= 800 || t.fit[id] >= maxFit || (id === this.banId && now < this.banUntil)) return;
      if (dir && d > 1 && ((t.x[id] - h.x) * dir.dx + (t.z[id] - h.z) * dir.dz) / d < dir.minDot) return;
      for (const o of bigs) if (Math.hypot(t.x[id] - o.x, t.z[id] - o.z) < o.r * (D.reach + 0.6) + 6) return;
      c.push(id, d, val(id) / (d + k)); n++;
    });
    if (!n) return -1;
    const top = [];
    for (let i = 0; i < n; i++) {
      const s = c[3 * i + 2];
      if (top.length < 5) { top.push(i); top.sort((a, b) => c[3 * b + 2] - c[3 * a + 2]); }
      else if (s > c[3 * top[4] + 2]) { top[4] = i; top.sort((a, b) => c[3 * b + 2] - c[3 * a + 2]); }
    }
    const cr = Math.max(6, r * 2.2), cr2 = cr * cr;
    let best = -1, bs = -1;
    for (const i of top) {
      const id = c[3 * i], d = c[3 * i + 1];
      let cl = 0;
      for (let j = 0; j < n; j++) { const p = c[3 * j], dx = t.x[p] - t.x[id], dz = t.z[p] - t.z[id]; if (dx * dx + dz * dz < cr2) cl += val(p); }
      const sc = (val(id) * 0.5 + cl * 0.5) / (d + k) * (0.92 + this.rng() * 0.16);
      if (sc > bs) { bs = sc; best = id; }
    }
    return best;
  }
}
