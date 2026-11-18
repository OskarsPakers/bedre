// The live railway around the player: other trams (AI) running the same network on their own tracks, block / road signals for the player's track,
// the obstruction scan used by the player's collision protection, and a shared list of dynamic hazards (people / vehicles on the rails).
// No THREE (pure maths) so scripts can run it under node.
//   AI trams give way to the player (and to lower-numbered AI trams) when anything of the other tram lies on their path ahead -> no collisions;
//   the player gets a red signal when the block ahead is occupied and, as the last line, `scan()` makes the sim brake before touching anything.
import { buildTrack, idealProfile } from './track.js';
import { TRAM } from './sim.js';

const BODY = []; for (let k = 0; k < 7; k++) BODY.push(k * 4.2);   // sample points along a tram body, metres behind the nose
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AiTram {
  /** track: its own built track; stops: [{ s, name }] on it; start: arc length of the nose */
  constructor(id, track, { start, pace = 0.9, dwell = [12, 20], rng, label, script = null }) {
    this.script = script; if (script && script.offset >= 0) { const i = Math.min(script.traj.length - 1, Math.floor(script.offset / script.dt)); start = script.traj[i] + script.nose; }
    this.id = id; this.prio = id; this.track = track; this.s = start; this.v = 0; this.pace = pace; this.rng = rng || Math.random;
    this.label = label; this.stops = track.stops; this.nextStop = this.stops.findIndex((st) => st.s + TRAM.nose > start + 1); if (this.nextStop < 0) this.nextStop = this.stops.length;
    this.dwellRange = dwell; this.dwellT = 0; this.state = 'run'; this.active = true; this.hold = 0; this.door = 0; this.heldFor = 0;
    this.x = 0; this.z = 0; this.yaw = 0; this.pts = BODY.map(() => ({ x: 0, z: 0 }));
    this._p = {}; this.refreshPts();
  }
  refreshPts() { for (let k = 0; k < BODY.length; k++) { this.track.at(this.s - BODY[k], this._p); this.pts[k].x = this._p.x; this.pts[k].z = this._p.z; } this.track.at(this.s, this._p); this.x = this._p.x; this.z = this._p.z; this.yaw = this._p.yaw; }
  /** target speed from the limit profile and the next stop; obstruction distance `gap` ahead (Infinity if free) */
  step(dt, gap, clock = 0) {
    if (!this.active) return;
    const T = this.track, st = this.stops[this.nextStop];
    let vt = Math.min(T.limit(this.s) * this.pace, 13);
    if (this.script) {
      // timetable-true: follows the reference run of the player's line (shifted by `offset` seconds); catches up when it was held
      const sc = this.script, k = (clock + sc.offset) / sc.dt, i = Math.floor(k);
      if (i < 0) { this.visible = false; vt = 0; }
      else if (i >= sc.traj.length - 1) { this.visible = true; this.active = false; this.v = 0; return; }
      else { this.visible = true; const a = sc.traj[i], b = sc.traj[i + 1], target = a + (b - a) * (k - i) + sc.nose, vel = (b - a) / sc.dt; vt = clamp(vel + 0.25 * (target - this.s), 0, 13.5); if (this.s < sc.nose + sc.s0 - 1 && vel < 0.05) vt = 0; }
    } else if (this.state === 'dwell') { vt = 0; this.dwellT -= dt; this.door = clamp(this.door + dt / 1.1 * (this.dwellT > 1.2 ? 1 : -1), 0, 1); if (this.dwellT <= 0 && this.door <= 0) { this.state = 'run'; this.nextStop++; } }
    else if (st) {
      const d = st.s + TRAM.nose - this.s;    // distance of the nose to where it must stand (first door on the stop marker)
      if (d < 120) vt = Math.min(vt, d < 0.4 ? 0 : Math.sqrt(2 * 0.8 * d));
      if (d < 0.6 && this.v < 0.35) { this.state = 'dwell'; this.v = 0; this.dwellT = this.dwellRange[0] + this.rng() * (this.dwellRange[1] - this.dwellRange[0]); }
    }
    if (this.script) { const near = this.stops.some((q) => Math.abs(q.s + TRAM.nose - this.s) < 5); this.door = clamp(this.door + dt / 1.1 * (near && this.v < 0.2 ? 1 : -1), 0, 1); }
    // give way: keep a stopping distance to whatever lies ahead (8 m standstill gap)
    if (gap < 120) { vt = Math.min(vt, Math.sqrt(2 * 1.0 * Math.max(0, gap - 9))); }
    const a = vt > this.v ? 1.0 : 1.4;
    this.v = vt > this.v ? Math.min(vt, this.v + a * dt) : Math.max(vt, this.v - a * dt);
    this.heldFor = this.v < 0.1 && gap < 30 ? this.heldFor + dt : 0;
    this.s += this.v * dt;
    if (this.s >= T.length - 2) { this.active = false; this.v = 0; }
    this.refreshPts();
  }
}

export class Network {
  /** route: the loaded route json (path, stops, ai: [{ path, stops }]); hazards: planHazards(...) result; opts.startS: the player's start (door s) */
  constructor(track, route, hazards, { seed = 3, startS = 0, ai = true, aiTracks = null, plan = null } = {}) {
    this.plan = plan; this.track = track; this.hazards = hazards; this.rng = mulberry(seed);
    this.ai = []; this.dyn = []; this.obst = []; this.time = 0;
    this.signals = hazards.signals.map((g, i) => Object.assign(g, { id: i, aspect: 'g', locked: false, phase: (i * 7.3) % 29, forceUntil: 0, forceAspect: null }));   // the same objects the signal heads draw
    this.player = { pts: BODY.map(() => ({ x: 0, z: 0 })), run: null };
    this.tracks = [track];
    this._p = {}; this._aiTracks = aiTracks;
    if (ai) this._spawn(route, startS);
  }
  _spawn(route, startS) {
    const T = this.track, L = T.length;
    let id = 1;
    // lead tram ahead of the player on the same track and a follower behind it: both run the reference timetable of the player's line (offset 140 s / -120 s)
    const plan = this.plan;
    if (plan && plan.traj && plan.traj.length > 10) {
      const sc = (offset) => ({ traj: plan.traj, dt: plan.trajDt, offset, nose: TRAM.nose, s0: plan.stops[0].s });
      this.ai.push(new AiTram(id++, T, { start: plan.stops[0].s + TRAM.nose, pace: 1, rng: this.rng, label: 'lead', script: sc(140) }));
      this.ai.push(new AiTram(id++, T, { start: plan.stops[0].s + TRAM.nose, pace: 1, rng: this.rng, label: 'follow', script: sc(-120) }));
    }
    // oncoming / crossing trams on the other track(s) of the network
    (route.ai || []).forEach((a, ai) => {
      const tr = this._aiTracks ? this._aiTracks[ai] : buildTrack({ path: a.path, stops: a.stops, switches: [] }); this.tracks.push(tr);
      if (tr.length < 400) return;
      this.ai.push(new AiTram(id++, tr, { start: Math.min(tr.length - 150, tr.length * 0.25), pace: 0.92, rng: this.rng, label: 'oncoming' }));
      this.ai.push(new AiTram(id++, tr, { start: Math.min(tr.length - 150, tr.length * 0.7), pace: 0.9, rng: this.rng, label: 'oncoming' }));
    });
  }
  setPlayer(run) { this.player.run = run; this.player.track = this.track; }
  /** world position of the player's body samples (for the AI) */
  _playerPts() { const r = this.player.run; if (!r) return; const T = this.track; for (let k = 0; k < BODY.length; k++) { T.at(r.s + TRAM.nose - BODY[k], this._p); this.player.pts[k].x = this._p.x; this.player.pts[k].z = this._p.z; } }
  /** nearest thing ahead of an AI tram along its own track (distance from its nose), among higher-priority trams, the player and nothing else */
  _gapFor(ai) {
    const T = ai.track; let best = Infinity;
    const test = (pts) => { for (const q of pts) { const pr = T.project(q.x, q.z, 2.45); if (!pr) continue; const d = pr.s - ai.s; if (d > -0.5 && d < best) best = Math.max(0, d); } };
    if (this.player.run) test(this.player.pts);
    for (const o of this.ai) if (o !== ai && o.active && o.visible !== false && o.prio < ai.prio) test(o.pts);
    return best;
  }
  /** per frame: move the AI trams, refresh the obstruction list of the player's track, signal aspects */
  update(dt) {
    this.time += dt;
    this._playerPts();
    const clock = this.player.run && this.player.run.started ? this.player.run.time : 0;
    for (const a of this.ai) { a.step(dt, this._gapFor(a), clock); if (a.heldFor > 45 && !a.script) { a.active = false; a.v = 0; a.heldFor = 0; a._off = 0; a.label === 'oncoming' || (a.label = 'oncoming'); } }   // an AI tram that waited 45 s is taken out of service (respawns later)
    // an AI tram that has finished its track is respawned at the start after a pause (the oncoming ones; not the lead / follower)
    for (const a of this.ai) if (!a.active && a.label === 'oncoming') { a._off = (a._off || 0) + dt; if (a._off > 25 + a.id * 7 && (a.track !== this.track || (this.player.run && this.player.run.noseS > 120 && this.player.run.noseS < a.track.length - 60))) { a._off = 0; a.s = 0; a.v = 0; a.nextStop = 0; a.state = 'run'; a.active = true; a.refreshPts(); } }
    const T = this.track, obst = this.obst; obst.length = 0;
    for (const a of this.ai) if (a.active && a.visible !== false) for (const q of a.pts) { const pr = T.project(q.x, q.z, 1.7); if (pr) obst.push({ s: pr.s, kind: 'tram', ai: a }); }   // 1.7 m (< the AI's own 2.45 m): an AI that gave way never blocks the player back
    for (const h of this.dyn) { const pr = T.project(h.x, h.z, h.r || 1.8); if (pr) obst.push({ s: pr.s, kind: h.kind, h }); }
    this._signals();
  }
  _signals() {
    const run = this.player.run, T = this.track, nose = run ? run.noseS : 0, v = run ? run.v : 0;
    const trams = this.obst.filter((o) => o.kind === 'tram');
    const BLOCK = 270;
    for (const g of this.signals) {
      if (g.forceUntil > this.time) { g.aspect = g.forceAspect || 'r'; continue; }   // test hook: net.force(sig, 'r', seconds)
      if (run && g.s < nose - 3) { g.locked = false; if (g.kind === 'block') g.aspect = trams.some((o) => o.s > g.s && o.s < g.s + BLOCK) ? 'r' : 'g'; continue; }
      const dist = g.s - nose, brake = v * v / (2 * 0.75) + 10;   // a signal that would turn red inside the comfortable braking distance keeps its aspect for this tram
      if (g.locked && dist < brake + 10 && g.aspect !== 'r') continue;   // too close to stop: the aspect it had stays until passed
      let asp = 'g';
      if (g.kind === 'block') {
        if (trams.some((o) => o.s > g.s && o.s < g.s + BLOCK)) asp = 'r';
        else if (trams.some((o) => o.s >= g.s + BLOCK && o.s < g.s + 2 * BLOCK)) asp = 'y';
      } else {   // road signal: green 17 s, yellow 2.5 s, red 9 s; the first 14 s of a run are green
        const c = (this.time + g.phase) % 28.5;
        asp = this.time < 14 ? 'g' : c < 17 ? 'g' : c < 19.5 ? 'y' : 'r';
      }
      if (asp === 'r' && g.aspect !== 'r' && dist < brake) { asp = g.aspect; g.locked = true; }   // turns red when the tram cannot stop any more: it keeps its aspect for this tram
      g.aspect = asp;
    }
  }
  force(sig, aspect, seconds) { sig.forceAspect = aspect; sig.forceUntil = this.time + seconds; }
  /** nearest obstruction ahead of the player's nose: { d, kind } (d metres from the nose to the object) or null */
  scan(noseS, maxD = 90) {
    let best = null;
    for (const o of this.obst) { const d = o.s - noseS; if (d > -1 && d < maxD && (!best || d < best.d)) best = { d: Math.max(0, d), kind: o.kind }; }
    return best;
  }
  /** nearest tram (any) within r metres of (x, z) -- used by the street life to decide whether a crossing is about to be used */
  tramNear(x, z, r) {
    const r2 = r * r;
    for (const a of this.ai) if (a.active && a.visible !== false && (a.x - x) ** 2 + (a.z - z) ** 2 < r2) return true;
    const p = this.player.pts[0]; return !!this.player.run && (p.x - x) ** 2 + (p.z - z) ** 2 < r2;
  }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
