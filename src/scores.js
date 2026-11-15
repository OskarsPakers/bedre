// Client API for the global leaderboard (see worker/index.js). No UI here.
//
// Intended usage:
//   import { startRound, submitScore, fetchScores } from './scores.js';
//   - when a round starts:      startRound();               // fire and forget
//   - when the round ends:      const res = await submitScore({ name, score, eaten, radius, rank, biggest });
//                               // res = { ok, id, rankAllTime, rankToday } or null on failure
//   - leaderboard screen:       const list = await fetchScores('all', 20);  // null on failure (offline), [] when empty
// Every call resolves (never throws) so the game works offline / on plain `vite dev`
// without the worker. The server only accepts a score ~ROUND length after startRound().

const TIMEOUT_MS = 4000;
let roundId = null;
let startSeq = 0;
/** The last score this client successfully submitted (to highlight its row in the Top scores panel). */
export let lastSubmission = null;

async function api(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
  roundId = null;
  const data = await api('/api/rounds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!data || typeof data.roundId !== 'string') return null;
  if (seq !== startSeq) return null; // a newer round started meanwhile
  roundId = data.roundId;
  return { roundId, roundSeconds: data.roundSeconds };
}

export async function submitScore({ name, score, eaten, radius, rank, biggest } = {}) {
  if (!roundId) return null;
  const id = roundId;
  const data = await api('/api/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roundId: id, name, score: Math.round(score), eaten: Math.round(eaten || 0), radius, rank, biggest }),
  });
  if (data && data.ok) {
    if (roundId === id) roundId = null; // a round id is single-use
    lastSubmission = { name: data.name || name, score: Math.round(score), radius };
  }
  return data && data.ok ? data : null;
}

export async function fetchScores(period = 'all', limit = 20) {
  const data = await api(`/api/scores?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}`, { cache: 'no-store' });
  return data && Array.isArray(data.scores) ? data.scores : null;
}
