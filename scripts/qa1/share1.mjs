import { launch, sleep, note } from './lib.mjs';
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => note('[share] PAGEERROR ' + e.message));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) note('[share] console.' + m.type() + ': ' + m.text().slice(0, 200)); });
await p.goto('http://127.0.0.1:8801/?mode=free&autostart=1&intro=0'); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(1500);
for (let i = 0; i < 30; i++) { await p.mouse.move(640 + Math.cos(i / 4) * 250, 400 + Math.sin(i / 4) * 150); await sleep(200); }
await p.click('#end-free'); await sleep(1500);
note('navigator.share=' + await p.evaluate(() => typeof navigator.share) + ' canShare=' + await p.evaluate(() => typeof navigator.canShare));
const before = await p.evaluate(() => document.body.innerText.length);
const dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await p.click('#r-share'); const d = await dl; await sleep(800);
note('share: download=' + (d ? d.suggestedFilename() : 'none') + ' toasts=' + await p.evaluate(() => [...document.querySelectorAll('#r-share, .toast, [role=status]')].map(e => e.className + ':' + e.textContent).join('|')));
await p.screenshot({ path: 'scripts/out/qa1-share-after.png' });
await p.click('#r-share ~ button, .r-actions button:nth-child(2)').catch((e) => note('copy click fail ' + e.message.slice(0, 80))); await sleep(600);
note('copy label: ' + await p.evaluate(() => [...document.querySelectorAll('.r-actions button')].map(e => e.textContent).join('|')));
await p.screenshot({ path: 'scripts/out/qa1-share-copy.png' });
await b.close();
