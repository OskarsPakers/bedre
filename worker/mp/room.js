// One Durable Object per room: lobby -> intro -> playing -> results. Sockets use the WebSocket Hibernation API, so a lobby (no
// timers, just one alarm for the countdown) is evicted from memory between messages; lobby members live in the sockets'
// attachments. While a round runs a setInterval (20 Hz sim, 10 Hz snapshot) keeps the object active; it is cleared at the end.
import { mpConfig, parseClientMessage, RateLimiter, validToken, validRoom, validCode, PROTOCOL_VERSION } from './protocol.js';
import { sanitizeName } from '../lib/moderation.js';
import { insertScore } from '../lib/db.js';
import { parseTable, inflateIfGzip } from './table.js';
import { RoomSim } from './sim.js';
import { fxRemain } from './powerups.js';
import { RULES_VERSION } from '../../src/combo.js';

const MAX_SOCKETS = 40;
const MAX_SCORE = 10_000_000;
const HOST_GRACE_MS = 8000;             // a private lobby's host whose socket dropped (reload, network) keeps the role this long
const MP_PRIV_MAX = 12;                 // humans in a private room (waiting late arrivals count towards it)

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
    this.meta = { name: null, known: false, phase: 'lobby', startsAt: null, nextPid: 0 };   // private (friend) rooms add: priv, code, hostToken, hostSeen, cfgLen, cfgBots, created
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
    const u = new URL(request.url);
    if (u.pathname === '/priv-init' && request.method === 'POST') return this.privInit(request);   // (only the Worker's own routes build these URLs)
    if (u.pathname === '/priv-info') return this.privInfo();
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const name = request.headers.get('x-mp-room');
    const wantsPriv = request.headers.get('x-mp-priv') === '1';
    if (wantsPriv) {
      if (!validCode(name)) return new Response('bad room', { status: 400 });
      if (!this.meta.priv || this.meta.phase === 'closed') return new Response('no such room', { status: 404 });
    } else {
      if (!validRoom(name)) return new Response('bad room', { status: 400 });
      if (this.meta.priv) return new Response('no such room', { status: 404 });
      if (this.meta.phase === 'closed') return new Response('room closed', { status: 410 });
      if (!this.meta.name) { this.meta.name = name; await this.saveMeta(); }
    }
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
    for (const ws of this.ctx.getWebSockets()) { const a = this.att(ws); if (a.pid >= 0 && !a.wait) out.push({ ws, id: a.pid, name: a.name, slot: a.slot, token: a.token, sk: a.sk }); }
    return out;
  }
  /** Private rooms: late arrivals that wait for the next round (they are not in the simulation). */
  waiters() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) { const a = this.att(ws); if (a.pid >= 0 && a.wait) out.push({ ws, id: a.pid, name: a.name, slot: a.slot, token: a.token, sk: a.sk }); }
    return out;
  }
  /** Is anybody (other than `except`) still connected to this room with a seat? */
  lobbyConnected(except) { return this.ctx.getWebSockets().some((w) => w !== except && this.att(w).pid >= 0); }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') return;
    const now = Date.now();
    let lim = this.limiters.get(ws);
    if (!lim) this.limiters.set(ws, (lim = new RateLimiter(this.cfg.msgRate, this.cfg.msgBurst, now)));
    if (!lim.allow(now)) { if (lim.over > 300) { send(ws, { t: 'err', code: 'ratelimit' }); try { ws.close(1008, 'rate'); } catch { /* */ } } return; }
    const m = parseClientMessage(data, this.cfg);
    if (!m) return;
    if (this.sim && this.meta.phase !== 'lobby') { const pid = this.att(ws).pid; const hh = pid >= 0 && this.sim.byId.get(pid); if (hh) hh.lastMsgAt = now; }
    try {
      if (m.t === 'ping') {
        const hh = this.sim && this.meta.phase !== 'lobby' && this.sim.byId.get(this.att(ws).pid);
        if (hh && m.r > 0) hh.rtt = hh.rtt ? hh.rtt * 0.6 + m.r * 0.4 : m.r;   // reported RTT (only widens the combo clock allowance, capped in sim.js)
        return send(ws, { t: 'pong', c: m.c, s: now });
      }
      if (m.t === 'hello') return await this.onHello(ws, m, now);
      const a = this.att(ws);
      if (a.pid < 0) return;
      if (m.t === 'bye') return this.onLeave(ws, a, true);
      if (m.t === 'u') return this.onUpdate(ws, a, m, now);
      if (this.meta.priv) {
        if (m.t === 'cfg') return await this.onCfg(ws, a, m, now);
        if (m.t === 'go') return await this.onGo(ws, a, now);
        if (m.t === 'rematch') return await this.onRematch(ws, a, now);
      }
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
    if (m.hash !== table.hash || m.v !== PROTOCOL_VERSION) return this.refuse(ws, 'version', { hash: table.hash, sv: PROTOCOL_VERSION });
    const priv = !!this.meta.priv;
    if (!priv && !(await this.checkKnown())) return this.refuse(ws, 'room');
    const sk = m.sk;

    const phase = this.meta.phase;
    if (phase === 'lobby' && !this.sim) {
      const players = this.lobbyPlayers();
      const dup = players.find((p) => p.token === m.token);
      if (dup) { // same player reconnecting inside the lobby: take over the slot
        ws.serializeAttachment({ pid: dup.id, name, slot: dup.slot, token: m.token, sk });
        try { dup.ws.serializeAttachment({ pid: -1 }); dup.ws.close(4001, 'replaced'); } catch { /* */ }
      } else {
        if (players.length >= (priv ? MP_PRIV_MAX : this.cfg.maxHumans)) return this.refuse(ws, 'full');
        const used = new Set(players.map((p) => p.slot));
        let slot = 0; while (used.has(slot)) slot++;
        ws.serializeAttachment({ pid: this.meta.nextPid++, name, slot, token: m.token, sk });
      }
      await this.lobbyChanged(now);
      return;
    }
    // a round is (or was) running: only the same player (token) may come back
    if (this.sim && (phase === 'intro' || phase === 'playing' || phase === 'ended')) {
      const h = this.sim.holes.find((x) => !x.bot && x.token === m.token);
      if (!h && priv && phase === 'ended' && !this.lobbyConnected(ws)) {   // nobody is looking at the results any more: the link opens the lobby again
        await this.resetToLobby(now, true);
        return this.onHello(ws, m, now);
      }
      if (!h) {
        const gone = this.sim.left.find((x) => x.token === m.token);
        if (gone && phase === 'ended') { // was away longer than the grace period: still gets the final ranking (with the score it had)
          ws.serializeAttachment({ pid: -1 });
          send(ws, { t: 'left', you: gone.id, ended: true });
          send(ws, this.endMsg(this.savedOk === true));
          return;
        }
        if (gone) return this.refuse(ws, 'left');
        if (priv) return this.joinWaiting(ws, m, name, now);   // a friend arriving mid-round waits in the lobby (and can watch the leaderboard)
        return this.refuse(ws, phase === 'ended' ? 'room' : 'started');
      }
      for (const o of this.ctx.getWebSockets()) { const oa = this.att(o); if (oa.pid === h.id && o !== ws) { try { o.serializeAttachment({ pid: -1 }); o.close(4001, 'replaced'); } catch { /* */ } } }
      ws.serializeAttachment({ pid: h.id, name: h.name, slot: h.slot, token: m.token, sk: h.sk });
      h.connected = true; h.discAt = 0; h.lastMsgAt = now;
      send(ws, this.resumeMsg(h, now));
      if (phase === 'ended') send(ws, this.endMsg(this.savedOk === true));
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
    if (this.meta.priv) return;   // private rooms are never announced to the matchmaker (they cannot be found by public matchmaking)
    const sim = this.sim;
    const body = { room: this.meta.name, phase, humans: sim ? sim.humans().length : this.lobbyPlayers().length, startsAt: this.meta.startsAt, endAt: sim ? sim.endAt : null };
    if (sim && (phase === 'playing' || phase === 'intro')) body.top = sim.ranking().slice(0, 5).map((r) => ({ n: r.name, s: r.score, b: r.bot }));
    this.ctx.waitUntil(this.mm('/report', body).catch(() => {}));
  }

  // ---- lobby ------------------------------------------------------------------------------------------------------------
  lobbyMsg(now, ws) {
    const players = this.lobbyPlayers().sort((x, y) => x.id - y.id);   // oldest first (display order)
    const me = ws ? this.att(ws).pid : -1;
    const m = { t: 'lobby', room: this.meta.name, you: me, players: players.map((p) => ({ id: p.id, name: p.name, slot: p.slot, sk: p.sk })), startsAt: this.meta.startsAt, max: this.cfg.maxHumans, s: now };
    if (this.meta.priv) {
      m.priv = true; m.code = this.meta.code; m.max = MP_PRIV_MAX; m.host = this.hostOf(players); m.phase = this.meta.phase;
      m.cfg = { len: this.meta.cfgLen, bots: this.meta.cfgBots };
      m.ranked = this.meta.cfgLen === 300 && players.length >= 2;   // would a round started now be written to the online leaderboard (needs >= 2 humans at the end too)
      if (ws && this.att(ws).wait) { m.wait = true; m.running = this.runningView(now); }
    }
    return m;
  }

  // ---- private (friend) rooms ------------------------------------------------------------------------------------------
  /** The host: the creator while present, else the oldest remaining player (lowest player id). -1 when the lobby is empty. */
  hostOf(players) {
    if (!players.length) return -1;
    const h = players.find((p) => p.token === this.meta.hostToken);
    if (h) return h.id;
    if (this.meta.hostToken) return -1;   // the host is away (grace period / the creator has not connected yet): lobbyChanged migrates the role when it is time
    return players.reduce((a, b) => (b.id < a.id ? b : a)).id;
  }

  async privInit(request) {
    let b = null; try { b = await request.json(); } catch { /* */ }
    if (!b || !validCode(b.code)) return new Response('bad', { status: 400 });
    if (this.meta.priv && this.meta.phase !== 'closed') return new Response('exists', { status: 409 });
    const now = Date.now();
    this.meta = { name: b.code, known: true, phase: 'lobby', startsAt: null, nextPid: 0, priv: true, code: b.code, hostToken: validToken(b.token) ? b.token : null, hostSeen: false, cfgLen: 300, cfgBots: true, created: now };
    this.sim = null;
    this.meta.expireAt = now + this.cfg.privTtlMs;
    await this.saveMeta();
    await this.ctx.storage.setAlarm(this.meta.expireAt);
    return new Response('ok', { status: 201 });
  }

  privInfo() {
    if (!this.meta.priv || this.meta.phase === 'closed') return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { 'content-type': 'application/json' } });
    const sockets = this.ctx.getWebSockets().filter((w) => this.att(w).pid >= 0).length;
    return new Response(JSON.stringify({ ok: true, phase: this.meta.phase, humans: sockets, max: MP_PRIV_MAX }), { headers: { 'content-type': 'application/json' } });
  }

  runningView(now) {
    const sim = this.sim;
    if (!sim) return null;
    return { timeLeft: Math.max(0, Math.round((sim.endAt - now) / 1000)), top: sim.ranking().slice(0, 5).map((r) => ({ n: r.name, s: r.score, b: r.bot })), phase: this.meta.phase };
  }

  privSeconds(len) { return len === 300 ? this.cfg.roundSeconds : Math.max(5, Math.round(this.cfg.roundSeconds * 0.4)); }

  async onCfg(ws, a, m, now) {
    if (this.meta.phase !== 'lobby' || this.sim || a.wait) return;
    if (this.hostOf(this.lobbyPlayers()) !== a.pid) return;
    this.meta.cfgLen = m.len; this.meta.cfgBots = !!m.bots;
    await this.lobbyChanged(now);
  }

  async onGo(ws, a, now) {
    if (this.meta.phase !== 'lobby' || this.sim || a.wait) return;
    const players = this.lobbyPlayers();
    if (!players.length || this.hostOf(players) !== a.pid) return;
    await this.startRound(now);
  }

  /** A late arrival in a running private round: waits (sees the leaderboard), joins the lobby when the room goes back to it. */
  async joinWaiting(ws, m, name, now) {
    const mine = this.waiters().find((p) => p.token === m.token);
    const taken = new Set([...this.sim.holes.map((h) => h.slot), ...this.waiters().map((p) => p.slot)]);
    if (mine) { try { mine.ws.serializeAttachment({ pid: -1 }); mine.ws.close(4001, 'replaced'); } catch { /* */ } }
    else if (this.sim.humans().length + this.waiters().length >= MP_PRIV_MAX) return this.refuse(ws, 'full');
    let slot = mine ? mine.slot : 0; if (!mine) while (taken.has(slot)) slot++;
    ws.serializeAttachment({ pid: mine ? mine.id : this.meta.nextPid++, name, slot, token: m.token, sk: m.sk, wait: 1 });
    await this.saveMeta();
    send(ws, this.lobbyMsg(now, ws));
  }

  /** Back to the lobby (rematch / nobody left at the results): the round is forgotten, everybody still connected sits in the lobby again. */
  async resetToLobby(now, quiet = false) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.sim = null; this.finalRank = null; this.savedOk = undefined; this.rankedPriv = false;
    this.meta.phase = 'lobby'; this.meta.startsAt = null;
    const seats = [];
    for (const ws of this.ctx.getWebSockets()) { const a = this.att(ws); if (a.pid >= 0) seats.push({ ws, a }); }
    seats.sort((x, y) => x.a.pid - y.a.pid);
    const used = new Set();
    for (const { ws, a } of seats) {
      let slot = a.slot; if (used.has(slot) || a.wait) { slot = 0; while (used.has(slot)) slot++; }
      used.add(slot);
      ws.serializeAttachment({ pid: a.pid, name: a.name, slot, token: a.token, sk: a.sk });
    }
    await this.lobbyChanged(now);
  }

  async onRematch(ws, a, now) {
    if (this.meta.phase !== 'ended') return;
    await this.resetToLobby(now);
  }

  /** Host migration: the oldest remaining player (lowest id). */
  migrateHost(players) {
    const o = players.reduce((x, y) => (y.id < x.id ? y : x));
    this.meta.hostToken = o.token; this.meta.hostSeen = true; this.meta.hostGoneAt = 0;
  }

  async lobbyChanged(now, immediate = false) {
    const players = this.lobbyPlayers();
    const n = players.length;
    if (this.meta.priv) {   // no countdown: the host starts. The link stays valid while anybody is here and for privTtlMs after the last activity.
      this.meta.expireAt = now + this.cfg.privTtlMs;
      let next = this.meta.expireAt;
      if (n) {
        const hp = players.find((p) => p.token === this.meta.hostToken);
        if (hp) { this.meta.hostSeen = true; this.meta.hostGoneAt = 0; }
        else if (!this.meta.hostToken || (!this.meta.hostSeen && now - (this.meta.created || 0) >= 30000)) this.migrateHost(players);
        else if (this.meta.hostSeen) {   // the host's socket is gone: a reload / short drop gets HOST_GRACE_MS to come back (same token), an explicit Leave migrates at once
          if (immediate || (this.meta.hostGoneAt && now - this.meta.hostGoneAt >= HOST_GRACE_MS)) this.migrateHost(players);
          else { this.meta.hostGoneAt = this.meta.hostGoneAt || now; next = Math.min(next, this.meta.hostGoneAt + HOST_GRACE_MS + 150); }
        }
      }
      this.meta.startsAt = null;
      await this.saveMeta();
      await this.ctx.storage.setAlarm(next);
      for (const p of players) send(p.ws, this.lobbyMsg(now, p.ws));
      return;
    }
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
      const h = a.wait ? null : this.sim.byId.get(a.pid);
      if (h && !h.bot) { h.connected = false; h.discAt = now; }
      if (this.meta.priv) { if (this.meta.phase === 'ended') { this.meta.expireAt = now + this.cfg.privTtlMs; this.ctx.waitUntil(this.saveMeta().then(() => this.ctx.storage.setAlarm(this.meta.expireAt))); } return; }
      if (this.meta.phase === 'ended' && this.ctx.getWebSockets().filter((w) => this.att(w).pid >= 0).length === 0) this.ctx.storage.setAlarm(now + (explicit ? 2000 : 20000)); // a reload / drop keeps the results around a little (a returning player still sees them)
      return;
    }
    this.ctx.waitUntil(this.lobbyChanged(now, !!explicit));
  }

  // ---- round ------------------------------------------------------------------------------------------------------------
  async alarm() {
    const now = Date.now();
    try {
      if (this.meta.priv) {
        const ph = this.meta.phase;
        if (ph === 'lobby' && !this.sim) {
          if (this.lobbyConnected(null)) await this.lobbyChanged(now);   // re-arms the TTL, finishes a pending host migration
          else if (now >= (this.meta.expireAt || 0)) await this.cleanup();
          else await this.ctx.storage.setAlarm(this.meta.expireAt);
          return;
        }
        if (ph === 'ended') {
          if (this.lobbyConnected(null)) await this.resetToLobby(now);
          else if (now >= (this.meta.expireAt || 0)) await this.cleanup();
          else await this.ctx.storage.setAlarm(this.meta.expireAt);
          return;
        }
      }
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
    const priv = !!this.meta.priv;
    const secs = priv ? this.privSeconds(this.meta.cfgLen) : this.cfg.roundSeconds;
    const sim = new RoomSim(table, priv && !this.meta.cfgBots ? { ...this.cfg, totalHoles: 0 } : this.cfg, (Math.random() * 2 ** 31) | 0);
    for (const p of players) sim.addHuman(p.name, p.token, p.id, p.slot, p.sk);
    sim.start(now, this.cfg.introMs, secs * 1000);
    this.sim = sim;
    if (priv) this.meta.nextPid = Math.max(this.meta.nextPid, sim.nextId);   // private rooms: late arrivals never reuse a hole id
    this.rankedPriv = false;
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
      holes: s.holes.map((o) => ({ id: o.id, name: o.name, slot: o.slot, bot: o.bot, x: round1(o.x), z: round1(o.z), sk: o.sk })),
      pu: s.puList(),
      ...(this.meta.priv ? { priv: { code: this.meta.code, len: this.meta.cfgLen, ranked: this.meta.cfgLen === 300 } } : null),
    };
  }

  resumeMsg(h, now) {
    const m = this.startMsg(h, now, 'resume');
    m.eaten = this.sim.eatenList;
    m.me = { x: round1(h.x), z: round1(h.z), score: Math.round(h.score), mass: Math.round(h.mass * 10) / 10, state: h.state, fx: fxRemain(h, now), combo: Math.round(h.combo.count), best: Math.round(h.combo.best) };
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
        for (const ws of this.ctx.getWebSockets()) { if (this.meta.priv && this.att(ws).wait) continue; send(ws, text); }
      }
      if (now - this.lastReport > 2000) { this.lastReport = now; this.report(now); if (this.meta.priv) this.waitTick(now); }
      if (sim.humans().length === 0) { if (this.meta.priv) this.resetToLobby(now).catch(() => {}); else this.cleanup().catch(() => {}); } // everybody left: no scores, no results (a private room just becomes an empty lobby again)
    } else if (sim.phase === 'ended' && this.meta.phase !== 'ended') {
      this.endRound(now).catch((e) => console.error('endRound', e && e.message));
    }
  }

  endMsg(saved = false) {
    return { t: 'end', saved, rank: this.finalRank, ...(this.meta.priv ? { priv: { ranked: !!this.rankedPriv, len: this.meta.cfgLen } } : null) };
  }

  /** Late arrivals of a private room: a light view of the running round every ~2 s (no snapshots). */
  waitTick(now) {
    const ws = this.waiters();
    if (!ws.length) return;
    const text = JSON.stringify({ t: 'wait', ...this.runningView(now) });
    for (const w of ws) send(w.ws, text);
  }

  async endRound(now) {
    const sim = this.sim;
    this.meta.phase = 'ended';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // one last snapshot so everybody sees the final numbers, then the ranking
    const text = JSON.stringify(sim.snapshot(now));
    this.finalRank = sim.ranking();
    // a private round is ranked only with the standard length (5:00) and >= 2 humans still in the arena at the end (no farming with bots / short rounds)
    if (this.meta.priv) this.rankedPriv = this.meta.cfgLen === 300 && sim.humans().length >= 2;
    const endText = JSON.stringify(this.endMsg(false));
    for (const ws of this.ctx.getWebSockets()) { send(ws, text); send(ws, endText); }
    await this.saveMeta();
    if (this.meta.priv) { this.meta.expireAt = now + this.cfg.privTtlMs; await this.saveMeta(); }
    await this.ctx.storage.setAlarm(now + (this.meta.priv ? this.cfg.privTtlMs : this.cfg.resultsSeconds * 1000));
    this.report(now, 'ended');
    const ok = await this.saveScores(now).catch((e) => { console.error('scores', e && e.message); return false; });
    this.savedOk = ok;
    const saved = JSON.stringify({ t: 'saved', ok, ...(this.meta.priv && !this.rankedPriv ? { why: 'unranked' } : null) });
    for (const ws of this.ctx.getWebSockets()) send(ws, saved);
  }

  /** The SERVER writes the result of every human that finished the round (mode 'online'); clients never submit these. */
  async saveScores(now) {
    const db = this.env.DB;
    if (!db) return false;
    if (this.meta.priv && !this.rankedPriv) return false;
    const t = Math.floor(now / 1000);
    const humans = new Set(this.sim.humans().map((h) => h.id));
    let ok = true;
    for (const r of this.finalRank) {
      if (!humans.has(r.id)) continue;
      const score = Math.min(MAX_SCORE, Math.max(0, r.score));
      try {
        await insertScore(this.env, { mode: 'online', name: r.name, score, eaten: r.eaten, radius: r.radius, rank: r.rank, kills: r.kills, deaths: r.deaths, roundId: this.meta.priv ? 'p' + this.meta.code + '-' + this.sim.startAt : this.meta.name, createdAt: t, rules: RULES_VERSION });
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
    if (m.c.length || m.m.length || m.p.length) {
      const pb = m.p.length ? sim.handlePickups(h, m.p, now) : [];   // pickups first: a pickup claimed with the batch that swallowed things counts for them
      const res = m.c.length || m.m.length ? sim.handleClaims(h, m.c, m.m, now, m.ct) : { bad: [] };
      const c = h.combo;
      send(ws, { t: 'a', q: m.q, s: Math.round(h.score), m: Math.round(h.mass * 10) / 10, c: Math.round(c.count), cm: c.mult, fx: fxRemain(h, now), b: res.bad, pb });
    }
  }

  async cleanup() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const now = Date.now();
    const priv = !!this.meta.priv;
    if (this.meta.name && !priv) await this.mm('/report', { room: this.meta.name, phase: 'closed', humans: 0 }).catch(() => {});
    for (const ws of this.ctx.getWebSockets()) { try { ws.serializeAttachment({ pid: -1 }); if (priv) send(ws, { t: 'err', code: 'closed' }); ws.close(1000, 'room closed'); } catch { /* */ } }
    this.sim = null;
    this.meta = { name: this.meta.name, known: false, phase: 'closed', startsAt: null, nextPid: 0 };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();   // nothing left behind; a late reconnect fails the matchmaker's "known room" check
  }
}

const round1 = (v) => Math.round(v * 10) / 10;
