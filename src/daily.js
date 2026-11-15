// Daily challenge: one fixed setup per Riga calendar day, derived deterministically from the date, so every player
// (and the server, which returns the same seed from POST /api/rounds) agrees on it. Pure helpers + a soft
// "one ranked attempt per browser per day" flag in localStorage (the hard limit is the server's per-IP cap).
import { rigaDay, dailySeed } from './rules.js';

/**
 * The twist list. `bots` = number of bots, `difficulty` = bot skill multiplier, `spawn` = where the player starts
 * ('oldtown' / 'centre' pin the start to a street near that place; otherwise the usual best-food street).
 */
export const TWISTS = [
  { id: 'oldtown', spawn: 'oldtown' },
  { id: 'centre', spawn: 'centre' },
  { id: 'bots9', bots: 9 },
  { id: 'quiet', bots: 3 },
  { id: 'tough', difficulty: 1.25 },
  { id: 'crowd', bots: 9, spawn: 'oldtown' },
];

export const todayRiga = () => rigaDay(Math.floor(Date.now() / 1000));

/** The setup of a Riga day: { day, seed, twist }. Same input -> same output on every machine. */
export function dailyInfo(day = todayRiga()) {
  const seed = dailySeed(day);
  return { day, seed, twist: TWISTS[(seed >>> 8) % TWISTS.length] };
}

const KEY = 'bedre.daily';
export function dailyUsed(day) {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return !!(v && v.day === day); } catch { return false; }
}
export function markDailyUsed(day) {
  try { localStorage.setItem(KEY, JSON.stringify({ day })); } catch { /* storage blocked: the server cap still applies */ }
}
