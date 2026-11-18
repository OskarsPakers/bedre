// Smoke test of the tram-driver game (/tramvajs/): build -> preview on 5193 -> Chromium desktop (keyboard), Chromium Pixel 5 (touch, 4x CPU throttle for the frame report),
// real WebKit iPhone 13 (touch).
//   node scripts/smoke-tram.mjs     (GPU=1 uses the real GPU through ANGLE/Metal, default is SwiftShader; ONLY=chromium-desktop,... limits the devices; SKIP_BUILD=1 reuses
//   scripts/.dist-tram; FAST=1 skips the 12 full-route deadlock runs; SHOTS=0 skips screenshots)
// Node side: every route is validated (continuity, turn rate, no U-turn, stops on the track in order) with src/proto/tram/validate.js.
// Per device: boots without console / page errors; real input drives the first leg; the tram stays on the route; stops / doors / boarding; the report card + personal best;
// phone HUD without overlaps (portrait + landscape); audio context running after a gesture; a frame-time report.
// Chromium desktop also: the scripted perfect driver on every route / run (+-5 s of the timetable, 3 stars), the reckless one scores clearly lower, signals (holding at red costs
// nothing, passing red is penalised), AI trams never collide / the player never reverses / nothing blocks the track indefinitely (3 full runs per route), articulation (bogies
// on the rails, no sag), doors on the platform side, the main game at "/" and the service worker. Screenshots: scripts/out/tram2-*.png
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoute } from '../src/proto/tram/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = 5193;
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-tram');
const run = (cmd, args) => new Promise((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error(cmd + ' failed')) : res())));
const ROUTE_IDS = ['mezaparks', 'centrs-1', 'centrs-2', 'centrs-3'];

if (!process.env.SKIP_BUILD) await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']);
let server = null, serverLog = '';
const startServer = () => { server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort', '--host', 'localhost'], { cwd: root, stdio: 'pipe' }); server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d)); };
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
const waitServer = async () => { for (let i = 0; ; i++) { try { const r = await fetch(base + '/tramvajs/'); if (r.ok) return; } catch { /* not yet */ } if (i > 80) throw new Error('preview did not start\n' + serverLog); await new Promise((r) => setTimeout(r, 250)); } };
/** the preview server is a child process that something else on this machine may kill: bring it back before a page load */
const ensureServer = async () => { try { const r = await fetch(base + '/tramvajs/'); if (r.ok) return; } catch { /* down */ } console.log('  (preview server was down: restarting)'); kill(); startServer(); await waitServer(); };
startServer();
process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(1); });
await waitServer();

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const gpuArgs = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const DEVICES = [
  { name: 'chromium-desktop', engine: chromium, ctx: { viewport: { width: 1280, height: 720 }, locale: 'lv-LV' }, touch: false, lang: 'lv', full: true },
  { name: 'chromium-pixel5', engine: chromium, ctx: { ...devices['Pixel 5'] }, touch: true, lang: 'en', throttle: 4 },
  { name: 'webkit-iphone13', engine: webkit, ctx: { ...devices['iPhone 13'], locale: 'en-US' }, touch: true, lang: 'en' },
].filter((d) => !process.env.ONLY || process.env.ONLY.split(',').includes(d.name));
const SHOTS = process.env.SHOTS !== '0';

// ---- node side: route validation ----------------------------------------------------------------------------------------------------------------------
console.log('\n=== routes (node) ===');
for (const id of ROUTE_IDS) {
  const r = JSON.parse(fs.readFileSync(path.join(root, 'src/proto/tram/routes', id + '.json'), 'utf8'));
  const v = validateRoute(r);
  check(`route ${id}: continuous, no U-turn, turn rate, stops in order on the track`, v.ok, `${(v.length / 1000).toFixed(2)} km, ${r.stops.length} stops, max ${v.maxTurn10.toFixed(0)} deg/10 m, min R ${v.minRadius.toFixed(0)} m, ${v.sharp.length} real junction curve(s)${v.errors.length ? ' ERR ' + v.errors.join('; ') : ''}`);
  if (r.ai) for (const a of r.ai) { const va = validateRoute({ id: a.id, path: a.path, stops: a.stops }, { minGap: 100, maxTurn10: 42 }); check(`route ${id}: opposite track ${a.id} valid`, va.ok, va.errors.join('; ')); }
}

async function testDevice(D) {
  console.log(`\n=== ${D.name} ===`);
  const browser = await D.engine.launch({ headless: true, args: D.engine === chromium ? gpuArgs : [] });
  const ctx = await browser.newContext(D.ctx);
  const page = await ctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    pg.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  };
  watch(page);
  const tag = (n) => path.join(out, `tram2-${n}.png`);
  const dn = D.name.split('-')[1];
  const shot = async (n) => { if (!SHOTS) return; await page.waitForTimeout(450); await page.screenshot({ path: tag(n) }); };
  const T = (fn, arg) => page.evaluate(fn, arg);
  const st = () => T(() => window.__tram.state());
  const cdp = D.engine === chromium ? await ctx.newCDPSession(page) : null;
  const open = async (url) => { await ensureServer(); await page.goto(base + url + (process.env.CITY ? '&city=' + process.env.CITY : '')); await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 }); return !(await T(() => document.body.dataset.error)); };
  const tap = (sel) => (D.touch ? page.locator(sel).tap() : page.locator(sel).click());

  // ======== session A: the city centre ========================================================================================================================
  check(`${D.name}: boots (centre map)`, await open('/tramvajs/?route=centrs-1&lang=' + D.lang));
  { const cl = await T(() => window.__tram.S.city && window.__tram.S.city.checkClearance ? window.__tram.S.city.checkClearance(1.6) : null); check(`${D.name}: tram city: no building geometry (below 4.6 m) within 1.6 m of any track on the centre map`, !cl || cl.violations === 0, JSON.stringify(cl)); }
  check(`${D.name}: language`, (await T(() => document.documentElement.lang)) === D.lang, await T(() => document.documentElement.lang));
  check(`${D.name}: start card: 4 route cards, short / full, themes, credits + link back`, await T(() => document.querySelectorAll('#routes .rcard').length === 4 && document.querySelectorAll('#runsel button').length === 2 && document.querySelectorAll('#themesel button').length === 3 && !!document.querySelector('#start:not(.hidden)') && document.querySelector('#foot a[href="/"]') != null && /OpenStreetMap/.test(document.getElementById('foot').textContent) && /LĢIA/.test(document.getElementById('foot').textContent)));
  const infos = await T(() => [...document.querySelectorAll('#runsel button .sub')].map((e) => e.textContent));
  console.log('  run options: ' + infos.join(' | '));
  const shortMin = await T(() => window.__tram.plan.ttDuration / 60);
  check(`${D.name}: the short run is 3-4 stops and ~3-4 min`, (await T(() => window.__tram.plan.stops.length)) <= 4 && shortMin > 2.2 && shortMin < 4.6, `${shortMin.toFixed(1)} min`);
  await shot(`menu-${dn}`);
  console.log(`  quality tier ${await T(() => window.__tram.S.quality.name)}; map ${await T(() => window.__tram.S.slug)}; cleared ${JSON.stringify(await T(() => window.__clear))}; poles ${JSON.stringify(await T(() => window.__wires))}`);

  // ---- play with REAL input and drive the first leg ----------------------------------------------------------------------------------------------------
  await tap('#play');
  await page.waitForFunction(() => window.__tram.phase === 'play');
  check(`${D.name}: Play starts the run`, (await st()).phase === 'play');
  check(`${D.name}: audio context running after the gesture`, await page.waitForFunction(() => window.__tram.audio.state === 'running', null, { timeout: 8000 }).then(() => true).catch(() => false), await T(() => window.__tram.audio.state));
  await T(() => window.__tram.setManual(true));
  let touching = false;
  const leverPos = async (v) => { const r = await T(() => { const b = document.getElementById('lever').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top, h: b.height }; }); return { x: r.x, y: r.y + (1 - v) / 2 * r.h }; };
  const setLever = async (v) => {
    if (D.touch) {
      const p = await leverPos(v);
      if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: touching ? 'touchMove' : 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); touching = true; }
      else { await T(({ x, y, first }) => { const el = document.getElementById('lever'); const o = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }; el.dispatchEvent(new PointerEvent(first ? 'pointerdown' : 'pointermove', o)); }, { ...p, first: !touching }); touching = true; }
    } else {
      const want = v > 0.2 ? 'W' : v < -0.2 ? 'S' : null;
      for (const k of ['W', 'S']) if (k !== want) await page.keyboard.up(k);
      if (want) await page.keyboard.down(want);
    }
  };
  const release = async () => {
    if (D.touch && touching) {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await T(() => document.getElementById('lever').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true })));
      touching = false;
    } else if (!D.touch) { await page.keyboard.up('W'); await page.keyboard.up('S'); }
  };
  // departure flow: doors closed -> bell -> go (power alone rings the bell after 1.4 s)
  check(`${D.name}: ready-to-depart flow: traction waits for the bell`, (await st()).awaitBell === true);
  if (D.touch) await tap('#btn-bell'); else await page.keyboard.press('KeyB');
  await T(() => window.__tram.advance(0.1));
  check(`${D.name}: bell released the departure`, (await st()).awaitBell === false);
  await setLever(1);
  for (let i = 0; i < 30; i++) await T(() => window.__tram.advance(0.2));
  const s0 = await st();
  if (!D.touch) {
    await page.keyboard.press('Escape'); await T(() => 0);
    const paused = await T(() => window.__tram.phase === 'paused' && !document.getElementById('pause').classList.contains('hidden'));
    await page.keyboard.press('Escape');
    check(`${D.name}: Esc pauses and resumes`, paused && (await st()).phase === 'play');
  }
  check(`${D.name}: input accelerates the tram`, s0.v > 3 && s0.started, `v=${s0.v.toFixed(1)} m/s`);
  check(`${D.name}: speed stays under 50 km/h`, s0.v * 3.6 <= 50.5);
  // brake to the first stop with the same input device
  let guard = 0, shotApproach = false;
  while (guard++ < 1500) {
    const s = await st();
    if (s.pendingOpen || s.doorState !== 'closed' || s.results.length >= 1) break;
    const d = s.dist;
    let vt = Math.min(Math.sqrt(2 * 0.75 * Math.max(0, d - 2)), s.limit - 0.8, 12);
    if (s.gap < 60) vt = Math.min(vt, Math.sqrt(2 * 0.7 * Math.max(0, s.gap - 10)));
    if (d < 4) vt = 0.7;
    const lev = s.v < vt - 0.6 ? 1 : s.v > vt + 0.25 ? -1 : 0;
    await setLever(d < -2 ? -1 : lev);
    await T(() => window.__tram.advance(0.15));
    if (!shotApproach && d < 60 && d > 40) { shotApproach = true; await shot(`approach-${dn}`); }
  }
  await release();
  const sStop = await st(), first = sStop.results[0];
  check(`${D.name}: stopped inside the first stop's zone`, !!first && !first.missed && first.d >= -26 && first.d <= 10 && sStop.v < 0.05, first ? `door error ${first.d.toFixed(1)} m, score ${first.total}` : JSON.stringify({ s: sStop.s, v: sStop.v, d: sStop.dist, gap: sStop.gap }));
  check(`${D.name}: stop score toast`, await T(() => !document.getElementById('stoptoast').classList.contains('hide') && document.getElementById('stoptoast').textContent.length > 10));
  if (D.touch) await tap('#btn-doors'); else await page.keyboard.press('KeyE');
  let n = 0; while (n++ < 200 && (await st()).doorState !== 'open') await T(() => window.__tram.advance(0.1));
  check(`${D.name}: doors open at the platform`, (await st()).doorState === 'open');
  await T(() => window.__tram.advance(4));
  const sides = await T(() => window.__tram.doorSides());
  check(`${D.name}: doors open on the platform (right) side only`, sides.filter((d) => d.side === 1).every((d) => d.open) && sides.filter((d) => d.side === -1).every((d) => !d.open), JSON.stringify(sides.map((d) => d.side + (d.open ? 'o' : 'c')).join('')));
  await shot(`stop-doors-${dn}`);
  await setLever(1); await T(() => window.__tram.advance(1)); const sLock = await st(); await release();
  check(`${D.name}: traction locked with doors open`, sLock.v < 0.05, `v=${sLock.v.toFixed(2)}`);
  n = 0; while (n++ < 400 && !((await st()).doorState === 'closed' && !(await st()).pendingOpen)) await T(() => window.__tram.advance(0.1));
  const sDone = await st();
  check(`${D.name}: boarding finished, doors closed, bell asked for`, sDone.doorState === 'closed' && sDone.awaitBell === true && sDone.pax !== 14, `passengers ${sDone.pax}`);
  // early departure is not allowed: the doors stayed open until the scheduled departure time

  // ---- phone HUD: no overlaps (portrait + landscape) -----------------------------------------------------------------------------------------------------
  const overlapJs = () => { const ids = ['lever', 'btn-eb', 'btn-doors', 'btn-bell', 'btn-cam', 'speedo', 'btn-pause', 'btn-mute', 'strip', 'sig', 'sbar', 'state', 'coach', 'align']; const R = ids.map((id) => [id, id === 'strip' ? document.querySelector('#strip .in') : document.getElementById(id)]).filter(([, el]) => el && !el.classList.contains('hidden') && el.offsetParent !== null).map(([id, el]) => [id, el.getBoundingClientRect()]); const hit = (x, y) => !(x.right <= y.left + 1 || y.right <= x.left + 1 || x.bottom <= y.top + 1 || y.bottom <= x.top + 1); const bad = []; for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) if (hit(R[i][1], R[j][1])) bad.push(R[i][0] + '/' + R[j][0]); const vw = innerWidth, vh = innerHeight; const off = R.filter(([, r]) => r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1).map(([id]) => id); return { shown: R.map((r) => r[0]), bad, off }; };
  const hudState = async (label) => {
    // a fresh run near the stopping bar so the bar + signal + coach are visible
    await T(() => { localStorage.removeItem('tramvajs.intro'); const t = window.__tram; t.setManual(true); t.setAuto('perfect'); t.start('short'); t.run.awaitBell = false; let k = 0; while (t.run.distToStop > 28 && k++ < 6000) t.advance(0.1); t.setAuto(null); t.advance(0.01); });
    await page.waitForTimeout(250);
    return label;
  };
  if (D.touch || D.name === 'chromium-desktop') {
    await hudState();
    const o1 = await T(overlapJs);
    check(`${D.name}: HUD without overlaps / off-screen (${await T(() => innerWidth + 'x' + innerHeight)}) [${o1.shown.join(',')}]`, o1.bad.length === 0 && o1.off.length === 0, o1.bad.concat(o1.off).join(','));
    await shot(`hud-${dn}-a`);
    if (D.touch) {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.height, height: vp.width }); await T(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(500);
      const o2 = await T(overlapJs);
      check(`${D.name}: HUD without overlaps in landscape (${vp.height}x${vp.width}) [${o2.shown.join(',')}]`, o2.bad.length === 0 && o2.off.length === 0, o2.bad.concat(o2.off).join(','));
      await shot(`hud-${dn}-landscape`);
      await page.setViewportSize(vp); await T(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(400);
    }
  }
  await T(() => window.__tram.setAuto(null));

  // ---- scripted drivers on the centre routes ---------------------------------------------------------------------------------------------------------------
  const drive = (kind, rid, who, extra) => T(({ kind, rid, who, extra }) => {
    const t = window.__tram; t.start(kind, rid); t.setManual(true); t.setAuto(who);
    if (extra === 'noBell') t.run.awaitBell = false;
    let g = 0; while (!t.run.finished && g++ < 400) t.advance(5);
    const r = t.run, sum = r.summary(), m = t.metrics;
    return { sum, errs: r.results.map((x) => (x.missed ? null : x.timeErr)), time: r.time, tt: t.plan.ttDuration, minTramDist: m.minTramDist, maxStuck: m.maxStuck, reversed: m.reversed, finished: r.finished, atp: r.stats.atp, redPass: r.stats.redPass, held: r.stats.heldS, res: r.results.length, stops: t.plan.stops.length };
  }, { kind, rid, who, extra });
  const sameMapRoutes = D.full ? ['centrs-1', 'centrs-2', 'centrs-3'] : ['centrs-1'];
  for (const rid of sameMapRoutes) {
    for (const kind of D.full ? ['short', 'full'] : ['short']) {
      const p = await drive(kind, rid, 'perfect');
      const maxErr = Math.max(...p.errs.filter((x) => x !== null).map(Math.abs));
      check(`${D.name}: ${rid}/${kind}: perfect driver within +-5 s of the timetable, 3 stars`, p.finished && p.sum.stars === 3 && p.sum.ratio > 0.9 && p.sum.missed === 0 && maxErr <= 5.01, `${p.sum.points}/${p.sum.max}, errs [${p.errs.map((e) => (e === null ? 'M' : e.toFixed(1))).join(' ')}], ${Math.round(p.time)} s (tt ${Math.round(p.tt)}), held ${p.held.toFixed(0)} s, atp ${p.atp}, red ${p.redPass}`);
      if (kind === 'short' && D.full) {
        const rk = await drive(kind, rid, 'reckless');
        check(`${D.name}: ${rid}/${kind}: reckless driver scores clearly lower`, rk.sum.points < p.sum.points * 0.65 && rk.sum.stars === 1, `${rk.sum.points} vs ${p.sum.points}, atp ${rk.atp}, red ${rk.redPass}`);
        if (rk.sum.points < p.sum.points * 0.65) { /* ok */ }
      }
    }
  }
  if (D.full) {
    // missed stop handled
    await T(() => { const t = window.__tram; t.start('short', 'centrs-1'); t.setManual(true); t.setAuto('blast'); let k = 0; while (t.run.results.length < 1 && k++ < 400) t.advance(2); });
    const missed = (await st()).results[0];
    check(`${D.name}: missed stop handled (penalty, no game over)`, missed && missed.missed && missed.total === 0 && (await st()).phase === 'play' && !(await st()).finished, missed ? missed.name : 'none');
    await T(() => window.__tram.setAuto(null));

    // ---- signals: standing at red costs nothing; passing a red is penalised -------------------------------------------------------------------------------
    const sig1 = await T(() => {
      const t = window.__tram; t.start('full', 'centrs-2'); t.setManual(true); t.setAuto('perfect');
      const run = t.run, net = t.net; let g = 0;
      // let the perfect driver run until a block signal is 110-160 m ahead, then show it red for 30 s
      let target = null;
      while (g++ < 20000 && !target) { t.advance(0.1); const s = run.nextSig; if (s && s.kind === 'block' && s.s - run.noseS < 160 && s.s - run.noseS > 110 && run.v > 6) target = s; }
      if (!target) return { err: 'no signal found' };
      net.force(target, 'r', 30); window.__sigTarget = target; window.__sigT0 = { time: run.time, pen: run.penalties.length };
      let stood = false, stoodAt = 0; for (let i = 0; i < 450; i++) { t.advance(0.1); if (run.v < 0.05 && !run.doorsLocked) { stood = true; stoodAt = target.s - run.noseS; break; } }
      t.advance(1); return { stood, stoodAt, aspect: target.aspect, state: document.getElementById('state').textContent };
    });
    await T(() => window.__tram.setManual(false)); await T(() => window.__tram.setAuto(null)); await page.waitForTimeout(200);
    await shot('signal-red');
    const sig2 = await T(() => {
      const t = window.__tram; t.setManual(true); t.setAuto('perfect'); const run = t.run, red0 = run.stats.redPass, n0 = run.results.length;
      for (let i = 0; i < 400; i++) t.advance(0.1);   // red expires, the driver proceeds
      let g = 0; while (run.results.length === n0 && !run.finished && g++ < 600) t.advance(1);   // ... to the next stop: the time at the red must not show as lateness there
      const r = run.results[run.results.length - 1];
      return { passedWhileRed: run.stats.redPass - red0, redTotal: run.stats.redPass, pen: run.penalties.length - window.__sigT0.pen, excused: +run.excused.toFixed(1), held: +run.stats.heldS.toFixed(1), nextStopErr: r && run.results.length > n0 ? +r.timeErr.toFixed(1) : null };
    });
    const sig = { ...sig1, ...sig2 };
    check(`${D.name}: holding at a red block signal stops before it, no penalty, the wait is excused`, sig.stood && sig.stoodAt > -0.5 && sig.stoodAt < 70 && sig.redTotal === 0 && sig.pen === 0 && sig.nextStopErr !== null && Math.abs(sig.nextStopErr) <= 5, JSON.stringify(sig));
    const red = await T(() => {
      const t = window.__tram; t.start('full', 'centrs-2'); t.setManual(true); t.setAuto('perfect'); const run = t.run, net = t.net; let g = 0, target = null;
      while (g++ < 20000 && !target) { t.advance(0.1); const s = run.nextSig; if (s && s.kind === 'block' && s.s - run.noseS < 150 && s.s - run.noseS > 100 && run.v > 6) target = s; }
      net.force(target, 'r', 400); t.setAuto('blast');   // drives straight through
      const pts0 = run.penalties.length; for (let i = 0; i < 300 && run.stats.redPass === 0; i++) t.advance(0.1);
      return { red: run.stats.redPass, pen: run.penalties.length - pts0, sum: run.penalties.map((p) => p.type + ':' + p.pts).join(',') };
    });
    check(`${D.name}: passing a red signal is penalised`, red.red >= 1 && red.pen >= 1, JSON.stringify(red));
    await T(() => { window.__tram.setAuto(null); });

    // ---- pedestrian crossing: the person steps out in front of the tram; the bell makes them hurry (no stop needed), without the bell the collision protection stops the tram -------
    const pedTest = (bell) => T((bell) => {
      const t = window.__tram; t.start('full', 'centrs-3'); t.setManual(true); t.net.ai.forEach((a) => { a.active = false; });
      try { t.S.world.traffic.setFraction(0); } catch { /* the engine's traffic moves in real time: an object on the rails at the start (seen in the failing runs: gap 0.1 m, 1.8 m/s) made this scenario depend on wall-clock timing */ }
      const run = t.run, p = t.hazards.peds[0], q = t.life.peds[0];
      run.awaitBell = false; run.started = true; run.s = p.s - 135 - 3.78; run.v = 9; run.lever = 0.3;
      let rang = false, hit = false, maxSpeed = 0, crossT = 0, onTrack = 0, atp0 = run.stats.atp, minGap = 1e9, g = 0;
      while (g++ < 900) {
        run.setLever(run.v < 9 ? 0.4 : 0.15); t.advance(0.05);
        if (bell && !rang && q.state !== 'idle') { rang = true; t.bell(); }
        maxSpeed = Math.max(maxSpeed, q.speed); if (q.state === 'cross' && Math.abs(q.lat) < 2.2) onTrack += 0.05; if (q.state === 'cross' && Math.abs(q.lat) < 1.5 && run.noseS > p.s) hit = true; minGap = Math.min(minGap, run.gap);
        if (q.state === 'done' || run.noseS > p.s + 20) break;
      }
      return { hit, state: q.state, maxSpeed: +maxSpeed.toFixed(2), onTrack: +onTrack.toFixed(2), atp: run.stats.atp - atp0, minGap: +minGap.toFixed(1), v: +run.v.toFixed(1) };
    }, bell);
    const noBell = await pedTest(false), withBell = await pedTest(true);
    check(`${D.name}: pedestrian crossing: the bell makes them hurry (walk ${noBell.maxSpeed} -> ${withBell.maxSpeed} m/s, on the rails ${noBell.onTrack} -> ${withBell.onTrack} s); never run over (collision protection)`, withBell.maxSpeed > 2.5 && noBell.maxSpeed < 2 && withBell.onTrack < noBell.onTrack && !withBell.hit && !noBell.hit, JSON.stringify({ noBell, withBell }));

    // ---- the overhead / tram model: articulation along the tightest curve of every centre route ---------------------------------------------------------------
    for (const rid of ['centrs-1', 'centrs-2', 'centrs-3']) {
      const art = await T((rid) => {
        const t = window.__tram; t.start('full', rid); t.setManual(true); const tr = t.track;
        let kmax = 0, sk = 0; for (let i = 30; i < tr.n - 30; i++) if (Math.abs(tr.kap[i]) > kmax) { kmax = Math.abs(tr.kap[i]); sk = i * tr.ds; }
        let maxB = 0, maxS = 0, maxBt = 0, maxSt = 0;
        for (let s = 40; s < tr.length - 40; s += 2) { t.tram.place(tr, s, 0, 1); const m = t.tram.measure(tr); const b = Math.max(...m.bogies), g = Math.max(...m.sag); if (b > maxB) maxB = b; if (g > maxS) maxS = g; if (Math.abs(s - sk) < 30) { maxBt = Math.max(maxBt, b); maxSt = Math.max(maxSt, g); } }
        return { rMin: 1 / kmax, sk, maxB, maxS, maxBt, maxSt };
      }, rid);
      check(`${D.name}: ${rid}: articulation: bogies on the rails (<0.1 m), no sag (<0.15 m) incl. the tightest curve (R ${art.rMin.toFixed(0)} m at ${Math.round(art.sk)} m)`, art.maxB < 0.1 && art.maxS < 0.15, `bogie ${art.maxB.toFixed(3)} m, section middle ${art.maxS.toFixed(3)} m (tightest: ${art.maxBt.toFixed(3)} / ${art.maxSt.toFixed(3)})`);
    }
    // the tightest curve of the game (centrs-2 junction, R~14 m) and the Mežaparks loop get a picture each
    await T(() => { const t = window.__tram; t.start('full', 'centrs-2'); t.setManual(true); const tr = t.track; let kmax = 0, sk = 0; for (let i = 30; i < tr.n - 30; i++) if (Math.abs(tr.kap[i]) > kmax) { kmax = Math.abs(tr.kap[i]); sk = i * tr.ds; } t.run.s = sk + 8; t.advance(0.05); t.tram.place(tr, t.run.s, 0, 1); document.getElementById('hud').classList.add('hidden'); t.setCamera({ rel: { along: 10, right: -16, up: 14 }, look: { along: -8, right: 0, up: 0.5 }, fov: 50 }); t.setManual(false); });
    await shot('tram-tight-curve');
    await T(() => { document.getElementById('hud').classList.remove('hidden'); window.__tram.setCamera(null); window.__tram.setManual(true); });

    // ---- 3 full runs per centre route: no collision with other trams, no reversing, nothing blocks the track for long ---------------------------------------------------
    if (!process.env.FAST) for (const rid of ['centrs-1', 'centrs-2', 'centrs-3']) {
      const rr = [];
      for (let k = 0; k < 3; k++) { const p = await drive('full', rid, 'perfect'); rr.push(p); }
      const worst = { dist: Math.min(...rr.map((p) => p.minTramDist)), stuck: Math.max(...rr.map((p) => p.maxStuck)), rev: Math.max(...rr.map((p) => p.reversed)), fin: rr.every((p) => p.finished), late: Math.max(...rr.map((p) => p.time / p.tt)), atp: rr.reduce((a, p) => a + p.atp, 0), err: Math.max(...rr.map((p) => Math.max(...p.errs.filter((x) => x !== null).map(Math.abs)))) };
      check(`${D.name}: ${rid}: 3 full runs: finished, no deadlock, no tram collision (closest ${worst.dist.toFixed(1)} m), never reversed, nothing stuck on the track > 15 s (${worst.stuck.toFixed(1)} s)`, worst.fin && worst.dist > 2.0 && worst.rev === 0 && worst.stuck < 15 && worst.late < 1.5, `time/tt ${worst.late.toFixed(2)}, max err ${worst.err.toFixed(1)} s, atp ${worst.atp}`);
    }
  }

  // ---- report card, personal best ----------------------------------------------------------------------------------------------------------------------
  await T(() => { Object.keys(localStorage).filter((k) => k.startsWith('tramvajs.pb.')).forEach((k) => localStorage.removeItem(k)); const t = window.__tram; t.setCamera(null); t.start('short', 'centrs-1'); t.setManual(true); t.setAuto('perfect'); let g = 0; while (!t.run.finished && g++ < 400) t.advance(5); t.setAuto(null); });
  await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), null, { timeout: 15000 });
  const card = await T(() => ({ stars: document.querySelectorAll('#res-stars b').length, cats: document.querySelectorAll('#res-cats .st').length, rows: document.querySelectorAll('#res-table tr').length, pb: document.getElementById('res-pb').textContent, share: !!document.getElementById('share'), pts: document.getElementById('res-pts').textContent }));
  check(`${D.name}: report card: stars, 4 categories + passengers, table, personal best line, share`, card.stars >= 1 && card.cats === 5 && card.rows >= 4 && card.pb.length > 3 && card.share, JSON.stringify(card));
  await shot(`result-${dn}`);
  const pb1 = await T(() => JSON.parse(localStorage.getItem(window.__tram.pbKey('centrs-1', 'short'))));
  check(`${D.name}: personal best stored on the device`, !!pb1 && pb1.points > 250, JSON.stringify(pb1));
  // a worse run does not replace it
  await T(() => { const t = window.__tram; t.start('short', 'centrs-1'); t.setManual(true); t.setAuto('reckless'); let g = 0; while (!t.run.finished && g++ < 400) t.advance(5); t.setAuto(null); t.showResult(); window.__tramResult = t.run.summary(); });
  const pb2 = await T(() => JSON.parse(localStorage.getItem(window.__tram.pbKey('centrs-1', 'short'))));
  check(`${D.name}: a worse run keeps the best`, pb2 && pb1 && pb2.points === pb1.points);
  // ... and it survives a reload (shown on the route card)
  check(`${D.name}: personal best persists across a reload`, await open('/tramvajs/?route=centrs-1&lang=' + D.lang) && await T(() => /★\s*\d+/.test(document.querySelector('#routes .rcard[aria-checked="true"]').textContent)));

  // ---- frame-time report on a live run (real time, perfect autopilot driving) ---------------------------------------------------------------------------------
  if (cdp && D.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: D.throttle });
  const framesFor = async (label, route2, theme) => {
    await T(({ route2, theme }) => { window.__tram.setTheme(theme); window.__tram.start('full', route2); window.__tram.setManual(false); window.__tram.setAuto('perfect'); window.__tram.run.awaitBell = false; }, { route2, theme });
    await page.waitForTimeout(2500); await T(() => window.__tram.resetFrames()); await page.waitForTimeout(D.throttle || D.engine === webkit ? 14000 : 10000);
    const fs2 = await T(() => ({ f: window.__tram.frameStats(), s: window.__tram.stats() }));
    console.log(`  FRAMES ${D.name} ${label}: ${fs2.f ? `${fs2.f.n} frames, avg ${fs2.f.avg.toFixed(1)} ms (${(1000 / fs2.f.avg).toFixed(0)} fps), p50 ${fs2.f.p50.toFixed(1)}, p95 ${fs2.f.p95.toFixed(1)}, p99 ${fs2.f.p99.toFixed(1)}, max ${fs2.f.max.toFixed(0)} ms, >33 ms: ${fs2.f.over33}, >50 ms: ${fs2.f.over50}` : 'none'}; ${fs2.s.calls} draw calls, ${(fs2.s.triangles / 1e6).toFixed(2)} M triangles, tier ${fs2.s.level}`);
    await T(() => window.__tram.setAuto(null));
    return fs2;
  };
  const fc = await framesFor('centre (day)', 'centrs-1', 'day');
  if (D.full || D.throttle) await shot('scenic-centre-' + dn);
  check(`${D.name}: frame-time report collected (centre)`, !!fc.f && fc.f.n > 20);
  if (cdp && D.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await shot(`play-${dn}`);

  check(`${D.name}: no console / page errors (centre session)`, errors.length === 0, errors.slice(0, 5).join(' | '));

  // ======== session B: Mežaparks ================================================================================================================================
  errors.length = 0;
  if (D.full || D.touch) {
    check(`${D.name}: boots (Mežaparks map)`, await open('/tramvajs/?route=mezaparks&lang=' + D.lang));
    { const cl = await T(() => window.__tram.S.city && window.__tram.S.city.checkClearance ? window.__tram.S.city.checkClearance(1.6) : null); check(`${D.name}: tram city: no building geometry within 1.6 m of any track (Mežaparks)`, !cl || cl.violations === 0, JSON.stringify(cl)); }
    await shot(`menu-mezaparks-${dn}`);
    if (D.full) {
      for (const kind of ['short', 'full']) {
        const p = await drive(kind, 'mezaparks', 'perfect');
        const maxErr = Math.max(...p.errs.filter((x) => x !== null).map(Math.abs));
        check(`${D.name}: mezaparks/${kind}: perfect driver within +-5 s of the timetable, 3 stars`, p.finished && p.sum.stars === 3 && p.sum.ratio > 0.9 && p.sum.missed === 0 && maxErr <= 5.01, `${p.sum.points}/${p.sum.max}, errs [${p.errs.map((e) => (e === null ? 'M' : e.toFixed(1))).join(' ')}], ${Math.round(p.time)} s (tt ${Math.round(p.tt)}), atp ${p.atp}, red ${p.redPass}`);
        if (kind === 'short') { const rk = await drive(kind, 'mezaparks', 'reckless'); check(`${D.name}: mezaparks/${kind}: reckless driver scores clearly lower`, rk.sum.points < p.sum.points * 0.65 && rk.sum.stars === 1, `${rk.sum.points} vs ${p.sum.points}`); }
      }
      const art = await T(() => {
        const t = window.__tram; t.start('full', 'mezaparks'); t.setManual(true); const tr = t.track;
        let kmax = 0, sk = 0; for (let i = 30; i < tr.n - 30; i++) if (Math.abs(tr.kap[i]) > kmax) { kmax = Math.abs(tr.kap[i]); sk = i * tr.ds; }
        let maxB = 0, maxS = 0; for (let s = 40; s < tr.length - 40; s += 2) { t.tram.place(tr, s, 0, 1); const m = t.tram.measure(tr); maxB = Math.max(maxB, ...m.bogies); maxS = Math.max(maxS, ...m.sag); }
        t.run.s = sk + 6; t.advance(0.05); t.tram.place(tr, t.run.s, 0, 1);
        document.getElementById('hud').classList.add('hidden'); t.setCamera({ rel: { along: 8, right: -18, up: 15 }, look: { along: -8, right: 0, up: 0.5 }, fov: 50 }); t.setManual(false);
        return { rMin: 1 / kmax, sk, maxB, maxS };
      });
      check(`${D.name}: mezaparks: articulation in the terminus loop (R ${art.rMin.toFixed(0)} m): bogies <0.1 m, no sag <0.15 m`, art.maxB < 0.1 && art.maxS < 0.15, `bogie ${art.maxB.toFixed(3)} m, section middle ${art.maxS.toFixed(3)} m`);
      await shot('tram-loop-mezaparks');
      await T(() => { document.getElementById('hud').classList.remove('hidden'); window.__tram.setCamera(null); window.__tram.setManual(true); });
      if (!process.env.FAST) {
        const rr = []; for (let k = 0; k < 3; k++) rr.push(await drive('full', 'mezaparks', 'perfect'));
        const worst = { dist: Math.min(...rr.map((p) => p.minTramDist)), stuck: Math.max(...rr.map((p) => p.maxStuck)), rev: Math.max(...rr.map((p) => p.reversed)), fin: rr.every((p) => p.finished), late: Math.max(...rr.map((p) => p.time / p.tt)) };
        check(`${D.name}: mezaparks: 3 full runs: finished, no tram collision (closest ${worst.dist.toFixed(1)} m), never reversed, nothing stuck on the track > 15 s (${worst.stuck.toFixed(1)} s)`, worst.fin && worst.dist > 2 && worst.rev === 0 && worst.stuck < 15 && worst.late < 1.5);
      }
    }
    if (cdp && D.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: D.throttle });
    const fm = await framesFor('Mežaparks (day)', 'mezaparks', 'day');
    if (cdp && D.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    check(`${D.name}: frame-time report collected (Mežaparks)`, !!fm.f && fm.f.n > 20);
    await shot('scenic-mezaparks-' + dn);
    if (D.full) {
      // evening / winter / cab / pedestrian / AI-tram shots
      await T(() => { const t = window.__tram; t.setManual(true); t.setAuto('perfect'); t.start('short', 'mezaparks'); t.run.awaitBell = false; t.advance(30); t.setManual(false); t.setAuto(null); t.setTheme('evening'); });
      await shot('evening'); await T(() => window.__tram.setTheme('winter')); await shot('winter'); await T(() => window.__tram.setTheme('day'));
      await T(() => { window.__tram.toggleView(); }); await shot('cab'); await T(() => { window.__tram.toggleView(); });
    }
    check(`${D.name}: no console / page errors (Mežaparks session)`, errors.length === 0, errors.slice(0, 5).join(' | '));
  }

  // ---- main game from the same build, the removed prototype's URL, the service worker (desktop Chromium + WebKit) -------------------------------------------------
  if (D.name !== 'chromium-pixel5') {
    const main = await ctx.newPage(); const merr = []; main.on('pageerror', (e) => merr.push(e.message));
    await ensureServer(); await main.goto(`${base}/?bots=0&intro=0`);
    await main.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    check(`${D.name}: main game still loads at "/"`, !(await main.evaluate(() => document.body.dataset.error)) && (await main.title()).includes('BEDRE') && merr.length === 0, merr.join('|'));
    await main.close();
    const kp = await ctx.newPage(); const kerr = []; kp.on('pageerror', (e) => kerr.push(e.message)); kp.on('console', (m) => { if (m.type() === 'error') kerr.push(m.text()); });
    await ensureServer(); await kp.goto(`${base}/kur/`);
    await kp.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 }).catch(() => {});
    const kinfo = await kp.evaluate(() => ({ path: location.pathname, title: document.title, game: !!window.__game, err: document.body.dataset.error || '' }));
    check(`${D.name}: the removed /kur/ falls back to the main game and redirects to "/"`, kinfo.path === '/' && /BEDRE/.test(kinfo.title) && kinfo.game && !kinfo.err && kerr.length === 0, JSON.stringify(kinfo) + ' ' + kerr.join('|'));
    await kp.close();
    const c2 = await browser.newContext(D.ctx); const sw = await c2.newPage();
    await ensureServer(); await sw.goto(`${base}/?sw=1`);
    await sw.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 60000 }).catch(async () => { await sw.reload(); });
    await sw.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }, null, { timeout: 60000 });
    await sw.reload(); await sw.waitForTimeout(500);
    const ctrl = await sw.evaluate(() => !!navigator.serviceWorker.controller);
    await ensureServer(); await sw.goto(`${base}/tramvajs/`);
    await sw.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const tp = await sw.evaluate(() => ({ title: document.title, hasTram: !!window.__tram, ctl: !!navigator.serviceWorker.controller }));
    check(`${D.name}: with the service worker active /tramvajs/ loads its own page`, ctrl && tp.hasTram && /Tram/i.test(tp.title), JSON.stringify({ controlled: ctrl, ...tp }));
    await ensureServer(); await sw.goto(`${base}/kur/`);
    await sw.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 }).catch(() => {});
    const k2 = await sw.evaluate(() => ({ path: location.pathname, game: !!window.__game, tram: !!window.__tram }));
    check(`${D.name}: with the service worker active /kur/ still ends on the main game at "/"`, k2.path === '/' && k2.game && !k2.tram, JSON.stringify(k2));
    const cached = await sw.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (/kur/.test(p)) out.push(p); } } return out; });
    check(`${D.name}: the service worker caches no /kur/ entry`, cached.length === 0, cached.join(','));
    await ensureServer(); await sw.goto(`${base}/?bots=0&intro=0&sw=1`);
    await sw.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const mp = await sw.evaluate(() => ({ title: document.title, tram: !!window.__tram, game: !!window.__game }));
    check(`${D.name}: with the service worker active "/" loads the main game`, mp.game && !mp.tram && /BEDRE/.test(mp.title), JSON.stringify(mp));
    await c2.close();
  }
  await browser.close();
}

try {
  for (const D of DEVICES) { try { await testDevice(D); } catch (e) { console.error(e); check(`${D.name}: completed without exception`, false, e.message); } }
  const kurFiles = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (/^kur$/.test(f.name)) kurFiles.push(p); walk(p); } else if (/kur/i.test(f.name) && !/kurzem/.test(f.name)) kurFiles.push(p); } };
  walk(dist); check('no kur files in the build output', kurFiles.length === 0, kurFiles.join(','));
} finally { kill(); }
console.log(failures ? `\n${failures} FAILED` : '\nall tram checks passed');
process.exit(failures ? 1 : 0);
