import { chromium } from 'playwright'; import fs from 'node:fs';
const out = '/Users/oskars/projects/holeio/scripts/out/realistic/', W = 1600, H = 900; const flip = process.argv[2] ?? '0'; const only = process.argv[3] ? process.argv[3].split(',').map(Number) : [1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage(); p.on('console', m => console.log('console', m.text())); p.on('pageerror', e => console.log('pageerror', e.message));
const t0 = Date.now(); await p.goto('http://127.0.0.1:5197/c.html?flip=' + flip); await p.waitForFunction(() => window.__c?.ready, null, { timeout: 300000 }); console.log('load wall s', (Date.now() - t0) / 1000);
for (const s of only) for (const mode of ['chase', 'cab']) { await p.evaluate(([s, mode]) => window.__c.view(s, mode), [s, mode]); await p.screenshot({ path: out + `c-${mode}-${s}.png` }); }
const fps = {}; for (const mode of ['chase', 'cab']) fps[mode] = await p.evaluate((m) => window.__c.fps(1250, m, 180), mode);
console.log(JSON.stringify({ info: await p.evaluate(() => window.__c.info()), fps })); await b.close();
