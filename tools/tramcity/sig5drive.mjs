// in-game screenshots while driving past each signature building: Chromium desktop 1280x720 and real WebKit iPhone 13 portrait. node tools/tramcity/sig5drive.mjs [base=http://localhost:5193]
import { chromium, webkit, devices } from 'playwright';
const base = process.argv[2] || 'http://localhost:5193', OUT = 'scripts/out/tramcity/';
const B = [['opera', 'centrs-3', 1215], ['stockmann', 'centrs-3', 1556], ['bernu', 'centrs-1', 4000]];
const D = [['desktop', chromium, { viewport: { width: 1280, height: 720 } }], ['iphone13', webkit, devices['iPhone 13']]];
for (const [dn, eng, dev] of D) {
  const br = await eng.launch({ headless: true, args: eng === chromium ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  for (const [slug, route, s] of B) {
    const ctx = await br.newContext(dev), p = await ctx.newPage();
    await p.goto(`${base}/tramvajs/?route=${route}&run=full&lang=en&autostart=1`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
    await p.evaluate((s) => { const t = window.__tram; t.setManual(true); t.setAuto('perfect'); t.run.awaitBell = false; let k = 0; while (t.run.s < s && k++ < 60000) t.advance(0.1); t.setManual(false); }, s);
    await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}sig5-${slug}-drive-${dn}.png` }); console.log(slug, dn, await p.evaluate(() => window.__tram.stats().triangles)); await ctx.close();
  }
  await br.close();
}
