// Screenshot of the in-round leaderboard mid-round with a CASUAL player (0.65x speed, imperfect) on a difficulty (default easy).
//   PORT=5187 node scripts/board-shot.mjs [easy|normal|hard] [seconds=100] [map]   -> scripts/out/board-<diff>.png
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const diff = process.argv[2] || 'easy', secs = +(process.argv[3] || 100), map = process.argv[4] || 'centrs';
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV' })).newPage();
await page.goto(`http://localhost:${process.env.PORT || 5187}/?autostart=1&intro=0&difficulty=${diff}&map=${map}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 30000 });
const res = await page.evaluate((secs) => {
  const g = window.__life.game, p = g.player, W = window.__life.world;
  p.speedMul = 0.65; g.autopilot = true;
  let t = 0, nextPick = 0, goal = null;
  while (t < secs && g.phase === 'playing') {
    if (t >= nextPick || !goal || goal.state !== 0) {
      nextPick = t + 0.5 + Math.random() * 0.9; let best = null, bs = -1;
      W.query(p.x, p.z, Math.max(25, p.radius * 8), (o, d) => { if (o.state !== 0 || o.fit >= p.radius * 0.95) return; const s = o.value / (d + p.radius * 1.5 + 4) * (0.75 + Math.random() * 0.5); if (s > bs) { bs = s; best = o; } });
      goal = best;
    }
    if (goal) p.control = { mode: 'target', x: goal.x, z: goal.z };
    for (let i = 0; i < 12; i++) { g.update(1 / 60, true); t += 1 / 60; }
  }
  g.autopilot = false; g._flushPopup(0.2); g._overlay(0.3); g._hudSync();
  return g._rank().map((r) => `${r.rank}. ${r.name} ${Math.round(r.score)}${r.isPlayer ? ' <- you' : ''}`);
}, secs);
console.log(res.join('\n'));
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(root, 'scripts', 'out', `board-${diff}.png`) });
await browser.close();
