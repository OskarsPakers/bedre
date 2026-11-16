import * as L from './lib.mjs';
const out = {};
for (const [name, prof, land] of [['se-land', { eng: 'webkit', dev: 'iPhone SE', name: 'wkse' }, true], ['se-port', { eng: 'webkit', dev: 'iPhone SE', name: 'wkse' }, false], ['px-land', { eng: 'chromium', dev: 'Pixel 5', name: 'px5' }, true]]) {
  const p = await L.open({ ...prof, land }, { name: 'Misc', lang: 'lv' });
  await L.load(p);
  const r = {};
  r.vp = await L.vp(p);
  await L.shot(p, `m-${name}-start`);
  r.startOverflow = await p.evaluate(() => { const pi = document.querySelector('#start .panel-inner'); return { sh: pi.scrollHeight, ch: pi.clientHeight, docScroll: document.documentElement.scrollHeight - innerHeight, bodyScroll: document.body.scrollHeight - innerHeight }; });
  // tiny targets across visible start controls
  const small = async (root) => p.evaluate((root) => [...document.querySelectorAll(`${root} button, ${root} a, ${root} select, ${root} input`)].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { n: e.id || e.textContent.trim().slice(0, 16), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((x) => x.h < 43.5 || x.w < 43.5), root);
  r.smallStart = await small('#start');
  for (const [btn, panel, close] of [['#open-scores', '#scores', '#ts-close'], ['#open-about', '#about', '#ab-close']]) {
    await L.T.tapEl(p, btn); await L.sleep(900); await L.shot(p, `m-${name}-${panel.slice(1)}`);
    r['small' + panel] = await small(panel);
    r['ov' + panel] = await p.evaluate((pn) => { const pi = document.querySelector(pn + ' .panel-inner') || document.querySelector(pn); const b = document.querySelector(pn + ' .btn'); const bb = b.getBoundingClientRect(); return { closeBottom: Math.round(bb.bottom), vh: innerHeight, sh: pi.scrollHeight, ch: pi.clientHeight }; }, panel);
    await L.T.tapEl(p, close); await L.sleep(400);
  }
  // my progress
  const prog = await p.$('#open-meta, #open-progress, [data-open="meta"]'); r.progBtn = !!prog;
  // swipe on start panel -> does the page scroll / zoom?
  await p.touchscreen.tap(10, 10);
  // options
  await L.T.tapEl(p, '#opts-toggle'); await L.sleep(300); await L.shot(p, `m-${name}-adv`);
  r.advSmall = await small('#opts-body');
  await L.T.tapEl(p, '#opts-toggle');
  // Start online lobby, check layout then leave
  await L.T.tapEl(p, '#play-online'); await L.sleep(2500); await L.shot(p, `m-${name}-lobby`);
  r.lobby = await p.evaluate(() => { const r = [...document.querySelectorAll('#mp-lobby *, #mp-panel *, .mp-card *')].filter(e=>e.offsetParent).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean); return { minFont: Math.min(...r), st: window.__online.state }; });
  await p.evaluate(() => window.__online.leave()); await L.sleep(500);
  // solo: pinch + double tap + zoom limits + hidden/visible
  await L.T.tapEl(p, '#play'); await p.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 40000 }); await L.sleep(1500);
  const v = await L.vp(p); const cx = v.w / 2, cy = v.h / 2;
  const zoom = () => p.evaluate(() => window.__life.game.cam.dist ?? window.__life.game.cam.zoom ?? window.__life.game.cam.distance);
  r.zoom0 = await zoom();
  const cam = await p.evaluate(() => Object.keys(window.__life.game.cam).filter(k=>/zoom|dist|elev|scale/i.test(k)));
  r.camKeys = cam;
  for (const [a, b] of [[60, 160], [160, 60]]) { // spread then pinch, many times
    await L.T.down(p, 1, cx - a, cy + 80); await L.T.down(p, 2, cx + a, cy + 80);
    for (let i = 0; i < 12; i++) { const d = a + (b - a) * (i / 11); await L.T.move(p, 1, cx - d, cy + 80); await L.T.move(p, 2, cx + d, cy + 80); await L.sleep(30); }
    await L.T.up(p, 2); await L.T.up(p, 1); await L.sleep(300); r['zoom_' + a + '_' + b] = await zoom();
  }
  for (let k = 0; k < 6; k++) { await L.T.down(p, 1, cx - 30, cy + 80); await L.T.down(p, 2, cx + 30, cy + 80); for (let i = 0; i < 30; i++) { await L.T.move(p, 1, cx - 30 - i * 6, cy + 80); await L.T.move(p, 2, cx + 30 + i * 6, cy + 80); } await L.T.up(p, 2); await L.T.up(p, 1); }
  r.zoomMaxOut = await zoom(); await L.shot(p, `m-${name}-pinch-out`);
  for (let k = 0; k < 6; k++) { await L.T.down(p, 1, cx - 120, cy + 80); await L.T.down(p, 2, cx + 120, cy + 80); for (let i = 0; i < 30; i++) { await L.T.move(p, 1, cx - 120 + i * 3.8, cy + 80); await L.T.move(p, 2, cx + 120 - i * 3.8, cy + 80); } await L.T.up(p, 2); await L.T.up(p, 1); }
  r.zoomMaxIn = await zoom(); await L.shot(p, `m-${name}-pinch-in`);
  r.docScrollInPlay = await p.evaluate(() => ({ sy: scrollY, sx: scrollX, vv: window.visualViewport ? [visualViewport.scale, visualViewport.offsetTop] : null }));
  // second finger lands during steering: hole jump?
  const hx = () => p.evaluate(() => [window.__game.hole.x, window.__game.hole.z]);
  await L.T.down(p, 1, cx, v.h * 0.75); await L.T.drag(p, 1, [cx, v.h * 0.75], [cx + 40, v.h * 0.75], 5, 30); await L.sleep(300);
  const b4 = await hx(); await L.T.down(p, 2, cx - 100, v.h * 0.45); await L.sleep(150); const af = await hx(); r.secondFingerStep = Math.hypot(af[0] - b4[0], af[1] - b4[1]).toFixed(2);
  await L.T.up(p, 2); await L.T.up(p, 1);
  // hide / show
  const t0 = await p.evaluate(() => window.__game.state.timeLeft);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
  await L.sleep(4000);
  r.pausedAfterHide = await p.evaluate(() => ({ paused: window.__life.game.paused, phase: window.__game.state.phase, panel: !document.getElementById('pause').classList.contains('hidden') }));
  await p.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); }); await L.sleep(800);
  await L.shot(p, `m-${name}-resume`);
  r.afterShow = await p.evaluate(() => ({ paused: window.__life.game.paused, panel: !document.getElementById('pause').classList.contains('hidden'), t: window.__game.state.timeLeft }));
  r.t0 = t0;
  out[name] = r; console.log(name, JSON.stringify(r)); await p.__ctx.close();
}
console.log('ERRS', JSON.stringify(L.log.errs));
await L.closeAll();
