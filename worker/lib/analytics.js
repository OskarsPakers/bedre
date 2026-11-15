// Privacy-first analytics: aggregated daily counters in D1 (table `stats`). No cookies, no identifiers, no IPs.
// Only allow-listed counter keys are stored; anything else in a beacon is ignored.
import { json, err, now, readJson, ipHashOf, rateHit } from './util.js';
import { rigaDay } from '../../src/rules.js';

const MODES = ['classic', 'quick', 'daily', 'free', 'online'];
const STATIC = new Set([
  'pv',                                   // page views
  'vis:new', 'vis:ret',                   // first-ever / returning browser (decided in the browser, nothing is sent to identify it)
  'dev:mobile', 'dev:desktop',            // device class from viewport
  'lang:lv', 'lang:en',
  'q:low', 'q:medium', 'q:high',          // quality tier at round start
  'nogl',                                 // WebGL unavailable
  'pwa:install', 'pwa:standalone',
  'share', 'lobby',                       // share clicks, online lobby joins
  'err:js', 'err:promise', 'err:ctxlost', 'err:load',
]);
const FAMILIES = [
  /^rs:(classic|quick|daily|free|online)$/,                 // rounds started
  /^rf:(classic|quick|daily|free|online)$/,                 // rounds finished
  /^sb:(classic|quick|daily|online):[0-7]$/,                // final-score bucket (log scale, see client)
  /^theme:[a-z0-9-]{1,16}$/,
];
const MAX_KEYS_PER_BEACON = 24;
const MAX_N = 50;
const MAX_KEYS_PER_DAY = 160;               // bounds growth of theme:* style keys
const BEACONS_PER_10MIN = 40;

export const isAllowedKey = (k) => typeof k === 'string' && k.length <= 40 && (STATIC.has(k) || FAMILIES.some((re) => re.test(k)));
export const ALLOWED_MODES = MODES;

/** Do-Not-Track / Global Privacy Control: record nothing. */
export const optedOut = (request) => request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1';

export async function handleEvents(request, env) {
  if (optedOut(request)) return new Response(null, { status: 204 });
  const { body, error } = await readJson(request, { maxBytes: 2048, anyType: true });
  if (error) return error;
  const d = body.d;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return err(400, 'expected {d:{key:n}}');
  const t = now();
  const ih = await ipHashOf(request, t);
  if (!(await rateHit(env, `ev:${ih}:${Math.floor(t / 600)}`, BEACONS_PER_10MIN, 700))) return new Response(null, { status: 204 }); // silently drop
  const day = rigaDay(t);
  const entries = [];
  for (const [k, v] of Object.entries(d)) {
    if (entries.length >= MAX_KEYS_PER_BEACON) break;
    if (!isAllowedKey(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.min(MAX_N, Math.max(1, Math.floor(v)));
    entries.push([k, n]);
  }
  if (!entries.length) return new Response(null, { status: 204 });
  const known = new Set((await env.DB.prepare('SELECT key FROM stats WHERE day = ?').bind(day).all()).results.map((r) => r.key));
  let room = MAX_KEYS_PER_DAY - known.size;
  const stmts = [];
  for (const [k, n] of entries) {
    if (!known.has(k)) { if (room <= 0) continue; room--; }
    stmts.push(env.DB.prepare('INSERT INTO stats (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n').bind(day, k, n));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return new Response(null, { status: 204 });
}

/** GET /api/stats?days=30 -> { from, to, days: [{ day, keys: {...} }] }. Public aggregates; bearer-protected when env.STATS_KEY is set. */
export async function handleStats(request, env, url) {
  if (env.STATS_KEY) {
    const auth = request.headers.get('authorization') || '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('key') || '';
    if (!given || given !== String(env.STATS_KEY)) return err(401, 'stats key required');
  }
  let days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.min(366, Math.max(1, days));
  const t = now();
  const to = rigaDay(t), from = rigaDay(t - (days - 1) * 86400);
  const { results } = await env.DB.prepare('SELECT day, key, n FROM stats WHERE day >= ? AND day <= ? ORDER BY day').bind(from, to).all();
  const byDay = new Map();
  for (const r of results) {
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    byDay.get(r.day)[r.key] = r.n;
  }
  return json({ from, to, days: [...byDay].map(([day, keys]) => ({ day, keys })) }, 200,
    { 'cache-control': env.STATS_KEY ? 'no-store' : 'public, max-age=60' });
}
