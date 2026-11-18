import { chromium } from 'playwright'; import fs from 'node:fs';
const out = '/Users/oskars/projects/holeio/scripts/out/realistic/c-frames/'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await p.goto('http://127.0.0.1:5197/c.html?flip=0'); await p.waitForFunction(() => window.__c?.ready, null, { timeout: 300000 });
for (let i = 0; i < 100; i++) { await p.evaluate((s) => window.__c.view(s, 'chase'), 1200 + i * 0.9); await p.screenshot({ path: out + `f${String(i).padStart(3, '0')}.png` }); }
// 60 s of driving at 10 m/s over the whole corridor: frame time (rAF loop, chase) for the report
const ft = await p.evaluate(() => new Promise(res => { const a = []; let s = 1160, last = performance.now(); const f = () => { const n = performance.now(); a.push(n - last); last = n; window.__c.view(s, 'chase'); s += 10 / 60; if (s < 1540) requestAnimationFrame(f); else { a.sort((x, y) => x - y); res({ frames: a.length, p50: a[a.length >> 1], p95: a[Math.floor(a.length * .95)], max: a[a.length - 1] }); } }; f(); }));
console.log(JSON.stringify(ft)); await b.close();
