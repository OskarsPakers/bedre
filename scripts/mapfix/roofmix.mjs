// Roof colour mix as rendered by the game (vite on PORT, default 5188): area-weighted red-brown / grey / green share per neighbourhood. MAPS=centrs,...
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const map of (process.env.MAPS || 'centrs').split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${process.env.PORT || 5188}/?quality=high&intro=0&bots=0${map === 'centrs' ? '' : '&map=' + map}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  const r = await page.evaluate(() => {
    const zone = (x, z) => { const a = (x + 400) / 520, b = (z - 260) / 380; if (a * a + b * b < 1) return 'old'; if (x > -150 && x < 700 && z > -900 && z < -60) return 'centre'; return 'other'; };
    const acc = {};
    for (const it of window.__life.world.buildingItems) {
      if (it.t === 'ind' || it.t === 'aux' || it.area < 60 || it.roofHex == null) continue;
      const c = it.roofHex, r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, z = zone(it.x, it.z);
      const cls = g - r >= 8 && g - b >= -10 ? 'green' : r - b >= 25 && r - g >= 12 ? 'red' : 'grey';
      const a = (acc[z] ||= { red: 0, grey: 0, green: 0, n: 0 }); a[cls] += it.area; a.n++;
    }
    for (const a of Object.values(acc)) { const t = a.red + a.grey + a.green; a.red = +(a.red / t).toFixed(3); a.grey = +(a.grey / t).toFixed(3); a.green = +(a.green / t).toFixed(3); }
    return acc;
  });
  console.log(map, JSON.stringify(r)); await ctx.close();
}
await browser.close();
