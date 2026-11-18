// Tiny TCP proxy in front of the wrangler dev server: the browser loads the game and opens its WebSocket THROUGH it, so a test can
// really take the network away (Playwright's context.setOffline does not close an already open WebSocket).
//   pass  : bytes flow
//   stall : accepted connections stay open but no byte moves in either direction (a dead network: no FIN, no RST) - new connections hang too
//   cut   : every open connection is destroyed (RST) and new ones are refused until restore()
//   delay(ms, jitterMs): every chunk is delivered ms (+- jitter) late in BOTH directions, order preserved (a laggy network: 300 ms one way = 600 ms RTT)
import net from 'node:net';

export function tcpProxy(listenPort, targetPort) {
  let mode = 'pass', lag = 0, jit = 0;
  const pairs = new Set();
  const server = net.createServer((c) => {
    if (mode === 'cut') { c.destroy(); return; }
    const up = net.connect(targetPort, '127.0.0.1');
    const p = { c, up, held: [], dead: false };
    pairs.add(p);
    const kill = () => { if (p.dead) return; p.dead = true; pairs.delete(p); c.destroy(); up.destroy(); };
    const queue = { up: [], down: [] }, timer = { up: null, down: null };   // one ordered queue + one timer per direction: bytes are never reordered, whatever the jitter
    const pump = (side, to) => {
      if (timer[side] || !queue[side].length) return;
      timer[side] = setTimeout(() => {
        timer[side] = null;
        const now = Date.now(), q = queue[side];
        while (q.length && q[0].at <= now + 0.5) { const e = q.shift(); if (!p.dead && mode !== 'cut') to.write(e.d); }
        pump(side, to);
      }, Math.max(0, queue[side][0].at - Date.now()));
    };
    const fwd = (from, to, side) => from.on('data', (d) => {
      if (mode === 'stall') { p.held.push([side, d]); return; }
      if (lag > 0 || queue[side].length) {
        const last = queue[side].length ? queue[side][queue[side].length - 1].at : 0;
        queue[side].push({ at: Math.max(last, Date.now() + lag + (Math.random() - 0.5) * 2 * jit), d });
        pump(side, to);
      } else to.write(d);
    });
    fwd(c, up, 'up'); fwd(up, c, 'down');
    for (const s of [c, up]) { s.on('error', kill); s.on('close', kill); }
  });
  const api = {
    port: listenPort,
    get mode() { return mode; },
    get open() { return pairs.size; },
    listen: () => new Promise((r) => server.listen(listenPort, '127.0.0.1', r)),
    pass() {
      mode = 'pass';
      for (const p of pairs) { for (const [side, d] of p.held) (side === 'up' ? p.up : p.c).write(d); p.held = []; }
    },
    stall() { mode = 'stall'; },
    delay(ms, jitterMs = 0) { lag = ms; jit = jitterMs; },
    cut() { mode = 'cut'; for (const p of [...pairs]) { p.dead = true; p.c.destroy(); p.up.destroy(); } pairs.clear(); },
    close() { for (const p of pairs) { p.c.destroy(); p.up.destroy(); } server.close(); },
  };
  return api;
}
