// Headless multiplayer client speaking the REAL protocol (worker/mp/protocol.js) over Node's WebSocket: used for the 12-client room, the
// human-vs-human kill and the mover double-claim tests. It reads the same object table file the server and the browsers use.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseTable } from '../../worker/mp/table.js';
import { PROTOCOL_VERSION } from '../../worker/mp/protocol.js';
import { speedOf } from '../../worker/mp/sim.js';

export function loadTableFile(distDir) {
  let buf = fs.readFileSync(`${distDir}/data/riga-objects.bin.gz`);   // distDir = a built client dir, or `public`
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return parseTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Bot {
  constructor({ base, name, table, token }) {
    this.base = base; this.name = name; this.table = table;
    this.token = token || 'bot' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    this.me = -1; this.x = 0; this.z = 0; this.r = 2.2; this.score = 0;
    this.msgs = []; this.eaten = new Set(); this.seq = 0; this.acks = []; this.kills = []; this.resp = []; this.holes = new Map();
    this.state = 'new'; this.final = null; this.errCode = null; this.closed = false; this.lastSnap = null;
    this.goal = null; this.timer = null; this.farm = false; this.walk = true;
  }
  async join(room) {
    if (!room) { const j = await (await fetch(this.base + '/api/mp/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json(); room = j.room; }
    this.room = room;
    const ws = new WebSocket(`${this.base.replace('http', 'ws')}/api/mp/ws?room=${room}`);
    this.ws = ws;
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data));
    ws.onclose = () => { this.closed = true; clearInterval(this.timer); };
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.token, hash: this.table.hash });
    this.pingT = setInterval(() => this.send({ t: 'ping', c: performance.now(), r: 0 }), 2500);
    return room;
  }
  send(m) { try { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); } catch { /* */ } }
  onMsg(m) {
    this.msgs.push(m); if (this.msgs.length > 400) this.msgs.shift();
    switch (m.t) {
      case 'lobby': this.state = 'lobby'; this.me = m.you; this.players = m.players; break;
      case 'start': case 'resume':
        this.state = 'playing'; this.me = m.you;
        for (const h of m.holes) { this.holes.set(h.id, { ...h, r: 2.2, score: 0 }); if (h.id === m.you) { this.x = h.x; this.z = h.z; } }
        if (m.eaten) for (const id of m.eaten) this.eaten.add(id);
        this.start = m;
        this.pu = new Map((m.pu || []).map(([slot, type, x, z]) => [slot, { slot, type, x, z }])); this.pickups = [];
        if (!this.timer) this.timer = setInterval(() => this.tick(), 80);
        break;
      case 's':
        this.lastSnap = m;
        for (const row of m.h) { const [id, x, z, r, score, st] = row; const h = this.holes.get(id) || {}; Object.assign(h, { id, x, z, r, score, st }); this.holes.set(id, h); if (id === this.me) { this.r = r; this.score = score; this.st = st; } }
        if (m.e) for (const [oid] of m.e) this.eaten.add(oid);
        if (m.k) for (const k of m.k) this.kills.push({ k, at: Date.now() });
        if (m.r) for (const r of m.r) { this.resp.push({ r, at: Date.now() }); if (r[0] === this.me) { this.x = r[1]; this.z = r[2]; } }
        if (m.d) for (const id of m.d) this.holes.delete(id);
        if (m.ps) for (const [slot, type, x, z] of m.ps) this.pu.set(slot, { slot, type, x, z });
        if (m.px) for (const slot of m.px) this.pu.delete(slot);
        if (m.pp) for (const [slot, hole, type] of m.pp) { this.pu.delete(slot); this.pickups.push({ slot, hole, type, at: Date.now() }); }
        if (m.h) for (const row of m.h) if (row[0] === this.me) this.mask = row[6] || 0;
        break;
      case 'a': this.acks.push(m); this.score = m.s; this.mass = m.m; this.combo = { c: m.c, cm: m.cm }; this.fx = m.fx; break;
      case 'rb': this.x = m.x; this.z = m.z; break;
      case 'end': this.state = 'ended'; this.final = m.rank; break;
      case 'err': this.errCode = m.code; break;
      case 'saved': this.saved = m.ok; break;
      default: break;
    }
  }
  /** 12 Hz position (+ claims while farming) */
  tick() {
    if (this.state !== 'playing' || this.st === 1 || this.st === 2) return;
    const msg = { t: 'u', q: ++this.seq, x: Math.round(this.x * 10) / 10, z: Math.round(this.z * 10) / 10 };
    if (this.walk) {
      if (this.farm && !this.goal) this.goal = this.nearestEdible();
      if (this.goal) {
        const sp = Math.min(speedOf(this.r) * 0.8, 40) * 0.08;
        const dx = this.goal.x - this.x, dz = this.goal.z - this.z, d = Math.hypot(dx, dz);
        if (d > 0.01) { const k = Math.min(1, sp / d); this.x += dx * k; this.z += dz * k; }
        msg.x = Math.round(this.x * 10) / 10; msg.z = Math.round(this.z * 10) / 10;
        if (this.goal.id != null && d < this.r * 0.6) { msg.c = [this.goal.id]; this.eaten.add(this.goal.id); this.goal = null; }
        else if (this.goal.id == null && d < 1.5) this.goal = null;
      }
    }
    this.send(msg);
  }
  nearestEdible() {
    const t = this.table; let best = -1, bd = 1e12;
    const maxFit = this.r * 0.85;
    for (let i = 0; i < t.n; i++) {
      if (this.eaten.has(i) || t.fit[i] >= maxFit || (t.flags[i] & 1)) continue;
      const d = (t.x[i] - this.x) ** 2 + (t.z[i] - this.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? { id: best, x: t.x[best], z: t.z[best] } : null;
  }
  async until(fn, ms = 20000, step = 100) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); } return false; }
  close() { clearInterval(this.timer); clearInterval(this.pingT); try { this.ws.close(); } catch { /* */ } }
}
