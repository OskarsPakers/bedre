// BEDRE — Rīga: global high-score API (Cloudflare Worker + D1). No dependencies.
// Everything outside /api/* is served from static assets (env.ASSETS).
//
// Anti-cheat is deliberately light and secret-free: a score is only accepted for a
// server-issued round id that is unused and whose age is ~ the round length. This
// stops casual curl spam, not a determined cheater who waits 5 minutes.

// MUST match `roundSeconds` in src/config.js.
const ROUND_SECONDS = 300;
const MIN_AGE_FRACTION = 0.9;          // submit no earlier than 90% of round length
const MAX_EXTRA_AGE_S = 600;           // ...and no later than round length + 10 min
const MAX_SCORE = 10_000_000;          // generous sanity limits
const MAX_RADIUS = 5000;
const MAX_EATEN = 1_000_000;
const MAX_BODY_BYTES = 2048;
const MAX_ROUNDS_PER_HOUR = 30;        // per (hashed) IP
const STALE_ROUND_S = 86400;
// Salt is a constant: it only avoids storing raw IPs. Anyone with the source could
// brute-force the IPv4 space against a leaked hash, so this is pseudonymisation,
// not anonymisation. Hashes include the UTC date and rows are purged after a day.
const IP_SALT = 'bedre-riga-v1';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const err = (status, message) => json({ error: message }, status);

const now = () => Math.floor(Date.now() / 1000);

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function roundSeconds(env) {
  const o = Number(env.ROUND_SECONDS_OVERRIDE); // test-only var; never set in wrangler.jsonc
  return Number.isFinite(o) && o > 0 ? o : ROUND_SECONDS;
}

// control chars, zero-width and bidi-override characters
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g');

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(INVISIBLE, ' ')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...s];
  if (chars.length < 1 || chars.length > 16) return null;
  return s;
}

function intIn(v, min, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) return { error: err(415, 'content-type must be application/json') };
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { error: err(413, 'body too large') };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) return { error: err(413, 'body too large') };
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: err(400, 'expected JSON object') };
    return { body: v };
  } catch {
    return { error: err(400, 'invalid JSON') };
  }
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function purgeStale(env) {
  await env.DB.prepare('DELETE FROM rounds WHERE used = 0 AND created_at < ?').bind(now() - STALE_ROUND_S).run();
}

async function createRound(request, env) {
  const t = now();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const ipHash = await sha256Hex(`${IP_SALT}|${ip}|${day}`);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rounds WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, t - 3600).first();
  if (row.n >= MAX_ROUNDS_PER_HOUR) return err(429, 'too many rounds, try again later');
  const roundId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO rounds (id, created_at, ip_hash, used) VALUES (?, ?, ?, 0)')
    .bind(roundId, t, ipHash).run();
  await purgeStale(env);
  return json({ roundId, roundSeconds: roundSeconds(env) }, 201);
}

async function submitScore(request, env) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const name = sanitizeName(body.name);
  if (!name) return err(400, 'name must be 1-16 characters');
  const score = intIn(body.score, 0, MAX_SCORE);
  if (score === null) return err(400, 'invalid score');
  const eaten = body.eaten === undefined ? 0 : intIn(body.eaten, 0, MAX_EATEN);
  if (eaten === null) return err(400, 'invalid eaten');
  const radius = body.radius === undefined ? 0 : body.radius;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > MAX_RADIUS) return err(400, 'invalid radius');
  const rank = body.rank === undefined || body.rank === null ? null : intIn(body.rank, 0, 1000);
  if (body.rank !== undefined && body.rank !== null && rank === null) return err(400, 'invalid rank');
  let biggest = null;
  if (body.biggest !== undefined && body.biggest !== null) {
    if (typeof body.biggest !== 'string') return err(400, 'invalid biggest');
    biggest = [...body.biggest.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('') || null;
  }
  if (typeof body.roundId !== 'string' || body.roundId.length > 64) return err(400, 'invalid roundId');

  const t = now();
  const round = await env.DB.prepare('SELECT created_at, used FROM rounds WHERE id = ?').bind(body.roundId).first();
  if (!round) return err(403, 'unknown round');
  if (round.used) return err(409, 'round already submitted');
  const len = roundSeconds(env);
  const age = t - round.created_at;
  if (age < len * MIN_AGE_FRACTION) return err(403, 'round not finished yet');
  if (age > len + MAX_EXTRA_AGE_S) return err(403, 'round expired');

  // Atomic claim: only one concurrent request can flip used 0 -> 1.
  const claim = await env.DB.prepare('UPDATE rounds SET used = 1 WHERE id = ? AND used = 0').bind(body.roundId).run();
  if (!claim.meta.changes) return err(409, 'round already submitted');

  const ins = await env.DB.prepare(
    'INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(name, score, eaten, radius, rank, biggest, t).run();
  const id = ins.meta.last_row_id;

  const dayStart = t - (t % 86400);
  const [all, today] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ?').bind(score),
    env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ? AND created_at >= ?').bind(score, dayStart),
  ]);
  await purgeStale(env);
  return json({ ok: true, id, name, rankAllTime: all.results[0].n + 1, rankToday: today.results[0].n + 1 }, 201);
}

async function listScores(url, env) {
  const period = url.searchParams.get('period') || 'all';
  if (!['all', 'week', 'day'].includes(period)) return err(400, 'period must be all, week or day');
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));
  const t = now();
  const since = period === 'day' ? t - (t % 86400) : period === 'week' ? t - 7 * 86400 : 0;
  const { results } = await env.DB.prepare(
    'SELECT name, score, radius, eaten, rank, biggest, created_at AS at FROM scores WHERE created_at >= ? ORDER BY score DESC, created_at ASC LIMIT ?',
  ).bind(since, limit).all();
  return json({ period, scores: results }, 200, { 'cache-control': 'public, max-age=15' });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  if (path === '/api/scores') {
    if (method === 'GET') return listScores(url, env);
    if (method === 'POST') return submitScore(request, env);
    return err(405, 'method not allowed');
  }
  if (path === '/api/rounds') {
    if (method !== 'POST') return err(405, 'method not allowed');
    return createRound(request, env);
  }
  return err(404, 'not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'POST' && !sameOrigin(request)) return err(403, 'cross-origin request rejected');
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      console.error('api error', e && e.message);
      return err(500, 'internal error');
    }
  },
};
