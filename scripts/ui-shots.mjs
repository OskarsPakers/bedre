// Ad-hoc UI shots against a running vite server (default :5187). Usage: node scripts/ui-shots.mjs <scenario> [...]
// Scenarios: start-lv start-en start-m-lv start-m-en play-360 play-390 play-430 play-land results-d results-m scores lobby about progress pause
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
const base = `http://localhost:${process.env.PORT || 5187}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const browser = await chromium.launch({ headless: true, args });
const VP = { d: { width: 1280, height: 720 }, m360: { width: 360, height: 640 }, m390: { width: 390, height: 780 }, m430: { width: 430, height: 932 }, land: { width: 780, height: 390 } };
async function open(vp, lang, query = '') {
  const touch = vp !== 'd';
  const ctx = await browser.newContext({ viewport: VP[vp], locale: lang === 'lv' ? 'lv-LV' : 'en-US', hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  await sleep(500);
  return page;
}
const shot = (page, n) => page.screenshot({ path: path.join(out, `ui-${n}.png`) });
const scen = process.argv.slice(2);
for (const s of scen) {
  if (s.startsWith('start')) {
    const [, v, lang] = s.split('-'); const m = s.includes('-m-');
    const page = await open(m ? 'm390' : 'd', s.endsWith('lv') ? 'lv' : 'en');
    await shot(page, s); await page.close();
  } else if (s.startsWith('play')) {
    const vp = { 'play-360': 'm360', 'play-390': 'm390', 'play-430': 'm430', 'play-land': 'land' }[s];
    const page = await open(vp, 'lv', 'autostart=1&intro=0');
    console.log(await page.evaluate(() => [typeof window.__game, document.body.dataset.ready])); await page.evaluate(() => window.__game.autoplay(25));
    await sleep(400); await shot(page, s); await page.close();
  } else if (s === 'results-d' || s === 'results-m') {
    const page = await open(s === 'results-d' ? 'd' : 'm390', 'lv', 'autostart=1&intro=0&time=20');
    console.log(await page.evaluate(() => [typeof window.__game, document.body.dataset.ready])); await page.evaluate(() => window.__game.autoplay(25));
    await sleep(1500); await shot(page, s); await page.close();
  }
}
await browser.close();
