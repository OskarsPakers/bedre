// Pure game rules shared by the browser (src/config.js, src/modes.js, src/daily.js, src/trace.js) and the Worker
// (worker/lib/*). No DOM / three.js / Cloudflare imports here, so both sides bundle the SAME numbers and cannot drift.

export const START_RADIUS = 2.2;
export const GROWTH_EXP = 0.44;

/**
 * Game modes. `seconds` is the DEFAULT round length (the server's answer to POST /api/rounds is authoritative);
 * `growthK` is the growth constant of radius = r0 * (1 + score / k) ^ exp (smaller k = faster growth);
 * `holes` = most holes in a round (player + bots) for plausibility checks of the reported rank.
 * `client`: clients may submit scores for it. 'online' rows are written by the multiplayer server only.
 */
export const MODES = {
  classic: { seconds: 300, growthK: 16, bots: 7, holes: 8, client: true, ranked: true },
  quick: { seconds: 120, growthK: 6, bots: 7, holes: 8, client: true, ranked: true },
  daily: { seconds: 300, growthK: 16, bots: 7, holes: 11, client: true, ranked: true },
  free: { seconds: 0, growthK: 16, bots: 0, holes: 1, client: false, ranked: false },
  online: { seconds: 0, growthK: 16, bots: 0, holes: 16, client: false, ranked: true },
};
export const CLIENT_MODES = ['classic', 'quick', 'daily'];
export const BOARD_MODES = ['classic', 'quick', 'daily', 'online'];

export const TRACE_STEP = 10;      // seconds between progress samples
export const TRACE_MAX = 40;       // most samples a trace may hold (30 + final, with slack)

/** radius = r0 * (1 + score / k) ^ exp  -- the one growth formula of the game. */
export function radiusAt(score, k = 16, r0 = START_RADIUS, exp = GROWTH_EXP) {
  return r0 * Math.pow(1 + score / k, exp);
}
export function scoreAt(radius, k = 16, r0 = START_RADIUS, exp = GROWTH_EXP) {
  return k * (Math.pow(radius / r0, 1 / exp) - 1);
}
export const growthK = (mode) => (MODES[mode] || MODES.classic).growthK;
export const radiusForMode = (score, mode) => radiusAt(score, growthK(mode));

/** Calendar day (YYYY-MM-DD) in Riga (UTC+2 / UTC+3 in summer) for a unix timestamp in seconds. */
export function rigaDay(tsSec) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(tsSec * 1000));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export const isDayString = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
/** Previous / next calendar day string (pure date arithmetic, no timezone involved). */
export function shiftDay(day, delta) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** FNV-1a -> uint32: stable seed for a string. */
export function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Seed of the daily challenge of a Riga calendar day. Everyone (and the server) derives the same number. */
export const dailySeed = (day) => hashSeed(`bedre-daily|${day}`);
