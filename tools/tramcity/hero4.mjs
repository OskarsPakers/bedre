// hero shot + clip of one deterministic drive past Stockmann and the Opera (centrs-3, s = 1090 .. 1420), chase camera: node tools/tramcity/hero4.mjs   (dev server on :5198)
import { chromium } from 'playwright'; import fs from 'node:fs';
const out = 'scripts/out/tramcity/', cd = out + 'clip4/'; fs.mkdirSync(cd, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:5198/tramvajs/?route=centrs-3&lang=en&quality=high'); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await p.evaluate(() => { localStorage.removeItem('tramvajs.intro'); const t = window.__tram; t.setManual(true); t.start('full', 'centrs-3'); t.setAuto('perfect'); t.run.awaitBell = false; let k = 0; while (t.run.s < 1060 && k++ < 40000) t.advance(0.1); t.toggleView(); });
await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
await p.waitForTimeout(1200);
let n = 0, heroDone = false;
for (let i = 0; i < 150; i++) {
  await p.evaluate(() => window.__tram.advance(0.2)); await p.waitForTimeout(120);
  const s = await p.evaluate(() => window.__tram.run.s);
  if (!heroDone && s > 1190) { await p.screenshot({ path: out + 'hero.png' }); heroDone = true; }
  await p.screenshot({ path: `${cd}f${String(n++).padStart(3, '0')}.png`, scale: 'css' });
  if (s > 1420) break;
}
console.log('frames', n); await b.close();
