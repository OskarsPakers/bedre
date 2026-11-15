// Gameplay-view screenshots with the shaped buildings: small / large hole, a building mid-fall, quality=low, About popover, mobile corner.
//   PORT=5189 GPU=1 node scripts/detail-play-shots.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5189;
const base = `http://localhost:${PORT}`;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function session(name, { viewport = { width: 1280, height: 720 }, query = 'quality=high&intro=0&bots=0', touch = false } = {}, fn) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  await fn(page, (n) => page.screenshot({ path: path.join(out, `detail-${n}.png`) }));
  await ctx.close();
}
const G = (page, fn, a) => page.evaluate(fn, a);
await session('play', {}, async (page, shot) => {
  await G(page, () => window.__game.start()); await page.waitForTimeout(2400);
  await G(page, () => { const g = window.__game; g.teleport(-420, 300); g.setRadius(3); g.step(0.6); });
  await page.waitForTimeout(500); await shot('play-small');
  await G(page, () => { const g = window.__game; g.teleport(-380, 330); g.setRadius(42); g.step(0.8); });
  await page.waitForTimeout(500); await shot('play-large');
  // mid-fall: a shaped building just after it is swallowed
  await G(page, () => { const g = window.__game, w = window.__life.world; g.start(); const it = w.buildingItems.filter((i) => i.shaped && i.fit > 16 && i.fit < 30 && i.h > 25).sort((a, b) => Math.hypot(a.x + 380, a.z - 330) - Math.hypot(b.x + 380, b.z - 330))[0]; g.teleport(it.x, it.z); g.setRadius(it.fit / 0.9 + 0.5); g.step(0.05); document.getElementById('banner') && (document.getElementById('banner').style.visibility = 'hidden'); window.__fall = [it.x, it.z]; });
  await page.waitForTimeout(150);
  await G(page, () => { window.__game.step(0.62); window.__game.render(); });
  await page.waitForTimeout(200); await shot('midfall');
});
await session('low', { query: 'quality=low&intro=0&bots=0' }, async (page, shot) => {
  await G(page, () => window.__game.start()); await page.waitForTimeout(2400);
  await G(page, () => { const g = window.__game; g.teleport(-380, 330); g.setRadius(14); g.step(0.8); });
  await page.waitForTimeout(500); await shot('low');
});
await session('about', { query: 'intro=0&bots=0' }, async (page, shot) => {
  const btn = await page.$('#about-btn, [data-open="about"], #open-about, button:has-text("About"), button:has-text("Par spēli"), a:has-text("About"), a:has-text("Par spēli")');
  if (btn) await btn.click(); else console.log('no about button');
  await page.waitForTimeout(500); await shot('about');
});
await session('mobile', { viewport: { width: 390, height: 780 }, touch: true, query: 'quality=medium&intro=0&bots=0' }, async (page, shot) => {
  await G(page, () => window.__game.start()); await page.waitForTimeout(2400);
  await G(page, () => { const g = window.__game; g.teleport(-420, 300); g.setRadius(4); g.step(0.6); });
  await page.waitForTimeout(500); await shot('mobile');
});
await browser.close(); kill(); process.exit(0);
