// Tramvaja vadītājs — bootstrap, game loop, input, HUD. The simulation lives in sim.js (pure), the route in track.js, the 3-D pieces in scene.js.
import './tram.css';
import * as THREE from 'three';
import { bootStreetWorld, webglOk } from '../shared/street-world.js';
import { buildTrack } from './track.js';
import { makeRun, Run, TRAM, SCORE, perfectDriver, recklessDriver } from './sim.js';
import { TramModel, buildRails, Stops, Passengers, clearRoute } from './scene.js';
import { TramAudio } from './audio.js';
import { t, applyDom, setLang, getLang, onLang } from './strings.js';
import mezaparks from './routes/mezaparks.json';

const ROUTES = { mezaparks };
const RUNS = { short: [3, 7], full: [0, 8] };   // stop index ranges of the mezaparks route: ZOO (outbound) .. Hamburgas (inbound) / the whole circuit
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const route = ROUTES[params.get('route')] || mezaparks;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtT = (s) => { s = Math.abs(Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isTouch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };

// ---- static text -----------------------------------------------------------------------------------------------------------------------
function footerHtml() { return `${t('proto')} · <a href="/">${t('back')}</a><br>${t('credits')}`; }
function applyStatic() {
  applyDom();
  document.title = t('title');
  $('how').textContent = isTouch() ? t('howTouch') : t('how');
  $('back').textContent = '← ' + t('back'); $('back2').textContent = '← ' + t('back');
  $('foot').innerHTML = footerHtml(); $('foot2').innerHTML = footerHtml();
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  const rs = $('runsel').children;
  for (const b of rs) { const [a, z] = RUNS[b.dataset.run]; b.textContent = t(b.dataset.run === 'short' ? 'runShort' : 'runFull', { n: z - a }); }
  if (plan) $('route-info').textContent = t('routeInfo', { n: plan.stops.length - 1, km: ((plan.stops[plan.stops.length - 1].s - plan.stops[0].s) / 1000).toFixed(1), min: Math.round(plan.ttDuration / 60), kmh: Math.round(plan.avgKmh) });
}
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));
onLang(() => { applyStatic(); buildProg(); });

// ---- loading screen -------------------------------------------------------------------------------------------------------------------
const fill = $('load-fill'), lmsg = $('load-msg');
function setLoad(frac, key) { lmsg.textContent = t(key) + (frac != null && frac < 1 ? ` ${Math.round(frac * 100)}%` : ''); fill.classList.toggle('indet', frac == null); if (frac != null) fill.style.width = Math.round(frac * 100) + '%'; }
function fail(key) { lmsg.textContent = t(key); fill.classList.remove('indet'); fill.style.width = '0'; document.body.dataset.error = key; }

// ---- state -----------------------------------------------------------------------------------------------------------------------------
let S = null, track = null, tram = null, stopsView = null, pax = null, run = null, plan = null, runKind = 'short', rails = null;
let phase = 'loading';                          // loading | menu | play | paused | result
let view = 'chase';
let auto = null;                                // test hook: 'perfect' | 'reckless' | 'blast' (full power, never brakes) | null
let manual = false;                             // test hook: the frame loop does not step the sim (the script calls advance())
let autoCtx = {};
const audio = new TramAudio();
const keys = { up: false, down: false, eb: false };
let touchLever = null, ebTouch = false;
let simTime = 0, acc = 0, lastWarn = -9, toastT = 0, resultT = 0;
const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 4000);
const cp = { x: 0, y: 6, z: 0, init: false }, _p = {}, _q = {};
const metrics = { maxDev: 0, maxYawStep: 0, lastYaw: null, frames: 0 };

// ---- run lifecycle ----------------------------------------------------------------------------------------------------------------------
function newRun(kind) {
  runKind = kind; const [a, z] = RUNS[kind];
  if (stopsView) { S.scene.remove(stopsView.group); }
  if (pax) pax.dispose();
  plan = makeRun(track, a, z);
  run = new Run(track, plan);
  stopsView = new Stops(S.scene, track, plan.stops);
  pax = new Passengers(S.scene, track, plan.stops);
  autoCtx = {}; lastWarn = -9; resultT = 0;
  tram.setDestination(route.line, t('dirOut'));
  buildProg();
  for (const b of $('runsel').children) b.setAttribute('aria-pressed', String(b.dataset.run === kind));
  applyStatic();
  cp.init = false;
  metrics.maxDev = 0; metrics.maxYawStep = 0; metrics.lastYaw = null;
  hideToast(); $('msg').classList.remove('show');
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
  $('start').classList.add('hidden'); $('result').classList.add('hidden'); $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  phase = 'play';
}
function showMenu() {
  newRun(runKind);
  phase = 'menu'; $('hud').classList.add('hidden'); $('result').classList.add('hidden'); $('start').classList.remove('hidden');
}
function pause(on) {
  if (phase !== 'play' && phase !== 'paused') return;
  phase = on ? 'paused' : 'play'; $('pause').classList.toggle('hidden', !on);
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
    case 'KeyM': audio.setMuted(!audio.muted); break;
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

// lever slider (touch + mouse): vertical position -> -1..1, spring back to 0 on release
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
$('resume').addEventListener('click', () => pause(false));
$('play').addEventListener('click', () => startPlay());
$('again').addEventListener('click', () => { newRun(runKind); startPlay(); });
$('runsel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && phase === 'menu') newRun(b.dataset.run); });
function bell() { audio.bell(); showMsg('🔔', false, 600); }
function toggleView() { view = view === 'chase' ? 'cab' : 'chase'; document.body.classList.toggle('cab', view === 'cab'); $('btn-cam').classList.toggle('on', view === 'cab'); $('btn-cam').lastElementChild.textContent = t(view === 'cab' ? 'chase' : 'cab'); }

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
function updateHud(dt) {
  if (phase !== 'play' && phase !== 'paused') return;
  const st = run.stop, last = plan.stops[plan.stops.length - 1];
  const kmh = Math.round(run.v * 3.6);
  setText('spd', String(kmh));
  $('spd').classList.toggle('over', run.overspeed);
  const lim = Math.round(run.limit * 3.6 / 5) * 5; setText('lim', String(lim));
  // upcoming lower limit within 90 m
  let nl = run.limit; for (let d = 10; d <= 90; d += 10) nl = Math.min(nl, track.limit(run.s + d));
  const nlk = Math.round(nl * 3.6 / 5) * 5, l2 = $('lim2');
  if (nlk < lim - 4) { l2.classList.remove('hidden'); setText('lim2', String(nlk)); } else l2.classList.add('hidden');
  // strip
  if (st) {
    setText('st-name', st.name);
    const d = run.distToStop; setText('st-dist', d >= 0 ? Math.round(d) + ' m' : '+' + Math.round(-d) + ' m');
    const due = run.dueIn; const late = due < 0; setText('st-due', late ? t('late') + ' ' + fmtT(due) : t('due') + ' ' + fmtT(due)); $('st-due').classList.toggle('late', late && run.started);
    setText('st-extra', st.last ? t('terminus') : '');
  } else { setText('st-name', last.name); setText('st-dist', '✓'); setText('st-due', ''); setText('st-extra', ''); }
  // progress
  const s0 = plan.stops[0].s, s1 = last.s;
  $('prog-pos').style.left = clamp(100 * (run.s - s0) / (s1 - s0), 0, 100) + '%';
  const ticks = $('prog').children;
  for (let i = 0; i < plan.stops.length; i++) { const r = run.results.find((x) => x.idx === plan.stops[i].idx); ticks[i].className = i === 0 ? 'done' : r ? (r.missed ? 'miss' : 'done') : ''; }
  // door-to-marker readout
  const al = $('align');
  if (st && run.doorsClosed && !run.pendingOpen && Math.abs(run.distToStop) < 40) {
    const d = run.distToStop, a = Math.abs(d);
    al.classList.remove('hidden'); al.textContent = (a <= 0.5 ? '✓ ' : d >= 0 ? '▲ ' : '▼ ') + a.toFixed(1) + ' m';
    al.classList.toggle('ok', a <= 0.5); al.classList.toggle('near', a > 0.5 && a <= 2);
  } else al.classList.add('hidden');
  // state line + door button
  let state = '', open = false;
  if (run.doorState !== 'closed') { state = run.dwell && run.dwell.done ? t('go') : t('doorsLocked'); open = true; }
  else if (run.pendingOpen) state = t('doorsOpen') + '…';
  else if (!run.started && phase === 'play') state = '▲ ' + t('power');
  else if (st && run.v < 1.5 && run.distToStop > 4 && run.distToStop < 60) state = t('zoneHint');
  setText('state', state); $('state').classList.toggle('open', open); $('state').classList.toggle('hidden', !state);
  $('btn-doors').classList.toggle('ready', !!(run.dwell && run.dwell.done && run.doorState === 'open'));
  // lever knob + aria
  knob.style.top = (50 - run.lever * 44) + '%'; lever.setAttribute('aria-valuenow', String(Math.round(run.lever * 100)));
  // warnings
  if ((run.overspeed || run.curveOver) && simTime - lastWarn > 3 && run.v > 3) { lastWarn = simTime; showMsg(run.curveOver ? t('curveFast') : t('tooFast'), true); audio.bad(); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0 && run.doorState === 'closed') hideToast(); else if (toastT <= -4) hideToast(); }
}

function handleEvents() {
  for (const e of run.events) {
    switch (e.type) {
      case 'served': { showToast(e.res); (e.res.accTxt === 'perfect' ? audio.good : audio.chime).call(audio, true); break; }
      case 'missed': showToast({ missed: true, name: e.name }); showMsg(t('missed'), true, 2500); audio.bad(); break;
      case 'doorsOpening': { const sv = run.servedStop; const k = plan.stops.indexOf(sv); pax.startDwell(k, run.s, run.dwell.alight, run.dwell.board); audio.chime(true); break; }
      case 'doorsClosing': pax.endDwell(); audio.chime(false); break;
      case 'doorsDenied': showMsg(t('zoneHint'), true, 1500); break;
      case 'finished': resultT = 0.9; break;
    }
    // terminus: the destination board flips as soon as the terminus stop has been served
  }
  run.events.length = 0;
  if (run.results.some((r) => r.idx === route.terminus && !r.missed) || run.s > (track.stops[route.terminus] ? track.stops[route.terminus].s + 30 : 1e9)) { if (!run._flipped) { run._flipped = true; tram.setDestination(route.line, t('dirIn')); } }
}

function showResult() {
  const sum = run.summary();
  phase = 'result'; $('hud').classList.add('hidden'); $('result').classList.remove('hidden');
  $('res-board').textContent = route.line + ' ' + (run._flipped ? t('dirIn') : t('dirOut'));
  $('res-stars').innerHTML = [1, 2, 3].map((i) => (i <= sum.stars ? '<b>★</b>' : '★')).join('');
  $('res-pts').textContent = sum.points + ' / ' + sum.max;
  let h = `<tr><th>${t('stopCol')}</th><th>${t('acc')}</th><th>${t('timing')}</th><th>${t('pts')}</th></tr>`;
  for (const r of run.results) h += r.missed ? `<tr class="miss"><td>${r.name}</td><td colspan="2">${t('missed')}</td><td>0</td></tr>` : `<tr><td>${r.name}</td><td>${r.d < 0 ? '−' : '+'}${Math.abs(r.d).toFixed(1)} m</td><td>${r.timeErr > 0 ? '+' : '−'}${Math.abs(Math.round(r.timeErr))} s</td><td><b>${r.total}</b></td></tr>`;
  $('res-table').innerHTML = h;
  $('res-extra').textContent = `${t('time')}: ${fmtT(sum.time)} · ${t('missedN')}: ${sum.missed} · ${t(sum.stars === 3 ? 'stars3' : sum.stars === 2 ? 'stars2' : 'stars1')}`;
  window.__tramResult = sum;
}

// ---- camera ----------------------------------------------------------------------------------------------------------------------------
function fovFor(aspect) { const hf = (aspect < 1 ? 60 : 70) * Math.PI / 180; return clamp(2 * Math.atan(Math.tan(hf / 2) / aspect) * 180 / Math.PI, 46, 82); }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  S.renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = view === 'cab' ? 78 : fovFor(camera.aspect); camera.updateProjectionMatrix();
}
function updateCamera(dt) {
  const p = _p, q = _q;
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
  // a little rumble at speed / in curves that are taken too fast
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
    run.setLever(c.lever); run.emergency = !!c.emergency; if (c.doors) run.pressDoors();
  } else {
    run.setLever(leverTarget()); run.emergency = keys.eb || ebTouch;
  }
  if (phase === 'menu') { run.setLever(0); }
  run.step(STEP); simTime += STEP;
  handleEvents();
  pax.update(STEP, run.door);
  if (run.finished && resultT <= 0 && phase === 'play') resultT = 0.5;
}
function visuals(dt, time) {
  tram.place(track, run.s, run.door);
  stopsView.update(time, run.next);
  pax.cull(run.s);
  updateCamera(dt);
  // measured for the tests: the tram's first door versus the route's centre line, heading continuity
  track.at(run.s, _p); const nr = track.nearest(_p.x, _p.z, Math.max(0, run.s - 30), run.s + 30); metrics.maxDev = Math.max(metrics.maxDev, nr.d);
  metrics.frames++;
  S.world.update(dt, time);
  const f = track.at(run.s + 12, _q);
  S.tick(camera, f.x, f.z, time, { detailDist: 30, shadowDist: 150 });
  S.scene.fog.near = 280; S.scene.fog.far = 1250;
  audio.update(run.v, run.lever);
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
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
    get phase() { return phase; }, get run() { return run; }, get track() { return track; }, get plan() { return plan; }, get S() { return S; }, metrics, camera,
    state() { return { phase, s: run.s, v: run.v, lever: run.lever, door: run.door, doorState: run.doorState, next: run.next, dist: run.distToStop, due: run.dueIn, time: run.time, limit: run.limit, results: run.results.map((r) => ({ ...r })), finished: run.finished, pax: run.pax, pendingOpen: run.pendingOpen, view, started: run.started }; },
    setAuto(k) { auto = k; autoCtx = {}; },
    setManual(b) { manual = !!b; acc = 0; },
    /** advance the simulation synchronously (autopilot allowed) without rendering; returns the state */
    advance(seconds) { const n = Math.round(seconds / STEP); for (let i = 0; i < n && !run.finished; i++) simStep(); tram.place(track, run.s, run.door); return api.state(); },
    start(kind) { newRun(kind || runKind); startPlay(); },
    showResult() { showResult(); },
    toggleView() { toggleView(); },
    stats() { const i = S.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, level: S.quality.name, timing: window.__timing || null }; },
    /** lateral deviation of the drawn tram (middle of each section) from the route's centre line, metres */
    deviation() { const out = []; for (const g of [tram.front, tram.rear]) { const r = track.nearest(g.position.x, g.position.z); out.push(r.d); } return out; },
    yaws() { return [tram.front.rotation.y, tram.rear.rotation.y]; },
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
  track = buildTrack(route);
  const counts = clearRoute(S.world, track);
  rails = buildRails(S.scene, track);
  tram = new TramModel(S.scene);
  window.__clear = counts;
  newRun('short');
  installHooks();
  resize(); window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  phase = 'menu';
  $('start').classList.remove('hidden'); $('play').disabled = false;
  $('loading').classList.add('done'); setTimeout(() => { const l = $('loading'); if (l) l.remove(); }, 600);
  document.body.dataset.ready = '1';
  requestAnimationFrame((n) => { last = n; frame(n); });
  if (params.get('autostart') === '1') startPlay();
}
boot().catch((e) => { console.error(e); fail('bootError'); });
