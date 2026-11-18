import { chromium, webkit } from 'playwright'; import fs from 'node:fs';
const [route = 'centrs-3', warp = '0', q = 'balanced', engine = 'chromium'] = process.argv.slice(2); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/'; fs.mkdirSync(out + '_t', { recursive: true });
const b = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage(); p.on('console', m => console.log('console', m.text().slice(0, 200))); p.on('pageerror', e => console.log('pageerror', e.message));
const t0 = Date.now(); await p.goto(`http://localhost:5197/drive.html?route=${route}&q=${q}&auto=1`); 
await p.waitForFunction(() => window.__d, null, { timeout: 120000 }); if (+warp) await p.evaluate((s) => window.__d.warp(s), +warp);
await p.waitForFunction(() => window.__ready, null, { timeout: 240000 }).catch(async () => console.log('not ready', await p.evaluate(() => JSON.stringify(window.__d.status()))));
console.log('ready after', (Date.now() - t0) / 1000, 's', await p.evaluate(() => JSON.stringify(window.__d.status())));
for (const v of [0, 1, 2]) { await p.evaluate((v) => window.__d.setView(v), v); await p.waitForTimeout(2500); await p.screenshot({ path: out + `_t/smoke-${route}-${warp}-v${v}.png` }); }
console.log(await p.evaluate(() => JSON.stringify({ st: window.__d.status(), peak: window.__d.peakTexMB, hitches: window.__d.hitches.slice(0, 5), errs: window.__d.stats }))); await b.close();
