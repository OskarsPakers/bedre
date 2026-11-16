// WebSocket client for the multiplayer rooms: matchmaking call, connect + hello, clock sync (RTT + server-time offset),
// traffic counters. No game logic here. Never throws into the game: failures reject with an Error whose message is a code.
import { PROTOCOL_VERSION } from '../../worker/mp/protocol.js';

const TOKEN_KEY = 'bedre.mp.token';
const DEAD_MS = 5000;   // server frames arrive at 10 Hz in play and a pong every 2.5 s otherwise

/** Random per-tab session token (sessionStorage): lets a dropped connection resume the same hole. */
export function sessionToken() {
  try {
    let tk = sessionStorage.getItem(TOKEN_KEY);
    if (tk && /^[A-Za-z0-9_-]{8,64}$/.test(tk)) return tk;
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    tk = [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
    sessionStorage.setItem(TOKEN_KEY, tk);
    return tk;
  } catch {
    return 'tmp' + Math.random().toString(36).slice(2, 14);
  }
}

async function fetchJson(path, init, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error('http' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

export const fetchStatus = () => fetchJson('/api/mp/status', { cache: 'no-store' }, 4000).catch(() => null);

export class MpClient {
  constructor() {
    this.ws = null;
    this.onMessage = null;   // (msg) => void
    this.onClose = null;     // ({wasOpen, code}) => void
    this.offset = 0;         // serverNow = Date.now() + offset
    this.rtt = 0;
    this.stats = { bytesIn: 0, bytesOut: 0, msgIn: 0, msgOut: 0, snapshots: 0 };
    this._rttBest = [];
    this._pingTimer = null;
    this._watchTimer = null;
    this.lastRx = 0;         // performance.now() of the last frame from the server (any kind)
    this._closing = false;
    this.token = sessionToken();
  }

  /** Use another session token (rejoin from a stored session record). */
  setToken(tk) { if (typeof tk === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(tk)) { this.token = tk; try { sessionStorage.setItem(TOKEN_KEY, tk); } catch { /* */ } } }

  get open() { return !!this.ws && this.ws.readyState === 1; }
  serverNow() { return Date.now() + this.offset; }

  /** Ask the matchmaker for the open lobby. */
  matchmake(badRoom) { return fetchJson('/api/mp/join' + (badRoom ? '?bad=' + encodeURIComponent(badRoom) : ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }

  /** Open the socket and send the hello frame. Resolves when open, rejects (Error code) on failure. */
  connect(room, { name, hash }) {
    this.close(true);
    this._closing = false;
    return new Promise((resolve, reject) => {
      let settled = false, wasOpen = false;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(`${proto}//${location.host}/api/mp/ws?room=${encodeURIComponent(room)}`); } catch { reject(new Error('socket')); return; }
      this.ws = ws;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch { /* */ } reject(new Error('timeout')); } }, 7000);
      ws.onopen = () => {
        wasOpen = true;
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name, token: this.token, hash });
        this.ping();
        clearInterval(this._pingTimer); clearInterval(this._watchTimer);
        this.lastRx = performance.now();
        this._pingTimer = setInterval(() => this.ping(), 2500);
        // app-level liveness: a half-open TCP connection (network cut, no FIN / RST) never fires onclose for a long time. The server
        // answers every ping, so >DEAD_MS without ANY frame means the socket is dead: report it as closed at once.
        this._watchTimer = setInterval(() => this.checkAlive(DEAD_MS), 1000);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        this.lastRx = performance.now();
        this.stats.bytesIn += ev.data.length; this.stats.msgIn++;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'pong') this._pong(m);
        else {
          if (m.t === 's') this.stats.snapshots++;
          if (typeof m.serverTime === 'number' && !this._synced) { this.offset = m.serverTime - Date.now(); this._synced = true; }
          this.onMessage && this.onMessage(m);
        }
      };
      ws.onerror = () => { /* followed by close */ };
      ws.onclose = (ev) => {
        clearInterval(this._pingTimer); clearInterval(this._watchTimer);
        if (ws !== this.ws) return;
        this.ws = null;
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('socket')); }
        if (!this._closing) this.onClose && this.onClose({ wasOpen, code: ev.code });
      };
    });
  }

  /** Dead-socket check: no frame for maxAgeMs -> drop the socket and report onClose (code 4998) without waiting for the TCP stack. */
  checkAlive(maxAgeMs) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || !this.lastRx) return true;
    if (performance.now() - this.lastRx <= maxAgeMs) return true;
    clearInterval(this._pingTimer); clearInterval(this._watchTimer);
    this.ws = null;
    ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* */ }
    if (!this._closing) this.onClose && this.onClose({ wasOpen: true, code: 4998 });
    return false;
  }

  send(obj) {
    if (!this.open) return false;
    const s = JSON.stringify(obj);
    this.stats.bytesOut += s.length; this.stats.msgOut++;
    try { this.ws.send(s); } catch { return false; }
    return true;
  }

  ping() { this.send({ t: 'ping', c: performance.now() }); }

  _pong(m) {
    const rtt = performance.now() - m.c;
    if (!(rtt >= 0 && rtt < 10000)) return;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    this._rttBest.push({ rtt, off: m.s + rtt / 2 - Date.now() });
    if (this._rttBest.length > 8) this._rttBest.shift();
    const best = this._rttBest.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.off; this._synced = true;
  }

  /** Close on purpose (no onClose callback). */
  close(silent = true) {
    this._closing = silent;
    clearInterval(this._pingTimer); clearInterval(this._watchTimer);
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.close(1000); } catch { /* */ } }
  }

  /** Test hook: kill the socket as if the network dropped (onClose fires). */
  dropForTest() { const ws = this.ws; if (ws) { this._closing = false; try { ws.close(4999); } catch { /* */ } } }
}
