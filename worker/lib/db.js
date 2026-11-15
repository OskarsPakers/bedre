// D1 helpers for scores / rounds. `insertScore` is the ONE place that writes the scores table: the multiplayer
// server (worker/mp/**) imports it to record finished online matches.
import { BOARD_MODES } from '../../src/rules.js';
import { now } from './util.js';
import { sanitizeName, sanitizeLabel, ANON } from './moderation.js';

/**
 * Insert a leaderboard row.
 *
 *   import { insertScore } from '../lib/db.js';
 *   const { id } = await insertScore(env, { mode: 'online', name, score, eaten, radius, rank, biggest });
 *
 * @param {object} env  Worker env (needs env.DB, the D1 binding)
 * @param {object} row
 *   mode      'classic' | 'quick' | 'daily' | 'online'  (required; 'online' rows are only ever written server-side)
 *   name      display name (cleaned + profanity-filtered here; unusable names become "Anonīms")
 *   score     integer >= 0
 *   eaten, radius, rank, biggest, kills, deaths   optional
 *   day       'YYYY-MM-DD' (Riga day), daily mode only
 *   suspect   1 hides the row from public boards (default 0)
 *   flags     comma separated reason codes, trace  JSON string, roundId  optional forensics
 *   createdAt unix seconds (default now)
 * @returns {Promise<{id:number, name:string}>}
 */
export async function insertScore(env, row) {
  if (!BOARD_MODES.includes(row.mode)) throw new Error(`insertScore: bad mode ${row.mode}`);
  if (!Number.isInteger(row.score) || row.score < 0 || row.score > 1e8) throw new Error('insertScore: bad score');
  const name = sanitizeName(row.name) || ANON;
  const biggest = row.biggest == null ? null : sanitizeLabel(row.biggest);
  const res = await env.DB.prepare(
    'INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at, mode, day, suspect, flags, trace, round_id, kills, deaths) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    name, row.score, row.eaten ?? 0, row.radius ?? 0, row.rank ?? null, biggest, row.createdAt ?? now(), row.mode,
    row.mode === 'daily' ? row.day ?? null : null, row.suspect ? 1 : 0, row.flags ?? null, row.trace ?? null,
    row.roundId ?? null, row.kills ?? null, row.deaths ?? null,
  ).run();
  return { id: res.meta.last_row_id, name };
}

/** 1-based rank of `score` among the visible (non-suspect) rows of a board. */
export async function rankOf(env, { mode, day = null, score, since = 0 }) {
  const row = mode === 'daily'
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE mode = ? AND day = ? AND suspect = 0 AND score > ?').bind(mode, day, score).first()
    : await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE mode = ? AND suspect = 0 AND score > ? AND created_at >= ?').bind(mode, score, since).first();
  return row.n + 1;
}

export async function listScores(env, { mode, day = null, since = 0, limit = 20 }) {
  const cols = 'name, score, radius, eaten, rank, biggest, created_at AS at';
  const q = mode === 'daily'
    ? env.DB.prepare(`SELECT ${cols} FROM scores WHERE mode = ? AND day = ? AND suspect = 0 ORDER BY score DESC, created_at ASC LIMIT ?`).bind(mode, day, limit)
    : env.DB.prepare(`SELECT ${cols} FROM scores WHERE mode = ? AND suspect = 0 AND created_at >= ? ORDER BY score DESC, created_at ASC LIMIT ?`).bind(mode, since, limit);
  return (await q.all()).results;
}

/** Housekeeping, piggy-backed on writes: unused round tokens after a day, IP hashes after two days, expired rate counters. */
export async function purgeStale(env, t = now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rounds WHERE used = 0 AND created_at < ?').bind(t - 86400),
    env.DB.prepare('UPDATE rounds SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?').bind(t - 2 * 86400),
    env.DB.prepare('DELETE FROM rate_limits WHERE exp < ?').bind(t),
  ]);
}
