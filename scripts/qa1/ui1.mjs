import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 'ui1', locale: 'lv-LV' });
await p.openGame('');
// scroll start card
const info = await p.evaluate(() => { const s = document.getElementById('start'); const c = s.querySelector('.panel-inner,.card') || s.firstElementChild; return { sh: s.scrollHeight, ch: s.clientHeight, st: getComputedStyle(s).overflowY, inner: c && [c.className, c.scrollHeight, c.clientHeight, getComputedStyle(c).overflowY] }; });
note('start scroll ' + JSON.stringify(info));
await p.click('#opts-toggle');
await sleep(300);
await p.mouse.move(640, 400); await p.mouse.wheel(0, 600); await sleep(500);
await p.shot('ui-start-scrolled-lv');
// theme + quality rows in EN
await p.click('[data-lang=en]'); await sleep(400); await p.mouse.wheel(0, 600); await sleep(300);
await p.shot('ui-start-scrolled-en');
// keyboard tab order
const order = [];
await p.mouse.move(5, 5);
await p.evaluate(() => document.activeElement && document.activeElement.blur());
for (let i = 0; i < 45; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => { const e = document.activeElement; const r = e && e.getBoundingClientRect(); return e ? (e.id || e.dataset.mode || e.dataset.diff || e.dataset.theme || e.dataset.lang || e.className || e.tagName) + '@' + Math.round(r.x) + ',' + Math.round(r.y) + (r.bottom > innerHeight || r.top < 0 ? ' OFFSCREEN' : '') : 'none'; })); }
note('tab order ' + order.join(' | '));
await p.shot('ui-tab-focus');
// panels
await p.click('#open-scores'); await sleep(1500); await p.shot('ui-scores-en');
const tabs = await p.evaluate(() => [...document.querySelectorAll('#scores button, #scores select')].map(e => (e.id || e.className) + ':' + e.textContent.trim().slice(0, 24)));
note('scores controls ' + JSON.stringify(tabs));
await p.keyboard.press('Escape'); await sleep(400);
note('after Esc scores hidden=' + await p.evaluate(() => document.getElementById('scores').classList.contains('hidden')));
await p.click('#open-about'); await sleep(600); await p.shot('ui-about-en'); await p.keyboard.press('Escape'); await sleep(300);
note('after Esc about hidden=' + await p.evaluate(() => document.getElementById('about').classList.contains('hidden')));
await p.click('#open-progress'); await sleep(900); await p.shot('ui-progress-en');
await p.keyboard.press('Escape'); await sleep(300);
note('progress panel still: ' + await p.evaluate(() => !document.querySelector('#meta-panel').classList.contains('hidden')));
await p.screenshot({ path: 'scripts/out/qa1-ui-after-esc.png' });
await b.close();
