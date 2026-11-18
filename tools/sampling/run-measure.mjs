// node tools/sampling/run-measure.mjs [query]   e.g. "limit=5"
import { launch, BASE } from './pw.mjs';
const { b, p } = await launch({ width: 800, height: 600 }); const q = process.argv[2] || '';
await p.goto(`${BASE}/measure.html?${q}`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 3600000, polling: 2000 });
console.log(await p.evaluate(() => document.getElementById('log').textContent)); await b.close();
