// Multiplayer entry: HTTP/WebSocket routes under /api/mp/* and the Durable Object classes (re-exported by worker/index.js).
//   POST /api/mp/join    -> {room, max}          matchmaker assigns the open lobby (or opens a new one)
//   GET  /api/mp/ws?room -> WebSocket upgrade     forwarded to that room's Durable Object (protocol: worker/mp/protocol.js)
//   GET  /api/mp/status  -> lobby / running-round summary for the lobby panel
//   GET  /api/mp/info    -> {v, hash, objects}    content id of the object table (= placement file bytes) the server expects
//   POST /api/mp/room {token}  -> {code, max}     FRIEND ROOMS: create a private room (rate limited per IP hash); the matchmaker never hears of it
//   GET  /api/mp/room?code=  -> {ok, phase, humans, max} | 404 {error:'noroom'} | 429   look a private room up (failed lookups / joins are rate limited per IP hash)
//   GET  /api/mp/ws?priv=CODE -> WebSocket upgrade of that private room (same frames + host controls, see protocol.js)
import { validRoom, validCode, normCode, makeCode, validToken, PROTOCOL_VERSION, MP } from './protocol.js';
import { ipHashOf, rateHit, now as nowSec } from '../lib/util.js';
import { loadTable } from './room.js';

export { MpRoom } from './room.js';
export { MpMatchmaker } from './matchmaker.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

const envInt = (env, key, d) => { const v = Number(env[key]); return Number.isFinite(v) && v > 0 ? v : d; };
const privStub = (env, code) => env.MP_ROOM.get(env.MP_ROOM.idFromName('priv:' + code));   // a name no public room can have (public names are [a-z0-9])

/** Failed-lookup limiter (codes cannot be enumerated): the same D1 fixed-window counter the other limits use (worker/lib/util.js rateHit). */
async function failBlocked(env, request) {
  if (!env.DB) return false;
  const ih = await ipHashOf(request);
  const row = await env.DB.prepare('SELECT n FROM rate_limits WHERE k = ? AND exp > ?').bind('pf:' + ih, nowSec()).first().catch(() => null);
  return !!row && row.n >= envInt(env, 'RATE_PRIV_FAIL', MP.privFailPer10Min);
}
async function noteFail(env, request) {
  if (!env.DB) return;
  const ih = await ipHashOf(request);
  await rateHit(env, 'pf:' + ih, 1e9, 600).catch(() => {});
}
const mmStub = (env) => env.MP_MATCHMAKER.get(env.MP_MATCHMAKER.idFromName('mm'));

export async function handleMp(request, env, url) {
  if (!env.MP_ROOM || !env.MP_MATCHMAKER) return json({ error: 'multiplayer not configured' }, 503);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (path === '/api/mp/join' && request.method === 'POST') {
      if (!sameOrigin(request)) return json({ error: 'cross-origin' }, 403);
      const bad = url.searchParams.get('bad') || '';
      const r = await mmStub(env).fetch('https://mm.invalid/assign' + (validRoom(bad) ? '?bad=' + bad : ''));
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (path === '/api/mp/status' && request.method === 'GET') {
      const r = await mmStub(env).fetch('https://mm.invalid/status');
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (path === '/api/mp/info' && request.method === 'GET') {
      const t = await loadTable(env);   // throws -> 503 below when the file is missing
      return json({ v: PROTOCOL_VERSION, hash: t.hash, objects: t.n });
    }
    if (path === '/api/mp/room' && request.method === 'POST') {
      if (!sameOrigin(request)) return json({ error: 'cross-origin' }, 403);
      let body = {}; try { body = await request.json(); } catch { /* */ }
      if (env.DB) {
        const ih = await ipHashOf(request);
        if (!(await rateHit(env, 'pc:' + ih, envInt(env, 'RATE_PRIV_CREATE', MP.privCreatePerHour), 3600))) return json({ error: 'ratelimit' }, 429);
      }
      for (let i = 0; i < 6; i++) {
        const code = makeCode();
        const r = await privStub(env, code).fetch('https://room.invalid/priv-init', { method: 'POST', body: JSON.stringify({ code, token: validToken(body && body.token) ? body.token : null }) });
        if (r.status === 201) return json({ code, max: MP.privMaxHumans }, 201);
        if (r.status !== 409) break;
      }
      return json({ error: 'multiplayer unavailable' }, 503);
    }
    if (path === '/api/mp/room' && request.method === 'GET') {
      if (await failBlocked(env, request)) return json({ error: 'ratelimit' }, 429);
      const code = normCode(url.searchParams.get('code'));
      if (!validCode(code)) { await noteFail(env, request); return json({ error: 'noroom' }, 404); }
      const r = await privStub(env, code).fetch('https://room.invalid/priv-info');
      if (r.status === 404) { await noteFail(env, request); return json({ error: 'noroom' }, 404); }
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (path === '/api/mp/ws' && request.method === 'GET') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      if (!sameOrigin(request)) return json({ error: 'cross-origin' }, 403);
      if (url.searchParams.has('priv')) {
        if (await failBlocked(env, request)) return json({ error: 'ratelimit' }, 429);
        const code = normCode(url.searchParams.get('priv'));
        if (!validCode(code)) { await noteFail(env, request); return json({ error: 'noroom' }, 404); }
        const headers = new Headers(request.headers);
        headers.set('x-mp-room', code); headers.set('x-mp-priv', '1');
        const r = await privStub(env, code).fetch(new Request(request, { headers }));
        if (r.status === 404) await noteFail(env, request);
        return r;
      }
      const room = url.searchParams.get('room');
      if (!validRoom(room)) return json({ error: 'bad room' }, 400);
      const stub = env.MP_ROOM.get(env.MP_ROOM.idFromName(room));
      const headers = new Headers(request.headers);
      headers.set('x-mp-room', room); // set here, so a client cannot choose it
      headers.delete('x-mp-priv');
      return stub.fetch(new Request(request, { headers }));
    }
  } catch (e) {
    console.error('mp route error', e && e.message);
    return json({ error: 'multiplayer unavailable' }, 503);
  }
  return json({ error: 'not found' }, 404);
}
