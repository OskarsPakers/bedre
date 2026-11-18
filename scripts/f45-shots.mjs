// Screenshots for features 4 + 5 that need no server: six skins on a hole in play (day + evening, desktop + real WebKit iPhone 13), three trails,
// the wardrobe grid and the level badge / level-up on the iPhone. -> scripts/out/f45-*.png  (the lobby / results / two-players shots come from smoke-friends.mjs)
//   [GPU=1] [SHOTS_PORT=5187] node scripts/f45-shots.mjs [--no-build]
import { chromium, webkit, devices } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startBuilt } from './lib/static-server.mjs';
import { xpAt } from '../src/meta/level.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const srv = await startBuilt({ port: +(process.env.SHOTS_PORT || 5187), outDir: '.dist-f45-shots', noBuild: process.argv.includes('--no-build') });
const BASE = srv.base;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GL = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const L = xpAt(12) + 300;
const store = { v: 1, xp: L, eq: [0, 0, 0], seen: [], ach: ['combo2'], alb: 60, rounds: 40 };
const rewards = { v: 1, rewards: { 'streak-3': { d: '2026-10-01' }, 'streak-7': { d: '2026-10-05' }, 'streak-14': { d: '2026-10-12' }, 'streak-30': { d: '2026-10-28' }, 'week-2025-50-hard': { d: '2025-12-12' }, 'week-2026-01-medium': { d: '2026-01-05' }, 'week-2026-02-easy': { d: '2026-01-12' } } };
const RIMS = [1, 3, 5, 6, 8, 9], RIMNAMES = ['flag', 'daugava', 'jugend', 'pelmenis', 'saha', 'aurora'];
let fails = 0;

async function boot(browser, ctxOpts, q) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.addInitScript(([w, g]) => { try { localStorage.setItem('bedre.lang', 'en'); localStorage.setItem('bedre.name', 'Tu'); if (!sessionStorage.getItem('f45s')) { sessionStorage.setItem('f45s', '1'); localStorage.setItem('bedre.wardrobe.v1', JSON.stringify(w)); localStorage.setItem('bedre.meta.global.v1', JSON.stringify(g)); } } catch {} window.__metaAllowDebug = true; }, [store, rewards]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('pageerror', e.message); });
  await page.goto(`${BASE}/?quality=medium&intro=0&radio=0&${q}`);
  await page.waitForFunction(() => (document.body.dataset.ready === '1' && window.__meta) || document.body.dataset.error, null, { timeout: 240000 });
  return { ctx, page };
}

/** hole in play at a gameplay-ish zoom with the given skin; returns a PNG crop around it */
async function holeShot(page, skin, { clipW, clipH, radius = 12, trail = false }) {
  await page.evaluate(([skin, radius, fresh]) => {
    const g = window.__life.game;
    if (g.phase !== 'playing' || fresh) { g.start(); g.skipIntro(); }   // fresh = a restarted round (the world is back to its start, the hole small)
    g.player.skin = skin; g.player.protectT = 0; g.player.setRadius(radius); g.cam.zoom = fresh ? 0.85 : 0.5; g.cam.snap(g.player); g.step(0.3);
  }, [skin, radius, trail]);
  if (trail) {   // an open stretch of ground (no building within 45 m): teleport there, then drive a gentle arc so the marks line up behind the hole
    await page.evaluate(() => {
      const g = window.__life.game, w = window.__life.world, p = g.player, b = w.bounds;
      const blds = w.objects.filter((o) => o.isBuilding);
      let best = null;
      for (let x = b.minX + 80; x < b.maxX - 80; x += 30) for (let z = b.minZ + 80; z < b.maxZ - 80; z += 30) {
        let n = 0, props = 0;
        for (const o of blds) { const d = Math.hypot(o.x - x, o.z - z); if (d < 60) { n++; break; } }
        if (n) continue;
        for (const o of w.objects) if (!o.isBuilding && Math.hypot(o.x - x, o.z - z) < 40) props++;
        if (!best || props < best.props) best = { x, z, props };
      }
      if (best) { g.teleport(best.x, best.z); g.cam.snap(p); g.step(0.2); }
      p.setRadius(6);
      const cx = p.x, cz = p.z; g.autopilot = true;
      for (let i = 0; i < 24; i++) { const a = -1.0 + i * 0.1; p.control = { mode: 'target', x: cx + Math.cos(a) * 30 - 30 * Math.cos(-1.0), z: cz + Math.sin(a) * 30 - 30 * Math.sin(-1.0) }; g.step(0.2); }
      g.autopilot = false;
    });
  }
  await sleep(trail ? 60 : 250);   // (trail marks age in real time: shoot at once)
  const pos = await page.evaluate(() => { const g = window.__life.game, p = g.player, c = g.cam.camera; g.step(0.02); g.render(); c.updateMatrixWorld(true); g._v.set(p.x, 0, p.z).project(c); const el = document.getElementById('c'); return { x: (g._v.x * 0.5 + 0.5) * el.clientWidth, y: (-g._v.y * 0.5 + 0.5) * el.clientHeight, w: el.clientWidth, h: el.clientHeight }; });
  if (trail) { const cw = clipW === 640 ? 640 : 480, ch = Math.round(cw * 0.5625); return page.screenshot({ clip: { x: Math.max(0, Math.min(pos.w - cw, pos.x - cw * 0.5 + 40)), y: Math.max(0, Math.min(pos.h - ch, pos.y - ch * 0.5)), width: cw, height: ch } }); }
  const x = Math.max(0, Math.min(pos.w - clipW, pos.x - clipW / 2)), y = Math.max(0, Math.min(pos.h - clipH, pos.y - clipH / 2));
  return page.screenshot({ clip: { x, y, width: clipW, height: clipH } });
}

async function sheet(browser, bufs, labels, file, cols = 3, w = 330, h = 230) {
  const ctx = await browser.newContext({ viewport: { width: cols * (w + 8) + 8, height: Math.ceil(bufs.length / cols) * (h + 34) + 8 } });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:8px;background:#2b3a4a;font:700 14px system-ui;color:#f6efdf;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:8px">${bufs.map((b, i) => `<figure style="margin:0"><img style="width:${w}px;height:${h}px;object-fit:cover;border-radius:10px;display:block" src="data:image/png;base64,${b.toString('base64')}"><figcaption style="padding:6px 2px">${labels[i]}</figcaption></figure>`).join('')}</body>`);
  await sleep(300);
  await p.screenshot({ path: path.join(out, file), fullPage: true });
  await ctx.close();
}

try {
  const chrome = await chromium.launch({ headless: true, args: GL });
  const wk = await webkit.launch({ headless: true });
  // ---- six skins in play: day + evening, desktop ----------------------------------------------------------------------------------------------------
  for (const theme of ['day', 'evening']) {
    const { ctx, page } = await boot(chrome, { viewport: { width: 1280, height: 720 } }, `theme=${theme}&mode=free`);
    const bufs = [];
    for (const r of RIMS) bufs.push(await holeShot(page, [r, 0, 0], { clipW: 330, clipH: 230 }));
    await sheet(chrome, bufs, RIMS.map((r, i) => `${RIMNAMES[i]} (${theme})`), `f45-skins-${theme}.png`);
    if (theme === 'day') {
      const tb = [];
      for (const t of [3, 4, 5, 6, 1, 7]) tb.push(await holeShot(page, [t === 3 ? 2 : t === 4 ? 3 : t === 5 ? 9 : 1, t, 0], { clipW: 420, clipH: 230, radius: 5, trail: true }));
      await sheet(chrome, tb, ['sparks', 'bubbles', 'petals', 'dumplings', 'dust', 'aurora glow'], 'f45-trails.png', 3, 420, 236);
      await page.evaluate(() => { const g = window.__life.game; g.player.skin = [3, 3, 3]; });
      const one = await holeShot(page, [4, 3, 0], { clipW: 640, clipH: 360, radius: 5, trail: true });
      fs.writeFileSync(path.join(out, 'f45-trail.png'), one);
    }
    await ctx.close();
  }
  // ---- real WebKit iPhone 13: skins, wardrobe, badge, level-up ---------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await boot(wk, { ...devices['iPhone 13'] }, 'theme=day&mode=free');
    const bufs = [];
    for (const r of RIMS) bufs.push(await holeShot(page, [r, 0, 0], { clipW: 300, clipH: 230, radius: 12 }));
    await sheet(chrome, bufs, RIMS.map((r, i) => `${RIMNAMES[i]} (iPhone WebKit)`), 'f45-skins-iphone.png', 3, 300, 230);
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(wk, { ...devices['iPhone 13'] }, 'time=40');
    await page.screenshot({ path: path.join(out, 'f45-start-iphone.png') });
    await page.evaluate(() => window.__meta.open('wardrobe')); await sleep(900);
    await page.screenshot({ path: path.join(out, 'f45-wardrobe-iphone.png') });
    await page.evaluate(() => { const b = document.getElementById('mp-body'); b.scrollTop = 520; }); await sleep(300);
    await page.screenshot({ path: path.join(out, 'f45-wardrobe-iphone-scrolled.png') });
    await page.evaluate(() => window.__meta.close());
    // a level-up round: seed XP just below the next level, play a real eligible round
    await page.evaluate((x) => { const w = JSON.parse(localStorage.getItem('bedre.wardrobe.v1')); w.xp = x; localStorage.setItem('bedre.wardrobe.v1', JSON.stringify(w)); }, xpAt(13) - 40);
    await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === '1' && window.__meta, null, { timeout: 240000 });
    await page.screenshot({ path: path.join(out, 'f45-start-iphone-level13-ring.png') });
    await page.evaluate(() => { const g = window.__life.game; g.start(); g.skipIntro(); g.step(21); });
    await sleep(300);
    await page.evaluate(() => window.__life.game.end());
    await sleep(1400);
    await page.screenshot({ path: path.join(out, 'f45-levelup-iphone.png') });
    const lv = await page.evaluate(() => window.__lastXp && { up: window.__lastXp.levelUp, lvl: window.__lastXp.after.level });
    console.log('level-up round:', JSON.stringify(lv));
    if (!lv || !lv.up) fails++;
    await ctx.close();
  }
  await chrome.close(); await wk.close();
} catch (e) { console.error(e); fails++; }
srv.stop();
console.log(fails ? `${fails} problem(s)` : 'shots ok');
process.exit(fails ? 1 : 0);
