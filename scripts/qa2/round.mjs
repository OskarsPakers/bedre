// one real-input solo round on a phone profile. usage: node round.mjs <cfg> <mode> <map> <scheme> <rotate:0|1> [lang]
import * as L from './lib.mjs';
const CFG = { wk13: { eng: 'webkit', dev: 'iPhone 13', name: 'wk13' }, wkse: { eng: 'webkit', dev: 'iPhone SE', name: 'wkse' }, wkpm: { eng: 'webkit', dev: 'iPhone 14 Pro Max', name: 'wkpm' }, px5: { eng: 'chromium', dev: 'Pixel 5', name: 'px5' } };
const [cfgN, mode = 'quick', map = 'centrs', scheme = 'stick', rot = '0', lang = 'lv'] = process.argv.slice(2);
const prof = { ...CFG[cfgN], land: false };
const label = `${mode}-${map}-${scheme}`;
const p = await L.open(prof, { name: 'QA' + cfgN, lang, q: `quality=low&radio=0&map=${map}&mode=${mode}` , storage: { 'bedre.ctl': scheme } });
await p.addInitScript(() => { window.__fr = { n: 0, long: 0, max: 0, last: performance.now() }; const f = () => { const n = performance.now(), d = n - window.__fr.last; window.__fr.last = n; window.__fr.n++; if (d > 100) window.__fr.long++; if (d > window.__fr.max && d < 5000) window.__fr.max = d; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await L.load(p);
const rotate = async (w, h) => { if (p.__cdp) await p.__cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } }); else await p.setViewportSize({ width: w, height: h }); };
const rec = [];
const S = async (tag) => L.shot(p, `${label}-${tag}`);
await S('start');
await L.T.tapEl(p, '#play'); await L.sleep(1200); await S('intro1'); await L.sleep(2500); await S('intro2');
await p.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 40000 }).catch(() => {});
await L.sleep(600);
let i = 0, rotated = false, land = false; const t0 = Date.now();
while (true) {
  const st = await L.gstate(p); const fr = await p.evaluate(() => ({ ...window.__fr })).catch(() => null);
  rec.push({ i, ...st, fr, wall: Math.round((Date.now() - t0) / 1000) });
  if (st.phase === 'ended' || st.phase === 'menu') break;
  if (Date.now() - t0 > 420000) { L.note('timeout loop'); break; }
  if (rot === '1' && i === 5 && !land) { const v = await L.vp(p); await rotate(v.h, v.w); land = true; await L.sleep(800); await S('rot-land'); }
  if (rot === '1' && i === 9 && land) { const v = await L.vp(p); await rotate(v.h, v.w); land = false; await L.sleep(800); await S('rot-back'); }
  try { await L.stickDrive(p, 5000, { scheme }); } catch (e) { L.note('drive err ' + e.message); await L.sleep(500); }
  if (i % 2 === 0) await S(`p${i}`);
  i++;
}
await L.sleep(1500); await S('results');
const res = await p.evaluate(() => ({ place: document.getElementById('r-place')?.textContent, score: document.getElementById('r-score')?.textContent, vw: innerWidth, vh: innerHeight, tabs: [...document.querySelectorAll('#rtabs button')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }), again: (() => { const r = document.getElementById('again').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; })() }));
console.log('RESULTS', JSON.stringify(res));
for (const t of ['map', 'ach']) { try { await L.T.tapEl(p, `#rtabs [data-rt="${t}"]`); await L.sleep(700); await S('res-' + t); } catch (e) { L.note('tab ' + t + ' ' + e.message); } }
const fin = await p.evaluate(() => ({ fr: window.__fr, nav: 0 }));
console.log('SUMMARY', cfgN, label, JSON.stringify({ rounds: rec.length, last: rec[rec.length - 1], fr: fin.fr, nav: p.__nav, crash: p.__crash, errs: L.log.errs.slice(0, 15), shots: L.log.shots }));
await L.closeAll();
