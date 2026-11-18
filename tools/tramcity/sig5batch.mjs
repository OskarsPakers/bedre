// Round-5 shots of one signature building into scripts/out/tramcity/sig5-<slug>-<name>.png (dev server :5193, GPU).   node tools/tramcity/sig5batch.mjs opera|stockmann|bernu
//   r4-*   : round-4 look (?sig=0: the recipes of recipes.js)        new-*  : packed asset, day / evening / winter       lod0|1|2 : forced LOD, 3/4 view       wire : wireframe, 3/4 view
import { chromium } from 'playwright'; import fs from 'node:fs';
const slug = process.argv[2], PORT = process.env.PORT || 5193, OUT = 'scripts/out/tramcity/';
const CFG = {
  opera: { route: 'centrs-3', cab: 1232, chase: 1225, cams: { a3q: [-20, 12, 190, 36, 14, 218, 55], b3q: [96, 16, 205, 62, 14, 262, 55] }, hero: [-8, 9, 196, 40, 13, 226, 58] },
  stockmann: { route: 'centrs-3', cab: 1560, chase: 1550, cams: { a3q: [120, 25, 560, 175, 10, 600, 60], b3q: [330, 22, 590, 270, 6, 585, 60] }, hero: [118, 12, 560, 178, 11, 598, 62] },
  bernu: { route: 'centrs-1', cab: 4040, chase: 4030, cams: { a3q: [1228, 4.5, -672, 1260, 9, -645, 62], b3q: [1196, 6, -600, 1262, 9, -640, 60] }, hero: [1226, 4.5, -668, 1262, 10, -646, 62] },
}[slug];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
async function session(query, fn, W = 1280, H = 720) {
  const p = await b.newPage({ viewport: { width: W, height: H } }); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`http://localhost:${PORT}/tramvajs/?route=${CFG.route}&lang=en&quality=high${query}`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
  await p.evaluate((route) => { const t = window.__tram; t.setManual(true); t.start('full', route); }, CFG.route); await fn(p); await p.close();
}
const shot = async (p, name) => { await p.waitForTimeout(1800); await p.screenshot({ path: `${OUT}sig5-${slug}-${name}.png` }); console.log(name); };
const drive = (p, s, chase) => p.evaluate(({ s, chase }) => { const t = window.__tram; t.setAuto('perfect'); t.run.awaitBell = false; t.setCamera(null); let k = 0; while (t.run.s < s && k++ < 60000) t.advance(0.1); if (t.state && 0) void 0; return 1; }, { s, chase });
const view = (p, v) => p.evaluate((v) => { const t = window.__tram; const cur = document.body.dataset.view; void cur; }, v);
const cam = (p, c) => p.evaluate((c) => window.__tram.setCamera({ x: c[0], y: c[1], z: c[2], lx: c[3], ly: c[4], lz: c[5], fov: c[6] }), c);
const theme = (p, t) => p.evaluate((t) => window.__tram.setTheme(t), t);
// round 4
await session('&sig=0', async (p) => { await drive(p, CFG.cab); await p.evaluate(() => window.__tram.toggleView()); await shot(p, 'r4-cab'); await p.evaluate(() => window.__tram.toggleView()); await shot(p, 'r4-chase'); await cam(p, CFG.cams.a3q); await shot(p, 'r4-3q'); await cam(p, CFG.hero); await shot(p, 'r4-hero'); });
// new
await session('', async (p) => {
  await drive(p, CFG.cab); await p.evaluate(() => window.__tram.toggleView()); await shot(p, 'new-cab'); await theme(p, 'evening'); await shot(p, 'new-cab-evening'); await theme(p, 'winter'); await shot(p, 'new-cab-winter'); await theme(p, 'day');
  await p.evaluate(() => window.__tram.toggleView()); await shot(p, 'new-chase'); await theme(p, 'evening'); await shot(p, 'new-chase-evening'); await theme(p, 'winter'); await shot(p, 'new-chase-winter'); await theme(p, 'day');
  for (const [k, c] of Object.entries(CFG.cams)) { await cam(p, c); await shot(p, 'new-' + k); await theme(p, 'evening'); await shot(p, 'new-' + k + '-evening'); await theme(p, 'winter'); await shot(p, 'new-' + k + '-winter'); await theme(p, 'day'); }
  await cam(p, CFG.hero); await shot(p, 'new-hero'); await theme(p, 'evening'); await shot(p, 'new-hero-evening'); await theme(p, 'day');
});
for (const l of [0, 1, 2]) await session('&siglod=' + l, async (p) => { await cam(p, CFG.cams.a3q); await shot(p, 'lod' + l); if (l === 0) { await p.evaluate(() => { const T = window.__tram.S; T.scene.traverse((o) => { if (o.name === 'tram-city') o.visible = false; }); T.scene.traverse((o) => { if (o.name && o.name.startsWith('sig-')) o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.wireframe = true; } }); }); T.scene.traverse((o) => { if (o.name && o.name.startsWith('sig-')) o.visible = true; }); }); await p.evaluate(() => { const T = window.__tram.S; T.scene.traverse((o) => { if (o.name && o.name.startsWith('sig-')) o.traverse((m) => { if (m.isMesh) m.visible = m.visible; }); }); }); await shot(p, 'wire'); } });
await b.close();
