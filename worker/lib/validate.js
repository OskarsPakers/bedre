// Plausibility model for client-submitted scores. Pure (no Cloudflare APIs) so it can be unit-tested and run offline
// over simulated rounds (tools/check-legit.mjs). The browser is untrusted: this is friction + plausibility, not proof.
//
// A submission carries a compact progress trace (see src/trace.js):
//   trace = { v:1, t:[playSeconds...], s:[score...], r:[radius...], e:[eaten...], k:[kills...], kinds:{kind:count}, kills, deaths }
// sampled every 10 s of played time (t[i] ~= 10*(i+1)), last sample = final values.
//
// Verdicts: 'ok' | 'suspect' (stored, hidden from public boards) | 'reject' (422, nothing stored).
// Thresholds come from worker/lib/limits.js: the maxima observed in many greedy-autoplayer rounds
// (tools/gen-limits.mjs), multiplied by SOFT (suspect) and HARD (reject) safety factors.
import { MODES, TRACE_STEP, TRACE_MAX, radiusForMode } from '../../src/rules.js';
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
