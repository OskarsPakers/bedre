import * as L from './lib.mjs';
import fs from 'node:fs';
const st = async () => (await fetch(L.BASE + '/api/mp/status')).json();
const R = {};
const DELAY = 350;
const mk = async (prof, name, init) => { const p = await L.open(prof, { name }); if (init) await p.context().addInitScript(init); await L.load(p); return p; };
const LAT = `(() => { const W = window.WebSocket; window.WebSocket = function (u, pr) { const ws = new W(u, pr); const os = ws.send.bind(ws); ws.send = (d) => setTimeout(() => { try { os(d); } catch {} }, ${DELAY});
  const desc = Object.getOwnPropertyDescriptor(W.prototype, 'onmessage'); let h = null; Object.defineProperty(ws, 'onmessage', { set(f) { h = f; desc.set.call(ws, (e) => setTimeout(() => h && h(e), ${DELAY})); }, get() { return h; } }); return ws; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); })();`;
const A = await mk({ eng: 'chromium', name: 'fast' }, 'Fast'), B = await mk({ eng: 'chromium', name: 'lag' }, 'Lag700', LAT);
await A.click('#play-online'); await B.click('#play-online');
const until = async (p, fn, to = 30000) => { const t = Date.now(); while (Date.now() - t < to) { if (await p.evaluate(fn).catch(() => false)) return true; await L.sleep(200); } return false; };
await until(A, () => window.__online.state === 'playing'); await until(B, () => window.__online.state === 'playing');
let stop = false;
const drv = async (p) => { while (!stop) { const { w, h } = await L.vp(p); const t0 = Date.now(); while (Date.now() - t0 < 3000 && !stop) { const s = await L.steerStep(p); if (s.has) await p.mouse.move(Math.max(5, Math.min(w - 5, s.sx)), Math.max(5, Math.min(h - 5, s.sy))); await L.sleep(120); } } };
const d1 = drv(A), d2 = drv(B);
const rows = [];
for (let i = 0; i < 7; i++) { await L.sleep(8000); const g = async (p) => p.evaluate(() => { const o = window.__online; return { sc: o.serverScore, opt: o.optimistic, rb: o.log.filter((m) => m.t === 'rb').length, rej: o.log.filter((m) => m.t === 'a' && m.b?.length).reduce((a, m) => a + m.b.length, 0), alive: o.self.alive, rtt: Math.round(window.__online.rtt ?? -1) }; }); rows.push({ fast: await g(A), lag: await g(B) }); }
await L.shot(B, 'lag-play'); await L.shot(A, 'fast-play');
R.lat = rows;
// A sees B's position vs B's real
R.seen = await A.evaluate(() => window.__online.remotes().filter(h => !h.bot).map(h => ({ id: h.id, x: h.x, z: h.z })));
R.bSelf = await B.evaluate(() => ({ me: window.__online.me, x: window.__online.self.x, z: window.__online.self.z }));
stop = true; await d1; await d2;
R.badgeLag = await B.evaluate(() => { const e = document.getElementById('mp-net'); const r = e?.getBoundingClientRect(); return e ? { t: e.textContent, w: r.width, h: r.height } : null; });
// S6 last human leaves mid round
await A.evaluate(() => window.__online.leave()); await L.sleep(1500); R.s6_a = await st(); await B.evaluate(() => window.__online.leave()); await L.sleep(2500); R.s6_b = await st(); await L.sleep(15000); R.s6_c = await st();
R.errs = L.log.errs; fs.writeFileSync('scripts/.qa2-edge2.json', JSON.stringify(R, null, 1)); console.log('done'); await L.closeAll();
