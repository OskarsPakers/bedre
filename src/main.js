import * as THREE from 'three';
import './style.css';
import { CFG } from './config.js';
import { loadCity } from './data.js';
import { World } from './world.js';
import { Game } from './game.js';
import { initLife } from './life.js';
import { t, applyDom, setLang, onLang } from './i18n.js';
import { initScoresUi } from './scoresUi.js';
import { initOnline } from './net/index.js';
import { initModes, BOT_CAPACITY, getMode, playLabel } from './modes.js';
import { initTrace } from './trace.js';
import { bindAnalytics } from './analytics.js';
import { initMeta } from './meta/progress.js';
import { initRadio } from './meta/radio.js';
import { initPwa } from './meta/pwa.js';
import { initUi } from './ui.js';
import { trackLoad } from './loadProgress.js';
import { bus } from './events.js';
import { initMobile, isTouchUi, prefs, maybeFullscreen } from './mobile.js';
import { initMobileUi } from './mobileUi.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---- language + static text (works before anything heavy loads) ----------------------------------------
applyDom();
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));

// ---- loading screen ----------------------------------------------------------------------------------------
const loading = { fill: $('load-fill'), msg: $('load-msg'), el: $('loading'), key: 'loadingData' };
function setLoad(frac, key) {
  if (key) loading.key = key;
  loading.msg.textContent = t(loading.key) + (frac != null && frac < 1 ? ` ${Math.round(frac * 100)}%` : '…');
  loading.fill.classList.toggle('indet', frac == null);
  if (frac != null) loading.fill.style.width = `${Math.round(frac * 100)}%`;
}
onLang(() => setLoad(loading.fill.classList.contains('indet') ? null : parseFloat(loading.fill.style.width) / 100 || 0));
setLoad(0, 'loadingData');
const hideLoading = () => { loading.el.classList.add('done'); setTimeout(() => loading.el.remove(), 500); };

function fail(key) {
  const m = $('load-msg');
  m.textContent = t(key);
  $('load-fill').classList.remove('indet');
  $('load-fill').style.width = '0';
  loading.el.querySelector('.lh').style.animation = 'none';
  document.body.dataset.error = key;
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

import { applyMap, initMapPicker, applyMapRules } from './maps.js';

async function boot() {
  applyMap(); initMapPicker(); initUi(); initMobileUi(); // selected district (?map= / remembered): file URLs + balance multipliers, picker on the start screen
  if (!webglOk()) { fail('noWebgl'); return; }
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { console.error(e); fail('noWebgl'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.pixelRatioCap));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();

  const tl0 = performance.now();
  const tracked = trackLoad((f) => setLoad(f, 'loadingData'));   // one bar over map + shapes + ground + placements (bytes)
  const data = await loadCity(params.get('sample') === '1', (f) => { if (!tracked) setLoad(f, 'loadingData'); });
  setLoad(null, 'loadingBuild');
  await nextFrame(); // let the loading screen repaint before the long synchronous build
  const tb0 = performance.now();
  performance.mark('bd:data-arrived');
  const world = new World(scene, data);
  performance.mark('bd:world-built');
  window.__timing = { loadMs: Math.round(tb0 - tl0), buildMs: Math.round(performance.now() - tb0) };
  performance.mark('bd:game-start');
  const game = new Game({ renderer, scene, world, canvas, botCount: params.has('bots') ? Math.max(0, Math.min(15, parseInt(params.get('bots'), 10) || 0)) : BOT_CAPACITY });
  if (params.get('introhold')) CFG.intro.hold = +params.get('introhold'); // test hook: linger on the overview
  if (params.get('intro') === '0') game.introEnabled = false;
  // URL overrides make the round local-only / unranked (the server is the source of truth for round length)
  if (params.get('time')) { game.roundSeconds = game.timeLeft = Math.max(1, +params.get('time')); game.timeOverride = true; game.urlUnranked = 'time'; }
  else if (params.get('sample') === '1') game.urlUnranked = 'sample';
  else if (params.has('bots') && (parseInt(params.get('bots'), 10) || 0) !== CFG.bots.count) game.urlUnranked = 'bots';
  game.unranked = game.urlUnranked;
  initMobile(game);                       // body classes (touch / tui), haptics, wake lock, hints (src/mobile.js)
  const fit = () => game.resize(window.innerWidth, window.innerHeight);
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => { fit(); setTimeout(fit, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  window.__game = game.api();
  initLife({ renderer, scene, world, game, canvas });
  window.__perf = { frames: 0, ms: 0, simMs: 0, renderMs: 0 };
  initScoresUi();
  initOnline({ game, world });
  applyMapRules(game); // non-centre maps: unranked + no Online until the worker stores per-map boards
  initTrace(game, world); initModes(game, { params }); bindAnalytics(game, getMode); // modes, score trace, analytics (src/modes.js, trace.js, analytics.js)
  initMeta({ game, world }).catch((e) => console.warn('[meta]', e)); // album, achievements, % meter, recap, share (src/meta/)
  initRadio(); initPwa();
  const anyPanel = () => !!document.querySelector('#scores:not(.hidden), #about:not(.hidden), #meta-panel:not(.hidden), #mp-lobby:not(.hidden)');

  game.hud.setReady(true, playLabel());
  onLang(() => { if (!$('play').disabled) $('play').textContent = playLabel(); });
  $('play').addEventListener('click', () => { maybeFullscreen(); game.start(); });
  $('again').addEventListener('click', () => game.start());   // (Play again keeps whatever fullscreen state the first Play set up)
  $('pause-btn').addEventListener('click', () => game.pause(true));
  $('resume').addEventListener('click', () => game.pause(false, { countdown: isTouchUi() }));   // phones: a 3-2-1 before the world moves again
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !anyPanel()) { if (game.phase === 'playing' || game.phase === 'intro') game.pause(!game.paused); return; }
    const typing = e.target && e.target.tagName === 'INPUT';
    const onBtn = e.target && e.target.tagName === 'BUTTON';
    if (((e.key === 'Enter' && !onBtn) || (e.key === ' ' && !typing && !onBtn)) && game.phase !== 'playing' && game.phase !== 'intro' && !game.paused && !anyPanel() && !$('play').disabled) game.start();
  });
  // pause when the tab is hidden: nothing advances, and the first frame back gets a clamped dt
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause(true);                      // app switch / incoming call / locked screen (solo; online rounds never pause)
    else if (game.online && game.online.onForeground) game.online.onForeground();   // online: show "reconnecting" at once if the socket died in the background
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && game.online && game.online.onForeground) game.online.onForeground(); });

  // no page scroll / pinch-zoom / context menu gestures while playing
  const stop = (e) => { if (game.phase === 'playing' || game.phase === 'intro') { if (e.cancelable) e.preventDefault(); } };
  document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.panel-inner')) stop(e); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let cap30 = prefs.save30;
  bus.on('prefs', (n) => { if (n === 'save30') cap30 = prefs.save30; });
  let last = performance.now();
  function frame(now) {
    // battery saver (Advanced): ~30 fps, i.e. skip every other vsync on a 60 Hz screen
    if (cap30 && now - last < 28) { requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    game.update(dt);
    const t1 = performance.now();
    game.render();
    const t2 = performance.now();
    const P = window.__perf; if (!P.first) { P.first = Math.round((t2 - t0) * 10) / 10; performance.mark('bd:first-frame'); } P.frames++; P.ms += t2 - t0; P.simMs += t1 - t0; P.renderMs += t2 - t1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  hideLoading();
  if (params.get('autostart') === '1') game.start();
  performance.mark('bd:ready');
  document.body.dataset.ready = '1';
}

boot().catch((e) => { console.error(e); fail('bootError'); });
