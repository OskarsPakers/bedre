// Final screenshots + UX checks on the built game (vite preview of a private build dir).
//   PORT=5185 GPU=1 node scripts/final-shots.mjs
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5185;
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-shots');
await new Promise((res, rej) => spawn('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch {} });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

let failures = 0;
const check = (n, ok, i = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${i}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const browser = await chromium.launch({ headless: true, args });
const errors = [];
const mk = async (opts) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\//.test(m.text()) && !/502|404/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
};
const ready = (page) => page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
const shot = (page, n) => page.screenshot({ path: path.join(out, `final-${n}.png`) });

// ---- desktop
{
  const { ctx, page } = await mk({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV' });
  // loading screen: delay the map data so the loading UI is visible
  await page.route('**/data/riga.json', async (route) => { await sleep(2500); route.continue(); });
  await page.goto(`${base}/`);
  await sleep(1200);
  await shot(page, 'loading');
  check('loading screen visible during load', await page.evaluate(() => !!document.getElementById('loading') && !document.getElementById('loading').classList.contains('done')));
  await ready(page);
  await page.unroute('**/data/riga.json');
  await sleep(600);
  check('default language is LV for lv-LV', (await page.textContent('#play')) === 'Spēlēt', await page.textContent('#play'));
  await shot(page, 'start-lv');
  await page.click('[data-lang=en]');
  check('EN toggle', (await page.textContent('#play')) === 'Play');
  await shot(page, 'start-en');
  check('lang remembered', (await page.evaluate(() => localStorage.getItem('bedre.lang'))) === 'en');
  await page.click('#open-about');
  await sleep(200);
  await shot(page, 'about');
  await page.keyboard.press('Escape');
  check('Esc closes about', await page.evaluate(() => document.getElementById('about').classList.contains('hidden')));
  await page.click('#open-scores');
  await sleep(800);
  check('offline top-scores message (no API on preview)', /not reachable/.test(await page.textContent('#ts-msg')), await page.textContent('#ts-msg'));
  await shot(page, 'top-scores-offline');
  await page.click('#ts-close');

  await page.click('#play');
  await page.waitForFunction(() => window.__game.state.phase === 'playing');
  await sleep(600);
  // pause by Esc
  await page.keyboard.press('Escape');
  const t1 = await page.evaluate(() => window.__game.state.timeLeft);
  await sleep(700);
  const t2 = await page.evaluate(() => window.__game.state.timeLeft);
  check('pause freezes the timer', t1 === t2 && (await page.evaluate(() => window.__game.paused)), `${t1} ${t2}`);
  await shot(page, 'pause');
  await page.click('#resume');
  await sleep(500);
  check('resume continues', (await page.evaluate(() => window.__game.state.timeLeft)) < t2);
  // hidden tab pauses
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('hidden tab pauses', await page.evaluate(() => window.__game.paused));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await page.click('#resume');
  // resize / orientation
  await page.setViewportSize({ width: 800, height: 600 });
  await sleep(300);
  check('canvas follows resize', await page.evaluate(() => { const c = document.getElementById('c'); return c.width > 0 && Math.abs(c.clientWidth - 800) < 2; }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.mouse.move(700, 300);
  await sleep(1500);
  await shot(page, 'gameplay-desktop');
  // widest zoom
  await page.evaluate(() => { window.__game.zoomBy(10); });
  await sleep(1500);
  await shot(page, 'widest-zoom-ui');
  await ctx.close();
}

// ---- leak check: 5 consecutive "Play again" rounds
{
  const { ctx, page } = await mk({ viewport: { width: 1000, height: 600 } });
  await page.goto(`${base}/?intro=0&time=3&autostart=1`);
  await ready(page);
  const snap = () => page.evaluate(() => {
    const L = window.__life; let n = 0; L.world.scene ? 0 : 0;
    const scene = L.renderer.info; const sc = window.__scene;
    return { geo: scene.memory.geometries, tex: scene.memory.textures, programs: scene.programs ? scene.programs.length : 0, objs: L.world.objects.length, calls: scene.render.calls, dom: document.getElementsByTagName('*').length };
  });
  const snaps = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
    await sleep(300);
    snaps.push(await snap());
    if (i < 5) { await page.click('#again'); await page.waitForFunction(() => window.__game.state.phase === 'playing'); }
  }
  console.log('leak snapshots (after each round):', JSON.stringify(snaps));
  const a = snaps[1], z = snaps[5];
  check('no growth in geometries / textures / objects / DOM over 5 replays', z.geo <= a.geo && z.tex <= a.tex && z.objs === a.objs && z.dom <= a.dom + 5, JSON.stringify([a, z]));
  await ctx.close();
}

// ---- mobile (touch emulation)
{
  const { ctx, page } = await mk({ ...devices['iPhone 13'], locale: 'lv-LV' });
  await page.goto(`${base}/?intro=0`);
  await ready(page);
  await sleep(500);
  await shot(page, 'mobile-start');
  await page.tap('#play');
  await page.waitForFunction(() => window.__game.state.phase === 'playing');
  await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const p0 = await page.evaluate(() => ({ ...window.__game.hole }));
  await touch('touchStart', [[195, 500]]);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [[195 + i * 5, 500 - i * 8]]); await sleep(100); }
  await shot(page, 'mobile-gameplay');
  await touch('touchEnd', []);
  const p1 = await page.evaluate(() => ({ ...window.__game.hole }));
  check('touch drag steers (moved east/north)', p1.x - p0.x > 3 && p0.z - p1.z > 3, JSON.stringify([p0, p1]));
  const z0 = await page.evaluate(() => window.__game.cam.zoom);
  await touch('touchStart', [[150, 400], [250, 400]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150 - i * 8, 400], [250 + i * 8, 400]]); await sleep(60); }
  await touch('touchEnd', []);
  const z1 = await page.evaluate(() => window.__game.cam.zoom);
  check('pinch changes zoom', Math.abs(z1 - z0) > 0.05, `${z0} -> ${z1}`);
  check('page does not scroll', await page.evaluate(() => window.scrollY === 0 && document.documentElement.scrollHeight <= window.innerHeight + 1));
  await ctx.close();
}
await browser.close();
const bad = errors.filter((e) => !/Failed to load resource/.test(e));
check('no page errors', bad.length === 0, bad.join(' | '));
console.log(failures ? `${failures} FAILED` : 'all shots/UX checks passed');
try { server.kill('SIGTERM'); } catch {}
process.exit(failures ? 1 : 0);
