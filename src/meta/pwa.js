// Service-worker registration + "new version" toast. Skipped on localhost / automation (Playwright) unless ?sw=1; ?sw=0 disables it.
import { mt } from './strings.js';
import { mapPaths } from '../../tools/maps.mjs';

/** Tell the worker which map files this page used, so exactly those are kept for offline / instant repeat visits (the worker no longer precaches the Centre for everyone). */
function cacheMapData() {
  const D = window.__DATA;
  if (!D || !D.files || !navigator.serviceWorker.ready) return;
  const p = mapPaths(D.slug);
  const urls = [...D.files.map((f) => f[0]), p.sights, p.areas].filter((u) => typeof u === 'string' && u.startsWith('/data/'));
  const send = () => navigator.serviceWorker.ready.then((r) => { if (r.active) r.active.postMessage({ type: 'cache-data', urls }); }).catch(() => {});
  // let the first frames render before the worker spends any bandwidth
  if (document.readyState === 'complete') setTimeout(send, 3000); else window.addEventListener('load', () => setTimeout(send, 3000));
}

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  const q = new URLSearchParams(location.search).get('sw');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || /^(10|192\.168)\./.test(location.hostname);
  if (q === '0') return;
  if (q !== '1' && (local || navigator.webdriver)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let told = false;
  const announce = () => {
    if (told || !hadController) return; told = true;
    const reload = () => location.reload();
    if (window.__metaToast) window.__metaToast('⟳', mt('newVersion'), { sticky: true, action: { label: mt('reload'), fn: reload } });
  };
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
    window.__swReg = reg;
    cacheMapData();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) announce(); });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', announce);
}
