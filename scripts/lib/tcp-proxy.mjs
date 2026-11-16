// Tiny TCP proxy in front of the wrangler dev server: the browser loads the game and opens its WebSocket THROUGH it, so a test can
// really take the network away (Playwright's context.setOffline does not close an already open WebSocket).
//   pass  : bytes flow
//   stall : accepted connections stay open but no byte moves in either direction (a dead network: no FIN, no RST) - new connections hang too
//   cut   : every open connection is destroyed (RST) and new ones are refused until restore()
import net from 'node:net';

export function tcpProxy(listenPort, targetPort) {
  let mode = 'pass';
  const pairs = new Set();
  const server = net.createServer((c) => {
    if (mode === 'cut') { c.destroy(); return; }
    const up = net.connect(targetPort, '127.0.0.1');
    const p = { c, up, held: [], dead: false };
    pairs.add(p);
    const kill = () => { if (p.dead) return; p.dead = true; pairs.delete(p); c.destroy(); up.destroy(); };
    const fwd = (from, to, side) => from.on('data', (d) => { if (mode === 'stall') p.held.push([side, d]); else to.write(d); });
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
    cut() { mode = 'cut'; for (const p of [...pairs]) { p.dead = true; p.c.destroy(); p.up.destroy(); } pairs.clear(); },
    close() { for (const p of pairs) { p.c.destroy(); p.up.destroy(); } server.close(); },
  };
  return api;
}
