// Progress trace sent with a score submission (the Worker's plausibility model checks it, worker/lib/validate.js). Format v2 (scoring rules 2, combos + power-ups):
//   { v:2, t:[play seconds], s:[points], m:[mass], r:[radius], e:[eaten], k:[kills],
//     w:[raw value swallowed], p:[points earned by swallows], c:[best combo counter so far],
//     u:{ magnet:[n..], speed:[n..], double:[n..], shield:[n..] }   cumulative power-ups collected,
//     kinds:{kind:count}, kills, deaths }
// Every array has one entry per sample; sampled every TRACE_STEP (10 s) of PLAYED time (pauses excluded); the last sample is the final state.
//   s = points (what boards rank), m = growth mass (radius = growth(m): the size does NOT follow the multiplied points),
//   w = cumulative unmultiplied value of swallowed objects, p = cumulative multiplied points of swallows (so p <= w x best achievable multiplier).
// Honest-client bookkeeping only: a cheater can fabricate it, but has to fabricate it consistently (see README).
import { bus } from './events.js';
import { TRACE_STEP } from './rules.js';
import { PU_TYPES } from './powerups.js';

let game = null;
let tr = null, next = TRACE_STEP;

const kindKey = (o) => {
  if (o.isBuilding || o.kind === 'building') return o.landmark ? 'landmark' : 'building';
  return String(o.kind || 'other').toLowerCase().replace(/\d+$/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'other';
};

const ARR = ['t', 's', 'm', 'r', 'e', 'k', 'w', 'p', 'c'];
function sample(t) {
  const p = game.player;
  return {
    t: Math.round(t * 100) / 100, s: Math.round(p.score), m: Math.round(p.mass), r: Math.round(p.targetRadius * 100) / 100, e: p.eaten, k: p.kills,
    w: Math.round(p.rawEaten), p: Math.round(p.swPts), c: Math.round(p.combo.best), u: { ...p.picks },
  };
}
function push(s) { for (const a of ARR) tr[a].push(s[a]); for (const k of PU_TYPES) tr.u[k].push(s.u[k]); }

function reset() {
  tr = { v: 2, kinds: {}, u: {} };
  for (const a of ARR) tr[a] = [];
  for (const k of PU_TYPES) tr.u[k] = [];
  next = TRACE_STEP;
}

export function initTrace(g, world) {
  game = g;
  bus.on('roundGo', reset);
  bus.on('swallow', (o, hole) => {
    if (!tr || !hole || !hole.isPlayer) return;
    const k = kindKey(o);
    tr.kinds[k] = (tr.kinds[k] || 0) + 1;
  });
  world.onUpdate.push(() => {
    if (!tr || game.phase !== 'playing') return;
    while (game.playT >= next) { push(sample(game.playT)); next += TRACE_STEP; }
  });
  window.__trace = () => getTrace();
}

/** Trace of the current / just finished round (call when the round ends). null before any round started. */
export function getTrace() {
  if (!tr || !game) return null;
  const out = { v: 2, kinds: { ...tr.kinds }, u: {} };
  for (const a of ARR) out[a] = tr[a].slice();
  for (const k of PU_TYPES) out.u[k] = tr.u[k].slice();
  const f = sample(game.playT);
  const n = out.t.length;
  if (n && f.t - out.t[n - 1] < 0.3) {   // a slot sample just happened: it becomes the final one
    for (const a of ARR) out[a][n - 1] = f[a];
    for (const k of PU_TYPES) out.u[k][n - 1] = f.u[k];
  } else { for (const a of ARR) out[a].push(f[a]); for (const k of PU_TYPES) out.u[k].push(f.u[k]); }
  out.kills = game.player.kills; out.deaths = game.player.deaths;
  return out;
}
