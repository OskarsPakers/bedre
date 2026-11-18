import { chromium } from 'playwright'; const [route, s] = process.argv.slice(2); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/preload/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const q of ['balanced', 'high', 'ultra']) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`http://localhost:5197/drive.html?route=${route}&q=${q}&auto=0`); await p.waitForFunction(() => window.__d); await p.evaluate((s) => window.__d.warp(+s), s);
  await p.waitForFunction(() => window.__ready, null, { timeout: 300000 }); const t0 = Date.now();
  await p.waitForFunction(() => window.__d.sharpAhead >= 300 && window.__d.fbNow === 0 && window.__d.status().inflight === 0, null, { timeout: 120000, polling: 250 }).catch(() => console.log('timeout', q));
  await p.waitForTimeout(1500); console.log(q, 'sharp after', (Date.now() - t0) / 1000, 's', JSON.stringify(await p.evaluate(() => ({ st: window.__d.status(), sharp: window.__d.sharpAhead }))));
  await p.screenshot({ path: `${out}preload-presets-${route}-${s}-${q}.png` }); await p.close();
}
await b.close();
