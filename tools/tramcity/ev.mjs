// evaluate JS in the loaded tram game: node tools/tramcity/ev.mjs "<expression using window.__tram>" [route]
import { chromium } from 'playwright';
const [expr, route = 'centrs-3'] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
await p.goto(`http://localhost:5198/tramvajs/?route=${route}&lang=en&quality=high`);
await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(new Function('return (' + expr + ')')), null, 0)); await b.close();
