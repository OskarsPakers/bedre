import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto('http://localhost:5193/tramvajs/?route='+(process.argv[2]||'centrs-3')+'&lang=en');
await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(()=>window.__streetCheck(1.6,true))));
await b.close();
