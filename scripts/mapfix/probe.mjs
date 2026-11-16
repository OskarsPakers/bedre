import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage(); page.on('console', m => { if (m.type()==='error') console.log('ERR', m.text().slice(0,1800)); });
await page.goto(`http://localhost:${process.env.PORT||5188}/?map=${process.argv[2]||'mezaparks'}&quality=high&placements=generate&intro=0&bots=0`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
const r = await page.evaluate(() => { const w = window.__life.world; const k = {}; for (const o of w.objects || []) k[o.kind] = (k[o.kind] || 0) + 1; return { src: w.placements && w.placements.source, kinds: k, ndata: w.data && w.data.trees && w.data.trees.length, raster: !!(w.data && w.data.groundRaster), n: (w.objects||[]).length, bld: w.buildingItems.length }; });
const d = await page.evaluate(() => { const x = window.__placementsDump(); return { objects: x.objects, buildings: x.buildings }; }); console.log('dump', JSON.stringify(d)); console.log(JSON.stringify(r)); await browser.close();
