import { serve, launch } from './perf/lib.mjs';
const srv = await serve('/Users/oskars/projects/holeio/scripts/.dist-eng8798-B', 5185);
const b = await launch('chromium'); const page = await (await b.newContext()).newPage();
page.on('console', m => console.log('c', m.text().slice(0,150)));
page.on('response', r => { if (/objects/.test(r.url())) console.log('resp', r.status(), r.url()); });
await page.goto('http://localhost:5185/?quality=low&intro=0&sw=0', { waitUntil: 'commit' });
await page.waitForFunction(() => document.body && document.body.dataset.ready === '1');
console.log(await page.evaluate(() => JSON.stringify(window.__life.world.placements && {s: window.__life.world.placements.source, r: window.__life.world.placements.reason})));
await b.close(); await srv.close(); process.exit(0);
