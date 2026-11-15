// Tiny matchmaker Durable Object (one instance, id "mm"): knows which room is the open lobby, assigns joining players to it and
// keeps a short summary of running rounds for the lobby's "spectate" list. Rooms report their state to it (POST /report).
// Memory is the source of truth; the room list is also persisted on assignments / phase changes so an eviction only costs a
// split lobby at worst. No personal data is held (room names, counts, top-5 names + scores of running rounds).
import { mpConfig, MP, validRoom } from './protocol.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const LOBBY_STALE_MS = 120000;   // a lobby that stopped reporting is forgotten
const RUN_STALE_MS = 20000;      // a running room reports every ~2 s

function randomName() {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += MP.names[b % MP.names.length];
  return s;
}

export class MpMatchmaker {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cfg = mpConfig(env);
    this.rooms = new Map(); // name -> {phase, humans, startsAt, endAt, top, upd, created}
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('rooms');
      if (saved) for (const [k, v] of Object.entries(saved)) this.rooms.set(k, v);
    });
  }

  persist() { return this.ctx.storage.put('rooms', Object.fromEntries(this.rooms)); }

  prune(now) {
    for (const [k, r] of this.rooms) {
      const age = now - r.upd;
      if (r.phase === 'closed' || (r.phase === 'lobby' && age > LOBBY_STALE_MS) || (r.phase !== 'lobby' && age > RUN_STALE_MS + (r.phase === 'ended' ? 90000 : 0))) this.rooms.delete(k);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);
    if (url.pathname === '/assign') {
      const bad = url.searchParams.get('bad');          // a client could not use this room (closed / gone): forget it
      if (bad && validRoom(bad)) this.rooms.delete(bad);
      return this.assign(now);
    }
    if (url.pathname === '/report' && request.method === 'POST') return this.report(await request.json().catch(() => null), now);
    if (url.pathname === '/known') return json({ known: this.rooms.has(url.searchParams.get('room') || '') });
    if (url.pathname === '/status') return this.status(now);
    return json({ error: 'not found' }, 404);
  }

  assign(now) {
    let pick = null;
    for (const [name, r] of this.rooms) {
      if (r.phase === 'lobby' && r.humans < this.cfg.maxHumans && (!pick || r.created < pick[1].created)) pick = [name, r];
    }
    let created = false;
    if (!pick) {
      const name = randomName();
      const r = { phase: 'lobby', humans: 0, startsAt: null, endAt: null, top: null, upd: now, created: now };
      this.rooms.set(name, r);
      pick = [name, r];
      created = true;
    }
    pick[1].humans++;      // reservation; the room's next report replaces it with the truth
    pick[1].upd = Math.max(pick[1].upd, now);
    if (created) this.ctx.waitUntil(this.persist());
    return json({ room: pick[0], max: this.cfg.maxHumans });
  }

  report(b, now) {
    if (!b || !validRoom(b.room)) return json({ error: 'bad report' }, 400);
    const phase = ['lobby', 'intro', 'playing', 'ended', 'closed'].includes(b.phase) ? b.phase : 'lobby';
    const prev = this.rooms.get(b.room);
    const r = prev || { created: now };
    r.phase = phase;
    r.humans = Math.max(0, Math.min(16, b.humans | 0));
    r.startsAt = Number.isFinite(b.startsAt) ? b.startsAt : null;
    r.endAt = Number.isFinite(b.endAt) ? b.endAt : null;
    r.top = Array.isArray(b.top) ? b.top.slice(0, 5).map((x) => ({ n: String(x.n).slice(0, 16), s: x.s | 0, b: x.b ? 1 : 0 })) : null;
    r.upd = now;
    this.rooms.set(b.room, r);
    if (!prev || prev.phase !== phase) this.ctx.waitUntil(this.persist());
    return json({ ok: true });
  }

  status(now) {
    let open = null;
    const running = [];
    for (const [, r] of this.rooms) {
      if (r.phase === 'lobby' && r.humans < this.cfg.maxHumans && (!open || r.created < open.created)) open = r;
      else if (r.phase === 'intro' || r.phase === 'playing') running.push({ timeLeft: r.endAt ? Math.max(0, Math.round((r.endAt - now) / 1000)) : null, top: r.top || [], humans: r.humans });
    }
    return json({
      v: 1, serverTime: now, max: this.cfg.maxHumans,
      open: open ? { humans: open.humans, startsIn: open.startsAt ? Math.max(0, Math.round((open.startsAt - now) / 1000)) : null } : null,
      running,
    });
  }
}
