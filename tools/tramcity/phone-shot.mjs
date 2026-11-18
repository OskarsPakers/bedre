// Phone screenshots of the tram game on the centre map near the Opera (real WebKit iPhone 13, portrait + landscape; Pixel 5 portrait).  node tools/tramcity/phone-shot.mjs
import { chromium, webkit, devices } from 'playwright';
const gpu = ['--use-angle=metal', '--ignore-gpu-blocklist'];
const T = [['iphone13-portrait', webkit, devices['iPhone 13']], ['iphone13-landscape', webkit, devices['iPhone 13 landscape']], ['pixel5-portrait', chromium, devices['Pixel 5']]];
for (const [name, eng, dev] of T) {
  const b = await eng.launch({ headless: true, args: eng === chromium ? gpu : [] }); const ctx = await b.newContext({ ...dev }), p = await ctx.newPage();
  await p.goto('http://localhost:5193/tramvajs/?route=centrs-3&run=full&lang=en&autostart=1'); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  await p.evaluate(() => window.__tram.setAuto('perfect'));
  await p.waitForFunction(() => window.__tram.metrics.lastS > 1180, null, { timeout: 200000, polling: 500 }).catch(() => {});
  await p.screenshot({ path: `scripts/out/tramcity/phone-${name}.png` }); console.log(name); await b.close();
}
