// The retention features' clock. Production = the device clock; tests inject a fixed instant with `window.__retentionNow = <unix ms>`
// (set it in an init script for a fresh page, or via evaluate). The calendar day is always the game's `rigaDay` (Riga time), never the device's
// time zone, so travelling or changing the OS time zone does not move a day.
import { rigaDay } from '../rules.js';

export const now = () => (typeof window !== 'undefined' && typeof window.__retentionNow === 'number' ? window.__retentionNow : Date.now());
export const today = () => rigaDay(Math.floor(now() / 1000));

/** Unix ms of 00:00 Riga time on a calendar day string. */
export function rigaMidnight(day) {
  const [y, m, d] = day.split('-').map(Number);
  for (const off of [3, 2]) {   // UTC+3 in summer, UTC+2 in winter
    const t = Date.UTC(y, m - 1, d) - off * 3600e3;
    if (rigaDay(t / 1000) === day && rigaDay(t / 1000 - 1) !== day) return t;
  }
  return Date.UTC(y, m - 1, d) - 2 * 3600e3;
}
