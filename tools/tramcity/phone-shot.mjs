import { chromium, devices } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['Pixel 5'] }), p = await ctx.newPage();
await p.goto('http://localhost:5193/tramvajs/?route=mezaparks&run=full&lang=en&autostart=1'); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
await p.evaluate(() => window.__tram.setAuto('perfect')); await p.waitForTimeout(9000); await p.screenshot({ path: 'scripts/out/tramcity/phone-mezaparks.png' }); await b.close();
