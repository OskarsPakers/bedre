// Stage "cold" of scripts/smoke-ux.mjs: friend rooms used the moment the page is usable, on a COLD load (fresh context: no service worker, no caches).
const FAST3G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 0.9, uploadThroughput: (750 * 1024 / 8) * 0.9 };   // DevTools "Fast 3G"

export async function run(X) {
  const { BASE, check, sleep, mkPage, E, vis, waitFor, post, shot } = X;
  console.log('\n== stage cold: friend rooms on a cold load');
  const PROFILES = [
    { name: 'Chromium', eng: 'chromium' },
    { name: 'Chromium 4x CPU + Fast 3G', eng: 'chromium', cpu: 4, net: FAST3G },
    { name: 'WebKit iPhone 13', eng: 'webkit', dev: 'iPhone 13' },
  ];
  /** Cold page; the load is NOT awaited: `goto` returns at the first response, the caller reacts the moment the element it needs exists. */
  async function cold(prof, q = '') {
    const page = await mkPage(prof.eng, { dev: prof.dev || null, name: 'Cold' + Math.random().toString(36).slice(2, 5) });
    if (prof.eng === 'chromium' && (prof.cpu || prof.net)) {
      const cdp = await page.context().newCDPSession(page);
      if (prof.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
      if (prof.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', prof.net); }
    }
    page.goto(`${BASE}/?quality=low&radio=0&sw=1${q ? '&' + q : ''}`, { waitUntil: 'commit' }).catch(() => {});
    return page;
  }
  const lobbyUp = (p, t = 120000) => waitFor(p, () => window.__online && window.__online.state === 'lobby' && !!document.querySelector('#mp-priv:not(.hidden)'), null, t);
  const msgs = (p) => E(p, () => ({ err: (document.getElementById('mpf-err') || {}).textContent || '', status: (document.getElementById('mp-status') || {}).textContent || '', state: window.__online && window.__online.state, friendsBtn: (document.getElementById('play-friends') || {}).textContent }));
  const UNAV = /not available right now|nav pieejama/i;
  const tag = (p) => p.__name;

  for (const prof of PROFILES) {
    // ---- 1. create immediately -------------------------------------------------------------------------------------------------
    const A = await cold(prof);
    await A.waitForSelector('#play-friends', { timeout: 300000 });
    await A.click('#play-friends', { timeout: 300000 });
    await A.waitForSelector('#mp-friends:not(.hidden)', { timeout: 60000 });
    const t0 = Date.now();
    await A.click('#mpf-create', { timeout: 60000 });
    const ok = await lobbyUp(A);
    const m = await msgs(A);
    check(`${prof.name}: Create room right at load -> the private lobby (${Math.round((Date.now() - t0) / 1000)} s after the click)`, ok && !UNAV.test(m.err + m.status), JSON.stringify(m));
    const code = ok ? (await E(A, () => document.getElementById('mpp-code').textContent)).trim() : null;
    if (prof === PROFILES[0]) await shot(A, 'ux-lobby-private-en.png');

    // ---- 2. join by code immediately -------------------------------------------------------------------------------------------
    if (code) {
      const B = await cold(prof);
      await B.waitForSelector('#play-friends', { timeout: 300000 });
      await B.click('#play-friends', { timeout: 300000 });
      await B.waitForSelector('#mp-friends:not(.hidden)', { timeout: 60000 });
      await B.fill('#mpf-code', code);
      await B.click('#mpf-join-btn', { timeout: 60000 });
      const okB = await lobbyUp(B);
      const mb = await msgs(B);
      check(`${prof.name}: join by code right at load -> the same lobby`, okB && !UNAV.test(mb.err + mb.status), JSON.stringify(mb));
      // ---- 3. a ?room=CODE link on a cold load -----------------------------------------------------------------------------------
      const C = await cold(prof, `room=${code}`);
      const okC = await lobbyUp(C);
      const mc = await msgs(C);
      check(`${prof.name}: ?room=CODE link on a cold load lands in the lobby`, okC && !UNAV.test(mc.err + mc.status), JSON.stringify(mc));
      for (const p of [B, C]) await p.context().close().catch(() => {});
    }
    await A.context().close().catch(() => {});
  }

  // ---- failure injection (Chromium): a cold server's first answer may be a 5xx / dropped; a real outage still says so ----------------------------------
  const inj = async (routeFn, q = '') => {
    const p = await mkPage('chromium', { name: 'Inj' + Math.random().toString(36).slice(2, 5) });
    await routeFn(p);
    await p.goto(`${BASE}/?quality=low&radio=0${q ? '&' + q : ''}`);
    await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
    return p;
  };
  const failFirst = (n, how, method = 'POST') => async (p) => { let k = 0; await p.route('**/api/mp/room**', async (r) => { if (r.request().method() === method && k++ < n) return how === 'abort' ? r.abort('connectionreset') : r.fulfill({ status: how, contentType: 'application/json', body: '{"error":"multiplayer unavailable"}' }); return r.continue(); }); };
  for (const [label, how] of [['503', 503], ['dropped connection', 'abort']]) {
    const p = await inj(failFirst(1, how));
    await p.waitForFunction(() => window.__online.isReady, null, { timeout: 20000 });
    await p.click('#play-friends'); await p.click('#mpf-create');
    const ok = await lobbyUp(p, 30000); const m = await msgs(p);
    check(`create: the first request fails (${label}) -> retried, the lobby opens, no "not available"`, ok && !UNAV.test(m.err + m.status), JSON.stringify(m));
    await p.context().close();
  }
  { // a real, persistent outage: the genuine message (after the retries), the panel stays usable
    const p = await inj(failFirst(99, 503));
    await p.waitForFunction(() => window.__online.isReady, null, { timeout: 20000 });
    await p.click('#play-friends'); await p.click('#mpf-create');
    const shown = await waitFor(p, () => /not available right now/.test(document.getElementById('mpf-err').textContent), null, 30000);
    check('create: a persistent 503 shows the real "not available" message in the panel (and the buttons are usable again)', shown && !(await E(p, () => document.getElementById('mpf-create').disabled)), JSON.stringify(await msgs(p)));
    await p.context().close();
  }
  { // rate limit: its own message, no retry storm
    let n = 0;
    const p = await inj(async (pg) => { await pg.route('**/api/mp/room**', (r) => { if (r.request().method() === 'POST') { n++; return r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"ratelimit"}' }); } return r.continue(); }); });
    await p.waitForFunction(() => window.__online.isReady, null, { timeout: 20000 });
    await p.click('#play-friends'); await p.click('#mpf-create');
    const shown = await waitFor(p, () => /Too many/.test(document.getElementById('mpf-err').textContent), null, 10000);
    check('create: 429 -> "Too many attempts" (not "not available"), a single request', shown && n === 1, `n=${n} ${JSON.stringify(await msgs(p))}`);
    await p.context().close();
  }
  { // a slow readiness probe: everything waits for it; a ?room= link on a cold load waits for it too and survives a failing first lookup
    const mkc = await post('/api/mp/room', {}); const code2 = (await mkc.json()).code;
    let first = true;
    const p = await mkPage('chromium', { name: 'Slow' });
    await p.route('**/api/mp/status', async (r) => { await sleep(3000); await r.continue(); });
    await p.route('**/api/mp/room?code=*', async (r) => { if (first) { first = false; return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); } return r.continue(); });
    p.goto(`${BASE}/?quality=low&radio=0&room=${code2}`, { waitUntil: 'commit' }).catch(() => {});
    await p.waitForSelector('#play-online', { timeout: 120000 });
    const early = await E(p, () => ({ ready: window.__online.isReady, status: document.getElementById('mp-status').textContent }));
    check('slow probe: a ?room= link waits for readiness (not ready yet, no error shown)', !early.ready && !/not available/i.test(early.status), JSON.stringify(early));
    const ok = await lobbyUp(p, 60000); const m = await msgs(p);
    check('?room=CODE with a slow probe and a failing first lookup still lands in the lobby', ok && !UNAV.test(m.err + m.status), JSON.stringify(m));
    await p.context().close();
  }
}
