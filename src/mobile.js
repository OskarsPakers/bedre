// Phone behaviour in one place: device detection, remembered touch preferences, haptics (navigator.vibrate), Screen Wake Lock,
// Fullscreen (Android), the iOS "Add to Home Screen" hint, battery-saver suggestion, safe-area insets and the body classes
// (`touch`, `tui` = touch + compact layout) that src/mobile.css keys on. Every browser API is feature-detected and wrapped:
// nothing in here may throw, and desktop behaviour is unchanged (no `touch` / `tui` class there).
import { bus } from './events.js';
import { extendStrings, t, onLang } from './i18n.js';
import './mobile.css';

const mq = (q) => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch { return false; } };
const mem = new Map();   // preferences are read every frame (joystick radius, ring pulse): keep them in memory, storage only on change
const ls = {
  get(k) { if (mem.has(k)) return mem.get(k); let v = null; try { v = localStorage.getItem(k); } catch { /* storage blocked */ } mem.set(k, v); return v; },
  set(k, v) { mem.set(k, String(v)); try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

/** Primary pointer is a finger (phones, tablets); a touch laptop with a mouse is not. */
export const isTouch = () => mq('(pointer: coarse)') || (mq('(any-pointer: coarse)') && !mq('(any-pointer: fine)'));
/** Phone-sized touch device (first-visit Quick default). Uses the physical screen, so rotating does not change the answer. */
export const isPhone = () => {
  try { return isTouch() && Math.min(screen.width || 9999, screen.height || 9999) <= 500; } catch { return false; }
};
/** Touch device in the compact (phone / small tablet) layout: this is what body.tui means. */
export const isTouchUi = () => isTouch() && mq('(max-width: 900px), (max-height: 520px)');
export const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isStandalone = () => mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || navigator.standalone === true;
export const canVibrate = () => typeof navigator.vibrate === 'function';

// ---- remembered preferences ------------------------------------------------------------------------------------------------
const K = { control: 'bedre.ctl', sens: 'bedre.sens', lefty: 'bedre.lefty', haptics: 'bedre.haptics', save30: 'bedre.save30', fs: 'bedre.fs', a2hs: 'bedre.a2hs', batt: 'bedre.batt' };
export const prefs = {
  /** 'stick' = floating thumb joystick (default on touch), 'finger' = the hole follows the finger */
  get control() { return ls.get(K.control) === 'finger' ? 'finger' : 'stick'; },
  /** 1 low .. 3 high (default 2): how far the thumb must travel for full speed */
  get sens() { const v = +ls.get(K.sens); return v >= 1 && v <= 3 ? v : 2; },
  get lefty() { return ls.get(K.lefty) === '1'; },
  get haptics() { return ls.get(K.haptics) !== '0'; },
  get save30() { return ls.get(K.save30) === '1'; },
  get fullscreen() { return ls.get(K.fs) !== '0'; },
  set(name, v) {
    const key = K[name]; if (!key) return;
    ls.set(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    applyBodyClasses();
    bus.emit('prefs', name, v);
  },
};

// ---- body classes + safe-area insets ---------------------------------------------------------------------------------------------
function applyBodyClasses() {
  const b = document.body; if (!b) return;
  const touch = isTouch();
  b.classList.toggle('touch', touch);
  b.classList.toggle('tui', isTouchUi());
  b.classList.toggle('lefty', touch && prefs.lefty);
}
/** `?inset=top,right,bottom,left` (px) emulates a notch / home indicator: real devices get env(safe-area-inset-*). */
function applyInsetOverride() {
  const q = new URLSearchParams(location.search).get('inset');
  if (!q) return;
  const [tp, r, bt, l] = q.split(',').map((x) => Math.max(0, Math.min(80, +x || 0)));
  const s = document.documentElement.style;
  s.setProperty('--sat', tp + 'px'); s.setProperty('--sar', r + 'px'); s.setProperty('--sab', bt + 'px'); s.setProperty('--sal', l + 'px');
}

// ---- haptics -------------------------------------------------------------------------------------------------------------------------
let lastTick = 0, lastPulse = 0;
export const hapticStats = { calls: 0, supported: false };
/** Vibrate where the browser can (Android); a silent no-op elsewhere (iOS Safari has no Vibration API). Never throws. */
export function buzz(pattern) {
  hapticStats.supported = canVibrate();
  if (!hapticStats.supported || !prefs.haptics || document.hidden) return false;
  // only on touch devices and only after the user has interacted with the page (desktop Chromium logs a console error for a vibrate() before any gesture)
  if (!(navigator.maxTouchPoints > 0 || 'ontouchstart' in window)) return false;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  try { const ok = navigator.vibrate(pattern); hapticStats.calls++; return ok; } catch { return false; }
}
function wireHaptics() {
  bus.on('swallow', (o, hole) => {
    if (!hole || !hole.isPlayer) return;
    const now = performance.now();
    if (o.isBuilding || o.cls === 'building') {
      if (now - lastPulse < 120) return;
      lastPulse = now;
      buzz(Math.round(Math.min(70, 18 + Math.sqrt(Math.max(1, o.fit || 4)) * 6)));   // stronger with size
    } else if (now - lastTick > 90) { lastTick = now; buzz(7); }                         // tiny tick, rate-limited
  });
  bus.on('holeEaten', (e) => { if (e && e.eater && e.eater.isPlayer) buzz([35, 45, 35, 45, 90]); });
  bus.on('playerEaten', () => buzz([160, 70, 220]));
  bus.on('levelUp', () => buzz([20, 40, 20, 40, 70]));
}

// ---- Screen Wake Lock --------------------------------------------------------------------------------------------------------------------
export const wake = { want: false, lock: null, requests: 0, releases: 0, supported: false };
async function acquireWake() {
  wake.supported = !!(navigator.wakeLock && navigator.wakeLock.request);
  if (!wake.want || !wake.supported || wake.lock || document.hidden) return;
  try {
    wake.requests++;
    const l = await navigator.wakeLock.request('screen');
    if (!wake.want) { try { await l.release(); } catch { /* ignore */ } wake.releases++; return; }
    wake.lock = l;
    l.addEventListener && l.addEventListener('release', () => { if (wake.lock === l) wake.lock = null; });
  } catch { wake.lock = null; }
}
async function releaseWake() {
  wake.want = false;
  const l = wake.lock; wake.lock = null;
  if (l) { try { await l.release(); wake.releases++; } catch { /* ignore */ } }
}
function wireWake() {
  bus.on('roundGo', () => { wake.want = true; acquireWake(); });
  bus.on('roundEnd', releaseWake);
  bus.on('menu', releaseWake);   // abandoned round (pause -> Main menu)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wake.want) acquireWake(); });
}

// ---- Fullscreen (Android, not when installed) ------------------------------------------------------------------------------------------
export function maybeFullscreen() {
  try {
    if (!isTouch() || isStandalone() || isIos() || !prefs.fullscreen) return false;
    const el = document.documentElement;
    if (!document.fullscreenEnabled || document.fullscreenElement || !el.requestFullscreen) return false;
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
    return true;
  } catch { return false; }
}

// ---- strings + hint / battery banners -------------------------------------------------------------------------------------------------------
extendStrings({
  a2hsTitle: 'Pievienot sākuma ekrānam',
  a2hsBody: 'Pilnam ekrānam: Safari → Kopīgot → “Pievienot sākuma ekrānam”.',
  a2hsClose: 'Aizvērt',
  battLow: 'Akumulators gandrīz tukšs. Ieslēgt taupīšanas režīmu (30 kadri/s)?',
  battOn: 'Ieslēgt', battNo: 'Nē',
  resumeIn: 'Turpinām', reconnecting: 'Atjauno savienojumu…',
}, {
  a2hsTitle: 'Add to Home Screen',
  a2hsBody: 'For full screen: Safari → Share → “Add to Home Screen”.',
  a2hsClose: 'Dismiss',
  battLow: 'Battery is low. Turn on battery saver (30 fps)?',
  battOn: 'Turn on', battNo: 'No',
  resumeIn: 'Resuming', reconnecting: 'Reconnecting…',
});

const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

function a2hsHint() {
  const force = new URLSearchParams(location.search).get('a2hs') === '1';
  if (!force && (!isIos() || isStandalone() || ls.get(K.a2hs))) return;
  if (!force && !isTouch()) return;
  const host = document.querySelector('#start .start-main');
  if (!host) return;
  const box = mk('div'); box.id = 'a2hs'; box.setAttribute('role', 'note');
  const title = mk('b'), body = mk('span'), close = mk('button', null, ''); close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  const lab = () => { title.textContent = t('a2hsTitle'); body.textContent = t('a2hsBody'); close.textContent = '×'; close.title = t('a2hsClose'); };
  lab(); onLang(lab);
  const txt = mk('div', 'a2hs-t'); txt.append(title, body);
  box.append(txt, close);
  host.appendChild(box);
  const dismiss = () => { box.remove(); if (!force) ls.set(K.a2hs, String(Date.now())); };
  close.addEventListener('click', dismiss);
  bus.on('roundGo', dismiss);   // seen once: playing counts as dismissed, it never nags again
}

function batteryHint() {
  if (!isTouch() || prefs.save30 || ls.get(K.batt) || !navigator.getBattery) return;
  navigator.getBattery().then((b) => {
    const low = () => !b.charging && b.level <= 0.2;
    const host = document.querySelector('#start .start-main');
    if (!host || !low()) return;
    const box = mk('div'); box.id = 'batt-hint'; box.setAttribute('role', 'note');
    const txt = mk('span'), yes = mk('button', 'btn-mini'), no = mk('button', 'btn-mini alt');
    yes.type = no.type = 'button';
    const lab = () => { txt.textContent = t('battLow'); yes.textContent = t('battOn'); no.textContent = t('battNo'); };
    lab(); onLang(lab);
    box.append(txt, yes, no);
    host.insertBefore(box, host.querySelector('.opts'));
    yes.addEventListener('click', () => { prefs.set('save30', true); ls.set(K.batt, '1'); box.remove(); });
    no.addEventListener('click', () => { ls.set(K.batt, '1'); box.remove(); });
  }).catch(() => {});
}

// ---- audio: resume after an interruption / return to the tab -----------------------------------------------------------------------------
function wireAudioResume(getGame) {
  const kick = () => {
    const a = window.__life && window.__life.audio, g = getGame();
    if (!a || !a.ctx || (g && g.paused)) return;
    if (a.ctx.state !== 'running') a.ctx.resume().catch(() => {});   // 'suspended' (and Safari's 'interrupted') after a call / app switch
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { kick(); setTimeout(kick, 300); } });
  window.addEventListener('pageshow', kick);
  window.addEventListener('focus', kick);
  window.addEventListener('pointerdown', kick, true);   // iOS needs a gesture: the next touch brings the sound back
}

/** Called once from main.js after the game exists. */
export function initMobile(game) {
  applyBodyClasses();
  applyInsetOverride();
  const re = () => applyBodyClasses();
  window.addEventListener('resize', re);
  window.addEventListener('orientationchange', () => setTimeout(re, 120));
  try { window.matchMedia('(pointer: coarse)').addEventListener('change', re); } catch { /* old Safari */ }
  wireHaptics(); wireWake(); wireAudioResume(() => game);
  a2hsHint(); batteryHint();
  window.__mobile = { prefs, wake, hapticStats, isTouch, isPhone, isIos, isAndroid, canVibrate, buzz, maybeFullscreen };
}
