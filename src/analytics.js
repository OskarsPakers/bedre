// Privacy-first, cookieless analytics. No third-party scripts, no cookies, no identifiers, no IPs: the page batches a few
// allow-listed counters (page view, rounds started/finished per mode, device class, language, quality tier, theme,
// WebGL missing, PWA, share / lobby clicks, coarse error types, final-score bucket) into a tiny beacon (at most one per
// 15 s) to POST /api/e, where they are only added to daily totals (worker/lib/analytics.js).
// Do Not Track / Global Privacy Control => nothing is collected or sent.
//
// Other modules report with `bus.emit('track', 'share')` / `bus.emit('track', 'lobby')` (or `track('share')` from here,
// or a `data-track="share"` attribute on a clickable element). Unknown keys are ignored by the server.
import { bus } from './events.js';
import { getLang } from './i18n.js';

const FLUSH_MS = 15000;
const optedOut = (() => {
  try { return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true; } catch { return false; }
})();
const q = new Map();
let lastSend = 0, timer = null, game = null;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function track(key, n = 1) {
  if (optedOut || typeof key !== 'string') return;
  q.set(key, (q.get(key) || 0) + n);
  schedule();
}

function schedule() {
  if (timer || !q.size) return;
  const wait = Math.max(3000, lastSend + FLUSH_MS - Date.now());
  timer = setTimeout(() => { timer = null; flush(); }, wait);
}

function flush() {
  if (optedOut || !q.size) return;
  const d = Object.fromEntries(q);
  q.clear();
  lastSend = Date.now();
  const body = JSON.stringify({ d });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* analytics must never break the game */ }
}

const scoreBucket = (s) => { const edges = [300, 900, 2100, 4500, 9000, 18000, 36000];   // (scoring rules 2: points with combos run ~3x higher than the old plain value)
   let i = 0; while (i < edges.length && s >= edges[i]) i++; return i; };

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

if (!optedOut) {
  track('pv');
  track(lsGet('bedre.seen') ? 'vis:ret' : 'vis:new'); lsSet('bedre.seen', '1');
  track(window.matchMedia && matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600 ? 'dev:mobile' : 'dev:desktop');
  track('lang:' + getLang());
  if (!webglOk()) track('nogl');
  try { if ((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone) track('pwa:standalone'); } catch { /* ignore */ }
  window.addEventListener('appinstalled', () => track('pwa:install'));
  window.addEventListener('error', (e) => { if (e.target && e.target !== window) return; track('err:js'); });
  window.addEventListener('unhandledrejection', () => track('err:promise'));
  document.addEventListener('webglcontextlost', () => track('err:ctxlost'), true);
  document.addEventListener('click', (e) => { const el = e.target && e.target.closest && e.target.closest('[data-track]'); if (el) track(String(el.dataset.track)); }, true);
  bus.on('track', (k) => track(k));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);   // the one flush that ignores the 15 s spacing, so the last counters are not lost
  new MutationObserver(() => { const e = document.body.dataset.error; if (e && e !== 'noWebgl') track('err:load'); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-error'] });
}

/** Round-level counters need the Game (current mode, score, quality). Called once from main.js. */
export function bindAnalytics(g, getMode) {
  game = g;
  if (optedOut) return;
  bus.on('roundGo', () => {
    const mode = getMode();
    track('rs:' + mode);
    const ql = window.__life && window.__life.quality && window.__life.quality.name;
    if (ql) track('q:' + ql);
    const th = document.documentElement.dataset.theme || document.body.dataset.theme;
    if (th && /^[a-z0-9-]{1,16}$/.test(th)) track('theme:' + th);
  });
  bus.on('roundEnd', () => {
    const mode = getMode();
    track('rf:' + mode);
    if (mode !== 'free') track(`sb:${mode}:${scoreBucket(game.player.score)}`);
  });
}
