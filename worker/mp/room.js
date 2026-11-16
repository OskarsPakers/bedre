// One Durable Object per room: lobby -> intro -> playing -> results. Sockets use the WebSocket Hibernation API, so a lobby (no
// timers, just one alarm for the countdown) is evicted from memory between messages; lobby members live in the sockets'
// attachments. While a round runs a setInterval (20 Hz sim, 10 Hz snapshot) keeps the object active; it is cleared at the end.
import { mpConfig, parseClientMessage, RateLimiter, validToken, validRoom, PROTOCOL_VERSION } from './protocol.js';
import { sanitizeName } from '../lib/moderation.js';
import { insertScore } from '../lib/db.js';
import { parseTable, inflateIfGzip } from './table.js';
import { RoomSim } from './sim.js';

const MAX_SOCKETS = 40;
const MAX_SCORE = 10_000_000;

let tablePromise = null;   // isolate-level cache: the table is identical for every room
/** The server's object table = the very file the clients build their world from (centre map placement file, one source of truth). */
export async function loadTable(env) {
  if (!tablePromise) {
    tablePromise = (async () => {
      const res = await env.ASSETS.fetch(new Request('https://assets.invalid/data/riga-objects.bin.gz'));
      if (!res.ok) throw new Error('riga-objects.bin.gz ' + res.status);
      return parseTable(await inflateIfGzip(await res.arrayBuffer()));
    })().catch((e) => { tablePromise = null; throw e; });
  }
  return tablePromise;
}

const send = (ws, msg) => { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* socket gone */ } };

export class MpRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cfg = mpConfig(env);
    this.meta = { name: null, known: false, phase: 'lobby', startsAt: null, nextPid: 0 };
    this.sim = null;
    this.timer = null;
    this.ticks = 0;
    this.lastReport = 0;
    this.limiters = new WeakMap();
    this.lastRb = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const m = await ctx.storage.get('meta');
      if (m) this.meta = m;
    });
  }

  saveMeta() { return this.ctx.storage.put('meta', this.meta); }

  // ---- connection -----------------------------------------------------------------------------------------------
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const name = request.headers.get('x-mp-room');
    if (!validRoom(name)) return new Response('bad room', { status: 400 });
    if (this.meta.phase === 'closed') return new Response('room closed', { status: 410 });
    if (!this.meta.name) { this.meta.name = name; await this.saveMeta(); }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('busy', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: -1 });
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { try { return ws.deserializeAttachment() || { pid: -1 }; } catch { return { pid: -1 }; } }

  lobbyPlayers() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) { const a = this.att(ws); if (a.pid >= 0) out.push({ ws, id: a.pid, name: a.name, slot: a.slot, token: a.token }); }
    return out;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') return;
    const now = Date.now();
    let lim = this.limiters.get(ws);
    if (!lim) this.limiters.set(ws, (lim = new RateLimiter(this.cfg.msgRate, this.cfg.msgBurst, now)));
    if (!lim.allow(now)) { if (lim.over > 300) { send(ws, { t: 'err', code: 'ratelimit' }); try { ws.close(1008, 'rate'); } catch { /* */ } } return; }
    const m = parseClientMessage(data, this.cfg);
    if (!m) return;
    try {
      if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: now });
      if (m.t === 'hello') return await this.onHello(ws, m, now);
      const a = this.att(ws);
      if (a.pid < 0) return;
      if (m.t === 'bye') return this.onLeave(ws, a, true);
      if (m.t === 'u') return this.onUpdate(ws, a, m, now);
    } catch (e) { console.error('mp message error', e && e.message); }
  }

  async webSocketClose(ws, code) {
    // complete the close handshake (otherwise the browser's socket stays in CLOSING)
    try { ws.close(code >= 1000 && code < 5000 && ![1005, 1006, 1015].includes(code) ? code : 1000, 'closing'); } catch { /* already closed */ }
    this.onLeave(ws, this.att(ws), false);
  }
  async webSocketError(ws) { this.onLeave(ws, this.att(ws), false); }

  // ---- join -------------------------------------------------------------------------------------------------------
  async onHello(ws, m, now) {
    const a = this.att(ws);
    if (a.pid >= 0) return; // already joined on this socket
    const name = sanitizeName(m.name);
    if (!name) return this.refuse(ws, 'name');
    if (!validToken(m.token)) return this.refuse(ws, 'room');
    let table;
    try { table = await loadTable(this.env); } catch (e) { console.error('table', e && e.message); return this.refuse(ws, 'room'); }
    if (m.hash !== table.hash || m.v !== PROTOCOL_VERSION) return this.refuse(ws, 'version', { hash: table.hash });
    if (!(await this.checkKnown())) return this.refuse(ws, 'room');

    const phase = this.meta.phase;
    if (phase === 'lobby' && !this.sim) {
      const players = this.lobbyPlayers();
      const dup = players.find((p) => p.token === m.token);
      if (dup) { // same player reconnecting inside the lobby: take over the slot
        ws.serializeAttachment({ pid: dup.id, name, slot: dup.slot, token: m.token });
        try { dup.ws.serializeAttachment({ pid: -1 }); dup.ws.close(4001, 'replaced'); } catch { /* */ }
      } else {
        if (players.length >= this.cfg.maxHumans) return this.refuse(ws, 'full');
        const used = new Set(players.map((p) => p.slot));
        let slot = 0; while (used.has(slot)) slot++;
        ws.serializeAttachment({ pid: this.meta.nextPid++, name, slot, token: m.token });
      }
      await this.lobbyChanged(now);
      return;
    }
    // a round is (or was) running: only the same player (token) may come back
    if (this.sim && (phase === 'intro' || phase === 'playing' || phase === 'ended')) {
      const h = this.sim.holes.find((x) => !x.bot && x.token === m.token);
      if (!h) return this.refuse(ws, phase === 'ended' ? 'room' : 'started');
      for (const o of this.ctx.getWebSockets()) { const oa = this.att(o); if (oa.pid === h.id && o !== ws) { try { o.serializeAttachment({ pid: -1 }); o.close(4001, 'replaced'); } catch { /* */ } } }
      ws.serializeAttachment({ pid: h.id, name: h.name, slot: h.slot, token: m.token });
      h.connected = true; h.discAt = 0;
      send(ws, this.resumeMsg(h, now));
      if (phase === 'ended') send(ws, this.endMsg());
      return;
    }
    return this.refuse(ws, phase === 'lobby' ? 'gone' : 'room');
  }

  refuse(ws, code, extra) {
    send(ws, { t: 'err', code, ...extra });
    try { ws.close(4000, code); } catch { /* */ }
  }

  async checkKnown() {
    if (this.meta.known) return true;
    try {
      const r = await this.mm('/known?room=' + this.meta.name);
      const j = await r.json();
      if (!j.known) return false;
    } catch { return false; }
    this.meta.known = true; await this.saveMeta();
    return true;
  }

  mm(path, body) {
    const stub = this.env.MP_MATCHMAKER.get(this.env.MP_MATCHMAKER.idFromName('mm'));
    return stub.fetch('https://mm.invalid' + path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  }

  report(now, phase = this.meta.phase) {
    const sim = this.sim;
    const body = { room: this.meta.name, phase, humans: sim ? sim.humans().length : this.lobbyPlayers().length, startsAt: this.meta.startsAt, endAt: sim ? sim.endAt : null };
    if (sim && (phase === 'playing' || phase === 'intro')) body.top = sim.ranking().slice(0, 5).map((r) => ({ n: r.name, s: r.score, b: r.bot }));
    this.ctx.waitUntil(this.mm('/report', body).catch(() => {}));
  }

  // ---- lobby ------------------------------------------------------------------------------------------------------------
  lobbyMsg(now, ws) {
    const players = this.lobbyPlayers();
    const me = ws ? this.att(ws).pid : -1;
    return { t: 'lobby', room: this.meta.name, you: me, players: players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })), startsAt: this.meta.startsAt, max: this.cfg.maxHumans, s: now };
  }

  async lobbyChanged(now) {
    const players = this.lobbyPlayers();
    const n = players.length;
    if (n === 0) {
      this.meta.startsAt = null;
      await this.ctx.storage.deleteAlarm();
    } else if (n >= this.cfg.maxHumans) {
      this.meta.startsAt = now + 300; // full: start right away
      await this.ctx.storage.setAlarm(this.meta.startsAt);
    } else if (this.meta.startsAt == null) {
      this.meta.startsAt = now + this.cfg.lobbySeconds * 1000;
      await this.ctx.storage.setAlarm(this.meta.startsAt);
    }
    await this.saveMeta();
    for (const p of players) send(p.ws, this.lobbyMsg(now, p.ws));
    this.report(now);
  }

  onLeave(ws, a, explicit) {
    try { if (explicit) ws.close(1000, 'bye'); } catch { /* */ }
    if (a.pid < 0) return;
    ws.serializeAttachment({ pid: -1 });
    const now = Date.now();
    if (this.sim && this.meta.phase !== 'lobby') {
      const h = this.sim.byId.get(a.pid);
      if (h && !h.bot) { h.connected = false; h.discAt = now; }
      if (this.meta.phase === 'ended' && this.ctx.getWebSockets().filter((w) => this.att(w).pid >= 0).length === 0) this.ctx.storage.setAlarm(now + 2000);
      return;
    }
    this.ctx.waitUntil(this.lobbyChanged(now));
  }

  // ---- round ------------------------------------------------------------------------------------------------------------
  async alarm() {
    const now = Date.now();
    try {
      if (this.meta.phase === 'lobby' && !this.sim) {
        if (this.lobbyPlayers().length > 0) await this.startRound(now);
      } else if (this.meta.phase === 'intro' || this.meta.phase === 'playing') {
        if (this.sim) this.tick(); // fallback if the interval died
        if (this.sim && this.sim.phase === 'ended') return;
        if (this.sim) await this.ctx.storage.setAlarm(this.sim.endAt + 1000);
      } else if (this.meta.phase === 'ended') {
        await this.cleanup();
      }
    } catch (e) { console.error('alarm error', e && e.message); }
  }

  async startRound(now) {
    const table = await loadTable(this.env);
    const players = this.lobbyPlayers();
    const sim = new RoomSim(table, this.cfg, (Math.random() * 2 ** 31) | 0);
    for (const p of players) sim.addHuman(p.name, p.token, p.id, p.slot);
    sim.start(now, this.cfg.introMs, this.cfg.roundSeconds * 1000);
    this.sim = sim;
    this.meta.phase = 'intro';
    await this.saveMeta();
    await this.ctx.storage.setAlarm(sim.endAt + 1000);
    for (const p of players) send(p.ws, this.startMsg(sim.byId.get(p.id), now));
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1000 / this.cfg.simHz);
    this.report(now, 'intro');
    this.lastReport = now;
  }

  startMsg(h, now, type = 'start') {
    const s = this.sim;
    return {
      t: type, room: this.meta.name, you: h.id, serverTime: now, startAt: s.startAt, playAt: s.playAt, endAt: s.endAt, hash: s.table.hash,
      holes: s.holes.map((o) => ({ id: o.id, name: o.name, slot: o.slot, bot: o.bot, x: round1(o.x), z: round1(o.z) })),
    };
  }

  resumeMsg(h, now) {
    const m = this.startMsg(h, now, 'resume');
    m.eaten = this.sim.eatenList;
    m.me = { x: round1(h.x), z: round1(h.z), score: Math.round(h.score), state: h.state };
    m.snap = this.sim.snapshot(now);        // note: consumes pending events, fine (they are inside `eaten` already)
    return m;
  }

  tick() {
    const sim = this.sim;
    if (!sim) return;
    const now = Date.now();
    if (sim.phase === 'intro' || sim.phase === 'playing') {
      if (this.meta.phase === 'intro' && sim.phase === 'playing') { this.meta.phase = 'playing'; this.saveMeta(); this.report(now, 'playing'); }
      sim.tick(now);
    }
    if (sim.phase === 'playing') {
      this.ticks++;
      if (this.ticks % this.cfg.snapEvery === 0) {
        const text = JSON.stringify(sim.snapshot(now));
        for (const ws of this.ctx.getWebSockets()) send(ws, text);
      }
      if (now - this.lastReport > 2000) { this.lastReport = now; this.report(now); }
      if (sim.humans().length === 0) this.cleanup().catch(() => {}); // everybody left: no scores, no results
    } else if (sim.phase === 'ended' && this.meta.phase !== 'ended') {
      this.endRound(now).catch((e) => console.error('endRound', e && e.message));
    }
  }

  endMsg(saved = false) {
    return { t: 'end', saved, rank: this.finalRank };
  }

  async endRound(now) {
    const sim = this.sim;
    this.meta.phase = 'ended';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // one last snapshot so everybody sees the final numbers, then the ranking
    const text = JSON.stringify(sim.snapshot(now));
    this.finalRank = sim.ranking();
    const endText = JSON.stringify(this.endMsg(false));
    for (const ws of this.ctx.getWebSockets()) { send(ws, text); send(ws, endText); }
    await this.saveMeta();
    await this.ctx.storage.setAlarm(now + this.cfg.resultsSeconds * 1000);
    this.report(now, 'ended');
    const ok = await this.saveScores(now).catch((e) => { console.error('scores', e && e.message); return false; });
    const saved = JSON.stringify({ t: 'saved', ok });
    for (const ws of this.ctx.getWebSockets()) send(ws, saved);
  }

  /** The SERVER writes the result of every human that finished the round (mode 'online'); clients never submit these. */
  async saveScores(now) {
    const db = this.env.DB;
    if (!db) return false;
    const t = Math.floor(now / 1000);
    const humans = new Set(this.sim.humans().map((h) => h.id));
    let ok = true;
    for (const r of this.finalRank) {
      if (!humans.has(r.id)) continue;
      const score = Math.min(MAX_SCORE, Math.max(0, r.score));
      try {
        await insertScore(this.env, { mode: 'online', name: r.name, score, eaten: r.eaten, radius: r.radius, rank: r.rank, kills: r.kills, deaths: r.deaths, roundId: this.meta.name, createdAt: t });
      } catch (e) { ok = false; console.error('score insert', e && e.message); }
    }
    return ok;
  }

  onUpdate(ws, a, m, now) {
    const sim = this.sim;
    if (!sim && this.meta.phase !== 'lobby') { // this object restarted mid-round (deploy / eviction): the round is lost
      send(ws, { t: 'err', code: 'gone' }); try { ws.close(4000, 'gone'); } catch { /* */ } return;
    }
    if (!sim || sim.phase !== 'playing') return;
    const h = sim.byId.get(a.pid);
    if (!h || h.bot) return;
    if (m.x !== null) {
      const rb = sim.handlePos(h, m.x, m.z, now);
      if (rb && now - (this.lastRb.get(h.id) || 0) > 250) { this.lastRb.set(h.id, now); send(ws, { t: 'rb', x: rb.x, z: rb.z }); }
    }
    if (m.c.length || m.m.length) {
      const res = sim.handleClaims(h, m.c, m.m, now);
      send(ws, { t: 'a', q: m.q, s: Math.round(h.score), b: res.bad });
    }
  }

  async cleanup() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const now = Date.now();
    if (this.meta.name) await this.mm('/report', { room: this.meta.name, phase: 'closed', humans: 0 }).catch(() => {});
    for (const ws of this.ctx.getWebSockets()) { try { ws.serializeAttachment({ pid: -1 }); ws.close(1000, 'room closed'); } catch { /* */ } }
    this.sim = null;
    this.meta = { name: this.meta.name, known: false, phase: 'closed', startsAt: null, nextPid: 0 };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();   // nothing left behind; a late reconnect fails the matchmaker's "known room" check
  }
}

const round1 = (v) => Math.round(v * 10) / 10;
