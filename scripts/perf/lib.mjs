// Shared bits of the perf pass (scripts/perf-pass.mjs, scripts/perf-shots.mjs): a static server that mirrors the live delivery
// (brotli for html / js / css / json / svg like Cloudflare, .gz / .png untouched, Cache-Control from dist/_headers, ETag + 304),
// with per-URL wire-byte accounting, plus browser launchers and stats helpers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium, webkit, devices } from 'playwright';

export { devices };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);

function parseHeaders(dir) {
  const rules = [];
  try {
    let cur = null;
    for (const line of fs.readFileSync(path.join(dir, '_headers'), 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), h: {} }; rules.push(cur); }
      else { const m = line.trim().match(/^([\w-]+):\s*(.*)$/); if (m && cur) cur.h[m[1].toLowerCase()] = m[2]; }
    }
  } catch { /* none */ }
  return rules;
}

/** Serve `dir` on `port`. Returns { close, bytes: Map<url, wireBytes>, reset() }. */
export function serve(dir, port, { latency = 0 } = {}) {
  const cache = new Map(), rules = parseHeaders(dir), bytes = new Map(), hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{}'); return; } // no page.route(): Playwright request interception disables the HTTP cache
    let p = path.join(dir, decodeURIComponent(u.pathname));
    if (u.pathname === '/' || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
    const ext = path.extname(p), st = fs.statSync(p);
    const h = { 'content-type': TYPES[ext] || 'application/octet-stream' };
    for (const r of rules) if (r.re.test(u.pathname)) Object.assign(h, r.h);
    h['cache-control'] = h['cache-control'] || 'no-cache';
    const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`; h.etag = etag;
    const key = u.pathname + u.search;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); hits.push(key + ' 304'); return; }
    let body = fs.readFileSync(p);
    if (COMPRESS.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
      if (!cache.has(p)) cache.set(p, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
      body = cache.get(p); h['content-encoding'] = 'br';
    }
    h['content-length'] = body.length;
    bytes.set(key, (bytes.get(key) || 0) + body.length);
    res.writeHead(200, h); res.end(body);
  });
  return new Promise((r) => srv.listen(port, () => r({ close: () => new Promise((x) => srv.close(x)), bytes, hits, reset() { bytes.clear(); hits.length = 0; } })));
}

export const GPU_ARGS = process.env.GPU === '0' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
export const launch = (kind) => (kind === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ headless: true, args: [...GPU_ARGS, '--enable-precise-memory-info', '--js-flags=--expose-gc'] }));

export const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
export const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
export const has = (k) => process.argv.includes(k);
export const FAST4G = { offline: false, latency: 170, downloadThroughput: (9 * 1e6) / 8, uploadThroughput: (1.5 * 1e6) / 8 };

/** profiles: how a context is created */
export const PROFILES = {
  desktop: { kind: 'chromium', ctx: { viewport: { width: 1280, height: 720 } } },
  pixel5: { kind: 'chromium', ctx: { ...devices['Pixel 5'] }, net: FAST4G, cpu: 4 },
  pixel5cpu: { kind: 'chromium', ctx: { ...devices['Pixel 5'] }, cpu: 4 },
  iphone13: { kind: 'webkit', ctx: { ...devices['iPhone 13'] } },
  webkit: { kind: 'webkit', ctx: { viewport: { width: 1280, height: 720 } } },
};
