// Phone gameplay smoke test. Runs the BUILT game on REAL WebKit (iPhone 13, iPhone SE) and on Chromium with an Android profile (Pixel 5),
// portrait and landscape, with real touch input: Chromium gets true touch events through CDP Input.dispatchTouchEvent (multi-touch included);
// WebKit has no multi-touch API in Playwright, so taps are real page.touchscreen taps and multi-point drags are synthesised PointerEvents
// (pointerType 'touch') dispatched at the canvas. An "iPhone" profile on Chromium is NOT an iPhone, so WebKit is never skipped.
//
//   MOBILE_PORT=5184 [GPU=1] node scripts/smoke-mobile.mjs [--no-build] [--skip-round] [--only <config-substring>] [--group <name>] [--memory [--maps centrs,agenskalns]]
//   groups: layout, steer, camera, chips, haptics, wake, orient, resume, first, turnstile, battery, round   (default: all; --skip-round drops the 2:00 round)
//   --memory: a real-time autoplay round on EVERY map on WebKit iPhone 13 (page must not reload / crash), prints texture memory per map
// Screenshots: scripts/out/mobile-<webkit|chromium>-*.png
import { chromium, webkit, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.MOBILE_PORT || 5184);
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-mobile');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const only = arg('--only', ''), groupOnly = arg('--group', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GPU_ARGS = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

if (!has('--no-build')) await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 } });
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
const kill = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(250); }

let pass = 0, fail = 0;
let cur = '';
const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${cur}] ${name}${info !== '' && (!ok || process.env.VERBOSE) ? '  ' + info : ''}`); return ok; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const deg = (r) => r * 180 / Math.PI;

// ---- configurations -----------------------------------------------------------------------------------------------------------------
const CONFIGS = [
  { name: 'webkit-iPhone13', eng: 'webkit', dev: 'iPhone 13', land: 'iPhone 13 landscape', android: false },
  { name: 'webkit-iPhoneSE', eng: 'webkit', dev: 'iPhone SE', land: 'iPhone SE landscape', android: false },
  { name: 'chromium-Pixel5', eng: 'chromium', dev: 'Pixel 5', land: 'Pixel 5 landscape', android: true },
].filter((c) => !only || c.name.includes(only));
const browsers = {};
const getBrowser = async (eng) => browsers[eng] || (browsers[eng] = await (eng === 'webkit' ? webkit : chromium).launch({ headless: true, args: eng === 'chromium' ? GPU_ARGS : [] }));

// init script: spies for APIs that headless browsers do not really have (vibration, wake lock, fullscreen) + a page-reload marker
const INIT = `
  window.__boot = Math.random(); window.__pageshows = 0; addEventListener('pageshow', () => window.__pageshows++);
  window.__vib = [];
  if (${'${VIB}'}) { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(p); return true; } }); }
  window.__wl = [];
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (t) => { const s = { type: t, released: false, listeners: [], addEventListener(n, f) { this.listeners.push(f); }, async release() { this.released = true; for (const f of this.listeners) f(); } }; window.__wl.push(s); return s; } } });
  window.__fs = 0;
  try { Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true }); Element.prototype.requestFullscreen = function () { window.__fs++; return Promise.resolve(); }; } catch (e) {}
`;

async function newPage(cfg, { land = false, size = null, storage = {}, errs, battery = null, lang = 'lv-LV', mock = true, origin = base } = {}) {
  const b = await getBrowser(cfg.eng);
  const prof = { ...devices[land ? cfg.land : cfg.dev] };
  if (size) prof.viewport = { width: size[0], height: size[1] };
  const ctx = await b.newContext({ ...prof, locale: lang, timezoneId: 'Europe/Riga' });
  await ctx.addInitScript(INIT.replace('${VIB}', cfg.android ? 'true' : 'false'));
  if (Object.keys(storage).length) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) { try { if (localStorage.getItem('__seeded') == null) localStorage.setItem(k, v); } catch {} } try { localStorage.setItem('__seeded', '1'); } catch {} }, storage);
  if (battery) await ctx.addInitScript((lv) => { navigator.getBattery = () => Promise.resolve({ charging: false, level: lv, addEventListener() {} }); }, battery);
  if (mock) await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.__origin = origin;
  page.__nav = 0; page.__crash = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.__nav++; });
  page.on('crash', () => { page.__crash++; errs.push('PAGE CRASH'); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|GPU stall|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  page.__ctx = ctx; page.__cfg = cfg;
  if (cfg.eng === 'chromium') page.__cdp = await ctx.newCDPSession(page);
  page.__pts = new Map();
  return page;
}
async function load(page, q = '') {
  await page.goto(`${page.__origin || base}/?quality=low&intro=0&radio=0${q ? '&' + q : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  const e = await page.evaluate(() => document.body.dataset.error);
  if (e) throw new Error('boot error ' + e);
  await sleep(300);
}

// ---- touch ----------------------------------------------------------------------------------------------------------------------------
async function cdpTouch(page, type) {
  const pts = [...page.__pts.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 1, radiusY: 1, force: 1 }));
  await page.__cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
}
const synth = (page, type, id, x, y) => page.evaluate(([type, id, x, y]) => {
  const c = document.getElementById('c');
  c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true, cancelable: true }));
}, [type, id, x, y]);
const T = {
  async down(page, id, x, y) { page.__pts.set(id, { x, y }); if (page.__cdp) await cdpTouch(page, 'touchStart'); else await synth(page, 'pointerdown', id, x, y); },
  async move(page, id, x, y) { page.__pts.set(id, { x, y }); if (page.__cdp) await cdpTouch(page, 'touchMove'); else await synth(page, 'pointermove', id, x, y); },
  async up(page, id) {
    const p = page.__pts.get(id); page.__pts.delete(id);
    if (page.__cdp) await cdpTouch(page, 'touchEnd'); else await synth(page, 'pointerup', id, p.x, p.y);
  },
  async tap(page, x, y) { await page.touchscreen.tap(x, y); },   // real touch on both engines
  async tapEl(page, sel) { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); },
  async drag(page, id, from, to, steps = 6, dt = 16) { for (let i = 1; i <= steps; i++) { await T.move(page, id, from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await sleep(dt); } },
};
const vp = (page) => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const hole = (page) => page.evaluate(() => { const h = window.__game.hole; return { x: h.x, z: h.z, r: h.radius, t: performance.now() }; });
const holeScreen = (page) => page.evaluate(() => { const g = window.__life.game; g._v.set(g.player.x, 0, g.player.z).project(g.cam.camera); return { x: (g._v.x * 0.5 + 0.5) * innerWidth, y: (-g._v.y * 0.5 + 0.5) * innerHeight }; });

async function play(page, { settle = 2400 } = {}) {
  const phase = await page.evaluate(() => window.__game.state.phase);
  if (phase === 'menu' || phase === 'ended') {
    if (await page.isVisible('#play')) await T.tapEl(page, '#play'); else if (await page.isVisible('#again')) await T.tapEl(page, '#again');
    else await page.evaluate(() => window.__game.start());
  } else await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase), null, { timeout: 15000 });
  await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 15000 });
  await sleep(settle);
}

// HUD geometry ---------------------------------------------------------------------------------------------------------------------------
const HUD_SEL = ['#card-score', '#card-time', '#board-chip', '#minimap-box', '#sizebox', '#hud-btns > button', '#attrib', '#end-free', '#mp-net', '#a2hs'];
const LANE_SEL = ['#feed .feed-item', '#labels .lab', '#meta-area.show', '#meta-toasts .meta-toast', '#swallowed:not(.hidden)', '#daily-intro.show'];
const rects = (page, sels) => page.evaluate((sels) => {
  const res = [];
  for (const s of sels) for (const el of document.querySelectorAll(s)) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    res.push({ s, x: r.left, y: r.top, w: r.width, h: r.height, id: el.id || el.className });
  }
  return res;
}, sels);
const hits = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
function unionShare(rs, W, H) {
  const step = 3; let c = 0, n = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { n++; if (rs.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) c++; }
  return c / n;
}
/** Generic guard: any visible fixed / absolute element that paints something (background, border, shadow) and covers > 25 % of the viewport is a bug
 *  (the class of bug that stretched #mp-net over a real iPhone). Transparent full-screen containers (#hud, #tags, #popups ...) are fine. */
const oversized = (page, allow = []) => page.evaluate((allow) => {
  const W = innerWidth, H = innerHeight, bad = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(CANVAS|SCRIPT|STYLE|HEAD|LINK|META)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (r.width * r.height <= 0.25 * W * H) continue;
    const painted = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
    if (painted && !allow.includes(el.id)) bad.push(`#${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
}, allow);
const SHOT = (cfg) => (name) => path.join(out, `mobile-${cfg.eng}-${cfg.name.split('-')[1]}-${name}.png`);

// ================================================================================================================================================
const want = (g) => (!groupOnly || groupOnly === g) && g !== 'online';
async function suite(cfg) {
  cur = cfg.name;
  const errs = [];
  const shot = SHOT(cfg);
  console.log(`\n== ${cfg.name} (${cfg.eng}${cfg.android ? ', Android profile' : ''})`);

  // ---------------- first-visit defaults (fresh storage) + start screen ----------------------------------------------------------------
  if (want('first') || want('layout')) {
    const p = await newPage(cfg, { errs });
    await load(p);
    const a = await p.evaluate(() => ({ play: document.getElementById('play').textContent, mode: window.__modes.state.id, stored: localStorage.getItem('bedre.mode'), cls: document.body.className, ctl: window.__mobile.prefs.control }));
    check('first-time phone visitor: Quick preselected, Play label "Spēlēt — Ātrā 2:00"', a.mode === 'quick' && /Ātrā 2:00/.test(a.play), JSON.stringify(a));
    check('Quick default writes nothing to storage', a.stored === null);
    check('body classes: touch + tui, joystick is the default control', /touch/.test(a.cls) && /tui/.test(a.cls) && a.ctl === 'stick', a.cls);
    await p.screenshot({ path: shot('start') });
    // advanced: new options, all >= 44 px
    await T.tapEl(p, '#opts-toggle'); await sleep(200);
    const adv = await p.evaluate(() => ['ctlsw', 'senssw', 'leftysw', 'hapticssw', 'savesw'].map((id) => { const e = document.getElementById(id); const r = e && e.getBoundingClientRect(); return { id, vis: !!e && e.offsetParent !== null }; }));
    check('Advanced shows controls / sensitivity / left-handed / haptics / battery saver', adv.every((x) => x.vis), JSON.stringify(adv));
    const targets = await p.evaluate(() => [...document.querySelectorAll('#start button, #start select, #start input')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.textContent.trim().slice(0, 14), w: r.width, h: r.height }; }).filter((x) => x.h < 43.5 || x.w < 43.5));
    check('start screen (Advanced open): every touch target >= 44 px', targets.length === 0, JSON.stringify(targets));
    await p.evaluate(() => { document.querySelector('#start .panel-inner').scrollTop = 0; });
    await p.screenshot({ path: shot('advanced') });
    await p.evaluate(() => { const t = document.getElementById('adv-touch'); t.scrollIntoView({ block: 'center' }); });
    await sleep(200);
    await p.screenshot({ path: shot('advanced-touch') });
    await T.tapEl(p, '#ctlsw [data-val="finger"]'); await T.tapEl(p, '#senssw [data-val="3"]'); await T.tapEl(p, '#leftysw button'); await T.tapEl(p, '#hapticssw button'); await T.tapEl(p, '#savesw button');
    const st = await p.evaluate(() => ({ c: localStorage.getItem('bedre.ctl'), s: localStorage.getItem('bedre.sens'), l: localStorage.getItem('bedre.lefty'), h: localStorage.getItem('bedre.haptics'), b: localStorage.getItem('bedre.save30'), lefty: document.body.classList.contains('lefty') }));
    check('options are remembered (control, sensitivity, left-handed, haptics, saver)', st.c === 'finger' && st.s === '3' && st.l === '1' && st.h === '0' && st.b === '1' && st.lefty, JSON.stringify(st));
    await p.reload(); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(300);
    check('remembered options survive a reload', await p.evaluate(() => window.__mobile.prefs.control === 'finger' && window.__mobile.prefs.sens === 3 && window.__mobile.prefs.lefty && !window.__mobile.prefs.haptics && window.__mobile.prefs.save30));
    if (cfg.eng === 'webkit') {
      check('iOS Add-to-Home-Screen hint shown on Safari (not installed)', await p.isVisible('#a2hs'));
      await p.evaluate(() => { document.querySelector('#start .panel-inner').scrollTop = 0; });
      await p.screenshot({ path: shot('a2hs') });
      await T.tapEl(p, '#a2hs button'); await p.reload(); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(300);
      check('A2HS hint stays dismissed after reload (no nagging)', !(await p.isVisible('#a2hs')));
    } else check('A2HS hint is iOS-only (absent on Android)', !(await p.isVisible('#a2hs')));
    // Android fullscreen on Play
    await p.evaluate(() => { localStorage.setItem('bedre.mode', 'quick'); });
    await p.close(); await p.__ctx.close();

    const p2 = await newPage(cfg, { errs, storage: { 'bedre.mode': 'classic' } });
    await load(p2);
    const b = await p2.evaluate(() => ({ play: document.getElementById('play').textContent, mode: window.__modes.state.id }));
    check('a stored mode choice wins over the phone default (Classic stays Classic)', b.mode === 'classic' && b.play === 'Spēlēt', JSON.stringify(b));
    await p2.close(); await p2.__ctx.close();
    const p3 = await newPage(cfg, { errs });
    await load(p3, 'mode=classic');
    check('?mode= beats the phone default', await p3.evaluate(() => window.__modes.state.id === 'classic'));
    await p3.close(); await p3.__ctx.close();
  }

  // ---------------- loading screen: one real progress bar over all the map files (Chromium: throttled network) ----------------------
  if (want('first') && cfg.eng === 'chromium') {
    const lp = await newPage(cfg, { errs });
    await lp.addInitScript(() => { window.__lm = []; setInterval(() => { const e = document.getElementById('load-msg'); if (e) { const m = /(\d+)%/.exec(e.textContent); if (m) window.__lm.push(+m[1]); } }, 25); });
    await lp.__cdp.send('Network.enable');
    await lp.__cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: (12 * 1e6) / 8, uploadThroughput: (3 * 1e6) / 8 });
    await load(lp);
    const lm = await lp.evaluate(() => window.__lm);
    const uniq = [...new Set(lm)];
    check(`loading screen shows real, monotonic progress over the whole map download (${uniq.length} steps, max ${Math.max(0, ...lm)} %)`, uniq.length >= 6 && lm.every((v, i) => i === 0 || v >= lm[i - 1] - 0) && Math.max(...lm) >= 90, JSON.stringify(uniq.slice(0, 30)));
    await lp.close(); await lp.__ctx.close();
  }

  // ---------------- main portrait page ------------------------------------------------------------------------------------------------
  const page = await newPage(cfg, { errs });
  await load(page);
  if (cfg.android) {
    await T.tapEl(page, '#play'); await sleep(600);
    check('Android: Play requests fullscreen (Fullscreen API) when not installed', (await page.evaluate(() => window.__fs)) >= 1);
  } else {
    await T.tapEl(page, '#play'); await sleep(600);
    check('iOS: no Fullscreen API call (not supported, hint instead)', (await page.evaluate(() => window.__fs)) === 0);
  }
  await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase), null, { timeout: 15000 });
  await page.evaluate(() => window.__game.skipIntro());
  await sleep(2600);
  const V = await vp(page);

  // ---------------- layout: free zones, HUD share, touch targets --------------------------------------------------------------------------
  if (want('layout')) {
    const rs = await rects(page, HUD_SEL);
    const zoneL = { x: 0, y: V.h - 96, w: 96, h: 96 }, zoneR = { x: V.w - 96, y: V.h - 96, w: 96, h: 96 };
    const inZone = rs.filter((r) => hits(r, zoneL) || hits(r, zoneR)).map((r) => r.s);
    check('bottom corners (96 x 96 px) are free of HUD (joystick zones)', inZone.length === 0, inZone.join(','));
    const share = unionShare(rs, V.w, V.h);
    check(`HUD covers <= 20 % of the portrait viewport (${V.w}x${V.h})`, share <= 0.2, (share * 100).toFixed(1) + '%');
    console.log(`      info: HUD-free ${(100 - share * 100).toFixed(1)} % at ${V.w}x${V.h}`);
    const small = rs.filter((r) => /button|chip|minimap/.test(r.s) && (r.w < 43.5 || r.h < 43.5)).map((r) => `${r.s} ${Math.round(r.w)}x${Math.round(r.h)}`);
    check('gameplay touch targets (buttons, chips) >= 44 px', small.length === 0, small.join(' | '));
    check('timer always visible', rs.some((r) => r.s === '#card-time'));
    { const o = await oversized(page); check('no painted overlay covers > 25 % of the viewport during solo play', o.length === 0, o.join(', ')); }
    const ov = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hits(rs[i], rs[j])) ov.push(`${rs[i].s}+${rs[j].s}`);
    check('HUD pieces do not overlap each other', ov.length === 0, ov.join(','));
    // lanes: force a kill-feed line, a landmark label, an area banner and a toast, then check they stay clear of the corners and the hole
    await page.evaluate(() => {
      const g = window.__life.game;
      g.hud.feedItem([Object.assign(document.createElement('span'), { textContent: 'Anna gleich Bruno +120' })], '#d9552f');
      g.hud.label('Brīvības piemineklis', true);
      const b = document.getElementById('meta-area'); b.querySelector('.an').textContent = 'Centrs'; b.classList.add('show');
      window.__metaToast && window.__metaToast('★', 'Sasniegums atbloķēts: Pirmais ēdiens', { ms: 4000 });
    });
    await sleep(350);
    const lanes = await rects(page, LANE_SEL), hs = await holeScreen(page);
    const hr = await page.evaluate(() => { const g = window.__life.game; const a = g._v.set(g.player.x, 0, g.player.z).project(g.cam.camera), b = g._v.set(g.player.x + g.player.radius, 0, g.player.z).project(g.cam.camera); return Math.abs((b.x - a.x) * 0.5 * innerWidth); });
    const bad = lanes.filter((r) => hits(r, zoneL) || hits(r, zoneR) || (hs.x > r.x - hr && hs.x < r.x + r.w + hr && hs.y > r.y - hr && hs.y < r.y + r.h + hr)).map((r) => r.s);
    check(`transient lines (feed, label, banner, toast: ${lanes.length}) never overlap the thumb corners or the hole`, lanes.length >= 3 && bad.length === 0, `${lanes.map((r) => r.s).join(',')} bad=${bad.join(',')}`);
    const all = [...rs, ...lanes], ov2 = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (hits(all[i], all[j]) && !(all[i].s === '#attrib' || all[j].s === '#attrib')) ov2.push(`${all[i].s}+${all[j].s}`);
    check('transient lines do not overlap the HUD', ov2.length === 0, ov2.join(','));
    await sleep(2800);
    // left-handed layout mirrors the button column
    await page.evaluate(() => window.__mobile.prefs.set('lefty', true));
    await sleep(200);
    const lr = await rects(page, ['#hud-btns > button', '#minimap-box']);
    check('left-handed: round buttons move to the left edge, minimap to the right', lr.filter((r) => r.s.includes('button')).every((r) => r.x + r.w / 2 < V.w / 2) && lr.filter((r) => r.s === '#minimap-box').every((r) => r.x + r.w / 2 > V.w / 2), JSON.stringify(lr.map((r) => [r.s, Math.round(r.x)])));
    const lz = (await rects(page, HUD_SEL)).filter((r) => hits(r, zoneL) || hits(r, zoneR));
    check('left-handed: corners still free', lz.length === 0);
    await page.evaluate(() => window.__mobile.prefs.set('lefty', false));
  }

  // ---------------- camera -------------------------------------------------------------------------------------------------------------
  if (want('camera')) {
    await page.evaluate(() => window.__game.zoomBy(1)); // keep defaults
    await sleep(1500);
    const hs = await holeScreen(page);
    check(`portrait: hole sits 55-68 % down the screen (${(100 * hs.y / V.h).toFixed(0)} %)`, hs.y / V.h > 0.55 && hs.y / V.h < 0.68, hs.y / V.h);
    check('portrait: hole horizontally centred', near(hs.x, V.w / 2, 6));
    const z0 = await page.evaluate(() => window.__game.cam.zoom);
    await T.tap(page, V.w / 2, V.h * 0.3); await T.tap(page, V.w / 2, V.h * 0.3); await sleep(900);
    const z1 = await page.evaluate(() => window.__game.cam.zoom);
    await T.tap(page, V.w / 2, V.h * 0.3); await T.tap(page, V.w / 2, V.h * 0.3); await sleep(900);
    const z2 = await page.evaluate(() => window.__game.cam.zoom);
    check('double-tap toggles normal -> wide -> normal view', z0 === 1 && z1 > 1.5 && near(z2, 1, 0.01), `${z0} ${z1} ${z2}`);
    // pinch limits at three hole sizes
    const lim = [];
    for (const r of [2.2, 9, 40]) {
      await page.evaluate((r) => { window.__game.setRadius(r); window.__game.zoomBy(1000); }, r); await sleep(1800);
      const a = await page.evaluate(() => ({ z: window.__game.cam.zoom, d: window.__game.cam.dist }));
      await page.evaluate(() => window.__game.zoomBy(0.0001)); await sleep(1800);
      const b = await page.evaluate(() => ({ z: window.__game.cam.zoom, d: window.__game.cam.dist }));
      lim.push([r, a.z, b.z, Math.round(a.d), Math.round(b.d)]);
      if (!(a.z <= 2.6001 && b.z >= 0.5999 && b.d < a.d && b.d > r * 3)) lim.push('BAD');
    }
    check('zoom limits hold (0.6..2.6) and the view stays sensible at small / medium / large holes', !lim.includes('BAD'), JSON.stringify(lim));
    await page.evaluate(() => { window.__game.setRadius(2.2); window.__game.zoomBy(0); });
    await page.evaluate(() => { try { sessionStorage.removeItem('bedre.zoom'); } catch {} });
    // zoom was clamped to the minimum by the loop above: reset through the double-tap logic
    await page.evaluate(() => { const g = window.__life.game; g.cam.zoom = 1; });
    await sleep(1600);
  }

  // ---------------- steering --------------------------------------------------------------------------------------------------------------
  if (want('steer')) {
    await page.evaluate(() => { window.__mobile.prefs.set('control', 'stick'); window.__mobile.prefs.set('sens', 2); window.__life.game.cam.zoom = 1; });
    const R = await page.evaluate(() => window.__life.game.input.radius);
    const cx = V.w / 2, cy = V.h * 0.55;
    const bad = [], seen = [];
    for (let k = 0; k < 8; k++) {
      const th = k * Math.PI / 4;
      await page.evaluate(() => { const p = window.__life.game.player; window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); p.vx = p.vz = 0; });
      await sleep(150);
      const h0 = await hole(page);
      await T.down(page, 1, cx, cy);
      await T.drag(page, 1, [cx, cy], [cx + Math.cos(th) * 80, cy + Math.sin(th) * 80]);
      await sleep(900);
      if (k === 2) { check('joystick base is visible under the thumb while steering', await page.evaluate(() => getComputedStyle(document.getElementById('joystick')).display === 'block')); }
      const h1 = await hole(page);
      await T.up(page, 1);
      await sleep(900);
      const dx = h1.x - h0.x, dz = h1.z - h0.z, got = Math.atan2(dz, dx);
      seen.push([k * 45, Math.round(deg(got)), Math.round(Math.hypot(dx, dz))]);
      if (angDiff(got, th) > 0.35 || Math.hypot(dx, dz) < 2) bad.push([k * 45, Math.round(deg(got)), Math.round(Math.hypot(dx, dz))]);
    }
    check('joystick steers in all 8 directions (heading within 20 deg of the thumb)', bad.length === 0, JSON.stringify(bad) + ' seen ' + JSON.stringify(seen));
    check('joystick base hides on release', await page.evaluate(() => getComputedStyle(document.getElementById('joystick')).display === 'none'));
    // analogue speed
    const spd = [];
    for (const px of [24, 44, 90]) {
      await page.evaluate(() => { const p = window.__life.game.player; window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); p.vx = p.vz = 0; });
      await sleep(150);
      await T.down(page, 1, cx, cy); await T.drag(page, 1, [cx, cy], [cx + px, cy], 3);
      await sleep(600); const a = await hole(page); await sleep(700); const b = await hole(page);
      await T.up(page, 1); await sleep(600);
      spd.push(Math.hypot(b.x - a.x, b.z - a.z) / ((b.t - a.t) / 1000));
    }
    const DEAD = 7, m = (px) => Math.min(1, Math.max(0, (px - DEAD) / (R - DEAD)));
    const e1 = m(24) / m(90), e2 = m(44) / m(90), g1 = spd[0] / spd[2], g2 = spd[1] / spd[2];
    check('analogue speed follows thumb distance (24 / 44 / 90 px)', spd[0] < spd[1] && spd[1] < spd[2] && near(g1, e1, 0.18) && near(g2, e2, 0.18), `speeds ${spd.map((s) => s.toFixed(1))} ratios ${g1.toFixed(2)}/${g2.toFixed(2)} expected ${e1.toFixed(2)}/${e2.toFixed(2)} R=${R}`);
    // dead zone + momentum
    await page.evaluate(() => { window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); const p = window.__life.game.player; p.vx = p.vz = 0; });
    await sleep(200);
    const d0 = await hole(page);
    await T.down(page, 1, cx, cy); await T.drag(page, 1, [cx, cy], [cx + 4, cy + 3], 2); await sleep(700);
    const d1 = await hole(page); await T.up(page, 1); await sleep(300);
    check('inside the dead zone (5 px) the hole does not move', Math.hypot(d1.x - d0.x, d1.z - d0.z) < 0.3, Math.hypot(d1.x - d0.x, d1.z - d0.z));
    await T.down(page, 1, cx, cy); await T.drag(page, 1, [cx, cy], [cx + 90, cy], 3); await sleep(900);
    const m0 = await hole(page); await T.up(page, 1); await sleep(120); const m1 = await hole(page); await sleep(900); const m2 = await hole(page);
    const coast = Math.hypot(m2.x - m0.x, m2.z - m0.z), after = Math.hypot(m2.x - m1.x, m2.z - m1.z);
    check('release: the hole keeps a little momentum, then stops', coast > 0.15 && Math.hypot(m2.x - m1.x, m2.z - m1.z) < coast, `coast ${coast.toFixed(2)} after-first-120ms ${after.toFixed(2)}`);
    await sleep(300); const m3 = await hole(page); await sleep(500); const m4 = await hole(page);
    check('...and is at rest afterwards', Math.hypot(m4.x - m3.x, m4.z - m3.z) < 0.1);
    // thumb beyond the radius: the base follows
    await T.down(page, 1, cx, cy); await T.drag(page, 1, [cx, cy], [cx + 260, cy], 8);
    const org = await page.evaluate(() => { const t = window.__life.game.input.touch; return t && { ox: t.ox, x: t.x }; });
    check('thumb travelling past the max radius drags the joystick base along', org && org.x - org.ox <= R + 1 && org.ox > cx + 100, JSON.stringify(org));
    await T.up(page, 1); await sleep(900);
    // finger-follow option
    await page.evaluate(() => window.__mobile.prefs.set('control', 'finger'));
    await page.evaluate(() => { window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); window.__life.game.player.vx = window.__life.game.player.vz = 0; });
    await sleep(900);
    const hs = await holeScreen(page), f0 = await hole(page);
    await T.down(page, 1, hs.x + 110, hs.y - 20); await sleep(900);
    check('finger-follow option: no joystick graphic', await page.evaluate(() => getComputedStyle(document.getElementById('joystick')).display === 'none'));
    const f1 = await hole(page); await T.up(page, 1);
    const fh = Math.atan2(f1.z - f0.z, f1.x - f0.x);
    check('finger-follow option: the hole heads for the finger', f1.x - f0.x > 3 && Math.abs(deg(fh)) < 30, `${(f1.x - f0.x).toFixed(1)}, ${(f1.z - f0.z).toFixed(1)}`);
    await page.evaluate(() => window.__mobile.prefs.set('control', 'stick'));
    await sleep(900);

    // pinch while steering
    for (const mode of ['static-thumb', 'moving-thumb']) {
      await page.evaluate(() => { window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); window.__life.game.player.vx = window.__life.game.player.vz = 0; window.__life.game.cam.zoom = 1; });
      await sleep(900);
      const px = cx - 40, py = V.h * 0.75;
      await T.down(page, 1, px, py); await T.drag(page, 1, [px, py], [px + 64, py], 3);
      await sleep(700);
      // heading / speed are read from the hole's own velocity (game time), not from displacement over wall-clock time: under CPU load frames are
      // dropped and dt is clamped, which made the wall-clock figures wobble (an unrelated flake) while the steering itself was unchanged
      const vel = () => page.evaluate(() => { const p = window.__life.game.player; return { vx: p.vx, vz: p.vz }; });
      await sleep(500); const w0 = await vel();
      const v0 = Math.hypot(w0.vx, w0.vz), a0 = Math.atan2(w0.vz, w0.vx);
      const z0 = await page.evaluate(() => window.__life.game.cam.zoom);
      // second finger lands 150 px above and pinches towards the first
      await T.down(page, 2, px + 64, py - 160);
      for (let i = 1; i <= 10; i++) {
        await T.move(page, 2, px + 64, py - 160 + i * 9);
        if (mode === 'moving-thumb') await T.move(page, 1, px + 64, py - i * 4);   // true two-finger pinch: the steering finger moves too
        await sleep(30);
      }
      const z1 = await page.evaluate(() => window.__life.game.cam.zoom);
      await sleep(500); const w1 = await vel();
      const v1 = Math.hypot(w1.vx, w1.vz), a1 = Math.atan2(w1.vz, w1.vx);
      await T.up(page, 2); await T.up(page, 1); await sleep(700);
      check(`pinch (${mode}): zoom changes (${z0.toFixed(2)} -> ${z1.toFixed(2)})`, z1 > z0 * 1.1, `${z0} ${z1}`);
      check(`pinch (${mode}): no steering jump (heading ${deg(a0).toFixed(0)} -> ${deg(a1).toFixed(0)}, speed ${v0.toFixed(1)} -> ${v1.toFixed(1)})`, angDiff(a0, a1) < 0.35 && v1 < v0 * 1.5 + 1 && v1 > v0 * 0.4, `v ${v0.toFixed(2)} ${v1.toFixed(2)}`);
    }
    await page.evaluate(() => { window.__life.game.cam.zoom = 1; });

    // HUD taps do not steer; steering does not press HUD
    await sleep(900);
    const hA = await hole(page);
    await T.tapEl(page, '#board-chip'); await sleep(500);
    const hB = await hole(page);
    check('tapping a HUD chip does not steer the hole', Math.hypot(hB.x - hA.x, hB.z - hA.z) < 0.4 && await page.evaluate(() => window.__life.game.input.touch === null));
    await T.tapEl(page, '#board-chip'); await sleep(200);
    const pb = await page.locator('#pause-btn').boundingBox(), pcx = pb.x + pb.width / 2, pcy = pb.y + pb.height / 2;
    await T.down(page, 1, V.w / 2, V.h * 0.5); await T.drag(page, 1, [V.w / 2, V.h * 0.5], [pcx, pcy], 8);
    await sleep(100); await T.up(page, 1); await sleep(400);
    check('a drag that starts on the play area and ends on the Pause button does not pause', !(await page.evaluate(() => window.__game.paused)));
    const mb = await page.locator('#minimap-box').boundingBox();
    await T.down(page, 1, V.w / 2, V.h * 0.5); await T.drag(page, 1, [V.w / 2, V.h * 0.5], [mb.x + mb.width / 2, mb.y + mb.height / 2], 8); await T.up(page, 1); await sleep(300);
    check('...nor expand the minimap chip', !(await page.evaluate(() => document.getElementById('minimap-box').classList.contains('open'))));
  }

  // ---------------- chips -------------------------------------------------------------------------------------------------------------------
  if (want('chips')) {
    await page.evaluate(() => { window.__life.game.cam.zoom = 1; });
    await sleep(1200);
    const chipTxt = await page.textContent('#board-chip');
    check(`leaderboard chip shows rank, points and the gap ("${chipTxt}")`, /^\S+\s*·?\s*[\d\s ,.k]+\s*·?\s*[−+]\d/.test(chipTxt.replace(/\s+/g, ' ').trim()) || /[−+]\d/.test(chipTxt), chipTxt);
    check('list is collapsed by default', !(await page.isVisible('#board-list')));
    await T.tapEl(page, '#board-chip'); await sleep(300);
    const open1 = await page.evaluate(() => ({ open: document.getElementById('board').classList.contains('open'), rows: [...document.querySelectorAll('#board-list li')].filter((l) => l.offsetParent !== null).length, exp: document.getElementById('board-chip').getAttribute('aria-expanded') }));
    check('tap expands the leaderboard (top 3 + you)', open1.open && open1.rows >= 3 && open1.exp === 'true', JSON.stringify(open1));
    await page.screenshot({ path: shot('leaderboard-open') });
    await sleep(5400);
    check('leaderboard auto-collapses after a few seconds', !(await page.evaluate(() => document.getElementById('board').classList.contains('open'))));
    await T.tapEl(page, '#board-chip'); await sleep(200); await T.tap(page, V.w / 2, V.h * 0.5); await sleep(300);
    check('tap outside collapses the leaderboard', !(await page.evaluate(() => document.getElementById('board').classList.contains('open'))));
    const mm0 = await page.locator('#minimap-box').boundingBox();
    check('minimap is a small round chip', mm0.width <= 60 && near(mm0.width, mm0.height, 2) && await page.evaluate(() => getComputedStyle(document.getElementById('minimap-box')).borderRadius.startsWith('50')), `${mm0.width}x${mm0.height}`);
    await T.tapEl(page, '#minimap-box'); await sleep(500);
    const mm1 = await page.locator('#minimap-box').boundingBox();
    check('tap expands the minimap', mm1.width > 110 && mm1.x >= 0 && mm1.x + mm1.width <= V.w, `${mm1.width}`);
    await page.screenshot({ path: shot('minimap-open') });
    await T.tapEl(page, '#minimap-box'); await sleep(300);
    check('tap again shrinks it', (await page.locator('#minimap-box').boundingBox()).width <= 60);
    await T.tapEl(page, '#minimap-box'); await sleep(300); await T.tap(page, V.w / 2, V.h * 0.6); await sleep(300);
    check('tap outside shrinks it', (await page.locator('#minimap-box').boundingBox()).width <= 60);
  }

  // ---------------- gameplay screenshots at three hole sizes (joystick visible) -----------------------------------------------------------
  if (want('layout')) {
    const clipped = [];
    for (const [nm, r] of [['small', 2.2], ['medium', 8], ['large', 28]]) {
      await page.evaluate((r) => { window.__game.setRadius(r); window.__life.game.cam.zoom = 1; }, r);
      await T.down(page, 1, V.w * 0.78, V.h * 0.86); await T.drag(page, 1, [V.w * 0.78, V.h * 0.86], [V.w * 0.78 + 30, V.h * 0.86 - 40], 4);
      await sleep(1800);
      await page.screenshot({ path: shot(`play-${nm}`) });
      clipped.push(await page.evaluate(() => { const c = document.getElementById('board-chip'); return c.scrollWidth > c.clientWidth + 1 ? c.textContent : null; }));
      await T.up(page, 1); await sleep(600);
    }
    check('leaderboard chip text is never clipped (it abbreviates instead)', clipped.every((c) => !c), JSON.stringify(clipped));
    await page.evaluate(() => { window.__game.setRadius(2.2); });
  }

  // ---------------- haptics -----------------------------------------------------------------------------------------------------------------
  if (want('haptics')) {
    await page.evaluate(() => { window.__vib.length = 0; window.__mobile.prefs.set('haptics', true); });
    const sup = await page.evaluate(() => typeof navigator.vibrate);
    await page.evaluate(() => { const g = window.__life.game, b = window.__life.bus; const big = { isBuilding: true, cls: 'building', fit: 30, value: 80 }, small = { fit: 0.5, value: 1, cls: 'person' };
      b.emit('swallow', small, g.player); b.emit('swallow', small, g.player); b.emit('swallow', big, g.player);
      b.emit('holeEaten', { eater: g.player, victim: g.bots.holes[0], gain: 10 }); b.emit('playerEaten', { eater: g.bots.holes[0], victim: g.player }); b.emit('levelUp', { hole: g.player, level: 2 }); });
    const calls = await page.evaluate(() => window.__vib.slice());
    const nums = calls.filter((c) => typeof c === 'number'), pats = calls.filter((c) => Array.isArray(c));
    if (cfg.android) {
      check('Android: vibration on swallow (tick rate-limited, building stronger), hole eaten / got eaten / level-up patterns', nums.length === 2 && nums[1] > nums[0] && pats.length === 3 && pats[0].length !== pats[1].length, JSON.stringify(calls));
      await page.evaluate(() => { window.__vib.length = 0; window.__mobile.prefs.set('haptics', false); window.__life.bus.emit('playerEaten', {}); });
      check('Android: haptics off -> no vibration', (await page.evaluate(() => window.__vib.length)) === 0);
      await page.evaluate(() => window.__mobile.prefs.set('haptics', true));
      await sleep(400); await page.evaluate(() => { window.__vib.length = 0; const w = window.__life.world; const o = w.objects.find((q) => q.state === 0 && q.value >= 1 && q.fit < 1.2); window.__game.teleport(o.x, o.z); window.__game.autoplay(4); });
      const rv = await page.evaluate(() => ({ n: window.__vib.length, ph: window.__game.state.phase, sc: window.__game.state.score, doc: document.hidden }));
      check('Android: real swallows trigger vibration', rv.n > 0, JSON.stringify(rv));
    } else {
      check('iOS/WebKit: navigator.vibrate is absent and nothing throws', sup === 'undefined' && calls.length === 0 && (await page.evaluate(() => window.__mobile.hapticStats.calls)) === 0, sup);
      await page.evaluate(() => { window.__life.game.cam.zoom = 1; window.__life.game._ringT = 0; window.__life.bus.emit('swallow', { fit: 3, value: 5, cls: 'person' }, window.__life.game.player); });
      await sleep(80);
      check('iOS: ring pulse on the hole rim after a swallow', await page.evaluate(() => { const r = document.getElementById('hole-ring'); return !!r && r.classList.contains('go'); }));
    }
    await sleep(500);
  }

  // ---------------- wake lock (round start -> released at the end) ---------------------------------------------------------------------------------
  if (want('wake')) {
    const w = await page.evaluate(() => ({ n: window.__wl.length, rel: window.__wl.filter((s) => s.released).length, want: window.__mobile.wake.want }));
    check('Screen Wake Lock requested during a round', w.n >= 1 && w.want && w.rel < w.n, JSON.stringify(w));
    await page.evaluate(() => window.__life.game.end()); await sleep(500);
    const w2 = await page.evaluate(() => ({ n: window.__wl.length, rel: window.__wl.filter((s) => s.released).length }));
    check('...and released when the round ends', w2.rel === w2.n && w2.n >= 1, JSON.stringify(w2));
    check('results screen on a phone: card inside the viewport, Play again reachable', await page.evaluate(() => { const c = document.querySelector('#results .panel-inner').getBoundingClientRect(), a = document.getElementById('again').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight && a.bottom <= innerHeight; }));
    await page.screenshot({ path: shot('results') });
    await T.tapEl(page, '#again'); await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await page.evaluate(() => window.__game.skipIntro()); await sleep(1500);
    check('Play again re-acquires the wake lock', (await page.evaluate(() => window.__wl.filter((s) => !s.released).length)) >= 1);
  }

  // ---------------- resume after app switch: pause + 3-2-1 -------------------------------------------------------------------------------------
  if (want('resume')) {
    await sleep(500);
    const t0 = await page.evaluate(() => window.__game.state.timeLeft);
    const setHidden = (h) => page.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    await setHidden(true); await sleep(300);
    check('app switch (page hidden) auto-pauses the round', await page.evaluate(() => window.__game.paused) && await page.isVisible('#pause'));
    await sleep(1500); await setHidden(false); await sleep(300);
    check('back in the app the pause panel waits (no surprise restart)', await page.evaluate(() => window.__game.paused) && await page.isVisible('#resume'));
    await T.tapEl(page, '#resume'); await sleep(450);
    const cnt = await page.evaluate(() => { const e = document.getElementById('resume-count'); return e && !e.hidden ? e.textContent : null; });
    check('Resume starts a 3-2-1 countdown first', cnt === '3' || cnt === '2', String(cnt));
    await page.screenshot({ path: shot('resume-countdown') });
    check('world still frozen during the countdown', await page.evaluate(() => window.__game.paused));
    await page.waitForFunction(() => !window.__game.paused, null, { timeout: 6000 });
    const t1 = await page.evaluate(() => window.__game.state.timeLeft);
    check('after 3 s the round runs again with the clock intact', Math.abs(t0 - t1) < 1.6 && (await page.evaluate(() => window.__game.state.phase)) === 'playing', `${t0} -> ${t1}`);
    const st0 = await page.evaluate(async () => { const a = window.__life.audio; if (!a.ctx) return 'noctx'; await a.ctx.suspend(); document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 700)); return a.ctx.state; });
    let st1 = st0;
    if (st0 !== 'running' && st0 !== 'noctx') { await T.tap(page, V.w / 2, V.h * 0.45); await sleep(500); st1 = await page.evaluate(() => window.__life.audio.ctx.state); }
    check(`audio comes back after an interruption (suspended -> ${st0}${st1 !== st0 ? ' -> ' + st1 + ' after the next touch' : ''})`, st1 === 'running' || st1 === 'noctx', `${st0} ${st1}`);
    check('mute state is respected after the interruption', await page.evaluate(() => { const a = window.__life.audio; return !a.ctx || a.muted || a.master.gain.value > 0; }));
  }

  // ---------------- orientation flip mid-round ------------------------------------------------------------------------------------------------
  if (want('orient')) {
    await page.evaluate(() => { window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); });
    await sleep(1500);
    const a = await page.evaluate(() => ({ s: window.__game.state, h: window.__game.hole, f: window.__game.cam.focus }));
    await page.setViewportSize({ width: V.h, height: V.w }); await sleep(250);
    const mid = await page.evaluate(() => window.__game.cam.focus);
    await sleep(2200);
    const b = await page.evaluate(() => ({ s: window.__game.state, h: window.__game.hole, f: window.__game.cam.focus, cls: document.body.className }));
    check('orientation flip: round keeps running with score, phase, hole position', b.s.phase === 'playing' && b.s.score >= a.s.score && Math.hypot(b.h.x - a.h.x, b.h.z - a.h.z) < 1.5, JSON.stringify({ a: a.s, b: b.s }));
    check('orientation flip: camera follows without a jump', Math.hypot(mid.x - a.f.x, mid.z - a.f.z) < 25 && Math.hypot(b.f.x - b.h.x, b.f.z - b.h.z) < 6, `jump ${Math.hypot(mid.x - a.f.x, mid.z - a.f.z).toFixed(1)}`);
    check('orientation flip: still the phone layout', /tui/.test(b.cls));
    const hsL = await holeScreen(page), VL = await vp(page);
    check(`landscape: hole is centred (${(100 * hsL.y / VL.h).toFixed(0)} % / ${(100 * hsL.x / VL.w).toFixed(0)} %)`, near(hsL.y / VL.h, 0.5, 0.07) && near(hsL.x, VL.w / 2, 6), `${hsL.x},${hsL.y} in ${VL.w}x${VL.h}`);
    const rs = await rects(page, HUD_SEL);
    const bad = rs.filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > VL.w + 1 || r.y + r.h > VL.h + 1).map((r) => r.s);
    const ov = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hits(rs[i], rs[j])) ov.push(`${rs[i].s}+${rs[j].s}`);
    check('landscape: HUD inside the viewport and not overlapping', bad.length === 0 && ov.length === 0, bad.concat(ov).join(','));
    const zoneL = { x: 0, y: VL.h - 96, w: 96, h: 96 }, zoneR = { x: VL.w - 96, y: VL.h - 96, w: 96, h: 96 };
    check('landscape: bottom corners free', rs.filter((r) => hits(r, zoneL) || hits(r, zoneR)).length === 0, rs.filter((r) => hits(r, zoneL) || hits(r, zoneR)).map((r) => r.s).join(','));
    check('landscape: HUD covers <= 25 % of the screen', unionShare(rs, VL.w, VL.h) <= 0.25, (unionShare(rs, VL.w, VL.h) * 100).toFixed(1));
    await page.screenshot({ path: shot('landscape') });
    // steer sanity in landscape
    await page.evaluate(() => { window.__game.teleport(window.__game.spawn[0], window.__game.spawn[1]); window.__life.game.player.vx = window.__life.game.player.vz = 0; }); await sleep(300);
    const l0 = await hole(page);
    await T.down(page, 1, VL.w * 0.85, VL.h * 0.7); await T.drag(page, 1, [VL.w * 0.85, VL.h * 0.7], [VL.w * 0.85 - 60, VL.h * 0.7 + 60], 4); await sleep(800);
    const l1 = await hole(page); await T.up(page, 1);
    check('landscape: joystick steers (down-left)', l1.x < l0.x - 2 && l1.z > l0.z + 2, `${l1.x - l0.x}, ${l1.z - l0.z}`);
    await page.setViewportSize({ width: V.w, height: V.h }); await sleep(1500);
    check('flip back: still playing', (await page.evaluate(() => window.__game.state.phase)) === 'playing');
    await sleep(600);
  }

  // ---------------- safe-area emulation (notch / Dynamic Island / home indicator) ---------------------------------------------------------------
  if (want('layout')) {
    for (const land of [false, true]) {
      const sp = await newPage(cfg, { errs, land });
      const ins = land ? [0, 47, 21, 47] : [47, 0, 34, 0];
      await load(sp, `inset=${ins.join(',')}&mode=quick`);
      const Vs = await vp(sp);
      const st = await sp.evaluate(() => { const r = document.querySelector('#start .panel-inner').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
      check(`${land ? 'landscape' : 'portrait'} notch emulation: start card inside the safe area`, st.top >= ins[0] - 0.5 && st.bottom <= Vs.h - ins[2] + 0.5 && st.left >= ins[3] - 0.5 && st.right <= Vs.w - ins[1] + 0.5, JSON.stringify(st));
      await T.tapEl(sp, '#play'); await sp.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await sp.evaluate(() => window.__game.skipIntro()); await sleep(2600);
      await sp.evaluate(() => { const g = window.__life.game; g.hud.feedItem([Object.assign(document.createElement('span'), { textContent: 'Anna gleich Bruno +120' })], '#d9552f'); g.hud.label('Brīvības piemineklis', true); });
      await sleep(300);
      const rs = await rects(sp, [...HUD_SEL, ...LANE_SEL.slice(0, 3)]);
      const bad = rs.filter((r) => r.y < ins[0] - 0.5 || r.y + r.h > Vs.h - ins[2] + 0.5 || r.x < ins[3] - 0.5 || r.x + r.w > Vs.w - ins[1] + 0.5).map((r) => `${r.s}@${Math.round(r.x)},${Math.round(r.y)}`);
      check(`${land ? 'landscape' : 'portrait'} notch emulation: nothing under the insets (${ins.join('/')}), ${rs.length} boxes`, bad.length === 0, bad.join(' '));
      await sp.screenshot({ path: shot(land ? 'notch-landscape' : 'notch-portrait') });
      await sp.evaluate(() => window.__life.game.end()); await sleep(600);
      const rr = await sp.evaluate(() => { const r = document.querySelector('#results .panel-inner').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      check(`${land ? 'landscape' : 'portrait'} notch emulation: results card inside the safe area`, rr.top >= ins[0] - 0.5 && rr.bottom <= Vs.h - ins[2] + 0.5, JSON.stringify(rr));
      await sp.close(); await sp.__ctx.close();
    }
  }

  await page.close(); await page.__ctx.close();

  // ---------------- real landscape profile (device viewport) -----------------------------------------------------------------------------------
  if (want('layout')) {
    const lp = await newPage(cfg, { errs, land: true });
    await load(lp, 'mode=quick');
    const pb = await lp.locator('#play').boundingBox(), VL0 = await vp(lp);
    check(`device landscape ${VL0.w}x${VL0.h}: Play is visible on the start screen without scrolling`, pb.y >= 0 && pb.y + pb.height <= VL0.h, JSON.stringify(pb));
    await lp.screenshot({ path: shot('start-landscape') });
    await T.tapEl(lp, '#play'); await lp.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await lp.evaluate(() => window.__game.skipIntro()); await sleep(2600);
    const VL = await vp(lp), rs = await rects(lp, HUD_SEL);
    const small = rs.filter((r) => /button|chip|minimap/.test(r.s) && (r.w < 43.5 || r.h < 43.5)).map((r) => r.s);
    const zl = { x: 0, y: VL.h - 96, w: 96, h: 96 }, zr = { x: VL.w - 96, y: VL.h - 96, w: 96, h: 96 };
    check(`device landscape ${VL.w}x${VL.h}: corners free, targets >= 44 px`, small.length === 0 && rs.filter((r) => hits(r, zl) || hits(r, zr)).length === 0, small.join(','));
    const hs = await holeScreen(lp);
    check('device landscape: hole centred', near(hs.y / VL.h, 0.5, 0.07), String(hs.y / VL.h));
    await lp.screenshot({ path: shot('landscape-device') });
    await lp.close(); await lp.__ctx.close();
  }

  // ---------------- 360 x 640 reference viewport ----------------------------------------------------------------------------------------------
  if (want('layout')) {
    const rp = await newPage(cfg, { errs, size: [360, 640] });
    await load(rp, 'mode=quick');
    await T.tapEl(rp, '#play'); await rp.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await rp.evaluate(() => window.__game.skipIntro()); await sleep(2600);
    const rs = await rects(rp, HUD_SEL), share = unionShare(rs, 360, 640);
    check(`360x640: HUD-free area >= 80 % (${(100 - share * 100).toFixed(1)} %)`, share <= 0.2);
    const hs = await holeScreen(rp);
    check(`360x640: hole at ${(100 * hs.y / 640).toFixed(0)} % height`, hs.y / 640 > 0.55 && hs.y / 640 < 0.68);
    await rp.screenshot({ path: shot('play-360x640') });
    await rp.close(); await rp.__ctx.close();
  }

  // ---------------- Turnstile widget failure ---------------------------------------------------------------------------------------------------
  if (want('turnstile')) {
    const tp = await newPage(cfg, { errs });
    const posts = [];
    await tp.route('**/api/rounds', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ roundId: 'rnd1', roundSeconds: 5, mode: 'quick', map: 'centrs', seed: 1, turnstileSiteKey: '1x00000000000000000000AA' }) }));
    await tp.route('**/api/scores', async (r) => { if (r.request().method() === 'POST') { posts.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 7, name: 'Tu', mode: 'quick', map: 'centrs', rankAllTime: 12, rankToday: 3 }) }); } return r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' }); });
    let stub = 'blocked';
    const STUBS = {
      ok: "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('tok-ok')},30);return 'w1'},remove:function(){}};",
      err: "window.turnstile={render:function(el,o){setTimeout(function(){o['error-callback']()},30);return 'w2'},remove:function(){throw new Error('[Cloudflare Turnstile] Nothing to reset found for provided container.')}};",
    };
    await tp.route('https://challenges.cloudflare.com/**', (r) => (stub === 'blocked' ? r.abort() : r.fulfill({ status: 200, contentType: 'application/javascript', body: STUBS[stub] })));
    await load(tp);
    await T.tapEl(tp, '#play'); await tp.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await tp.evaluate(() => window.__game.skipIntro());
    await tp.waitForFunction(() => window.__game.state.phase === 'ended', null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const score = await tp.textContent('#r-score');
    check('widget fails to load: results show a retry ("Neizdevās pārbaudīt — mēģināt vēlreiz")', await tp.isVisible('#ts-retry') && /Neizdevās pārbaudīt/.test(await tp.textContent('#ts-retry')), await tp.textContent('#turnstile-retry'));
    check('...and nothing was sent unverified', posts.length === 0);
    await tp.screenshot({ path: shot('turnstile-retry') });
    stub = 'err'; await tp.evaluate(() => { delete window.turnstile; });
    await T.tapEl(tp, '#ts-retry'); await sleep(1800);
    check('widget error callback (+ throwing remove()): retry offered again, round data intact, no page error', await tp.isVisible('#ts-retry') && (await tp.textContent('#r-score')) === score && posts.length === 0);
    stub = 'ok'; await tp.evaluate(() => { delete window.turnstile; });
    await T.tapEl(tp, '#ts-retry'); await sleep(2500);
    check('retry with a working widget saves the score (token sent, retry hidden)', posts.length === 1 && posts[0].turnstile === 'tok-ok' && posts[0].roundId === 'rnd1' && !(await tp.isVisible('#ts-retry')), JSON.stringify(posts.map((p) => [p.turnstile, p.score])));
    check('global rank line shows after the retry', /12/.test(await tp.textContent('#r-global')), await tp.textContent('#r-global'));
    await tp.close(); await tp.__ctx.close();
  }

  // ---------------- battery saver ---------------------------------------------------------------------------------------------------------------
  if (want('battery')) {
    const bp = await newPage(cfg, { errs, battery: 0.12 });
    await load(bp);
    check('low battery: the 30 fps saver is suggested on the start screen', await bp.isVisible('#batt-hint'));
    await T.tapEl(bp, '#batt-hint .btn-mini:not(.alt)'); await sleep(200);
    check('accepting turns the saver on (remembered)', await bp.evaluate(() => window.__mobile.prefs.save30 && localStorage.getItem('bedre.save30') === '1'));
    await T.tapEl(bp, '#play'); await bp.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await bp.evaluate(() => window.__game.skipIntro()); await sleep(1500);
    const f0 = await bp.evaluate(() => window.__perf.frames); await sleep(2000); const f1 = await bp.evaluate(() => window.__perf.frames);
    check(`30 fps cap is applied (${((f1 - f0) / 2).toFixed(0)} fps rendered)`, (f1 - f0) / 2 <= 38, String((f1 - f0) / 2));
    await bp.close(); await bp.__ctx.close();
  }

  // ---------------- a whole Quick round, real time -----------------------------------------------------------------------------------------------
  if (want('round') && !has('--skip-round')) {
    const rpg = await newPage(cfg, { errs });
    await load(rpg, 'mode=quick');
    const boot = await rpg.evaluate(() => window.__boot);
    await T.tapEl(rpg, '#play'); await rpg.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await rpg.evaluate(() => window.__game.skipIntro());
    await driveRound(rpg, 135000);
    const r = await rpg.evaluate(() => ({ phase: window.__game.state.phase, score: window.__game.state.score, shown: document.getElementById('results') && !document.getElementById('results').classList.contains('hidden'), boot: window.__boot, ps: window.__pageshows }));
    check(`full Quick round completes (score ${Math.round(r.score)}), results shown`, r.phase === 'ended' && r.shown && r.score > 0, JSON.stringify(r));
    check('page never reloaded or crashed during the round', r.boot === boot && rpg.__nav === 1 && rpg.__crash === 0 && r.ps <= 1, `nav=${rpg.__nav} crash=${rpg.__crash} pageshow=${r.ps}`);
    await rpg.close(); await rpg.__ctx.close();
  }

  check(`no console / page errors (${errs.length})`, errs.length === 0, errs.slice(0, 4).join(' || '));
}

/** Real-time round driven like a greedy player (target the best nearby swallowable thing); runs until the round ends. */
async function driveRound(page, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const done = await page.evaluate(() => {
      const g = window.__life.game, p = g.player;
      if (g.phase !== 'playing') return g.phase === 'ended';
      g.autopilot = true;
      let best = null, bs = -1;
      g.world.query(p.x, p.z, Math.max(25, p.radius * 9), (o, d) => { if (o.state !== 0 || o.fit >= p.radius * 0.95) return; const s = o.value / (d + p.radius * 1.5 + 4); if (s > bs) { bs = s; best = o; } });
      p.control = best ? { mode: 'target', x: best.x, z: best.z } : { mode: 'target', x: p.x + (Math.random() - 0.5) * 200, z: p.z + (Math.random() - 0.5) * 200 };
      return false;
    });
    if (done) break;
    await sleep(250);
  }
  await sleep(1200);
}

// ---- ONLINE: local wrangler dev + the built game, one human + server bots ------------------------------------------------------------------
const MP_PORT = +(process.env.MOBILE_MP_PORT || 8795);
let wrangler = null;
async function startWrangler() {
  const state = path.join(root, 'scripts', '.mp-state-mobile'), cfgPath = path.join(root, 'scripts', '.wrangler-mobile.jsonc'), bundle = path.join(root, 'scripts', '.mp-worker-mobile');
  fs.rmSync(state, { recursive: true, force: true }); fs.rmSync(bundle, { recursive: true, force: true });
  const baseCfg = {
    name: 'bedre-mobile-test', compatibility_date: '2026-11-01',
    assets: { directory: './.dist-mobile', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
    d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
    durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
    migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
  };
  const sh = (args) => { const r = spawnSync('npx', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }); if (r.status) throw new Error(args.join(' ') + '\n' + r.stdout + r.stderr); };
  fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
  sh(['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundle]);
  fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: './.mp-worker-mobile/index.js' }));
  sh(['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state]);
  wrangler = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(MP_PORT), '--persist-to', state, '--var', 'MP_ROUND_SECONDS:90', '--var', 'MP_LOBBY_SECONDS:5', '--var', 'MP_RESULTS_SECONDS:20'], { cwd: root, stdio: 'pipe', detached: true });
  process.on('exit', () => { try { process.kill(-wrangler.pid, 'SIGKILL'); } catch {} });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${MP_PORT}/api/mp/status`)).ok) return; } catch {} await sleep(500); }
  throw new Error('wrangler dev not ready');
}
async function onlineSuite(cfg) {
  cur = cfg.name + '/online';
  const errs = [], shot = SHOT(cfg);
  console.log(`\n== ${cfg.name} ONLINE (${cfg.eng})`);
  const page = await newPage(cfg, { errs, mock: false, origin: `http://localhost:${MP_PORT}`, storage: { 'bedre.mode': 'quick' } });
  await load(page);
  await T.tapEl(page, '#play-online');
  await page.waitForFunction(() => window.__online && window.__online.state === 'lobby', null, { timeout: 20000 });
  await sleep(600);
  const V = await vp(page);
  const lob = await page.evaluate(() => { const r = document.querySelector('#mp-lobby .panel-inner').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
  check('online lobby panel fits the viewport', lob.top >= 0 && lob.bottom <= V.h && lob.left >= 0 && lob.right <= V.w, JSON.stringify(lob));
  { const o = await oversized(page, ['mp-lobby']); check('lobby: only the lobby panel is a big overlay', o.length === 0, o.join(', ')); }
  await page.screenshot({ path: shot('online-lobby') });
  await page.waitForFunction(() => window.__online.state === 'playing', null, { timeout: 40000 });
  await sleep(3000);
  const net = async () => page.evaluate(() => { const e = document.getElementById('mp-net'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { vis: cs.display !== 'none', w: r.width, h: r.height, x: r.left, y: r.top, text: e.textContent, cls: e.className }; });
  let n = await net();
  check(`#mp-net is a small pill (${Math.round(n.w)}x${Math.round(n.h)}, "${n.text}")`, n.vis && n.w <= 140 && n.h <= 40 && n.w > 10, JSON.stringify(n));
  const rs = await rects(page, HUD_SEL);
  check('online HUD inside the viewport', rs.every((r) => r.x >= -1 && r.y >= -1 && r.x + r.w <= V.w + 1 && r.y + r.h <= V.h + 1), JSON.stringify(rs.filter((r) => r.x < -1 || r.x + r.w > V.w + 1)));
  const ov = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hits(rs[i], rs[j])) ov.push(`${rs[i].s}+${rs[j].s}`);
  check('online: no HUD element overlaps another (incl. #mp-net)', ov.length === 0, ov.join(','));
  const zl = { x: 0, y: V.h - 96, w: 96, h: 96 }, zr = { x: V.w - 96, y: V.h - 96, w: 96, h: 96 };
  check('online: thumb corners free', rs.filter((r) => hits(r, zl) || hits(r, zr)).length === 0);
  const hs = await holeScreen(page);
  check('online: nothing covers the hole', rs.every((r) => !(hs.x > r.x - 20 && hs.x < r.x + r.w + 20 && hs.y > r.y - 20 && hs.y < r.y + r.h + 20)), JSON.stringify(hs));
  { const o = await oversized(page); check('online: no painted overlay covers > 25 % of the viewport', o.length === 0, o.join(', ')); }
  await page.evaluate(() => { const g = window.__life.game; g.hud.feedItem([Object.assign(document.createElement('span'), { textContent: 'Anna gleich Bruno +120' })], '#d9552f'); });
  await sleep(300);
  const fr = await rects(page, ['#feed .feed-item']);
  check('online kill feed stays clear of the HUD, corners and hole', fr.every((f) => !rs.some((r) => hits(f, r)) && !hits(f, zl) && !hits(f, zr) && !(hs.x > f.x && hs.x < f.x + f.w && hs.y > f.y && hs.y < f.y + f.h)));
  const bots = await page.evaluate(() => window.__online.remotes().filter((h) => h.isBot).length);
  console.log(`      info: ${bots} server bots in the room`);
  await page.screenshot({ path: shot('online-portrait') });
  // reconnect state
  await page.evaluate(() => window.__online.drop());
  await page.waitForFunction(() => window.__online.reconnecting, null, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  n = await net();
  const o2 = await oversized(page);
  check(`reconnecting state: #mp-net shows it, still a small pill (${Math.round(n.w)}x${Math.round(n.h)})`, /bad/.test(n.cls) && n.w <= 110 && n.h <= 56 && o2.length === 0, JSON.stringify(n) + o2.join());
  await page.screenshot({ path: shot('online-reconnecting') });
  await page.waitForFunction(() => !window.__online.reconnecting, null, { timeout: 20000 }).catch(() => {});
  check('reconnect completes and play continues', (await page.evaluate(() => window.__online.state)) === 'playing');
  // landscape
  await page.setViewportSize({ width: V.h, height: V.w }); await sleep(1500);
  const VL = await vp(page), rl = await rects(page, HUD_SEL);
  n = await net();
  const ovl = []; for (let i = 0; i < rl.length; i++) for (let j = i + 1; j < rl.length; j++) if (hits(rl[i], rl[j])) ovl.push(`${rl[i].s}+${rl[j].s}`);
  const o3 = await oversized(page);
  check(`online landscape: #mp-net small (${Math.round(n.w)}x${Math.round(n.h)}), HUD not overlapping, nothing oversized`, n.w <= 140 && n.h <= 40 && ovl.length === 0 && o3.length === 0 && rl.every((r) => r.x + r.w <= VL.w + 1 && r.y + r.h <= VL.h + 1), ovl.join() + o3.join());
  await page.screenshot({ path: shot('online-landscape') });
  check(`no console / page errors (${errs.length})`, errs.length === 0, errs.slice(0, 4).join(' || '));
  await page.close(); await page.__ctx.close();
}

// ---- memory / reload stress: every map on WebKit iPhone 13, a 2-minute round each ----------------------------------------------------------------
async function memoryRun() {
  const maps = (arg('--maps', 'centrs,agenskalns,mezaparks,purvciems')).split(',');
  const cfg = CONFIGS.find((c) => c.name === 'webkit-iPhone13') || { name: 'webkit-iPhone13', eng: 'webkit', dev: 'iPhone 13', land: 'iPhone 13 landscape', android: false };
  cur = 'memory';
  for (const map of maps) {
    const errs = [];
    const page = await newPage(cfg, { errs });
    cur = `memory/${map}`;
    await load(page, `map=${map}&mode=quick`);
    const info = await page.evaluate(() => { const s = window.__life.world.ground.userData.stats; return { tex: s.texMB + s.detailMB, tier: s.tier }; });
    const boot = await page.evaluate(() => window.__boot);
    await T.tapEl(page, '#play'); await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase)); await page.evaluate(() => window.__game.skipIntro());
    await driveRound(page, 140000);
    const r = await page.evaluate(() => ({ phase: window.__game.state.phase, score: window.__game.state.score, boot: window.__boot, ps: window.__pageshows, q: window.__life.quality.name }));
    console.log(`      info: ${map}: ground textures ${info.tex} MB (tier ${info.tier}), score ${Math.round(r.score)}, quality ${r.q}`);
    check(`${map}: low-tier ground texture memory <= 90 MB (${info.tex} MB)`, info.tex <= 90);
    check(`${map}: full 2:00 round on WebKit, page did not reload or crash`, r.phase === 'ended' && r.boot === boot && page.__nav === 1 && page.__crash === 0 && r.ps <= 1, `nav=${page.__nav} crash=${page.__crash} ${JSON.stringify(r)}`);
    check(`${map}: no console / page errors`, errs.length === 0, errs.slice(0, 3).join(' || '));
    await page.close(); await page.__ctx.close();
  }
}

try {
  if (has('--memory')) await memoryRun();
  else {
    if (!groupOnly || groupOnly !== 'online') for (const cfg of CONFIGS) await suite(cfg);
    if (!groupOnly || groupOnly === 'online') { await startWrangler(); for (const cfg of CONFIGS) await onlineSuite(cfg); }
  }
} catch (e) {
  fail++; console.log('FAIL  EXCEPTION ' + (e && e.stack || e));
}
for (const b of Object.values(browsers)) await b.close().catch(() => {});
kill();
console.log(`\nsmoke-mobile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
