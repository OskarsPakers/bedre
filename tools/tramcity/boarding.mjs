// boarding check + screenshots: node tools/tramcity/boarding.mjs [route] [view]   (dev server on :5193)
import { chromium } from 'playwright';
const [route = 'centrs-3', view = 'chase'] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto(`http://localhost:5198/tramvajs/?route=${route}&lang=en&quality=high`);
await pg.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await pg.evaluate(() => { localStorage.removeItem('tramvajs.intro'); const t = window.__tram; t.setManual(false); });
await pg.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
await pg.evaluate(([v]) => { const t = window.__tram; t.start('short', undefined); t.setAuto('perfect'); t.run.awaitBell = false; if (v === 'chase') t.setCamera({ rel: { along: -9, right: 8.5, up: 5.2 }, look: { along: -9, right: 3.2, up: 0.9 }, fov: 62 }); }, [view]);
// run in real time; sample while doors are open at the 2nd stop
let shot = 0; const log = [];
for (let i = 0; i < 1400 && shot < 6; i++) {
  const st = await pg.evaluate(() => { const t = window.__tram, r = t.run, d = r.dwell; return { stop: r.servedStop && r.servedStop.name, door: r.doorState, pax: r.pax, d: d ? { t: +d.t.toFixed(1), al: d.alN, bo: d.boN, wl: d.waitLeft, need: +d.need.toFixed(1), A: d.alight, B: d.board } : null, fig: t.pax ? t.pax.active.length : 0, vis: t.pax ? t.pax.waiting.flat().filter((m) => m.visible).length : 0, v: r.v, s: r.s, last: r.stops ? 0 : 0 }; });
  if (st.d && st.door === 'open' && st.stop && !st.d.last) { log.push(JSON.stringify(st)); if (st.d.t > 0.5 + shot * 1.6 && st.d.B > 0) { await pg.screenshot({ path: `scripts/out/tramcity/tram2-boarding-${route}-${view}-${shot++}.png` }); } }
  await pg.waitForTimeout(250);
  if (shot >= 1 && st.door === 'closed' && !st.d && st.v > 3) break;
}
console.log(log.filter((_, i) => i % 3 === 0).join('\n')); console.log('errs', errs);
await b.close();
