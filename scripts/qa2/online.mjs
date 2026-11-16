// full online round with mixed clients. usage: node online.mjs <tag>
import * as L from './lib.mjs';
const tag = process.argv[2] || 'on1';
const defs = [
  { k: 'A', prof: { eng: 'chromium', name: 'A-chr' }, name: '<b>Ann</b>&"x', phone: false },
  { k: 'B', prof: { eng: 'webkit', dev: 'iPhone 13', name: 'B-wk13' }, name: 'Žanis😀', phone: true },
  { k: 'C', prof: { eng: 'firefox', name: 'C-ff' }, name: 'Cēsu Jānis', phone: false },
  { k: 'D', prof: { eng: 'chromium', dev: 'Pixel 5', name: 'D-px5' }, name: 'Dace', phone: true },
  { k: 'E', prof: { eng: 'webkit', dev: 'iPhone SE', name: 'E-se' }, name: 'Edgars', phone: true },
];
const C = {};
for (const d of defs) { d.p = await L.open(d.prof, { name: d.name, lang: d.k === 'C' ? 'lv' : 'en', q: 'quality=low&radio=0' }); C[d.k] = d; await L.load(d.p); }
const tap = async (d, sel) => d.phone ? L.T.tapEl(d.p, sel) : d.p.click(sel);
await Promise.all(defs.map((d) => L.shot(d.p, 'on-menu')));
await Promise.all(defs.map((d) => tap(d, '#play-online')));
await L.sleep(4000);
for (const d of defs) await L.shot(d.p, `${tag}-lobby`);
const lob = await Promise.all(defs.map((d) => d.p.evaluate(() => ({ st: window.__online.state, room: window.__online.room, n: window.__online.lobby?.players.length, startsAt: window.__online.lobby?.startsAt, now: window.__online.serverNow(), cnt: document.getElementById('mp-count')?.textContent }))));
console.log('LOBBY', JSON.stringify(lob));
// drive loop per client
let stop = false; const drivers = defs.map(async (d) => {
  while (!stop) {
    try {
      const ph = await d.p.evaluate(() => window.__online.state);
      if (ph !== 'playing') { await L.sleep(500); continue; }
      if (d.phone) await L.stickDrive(d.p, 3000); else {
        const { w, h } = await L.vp(d.p); const t0 = Date.now();
        while (Date.now() - t0 < 3000) { const s = await L.steerStep(d.p); if (s.has) await d.p.mouse.move(Math.max(5, Math.min(w - 5, s.sx)), Math.max(5, Math.min(h - 5, s.sy))); else await d.p.mouse.move(w / 2 + 60, h / 3); await L.sleep(120); }
      }
    } catch (e) { await L.sleep(500); }
  }
});
const samples = []; const t0 = Date.now(); let n = 0;
const snap = async () => Promise.all(defs.map((d) => d.p.evaluate(() => { const o = window.__online; const rem = o.remotes(); return { st: o.state, me: o.me, sc: o.serverScore, r: o.self.radius, alive: o.self.alive, rem: rem.length, rb: o.log.filter((m) => m.t === 'rb').length, bad: o.log.filter((m) => m.t === 'a' && m.b && m.b.length).length, left: o.round ? Math.round((o.round.endAt - o.serverNow()) / 1000) : null, fr: window.__fr || null }; }).catch((e) => ({ err: e.message }))));
const sch = { 60: async () => { await C.C.p.context().setOffline(true); await L.sleep(3000); await C.C.p.context().setOffline(false); L.note('C offline 3s'); },
  110: async () => { await C.B.p.context().setOffline(true); await L.sleep(12000); await C.B.p.context().setOffline(false); L.note('B offline 12s'); },
  170: async () => { await C.D.p.reload(); L.note('D reloaded mid-round'); },
  230: async () => { await C.E.p.context().setOffline(true); await L.sleep(20000); await C.E.p.context().setOffline(false); L.note('E offline 20s'); } };
const fired = new Set();
while (true) {
  const el = Math.round((Date.now() - t0) / 1000);
  for (const k of Object.keys(sch)) if (el >= +k && !fired.has(k)) { fired.add(k); sch[k]().catch((e) => L.note('sch err ' + e.message)); }
  const s = await snap(); samples.push({ el, s });
  if (n % 3 === 0) { console.log('T+' + el, JSON.stringify(s.map((x) => [x.st, x.sc, x.rem, x.left, x.rb, x.bad]))); }
  if (n % 4 === 1) for (const d of defs) await L.shot(d.p, `${tag}-t${el}`);
  if (s.every((x) => x.st === 'ended' || x.st === 'menu' || x.st === 'lobby') && el > 60) break;
  if (el > 520) break; n++; await L.sleep(8000);
}
stop = true; await L.sleep(2500);
for (const d of defs) await L.shot(d.p, `${tag}-end`);
const fin = await Promise.all(defs.map((d) => d.p.evaluate(() => ({ st: window.__online.state, final: window.__online.final?.map((r) => `${r.rank}.${r.name}:${r.score}${r.bot ? 'b' : ''}`), saved: window.__online.saved })).catch((e) => ({ err: e.message }))));
console.log('FINAL', JSON.stringify(fin, null, 1));
console.log('NAV/WS', JSON.stringify(defs.map((d) => [d.k, d.p.__nav, d.p.__crash, d.p.__wsclose])));
console.log('ERRS', JSON.stringify(L.log.errs.slice(0, 40)));
console.log('NOTES', JSON.stringify(L.log.notes));
import fs from 'node:fs'; fs.writeFileSync(`scripts/.qa2-${tag}-samples.json`, JSON.stringify(samples));
await L.closeAll();
