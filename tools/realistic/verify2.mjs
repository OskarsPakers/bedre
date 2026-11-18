// node verify2.mjs <route> <preset> <tag> <trace|pos> [legacy=0|1] [step=60]   (autopilot drive; trace = metrics + camera-switch tests, pos = screenshots at fixed track positions)
import { chromium } from 'playwright'; import fs from 'node:fs';
const [route, q, tag, mode, legacy = '0', step = '60'] = process.argv.slice(2); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/'; fs.mkdirSync(out + 'preload', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const vp = mode === 'trace' ? { width: 1440, height: 900 } : { width: 1280, height: 720 }; const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: mode === 'trace' ? 2 : 1, ...(mode === 'video' ? { recordVideo: { dir: out + '_vid', size: vp } } : {}) });
const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(`http://localhost:5197/drive.html?route=${route}&q=${q}&auto=1&run=full&legacy=${legacy}`); await p.waitForFunction(() => window.__d, null, { timeout: 120000 });
if (+process.env.START) await p.evaluate((s) => window.__d.warp(s), +process.env.START);
const t0 = Date.now(); await p.waitForFunction(() => window.__ready, null, { timeout: 400000 }); const startDelay = (Date.now() - t0) / 1000; console.log('ready after', startDelay, 's'); await p.evaluate(() => window.__d.resetTrace());
const L = await p.evaluate(() => window.__d.track.length); const start = Date.now(); let nextPos = +process.env.START || 0, nextSwitch = 40, n = 0; const switches = []; const maxSecs = +(process.env.SECS || 900);
while (true) {
  const st = await p.evaluate(() => ({ s: window.__d.run.s, fin: window.__d.run.finished })); const el = (Date.now() - start) / 1000; if (st.fin || st.s > L - 8 || el > maxSecs) break;
  if (mode === 'pos' && st.s >= nextPos) { nextPos = Math.ceil((st.s + 1) / +step) * +step; await p.screenshot({ path: `${out}preload/preload-${tag}-${route}-${String(Math.round(st.s)).padStart(4, '0')}.png` }); n++; }
  if (mode === 'trace' && el > nextSwitch) { nextSwitch = el + 45; const r = await p.evaluate(async () => { const d = window.__d, res = []; for (const v of [1, 0, 1, 0]) { d.setView(v); const t = performance.now(); await new Promise((ok) => { const f = () => { if ((d.fbNow === 0 && performance.now() - t > 120) || performance.now() - t > 6000) ok(); else setTimeout(f, 16); }; f(); }); res.push(+(performance.now() - t).toFixed(0)); await new Promise((r) => setTimeout(r, 300)); } return res; }); switches.push({ s: Math.round(st.s), ms: r }); }
  await p.waitForTimeout(mode === 'trace' ? 1000 : 120);
}
const r = await p.evaluate(() => { const d = window.__d, a = d.frameMs.slice().sort((x, y) => x - y), P = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))]; return { frames: a.length, p50: P(0.5), p95: P(0.95), p99: P(0.99), max: a[a.length - 1], over33: a.filter(v => v > 33.5).length, over50: a.filter(v => v > 50).length, peakTexMB: d.peakTexMB, peakTris: d.peakTris, stats: d.stats, mlog: d.mlog, coarse: d.coarseFrames, hitches: d.hitches.length, s: d.run.s, results: d.run.results.map(x => x.accTxt) }; });
const m = r.mlog.filter(x => x[0] > 0); const sh = m.map(x => x[2]).sort((a, c) => a - c), la = m.map(x => x[3]).sort((a, c) => a - c); const med = (v) => v[v.length >> 1];
const sum = { route, q, tag, legacy, startDelay, secs: (Date.now() - start) / 1000, ...r, mlog: undefined, sharpMin: sh[0], sharpP10: sh[Math.floor(sh.length * 0.1)], sharpMedian: med(sh), loadedMin: la[0], loadedMedian: med(la), coarseFrac: r.coarse.bad / Math.max(1, r.coarse.n), switches, shots: n };
console.log(JSON.stringify(sum)); fs.writeFileSync(`${out}preload-trace-${tag}-${route}-${q}-${mode}.json`, JSON.stringify({ ...sum, mlog: r.mlog }, null, 1)); await ctx.close(); await b.close();
