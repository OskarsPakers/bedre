import { launch, newPage, sleep, frameStats, note } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 't0' });
await p.openGame('');
await p.shot('start-lv-1280');
console.log(await p.evaluate(() => ({ kids: [...document.querySelectorAll('#start button, #start select, #start input')].map(e => e.id + '|' + e.className + '|' + (e.textContent||'').trim().slice(0,20)).slice(0,60), title: document.title, lang: document.documentElement.lang })));
await b.close();
