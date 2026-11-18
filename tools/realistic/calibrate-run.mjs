// Rail calibration: drives the camera along the route (tiles streamed as usual), measures the lateral offset of the visible rails every 6 m, writes tools/.cache/realistic/offsets-<route>.json
import { chromium } from 'playwright'; import fs from 'node:fs';
const route = process.argv[2] || 'centrs-3', step = +(process.argv[3] || 6), from = +(process.argv[4] || 0), to = +(process.argv[5] || 1e9);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }); const p = await (await b.newContext({ viewport: { width: 800, height: 450 } })).newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(`http://localhost:5197/drive.html?route=${route}&cal=1`); await p.waitForFunction(() => window.__d, null, { timeout: 120000 }); const L = await p.evaluate(() => window.__d.track.length); await p.evaluate(() => window.__d.setView(1));
const res = []; const t0 = Date.now();
for (let s = Math.max(0, from); s <= Math.min(L, to); s += step) {
  await p.evaluate((s) => window.__d.warp(s), s); await p.waitForTimeout(300); await p.waitForFunction(() => window.__d.settled, null, { timeout: 60000, polling: 100 }).catch(() => {}); await p.waitForTimeout(150);
  const r = await p.evaluate((s) => window.__d.calibrateAt(s), s); res.push({ s, u: r.u, conf: r.conf }); if (res.length % 25 === 0) console.log(s | 0, 'of', L | 0, ((Date.now() - t0) / 1000) | 0, 's');
}
// confident samples only, median filter over 5, clamp
const ok = res.map(r => r.conf > 2.2 ? r.u : null); const med = (a) => { const v = a.filter(x => x !== null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
const sm = res.map((r, i) => med(ok.slice(Math.max(0, i - 5), i + 6))); let last = 0; const knots = res.map((r, i) => { if (sm[i] !== null) last = sm[i]; return [r.s, +Math.max(-2.2, Math.min(2.2, last)).toFixed(2)]; });
fs.writeFileSync(`/Users/oskars/projects/holeio/tools/.cache/realistic/offsets-${route}.json`, JSON.stringify({ route, step, knots, raw: res.map(r => [r.s, +r.u.toFixed(2), +r.conf.toFixed(1)]) }));
console.log('confident', ok.filter(x => x !== null).length, '/', res.length, 'offsets range', Math.min(...knots.map(k => k[1])), Math.max(...knots.map(k => k[1]))); await b.close();
