import { chromium, devices } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const vd of ['1000', '1500', '2500', '6000']) for (const city of ['1']) {
  const ctx = await b.newContext({ ...devices['Pixel 5'] }), p = await ctx.newPage();
  await p.goto(`http://localhost:5193/tramvajs/?route=mezaparks&run=full&lang=en&autostart=1&city=${city}&vd=${vd}`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  await p.evaluate(() => window.__tram.setAuto('perfect')); await p.waitForTimeout(4000);
  const r = await p.evaluate(() => window.__tram.S.renderer.info.render); console.log('vd', vd, 'city', city, r.calls, 'calls', (r.triangles / 1e6).toFixed(2), 'M tri'); await ctx.close();
}
await b.close();
