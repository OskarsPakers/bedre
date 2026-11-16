import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 'ui2', locale: 'lv-LV' });
await p.openGame('');
await p.evaluate(() => localStorage.setItem('bedre.lang', 'lv')); await p.reload(); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(600);
const EN = /\b(the|and|you|your|swallow|swallowed|achievement|unlock|score|time|play|again|share|copy|link|top|today|week|close|map|size|result|progress|objects|not yet|new in album|rank|hole|round|daily|challenge|streak|best|total|eaten|biggest)\b/i;
const grab = async (label, sel) => { const t = await p.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).map(e => e.innerText).join(' || '), sel); const hits = t.match(new RegExp(EN.source, 'gi')); note(`[${label}] EN-looking words: ${hits ? [...new Set(hits.map(h => h.toLowerCase()))].join(',') : 'none'} :: ${t.replace(/\s+/g, ' ').slice(0, 300)}`); };
await p.click('#opts-toggle'); await sleep(300);
await grab('start-adv', '#start');
await p.click('#modesw [data-mode=daily]'); await sleep(600); await p.shot('ui2-daily-menu');
note('daily desc: ' + await p.textContent('#mode-desc') + ' | play: ' + await p.textContent('#play'));
await p.click('#modesw [data-mode=free]'); await sleep(300); note('free desc: ' + await p.textContent('#mode-desc') + ' | play: ' + await p.textContent('#play'));
await p.click('#modesw [data-mode=quick]'); note('quick desc: ' + await p.textContent('#mode-desc'));
for (const d of ['normal', 'hard']) { await p.click(`#diffsw [data-diff=${d}]`); note(d + ' desc: ' + await p.textContent('#diff-desc')); }
for (const th of ['auto', 'day', 'evening', 'winter', 'nov18']) { await p.click(`#opts-body [data-theme=${th}]`); await sleep(200); note(`theme ${th} cap: ` + await p.textContent('#themecap')); }
await p.click('#open-progress'); await sleep(900); await p.shot('ui2-progress-lv'); await grab('progress-objects', '#meta-panel');
const tabs = await p.$$('#meta-panel [role=tab], #meta-panel .tabs button'); note('progress tabs ' + tabs.length);
if (tabs[1]) { await tabs[1].click(); await sleep(500); await p.shot('ui2-ach-lv'); await grab('progress-ach', '#meta-panel'); }
await p.keyboard.press('Escape'); await sleep(300);
await p.click('#open-scores'); await sleep(1200); await p.shot('ui2-scores-lv'); await grab('scores', '#scores');
await p.keyboard.press('Escape'); await sleep(300);
await p.click('#open-about'); await sleep(500); await p.shot('ui2-about-lv'); await grab('about', '#about');
await p.keyboard.press('Escape');
await b.close();
