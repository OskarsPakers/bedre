// node tools/sampling/run-measure2.mjs [query]  : streaming measurement of the whole centre (measure2.html)
import { launch, BASE } from './pw.mjs'; const q = process.argv[2] || '';
const { b, p } = await launch({ width: 800, height: 600 }); p.setDefaultTimeout(0);
await p.goto(`${BASE}/measure2.html?${q}`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 0, polling: 3000 });
console.log(await p.evaluate(() => document.getElementById('log').textContent)); await b.close();
