// Client API for the global leaderboards (see worker/index.js). No UI here.
//
//   import { startRound, submitScore, fetchScores } from './scores.js';
//   - when the round timer starts:  startRound();        // fire and forget; asks the server for {mode, day?} of src/modes.js
//   - when the round ends:          const res = await submitScore({ name, score, eaten, radius, rank, biggest });
//                                   // res = { ok, id, mode, rankAllTime, rankToday } or null on failure
//   - leaderboard screen:           const list = await fetchScores('all', 20, { mode: 'classic', map: 'centrs' });  // null offline, [] when empty
// Every call resolves (never throws) so the game works offline / on plain `vite dev` without the worker. The server
// only accepts a score ~round-length after startRound(), together with the progress trace of src/trace.js. Free roam
// and practice rounds never create a server round. Turnstile (optional, off by default) runs only at submit time.
import { CFG } from './config.js';
import { roundRequest } from './modes.js';
import { getTrace } from './trace.js';

const TIMEOUT_MS = 4000;
let round = null;          // { roundId, mode, map, day, turnstileSiteKey }
let startSeq = 0;
/** The last score this client successfully submitted (to highlight its row in the Top scores panel). */
export let lastSubmission = null;

async function api(path, init = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function startRound() {
  const seq = ++startSeq;
  round = null;
  const req = roundRequest();
  if (!req) return null;                       // free roam / daily practice: nothing to rank
  const data = await api('/api/rounds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  if (!data || typeof data.roundId !== 'string') return null;
  if (seq !== startSeq) return null;           // a newer round started meanwhile
  round = { difficulty: CFG.difficulty, roundId: data.roundId, mode: data.mode || req.mode, map: data.map || req.map || 'centrs', day: data.day || null, turnstileSiteKey: data.turnstileSiteKey || null };
  return { roundId: round.roundId, roundSeconds: data.roundSeconds, mode: round.mode, seed: data.seed };
}

// ---- Cloudflare Turnstile (only when the server reports a site key) ---------------------------------------------
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ -- loaded lazily, at submit time.
// A widget that cannot load / errors / times out NEVER loses the round: the result stays pending (`hasPending()`), nothing is sent unverified,
// the results panel offers "retry" (retrySubmit) and every step here swallows its own exceptions.
let tsScript = null;
async function loadTurnstile() {
  if (window.turnstile) return true;
  if (tsScript) { try { if ((await tsScript) && window.turnstile) return true; } catch { /* fall through */ } tsScript = null; }   // a settled-but-useless load is retried
  tsScript = new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = () => resolve(!!window.turnstile);
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.turnstile), 12000);
    } catch { resolve(false); }
  });
  return tsScript;
}
async function turnstileToken(siteKey) {
  let ok = false;
  try { ok = await loadTurnstile(); } catch { ok = false; }
  if (!ok || !window.turnstile) return null;
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:300';
    document.body.appendChild(box);
    let wid = null, done = false;
    const finish = (tok) => {
      if (done) return;
      done = true;
      // remove() is only valid while the container is still in the DOM ("Nothing to reset found for provided container" otherwise)
      try { if (wid !== null && box.isConnected && window.turnstile && window.turnstile.remove) window.turnstile.remove(wid); } catch { /* ignore */ }
      try { box.remove(); } catch { /* ignore */ }
      resolve(tok || null);
    };
    try {
      wid = window.turnstile.render(box, {
        sitekey: siteKey, appearance: 'interaction-only', theme: 'light',
        callback: (tok) => finish(tok), 'error-callback': () => finish(null), 'timeout-callback': () => finish(null), 'expired-callback': () => finish(null),
      });
      if (wid === undefined || wid === null) { finish(null); return; }
    } catch { finish(null); return; }
    setTimeout(() => finish(null), 30000);
  });
}

/** The last result that could not be saved (kept while the results panel is open so it can be retried). */
let pending = null;
/** Why the last submit failed: 'verify' (Turnstile widget / token) or 'net' (request failed); null when it did not. */
export let lastFailure = null;
export const hasPending = () => !!pending && round === pending.r;

async function send(r, p) {
  lastFailure = null;
  const body = { roundId: r.roundId, mode: r.mode, map: r.map, difficulty: r.mode === 'daily' ? 'normal' : r.difficulty, name: p.name, score: Math.round(p.score), eaten: Math.round(p.eaten || 0), radius: p.radius, rank: p.rank, biggest: p.biggest, trace: getTrace() };
  if (r.turnstileSiteKey) {
    const tok = await turnstileToken(r.turnstileSiteKey);
    if (!tok) { lastFailure = 'verify'; return null; }          // never post an unverified score; the round id stays valid for the retry
    body.turnstile = tok;
  }
  const data = await api('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, r.turnstileSiteKey ? 15000 : TIMEOUT_MS);
  if (data && data.ok) {
    if (round === r) round = null;             // a round id is single-use
    pending = null;
    lastSubmission = { name: data.name || p.name, score: Math.round(p.score), radius: p.radius, mode: r.mode, map: r.map, day: r.day };
    return data;
  }
  lastFailure = 'net';
  return null;
}

export async function submitScore({ name, score, eaten, radius, rank, biggest } = {}) {
  if (!round) return null;
  const r = round;
  pending = { r, p: { name, score, eaten, radius, rank, biggest } };
  try { return await send(r, pending.p); } catch { lastFailure = 'net'; return null; }
}

/** Results panel "retry": runs the Turnstile step (if any) and the POST again with the same result. Never throws. */
export async function retrySubmit() {
  if (!pending || round !== pending.r) return null;
  try { return await send(pending.r, pending.p); } catch { lastFailure = 'net'; return null; }
}

/** opts: { mode: 'classic'|'quick'|'daily'|'online', map: map slug (default centrs), day: 'YYYY-MM-DD' (daily) } */
export async function fetchScores(period = 'all', limit = 20, opts = {}) {
  const q = new URLSearchParams({ period, limit: String(limit), mode: opts.mode || 'classic', map: opts.map || 'centrs' });
  if (opts.day) q.set('day', opts.day);
  const data = await api(`/api/scores?${q}`, { cache: 'no-store' });
  return data && Array.isArray(data.scores) ? data.scores : null;
}
