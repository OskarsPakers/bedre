// First-play loading cost: transfer size (what actually crosses the wire, brotli like Cloudflare) and time-to-playable on a throttled
// "Fast 4G" profile (9 Mbit/s down, 1.5 Mbit/s up, 170 ms RTT = the WebPageTest definition), centre map, cold cache, Chromium + Pixel 5 profile.
//   node scripts/measure-load.mjs before=scripts/.dist-before after=scripts/.dist-mobile [--runs 3] [--map centrs]
// Each `label=dir` is a built dist/. A tiny static server compresses html / css / js / json / svg with brotli and serves .gz / .png as they are
// (this mirrors the live headers: verified with curl against bedre.pakers.lv). Time-to-playable = navigation start -> body[data-ready] (Play enabled).
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const runs = +arg('--runs', 3), map = arg('--map', 'centrs');
const targets = process.argv.slice(2).filter((a) => /^\w+=/.test(a)).map((a) => { const [l, d] = a.split('='); return { label: l, dir: path.resolve(root, d) }; });
if (!targets.length) { console.error('usage: measure-load.mjs label=dist [label=dist ...]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);

function serve(dir, port) {
  const cache = new Map();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = path.join(dir, decodeURIComponent(u.pathname));
    if (u.pathname === '/' || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
    const ext = path.extname(p);
    const h = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' };
    let body = fs.readFileSync(p);
    if (COMPRESS.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
      if (!cache.has(p)) cache.set(p, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }));
      body = cache.get(p); h['content-encoding'] = 'br';
    }
    h['content-length'] = body.length;
    res.writeHead(200, h); res.end(body);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

const browser = await chromium.launch({ headless: true, args: process.env.GPU === '0' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const results = {};
let port = +(process.env.MEASURE_PORT || 5195);
for (const t of targets) {
  const srv = await serve(t.dir, port);
  const rows = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ ...devices['Pixel 5'] });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1e6) / 8, uploadThroughput: (1.5 * 1e6) / 8 });
    const reqs = new Map(); let warns = [];
    cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp }));
    cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
    page.on('console', (m) => { if (/preload/i.test(m.text())) warns.push(m.text().slice(0, 140)); });
    await page.goto(`http://localhost:${port}/?map=${map}&quality=low&radio=0&intro=0`, { waitUntil: 'commit' });
    await page.waitForFunction(() => { if (document.body && (document.body.dataset.ready === '1' || document.body.dataset.error)) { window.__readyAt = performance.now(); return true; } return false; }, null, { timeout: 240000, polling: 50 });
    const m = await page.evaluate(() => ({ ready: window.__readyAt, timing: window.__timing, play: !document.getElementById('play').disabled }));
    await sleep(500);
    const list = [...reqs.values()].filter((r) => r.bytes != null && /^http:\/\/localhost/.test(r.url) && !/\/api\//.test(r.url));
    const total = list.reduce((a, r) => a + r.bytes, 0);
    rows.push({ ready: m.ready, total, list, timing: m.timing, warns, play: m.play });
    await ctx.close();
  }
  await new Promise((r) => srv.close(r));
  const med = rows.slice().sort((a, b) => a.ready - b.ready)[Math.floor(rows.length / 2)];
  results[t.label] = { ready: median(rows.map((r) => r.ready)), total: median(rows.map((r) => r.total)), readyAll: rows.map((r) => Math.round(r.ready)), med };
  port++;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
for (const [label, r] of Object.entries(results)) {
  console.log(`\n== ${label}: transfer ${(r.total / 1024).toFixed(0)} KB, time-to-playable ${(r.ready / 1000).toFixed(2)} s (runs ${r.readyAll.join(' / ')} ms), build ${r.med.timing ? r.med.timing.buildMs : '?'} ms`);
  const byKind = {};
  for (const q of r.med.list) { const u = new URL(q.url); const k = u.pathname.replace(/-[\w]{8}\./, '.'); byKind[k] = (byKind[k] || 0) + q.bytes; }
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`   ${(v / 1024).toFixed(0).padStart(6)} KB  ${k}`);
  if (r.med.warns.length) console.log('   console:', r.med.warns.join(' | '));
}
await browser.close();
