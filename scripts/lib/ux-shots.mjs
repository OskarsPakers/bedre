// Screenshots scripts/out/ux-*.png: desktop 1280x720, real WebKit iPhone 13, 320x568 phone (Chromium, touch) x LV + EN:
//   results (solo / public online / private room) with Main menu, the pause panel + its confirm, the start screen right after returning, the lobby (Atgriezties),
//   the private lobby, the start screen + Friends panel in their loading state.
import path from 'node:path';

export async function run(X) {
  const { BASE, check, sleep, mkPage, open, E, vis, waitFor, out, startScreenOk, pilot, unpilot, playRound, waitPhase } = X;
  console.log('\n== stage shots: screenshots + per-viewport checks');
  const COMBOS = [
    { vp: 'desktop', eng: 'chromium', opts: { size: { width: 1280, height: 720 } } },
    { vp: 'iphone13', eng: 'webkit', opts: { dev: 'iPhone 13' } },
    { vp: 'se320', eng: 'chromium', opts: { size: { width: 320, height: 568 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } } },
  ];
  for (const C of COMBOS) {
    for (const lang of ['lv', 'en']) {
      const tagn = `${C.vp}-${lang}`;
      const S = async (P, kind) => { await sleep(450); await P.screenshot({ path: path.join(out, `ux-${kind}-${tagn}.png`) }); };
      const P = await mkPage(C.eng, { ...C.opts, lang, name: 'ShotUx' });
      // the client is not ready yet (the status probe is slow): pressing Online shows "Connecting…" (disabled), no error, and the lobby follows
      await P.route('**/api/mp/join', async (r) => { await sleep(2600); await r.continue(); });
      await open(P, 'intro=0');
      await P.click('#play-online'); await sleep(500);
      const early = await E(P, () => ({ ready: window.__online.isReady, dis: document.getElementById('play-online').disabled, status: document.getElementById('mp-status').textContent }));
      await S(P, 'start-loading');
      check(`${tagn}: Online pressed (slow answer) -> "${lang === 'lv' ? 'Savienojas…' : 'Connecting…'}" (button disabled), not "not available"`, early.dis && /Savienojas…|Connecting…/.test(early.status), JSON.stringify(early));
      check(`${tagn}: ... and the lobby opens by itself once ready`, await waitFor(P, () => window.__online.state === 'lobby', null, 20000));
      await E(P, () => document.getElementById('mp-leave').click());
      await waitFor(P, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden'), null, 8000);
      await P.unroute('**/api/mp/join');
      // Friends: Create pressed (slow answer): the panel waits ("Connecting…") and the private lobby follows
      await P.route('**/api/mp/room', async (r) => { if (r.request().method() === 'POST') await sleep(2600); await r.continue(); });
      await P.click('#play-friends'); await P.waitForSelector('#mp-friends:not(.hidden)');
      await P.click('#mpf-create'); await sleep(500);
      const busy = await E(P, () => ({ ready: window.__online.isReady, err: document.getElementById('mpf-err').textContent, dis: document.getElementById('mpf-create').disabled }));
      await S(P, 'friends-loading');
      check(`${tagn}: Friends panel, Create pressed (slow answer): buttons disabled + "Connecting…", no "not available"`, busy.dis && /Savienojas|Connecting/.test(busy.err) && !/nav pieejama|not available/.test(busy.err), JSON.stringify(busy));
      check(`${tagn}: ... then the private lobby opens`, await waitFor(P, () => window.__online.state === 'lobby' && !!document.querySelector('#mp-priv:not(.hidden)'), null, 20000));
      await P.unroute('**/api/mp/room');
      await S(P, 'lobby-private');
      check(`${tagn}: private lobby: leave button says ${lang === 'lv' ? 'Atgriezties' : 'Leave'} and fits`, await E(P, (l) => { const b = document.getElementById('mpp-leave'), r = b.getBoundingClientRect(); return b.textContent.trim() === (l === 'lv' ? 'Atgriezties' : 'Leave') && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.scrollWidth <= b.clientWidth + 1 && (r.height >= 43.5 || !document.body.classList.contains('touch')); }, lang));
      // the private round -> results (private labels)
      await P.click('#mpp-start');
      await waitFor(P, () => window.__online.state === 'ended' && !document.getElementById('results').classList.contains('hidden'), null, 90000);
      await S(P, 'results-private');
      check(`${tagn}: private results: both buttons visible, nothing off-screen`, await E(P, () => { const a = document.getElementById('again').getBoundingClientRect(), m = document.getElementById('to-menu').getBoundingClientRect(), vw = innerWidth, vh = innerHeight; return [a, m].every((r) => r.width > 0 && r.left >= 0 && r.right <= vw && r.bottom <= vh) && (m.top >= a.bottom - 1 || m.left >= a.right - 1); }));
      await P.click('#to-menu');
      await waitFor(P, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden'), null, 8000);
      // public lobby (Atgriezties) + results
      await P.click('#play-online');
      await waitFor(P, () => window.__online.state === 'lobby', null, 20000); await sleep(300);
      await S(P, 'lobby');
      check(`${tagn}: online lobby: leave button says ${lang === 'lv' ? 'Atgriezties' : 'Leave'} and fits`, await E(P, (l) => { const b = document.getElementById('mp-leave'), r = b.getBoundingClientRect(); return b.textContent.trim() === (l === 'lv' ? 'Atgriezties' : 'Leave') && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.scrollWidth <= b.clientWidth + 1; }, lang));
      await waitFor(P, () => window.__online.state === 'ended' && !document.getElementById('results').classList.contains('hidden'), null, 90000);
      await S(P, 'results-online');
      await P.click('#to-menu');
      await waitFor(P, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden'), null, 8000);
      // solo: results -> menu -> pause -> confirm
      if (C.opts.dev || C.opts.extra) { /* touch layouts: Play via tap */ }
      await playRound(P);
      await S(P, 'results-solo');
      check(`${tagn}: solo results: Main menu fully visible, >= 44 px on touch, not over Play again`, await E(P, () => { const a = document.getElementById('again').getBoundingClientRect(), m = document.getElementById('to-menu').getBoundingClientRect(); const touch = document.body.classList.contains('touch'); return m.width > 0 && m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight && (!touch || (m.height >= 43.5 && a.height >= 43.5)) && !(m.left < a.right - 1 && m.right > a.left + 1 && m.top < a.bottom - 1 && m.bottom > a.top + 1); }));
      await P.click('#to-menu');
      await sleep(400);
      check(`${tagn}: start screen after returning is the normal one`, (await startScreenOk(P, /^Spēlēt$|^Play$/)).start);
      await S(P, 'start-after-menu');
      await P.click('#play'); await waitPhase(P, 'playing', 20000); await pilot(P); await sleep(700);
      await E(P, () => window.__G.pause(true)); await sleep(300);
      await S(P, 'pause');
      await P.click('#pause-menu'); await sleep(350);
      await S(P, 'pause-confirm');
      check(`${tagn}: pause confirm: both buttons visible and inside the screen`, await E(P, () => ['pc-no', 'pc-yes'].every((i) => { const r = document.getElementById(i).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (!document.body.classList.contains('touch') || r.height >= 43.5); })));
      await P.click('#pc-yes'); await unpilot(P);
      await P.context().close();
    }
  }
}
