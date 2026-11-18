// Tramvaja vadītājs — bootstrap, game loop, input, HUD, menus. Simulation: sim.js (pure); route: track.js; other trams + signals: network.js; street life: life.js;
// 3-D pieces: tramModel.js / scene.js / furniture.js; atmosphere: env.js; sound: audio.js. The engine world comes from ../shared/street-world.js (no hole game).
import './tram.css';
import * as THREE from 'three';
import { bootStreetWorld, webglOk } from '../shared/street-world.js';
import { buildTrack } from './track.js';
import { makeRun, Run, TRAM, SCORE, PEN, perfectDriver, recklessDriver } from './sim.js';
import { buildRails, Stops, Passengers } from './scene.js';
import { TramModel } from './tramModel.js';
import { buildWires, SignalHeads, buildSpeedBoards } from './furniture.js';
import { planHazards } from './hazards.js';
import { Network } from './network.js';
import { Life, clearCorridor } from './life.js';
import { Env } from './env.js';
import { TramAudio } from './audio.js';
import { t, applyDom, setLang, getLang, onLang } from './strings.js';
import mezaparks from './routes/mezaparks.json';
import centrs1 from './routes/centrs-1.json';
import centrs2 from './routes/centrs-2.json';
import centrs3 from './routes/centrs-3.json';

const ROUTES = [centrs1, centrs2, centrs3, mezaparks];
const MAPNAME = { centrs: { lv: 'Centrs', en: 'Centre' }, mezaparks: { lv: 'Mežaparks', en: 'Mežaparks' } };
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ls = { get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
let route = ROUTES.find((r) => r.id === params.get('route')) || ROUTES.find((r) => r.id === ls.get('tramvajs.route')) || mezaparks;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtT = (s) => { s = Math.abs(Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isTouch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
const routeTitle = (r) => r.title[getLang()] || r.title.en;
const SETTINGS = (() => { try { return { sound: true, left: false, theme: 'day', ...JSON.parse(ls.get('tramvajs.settings', '{}')) }; } catch { return { sound: true, left: false, theme: 'day' }; } })();
const saveSettings = () => ls.set('tramvajs.settings', JSON.stringify(SETTINGS));
const pbKey = (rid, kind) => `tramvajs.pb.${rid}.${kind}`;
const readPb = (rid, kind) => { try { return JSON.parse(ls.get(pbKey(rid, kind), 'null')); } catch { return null; } };

// ---- loading screen ------------------------------------------------------------------------------------------------------------------
const fill = $('load-fill'), lmsg = $('load-msg');
function setLoad(frac, key) { lmsg.textContent = t(key) + (frac != null && frac < 1 ? ` ${Math.round(frac * 100)}%` : ''); fill.classList.toggle('indet', frac == null); if (frac != null) fill.style.width = Math.round(frac * 100) + '%'; }
function fail(key) { lmsg.textContent = t(key); fill.classList.remove('indet'); fill.style.width = '0'; document.body.dataset.error = key; }

// ---- state -----------------------------------------------------------------------------------------------------------------------------
let S = null, track = null, tram = null, stopsView = null, pax = null, run = null, plan = null, runKind = (params.get('run') || ls.get('tramvajs.run')) === 'full' ? 'full' : 'short', routeGroups = [];
let net = null, life = null, heads = null, boards = null, aiTracks = [], aiModels = [], hazards = null, env = null;
let phase = 'loading';                          // loading | menu | play | paused | result
let view = 'chase';
let auto = null, manual = false, autoCtx = {};
const audio = new TramAudio();
const keys = { up: false, down: false, eb: false };
let touchLever = null, ebTouch = false;
let simTime = 0, acc = 0, lastWarn = -9, toastT = 0, resultT = 0, coachStep = -1, lastAnnounce = -1, lastSwitch = 0;
const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 1100);
const cp = { x: 0, y: 6, z: 0, init: false }, _p = {}, _q = {};
const metrics = { maxDev: 0, frames: 0, frameMs: [], redPass: 0, minTramDist: 1e9, stuckT: 0, maxStuck: 0, reversed: 0, lastS: 0 };
const phone = () => Math.min(window.innerWidth, window.innerHeight) < 600 && isTouch();

// ---- static text -----------------------------------------------------------------------------------------------------------------------
function footerHtml() { return `${t('proto')} · <a href="/">${t('back')}</a><br>${t('credits')}<br>${t('creditsMore')}`; }
function applyStatic() {
  applyDom();
  document.title = t('title');
  $('how').textContent = isTouch() ? t('howTouch') : t('how');
  $('back').textContent = '← ' + t('back'); $('back2').textContent = '← ' + t('back');
  $('foot').innerHTML = footerHtml(); $('foot2').innerHTML = footerHtml();
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  buildMenu();
}
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));
onLang(() => { applyStatic(); buildProg(); });
const destName = (inbound) => (route.line ? (inbound ? route.dirIn : route.dirOut) : route.stops[inbound ? 0 : route.stops.length - 1].name);

// ---- route cards -------------------------------------------------------------------------------------------------------------------------
const infoCache = {};
function runInfo(r, kind) {   // { stops, km, min } from a throw-away reference run (no world needed); cached
  const key = r.id + kind; if (infoCache[key]) return infoCache[key];
  const T = r._track || (r._track = buildTrack(r)), [a, z] = r.runs[kind], p = makeRun(T, a, z);
  return (infoCache[key] = { stops: p.stops.length, km: (p.stops[p.stops.length - 1].s - p.stops[0].s) / 1000, min: p.ttDuration / 60 });
}
function thumb(r) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of r.path) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const W = 200, H = 60, sc = Math.min((W - 12) / Math.max(1, x1 - x0), (H - 12) / Math.max(1, z1 - z0)), ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
  const P = ([x, z]) => `${(ox + (x - x0) * sc).toFixed(1)},${(oz + (z - z0) * sc).toFixed(1)}`;
  const [a, b] = r.runs[runKind];
  const dots = r.stops.map((s, i) => `<circle cx="${P([s.x, s.z]).split(',')[0]}" cy="${P([s.x, s.z]).split(',')[1]}" r="${i >= a && i <= b ? 3.4 : 2}" fill="${i >= a && i <= b ? '#d23a2f' : '#14202b'}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${r.path.map(P).join(' ')}" fill="none" stroke="#1d5ea8" stroke-width="2.4" stroke-linejoin="round"/>${dots}</svg>`;
}
function buildMenu() {
  const box = $('routes'); box.innerHTML = '';
  for (const r of ROUTES) {
    const info = runInfo(r, runKind), pb = readPb(r.id, runKind);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'rcard'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(r === route)); b.dataset.route = r.id;
    b.innerHTML = `${r.line ? `<span class="b">${r.line}</span>` : ''}${thumb(r)}<span class="t">${routeTitle(r)}</span><span class="m">${MAPNAME[r.map][getLang()]} · ${t('runInfo', { n: info.stops, km: info.km.toFixed(1), min: Math.round(info.min) })}</span>${pb ? `<span class="pbk">★ ${pb.points} · ${'★'.repeat(pb.stars)}</span>` : ''}`;
    box.appendChild(b);
  }
  const rs = $('runsel'); rs.innerHTML = '';
  for (const kind of ['short', 'full']) {
    const info = runInfo(route, kind), b = document.createElement('button'); b.type = 'button'; b.dataset.run = kind; b.setAttribute('aria-pressed', String(kind === runKind));
    b.innerHTML = `${t(kind === 'short' ? 'runShort' : 'runFull')}<span class="sub">${t('runInfo', { n: info.stops, km: info.km.toFixed(1), min: Math.round(info.min) })}</span>`; rs.appendChild(b);
  }
  if (plan) $('route-info').textContent = t('routeInfo', { n: plan.stops.length, km: ((plan.stops[plan.stops.length - 1].s - plan.stops[0].s) / 1000).toFixed(1), min: Math.round(plan.ttDuration / 60), kmh: Math.round(plan.avgKmh) });
  $('board').textContent = (route.line ? route.line + ' ' : '') + routeTitle(route).split(' · ')[0].toUpperCase();
  for (const b of document.querySelectorAll('#themesel button, #set-theme button')) b.setAttribute('aria-pressed', String(b.dataset.theme === SETTINGS.theme));
}
/** build everything that belongs to one route: track, hazards, rails, wires, signals, speed boards (the previous route's are removed) */
function setupRoute(r) {
  for (const g of routeGroups) S.scene.remove(g); routeGroups = [];
  route = r; ls.set('tramvajs.route', r.id);
  track = r._track || (r._track = buildTrack(r));
  aiTracks = (r.ai || []).map((a) => buildTrack({ path: a.path, stops: a.stops, switches: [] }));
  const all = [track, ...aiTracks];
  hazards = planHazards(track, S.data.roads, track.stops);
  window.__clear = clearCorridor(S.world, all);
  for (const T of all) routeGroups.push(buildRails(S.scene, T));
  const wires = buildWires(S.scene, track, S.world, { others: aiTracks }); routeGroups.push(wires.group);
  aiTracks.forEach((T) => routeGroups.push(buildWires(S.scene, T, S.world, { others: [track] }).group));
  window.__wires = { poles: wires.poles, skipped: wires.skipped };
  heads = new SignalHeads(S.scene, track, hazards.signals); routeGroups.push(heads.group);
  boards = buildSpeedBoards(S.scene, track); routeGroups.push(boards.group);
  detailCentre.init = false;
}
function pickRoute(id) {
  const r = ROUTES.find((x) => x.id === id); if (!r || r === route) return;
  if (r.map !== route.map) { ls.set('tramvajs.route', r.id); const u = new URL(location.href); u.searchParams.set('route', r.id); u.searchParams.set('run', runKind); location.href = u.toString(); return; }
  setupRoute(r); newRun(runKind);
}

// ---- run lifecycle ----------------------------------------------------------------------------------------------------------------------
function disposeRun() {
  if (stopsView) { S.scene.remove(stopsView.group); stopsView = null; }
  if (pax) { pax.dispose(); pax = null; }
  if (life) { life.dispose(); life = null; }
}
function newRun(kind) {
  runKind = kind; const [a, z] = route.runs[kind];
  disposeRun();
  plan = makeRun(track, a, z);
  net = new Network(track, route, hazards, { seed: 3 + a, startS: plan.stops[0].s, aiTracks, plan });
  run = new Run(track, plan, { env: { scan: (s, d) => net.scan(s, d), signals: net.signals, pedAhead: (maxD) => (life ? life.nextPed(maxD) : null) } });
  net.setPlayer(run);
  stopsView = new Stops(S.scene, track, plan.stops);
  pax = new Passengers(S.scene, track, plan.stops);
  life = new Life(S.scene, S.world, [track, ...aiTracks], net, hazards);
  // AI tram models: one per AI tram
  aiModels.forEach((m) => m.setVisible(false));
  net.ai.forEach((a2, i) => { let m = aiModels[i]; if (!m) { m = aiModels[i] = new TramModel(S.scene); m.setNight(env.night); } m.setVisible(true); a2.model = m; m.setDestination(route.line || '', a2.label === 'oncoming' ? destName(true) : destName(false)); });
  autoCtx = {}; lastWarn = -9; resultT = 0; lastAnnounce = -1; lastSwitch = run.noseS; coachStep = -1;
  tram.setDestination(route.line || '', destName(false));
  buildProg();
  for (const b of $('runsel').children) b.setAttribute('aria-pressed', String(b.dataset.run === kind));
  applyStatic();
  cp.init = false; metrics.maxDev = 0; metrics.redPass = 0; metrics.minTramDist = 1e9; metrics.stuckT = 0; metrics.maxStuck = 0; metrics.reversed = 0; metrics.lastS = run.s;
  hideToast(); $('msg').classList.remove('show');
  heads && heads.update();
}
function buildProg() {
  const el = $('prog'); if (!el || !plan) return;
  el.innerHTML = '';
  const s0 = plan.stops[0].s, s1 = plan.stops[plan.stops.length - 1].s;
  plan.stops.forEach((st, i) => { const m = document.createElement('i'); m.style.left = (100 * (st.s - s0) / (s1 - s0)) + '%'; m.dataset.i = i; if (i === 0) m.classList.add('done'); el.appendChild(m); });
  const b = document.createElement('b'); b.id = 'prog-pos'; el.appendChild(b);
}
function startPlay() {
  audio.unlock();
  $('start').classList.add('hidden'); $('result').classList.add('hidden'); $('pause').classList.add('hidden'); $('howto').classList.add('hidden');
  $('hud').classList.remove('hidden');
  phase = 'play';
  if (!ls.get('tramvajs.intro') && !auto) coachStep = 0;
}
function showMenu() {
  newRun(runKind);
  phase = 'menu'; $('hud').classList.add('hidden'); $('result').classList.add('hidden'); $('pause').classList.add('hidden'); $('start').classList.remove('hidden');
}
function pause(on) {
  if (phase !== 'play' && phase !== 'paused') return;
  phase = on ? 'paused' : 'play'; $('pause').classList.toggle('hidden', !on);
  if (on) { for (const k of ['set-sound']) $(k).checked = !audio.muted; $('set-left').checked = SETTINGS.left; $('set-cab').checked = view === 'cab'; buildMenu(); }
}

// ---- input -----------------------------------------------------------------------------------------------------------------------------
function leverTarget() {
  if (touchLever !== null) return touchLever;
  if (keys.up && !keys.down) return 1;
  if (keys.down && !keys.up) return -1;
  return 0;
}
window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'Space') { if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.up = true; e.preventDefault(); audio.unlock(); break;
    case 'KeyS': case 'ArrowDown': keys.down = true; e.preventDefault(); audio.unlock(); break;
    case 'Space': keys.eb = true; e.preventDefault(); break;
    case 'KeyE': case 'KeyD': case 'Enter': if (phase === 'play') { run.pressDoors(); e.preventDefault(); } else if (phase === 'menu' && e.code === 'Enter' && !$('play').disabled) { startPlay(); } break;
    case 'KeyB': case 'KeyH': if (phase === 'play') bell(); break;
    case 'KeyC': if (phase === 'play') toggleView(); break;
    case 'KeyM': setSound(audio.muted); break;
    case 'Escape': case 'KeyP': pause(phase === 'play'); break;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = false;
  if (e.code === 'Space') keys.eb = false;
});
window.addEventListener('blur', () => { keys.up = keys.down = keys.eb = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.overlay')) e.preventDefault(); }, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const lever = $('lever'), knob = $('knob');
let leverPid = null;
function leverFrom(e) { const r = lever.getBoundingClientRect(); let v = 1 - 2 * ((e.clientY - r.top) / r.height); v = clamp(v, -1, 1); if (Math.abs(v) < 0.08) v = 0; touchLever = v; }
lever.addEventListener('pointerdown', (e) => { e.preventDefault(); leverPid = e.pointerId; try { lever.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } audio.unlock(); leverFrom(e); });
lever.addEventListener('pointermove', (e) => { if (leverPid === e.pointerId) leverFrom(e); });
const leverUp = (e) => { if (leverPid !== e.pointerId) return; leverPid = null; touchLever = null; try { lever.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
lever.addEventListener('pointerup', leverUp); lever.addEventListener('pointercancel', leverUp);
const hold = (el, on, off) => { el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ } on(); }); const up = () => off(); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up); };
hold($('btn-eb'), () => { ebTouch = true; audio.unlock(); }, () => { ebTouch = false; });
$('btn-doors').addEventListener('click', () => { audio.unlock(); if (phase === 'play') run.pressDoors(); });
$('btn-bell').addEventListener('click', () => { audio.unlock(); if (phase === 'play') bell(); });
$('btn-cam').addEventListener('click', () => { if (phase === 'play') toggleView(); });
$('btn-pause').addEventListener('click', () => pause(true));
$('btn-mute').addEventListener('click', () => setSound(audio.muted));
$('resume').addEventListener('click', () => pause(false));
$('play').addEventListener('click', () => startPlay());
$('again').addEventListener('click', () => { newRun(runKind); startPlay(); });
$('restart').addEventListener('click', () => { newRun(runKind); startPlay(); });
$('tomenu').addEventListener('click', () => showMenu());
$('res-menu').addEventListener('click', () => showMenu());
$('btn-howto').addEventListener('click', () => $('howto').classList.remove('hidden'));
$('howto-ok').addEventListener('click', () => $('howto').classList.add('hidden'));
$('coach-x').addEventListener('click', () => endCoach());
$('share').addEventListener('click', () => shareResult());
$('routes').addEventListener('click', (e) => { const b = e.target.closest('.rcard'); if (b && phase === 'menu') pickRoute(b.dataset.route); });
$('runsel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && phase === 'menu') { runKind = b.dataset.run; ls.set('tramvajs.run', runKind); newRun(runKind); } });
for (const grp of ['themesel', 'set-theme']) $(grp).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.theme); });
$('set-sound').addEventListener('change', (e) => setSound(!e.target.checked));
$('set-left').addEventListener('change', (e) => { SETTINGS.left = e.target.checked; saveSettings(); applySettings(); });
$('set-cab').addEventListener('change', (e) => { if ((view === 'cab') !== e.target.checked) toggleView(); });
function bell() { audio.bell(); run.ringBell(); if (life) life.ringBell(simTime); showMsg('🔔', false, 600); }
function toggleView() { view = view === 'chase' ? 'cab' : 'chase'; document.body.classList.toggle('cab', view === 'cab'); $('btn-cam').classList.toggle('on', view === 'cab'); $('btn-cam').lastElementChild.textContent = t(view === 'cab' ? 'chase' : 'cab'); }
function setSound(on) { audio.setMuted(!on); SETTINGS.sound = on; saveSettings(); $('btn-mute').setAttribute('aria-pressed', String(!on)); const c = $('set-sound'); if (c) c.checked = on; }
function setTheme(id) { SETTINGS.theme = id; saveSettings(); if (env) { env.apply(id); tram.setNight(env.night); aiModels.forEach((m) => m.setNight(env.night)); } buildMenu(); }
function applySettings() { document.body.classList.toggle('lefty', !!SETTINGS.left); }
function endCoach() { coachStep = -1; $('coach').classList.add('hidden'); ls.set('tramvajs.intro', '1'); }
function shareResult() {
  const sum = window.__tramResult; if (!sum) return;
  const text = t('shareText', { route: routeTitle(route), run: t(runKind === 'short' ? 'runShort' : 'runFull'), stars: '★'.repeat(sum.stars), pts: sum.points, max: sum.max, happy: sum.happy }) + 'https://bedre.pakers.lv/tramvajs/';
  try { if (navigator.share) { navigator.share({ text }).catch(() => {}); return; } } catch { /* not shareable */ }
  try { navigator.clipboard.writeText(text).then(() => showMsg(t('copied'), false, 1500), () => {}); } catch { /* clipboard blocked */ }
}

// ---- HUD ---------------------------------------------------------------------------------------------------------------------------------
let msgTimer = 0;
function showMsg(text, bad = false, ms = 1800) {
  const m = $('msg'); m.textContent = text; m.classList.toggle('bad', bad); m.classList.add('show');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => m.classList.remove('show'), ms);
}
function hideToast() { $('stoptoast').classList.add('hide'); }
function showToast(res) {
  const el = $('stoptoast');
  const dTxt = res.missed ? '' : (Math.abs(res.d) < 0.05 ? '0 m' : (res.d < 0 ? t('short') + ' ' : t('over') + ' ') + Math.abs(res.d).toFixed(1) + ' m');
  const te = res.timeErr, tTxt = Math.abs(te) <= 8 ? t('onTime') : (te > 0 ? Math.round(te) + ' s ' + t('lateS') : Math.round(-te) + ' s ' + t('early'));
  if (res.missed) el.innerHTML = `<div class="h"><span>${res.name}</span><span class="big" style="color:var(--red)">${t('missed')}</span></div>`;
  else el.innerHTML = `<div class="h"><span>${res.name}</span><span class="big">${res.total}</span></div><div class="h" style="font-size:14px;color:${res.accTxt === 'perfect' ? 'var(--green)' : 'inherit'}"><span>${t(res.accTxt)}</span></div>
    <div class="rows"><span>${t('acc')}</span><span>${dTxt}</span><span>${res.accP}/${SCORE.acc}</span><span>${t('timing')}</span><span>${tTxt}</span><span>${res.timeP}/${SCORE.time}</span><span>${t('smooth')}</span><span>${res.emergency ? '!' : ''}</span><span>${res.smooth}/${SCORE.smooth}</span><span>${t('speed')}</span><span></span><span>${res.speedP}/${SCORE.speed}</span></div>`;
  el.classList.remove('hide'); toastT = 6;
}
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setCls(id, c, on) { const k = id + c; if (hudCache[k] !== on) { hudCache[k] = on; $(id).classList.toggle(c, on); } }
function coachUpdate() {
  if (coachStep < 0 || phase !== 'play') { if ($('coach') && !$('coach').classList.contains('hidden')) $('coach').classList.add('hidden'); return; }
  const st = run.stop; let key = null;
  if (coachStep === 0) { key = 'coachBell'; if (run.stats.bells > 0 || !run.awaitBell) coachStep = 1; }
  if (coachStep === 1) { key = 'coachPower'; if (run.v > 6) coachStep = 2; }
  if (coachStep === 2) { key = 'coachBrake'; if (st && run.distToStop < 130) { /* show */ } else key = null; if (st && run.distToStop < 40) coachStep = 3; }
  if (coachStep === 3) { key = 'coachStop'; if (run.results.length >= 1) { endCoach(); return; } }
  const c = $('coach');
  if (!key) { c.classList.add('hidden'); return; }
  c.classList.toggle('hidden', !$('stoptoast').classList.contains('hide')); setText('coach-t', t(key)); setText('coach-s', t(key + 'S'));
}
function updateHud(dt) {
  if (phase !== 'play' && phase !== 'paused') return;
  const st = run.stop, last = plan.stops[plan.stops.length - 1];
  const kmh = Math.round(run.v * 3.6);
  setText('spd', String(kmh)); setCls('spd', 'over', run.overspeed);
  const lim = Math.round(run.limit * 3.6 / 5) * 5; setText('lim', String(lim));
  let nl = run.limit; for (let d = 10; d <= 90; d += 10) nl = Math.min(nl, track.limit(run.s + d));
  const nlk = Math.round(nl * 3.6 / 5) * 5;
  if (nlk < lim - 4) { setCls('lim2', 'hidden', false); setText('lim2', String(nlk)); } else setCls('lim2', 'hidden', true);
  if (st) {
    setText('st-name', st.name);
    const d = run.distToStop; setText('st-dist', d >= 0 ? Math.round(d) + ' m' : '+' + Math.round(-d) + ' m');
    const due = run.dueIn; const lateF = due < 0; setText('st-due', lateF ? t('late') + ' ' + fmtT(due) : t('due') + ' ' + fmtT(due)); setCls('st-due', 'late', lateF && run.started);
    setText('st-extra', st.last ? t('terminus') : (st.waitingAt ? `👥 ${st.waitingAt} ${t('waiting')}` : ''));
  } else { setText('st-name', last.name); setText('st-dist', '✓'); setText('st-due', ''); setText('st-extra', ''); }
  // punctuality pill: early / on time / late vs the timetable of the NEXT stop, calm colours (standing at a red signal is excused)
  let e = 0, pillKey = 'punctual', cls = 'ok';
  if (st && run.started) e = run.punctuality;
  if (e < -8) { pillKey = 'earlyBy'; cls = 'early'; } else if (e > 8 && e <= 30) { pillKey = 'lateBy'; cls = 'late'; } else if (e > 30) { pillKey = 'lateBy'; cls = 'vlate'; }
  setText('pill', run.started ? t(pillKey, { s: Math.abs(Math.round(e)) }) : t('punctual'));
  const pc = $('pill'); if (hudCache.pillc !== cls) { hudCache.pillc = cls; pc.className = 'pill ' + cls; }
  setText('load', `🚋 ${run.pax}/${110}`);
  $('cmf').style.width = Math.round(run.comfort) + '%'; $('cmf').style.background = run.comfort > 70 ? 'var(--green)' : run.comfort > 40 ? '#d9a000' : 'var(--red)';
  const s0 = plan.stops[0].s, s1 = last.s;
  $('prog-pos').style.left = clamp(100 * (run.s - s0) / (s1 - s0), 0, 100) + '%';
  const ticks = $('prog').children;
  for (let i = 0; i < plan.stops.length; i++) { const r = run.results.find((x) => x.idx === plan.stops[i].idx); const c2 = i === 0 ? 'done' : r ? (r.missed ? 'miss' : 'done') : ''; if (ticks[i].className !== c2) ticks[i].className = c2; }
  // numeric door-to-marker readout + the stopping bar for the last 30 m (top-down: platform zone, green perfect mark, white marker = first door)
  const al = $('align'), sb = $('sbar');
  if (st && run.doorsClosed && !run.pendingOpen && Math.abs(run.distToStop) < 40) {
    const d = run.distToStop, a = Math.abs(d);
    al.classList.remove('hidden'); setText('align', (a <= 0.5 ? '✓ ' : d >= 0 ? '▲ ' : '▼ ') + a.toFixed(1) + ' m');
    setCls('align', 'ok', a <= 0.5); setCls('align', 'near', a > 0.5 && a <= 2);
  } else al.classList.add('hidden');
  if (st && run.doorsClosed && !run.pendingOpen && run.distToStop < 32 && run.distToStop > -14) {
    sb.classList.remove('hidden');
    // bar spans from 30 m before the mark to 6 m past it; the platform zone (door window -26..+10 m) is drawn as the yellow band
    const span = 36, pos = (d) => clamp(100 * (30 - d) / span, 0, 100);   // d = distance still to go; mark at d = 0
    const mark = sb.querySelector('.mark'), door = sb.querySelector('.door'), zone = sb.querySelector('.zone');
    mark.style.left = pos(0) + '%'; zone.style.left = '0%'; zone.style.width = pos(0) + 6 + '%';
    door.style.left = pos(run.distToStop) + '%';
    sb.classList.toggle('ok', Math.abs(run.distToStop) <= 0.5);
    setText('sbar-t', run.distToStop >= 0 ? `▲ ${run.distToStop.toFixed(1)} m` : `▼ ${(-run.distToStop).toFixed(1)} m`);
  } else sb.classList.add('hidden');
  // next signal: aspect + distance within 220 m
  const sg = run.nextSig, sgEl = $('sig');
  if (sg && sg.s - run.noseS < 220 && sg.s - run.noseS > -2) { sgEl.classList.remove('hidden'); if (sgEl.dataset.a !== sg.aspect) sgEl.dataset.a = sg.aspect; setText('sig-d', Math.max(0, Math.round(sg.s - run.noseS)) + ' m'); setText('sig-k', t(sg.kind === 'road' ? 'sigRoad' : 'sigBlock')); } else sgEl.classList.add('hidden');
  // state line
  let state = '', open = false;
  if (run.doorState !== 'closed') { state = run.dwell && run.dwell.done ? (run.dwell.waitDepart ? t('waitDepart') : t('go')) : t('doorsLocked'); open = true; }
  else if (run.pendingOpen) state = t('doorsOpen') + '…';
  else if (run.awaitBell) state = '🔔 ' + t('ringBell');
  else if (run.heldByEnv) state = run.nextSig && run.nextSig.aspect === 'r' ? t('redSig') : t('blocked');
  else if (st && run.v < 1.5 && run.distToStop > 4 && run.distToStop < 60) state = t('zoneHint');
  setText('state', state); setCls('state', 'open', open); setCls('state', 'hidden', !state);
  setCls('btn-doors', 'ready', !!(run.dwell && run.dwell.done && run.doorState === 'open' && !run.dwell.waitDepart));
  setCls('btn-bell', 'must', run.awaitBell && run.doorsClosed && !run.pendingOpen);
  knob.style.top = (50 - run.lever * 44) + '%'; lever.setAttribute('aria-valuenow', String(Math.round(run.lever * 100)));
  if (view === 'cab') { setText('cab-v', String(kmh)); }
  if ((run.overspeed || run.curveOver) && simTime - lastWarn > 3 && run.v > 3) { lastWarn = simTime; showMsg(run.curveOver ? t('curveFast') : t('tooFast'), true); audio.bad(); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0 && run.doorState === 'closed') hideToast(); else if (toastT <= -4) hideToast(); }
  coachUpdate();
}

function handleEvents() {
  for (const e of run.events) {
    switch (e.type) {
      case 'served': { showToast(e.res); (e.res.accTxt === 'perfect' ? audio.good : audio.chime).call(audio, true); break; }
      case 'missed': showToast({ missed: true, name: e.name }); showMsg(t('missed'), true, 2500); audio.bad(); break;
      case 'doorsOpening': { const sv = run.servedStop; const k = plan.stops.indexOf(sv); pax.startDwell(k, run.s, run.dwell.alight, run.dwell.board); audio.doorBeep(false); break; }
      case 'doorsClosing': pax.endDwell(); audio.doorBeep(true); break;
      case 'doorsDenied': showMsg(t('zoneHint'), true, 1500); break;
      case 'redpass': showMsg(t('passedRed', { p: PEN.redPass }), true, 2600); audio.alert(); metrics.redPass++; break;
      case 'atp': if (e.kind !== 'veh') { showMsg(t('atpMsg', { p: PEN.atp }), true, 2600); audio.alert(); } else showMsg(t('blocked'), true, 1500); break;
      case 'finished': resultT = 0.9; break;
    }
  }
  run.events.length = 0;
  const flip = run.s > (track.stops[route.terminus] ? track.stops[route.terminus].s + 30 : 1e9);
  if (flip && !run._flipped) { run._flipped = true; tram.setDestination(route.line || '', destName(true)); }
}

function showResult() {
  const sum = run.summary();
  phase = 'result'; $('hud').classList.add('hidden'); $('result').classList.remove('hidden');
  $('res-board').textContent = (route.line ? route.line + ' ' : '') + routeTitle(route).split(' · ')[0].toUpperCase();
  $('res-stars').innerHTML = [1, 2, 3].map((i) => (i <= sum.stars ? '<b>★</b>' : '★')).join('');
  $('res-pts').textContent = sum.points + ' / ' + sum.max;
  const names = { precision: 'catPrecision', punctuality: 'catPunctuality', comfort: 'catComfort', rules: 'catRules' };
  $('res-cats').innerHTML = Object.keys(names).map((k) => `<span>${t(names[k])}</span><span class="st stars-r">${[1, 2, 3].map((i) => (i <= sum.catStars[k] ? '<b>★</b>' : '★')).join('')}</span>`).join('') + `<span>${t('passengers')}</span><span class="st" style="color:var(--ink)">${sum.happy}% ${t('happy')}</span>`;
  let h = `<tr><th>${t('stopCol')}</th><th>${t('acc')}</th><th>${t('timing')}</th><th>${t('pts')}</th></tr>`;
  for (const r of run.results) h += r.missed ? `<tr class="miss"><td>${r.name}</td><td colspan="2">${t('missed')}</td><td>0</td></tr>` : `<tr><td>${r.name}</td><td>${r.d < 0 ? '−' : '+'}${Math.abs(r.d).toFixed(1)} m</td><td>${r.timeErr > 0 ? '+' : '−'}${Math.abs(Math.round(r.timeErr))} s</td><td><b>${r.total}</b></td></tr>`;
  $('res-table').innerHTML = h;
  const penPts = sum.penalties.reduce((a, p) => a + p.pts, 0);
  $('res-extra').textContent = `${t('time')}: ${fmtT(sum.time)} · ${t('missedN')}: ${sum.missed}${penPts ? ' · ' + t('penalties', { p: penPts }) : ''} · ${t(sum.stars === 3 ? 'stars3' : sum.stars === 2 ? 'stars2' : 'stars1')}`;
  // personal best per route + run, stored on the device
  const prev = readPb(route.id, runKind), isNew = !prev || sum.points > prev.points;
  if (isNew && !auto) ls.set(pbKey(route.id, runKind), JSON.stringify({ points: sum.points, stars: sum.stars, time: Math.round(sum.time), date: new Date().toISOString().slice(0, 10) }));
  const pbEl = $('res-pb'); pbEl.className = 'pb' + (isNew ? ' new' : ''); pbEl.textContent = isNew ? (prev ? t('pbNew') : t('pbNone')) : t('pbBest', { p: prev.points });
  window.__tramResult = sum; window.__tramPbNew = isNew;
  ls.set('tramvajs.intro', '1');
}

// ---- camera ----------------------------------------------------------------------------------------------------------------------------
function fovFor(aspect) { const hf = (aspect < 1 ? 60 : 70) * Math.PI / 180; return clamp(2 * Math.atan(Math.tan(hf / 2) / aspect) * 180 / Math.PI, 46, 82); }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  S.renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = view === 'cab' ? 78 : fovFor(camera.aspect); camera.far = phone() ? 660 : 1000; camera.updateProjectionMatrix();   // beyond fog.far nothing shows: the far plane culls it
}
let camOverride = null;   // test hook: { dx, dy, dz (offset from the tram's first door, along / up / right of the track), look: [dx, dy, dz] } or an absolute { x, y, z, lx, ly, lz }
function updateCamera(dt) {
  const p = _p, q = _q;
  if (camOverride) {
    const o = camOverride;
    if (o.rel) { track.at(run.s + (o.rel.along || 0), p); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw); camera.position.set(p.x + rx * (o.rel.right || 0), o.rel.up ?? 3, p.z + rz * (o.rel.right || 0)); track.at(run.s + (o.look.along || 0), q); camera.lookAt(q.x + rx * (o.look.right || 0), o.look.up ?? 1.5, q.z + rz * (o.look.right || 0)); }
    else { camera.position.set(o.x, o.y, o.z); camera.lookAt(o.lx, o.ly, o.lz); }
    if (o.fov && camera.fov !== o.fov) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
    tram.group.visible = true; return;
  }
  let tx, ty, tz, lx, ly, lz;
  if (view === 'chase') {
    track.at(run.s - (TRAM.length - TRAM.nose) - 12, p); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    const port = camera.aspect < 1;
    tx = p.x + rx * 1.3; tz = p.z + rz * 1.3; ty = (port ? 8.2 : 7.0) + run.v * 0.03;
    track.at(run.s + TRAM.nose + (port ? 20 : 32) + run.v * (port ? 0.6 : 1.2), q); lx = q.x; ly = 0.2; lz = q.z;
  } else {
    track.at(run.s + TRAM.nose - 0.9, p); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    tx = p.x - rx * 0.45; tz = p.z - rz * 0.45; ty = 3.15;
    track.at(run.s + TRAM.nose + 60, q); lx = q.x; ly = 1.9; lz = q.z;
  }
  if (!cp.init) { cp.x = tx; cp.y = ty; cp.z = tz; cp.init = true; }
  const k = view === 'cab' ? 1 : 1 - Math.exp(-dt * 16);
  cp.x += (tx - cp.x) * k; cp.y += (ty - cp.y) * k; cp.z += (tz - cp.z) * k;
  const sh = (run.v > 1 ? 0.012 * Math.min(1, run.v / 10) : 0) + (run.curveOver ? 0.05 : 0);
  camera.position.set(cp.x + (Math.random() - 0.5) * sh, cp.y + (Math.random() - 0.5) * sh, cp.z + (Math.random() - 0.5) * sh);
  camera.lookAt(lx, ly, lz);
  const wantFov = (view === 'cab' ? 78 : fovFor(camera.aspect)) + Math.min(5, run.v * 0.35);
  if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  tram.group.visible = view === 'chase';
}

// ---- simulation step ---------------------------------------------------------------------------------------------------------------------
const STEP = 1 / 60;
function simStep() {
  if (auto) {
    const c = auto === 'perfect' ? perfectDriver(run, autoCtx) : auto === 'blast' ? { lever: run.doorState !== 'closed' || run.pendingOpen ? 0 : 1, doors: run.pendingOpen } : recklessDriver(run);
    run.setLever(c.lever); run.emergency = !!c.emergency; if (c.doors) run.pressDoors(); if (c.bell) bell();
  } else {
    run.setLever(leverTarget()); run.emergency = keys.eb || ebTouch;
  }
  if (phase === 'menu') { run.setLever(0); }
  const prevNose = run.noseS;
  net.update(STEP);
  run.step(STEP); simTime += STEP;
  life.update(STEP, run, simTime);
  // wheel clatter over a switch (the nose passing it), stop announcement chime 110 m before the stop
  for (const sw of track.switches) if (sw > prevNose && sw <= run.noseS) audio.clatter(run.v);
  const st = run.stop; if (st && lastAnnounce !== st.idx && run.distToStop < 110 && run.v > 3) { lastAnnounce = st.idx; audio.announce(); }
  handleEvents();
  pax.update(STEP, run.door);
  if (run.finished && resultT <= 0 && phase === 'play') resultT = 0.5;
  // bookkeeping for the tests: closest approach to another tram, the longest time standing against a person / vehicle on the rails, any backwards movement
  { const P = net.player.pts; let m = 1e9; for (const a of net.ai) if (a.active && a.visible !== false) for (const q of a.pts) for (const w of P) { const d = Math.hypot(q.x - w.x, q.z - w.z); if (d < m) m = d; } if (m < metrics.minTramDist) metrics.minTramDist = m; }
  if (run.v < 0.1 && run.gap < 14 && (run.obKind === 'ped' || run.obKind === 'veh')) { metrics.stuckT += STEP; if (metrics.stuckT > metrics.maxStuck) metrics.maxStuck = metrics.stuckT; } else metrics.stuckT = 0;
  if (run.s < metrics.lastS - 1e-6) metrics.reversed++; metrics.lastS = run.s;
}
function visuals(dt, time) {
  const door = run.door;
  tram.place(track, run.s, door, 1);
  for (const a of net.ai) { if (!a.model) continue; a.model.setVisible(a.active && a.visible !== false && Math.hypot(a.x - cp.x, a.z - cp.z) < 700); if (a.active) a.model.place(a.track, a.s - TRAM.nose, a.door, 1); }
  stopsView.update(time, run.next);
  pax.cull(run.s);
  heads.update();
  updateCamera(dt);
  track.at(run.s, _p); const nr = track.nearest(_p.x, _p.z, Math.max(0, run.s - 30), run.s + 30); metrics.maxDev = Math.max(metrics.maxDev, nr.d);
  metrics.frames++;
  S.world.update(dt, time);
  // street-level view distance: tiny props thin out / trees take the cheap crown on phones; fog + far plane hold the horizon in
  S.world.setViewDistance(phone() ? 1000 : 640);
  const f = track.at(run.s + 12, _q);
  // the engine's close-up ground layer repaints a 110 m window every 22 m (a 33-50 ms frame); this game hands it a focus that jumps in 42 m steps, 38 m ahead of the tram
  const dc = detailCentre; const ahead = track.at(run.s + 38, _q);
  if (!dc.init || Math.hypot(ahead.x - dc.x, ahead.z - dc.z) > 42) { dc.x = ahead.x; dc.z = ahead.z; dc.init = true; }
  S.tick(camera, f.x, f.z, time, { detailDist: phone() ? 999 : 30, shadowDist: phone() ? 90 : 150, detailX: dc.x, detailZ: dc.z });
  S.scene.fog.near = phone() ? 170 : 260; S.scene.fog.far = phone() ? 620 : 900;
  env.frame(time, f);
  audio.update(run.v, run.lever);
}
const detailCentre = { x: 0, z: 0, init: false };

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000; const dt = clamp(raw, 0, 0.1); last = now;
  if (raw > 0 && raw < 1) { metrics.frameMs.push(raw * 1000); if (metrics.frameMs.length > 4000) metrics.frameMs.shift(); }
  if ((phase === 'play' || phase === 'menu') && !manual) {
    acc += dt;
    let n = 0; while (acc >= STEP && n++ < 8) { simStep(); acc -= STEP; }
    if (n >= 8) acc = 0;
  }
  if (resultT > 0 && phase === 'play') { resultT -= dt; if (resultT <= 0) showResult(); }
  if (run) { visuals(dt, now / 1000); updateHud(dt); }
  if (S) S.renderer.render(S.scene, camera);
}

// ---- test hooks (window.__tram) -------------------------------------------------------------------------------------------------------
function installHooks() {
  const api = {
    get phase() { return phase; }, get run() { return run; }, get track() { return track; }, get plan() { return plan; }, get S() { return S; }, get net() { return net; }, get life() { return life; }, get hazards() { return hazards; }, get env() { return env; },
    get audio() { return audio; }, get tram() { return tram; }, get route() { return route; }, get routes() { return ROUTES; }, metrics, camera,
    state() { return { phase, s: run.s, v: run.v, lever: run.lever, door: run.door, doorState: run.doorState, next: run.next, dist: run.distToStop, due: run.dueIn, time: run.time, limit: run.limit, results: run.results.map((r) => ({ ...r })), finished: run.finished, pax: run.pax, pendingOpen: run.pendingOpen, view, started: run.started, awaitBell: run.awaitBell, gap: run.gap, comfort: run.comfort, held: run.heldByEnv, stats: { ...run.stats }, penalties: run.penalties.length }; },
    setAuto(k) { auto = k; autoCtx = {}; },
    bell() { bell(); },
    setManual(b) { manual = !!b; acc = 0; },
    /** advance the simulation synchronously (autopilot allowed) without rendering; the engine's movers advance every 3rd step; returns the state */
    advance(seconds) { const n = Math.round(seconds / STEP); for (let i = 0; i < n && !run.finished; i++) { simStep(); if (i % 3 === 0) S.world.traffic.update(STEP * 3); } tram.place(track, run.s, run.door, 1); return api.state(); },
    start(kind, rid) { if (rid && rid !== route.id) { const r = ROUTES.find((x) => x.id === rid); if (r && r.map === route.map) setupRoute(r); } newRun(kind || runKind); startPlay(); },
    showResult() { showResult(); },
    toggleView() { toggleView(); },
    setTheme(id) { setTheme(id); },
    setCamera(o) { camOverride = o; },
    stats() { const i = S.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, level: S.quality.name, timing: window.__timing || null }; },
    /** per bogie / per module distance of the drawn tram from the route's centre line, metres */
    measure() { return tram.measure(track); },
    doorSides() { return tram.doors.map((d) => ({ side: d.side, open: Math.abs(d.la.position.x + 0.37) > 0.05 })); },
    frameStats() { const a = metrics.frameMs.slice().sort((x, y) => x - y); if (!a.length) return null; const pct = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]; return { n: a.length, avg: a.reduce((s, v) => s + v, 0) / a.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: a[a.length - 1], over33: a.filter((v) => v > 33.4).length, over50: a.filter((v) => v > 50).length }; },
    resetFrames() { metrics.frameMs.length = 0; },
    vehiclesOnTrack() { return life ? life.dyn.length : 0; },
    pbKey,
  };
  window.__tram = api;
}

// ---- boot --------------------------------------------------------------------------------------------------------------------------------
async function boot() {
  applyStatic(); setLoad(0, 'loading');
  if (!webglOk()) { fail('noWebgl'); return; }
  try {
    S = await bootStreetWorld({ canvas: $('c'), params: new URLSearchParams({ map: route.map }), onProgress: (f) => setLoad(f, 'loading'), onPhase: () => setLoad(null, 'building') });
  } catch (e) { console.error(e); fail('bootError'); return; }
  env = new Env(S);
  setupRoute(route);
  tram = new TramModel(S.scene);
  S.renderer.shadowMap.autoUpdate = true;
  newRun(runKind);
  env.apply(SETTINGS.theme); tram.setNight(env.night); aiModels.forEach((m) => m.setNight(env.night));
  heads.update();
  audio.setMuted(!SETTINGS.sound && audio.muted ? true : audio.muted); $('btn-mute').setAttribute('aria-pressed', String(audio.muted));
  applySettings();
  installHooks();
  resize(); window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  phase = 'menu';
  buildMenu();
  $('start').classList.remove('hidden'); $('play').disabled = false;
  $('loading').classList.add('done'); setTimeout(() => { const l = $('loading'); if (l) l.remove(); }, 600);
  document.body.dataset.ready = '1';
  requestAnimationFrame((n) => { last = n; frame(n); });
  if (params.get('autostart') === '1') startPlay();
}
boot().catch((e) => { console.error(e); fail('bootError'); });
