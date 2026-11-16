// READ-ONLY on the live site: load, open panels, free roam only (nothing submitted)
import { launch, newPage, sleep, note } from './lib.mjs';
process.env.BASE = 'https://bedre.pakers.lv';
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV' });
const p = await ctx.newPage();
const posts = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) note('[live] console.' + m.type() + ': ' + m.text().slice(0, 250)); });
p.on('pageerror', (e) => note('[live] PAGEERROR ' + e.message));
p.on('requestfailed', (r) => note('[live] REQFAIL ' + r.url().slice(0, 120) + ' ' + (r.failure() && r.failure().errorText)));
p.on('response', (r) => { if (r.status() >= 400) note('[live] HTTP ' + r.status() + ' ' + r.url().slice(0, 120)); });
p.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url().slice(0, 100)); });
const t0 = Date.now();
await p.goto('https://bedre.pakers.lv/', { waitUntil: 'load' });
await p.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 90000 });
note('live ready in ' + (Date.now() - t0) + ' ms; timing=' + JSON.stringify(await p.evaluate(() => window.__timing)));
await p.screenshot({ path: 'scripts/out/qa1-live-start.png' });
await p.click('#open-scores'); await sleep(2000); await p.screenshot({ path: 'scripts/out/qa1-live-scores.png' });
note('live scores rows: ' + await p.evaluate(() => [...document.querySelectorAll('#ts-body tr')].slice(0, 5).map(r => r.textContent.replace(/\s+/g, ' ')).join(' / ')) + ' msg=' + await p.evaluate(() => document.getElementById('ts-msg').textContent));
await p.keyboard.press('Escape'); await sleep(300);
await p.click('#open-about'); await sleep(300); await p.keyboard.press('Escape');
await p.goto('https://bedre.pakers.lv/?mode=free&autostart=1&intro=0'); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(2000);
for (let i = 0; i < 40; i++) { const a = i / 4; await p.mouse.move(640 + Math.cos(a) * 250, 400 + Math.sin(a) * 150); await sleep(250); }
await p.screenshot({ path: 'scripts/out/qa1-live-free.png' });
note('live free state ' + JSON.stringify(await p.evaluate(() => ({ s: window.__game.state, un: window.__game.unranked, hooks: Object.keys(window.__game).length }))));
note('live non-GET requests: ' + JSON.stringify(posts));
await b.close();
