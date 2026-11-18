// Per-route frame-time report on the three device profiles (autopilot drive, day look; same method as smoke-tram's FRAMES lines).
//   node tools/tramcity/frames.mjs [base=http://localhost:5193] [city=1] [seconds=10]      (dev server or preview; GPU through ANGLE/Metal)
import { chromium, webkit, devices } from 'playwright';
const ONLY = process.env.DEV ? process.env.DEV.split(',') : null, ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : ['centrs-1', 'centrs-2', 'centrs-3', 'mezaparks'];
const base = process.argv[2] || 'http://localhost:5193', city = process.argv[3] || '1', secs = +(process.argv[4] || 10);
const gpu = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const DEV = [{ name: 'desktop', engine: chromium, ctx: { viewport: { width: 1280, height: 720 } } }, { name: 'pixel5(4x cpu)', engine: chromium, ctx: { ...devices['Pixel 5'] }, throttle: 4 }, { name: 'iphone13(webkit)', engine: webkit, ctx: { ...devices['iPhone 13'] } }];
for (const D of DEV.filter((d) => !ONLY || ONLY.some((o) => d.name.startsWith(o)))) {
  const br = await D.engine.launch({ headless: true, args: D.engine === chromium ? gpu : [] });
  for (const route of ROUTES) {
    const ctx = await br.newContext(D.ctx), page = await ctx.newPage();
    if (D.throttle) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: D.throttle }); }
    await page.goto(`${base}/tramvajs/?route=${route}&run=full&lang=en&autostart=1&city=${city}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
    await page.evaluate(() => window.__tram.setAuto('perfect')); await page.waitForTimeout(3500);
    await page.evaluate(() => window.__tram.resetFrames()); await page.waitForTimeout(secs * 1000);
    const f = await page.evaluate(() => ({ f: window.__tram.frameStats(), s: window.__tram.S.renderer.info.render, st: window.__tram.stats() }));
    console.log(`${D.name.padEnd(17)} ${route.padEnd(10)} city=${city} ${f.f.n} frames avg ${f.f.avg.toFixed(1)} ms p99 ${f.f.p99.toFixed(1)} max ${f.f.max.toFixed(0)} >33ms:${f.f.over33} | ${f.s.calls} calls ${(f.s.triangles / 1e6).toFixed(2)} M tri`);
    await ctx.close();
  }
  await br.close();
}
