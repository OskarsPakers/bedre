// Signature-building shots (round 5). node tools/tramcity/sig5.mjs <out.png> <mode> <args...>   env PORT (default 5193), W, H, THEME (day|evening|winter), QUERY (extra url query)
//   mode cam  x y z lx ly lz [fov]        absolute camera (world metres, y up)
//   mode drive route s view(cab|chase)    deterministic drive to s along the route
// uses the dev server only; the HUD is hidden.
import { chromium } from 'playwright';
const [out, mode, ...a] = process.argv.slice(2); const PORT = process.env.PORT || 5193, W = +(process.env.W || 1280), H = +(process.env.H || 720), THEME = process.env.THEME || 'day', Q = process.env.QUERY || '';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
const route = mode === 'drive' ? a[0] : (process.env.ROUTE || 'centrs-3');
await p.goto(`http://localhost:${PORT}/tramvajs/?route=${route}&lang=en&quality=high${Q}`);
await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
if (mode === 'cam') { await p.evaluate(() => { const t = window.__tram; t.setManual(true); t.start('full', t.route.id); }); const [x, y, z, lx, ly, lz, fov = 60] = a.map(Number); await p.evaluate((o) => window.__tram.setCamera(o), { x, y, z, lx, ly, lz, fov }); }
else { const s = +a[1], view = a[2] || 'cab';
  await p.evaluate(({ s, view, route }) => { localStorage.removeItem('tramvajs.intro'); const t = window.__tram; t.setManual(true); t.start('full', route); t.setAuto('perfect'); t.run.awaitBell = false; let k = 0; while (t.run.s < s && k++ < 60000) t.advance(0.1); if (view === 'cab') t.toggleView(); }, { s, view, route }); }
if (THEME !== 'day') await p.evaluate((t) => window.__tram.setTheme(t), THEME);
await p.waitForTimeout(2500); await p.screenshot({ path: out });
const info = await p.evaluate(() => ({ tris: window.__tram.stats(), city: null }));
console.log(JSON.stringify(info)); await b.close();
