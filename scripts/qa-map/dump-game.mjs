// Dump per-building rendered geometry stats from the running game (port 5188) -> tools/.cache/qa-map/game-<map>.json
import { chromium } from 'playwright';
import fs from 'node:fs';
const PORT = process.env.PORT || 5188, base = `http://localhost:${PORT}`;
const maps = (process.env.MAPS || 'centrs,agenskalns,mezaparks,purvciems').split(',');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const MAP of maps) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(`${base}/?quality=low&intro=0&bots=0&theme=day${MAP === 'centrs' ? '' : '&map=' + MAP}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  const items = await page.evaluate(() => window.__life.world.buildingItems.map((it) => ({ id: it.id, x: +it.x.toFixed(1), z: +it.z.toFixed(1), area: +it.area.toFixed(1), h: +it.h.toFixed(2), hBox: +(it.hBox||0).toFixed(2), name: it.name, t: it.t, lm: it.landmark ? 1 : 0, lmH: it.lmH, rec: it.rec ? { hmax: it.rec.hmax, eave: it.rec.eave, vol: it.rec.vol, style: it.rec.style, flags: it.rec.flags, nt: it.rec.nt, src: it.rec.src } : null, sight: it.sight, ruleH: it.rule && it.rule.h || 0, ring: it.ring.map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)]) })));
  fs.writeFileSync(`${process.env.QA_DIR || 'tools/.cache/qa-map'}/game-${MAP}.json`, JSON.stringify(items));
  console.log(MAP, items.length);
  await ctx.close();
}
await browser.close();
