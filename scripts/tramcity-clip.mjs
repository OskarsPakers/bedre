// A short drive past the Opera (centrs-3, s ~ 1050..1600) from the cab: frames of one continuous autopilot run -> scripts/out/tramcity/clip/ + clip.mp4
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = 'scripts/out/tramcity/clip'; fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto('http://localhost:5193/tramvajs/?route=centrs-3&autostart=1&run=full&lang=en&quality=high');
await p.waitForFunction(() => document.body.dataset.ready === '1' && window.__tram.phase === 'play', null, { timeout: 120000 });
await p.evaluate(() => { window.__tram.setAuto('perfect'); if (window.__tram.state().view !== 'cab') window.__tram.toggleView(); });
await p.evaluate(() => window.__tram.advance(1)); // let it start
let n = 0;
for (let i = 0; i < 400 && n < 120; i++) {
  const s = await p.evaluate(() => window.__tram.state().s);
  if (s < 1000) { await p.evaluate(() => window.__tram.advance(6)); continue; }
  if (s > 1650) break;
  await p.screenshot({ path: `${out}/f${String(n++).padStart(3, '0')}.png` }); await p.waitForTimeout(250);
}
console.log('frames', n, JSON.stringify(await p.evaluate(() => { const s = window.__tram.state(); return { s: s.s, phase: s.phase, fin: s.finished }; }))); await b.close();
