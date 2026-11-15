/* BEDRE — Rīga service worker. Conservative: app shell + hashed assets precached, /data/* stale-while-revalidate, /api/* and
   anything cross-origin (e.g. the radio stream) never touched. __BUILD_ID__ is stamped by vite.config.js at build time, so every
   build produces a new sw.js (-> install -> toast "new version"); old caches are deleted on activate. */
const BUILD = '__BUILD_ID__';
const SHELL = 'bedre-shell-' + BUILD;
const DATA = 'bedre-data-v1';
const DATA_FILES = ['/data/riga.json', '/data/riga-shapes.bin.gz', '/data/riga-areas.json', '/data/riga-ground.png'];

async function precacheShell() {
  const cache = await caches.open(SHELL);
  const res = await fetch('/', { cache: 'reload' });
  if (!res.ok) throw new Error('shell fetch failed');
  const html = await res.clone().text();
  await cache.put('/', res);
  const todo = new Set(['/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']);
  for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) todo.add(m[1]);
  // follow relative chunk imports inside the JS assets (./three-xxxx.js ...)
  const seen = new Set();
  const queue = [...todo].filter((u) => u.startsWith('/assets/'));
  while (queue.length) {
    const u = queue.pop();
    if (seen.has(u)) continue; seen.add(u);
    const r = await fetch(u);
    if (!r.ok) throw new Error('asset fetch failed ' + u);
    await cache.put(u, r.clone());
    if (/\.js$/.test(u)) for (const m of (await r.text()).matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)) { const n = '/assets/' + m[1]; if (!seen.has(n)) { queue.push(n); todo.add(n); } }
  }
  for (const u of todo) if (!u.startsWith('/assets/')) { try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch { /* optional */ } }
}
async function precacheData() {
  const cache = await caches.open(DATA);
  for (const u of DATA_FILES) { try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch { /* optional */ } }
}

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([precacheShell(), precacheData()]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function swr(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreVary: true });
  const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // radio stream, CDN scripts, ...
  const p = url.pathname;
  if (p.startsWith('/api/') || p === '/sw.js') return;       // never cached
  if (req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok && (p === '/' || p === '/index.html')) { const c = await caches.open(SHELL); c.put('/', r.clone()); }
        return r;
      } catch {
        return (await caches.match('/', { ignoreSearch: true, ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }
  if (p.startsWith('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) (await caches.open(SHELL)).put(req, r.clone());
      return r;
    })());
    return;
  }
  if (p.startsWith('/data/')) { e.respondWith(swr(req, DATA)); return; }
  if (p.startsWith('/icons/') || p === '/favicon.svg' || p === '/manifest.webmanifest' || p === '/og.png') e.respondWith(swr(req, SHELL));
});
