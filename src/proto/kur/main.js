// Kur es esmu? — prototype: a location-guessing game in the 3D low-poly Riga of BEDRE.
// Flow: start card -> 5 rounds (look around at eye level, optionally walk along the street, open the map, pin, confirm, reveal) -> summary.
// World construction is the engine's (src/proto/shared/street-world.js); everything here is game / UI only. No backend calls.
import * as THREE from 'three';
import './kur.css';
import { bootStreetWorld, webglOk } from '../shared/street-world.js';
import { StreetPicker, hashStr, auditSpawn } from './spawn.js';
import { GuessMap, renderMini } from './map.js';
import { t, setLang, applyDom, onLang, getLang, fmtDist, fmtNum } from './strings.js';
import { mulberry32 } from '../../rng.js';
import { loadAreas, areaAt } from '../../meta/districts-names.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ROUNDS = 5, MAXPTS = 5000, SITE = 'https://bedre.pakers.lv/kur/';
let EYE = clamp(parseFloat(params.get('eye')) || 1.75, 1.2, 8);      // camera height (m)
const FOG = { near: 140, far: 1000 };
const LEVELS = ['easy', 'normal', 'hard'];
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

let S = null, picker = null, map = null;
const camera = new THREE.PerspectiveCamera(75, 1, 0.15, 5000);
const view = { x: 0, z: 0, yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
const G = {
  phase: 'menu', seed: '', level: 'normal', timer: false, round: 0, spawns: [], results: [], origin: null, pos: { x: 0, z: 0 }, pin: null, tw: null, t0: 0, mapOpen: false, shown: false,
};
const keys = new Set();

// ---- helpers ------------------------------------------------------------------------------------------------------------
const desktopPanel = () => window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 5/4)').matches;
const score = (d) => (d <= 15 ? MAXPTS : Math.round(MAXPTS * Math.exp(-d / 250)));
const newSeed = () => Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
const cleanSeed = (s) => (s && /^[a-z0-9_-]{1,24}$/i.test(s) ? s.toLowerCase() : null);
function toast(msg, ms = 1500) { const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.add('hidden'), ms); }
function fail(key) { $('load-msg').textContent = t(key); $('load-fill').classList.remove('indet'); document.body.dataset.error = key; }

// ---- boot ---------------------------------------------------------------------------------------------------------------
applyDom();
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));
{
  const d = LEVELS.includes(params.get('d')) ? params.get('d') : LEVELS.includes(store.get('kur.d')) ? store.get('kur.d') : 'normal';
  G.level = d; G.timer = params.get('timer') === '1' || (params.get('timer') !== '0' && store.get('kur.timer') === '1');
  $('opt-timer').checked = G.timer;
}
function setLoad(frac, key) {
  $('load-msg').textContent = t(key) + (frac != null && frac < 1 ? ` ${Math.round(frac * 100)}%` : '…');
  $('load-fill').classList.toggle('indet', frac == null);
  if (frac != null) $('load-fill').style.width = `${Math.round(frac * 100)}%`;
}
let loadKey = 'loading';
setLoad(0, loadKey);
onLang(() => refreshTexts());

async function boot() {
  if (!webglOk()) { fail('noWebgl'); return; }
  try {
    S = await bootStreetWorld({ canvas: $('c'), params, onProgress: (f) => setLoad(f, 'loading'), onPhase: () => { loadKey = 'loadingBuild'; setLoad(null, loadKey); } });
  } catch (e) { console.error(e); fail('bootError'); return; }
  picker = new StreetPicker(S.world);
  map = new GuessMap($('mapc'), S.data, { onTap: placePin, onView: onMapView });
  loadAreas().catch(() => {});
  bindUi();
  fitCamera();
  window.addEventListener('resize', fitCamera);
  window.addEventListener('orientationchange', () => setTimeout(fitCamera, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCamera);
  // menu backdrop: a slow turn on a pleasant street
  const sp = picker.pick(mulberry32(hashStr('menu')), 'easy') || { x: S.world.spawn[0], z: S.world.spawn[1], yaw: 0 };
  setPos(sp.x, sp.z); view.yaw = sp.yaw; view.pitch = 0.04;
  document.documentElement.dataset.map = S.slug;
  $('loadrow').classList.add('hidden'); $('play').classList.remove('hidden');
  refreshTexts();
  requestAnimationFrame(frame);
  document.body.dataset.ready = '1';
  if (params.get('autostart') === '1') startGame();
}

// ---- camera / look ----------------------------------------------------------------------------------------------------
function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  const hf = THREE.MathUtils.degToRad(84);
  const vf = clamp(2 * Math.atan(Math.tan(hf / 2) / a), THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(100));
  camera.aspect = a; camera.fov = THREE.MathUtils.radToDeg(vf); camera.updateProjectionMatrix();
  S.renderer.setSize(w, h, false);
  fitCamera.rate = { x: (2 * Math.atan(Math.tan(vf / 2) * a)) / w, y: vf / h };
  if (map) map.invalidate();
}
function setPos(x, z) { G.pos.x = x; G.pos.z = z; view.x = x; view.z = z; }
const fwd = () => [Math.sin(view.yaw), -Math.cos(view.yaw)];

let drag = null;
function bindLook() {
  const c = $('c');
  c.addEventListener('pointerdown', (e) => {
    if (G.phase !== 'play' && G.phase !== 'reveal') return;
    try { c.setPointerCapture(e.pointerId); } catch { /* synthetic / already released pointer */ }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    view.vyaw = view.vpitch = 0;
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const r = fitCamera.rate, dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now(), dt = Math.max(0.008, (now - drag.t) / 1000);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    const dyaw = -dx * r.x, dp = dy * r.y;
    view.yaw += dyaw; view.pitch = clamp(view.pitch + dp, -0.6, 1.15);
    view.vyaw = dyaw / dt; view.vpitch = dp / dt;
  });
  const end = (e) => { if (drag && drag.id === e.pointerId) { drag = null; if (performance.now() - (end.t || 0) > 0) { /* inertia continues from vyaw */ } } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'm') { if (G.phase === 'play') G.mapOpen ? closeMap() : openMap(); return; }
    if (k === 'escape') { if (G.mapOpen && G.phase === 'play') closeMap(); return; }
    if (k === 'enter') { if (G.mapOpen && G.phase === 'play' && G.pin) confirm(); return; }
    if (G.phase !== 'play' && G.phase !== 'reveal') return;
    if (['arrowleft', 'arrowright', 'a', 'd', 'r', 'f'].includes(k)) { keys.add(k); e.preventDefault(); }
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); if (G.phase === 'play') step(1); }
    if (k === 'arrowdown' || k === 's') { e.preventDefault(); if (G.phase === 'play') step(-1); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

// ---- walking ------------------------------------------------------------------------------------------------------------
function walkTarget(sign) { const [dx, dz] = fwd(); return picker.walk(G.pos.x, G.pos.z, dx * sign, dz * sign, G.origin); }
function step(sign) {
  if (G.tw || !G.origin) return;
  const to = walkTarget(sign);
  if (!to) { toast(t('fwdFar'), 900); return; }
  G.tw = { fx: view.x, fz: view.z, tx: to.x, tz: to.z, t0: performance.now(), ms: 420 };
  G.pos.x = to.x; G.pos.z = to.z;
}

// ---- frame ----------------------------------------------------------------------------------------------------------------
let last = performance.now(), navT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  // keys + inertia
  if (G.phase === 'play' || G.phase === 'reveal') {
    const ks = keys;
    if (ks.has('arrowleft') || ks.has('a')) view.yaw -= 1.5 * dt;
    if (ks.has('arrowright') || ks.has('d')) view.yaw += 1.5 * dt;
    if (ks.has('r')) view.pitch = clamp(view.pitch + 1.0 * dt, -0.6, 1.15);
    if (ks.has('f')) view.pitch = clamp(view.pitch - 1.0 * dt, -0.6, 1.15);
    if (!drag && (view.vyaw || view.vpitch)) {
      view.yaw += view.vyaw * dt; view.pitch = clamp(view.pitch + view.vpitch * dt, -0.6, 1.15);
      const k = Math.exp(-5 * dt); view.vyaw *= k; view.vpitch *= k;
      if (Math.abs(view.vyaw) < 0.01 && Math.abs(view.vpitch) < 0.01) view.vyaw = view.vpitch = 0;
    }
  } else if (G.phase === 'menu') view.yaw += dt * 0.05;
  if (G.tw) {
    const u = clamp((performance.now() - G.tw.t0) / G.tw.ms, 0, 1), e = u * u * (3 - 2 * u);
    view.x = G.tw.fx + (G.tw.tx - G.tw.fx) * e; view.z = G.tw.fz + (G.tw.tz - G.tw.fz) * e;
    if (u >= 1) G.tw = null;
  }
  // walk buttons: dim when there is nowhere to go that way
  if (G.phase === 'play' && (navT -= dt) <= 0) {
    navT = 0.25;
    $('step-fwd').classList.toggle('off', !walkTarget(1)); $('step-bwd').classList.toggle('off', !walkTarget(-1));
  }
  if (G.phase === 'play' && G.timer && !G.timeUp) {
    const left = Math.max(0, 60 - (performance.now() - G.t0) / 1000);
    $('timer-chip').textContent = `0:${String(Math.ceil(left)).padStart(2, '0')}`; $('timer-chip').classList.toggle('low', left <= 10);
    if (left <= 0) { G.timeUp = true; if (G.pin) confirm(); else finishRound(null); }
  }
  // camera
  camera.position.set(view.x, EYE, view.z);
  camera.rotation.set(view.pitch, -view.yaw, 0, 'YXZ');
  const [fx, fz] = fwd();
  // street-level ground detail: a tighter window around the camera (more px per metre), repainted after every ~8 m of walking
  const det = S.world.ground.userData.detail;
  if (det.size !== 80) det.size = 80;
  if (det.cx === det.cx && Math.hypot(view.x - det.cx, view.z - det.cz) > 8) det.cx = NaN;
  S.tick(camera, view.x + fx * 35, view.z + fz * 35, now / 1000, { detailDist: 30, shadowDist: 120, detailX: view.x, detailZ: view.z });
  S.light.fog.near = FOG.near; S.light.fog.far = FOG.far;
  $('compass-needle').setAttribute('transform', `rotate(${(-view.yaw * 180 / Math.PI).toFixed(1)} 24 24)`);
  if (!(G.mapOpen && !desktopPanel())) S.renderer.render(S.scene, camera);
}

// ---- game flow ------------------------------------------------------------------------------------------------------------
function planSpawns() {
  const out = [];
  for (let i = 0; i < ROUNDS; i++) {
    const rng = mulberry32(hashStr(`${G.seed}|${G.level}|${S.slug}|${i}`));
    const sp = picker.pick(rng, G.level) || picker.pick(rng, 'normal') || { x: S.world.spawn[0], z: S.world.spawn[1], yaw: 0 };
    out.push(sp);
  }
  return out;
}
function startGame() {
  G.seed = cleanSeed(G.seedFromUrl) || newSeed(); G.seedFromUrl = null;
  G.level = $('seg-diff').querySelector('[aria-pressed="true"]').dataset.d;
  G.timer = $('opt-timer').checked;
  store.set('kur.d', G.level); store.set('kur.timer', G.timer ? '1' : '0');
  try { const u = new URL(location.href); u.searchParams.set('seed', G.seed); u.searchParams.set('d', G.level); history.replaceState(null, '', u); } catch { /* ignore */ }
  G.spawns = planSpawns(); G.results = []; G.round = 0;
  $('start').classList.add('hidden'); $('summary').classList.add('hidden');
  for (const id of ['hud', 'nav', 'open-map']) $(id).classList.remove('hidden');
  map.setNames(G.level === 'easy');
  startRound(0);
}
function startRound(i) {
  document.body.classList.remove('reveal'); $('open-map').classList.remove('hidden');
  G.round = i; G.phase = 'play'; G.pin = null; G.timeUp = false; G.tw = null;
  const sp = G.spawns[i];
  G.origin = { x: sp.x, z: sp.z };
  setPos(sp.x, sp.z); view.yaw = sp.yaw; view.pitch = 0.03; view.vyaw = view.vpitch = 0;
  closeMap(true);
  map.setGuess(null); map.setTruth(null); map.tapEnabled = true;
  map.fitAll(0);
  $('guessbar').classList.remove('hidden'); $('reveal').classList.add('hidden');
  $('pin-dot').classList.add('hidden'); $('confirm').disabled = true;
  G.t0 = performance.now();
  $('timer-chip').textContent = G.timer ? '0:60' : ''; $('timer-chip').classList.remove('low');
  const h = $('hint'); h.classList.remove('hidden', 'fade'); h.textContent = i === 0 ? t('lookHint') + ' · ' + t('stepsHint') : t('lookHint');
  clearTimeout(startRound.h); startRound.h = setTimeout(() => h.classList.add('fade'), 4500);
  refreshTexts();
}
function openMap() {
  if (G.phase !== 'play' && G.phase !== 'reveal') return;
  G.mapOpen = true; $('mappanel').classList.remove('hidden'); document.body.classList.add('map-open');
  requestAnimationFrame(() => { map.resize(); map.invalidate(); });
}
function closeMap(silent) {
  G.mapOpen = false; $('mappanel').classList.add('hidden'); document.body.classList.remove('map-open');
  if (!silent) map.invalidate();
}
function placePin(x, z) {
  if (G.phase !== 'play') return;
  G.pin = [x, z]; map.setGuess(x, z);
  $('confirm').disabled = false; $('pin-dot').classList.remove('hidden');
  refreshTexts();
}
function describe(x, z) {
  let best = null, bd = 90;
  for (const it of S.world.buildingItems) { if (!it.name) continue; const d = Math.hypot(it.x - x, it.z - z); if (d < bd) { bd = d; best = it; } }
  const a = areaAt(x, z), sight = picker.sightNear(x, z, 130);
  return {
    where: best ? `${t('nearTo')} ${best.name}` : '',
    area: [a ? (getLang() === 'lv' ? a.lv : a.en) : '', sight && sight.name ? t('sightNear', { name: sight.name }) : ''].filter(Boolean).join(' · '),
    nameRaw: best ? best.name : null, areaId: a ? a.id : null, sight: sight && sight.name || null,
  };
}
function confirm() { if (G.phase !== 'play' || !G.pin) return; finishRound(G.pin); }
function finishRound(pin) {
  if (G.phase !== 'play') return;
  G.phase = 'reveal'; G.tw = null; document.body.classList.add('reveal');
  const truth = { x: G.pos.x, z: G.pos.z };
  const d = pin ? Math.hypot(pin[0] - truth.x, pin[1] - truth.z) : null;
  const pts = d == null ? 0 : score(d);
  const res = { truth, guess: pin ? { x: pin[0], z: pin[1] } : null, d, pts, ...describe(truth.x, truth.z) };
  G.results.push(res);
  map.tapEnabled = false; map.setTruth(truth.x, truth.z); map.setGuess(pin ? pin[0] : null, pin ? pin[1] : null);
  map.label = d == null || d < 25 ? null : fmtDist(d);
  openMap();
  $('guessbar').classList.add('hidden'); $('reveal').classList.remove('hidden'); $('open-map').classList.add('hidden');
  const pt = [[truth.x, truth.z]]; if (pin) pt.push(pin);
  requestAnimationFrame(() => { map.resize(); map.fitPoints(pt, { pad: 70, padTop: 100, minSpan: 220, ms: 650 }); });
  $('rv-dist').textContent = d == null ? '—' : fmtDist(d);
  $('rv-where').textContent = d == null ? t('noGuess') : (d <= 15 ? t('perfect') + ' ' : '') + res.where;
  if (d == null) $('rv-where').textContent = t('noGuess') + (res.where ? ' · ' + res.where : '');
  $('rv-area').textContent = res.area;
  countUp($('rv-pts'), pts);
  refreshTexts();
}
function countUp(el, to) {
  const t0 = performance.now();
  const f = (n) => { const u = clamp((n - t0) / 800, 0, 1); el.textContent = fmtNum(to * (1 - Math.pow(1 - u, 3))); if (u < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
function nextRound() {
  if (G.phase !== 'reveal') return;
  if (G.round + 1 >= ROUNDS) { showSummary(); return; }
  startRound(G.round + 1);
}
function showSummary() {
  G.phase = 'done'; closeMap(true);
  for (const id of ['hud', 'nav', 'open-map', 'hint']) $(id).classList.add('hidden');
  const total = G.results.reduce((a, r) => a + r.pts, 0);
  $('sum-total').textContent = fmtNum(total);
  const bestI = G.results.reduce((b, r, i, a) => (r.pts > a[b].pts ? i : b), 0);
  const list = $('sum-rounds'); list.innerHTML = '';
  G.results.forEach((r, i) => {
    const li = document.createElement('li'); if (i === bestI) li.className = 'best';
    const cv = document.createElement('canvas'); cv.width = 264; cv.height = 176;
    const info = document.createElement('div');
    info.innerHTML = `<div class="n">${t('round1')} ${i + 1}</div><div class="p">${fmtNum(r.pts)}</div><div class="d">${r.d == null ? '—' : fmtDist(r.d)}</div><div class="w"></div>`;
    info.querySelector('.w').textContent = r.nameRaw || '';
    li.append(cv, info); list.append(li);
    renderMini(cv, S.data, r.guess ? [r.guess.x, r.guess.z] : null, [r.truth.x, r.truth.z]);
  });
  const b = G.results[bestI];
  $('sum-best').textContent = b ? `${t('bestGuess')}: ${t('round1')} ${bestI + 1} · ${b.d == null ? '—' : fmtDist(b.d)}` : '';
  $('summary').classList.remove('hidden');
  G.total = total;
}
function shareText() {
  const u = new URL(SITE); u.searchParams.set('seed', G.seed); u.searchParams.set('d', G.level); if (S.slug !== 'centrs') u.searchParams.set('map', S.slug);
  return t('shareText', { total: fmtNum(G.total || 0), max: fmtNum(ROUNDS * MAXPTS), url: u.toString() });
}
async function share() {
  const text = shareText();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back */ }
  if (!ok) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch { /* ignore */ }
  }
  window.__kurShared = text;
  toast(ok ? t('copied') : t('shareFail'), 1800);
}
function playAgain() {
  G.seedFromUrl = null;
  startGame();
}

// ---- UI wiring --------------------------------------------------------------------------------------------------------------
function onMapView(m) {
  if (G.level !== 'easy' || !G.mapOpen) return;
  const a = areaAt(m.cx, m.cz), chip = $('area-chip');
  if (!a) { chip.classList.add('hidden'); return; }
  chip.textContent = getLang() === 'lv' ? a.lv : a.en; chip.classList.remove('hidden');
}
function refreshTexts() {
  if (!S) return;
  $('round-chip').textContent = t('round', { n: G.round + 1 });
  $('map-title').textContent = G.phase === 'reveal' ? t('round', { n: G.round + 1 }) : t('map');
  $('guess-hint').textContent = G.pin ? '' : t('placePin');
  $('next').textContent = G.round + 1 >= ROUNDS ? t('finish') : t('next');
  $('diff-hint').textContent = t(($('seg-diff').querySelector('[aria-pressed="true"]') || { dataset: { d: 'normal' } }).dataset.d + 'Hint');
  document.title = t('title') + ' — Rīga';
  if (G.phase === 'reveal' && G.results.length) { const r = G.results[G.results.length - 1]; r.where = r.nameRaw ? `${t('nearTo')} ${r.nameRaw}` : ''; $('rv-where').textContent = r.d == null ? t('noGuess') : (r.d <= 15 ? t('perfect') + ' ' : '') + r.where; $('rv-dist').textContent = r.d == null ? '—' : fmtDist(r.d); map.label = r.d == null || r.d < 25 ? null : fmtDist(r.d); map.invalidate(); }
}
function bindUi() {
  bindLook();
  const seg = $('seg-diff');
  const setDiff = (d) => { for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.d === d)); refreshTexts(); };
  for (const b of seg.children) b.addEventListener('click', () => setDiff(b.dataset.d));
  setDiff(G.level);
  G.seedFromUrl = cleanSeed(params.get('seed'));
  $('play').addEventListener('click', startGame);
  $('again').addEventListener('click', playAgain);
  $('share').addEventListener('click', share);
  $('open-map').addEventListener('click', openMap);
  $('close-map').addEventListener('click', () => closeMap());
  $('confirm').addEventListener('click', confirm);
  $('next').addEventListener('click', nextRound);
  $('zin').addEventListener('click', () => map.zoomBy(1.7));
  $('zout').addEventListener('click', () => map.zoomBy(1 / 1.7));
  $('step-fwd').addEventListener('click', () => step(1));
  $('step-bwd').addEventListener('click', () => step(-1));
  // no page scroll / pinch zoom / context menu while playing
  document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.card')) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  $('c').addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
}

// ---- test / review hooks (no effect on play) ---------------------------------------------------------------------------------------
window.__kur = {
  get G() { return G; },
  state: () => ({ phase: G.phase, round: G.round, pin: G.pin, seed: G.seed, level: G.level, mapOpen: G.mapOpen, results: G.results.map((r) => ({ d: r.d, pts: r.pts, where: r.where })), total: G.total }),
  truth: () => ({ x: G.pos.x, z: G.pos.z }),
  spawns: (seed, level = 'normal') => { const save = [G.seed, G.level]; G.seed = seed; G.level = level; const s = planSpawns(); [G.seed, G.level] = save; return s.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3) })); },
  spawnAudit: (n = 200, level = 'normal') => {
    const bad = []; let ok = 0;
    for (let i = 0; i < n; i++) { const sp = picker.pick(mulberry32(hashStr('audit' + i)), level); if (!sp) { bad.push({ i, why: ['none'] }); continue; } const why = auditSpawn(S.data, sp.x, sp.z); if (why.length) bad.push({ i, x: sp.x, z: sp.z, why }); else ok++; }
    return { n, ok, bad };
  },
  mapToClient: (x, z) => { const r = $('mapc').getBoundingClientRect(), [px, py] = map.toScreen(x, z); return [r.left + px, r.top + py]; },
  mapFit: (x, z, s) => { map.animateTo({ s, cx: x, cz: z }, 0); },
  place: (x, z) => placePin(x, z),
  look: (x, z, yaw, pitch = 0.03) => { setPos(x, z); view.yaw = yaw; view.pitch = pitch; G.tw = null; if (!G.origin) G.origin = { x, z }; },
  setPhase: (p) => { G.phase = p; },
  setEye: (v) => { EYE = v; },
  picker: () => picker, world: () => S && S.world, S: () => S, view, eye: () => EYE,
  pick: (seedStr, level = 'normal') => picker.pick(mulberry32(hashStr(seedStr)), level),
};

boot().catch((e) => { console.error(e); fail('bootError'); });
