// Ad-hoc UI shots against a running vite server (default :5187). Usage: node scripts/ui-shots.mjs <scenario> [...]
// Scenarios: adv:<d|m360|m390|land>:<lv|en>[:chip]  (Advanced open; ':chip' = non-default choices) · start-lv start-en start-m-lv start-m-en play-360 play-390 play-430 play-land results-d results-m scores lobby about progress pause
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
  await sleep(1300);
  return page;
}
const shot = (page, n) => page.screenshot({ path: path.join(out, `ui-${n}.png`) });
const MOCK = { scores: [{ name: 'Rūdolfs', score: 182340, radius: 128.2, eaten: 900, difficulty: 'hard' }, { name: 'Anna', score: 154210, radius: 121.5, eaten: 880, difficulty: 'normal' }, { name: 'Tu', score: 99020, radius: 96.1, eaten: 640, difficulty: 'easy' }, { name: 'Jānis-Kristaps', score: 75410, radius: 88, eaten: 500 }] };
async function openMock(vp, lang, query = '') {
  const touch = vp !== 'd';
  const ctx = await browser.newContext({ viewport: VP[vp], locale: lang === 'lv' ? 'lv-LV' : 'en-US', hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  await ctx.route('**/api/scores**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scores: MOCK.scores }) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  await sleep(500);
  return page;
}
const scen = process.argv.slice(2);
for (const s of scen) {
  if (s.startsWith('adv:')) {   // start screen: collapsed + expanded (+ with the summary chip), any viewport / language
    const [, vp, lang, chip] = s.split(':');
    const q = chip ? 'mode=quick&difficulty=hard&theme=evening&map=purvciems' : '';
    const page = await open(vp, lang || 'lv', q);
    await shot(page, `start-collapsed-${vp}-${lang}${chip ? '-chip' : ''}`);
    await page.click('#opts-toggle'); await sleep(350);
    await shot(page, `start-advanced-${vp}-${lang}${chip ? '-chip' : ''}`);
    await page.close(); continue;
  }
  if (s.startsWith('panel:')) {
    const [, name, vp, lang] = s.split(':');
    const page = await openMock(vp, lang || 'lv', name === 'pause' ? 'autostart=1&intro=0' : '');
    if (name === 'scores') { await page.click('#open-scores'); await sleep(900); }
    else if (name === 'scores-daily') { await page.click('#open-scores'); await sleep(300); await page.click('[data-smode=daily]'); await sleep(600); }
    else if (name === 'about') { await page.click('#open-about'); await sleep(300); }
    else if (name === 'progress') { await page.click('#open-progress'); await sleep(500); }
    else if (name === 'progress-ach') { await page.click('#open-progress'); await sleep(300); await page.click('[data-tab=ach]'); await sleep(300); }
    else if (name === 'options') { await page.click('#opts-toggle'); await sleep(300); }
    else if (name === 'pause') { await sleep(2500); await page.keyboard.press('Escape'); await sleep(400); }
    else if (name === 'radio') { await page.evaluate(() => { window.__radio && (window.__radio.pop.hidden = false); }); await sleep(200); }
    await shot(page, `${name}-${vp}-${lang || 'lv'}`); await page.close(); continue;
  }
  if (s === 'start-land-lv' || s === 'start-land-en' || s === 'results-land') {
    const page = await open('land', s.endsWith('en') ? 'en' : 'lv', s === 'results-land' ? 'autostart=1&intro=0&time=20' : '');
    if (s === 'results-land') { await page.evaluate(() => window.__game.autoplay(25)); await sleep(2500); }
    await shot(page, s); await page.close(); continue;
  }
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
    await sleep(2500); console.log(s, await page.evaluate(() => [document.getElementById('r-share').children.length, document.getElementById('rt-badge').textContent])); await shot(page, s); await page.close();
  }
}
await browser.close();
