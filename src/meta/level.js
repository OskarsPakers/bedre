// Player level + XP (PURE maths, no DOM / storage: unit-tested by scripts/test-f45.mjs). Cosmetic progression only: a level never changes
// scoring, size, speed or hitboxes. XP comes from every ELIGIBLE finished round (same rule as the daily streak: not free roam, no debug hook,
// at least min(60 s, half the round) played) - the caller checks eligibility, `roundXp` itself refuses a round that is flagged ineligible.
//
// Curve: XP needed to go from level L to L+1 = 100 + 40 (L-1) + 6 (L-1)^2  ->  level 10 at 3,564 XP, level 30 at 65,424 XP.
// A typical 5-minute round pays ~110-170 XP, so level 10 is ~25 rounds (2-3 hours with menus) and level 30 ~450 rounds (the long run).
export const MAX_LEVEL = 60;
export const xpToNext = (L) => Math.round(100 + 40 * (L - 1) + 6 * (L - 1) * (L - 1));
/** Total XP at which level L starts (level 1 = 0). */
export const xpAt = (L) => { let s = 0; for (let i = 1; i < Math.min(L, MAX_LEVEL); i++) s += xpToNext(i); return s; };

/** {level, into, need, frac, xp, max} for a total XP. */
export function levelOf(xp) {
  xp = Math.max(0, Math.floor(+xp || 0));
  let L = 1, left = xp;
  while (L < MAX_LEVEL && left >= xpToNext(L)) { left -= xpToNext(L); L++; }
  const max = L >= MAX_LEVEL;
  const need = max ? 1 : xpToNext(L);
  return { level: L, into: max ? 1 : left, need, frac: max ? 1 : left / need, xp, max };
}

export const XP = {
  base: { classic: 80, quick: 50, daily: 90, online: 100 },
  place: [40, 25, 15],            // 1st / 2nd / 3rd (needs at least 3 holes in the round)
  scoreK: 14, scoreDiv: 1500, scoreCap: 120,   // log-scaled share of the points: 14 x log2(1 + score / 1500), at most 120
  goal: { easy: 60, medium: 100, hard: 160, all: 200 },   // per weekly goal completed (reward id week-YYYY-WW-tier)
  streakBase: 15, streakPer: 5, streakCap: 12,            // first eligible round of a day: 15 + 5 x min(streak, 12)
  min: 20,
};

/**
 * XP for one finished round. info = { eligible, mode: classic|quick|daily|online|free, rank, total, score, rewards: [reward ids granted by this round], streak: new streak length when the round extended it (else 0) }
 * Returns { total, base, place, score, goals, streak } (all 0 when not eligible: free roam and debug rounds give nothing).
 */
export function roundXp(info) {
  const z = { total: 0, base: 0, place: 0, score: 0, goals: 0, streak: 0 };
  if (!info || !info.eligible || info.mode === 'free' || !(info.mode in XP.base)) return z;
  const base = XP.base[info.mode];
  const place = info.total >= 3 && info.rank >= 1 && info.rank <= 3 ? XP.place[info.rank - 1] : 0;
  const score = Math.min(XP.scoreCap, Math.round(XP.scoreK * Math.log2(1 + Math.max(0, +info.score || 0) / XP.scoreDiv)));
  let goals = 0;
  for (const id of info.rewards || []) { const m = /^week-\d{4}-\d{2}-(easy|medium|hard|all)$/.exec(id); if (m) goals += XP.goal[m[1]]; }
  const streak = info.streak > 0 ? XP.streakBase + XP.streakPer * Math.min(XP.streakCap, info.streak) : 0;
  const total = Math.max(XP.min, base + place + score) + goals + streak;
  return { total, base, place, score, goals, streak };
}
