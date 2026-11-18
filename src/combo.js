// COMBOS: swallowing things in quick succession builds a counter, the counter picks a points multiplier.
// Pure (no DOM / three.js): shared by the browser (src/holes.js, src/game.js), the Worker's room simulation (worker/mp/sim.js) and the
// score validator (worker/lib/validate.js), so all of them use the SAME numbers.
//
// The multiplier applies to POINTS only (`hole.score`, what the leaderboards rank). Hole SIZE follows the unmultiplied swallowed value
// (`hole.mass`, the growth formula of src/rules.js), so pacing and maps are exactly what they were before combos existed.

/** Version of the scoring rules. Leaderboard rows carry it (scores.rules); boards show the current version, older rows live in the archive. */
export const RULES_VERSION = 2;

export const COMBO = {
  window: 1.6,            // s: a combo survives this long without a swallow ...
  windowGrow: 0.011,      // ... plus this much per metre of hole radius beyond `windowFrom` (targets are further apart for a big hole) ...
  windowFrom: 8,
  windowMax: 2.6,         // ... up to this
  // [counter, multiplier]: the multiplier of the highest step reached
  steps: [[0, 1], [5, 1.2], [12, 1.5], [25, 2], [45, 2.5], [70, 3]],
  cap: 5,                 // combo x power-up (Dubultpunkti) never exceeds this
  maxWeight: 4,           // most a single swallow adds to the counter
  stampJitter: 0.35,      // s: most a client's claim timeline may gain on the server's receipt timeline between two claim batches (delivery jitter; bounds what a faked RTT can buy)
  netSlack: 0.25,         // s: extra window the SERVER grants for clock-sync error between client timestamps and its own clock (online)
};
export const COMBO_MAX_MULT = COMBO.steps[COMBO.steps.length - 1][1];

/** Combo window (s) of a hole with this radius. */
export const comboWindow = (radius) => Math.min(COMBO.windowMax, COMBO.window + Math.max(0, radius - COMBO.windowFrom) * COMBO.windowGrow);

/** Multiplier for a counter value. */
export function multFor(count) {
  let m = 1;
  for (const [n, v] of COMBO.steps) if (count >= n) m = v; else break;
  return m;
}

/** How much one swallowed object adds to the counter: props 1 (valuable monuments 2), buildings 2 / 3 / 4 by size. */
export function comboWeight(isBuilding, fit, value) {
  if (isBuilding) return fit < 7 ? 2 : fit < 14 ? 3 : 4;
  return value >= 40 ? 2 : 1;
}

/** Points multiplier of everything together: combo multiplier x Dubultpunkti, capped. */
export const totalMult = (comboMult, doubleMul = 1) => Math.min(COMBO.cap, comboMult * doubleMul);

/** Per-difficulty damping of the BOTS' counter growth (the player's is always 1). Easy bots chain a little less. */
export const BOT_COMBO_SCALE = { easy: 0.85, normal: 1, hard: 1 };

/** One hole's combo state. Time is any monotonically increasing clock in seconds (solo: seconds played; server: wall clock / 1000). */
export class Combo {
  constructor() { this.reset(); }
  reset() {
    this.count = 0; this.mult = 1; this.until = 0;
    this.best = 0; this.bestMult = 1;       // round records (reset by Hole.reset, kept across respawns)
  }
  /** Drop the running combo (death / respawn); round records stay. */
  drop() { this.count = 0; this.mult = 1; this.until = 0; }
  /** Per-frame: true when the running combo has just run out (returns the lost count, else 0). */
  tick(now) {
    if (this.count > 0 && now > this.until) { const lost = this.count; this.drop(); return lost; }
    return 0;
  }
  /**
   * A swallow happened at `now`. Returns { mult, step } (step: the multiplier just stepped up). `slack` = extra window seconds (server).
   * Order matters: the counter rises first, the multiplier of the NEW counter applies to this swallow.
   */
  hit(now, weight, radius, slack = 0) {
    if (this.count > 0 && now > this.until) this.drop();
    this.count += weight;
    const prev = this.mult;
    this.mult = multFor(this.count);
    this.until = now + comboWindow(radius) + slack;
    if (this.count > this.best) this.best = this.count;
    if (this.mult > this.bestMult) this.bestMult = this.mult;
    return { mult: this.mult, step: this.mult > prev };
  }
  /** 0..1 of the running window left (UI ring); 0 when idle. */
  left(now, radius) { return this.count > 0 ? Math.max(0, Math.min(1, (this.until - now) / comboWindow(radius))) : 0; }
}

/** Round-wide combo / power-up facts for the meta layer (achievements read them; the game keeps them up to date). */
export const comboRound = { best: 0, bestMult: 1, picked: new Set() };
export function resetComboRound() { comboRound.best = 0; comboRound.bestMult = 1; comboRound.picked.clear(); }
