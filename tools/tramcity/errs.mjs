// print page errors of the tram game load: node tools/tramcity/errs.mjs [query]
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] }); const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 400))); p.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 400)); });
await p.goto('http://localhost:5193/tramvajs/?route=centrs-3&lang=en&' + (process.argv[2] || '')); await p.waitForTimeout(15000); await b.close();
