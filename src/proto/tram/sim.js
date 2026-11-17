// Tram physics + timetable + scoring. Pure (no DOM / THREE): the page drives it with a lever value, scripts drive it with autopilots.
//   s = arc length of the FIRST DOOR along the track (the stop marker is where this door should come to rest); the nose is NOSE m ahead of it.
import { SPEED, idealProfile } from './track.js';

export const TRAM = { nose: 3.4, length: 24.9, doors: [0, -4.8, -13.0, -17.8] };   // metres relative to the first door (forward positive)
export const PHYS = {
  vmax: SPEED.max, acc: 1.0, brake: 1.2, emergency: 2.5, drag: 0.03, tau: 0.28,    // m/s, m/s^2 (service brake 1.2, emergency 2.5), traction / brake response lag (s)
  rateUp: 1.5, rateDown: 2.2, rateBrake: 1.9,                                        // keyboard lever ramp speeds (per second)
};
export const ZONE = { behind: -26, ahead: 10 };    // door-to-marker error window in which the doors may open: -26 m (short) .. +10 m (overshoot)
export const SCORE = { acc: 40, time: 30, smooth: 20, speed: 10 };
export const DWELL = 11;                              // timetable standing time per stop, s
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** the stops of a run (indices into track.stops) with the timetable: due[i] = arrival time (s after the start) */
export function makeRun(track, from, to, { seed = 7 } = {}) {
  const rng = mulberry(seed);
  const stops = [];
  let tdep = 0;
  for (let i = from; i <= to; i++) {
    const st = track.stops[i];
    let due = 0, leg = 0;
    if (i > from) { leg = idealProfile(track, track.stops[i - 1].s, st.s).time; due = tdep + leg * 1.12 + 3; }
    const last = i === to;
    stops.push({ idx: i, name: st.name, s: st.s, first: i === from, last, due, leg, dwell: last ? 5 : DWELL, alight: last ? 99 : 2 + Math.floor(rng() * 4), board: last ? 0 : 3 + Math.floor(rng() * 5), waitingAt: 3 + Math.floor(rng() * 5) });
    tdep = due + (last ? 0 : DWELL);
  }
  const dist = stops[stops.length - 1].s - stops[0].s;
  return { stops, from, to, ttDuration: stops[stops.length - 1].due, avgKmh: (3.6 * dist) / stops[stops.length - 1].due };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function accuracyPoints(d) { const a = Math.abs(d); return a <= 0.5 ? [SCORE.acc, 'perfect'] : a <= 2 ? [32, 'good'] : a <= 5 ? [22, 'fair'] : a <= 10 ? [12, 'poor'] : [5, 'poor']; }
export function timePoints(e) { // e = arrival - due (s): + late, - early
  if (e > 8) return Math.max(0, SCORE.time - (e - 8) * 0.5);
  if (e < -8) return Math.max(0, SCORE.time - (-e - 8) * 0.75);
  return SCORE.time;
}

export class Run {
  constructor(track, plan, { startS } = {}) {
    this.track = track; this.plan = plan; this.stops = plan.stops;
    this.s = startS ?? plan.stops[0].s; this.v = 0; this.a = 0;
    this.lever = 0; this.leverTarget = 0; this.emergency = false;
    this.t = 0; this.time = 0;                      // time = run clock (starts at the first movement / press of power)
    this.started = false;
    this.next = 1;                                  // index into stops of the next stop to serve (0 = start stop, already "served")
    this.door = 0; this.doorState = 'closed';       // door: 0 closed .. 1 open; state closed|opening|open|closing
    this.doorWish = false;                          // player pressed the button
    this.pax = 14;
    this.dwell = null;                              // { stopIdx, t, need, alight, board, done }
    this.results = [];                              // per stop result objects
    this.finished = false;
    this.events = [];                               // fire-and-forget UI events {type, ...}
    this._leg = this._newLeg();
    this._lastA = 0; this._standT = 0; this._jerkF = 0;
    this.limit = track.limit(this.s);
    this.stats = { overspeedS: 0, curveOverS: 0, ebrakes: 0, maxV: 0 };
    this.pendingOpen = false;
  }
  _newLeg() { return { jerkPen: 0, hardPen: 0, curvePen: 0, overInt: 0, overS: 0, emergencyUsed: false, maxJ: 0, hard: 0 }; }

  get stop() { return this.stops[this.next] || null; }
  /** metres from the first door to the next stop marker (positive = marker still ahead) */
  get distToStop() { const st = this.stop; return st ? st.s - this.s : 0; }
  /** the due time of the next stop minus the run clock (s) */
  get dueIn() { const st = this.stop; return st ? st.due - this.time : 0; }
  get doorsClosed() { return this.doorState === 'closed'; }
  get inZone() { const st = this.stop; if (!st) return false; const d = this.s - st.s; return d >= ZONE.behind && d <= ZONE.ahead; }

  /** input: lever target -1..1 (positive power), emergency bool, doorBtn (true once per press) */
  setLever(x, immediate = false) { this.leverTarget = clamp(x, -1, 1); if (immediate) this.lever = this.leverTarget; }
  pressDoors() { this.doorWish = true; }

  step(dt) {
    if (this.finished) return;
    const P = PHYS, T = this.track;
    this.t += dt;
    // ---- lever (rate limited so a jab is still a smooth push) ---------------------------------------------------------------------------
    const tgt = this.emergency ? -1 : this.leverTarget;
    const rate = tgt > this.lever ? (this.lever < 0 ? P.rateBrake : P.rateUp) : (tgt >= 0 ? P.rateDown : P.rateBrake);
    this.lever += clamp(tgt - this.lever, -rate * dt, rate * dt);
    if (this.emergency) this.lever = -1;
    // ---- longitudinal dynamics ------------------------------------------------------------------------------------------------------------
    const doorsLocked = this.doorState !== 'closed' || this.pendingOpen;
    let cmd; // commanded acceleration (m/s^2)
    if (this.emergency) cmd = -P.emergency;
    else if (doorsLocked) cmd = -P.brake;                       // traction interlock: doors open -> brakes held
    else if (this.lever >= 0) cmd = this.lever * P.acc * clamp((P.vmax - this.v) / 3, 0, 1);
    else cmd = this.lever * P.brake;
    const drag = P.drag + 0.0004 * this.v * this.v;
    let a = this.a + (cmd - this.a) * (1 - Math.exp(-dt / P.tau));
    let acc = a - (this.v > 0.02 ? drag : 0);
    let v = this.v + acc * dt;
    if (v <= 0 && acc <= 0) { v = 0; if (this.a < 0 && this.v > 0) this._stopJolt = -this.a; a = 0; acc = 0; } // came to rest: the brake effort that was applied is the jolt
    if (v > P.vmax) v = P.vmax;
    const prevV = this.v;
    this.v = v; this.a = a;
    const aEff = (v - prevV) / dt;
    this.s += (prevV + v) / 2 * dt;
    if (!this.started && (this.v > 0.05)) this.started = true;
    if (this.started) this.time += dt;
    if (this.v > this.stats.maxV) this.stats.maxV = this.v;
    // ---- comfort / speed accumulators (per leg) -------------------------------------------------------------------------------------------
    const L = this._leg, pax = this.pax > 0 ? 1 : 0.35;
    const jerk = (aEff - this._lastA) / dt; this._lastA = aEff;
    this._jerkF += (Math.abs(jerk) - this._jerkF) * Math.min(1, dt / 0.15);
    if (this.v > 0.5) {
      if (this._jerkF > 1.9) L.jerkPen += (this._jerkF - 1.9) * dt * 2.2 * pax;
      if (-aEff > 1.55 && !this.emergency) L.hardPen += (-aEff - 1.55) * dt * 6 * pax;
      L.maxJ = Math.max(L.maxJ, this._jerkF);
    }
    if (this.emergency && this.v > 0.5) { L.hardPen += dt * 7 * pax; L.emergencyUsed = true; }
    this.limit = T.limit(this.s);
    const k = Math.abs(T.curvature(this.s)), aLat = this.v * this.v * k;
    this.latAccel = aLat;
    const ex = this.v - this.limit;
    this.overspeed = ex > 0.7;
    if (this.overspeed) { L.overInt += (ex - 0.7) * dt; L.overS += dt; this.stats.overspeedS += dt; }
    if (aLat > 1.45 && this.v > 3) { L.curvePen += (aLat - 1.45) * dt * 5 * pax; this.stats.curveOverS += dt; this.curveOver = true; } else this.curveOver = false;
    // ---- doors ---------------------------------------------------------------------------------------------------------------------------
    this._doors(dt);
    // ---- stops -----------------------------------------------------------------------------------------------------------------------------
    this._stopLogic(dt);
  }

  _doors(dt) {
    const standing = this.v < 0.03;
    if (this.doorState === 'closed') {
      if (this.pendingOpen && standing) {   // served a stop: the doors open when the player presses Durvis, or by themselves after 0.8 s of standing
        this._standT += dt;
        if (this.doorWish || this._standT > 0.8) { this.pendingOpen = false; this.doorState = 'opening'; this._standT = 0; this.events.push({ type: 'doorsOpening' }); }
      } else if (this.doorWish) this.events.push({ type: 'doorsDenied' });
    } else if (this.doorState === 'opening') {
      this.door = Math.min(1, this.door + dt / 1.1); if (this.door >= 1) { this.doorState = 'open'; if (this.dwell) this.dwell.t = 0; }
    } else if (this.doorState === 'open') {
      if (this.dwell) {
        this.dwell.t += dt;
        if (!this.dwell.done && this.dwell.t >= this.dwell.need) { this.dwell.done = true; this.pax = this.dwell.paxAfter; this.events.push({ type: 'boarded', pax: this.pax }); }
        if (this.dwell.done && (this.doorWish || this.dwell.t >= this.dwell.need + 1.5)) { this.doorState = 'closing'; this.events.push({ type: 'doorsClosing' }); }
      } else if (this.doorWish) this.doorState = 'closing';
    } else if (this.doorState === 'closing') {
      this.door = Math.max(0, this.door - dt / 1.1);
      if (this.door <= 0) {
        this.doorState = 'closed'; this.dwell = null; this.events.push({ type: 'doorsClosed' });
        if (this.finishAfterDoors) { this.finished = true; this.events.push({ type: 'finished' }); }
      }
    }
    this.doorWish = false;
  }

  _stopLogic(dt) {
    const st = this.stop;
    if (!st) return;
    const d = this.s - st.s;            // door error: negative short, positive over
    // arrival: standing in the zone
    if (this.v < 0.03 && d >= ZONE.behind && d <= ZONE.ahead && !this._arrived) {
      this._arrived = true;
      this._serve(st, d);
    }
    // missed: first door passed the end of the zone without having stopped
    if (!this._arrived && d > ZONE.ahead) this._miss(st);
    if (this._arrived && this.v > 0.5) this._arrived = false;   // (cannot happen after serving: `next` moved on)
  }

  _serve(st, d) {
    const L = this._leg;
    const [accP, accTxt] = accuracyPoints(d);
    const timeErr = this.time - st.due;
    const timeP = st.first ? SCORE.time : timePoints(timeErr);
    let jolt = this._stopJolt || 0;   // brake still applied when the tram came to rest: a jerk the passengers feel
    const joltPen = this.pax > 0 ? clamp((jolt - 0.28) * 7, 0, 6) : 0;
    const smooth = clamp(SCORE.smooth - L.jerkPen - L.hardPen - L.curvePen - joltPen, 0, SCORE.smooth);
    const speedP = clamp(SCORE.speed - L.overInt * 1.4, 0, SCORE.speed);
    const total = Math.round(accP + timeP + smooth + speedP);
    const res = { idx: st.idx, name: st.name, missed: false, d, accP, accTxt, timeErr, timeP: Math.round(timeP), smooth: Math.round(smooth), speedP: Math.round(speedP), total, arrival: this.time, due: st.due, emergency: L.emergencyUsed, curveOverS: +this.stats.curveOverS.toFixed(1), jolt: +jolt.toFixed(2) };
    this.results.push(res);
    this.events.push({ type: 'served', res });
    this._leg = this._newLeg(); this._stopJolt = 0;
    // doors: boarding plan
    const pax = this.pax;
    const alight = Math.min(pax, st.alight), board = st.board;
    this.dwell = { stopIdx: st.idx, t: 0, need: 2.6 + 0.5 * (alight + board) * 0.6 + (st.last ? 0 : 0.5), alight, board, done: false, paxAfter: pax - alight + board };
    this.servedStop = st; this.pendingOpen = true; this._standT = 0;
    this.next++;
    if (this.next >= this.stops.length) this.finishAfterDoors = true;
  }

  _miss(st) {
    this.results.push({ idx: st.idx, name: st.name, missed: true, d: this.s - st.s, accP: 0, timeP: 0, smooth: 0, speedP: 0, total: 0, timeErr: this.time - st.due });
    this.events.push({ type: 'missed', name: st.name });
    this._leg = this._newLeg();
    this.next++;
    if (this.next >= this.stops.length) { this.finished = true; this.events.push({ type: 'finished' }); }
  }

  summary() {
    const n = this.results.length || 1, pts = this.results.reduce((a, r) => a + r.total, 0), missed = this.results.filter((r) => r.missed).length;
    const ratio = pts / (100 * Math.max(1, this.stops.length - 1));
    let stars = ratio >= 0.85 ? 3 : ratio >= 0.6 ? 2 : 1;
    if (missed && stars > 2) stars = 2;
    return { points: pts, max: 100 * (this.stops.length - 1), stars, missed, ratio, time: this.time, stats: this.stats };
  }
}

// ---- autopilots (test hooks; also what the smoke test's "perfect" / "reckless" drivers use) -------------------------------------------
/** Follows the limit profile, brakes comfortably onto the marker and paces itself to arrive when the timetable says. Returns { lever, doors }. */
export function perfectDriver(run, ctx = {}) {
  const T = run.track, st = run.stop;
  if (!st) return { lever: 0, doors: false };
  if (run.doorState !== 'closed' || run.pendingOpen) return { lever: 0, doors: !!run.pendingOpen || !!(run.dwell && run.dwell.done) };
  const s0 = run.s, d = st.s - s0;
  // target speed: the ideal (limit + brake) profile towards this stop, paced to the timetable
  const sPrev = run.stops[run.next - 1].s;
  const prof = ctx.prof && ctx.prof.stop === st ? ctx.prof : (ctx.prof = { stop: st, ...idealProfile(T, sPrev, st.s, 0.9, 0.85) });
  const i = Math.min(prof.v.length - 1, Math.max(0, Math.floor((s0 - prof.i0 * T.ds) / T.ds) + 4));
  let vt = prof.v[i];
  const remainT = prof.time * (d / Math.max(1, st.s - sPrev));  // (rough) time left at ideal pace
  const f = clamp(remainT / Math.max(2, st.due - run.time - 14), 0.55, 1);
  // pacing only while far from the stop (the last metres are about accuracy)
  vt = d > 60 ? vt * f : vt;
  if (d < 14) { const a = 0.36 + 0.5 * clamp((d - 1) / 12, 0, 1); vt = Math.min(vt, Math.sqrt(2 * a * Math.max(0, d))); }
  if (d < 0.2) vt = 0;
  // behind schedule at the standstill? creep the last metres without waiting
  const dv = vt - run.v;
  let lever;
  if (dv > 0.1) lever = clamp(dv * 0.7, 0, 1);
  else if (dv < -0.1) lever = clamp(dv * 1.1, -1, 0);
  else lever = 0;
  if (d < 6 && run.v < 0.12 && d > 0.15) lever = Math.max(lever, 0.12);
  if (d < 0.5 && d > -0.3) lever = run.v > 0.04 ? -0.5 : -1;
  if (d < -0.3) lever = -1;
  return { lever, doors: false };
}
/** Full power, ignores the limits and curves, brakes at the last moment with the emergency brake. */
export function recklessDriver(run) {
  const st = run.stop;
  if (!st) return { lever: 0, doors: false, emergency: false };
  if (run.doorState !== 'closed' || run.pendingOpen) return { lever: 0, doors: !!run.pendingOpen || !!(run.dwell && run.dwell.done), emergency: false };
  const d = st.s - run.s, brakeD = (run.v * run.v) / (2 * 2.5);
  if (d < brakeD && d > -6) return { lever: -1, doors: false, emergency: true };
  return { lever: 1, doors: false, emergency: false };
}
