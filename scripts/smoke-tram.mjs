// Smoke test of the tram-driver prototype (/tramvajs/): build -> preview on 5193 -> Chromium desktop (keyboard), Chromium Pixel 5 (touch), WebKit iPhone 13 (touch).
//   node scripts/smoke-tram.mjs            (GPU=1 uses the real GPU through ANGLE/Metal, default is SwiftShader; ONLY=chromium-desktop,... limits the devices; SKIP_BUILD=1 reuses scripts/.dist-tram)
// Per device: no console / page errors; real input (keys or touch on the lever) drives the first leg; the tram stays on the route polyline, heading continuous;
// it stops in the first stop's zone, doors open + boarding, the stop score appears. Then scripted drivers: perfect (whole route, high score), reckless (clearly lower),
// blast (never brakes -> missed stop handled), result card + Play again. Chromium desktop also checks: main game at "/" from the same build, service worker active
// ("/" and "/tramvajs/" each load their own page). Screenshots: scripts/out/tram-*.png
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = 5193;
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-tram');
const run = (cmd, args) => new Promise((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error(cmd + ' failed')) : res())));

if (!process.env.SKIP_BUILD) await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']);
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort', '--host', 'localhost'], { cwd: root, stdio: 'pipe' });
let serverLog = ''; server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(1); });
for (let i = 0; ; i++) { try { const r = await fetch(base + '/tramvajs/'); if (r.ok) break; } catch { /* not yet */ } if (i > 80) throw new Error('preview did not start\n' + serverLog); await new Promise((r) => setTimeout(r, 250)); }

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const gpuArgs = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const DEVICES = [
  { name: 'chromium-desktop', engine: chromium, ctx: { viewport: { width: 1280, height: 720 }, locale: 'lv-LV' }, touch: false, lang: 'lv' },
  { name: 'chromium-pixel5', engine: chromium, ctx: { ...devices['Pixel 5'] }, touch: true, lang: 'en' },
  { name: 'webkit-iphone13', engine: webkit, ctx: { ...devices['iPhone 13'], locale: 'en-US' }, touch: true, lang: 'en' },
].filter((d) => !process.env.ONLY || process.env.ONLY.split(',').includes(d.name));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function testDevice(D) {
  console.log(`\n=== ${D.name} ===`);
  const browser = await D.engine.launch({ headless: true, args: D.engine === chromium ? gpuArgs : [] });
  const ctx = await browser.newContext(D.ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  const tag = (n) => path.join(out, `tram-${n}.png`);
  const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: tag(n) }); };
  const T = (fn, arg) => page.evaluate(fn, arg);
  const st = () => T(() => window.__tram.state());
  const cdp = D.engine === chromium && D.touch ? await ctx.newCDPSession(page) : null;

  await page.goto(`${base}/tramvajs/`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  check(`${D.name}: boots`, !(await T(() => document.body.dataset.error)), '');
  check(`${D.name}: language`, (await T(() => document.documentElement.lang)) === D.lang, await T(() => document.documentElement.lang));
  check(`${D.name}: start card + footer link`, (await T(() => !!document.querySelector('#start:not(.hidden)') && document.querySelector('#foot a[href="/"]') != null && /OpenStreetMap/.test(document.getElementById('foot').textContent))));
  const tier = await T(() => window.__tram.S.quality.name);
  console.log(`  quality tier at start: ${tier}; map ${await T(() => window.__tram.S.slug)}; cleared ${JSON.stringify(await T(() => window.__clear))}`);
  await shot(D.touch ? `start-${D.name.includes('pixel') ? 'phone' : 'iphone'}` : 'start-desktop');

  // ---- Play (real click / tap), then drive the first leg with real input --------------------------------------------------------------------
  if (D.touch) await page.locator('#play').tap(); else await page.locator('#play').click();
  await page.waitForFunction(() => window.__tram.phase === 'play');
  check(`${D.name}: Play starts the run`, (await st()).phase === 'play');
  await T(() => window.__tram.setManual(true));
  let touching = false;
  const leverPos = async (v) => { const r = await T(() => { const b = document.getElementById('lever').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top, h: b.height }; }); return { x: r.x, y: r.y + (1 - v) / 2 * r.h }; };
  const setLever = async (v) => {   // touch: drag the lever to v (-1..1); keyboard: W / S held
    if (D.touch) {
      const p = await leverPos(v);
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: touching ? 'touchMove' : 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); touching = true;
      } else {   // WebKit has no CDP: real DOM pointer events with pointerType touch on the lever
        await T(({ x, y, first }) => { const el = document.getElementById('lever'); const o = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }; el.dispatchEvent(new PointerEvent(first ? 'pointerdown' : 'pointermove', o)); }, { ...p, first: !touching }); touching = true;
      }
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
  const devs = [], devsStraight = [], yawSteps = []; let prevYaw = null, prevS = 0;
  const sample = async () => {
    const [dv, yw, ss, kap] = await T(() => [window.__tram.deviation(), window.__tram.yaws(), window.__tram.run.s, (() => { const t = window.__tram.track, r = window.__tram.run.s; return Math.max(...[-30, -24, -12, 0, 6].map((o) => Math.abs(t.curvature(r + o)))); })()]);
    devs.push(...dv); if (kap < 0.004) devsStraight.push(...dv);
    if (prevYaw) for (let i = 0; i < 2; i++) { let d = yw[i] - prevYaw[i]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; yawSteps.push(Math.abs(d)); if (Math.abs(d) > 0.3) console.log(`  yaw step ${d.toFixed(3)} at s=${ss.toFixed(1)} section ${i} (prev s ${prevS.toFixed(1)})`); }
    prevYaw = yw; prevS = ss;
  };
  // accelerate for 6 s of sim
  await setLever(1);
  for (let i = 0; i < 30; i++) { await T(() => window.__tram.advance(0.2)); await sample(); }
  let s0 = await st();
  if (!D.touch) {
    await page.keyboard.press('Escape'); await T(() => 0);
    const paused = await T(() => window.__tram.phase === 'paused' && !document.getElementById('pause').classList.contains('hidden'));
    await page.keyboard.press('Escape');
    check(`${D.name}: Esc pauses and resumes`, paused && (await st()).phase === 'play');
  }
  check(`${D.name}: input accelerates the tram`, s0.v > 3 && s0.started, `v=${s0.v.toFixed(1)} m/s, lever=${s0.lever.toFixed(2)}`);
  check(`${D.name}: speed stays under 50 km/h`, s0.v * 3.6 <= 50.5);
  await shot('chase-' + (D.touch ? D.name.split('-')[1] : 'desktop') + '-accel');
  // follow a simple braking curve to the first stop with the same input device
  let guard = 0, shotApproach = false, shotCurve = false;
  const goal = 1;
  while (guard++ < 1500) {
    const s = await st();
    if (s.pendingOpen || s.doorState !== 'closed' || s.results.length >= goal) break;
    const d = s.dist;
    let vt = Math.min(Math.sqrt(2 * 0.75 * Math.max(0, d - 2)), s.limit - 0.8, 12);
    if (d < 4) vt = 0.7;
    const lev = s.v < vt - 0.6 ? 1 : s.v > vt + 0.25 ? -1 : 0;
    await setLever(d < -2 ? -1 : lev);
    await T(() => window.__tram.advance(0.15));
    await sample();
    if (!shotApproach && d < 60 && d > 40) { shotApproach = true; await shot('approach' + (D.touch ? '-' + D.name.split('-')[1] : '')); await sample(); }
    if (!shotCurve && s.s > 1925 && s.s < 2000 && D.name === 'chromium-desktop') { shotCurve = true; await shot('curve'); }
  }
  await release();
  const sStop = await st();
  const first = sStop.results[0];
  check(`${D.name}: stopped inside the first stop's zone`, !!first && !first.missed && first.d >= -26 && first.d <= 10 && sStop.v < 0.05, first ? `door error ${first.d.toFixed(1)} m, score ${first.total}` : JSON.stringify({ s: sStop.s, v: sStop.v, d: sStop.dist }));
  check(`${D.name}: stop score shown`, await T(() => !document.getElementById('stoptoast').classList.contains('hide') && document.getElementById('stoptoast').textContent.length > 10));
  // doors: auto-open or the Durvis button (real press)
  if (D.touch) await page.locator('#btn-doors').tap(); else await page.keyboard.press('KeyE');
  let n = 0; while (n++ < 200 && (await st()).doorState !== 'open') await T(() => window.__tram.advance(0.1));
  const sOpen = await st();
  check(`${D.name}: doors open at the platform`, sOpen.doorState === 'open', sOpen.doorState);
  await T(() => window.__tram.advance(3));
  await shot('stopped-' + (D.touch ? D.name.split('-')[1] : 'desktop'));
  const paxCtl = await T(() => ({ ctl: window.__tram.run.dwell && window.__tram.run.dwell.board }));
  // tractions locked while the doors are open
  await setLever(1); await T(() => window.__tram.advance(1)); const sLock = await st(); await release();
  check(`${D.name}: traction locked with doors open`, sLock.v < 0.05, `v=${sLock.v.toFixed(2)}`);
  n = 0; while (n++ < 300 && !((await st()).doorState === 'closed' && !(await st()).pendingOpen)) await T(() => window.__tram.advance(0.1));
  const sDone = await st();
  check(`${D.name}: boarding finished, doors closed`, sDone.doorState === 'closed' && sDone.pax !== 14, `passengers aboard ${sDone.pax}`);
  const maxDoorDev = await T(() => window.__tram.metrics.maxDev), maxSec = Math.max(...devs);
  const maxYaw = Math.max(...yawSteps);
  const maxStraight = Math.max(0, ...devsStraight);
  check(`${D.name}: tram locked to the track (first door ~0; sections: chord sag only in curves)`, maxDoorDev < 0.02 && maxStraight < 0.1 && maxSec < 1.3, `first door ${maxDoorDev.toFixed(3)} m, section middles: ${maxStraight.toFixed(3)} m on straights, ${maxSec.toFixed(2)} m max (R~20 m loop) over ${devs.length / 2} samples`);
  check(`${D.name}: heading continuous`, maxYaw < 0.3, `max step ${maxYaw.toFixed(3)} rad`);
  const trackYaw = await T(() => { const t = window.__tram.track; let m = 0; for (let i = 1; i < t.n; i++) m = Math.max(m, Math.abs(t.yaw[i] - t.yaw[i - 1])); return m; });
  check(`${D.name}: route centre line smooth (max heading change per metre)`, trackYaw < 0.1, `${trackYaw.toFixed(3)} rad/m`);

  // ---- scripted drivers --------------------------------------------------------------------------------------------------------------------------
  const finish = async (kind, run) => {
    await T(({ kind, run }) => { window.__tram.start(run); window.__tram.setManual(true); window.__tram.setAuto(kind); }, { kind, run });
    let guard = 0; while (guard++ < 400 && !(await st()).finished) await T(() => window.__tram.advance(5));
    return T(() => ({ sum: window.__tram.run.summary(), results: window.__tram.run.results.map((r) => ({ name: r.name, total: r.total, missed: r.missed })) }));
  };
  const perfect = await finish('perfect', 'short');
  check(`${D.name}: perfect driver completes the route with a high score`, perfect.sum.stars === 3 && perfect.sum.ratio > 0.9 && perfect.results.length === 4 && perfect.sum.missed === 0, `${perfect.sum.points}/${perfect.sum.max}, ${perfect.sum.stars} stars, ${Math.round(perfect.sum.time)} s`);
  await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), null, { timeout: 15000 });
  check(`${D.name}: result card shown`, await T(() => document.querySelectorAll('#res-table tr').length >= 5 && document.querySelectorAll('#res-stars b').length >= 1));
  await shot('result' + (D.touch ? '-' + D.name.split('-')[1] : ''));
  if (D.touch) await page.locator('#again').tap(); else await page.locator('#again').click();
  await page.waitForFunction(() => window.__tram.phase === 'play' && window.__tram.run.next === 1 && window.__tram.run.results.length === 0);
  check(`${D.name}: Play again restarts`, true);
  const reckless = await finish('reckless', 'short');
  check(`${D.name}: reckless driver scores clearly lower`, reckless.sum.points < perfect.sum.points * 0.5 && reckless.sum.stars === 1, `${reckless.sum.points} vs ${perfect.sum.points}, overspeed ${reckless.sum.stats.overspeedS.toFixed(0)} s`);
  // a missed stop: full power, never brakes
  await T(() => { window.__tram.start('short'); window.__tram.setManual(true); window.__tram.setAuto('blast'); });
  n = 0; while (n++ < 400 && (await st()).results.length < 1) await T(() => window.__tram.advance(2));
  const missed = (await st()).results[0];
  check(`${D.name}: missed stop handled (penalty, no game over)`, missed && missed.missed && missed.total === 0 && (await st()).phase === 'play' && !(await st()).finished && (await st()).next === 2, missed ? `${missed.name}` : 'no result');
  await T(() => { window.__tram.setAuto(null); window.__tram.setManual(false); });

  // ---- HUD shots ---------------------------------------------------------------------------------------------------------------------------------
  if (D.touch) {
    await T(() => { window.__tram.start('short'); window.__tram.setManual(true); window.__tram.setAuto('perfect'); });
    await T(() => { const t = window.__tram; let k = 0; while (t.run.distToStop > 70 && k++ < 40000) t.advance(0.05); });
    const tt = D.name.split('-')[1];
    await shot('hud-portrait-' + tt);
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await T(() => window.dispatchEvent(new Event('resize')));
    await shot('hud-landscape-' + tt);
    await page.setViewportSize(vp); await page.waitForTimeout(400);
    const overlap = await T(() => { const ids = ['lever', 'btn-eb', 'btn-doors', 'btn-bell', 'btn-cam', 'speedo', 'btn-pause']; const R = ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]); const hit = (x, y) => !(x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top); const bad = []; for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) if (hit(R[i][1], R[j][1])) bad.push(R[i][0] + '/' + R[j][0]); return bad; });
    check(`${D.name}: portrait controls do not overlap`, overlap.length === 0, overlap.join(','));
  } else {
    await T(() => { window.__tram.start('short'); window.__tram.setManual(true); window.__tram.setAuto('perfect'); });
    await T(() => { const t = window.__tram; let k = 0; while (t.run.distToStop > 70 && k++ < 40000) t.advance(0.05); });
    await T(() => window.__tram.toggleView()); await shot('cab'); await T(() => window.__tram.toggleView());
    await T(() => { const t = window.__tram; t.setManual(false); });
  }
  const st2 = await T(() => ({ calls: window.__tram.stats().calls, tris: window.__tram.stats().triangles }));
  console.log(`  render: ${st2.calls} draw calls, ${(st2.tris / 1e6).toFixed(2)} M triangles, tier ${await T(() => window.__tram.S.quality.name)}`);
  check(`${D.name}: no console / page errors`, errors.length === 0, errors.slice(0, 5).join(' | '));

  // ---- main game from the same build + service worker (desktop Chromium + WebKit) ------------------------------------------------------------
  if (D.name !== 'chromium-pixel5') {
    const main = await ctx.newPage(); const merr = [];
    main.on('pageerror', (e) => merr.push(e.message));
    await main.goto(`${base}/?bots=0&intro=0`);
    await main.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    check(`${D.name}: main game still loads at "/"`, !(await main.evaluate(() => document.body.dataset.error)) && (await main.title()).includes('BEDRE') && merr.length === 0, merr.join('|'));
    await main.close();
    const c2 = await browser.newContext(D.ctx); const sw = await c2.newPage();
    await sw.goto(`${base}/?sw=1`);
    await sw.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 60000 }).catch(async () => { await sw.reload(); });
    await sw.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }, null, { timeout: 60000 });
    await sw.reload(); await sw.waitForTimeout(500);
    const ctrl = await sw.evaluate(() => !!navigator.serviceWorker.controller);
    await sw.goto(`${base}/tramvajs/`);
    await sw.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const tp = await sw.evaluate(() => ({ title: document.title, hasTram: !!window.__tram, ctl: !!navigator.serviceWorker.controller }));
    check(`${D.name}: with the service worker active /tramvajs/ loads its own page`, ctrl && tp.hasTram && /Tram/i.test(tp.title), JSON.stringify({ controlled: ctrl, ...tp }));
    await sw.goto(`${base}/?bots=0&intro=0&sw=1`);
    await sw.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const mp = await sw.evaluate(() => ({ title: document.title, tram: !!window.__tram, game: !!window.__game }));
    check(`${D.name}: with the service worker active "/" loads the main game`, mp.game && !mp.tram && /BEDRE/.test(mp.title), JSON.stringify(mp));
    await c2.close();
  }
  await browser.close();
}

try {
  for (const D of DEVICES) { try { await testDevice(D); } catch (e) { console.error(e); check(`${D.name}: completed without exception`, false, e.message); } }
} finally { kill(); }
console.log(failures ? `\n${failures} FAILED` : '\nall tram checks passed');
process.exit(failures ? 1 : 0);
