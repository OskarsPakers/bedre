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
  round = { roundId: data.roundId, mode: data.mode || req.mode, map: data.map || req.map || 'centrs', day: data.day || null, turnstileSiteKey: data.turnstileSiteKey || null };
  return { roundId: round.roundId, roundSeconds: data.roundSeconds, mode: round.mode, seed: data.seed };
}

// ---- Cloudflare Turnstile (only when the server reports a site key) ---------------------------------------------
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ -- loaded lazily, at submit time.
let tsScript = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(true);
  if (!tsScript) {
    tsScript = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = () => resolve(!!window.turnstile); s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return tsScript;
}
async function turnstileToken(siteKey) {
  if (!(await loadTurnstile())) return null;
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:300';
    document.body.appendChild(box);
    let wid = null, done = false;
    const finish = (tok) => {
      if (done) return;
      done = true;
      try { if (wid !== null) window.turnstile.remove(wid); } catch { /* ignore */ }
      box.remove(); resolve(tok);
    };
    try {
      wid = window.turnstile.render(box, {
        sitekey: siteKey, appearance: 'interaction-only', theme: 'light',
        callback: (tok) => finish(tok), 'error-callback': () => finish(null),
      });
    } catch { finish(null); return; }
    setTimeout(() => finish(null), 30000);
  });
}

export async function submitScore({ name, score, eaten, radius, rank, biggest } = {}) {
  if (!round) return null;
  const r = round;
  const body = { roundId: r.roundId, mode: r.mode, map: r.map, name, score: Math.round(score), eaten: Math.round(eaten || 0), radius, rank, biggest, trace: getTrace() };
  if (r.turnstileSiteKey) { const tok = await turnstileToken(r.turnstileSiteKey); if (tok) body.turnstile = tok; }
  const data = await api('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, r.turnstileSiteKey ? 15000 : TIMEOUT_MS);
  if (data && data.ok) {
    if (round === r) round = null;             // a round id is single-use
    lastSubmission = { name: data.name || name, score: Math.round(score), radius, mode: r.mode, map: r.map, day: r.day };
  }
  return data && data.ok ? data : null;
}

/** opts: { mode: 'classic'|'quick'|'daily'|'online', map: map slug (default centrs), day: 'YYYY-MM-DD' (daily) } */
export async function fetchScores(period = 'all', limit = 20, opts = {}) {
  const q = new URLSearchParams({ period, limit: String(limit), mode: opts.mode || 'classic', map: opts.map || 'centrs' });
  if (opts.day) q.set('day', opts.day);
  const data = await api(`/api/scores?${q}`, { cache: 'no-store' });
  return data && Array.isArray(data.scores) ? data.scores : null;
}
