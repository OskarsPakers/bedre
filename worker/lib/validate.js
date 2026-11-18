// Plausibility model for client-submitted scores. Pure (no Cloudflare APIs) so it can be unit-tested and run offline
// over simulated rounds (tools/check-legit.mjs). The browser is untrusted: this is friction + plausibility, not proof.
//
// A submission carries a compact progress trace (see src/trace.js):
//   v1 (rules 1, pre-combo; only stale clients still send it): { v:1, t, s, r, e, k, kinds, kills, deaths }
//   v2 (rules 2, combos + power-ups): v1 plus m (growth mass), w (raw value swallowed), p (multiplied swallow points), c (best combo so far),
//      u:{magnet,speed,double,shield} (cumulative pickups); radius follows `m`, not the multiplied score. validateV2() checks the consistency:
//      points <= raw x best achievable multiplier, combo <= eaten x max weight, pickups <= what the spawn schedule allows, mass <= raw ...
// sampled every 10 s of played time (t[i] ~= 10*(i+1)), last sample = final values.
//
// Verdicts: 'ok' | 'suspect' (stored, hidden from public boards) | 'reject' (422, nothing stored).
// Thresholds come from worker/lib/limits.js: the maxima observed in many greedy-autoplayer rounds
// (tools/gen-limits.mjs), multiplied by SOFT (suspect) and HARD (reject) safety factors.
import { MODES, TRACE_STEP, TRACE_MAX, radiusForMode } from '../../src/rules.js';
import { COMBO, multFor, totalMult } from '../../src/combo.js';
import { PU, PU_TYPES, puCountFor, maxPickups } from '../../src/powerups.js';
import { mapBySlug } from '../../tools/maps.mjs';
import { LIMITS, limitsFor } from './limits.js';

export const SOFT = 2;   // beyond empirical max x2: hidden from boards
export const HARD = 3;   // beyond empirical max x3: rejected

const KIND_RE = /^[a-z][a-z0-9_]{1,23}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function bandOf(radius) {
  const b = LIMITS.bands;
  let i = 0;
  while (i < b.length - 1 && radius >= b[i + 1]) i++;
  return i;
}

/** Number of samples a trace for a final play time `tf` must have. */
export const expectedSamples = (tf) => Math.floor((tf - 0.3) / TRACE_STEP) + 1;

/**
 * @param {object} p { mode, map, seconds, age, score, eaten, radius, rank, trace }
 *   seconds = server round length, age = seconds since the round was issued
 * @returns {{verdict:'ok'|'suspect'|'reject', reasons:string[]}}
 */
export function validateSubmission(p) {
  const hard = [], soft = [];
  const out = () => ({ verdict: hard.length ? 'reject' : soft.length ? 'suspect' : 'ok', reasons: [...hard, ...soft] });
  const m = MODES[p.mode];
  const ML = limitsFor(p.map || 'centrs');   // per-map empirical ceilings (tools/gen-limits.mjs)
  const L = ML.modes[p.mode];
  if (!m || !L) return { verdict: 'reject', reasons: ['mode'] };
  const tr = p.trace;
  if (!tr || typeof tr !== 'object') return { verdict: 'reject', reasons: ['trace_missing'] };
  if (tr.v === 2) return validateV2(p, m, ML, L, hard, soft, out);

  // ---- format
  const arrs = ['t', 's', 'r', 'e', 'k'];
  if (tr.v !== 1 || !arrs.every((a) => Array.isArray(tr[a]) && tr[a].every(isNum))) return { verdict: 'reject', reasons: ['trace_format'] };
  const n = tr.t.length;
  if (n < 1 || n > TRACE_MAX || !arrs.every((a) => tr[a].length === n)) return { verdict: 'reject', reasons: ['trace_format'] };
  const kinds = tr.kinds && typeof tr.kinds === 'object' && !Array.isArray(tr.kinds) ? tr.kinds : null;
  if (!kinds || Object.keys(kinds).length > 48) return { verdict: 'reject', reasons: ['trace_format'] };
  let kindTotal = 0;
  for (const [k, v] of Object.entries(kinds)) {
    if (!KIND_RE.test(k) || !Number.isInteger(v) || v < 0 || v > 1e6) return { verdict: 'reject', reasons: ['trace_format'] };
    kindTotal += v;
  }
  const tf = tr.t[n - 1];
  const sF = tr.s[n - 1], eF = tr.e[n - 1], kF = tr.k[n - 1];

  // ---- time axis: samples sit on 10 s slots, the last one is the final state
  if (n !== expectedSamples(tf)) hard.push('time_slots');
  for (let i = 0; i < n; i++) {
    if (!(tr.s[i] >= 0) || !(tr.e[i] >= 0) || !(tr.k[i] >= 0) || !(tr.r[i] >= 0)) hard.push('negative');
    if (i > 0 && (tr.t[i] <= tr.t[i - 1] || tr.e[i] < tr.e[i - 1] || tr.k[i] < tr.k[i - 1])) hard.push('monotonic');
    if (i < n - 1 && !(tr.t[i] >= TRACE_STEP * (i + 1) - 0.01 && tr.t[i] <= TRACE_STEP * (i + 1) + 1.0)) hard.push('time_slots');
  }
  if (n > 1 && tf - tr.t[n - 2] > TRACE_STEP + 1.5) hard.push('time_slots');
  if (m.seconds > 0) {
    if (tf < p.seconds - 2.5 || tf > p.seconds + 3) hard.push('time_total');
  }
  if (tf > p.age + 15) hard.push('time_vs_age');   // cannot have played more than has elapsed since the round began
  if (hard.length) return out();

  // ---- the submitted fields agree with the final sample
  if (Math.abs(sF - p.score) > 1.01 || Math.abs(eF - p.eaten) > 0) hard.push('final_mismatch');
  if (kindTotal !== eF) hard.push('kinds_sum');
  if (!Number.isInteger(tr.kills) || tr.kills !== kF || !Number.isInteger(tr.deaths) || tr.deaths < 0) hard.push('kills_format');
  if (kF > L.maxKills * 2 + 5) hard.push('kills_range');
  if (p.rank !== null && p.rank !== undefined && (p.rank < 1 || p.rank > m.holes)) hard.push('rank_range');
  if (hard.length) return out();

  // ---- score ceiling of the mode
  if (sF > L.cap * HARD) hard.push('cap_hard');
  else if (sF > L.cap * SOFT) soft.push('cap_soft');

  // ---- per-interval gain ceilings (by radius band at the interval start) + eaten counts
  let prevS = 0, prevE = 0, prevK = 0, prevT = 0;
  for (let i = 0; i < n; i++) {
    const dt = tr.t[i] - prevT;
    const stretch = Math.max(1, dt / TRACE_STEP);
    const band = bandOf(radiusForMode(prevS, p.mode));
    const dK = tr.k[i] - prevK;
    const base = L.gain[band] * stretch + dK * L.killMax;
    const gain = tr.s[i] - prevS;
    if (gain > base * HARD) { hard.push('gain_hard'); break; }
    if (gain > base * SOFT && !soft.includes('gain_soft')) soft.push('gain_soft');
    const dE = tr.e[i] - prevE;
    if (dE > (L.eaten10 * stretch) * HARD + 25) { hard.push('eaten_rate'); break; }
    if (dE > (L.eaten10 * stretch) * SOFT + 25 && !soft.includes('eaten_soft')) soft.push('eaten_soft');
    // trace radius must follow the shared growth formula (tolerates rounding)
    const want = radiusForMode(tr.s[i], p.mode);
    if (Math.abs(tr.r[i] - want) > want * 0.03 + 0.05 && !soft.includes('radius_formula')) soft.push('radius_formula');
    prevS = tr.s[i]; prevE = tr.e[i]; prevK = tr.k[i]; prevT = tr.t[i];
  }
  if (hard.length) return out();

  // ---- totals vs. what the eaten kinds can be worth (upper bound: dying halves the score, so no lower bound)
  let maxSum = 0;
  for (const [k, v] of Object.entries(kinds)) maxSum += v * (Object.hasOwn(ML.value, k) ? ML.value[k][1] : ML.valueOther);
  maxSum += kF * L.killMax;
  if (sF > maxSum * 3 + 100) hard.push('kind_values_hard');
  else if (sF > maxSum * 1.25 + 25) soft.push('kind_values');

  // ---- reported radius (cosmetic column) must not exceed what the score gives
  if (isNum(p.radius) && p.radius > radiusForMode(sF, p.mode) * 1.5 + 1) hard.push('radius_hard');
  else if (isNum(p.radius) && p.radius > radiusForMode(sF, p.mode) * 1.1 + 0.3) soft.push('radius_final');
  return out();
}


const U_KEYS = PU_TYPES;
const allInts = (a) => Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0 && v < 1e6);

/** Scoring rules 2 (trace v2). Same structure as the v1 checks, plus the multiplier / combo / power-up consistency checks. */
function validateV2(p, m, ML, L, hard, soft, out) {
  const tr = p.trace;
  // ---- format
  const arrs = ['t', 's', 'm', 'r', 'e', 'k', 'w', 'p', 'c'];
  if (!arrs.every((a) => Array.isArray(tr[a]) && tr[a].every(isNum))) return { verdict: 'reject', reasons: ['trace_format'] };
  const n = tr.t.length;
  if (n < 1 || n > TRACE_MAX || !arrs.every((a) => tr[a].length === n)) return { verdict: 'reject', reasons: ['trace_format'] };
  const u = tr.u;
  if (!u || typeof u !== 'object' || !U_KEYS.every((k) => allInts(u[k]) && u[k].length === n)) return { verdict: 'reject', reasons: ['trace_format'] };
  const kinds = tr.kinds && typeof tr.kinds === 'object' && !Array.isArray(tr.kinds) ? tr.kinds : null;
  if (!kinds || Object.keys(kinds).length > 48) return { verdict: 'reject', reasons: ['trace_format'] };
  let kindTotal = 0;
  for (const [k, v] of Object.entries(kinds)) {
    if (!KIND_RE.test(k) || !Number.isInteger(v) || v < 0 || v > 1e6) return { verdict: 'reject', reasons: ['trace_format'] };
    kindTotal += v;
  }
  const tf = tr.t[n - 1];
  const sF = tr.s[n - 1], eF = tr.e[n - 1], kF = tr.k[n - 1], mF = tr.m[n - 1], wF = tr.w[n - 1], pF = tr.p[n - 1];

  // ---- time axis (same as v1)
  if (n !== expectedSamples(tf)) hard.push('time_slots');
  for (let i = 0; i < n; i++) {
    if (!arrs.every((a) => tr[a][i] >= 0)) hard.push('negative');
    if (i > 0 && (tr.t[i] <= tr.t[i - 1] || tr.e[i] < tr.e[i - 1] || tr.k[i] < tr.k[i - 1] || tr.w[i] < tr.w[i - 1] - 1 || tr.p[i] < tr.p[i - 1] - 1 || tr.c[i] < tr.c[i - 1] || U_KEYS.some((k) => u[k][i] < u[k][i - 1]))) hard.push('monotonic');
    if (i < n - 1 && !(tr.t[i] >= TRACE_STEP * (i + 1) - 0.01 && tr.t[i] <= TRACE_STEP * (i + 1) + 1.0)) hard.push('time_slots');
  }
  if (n > 1 && tf - tr.t[n - 2] > TRACE_STEP + 1.5) hard.push('time_slots');
  if (m.seconds > 0 && (tf < p.seconds - 2.5 || tf > p.seconds + 3)) hard.push('time_total');
  if (tf > p.age + 15) hard.push('time_vs_age');
  if (hard.length) return out();

  // ---- the submitted fields agree with the final sample
  if (Math.abs(sF - p.score) > 1.01 || Math.abs(eF - p.eaten) > 0) hard.push('final_mismatch');
  if (kindTotal !== eF) hard.push('kinds_sum');
  if (!Number.isInteger(tr.kills) || tr.kills !== kF || !Number.isInteger(tr.deaths) || tr.deaths < 0) hard.push('kills_format');
  if (kF > L.maxKills * 2 + 5) hard.push('kills_range');
  if (p.rank !== null && p.rank !== undefined && (p.rank < 1 || p.rank > m.holes)) hard.push('rank_range');
  if (hard.length) return out();

  if (sF > L.cap * HARD) hard.push('cap_hard');
  else if (sF > L.cap * SOFT) soft.push('cap_soft');

  // ---- how many pickups the spawn schedule could have offered (slots x one per respawn period) and how much of the round a Dubultpunkti can cover
  const bounds = mapBySlug(p.map || 'centrs').bounds;
  const slots = puCountFor(bounds);
  let maxMultSeen = 1;
  let prev = { s: 0, m: 0, e: 0, k: 0, t: 0, w: 0, p: 0, pick: 0 };
  for (let i = 0; i < n; i++) {
    const dt = tr.t[i] - prev.t, stretch = Math.max(1, dt / TRACE_STEP);
    const band = bandOf(radiusForMode(prev.m, p.mode));
    const dK = tr.k[i] - prev.k;
    const base = L.gain[band] * stretch + dK * L.killMax;
    const gain = tr.s[i] - prev.s;
    if (gain > base * HARD) { hard.push('gain_hard'); break; }
    if (gain > base * SOFT && !soft.includes('gain_soft')) soft.push('gain_soft');
    const dE = tr.e[i] - prev.e;
    if (dE > (L.eaten10 * stretch) * HARD + 25) { hard.push('eaten_rate'); break; }
    if (dE > (L.eaten10 * stretch) * SOFT + 25 && !soft.includes('eaten_soft')) soft.push('eaten_soft');
    // the radius follows the growth MASS (never the multiplied points)
    const want = radiusForMode(tr.m[i], p.mode);
    if (Math.abs(tr.r[i] - want) > want * 0.03 + 0.05 && !soft.includes('radius_formula')) soft.push('radius_formula');
    // combos need swallows: the counter rises by at most COMBO.maxWeight per swallowed object
    if (tr.c[i] > COMBO.maxWeight * tr.e[i] + 1) { hard.push('combo_eaten'); break; }
    // multiplier: points earned by swallows in this interval <= raw value x (combo multiplier of the best combo so far x Dubultpunkti if one was collected in this or the previous interval)
    // (a 12 s effect picked up late in interval j still runs in j + 1 and the first seconds of j + 2: look back over the pickups of the last three intervals)
    const dbl = u.double[i] > (i >= 3 ? u.double[i - 3] : 0);
    const mult = totalMult(multFor(tr.c[i]), dbl ? PU.double.mul : 1);
    maxMultSeen = Math.max(maxMultSeen, mult);
    const dW = tr.w[i] - prev.w, dP = tr.p[i] - prev.p;
    if (dP > dW * mult * 1.02 + 3) { hard.push('points_mult'); break; }
    // points only come from swallows (dP) and duel gains (a kill in this interval, bounded by killMax); respawns only lose: an interval without a kill cannot gain more than its swallow points
    if (gain > dP + dK * L.killMax + 5) { hard.push('points_jump'); break; }
    // pickups: total so far within the schedule, and no more than one per slot per interval
    const pick = U_KEYS.reduce((a, k) => a + u[k][i], 0);
    const lim = maxPickups(slots, tr.t[i]);
    if (pick > lim) { hard.push('powerups_count'); break; }
    if (pick > lim * 0.75 && !soft.includes('powerups_many')) soft.push('powerups_many');
    if (pick - prev.pick > slots + 1) { hard.push('powerups_burst'); break; }
    prev = { s: tr.s[i], m: tr.m[i], e: tr.e[i], k: tr.k[i], t: tr.t[i], w: tr.w[i], p: tr.p[i], pick };
  }
  if (hard.length) return out();

  // ---- the totals tell the same story
  if (sF > pF + kF * L.killMax + 5) hard.push('points_mismatch');          // points = swallow points + duel gains (respawns only lose)
  if (mF > wF + kF * L.killMax + 5) hard.push('mass_mismatch');             // growth mass = raw value + duel gains
  if (mF > sF + 5) hard.push('mass_gt_points');                             // a multiplier is never below 1
  let maxSum = 0;
  for (const [k, v] of Object.entries(kinds)) maxSum += v * (Object.hasOwn(ML.value, k) ? ML.value[k][1] : ML.valueOther);
  if (wF > maxSum * 3 + 100) hard.push('kind_values_hard');
  else if (wF > maxSum * 1.25 + 25) soft.push('kind_values');
  if (hard.length) return out();

  if (isNum(p.radius) && p.radius > radiusForMode(mF, p.mode) * 1.5 + 1) hard.push('radius_hard');
  else if (isNum(p.radius) && p.radius > radiusForMode(mF, p.mode) * 1.1 + 0.3) soft.push('radius_final');
  return out();
}
