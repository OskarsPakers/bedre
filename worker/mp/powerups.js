// Server side of the power-ups (see src/powerups.js for the shared rules + schedule): the room's field, per-hole effect timers (server wall clock, ms),
// and the numbers the rest of the simulation needs from them (speed budget, claim reach, shield). Pure: driven by RoomSim and scripts/test-mp-sim.mjs.
//
// What is authoritative: which pickups exist, who collected one (first valid claim wins), every effect's start / end. A client only CLAIMS a pickup
// (`p: [slot..]` in its update frame); the server checks that the slot is live and that the hole's server-known position is within the pickup radius
// (+ the same latency allowance the eat claims get). Multipliers are never accepted from a client.
import { PowerupField, PU, PU_TYPES, PU_ORDER, puCountFor, candidatesFromSpawn, pickRadius, magnetFactor } from '../../src/powerups.js';

/** Grace after an effect ended (ms) that the server still honours: the client's own timer runs ~one-way latency behind the server's. */
export const FX_GRACE_MS = { speed: 900, magnet: 700, double: 400, shield: 0 };

export const makeFx = () => ({ magnet: 0, speed: 0, double: 0, shield: 0 });   // absolute end times (server ms)

export function makeField(table, seed) {
  return new PowerupField({ seed, cand: candidatesFromSpawn(table.spawn), count: puCountFor(table.bounds) });
}

/** Is `type` active for hole h at server time `ms` (grace included for the speed / reach tolerances, not for the shield)? */
export const fxOn = (h, type, ms) => h.fxUntil[type] + FX_GRACE_MS[type] > ms;
/** Bitmask of the effects really running (snapshots: others draw the shield ring). */
export function fxMask(h, ms) { let m = 0; for (const t of PU_TYPES) if (h.fxUntil[t] > ms) m |= 1 << PU_ORDER[t]; return m; }
/** Remaining ms of each effect in PU_TYPES order (acks / resume: the owner's badges). */
export const fxRemain = (h, ms) => PU_TYPES.map((t) => Math.max(0, Math.round(h.fxUntil[t] - ms)));
/** Speed budget factor: Ātrums raises the allowed speed (the anti-speed-hack check) while it runs. */
export const speedFactor = (h, ms) => (fxOn(h, 'speed', ms) ? PU.speed.mul : 1);
/** Claim reach factor: Magnēts widens the reach tolerance for that hole while it runs. */
export const reachFactor = (h, ms) => (fxOn(h, 'magnet', ms) ? magnetFactor(h.r) : 1);
export const doubleMul = (h, ms) => (h.fxUntil.double + FX_GRACE_MS.double > ms ? PU.double.mul : 1);

export function grant(h, type, ms, scale = 1) { h.fxUntil[type] = ms + PU[type].dur * 1000 * scale; h.picks[type]++; }

export { pickRadius, PU_TYPES, PU_ORDER, PU };
