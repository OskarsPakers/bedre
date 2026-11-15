// Multiplayer entry: HTTP/WebSocket routes under /api/mp/* and the Durable Object classes (re-exported by worker/index.js).
//   POST /api/mp/join    -> {room, max}          matchmaker assigns the open lobby (or opens a new one)
//   GET  /api/mp/ws?room -> WebSocket upgrade     forwarded to that room's Durable Object (protocol: worker/mp/protocol.js)
//   GET  /api/mp/status  -> lobby / running-round summary for the lobby panel
//   GET  /api/mp/info    -> {hash, bytes}         object-table hash the server expects (clients compare before joining)
import { validRoom, PROTOCOL_VERSION } from './protocol.js';
import { parseTable } from './table.js';

export { MpRoom } from './room.js';
export { MpMatchmaker } from './matchmaker.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
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
      const res = await env.ASSETS.fetch(new Request('https://assets.invalid/mp/objects.bin'));
      if (!res.ok) return json({ error: 'no object table' }, 503);
      const t = parseTable(await res.arrayBuffer());
      return json({ v: PROTOCOL_VERSION, hash: t.hash, objects: t.n });
    }
    if (path === '/api/mp/ws' && request.method === 'GET') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      if (!sameOrigin(request)) return json({ error: 'cross-origin' }, 403);
      const room = url.searchParams.get('room');
      if (!validRoom(room)) return json({ error: 'bad room' }, 400);
      const stub = env.MP_ROOM.get(env.MP_ROOM.idFromName(room));
      const headers = new Headers(request.headers);
      headers.set('x-mp-room', room); // set here, so a client cannot choose it
      return stub.fetch(new Request(request, { headers }));
    }
  } catch (e) {
    console.error('mp route error', e && e.message);
    return json({ error: 'multiplayer unavailable' }, 503);
  }
  return json({ error: 'not found' }, 404);
}
