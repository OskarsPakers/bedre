// Smoke test for the "Kur es esmu?" prototype (/kur/): builds into scripts/.dist-kur, serves it with `vite preview` on :5192, then drives the
// game with real input in Chromium desktop, Chromium Pixel 5 (portrait + landscape) and real WebKit (iPhone 13).
//   node scripts/smoke-kur.mjs            (GPU=1 -> real GPU through Metal/ANGLE for Chromium; default SwiftShader)
//   node scripts/smoke-kur.mjs --quick    (skip the WebKit + landscape runs)
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = 5192, base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-kur');
const quick = process.argv.includes('--quick');

await new Promise((res, rej) => spawn('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);
for (let i = 0; ; i++) {
  try { const r = await fetch(base + '/kur/'); if (r.ok) break; } catch { /* not yet */ }
  if (i > 80) throw new Error('server did not start\n' + serverLog);
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gpuArgs = process.env.GPU
  ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

async function newPage(browser, opts, errors, tag) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return { ctx, page };
}
async function open(page, q) {
  await page.goto(`${base}/kur/?${q}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  const err = await page.evaluate(() => document.body.dataset.error);
  if (err) throw new Error('boot error ' + err);
}
const state = (page) => page.evaluate(() => window.__kur.state());

/** real input: tap at client coordinates */
async function tap(page, mobile, [x, y]) { if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }

/** drag on the 3D canvas with real input where the browser allows it (mouse; CDP touch on Chromium mobile; synthetic pointer events on WebKit) */
async function dragLook(page, kind, dx, dy) {
  const cx = 200, cy = 300;
  if (kind === 'mouse') {
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
    await page.mouse.up();
  } else if (kind === 'cdp') {
    const s = await page.context().newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(cx, cy) });
    for (let i = 1; i <= 8; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx + (dx * i) / 8, cy + (dy * i) / 8) });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.evaluate(({ cx, cy, dx, dy }) => {
      const c = document.getElementById('c'), id = 7;
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
      ev('pointerdown', cx, cy); for (let i = 1; i <= 8; i++) ev('pointermove', cx + (dx * i) / 8, cy + (dy * i) / 8); ev('pointerup', cx + dx, cy + dy);
    }, { cx, cy, dx, dy });
  }
}

async function openMap(page, mobile) {
  const open = await page.evaluate(() => window.__kur.state().mapOpen);
  if (!open) await tap(page, mobile, await centreOf(page, '#open-map'));
  await page.waitForFunction(() => window.__kur.state().mapOpen);
  await sleep(250);
}
async function centreOf(page, sel) { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
/** pan/zoom the map so (x,z) is centred at scale s, then tap it with real input */
async function pinAt(page, mobile, x, z, s = 2.2) {
  await openMap(page, mobile);
  await page.evaluate(({ x, z, s }) => window.__kur.mapFit(x, z, s), { x, z, s });
  await sleep(200);
  const pt = await page.evaluate(({ x, z }) => window.__kur.mapToClient(x, z), { x, z });
  await tap(page, mobile, pt);
  await sleep(150);
}
async function confirmRound(page, mobile) {
  await tap(page, mobile, await centreOf(page, '#confirm'));
  await page.waitForFunction(() => window.__kur.state().phase === 'reveal', null, { timeout: 15000 });
  await sleep(1200); // count-up + fit animation
}

/** one full project run */
async function runProject(name, launch, ctxOpts, { mobile, dragKind, shots, fullGame = true }) {
  const errors = [];
  const browser = await launch();
  const { ctx, page } = await newPage(browser, ctxOpts, errors, name);
  const P = (n) => path.join(out, `kur-${name}-${n}.png`);
  try {
    await open(page, 'seed=smoke1&d=normal&timer=0');
    check(`${name}: boots, start card visible`, await page.locator('#start').isVisible() && await page.locator('#play').isVisible());
    await page.screenshot({ path: P('start') });
    const title = await page.title();
    check(`${name}: page title`, /Kur es esmu/.test(title), title);
    if (!fullGame) { await browser.close(); return errors; }
    // language toggle
    await page.click('[data-lang="lv"]'); check(`${name}: LV strings`, (await page.textContent('#play')) === 'Spēlēt');
    await page.click('[data-lang="en"]'); check(`${name}: EN strings`, (await page.textContent('#play')) === 'Play');
    await tap(page, mobile, await centreOf(page, '#play'));
    await page.waitForFunction(() => window.__kur.state().phase === 'play');
    await sleep(900);
    check(`${name}: seed from URL used`, (await state(page)).seed === 'smoke1');
    await page.screenshot({ path: P('street-1') });

    // look around with real drag
    const y0 = await page.evaluate(() => window.__kur.view.yaw);
    await dragLook(page, dragKind, 160, 0);
    await sleep(500);
    const y1 = await page.evaluate(() => window.__kur.view.yaw);
    check(`${name}: drag rotates the view`, Math.abs(y1 - y0) > 0.3, `yaw ${y0.toFixed(2)} -> ${y1.toFixed(2)}`);
    // walk (optional feature): step forward along the street, moving the truth position
    const t0 = await page.evaluate(() => window.__kur.truth());
    await page.evaluate(() => { const v = window.__kur.view, sp = window.__kur.G.spawns[0]; v.yaw = sp.yaw; });
    await tap(page, mobile, await centreOf(page, '#step-fwd')); await sleep(700);
    const t1 = await page.evaluate(() => window.__kur.truth());
    const walked = Math.hypot(t1.x - t0.x, t1.z - t0.z);
    check(`${name}: step forward moves along the street`, walked > 4 && walked < 40, `${walked.toFixed(1)} m`);
    if (shots) { await page.screenshot({ path: P('street-walk') }); }

    const results = [];
    for (let r = 0; r < 5; r++) {
      if (r > 0) { await page.waitForFunction((r) => window.__kur.state().round === r && window.__kur.state().phase === 'play', r); await sleep(500); }
      const truth = await page.evaluate(() => window.__kur.truth());
      let guess;
      if (r === 0) guess = [truth.x, truth.z];                       // exactly on the spot (map zoomed in: sub-metre per pixel)
      else if (r === 1) { const b = await page.evaluate(() => window.__kur.S().data.meta.bounds); guess = [truth.x > (b.minX + b.maxX) / 2 ? b.minX + 200 : b.maxX - 200, truth.z > (b.minZ + b.maxZ) / 2 ? b.minZ + 200 : b.maxZ - 200]; } // far corner
      else {
        const b = await page.evaluate(() => window.__kur.S().data.meta.bounds);
        guess = [Math.min(b.maxX - 100, Math.max(b.minX + 100, truth.x + (truth.x > (b.minX + b.maxX) / 2 ? -1 : 1) * 120 * r)), Math.min(b.maxZ - 100, Math.max(b.minZ + 100, truth.z - 80 * r))];
      }
      await pinAt(page, mobile, guess[0], guess[1], r === 1 ? 0.35 : 2.0);
      if (r === 0 && shots) {
        await page.screenshot({ path: P('map-pin') });
        // pan by dragging the map: must not move the pin and must not place a new one
        const pin0 = (await state(page)).pin;
        if (dragKind !== 'synthetic') {
          const [mx, my] = await page.evaluate(() => { const b = document.getElementById('mapc').getBoundingClientRect(); return [b.left + b.width * 0.35, b.top + b.height * 0.4]; });
          if (mobile) { const s = await page.context().newCDPSession(page); await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx, y: my, id: 1 }] }); for (let i = 1; i <= 6; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx + 12 * i, y: my + 8 * i, id: 1 }] }); await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
          else { await page.mouse.move(mx, my); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(mx + 12 * i, my + 8 * i); await page.mouse.up(); }
          await sleep(200);
          const pin1 = (await state(page)).pin;
          check(`${name}: map drag pans without moving the pin`, pin0 && pin1 && pin0[0] === pin1[0] && pin0[1] === pin1[1]);
        }
        // wheel / zoom buttons
        await tap(page, mobile, await centreOf(page, '#zout')); await sleep(150);
        await pinAt(page, mobile, guess[0], guess[1], 2.2);
      }
      const pinS = (await state(page)).pin;
      check(`${name}: round ${r + 1} pin placed by tap`, !!pinS, pinS ? `${Math.hypot(pinS[0] - guess[0], pinS[1] - guess[1]).toFixed(1)} m off the tapped spot` : '');
      await confirmRound(page, mobile);
      const st = await state(page), res = st.results[r];
      results.push(res);
      if (r === 0) { check(`${name}: exact guess <= 15 m and full points`, res.d <= 15 && res.pts === 5000, `d=${res.d.toFixed(2)} m pts=${res.pts}`); if (shots) await page.screenshot({ path: P('reveal') }); }
      else if (r === 1) check(`${name}: far guess scores little`, res.d > 1000 && res.pts < 100, `d=${Math.round(res.d)} m pts=${res.pts}`);
      else check(`${name}: round ${r + 1} points match formula`, Math.abs(res.pts - Math.round(5000 * Math.exp(-res.d / 250))) <= 1 && res.pts > 0, `d=${Math.round(res.d)} m pts=${res.pts}`);
      if (r === 0) check(`${name}: reveal names the place`, (await page.textContent('#rv-where')).length > 3, JSON.stringify(await page.textContent('#rv-where')));
      await tap(page, mobile, await centreOf(page, '#next'));
      if (r < 4) await page.waitForFunction((r) => window.__kur.state().round === r + 1, r);
    }
    await page.waitForFunction(() => window.__kur.state().phase === 'done', null, { timeout: 10000 });
    await sleep(400);
    const st = await state(page), sum = results.reduce((a, r) => a + r.pts, 0);
    const shown = await page.textContent('#sum-total');
    check(`${name}: summary total`, st.total === sum && shown.replace(/\D/g, '') === String(sum), `${shown} (sum ${sum})`);
    check(`${name}: summary lists 5 rounds with mini-maps`, (await page.locator('#sum-rounds li canvas').count()) === 5);
    await page.screenshot({ path: P('summary') });
    await page.click('#share'); await sleep(200);
    const shared = await page.evaluate(() => window.__kurShared || '');
    check(`${name}: share text has score, URL and seed`, /\d/.test(shared) && shared.includes('https://bedre.pakers.lv/kur/') && shared.includes('seed=smoke1'), shared);
    await tap(page, mobile, await centreOf(page, '#again'));
    await page.waitForFunction(() => window.__kur.state().phase === 'play' && window.__kur.state().round === 0 && window.__kur.state().results.length === 0, null, { timeout: 15000 });
    const again = await state(page);
    check(`${name}: play again starts a fresh game`, again.phase === 'play' && again.seed !== 'smoke1', `seed ${again.seed}`);
  } catch (e) { check(`${name}: run completed`, false, e.stack || String(e)); try { await page.screenshot({ path: P('FAIL') }); } catch { /* ignore */ } }
  await ctx.close(); await browser.close();
  return errors;
}

const allErrors = [];

// ---- 1. desktop Chromium: the full game + the street views gallery ------------------------------------------------------------------
allErrors.push(...await runProject('desktop', () => chromium.launch({ headless: true, args: gpuArgs }), { viewport: { width: 1280, height: 720 } }, { mobile: false, dragKind: 'mouse', shots: true }));

// ---- 2. cross-cutting checks (desktop Chromium): seed, spawn validity, difficulty, gallery, main game, service worker ----------------------
{
  const errors = [];
  const browser = await chromium.launch({ headless: true, args: gpuArgs });
  const { ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 720 } }, errors, 'misc');
  try {
    await open(page, 'seed=aaa&d=normal');
    const a = await page.evaluate(() => window.__kur.spawns('seed-x', 'normal'));
    const { page: page2, ctx: ctx2 } = await newPage(browser, { viewport: { width: 1280, height: 720 } }, errors, 'misc2');
    await open(page2, 'seed=aaa&d=normal');
    const b = await page2.evaluate(() => window.__kur.spawns('seed-x', 'normal'));
    const c = await page2.evaluate(() => window.__kur.spawns('seed-y', 'normal'));
    check('seed: same seed gives the same five spots in two page loads', JSON.stringify(a) === JSON.stringify(b) && a.length === 5, JSON.stringify(a[0]));
    check('seed: a different seed gives different spots', JSON.stringify(a) !== JSON.stringify(c));
    // game started from ?seed= uses exactly those spots
    await page2.click('#play'); await page2.waitForFunction(() => window.__kur.state().phase === 'play');
    const g = await page2.evaluate(() => window.__kur.G.spawns.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3) })));
    const h = await page2.evaluate(() => window.__kur.spawns('aaa', 'normal'));
    check('seed: ?seed= game uses the seeded spots', JSON.stringify(g) === JSON.stringify(h));
    await ctx2.close();
    // validity of 200 seeded spawns (independent raw-data audit: building footprints, water, bounds) at each difficulty
    for (const lvl of ['normal', 'easy', 'hard']) {
      const au = await page.evaluate(({ lvl }) => window.__kur.spawnAudit(200, lvl), { lvl });
      check(`spawn validity (${lvl}): 200 spawns, none in a building / water / outside bounds`, au.ok === 200 && au.bad.length === 0, `ok=${au.ok} bad=${JSON.stringify(au.bad.slice(0, 3))}`);
    }
    // easy: a sight within 120 m, hard: none within 220 m
    const dif = await page.evaluate(() => {
      const K = window.__kur, pk = K.picker(); let easyOk = 0, hardOk = 0;
      for (let i = 0; i < 40; i++) { const e = K.pick('d' + i, 'easy'), h = K.pick('d' + i, 'hard'); if (e && pk.sightNear(e.x, e.z, 120)) easyOk++; if (h && !pk.sightNear(h.x, h.z, 220)) hardOk++; }
      return { easyOk, hardOk };
    });
    check('difficulty pools: easy spots see a sight, hard spots do not', dif.easyOk === 40 && dif.hardOk === 40, JSON.stringify(dif));
    // eight street views for the gallery
    await page.click('#play'); await page.waitForFunction(() => window.__kur.state().phase === 'play'); await sleep(500);
    for (let i = 1; i <= 8; i++) {
      await page.evaluate((i) => { const K = window.__kur, p = K.pick('gal' + i, i % 3 === 0 ? 'easy' : i % 3 === 1 ? 'normal' : 'hard'); K.look(p.x, p.z, p.yaw + (i % 4 === 0 ? 0.9 : 0), i % 5 === 0 ? 0.3 : 0.04); }, i);
      await sleep(900);
      await page.screenshot({ path: path.join(out, `kur-street-${i}.png`) });
    }
    // eye-height comparison (same spots): 1.75 m vs 3 m
    for (const [tag, eye] of [['175', 1.75], ['300', 3.0]]) {
      for (const i of [2, 5]) {
        await page.evaluate(({ i, eye }) => { const K = window.__kur; K.setEye(eye); const p = K.pick('gal' + i, 'normal'); K.look(p.x, p.z, p.yaw, 0.05); }, { i, eye });
        await sleep(900);
        await page.screenshot({ path: path.join(out, `kur-eye${tag}-${i}.png`) });
      }
    }
    await page.evaluate(() => window.__kur.setEye(1.75));
  } catch (e) { check('misc run completed', false, e.stack || String(e)); }
  await ctx.close();

  // main game from the same build
  try {
    const { page: mp, ctx: mctx } = await newPage(browser, { viewport: { width: 1280, height: 720 } }, errors, 'main');
    await mp.goto(`${base}/?intro=0`);
    await mp.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const ok = await mp.evaluate(() => !document.body.dataset.error && !!document.getElementById('play') && /BEDRE/.test(document.title));
    check('main game: still loads at "/" from the combined build, start screen appears', ok && await mp.locator('#play').isVisible());
    await mp.screenshot({ path: path.join(out, 'kur-main-still-loads.png') });
    await mctx.close();
  } catch (e) { check('main game run completed', false, String(e)); }

  // service worker active: "/" and "/kur/" each load their own page
  try {
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'allow' });
    await sctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const sp = await sctx.newPage();
    sp.on('console', (m) => { if (m.type() === 'error') errors.push('[sw] console: ' + m.text()); });
    sp.on('pageerror', (e) => errors.push('[sw] pageerror: ' + e.message));
    await sp.goto(`${base}/?sw=1&intro=0`);
    await sp.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    await sp.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await sp.waitForFunction(() => !!(window.__swReg && window.__swReg.active), null, { timeout: 120000 });
    await sp.reload(); await sp.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    const controlled = await sp.evaluate(() => !!navigator.serviceWorker.controller);
    check('service worker: active and controlling "/"', controlled);
    const mainTitle = await sp.title();
    await sp.goto(`${base}/kur/?seed=swtest`);
    await sp.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    const info = await sp.evaluate(() => ({ title: document.title, hasKur: !!window.__kur, hasPlay: !!document.getElementById('open-map'), ctrl: !!navigator.serviceWorker.controller, error: document.body.dataset.error || null }));
    check('service worker: /kur/ loads its own page under the active SW', info.hasKur && info.hasPlay && /Kur es esmu/.test(info.title) && info.ctrl && !info.error && /BEDRE/.test(mainTitle) && !/Kur es esmu/.test(mainTitle), JSON.stringify(info) + ' main=' + mainTitle);
    await sp.goto(`${base}/?sw=1&intro=0`);
    await sp.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    check('service worker: back to "/" shows the main game', !(await sp.evaluate(() => !!window.__kur)) && /BEDRE/.test(await sp.title()));
    await sctx.close();
  } catch (e) { check('service worker run completed', false, e.stack || String(e)); }
  await browser.close();
  allErrors.push(...errors);
}

// ---- 3. phones ------------------------------------------------------------------------------------------------------------------------
allErrors.push(...await runProject('pixel5', () => chromium.launch({ headless: true, args: gpuArgs }), { ...devices['Pixel 5'] }, { mobile: true, dragKind: 'cdp', shots: true }));
if (!quick) {
  const land = { ...devices['Pixel 5'], viewport: { width: 851, height: 393 }, screen: { width: 851, height: 393 } };
  allErrors.push(...await runProject('pixel5-landscape', () => chromium.launch({ headless: true, args: gpuArgs }), land, { mobile: true, dragKind: 'cdp', shots: true }));
  allErrors.push(...await runProject('iphone13', () => webkit.launch({ headless: true }), { ...devices['iPhone 13'] }, { mobile: true, dragKind: 'synthetic', shots: true }));
}

check('no console / page errors in any run', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
kill();
process.exit(failures ? 1 : 0);
