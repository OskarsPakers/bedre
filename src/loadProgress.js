// One real progress bar for the map download. vite.config.js (dataPreload) publishes window.__DATA = { slug, files: [[url, decodedBytes], ...] }
// and starts those downloads from <head>; this wraps fetch() so every byte of those files that the loaders read is counted against the total.
// Idle (does nothing) when __DATA is absent (?sample=1, dev without the plugin) or the browser cannot stream.
export function trackLoad(onProgress) {
  const D = window.__DATA;
  if (!D || !D.files || typeof ReadableStream === 'undefined' || !window.fetch) return false;
  const total = D.files.reduce((a, f) => a + (f[1] || 0), 0);
  if (!total) return false;
  const got = new Map(D.files.map((f) => [new URL(f[0], location.href).href, 0]));
  const orig = window.fetch.bind(window);
  let last = -1;
  const report = () => {
    let sum = 0;
    for (const [url, n] of got) sum += Math.min(n, (D.files.find((f) => new URL(f[0], location.href).href === url) || [0, n])[1] || n);
    const f = Math.min(0.99, sum / total);
    if (f - last >= 0.01) { last = f; try { onProgress(f); } catch { /* ignore */ } }
  };
  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
    const p = orig(input, init);
    if (!got.has(url) || (init && init.method && init.method !== 'GET')) return p;
    return p.then((res) => {
      if (!res.ok || !res.body || !res.body.getReader) return res;
      const reader = res.body.getReader();
      const stream = new ReadableStream({
        pull(ctrl) {
          return reader.read().then(({ done, value }) => {
            if (done) { ctrl.close(); return; }
            got.set(url, got.get(url) + value.length); report();
            ctrl.enqueue(value);
          }, (e) => ctrl.error(e));
        },
        cancel(r) { return reader.cancel(r); },
      });
      return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
    });
  };
  return true;
}
