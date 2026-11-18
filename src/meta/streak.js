// Daily streak: pure rules (no DOM, no storage), so scripts/smoke-meta.mjs can unit-test them in Node with any clock.
// A "day" is a Riga calendar day string (rules.js `rigaDay`). A day counts when an ELIGIBLE round ENDS on it.
//   * same day again            -> nothing changes (one increment per day)
//   * yesterday was the last    -> streak + 1
//   * exactly one day missed    -> a streak freeze (if held) covers it and is spent; otherwise the streak restarts at 1
//   * two or more days missed   -> restarts at 1 (a freeze covers a SINGLE missed day only)
//   * day < last (device clock moved back) -> ignored: no extra day, streak untouched; when the clock comes forward again
//     (same real day or later) the counting simply continues from `last`, so a back-and-forth jump destroys nothing.
// A freeze is earned each time the streak reaches a multiple of 7 (at most 2 held). Nothing else punishes a missed day.
import { shiftDay } from '../rules.js';

export const MILESTONES = [3, 7, 14, 30, 60, 100];
export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;
export const blankStreak = () => ({ cur: 0, best: 0, last: '', freezes: 0, frozen: [] });
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** Record an eligible round that ended on `day`. Mutates `s`. Returns what happened. */
export function applyDay(s, day) {
  const r = { changed: false, extended: false, reset: false, froze: false, freezeEarned: false, milestone: null, ignored: null, cur: s.cur };
  if (!s.last) { s.cur = 1; r.extended = true; }
  else {
    const d = dayDiff(s.last, day);
    if (d < 0) { r.ignored = 'back'; return r; }
    if (d === 0) { r.ignored = 'same'; return r; }
    if (d === 1) { s.cur += 1; r.extended = true; }
    else if (d === 2 && s.freezes > 0) { s.freezes -= 1; s.frozen = [...(s.frozen || []), shiftDay(s.last, 1)].slice(-14); s.cur += 1; r.extended = true; r.froze = true; }
    else { s.cur = 1; r.reset = true; r.extended = true; }
  }
  s.last = day; r.changed = true;
  if (s.cur > s.best) s.best = s.cur;
  if (s.cur % FREEZE_EVERY === 0 && s.freezes < MAX_FREEZES) { s.freezes += 1; r.freezeEarned = true; }
  if (MILESTONES.includes(s.cur) && !r.reset) r.milestone = s.cur;
  r.cur = s.cur;
  return r;
}

/** What the UI shows on `today`: { cur, best, freezes, doneToday, alive }. A streak that nothing can save any more shows 0. */
export function viewStreak(s, today) {
  const v = { cur: 0, best: s.best || 0, freezes: s.freezes || 0, doneToday: false, alive: false, last: s.last || '' };
  if (!s.last) return v;
  const d = dayDiff(s.last, today);
  v.doneToday = d <= 0;                      // d < 0: the clock is behind the last counted day; that day is "today" enough
  if (d <= 1 || (d === 2 && s.freezes > 0)) { v.cur = s.cur; v.alive = true; }
  return v;
}

/** Latvian plural of "diena". */
export const lvDays = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'diena' : 'dienas');
