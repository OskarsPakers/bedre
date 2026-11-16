// BEDRE — Rīga: API (Cloudflare Worker + D1). No dependencies. Everything outside /api/* is served from static
// assets (env.ASSETS).
//
//   POST /api/rounds   {mode, map?, day?}  -> {roundId, roundSeconds, mode, map, day?, seed, turnstileSiteKey?}   (map = slug, default 'centrs')
//   POST /api/scores   {roundId,map?,difficulty?,name,score,eaten,radius,rank,biggest,trace[,turnstile]} -> {ok,id,name,mode,map,rankAllTime,rankToday}
//   GET  /api/scores   ?mode=classic|quick|daily|online&map=<slug>&period=all|week|day[&day=YYYY-MM-DD][&limit=20]
//   POST /api/e        cookieless analytics beacon {d:{key:n}}           (worker/lib/analytics.js)
//   GET  /api/stats    ?days=30 aggregated counters                      (public, or bearer STATS_KEY)
//
// Anti-cheat = plausibility + friction (worker/lib/validate.js), NOT proof: the game runs in the browser.
// See README "Anti-cheat" for the model and what stays bypassable.
import { MODES, CLIENT_MODES, BOARD_MODES, DIFFICULTIES, dailySeed, rigaDay, isDayString, shiftDay } from '../src/rules.js';
import { MAP_SLUGS, DEFAULT_MAP, isMapSlug } from '../tools/maps.mjs';
import { json, err, now, readJson, sameOrigin, intIn, ipHashOf } from './lib/util.js';
import { sanitizeName, sanitizeLabel } from './lib/moderation.js';
import { insertScore, rankOf, listScores, purgeStale } from './lib/db.js';
import { validateSubmission } from './lib/validate.js';
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from './lib/turnstile.js';
import { handleEvents, handleStats } from './lib/analytics.js';
import { handleMp } from './mp/index.js';
export { MpRoom, MpMatchmaker } from './mp/index.js'; // Durable Object classes (multiplayer, worker/mp/)

const MIN_AGE_FRACTION = 0.9;          // submit no earlier than 90% of round length
const MAX_EXTRA_AGE_S = 600;           // ...and no later than round length + 10 min
const MAX_SCORE = 10_000_000;          // generous sanity limits
const MAX_RADIUS = 5000;
const MAX_EATEN = 1_000_000;
const MAX_BODY_BYTES = 8192;           // body incl. the progress trace (~1.5 KB for 5:00)
const MAX_ROUNDS_PER_HOUR = 30;        // per (hashed) IP
const SUBMIT_CAP_PER_DAY = { classic: 60, quick: 120, daily: 5 };   // ranked submissions per (hashed) IP per UTC day
const DAILY_GRACE_S = 120;             // a daily round begun just after Riga midnight may still belong to yesterday

/** Server-side round length per mode. `ROUND_SECONDS_OVERRIDE` is a test-only var (never set in wrangler.jsonc). */
function roundSeconds(env, mode) {
  const o = Number(env.ROUND_SECONDS_OVERRIDE);
  return Number.isFinite(o) && o > 0 ? o : MODES[mode].seconds;
}
/** Test-only overrides of the per-IP caps (vars RATE_ROUNDS_PER_HOUR, CAP_DAILY ...). */
const envInt = (env, key, dflt) => { const v = Number(env[key]); return Number.isFinite(v) && v > 0 ? v : dflt; };

async function createRound(request, env) {
  let body = {};
  if ((request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    const r = await readJson(request, { maxBytes: 1024 });
    if (r.error) return r.error;
    body = r.body;
  }
  const mode = body.mode === undefined ? 'classic' : body.mode;
  if (typeof mode !== 'string' || !CLIENT_MODES.includes(mode)) return err(400, 'mode must be classic, quick or daily');
  const map = body.map === undefined ? DEFAULT_MAP : body.map;
  if (!isMapSlug(map)) return err(400, `map must be one of ${MAP_SLUGS.join(', ')}`);
  if (mode === 'daily' && map !== DEFAULT_MAP) return err(400, 'the daily challenge is only played on the centre map');
  const t = now();
  let day = null, seed;
  if (mode === 'daily') {
    const today = rigaDay(t);
    day = body.day === undefined ? today : body.day;
    if (!isDayString(day)) return err(400, 'invalid day');
    const ok = day === today || (day === shiftDay(today, -1) && rigaDay(t - DAILY_GRACE_S) === day);
    if (!ok) return err(409, 'day mismatch', { today });
    seed = dailySeed(day);
  } else {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
  }
  const ipHash = await ipHashOf(request, t);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rounds WHERE ip_hash = ? AND created_at > ?').bind(ipHash, t - 3600).first();
  if (row.n >= envInt(env, 'RATE_ROUNDS_PER_HOUR', MAX_ROUNDS_PER_HOUR)) return err(429, 'too many rounds, try again later');
  const roundId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO rounds (id, created_at, ip_hash, used, mode, day, seed, map) VALUES (?, ?, ?, 0, ?, ?, ?, ?)')
    .bind(roundId, t, ipHash, mode, day, seed, map).run();
  await purgeStale(env, t);
  const out = { roundId, roundSeconds: roundSeconds(env, mode), mode, map, seed };
  if (day) out.day = day;
  const site = turnstileSiteKey(env);
  if (site) out.turnstileSiteKey = site;
  return json(out, 201);
}

async function submitScore(request, env) {
  const { body, error } = await readJson(request, { maxBytes: MAX_BODY_BYTES });
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
    biggest = sanitizeLabel(body.biggest);
  }
  if (typeof body.roundId !== 'string' || body.roundId.length > 64) return err(400, 'invalid roundId');
  if (body.mode !== undefined && (typeof body.mode !== 'string' || !CLIENT_MODES.includes(body.mode))) return err(400, 'mode not accepted from clients');
  if (body.map !== undefined && !isMapSlug(body.map)) return err(400, 'invalid map');
  if (body.difficulty !== undefined && body.difficulty !== null && !DIFFICULTIES.includes(body.difficulty)) return err(400, 'invalid difficulty');

  const t = now();
  const round = await env.DB.prepare('SELECT created_at, used, mode, day, seed, ip_hash, map FROM rounds WHERE id = ?').bind(body.roundId).first();
  if (!round) return err(403, 'unknown round');
  if (round.used) return err(409, 'round already submitted');
  if (body.mode !== undefined && body.mode !== round.mode) return err(400, 'mode does not match the round');
  if (body.map !== undefined && body.map !== round.map) return err(400, 'map does not match the round');
  if (!CLIENT_MODES.includes(round.mode)) return err(403, 'round mode not submittable');
  const len = roundSeconds(env, round.mode);
  const age = t - round.created_at;
  if (age < len * MIN_AGE_FRACTION) return err(403, 'round not finished yet');
  if (age > len + MAX_EXTRA_AGE_S) return err(403, 'round expired');

  const ipHash = await ipHashOf(request, t);
  const cap = envInt(env, `CAP_${round.mode.toUpperCase()}`, SUBMIT_CAP_PER_DAY[round.mode]);
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM rounds WHERE ip_hash = ? AND used = 1 AND mode = ? AND created_at > ?')
    .bind(ipHash, round.mode, t - 86400).first();
  if (used.n >= cap) return err(429, 'daily limit of ranked submissions reached');

  // Optional Turnstile (before the round is consumed, so a failed challenge can be retried)
  if (turnstileEnabled(env)) {
    const v = await verifyTurnstile(env, body.turnstile, request.headers.get('cf-connecting-ip'));
    if (!v.ok) { console.log(JSON.stringify({ ev: 'turnstile_fail', codes: v.codes })); return err(403, 'turnstile verification failed'); }
  }

  // Atomic claim: only one concurrent request can flip used 0 -> 1. From here on the round token is burnt.
  const claim = await env.DB.prepare('UPDATE rounds SET used = 1 WHERE id = ? AND used = 0').bind(body.roundId).run();
  if (!claim.meta.changes) return err(409, 'round already submitted');

  const check = validateSubmission({ mode: round.mode, map: round.map, seconds: len, age, score, eaten, radius, rank, trace: body.trace });
  console.log(JSON.stringify({ ev: 'score_check', mode: round.mode, map: round.map, verdict: check.verdict, reasons: check.reasons }));
  if (check.verdict === 'reject') return err(422, 'score failed plausibility checks', { reasons: check.reasons });

  const tr = body.trace;
  const { id, name: stored } = await insertScore(env, {
    mode: round.mode, map: round.map, day: round.day, name, score, eaten, radius, rank, biggest,
    difficulty: round.mode === 'daily' ? 'normal' : (typeof body.difficulty === 'string' ? body.difficulty : null), suspect: check.verdict === 'suspect' ? 1 : 0, flags: check.reasons.join(',') || null,
    trace: JSON.stringify(tr), roundId: body.roundId, kills: tr.kills, deaths: tr.deaths, createdAt: t,
  });
  const dayStart = t - (t % 86400);
  let rAll, rToday;
  if (round.mode === 'daily') rAll = rToday = await rankOf(env, { mode: 'daily', map: round.map, day: round.day, score });
  else [rAll, rToday] = await Promise.all([rankOf(env, { mode: round.mode, map: round.map, score }), rankOf(env, { mode: round.mode, map: round.map, score, since: dayStart })]);
  await purgeStale(env, t);
  const out = { ok: true, id, name: stored, mode: round.mode, map: round.map, rankAllTime: rAll, rankToday: rToday };
  if (round.day) out.day = round.day;
  return json(out, 201);
}

async function getScores(url, env) {
  const mode = url.searchParams.get('mode') || 'classic';
  if (!BOARD_MODES.includes(mode)) return err(400, 'mode must be classic, quick, daily or online');
  const map = url.searchParams.get('map') || DEFAULT_MAP;
  if (!isMapSlug(map)) return err(400, `map must be one of ${MAP_SLUGS.join(', ')}`);
  if ((mode === 'daily' || mode === 'online') && map !== DEFAULT_MAP) return json({ mode, map, period: url.searchParams.get('period') || 'all', scores: [] }, 200, { 'cache-control': 'public, max-age=15' });
  const period = url.searchParams.get('period') || 'all';
  if (!['all', 'week', 'day'].includes(period)) return err(400, 'period must be all, week or day');
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));
  const t = now();
  let day = null;
  if (mode === 'daily') {
    day = url.searchParams.get('day') || rigaDay(t);
    if (!isDayString(day)) return err(400, 'invalid day');
  }
  const since = period === 'day' ? t - (t % 86400) : period === 'week' ? t - 7 * 86400 : 0;
  const scores = await listScores(env, { mode, map, day, since, limit });
  const out = { mode, map, period, scores };
  if (day) out.day = day;
  return json(out, 200, { 'cache-control': 'public, max-age=15' });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  if (path.startsWith('/api/mp/')) return handleMp(request, env, url); // multiplayer: worker/mp/index.js
  if (path === '/api/scores') {
    if (method === 'GET') return getScores(url, env);
    if (method === 'POST') return submitScore(request, env);
    return err(405, 'method not allowed');
  }
  if (path === '/api/rounds') {
    if (method !== 'POST') return err(405, 'method not allowed');
    return createRound(request, env);
  }
  if (path === '/api/e') {
    if (method !== 'POST') return err(405, 'method not allowed');
    return handleEvents(request, env);
  }
  if (path === '/api/stats') {
    if (method !== 'GET') return err(405, 'method not allowed');
    return handleStats(request, env, url);
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
