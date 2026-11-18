// Drives a whole route with the autopilot in a real-GPU browser and records a frame-time trace.
// node verify-run.mjs <route> <quality> <trace|shots|video> [engine] [startS] [seconds]
import { chromium, webkit } from 'playwright'; import fs from 'node:fs';
const [route = 'centrs-3', q = 'balanced', mode = 'trace', engine = 'chromium', startS = '0', secs = '600'] = process.argv.slice(2); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/';
fs.mkdirSync(out + 'drive-frames', { recursive: true }); fs.mkdirSync(out + '_vid', { recursive: true });
const b = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const vp = mode === 'trace' ? { width: 1440, height: 900 } : { width: 1280, height: 720 }; const dsf = mode === 'trace' ? 2 : 1;
const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, ...(mode === 'video' ? { recordVideo: { dir: out + '_vid', size: vp } } : {}) }); const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message)); p.on('console', m => { if (/error|tile/i.test(m.text())) console.log('console', m.text().slice(0, 160)); });
await p.goto(`http://localhost:5197/drive.html?route=${route}&q=${q}&auto=1&run=full`); await p.waitForFunction(() => window.__d, null, { timeout: 120000 });
if (+startS) await p.evaluate((s) => window.__d.warp(s), +startS);
const t0 = Date.now(); await p.waitForFunction(() => window.__ready, null, { timeout: 300000 }); console.log('ready after', (Date.now() - t0) / 1000, 's'); await p.evaluate(() => window.__d.resetTrace());
const L = await p.evaluate(() => window.__d.track.length); let n = 0, tNext = 0; const start = Date.now(); const views = [0, 0, 1, 0, 2, 0]; const shotLog = [];
while (true) {
  const st = await p.evaluate(() => ({ s: window.__d.run.s, fin: window.__d.run.finished, v: window.__d.run.v, st: window.__d.status() })); const el = (Date.now() - start) / 1000;
  if (st.fin || st.s > L - 6 || el > +secs) break;
  if (mode === 'shots' && el > tNext) { tNext = el + 9; const v = views[n % views.length]; await p.evaluate((v) => window.__d.setView(v), v); await p.waitForTimeout(400); const f = `drive-frames/${route}-${engine}-${String(n).padStart(2, '0')}-s${Math.round(st.s)}-v${v}.png`; shotLog.push([Date.now() - start]); await p.screenshot({ path: out + f }); n++; }
  if (el % 30 < 2.1) console.log(`t=${el | 0}s s=${st.s | 0}/${L | 0} v=${(st.v * 3.6) | 0} km/h tiles=${st.st.tiles} tex=${st.st.texMB | 0}MB shownTris=${(st.st.shownTris / 1e6).toFixed(2)}M`);
  await p.waitForTimeout(mode === 'trace' ? 2000 : 250);
}
const r = await p.evaluate(() => { const d = window.__d, a = d.frameMs.slice().sort((x, y) => x - y), P = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))]; return { frames: a.length, p50: P(0.5), p95: P(0.95), p99: P(0.99), max: a[a.length - 1], over33: a.filter(v => v > 33.5).length, over50: a.filter(v => v > 50).length, over100: a.filter(v => v > 100).length, hitches: d.hitches.slice(0, 60), peakTexMB: d.peakTexMB, peakTris: d.peakTris, stats: d.stats, status: d.status(), s: d.run.s, finished: d.run.finished, results: d.run.results.map(x => ({ name: x.name, acc: x.accTxt })) }; });
console.log(JSON.stringify({ route, q, mode, engine, secs: (Date.now() - start) / 1000, ...r, hitches: r.hitches.length }, null, 0)); fs.writeFileSync(`${out}drive-trace-${route}-${q}-${engine}-${mode}.json`, JSON.stringify({ route, q, mode, engine, ...r }, null, 1));
await ctx.close(); if (mode === 'video') { const f = fs.readdirSync(out + '_vid').filter(x => x.endsWith('.webm')).map(x => out + '_vid/' + x).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; console.log('video', f); }
await b.close();
