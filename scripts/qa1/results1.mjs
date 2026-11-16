import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV', permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage(); p.errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) note('[res] console.' + m.type() + ': ' + m.text().slice(0, 200)); });
p.on('pageerror', (e) => note('[res] PAGEERROR ' + e.message));
p.shot = (n) => p.screenshot({ path: `scripts/out/qa1-${n}.png` });
await p.goto('http://127.0.0.1:8801/?mode=free&autostart=1&intro=0&map=mezaparks&theme=day'); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(1500);
// drive a bit with real mouse, aim at towns
for (let i = 0; i < 60; i++) { const a = i / 5; await p.mouse.move(640 + Math.cos(a) * 280, 400 + Math.sin(a) * 160); await sleep(200); }
await p.click('#end-free'); await sleep(2000);
await p.shot('results-free-score');
for (const tab of ['map', 'ach']) { await p.click(`#rtabs [data-rt=${tab}]`); await sleep(900); await p.shot('results-free-' + tab); note(`tab ${tab} text: ` + (await p.evaluate((t) => document.getElementById('rt-' + t).innerText.replace(/\s+/g, ' ').slice(0, 300), tab))); }
await p.click('#rtabs [data-rt=score]');
await p.click('#r-share').catch((e) => note('share click fail ' + e.message.slice(0, 100))); await sleep(1500); await p.shot('results-share');
note('after share: ' + await p.evaluate(() => [...document.querySelectorAll('.toast, #toast, [role=status], dialog, .share-card, canvas')].map(e => e.tagName + '.' + e.className + ':' + (e.innerText || '').slice(0, 60)).join(' | ')));
const clip = await p.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message)); note('clipboard: ' + clip);
await b.close();
