// Service-worker registration + "new version" toast. Skipped on localhost / automation (Playwright) unless ?sw=1; ?sw=0 disables it.
import { mt } from './strings.js';

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
