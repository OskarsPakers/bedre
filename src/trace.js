// Progress trace sent with a score submission (the Worker's plausibility model checks it, worker/lib/validate.js):
//   { v:1, t:[play seconds], s:[score], r:[radius], e:[eaten], k:[kills], kinds:{kind:count}, kills, deaths }
// Sampled every TRACE_STEP (10 s) of PLAYED time (pauses excluded); the last sample is the final state.
// Honest-client bookkeeping only: a cheater can fabricate it, but has to fabricate it consistently (see README).
import { bus } from './events.js';
import { TRACE_STEP } from './rules.js';

let game = null;
let tr = null, next = TRACE_STEP;

const kindKey = (o) => {
  if (o.isBuilding || o.kind === 'building') return o.landmark ? 'landmark' : 'building';
  return String(o.kind || 'other').toLowerCase().replace(/\d+$/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'other';
};

function sample(t) {
  const p = game.player;
  return [Math.round(t * 100) / 100, Math.round(p.score), Math.round(p.targetRadius * 100) / 100, p.eaten, p.kills];
}
function push(s) { tr.t.push(s[0]); tr.s.push(s[1]); tr.r.push(s[2]); tr.e.push(s[3]); tr.k.push(s[4]); }

function reset() {
  tr = { v: 1, t: [], s: [], r: [], e: [], k: [], kinds: {} };
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
  const t = game.playT, out = { v: 1, t: tr.t.slice(), s: tr.s.slice(), r: tr.r.slice(), e: tr.e.slice(), k: tr.k.slice(), kinds: { ...tr.kinds } };
  const f = sample(t);
  if (out.t.length && f[0] - out.t[out.t.length - 1] < 0.3) {   // a slot sample just happened: it becomes the final one
    out.t[out.t.length - 1] = f[0]; out.s[out.s.length - 1] = f[1]; out.r[out.r.length - 1] = f[2]; out.e[out.e.length - 1] = f[3]; out.k[out.k.length - 1] = f[4];
  } else { out.t.push(f[0]); out.s.push(f[1]); out.r.push(f[2]); out.e.push(f[3]); out.k.push(f[4]); }
  out.kills = game.player.kills; out.deaths = game.player.deaths;
  return out;
}
