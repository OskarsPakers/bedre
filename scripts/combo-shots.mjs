// Screenshots of the combos + power-ups UI: desktop (Chromium) and a real WebKit iPhone 13 in portrait. Output: scripts/out/combo-*.png, powerup-*.png
//   [GPU=1] [SHOTS_PORT=5187] node scripts/combo-shots.mjs [--no-build]
// (the online round shots, scripts/out/powerup-online-*.png, come from scripts/smoke-mp.mjs)
import { chromium, webkit, devices } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startBuilt } from './lib/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const srv = await startBuilt({ port: +(process.env.SHOTS_PORT || 5187), outDir: '.dist-shots', noBuild: process.argv.includes('--no-build') });
const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROWS = (n, base) => Array.from({ length: n }, (_, i) => ({ name: ['Anna', 'Jānis', 'Līga', 'Kaķis', 'Rūķis', 'Zane', 'Uldis', 'Ieva'][i % 8], score: Math.round(base / (1 + i * 0.35)), radius: 40 - i, eaten: 300, rank: i + 1, difficulty: ['easy', 'normal', 'hard'][i % 3], at: 1700000000 }));

for (const cfg of [
  { tag: 'desktop', eng: chromium, ctx: { viewport: { width: 1280, height: 720 } }, args: GPU },
  { tag: 'phone', eng: webkit, ctx: { ...devices['iPhone 13'] }, args: [] },
]) {
  const browser = await cfg.eng.launch({ headless: true, args: cfg.args });
  const ctx = await browser.newContext({ ...cfg.ctx, locale: 'lv-LV', timezoneId: 'Europe/Riga' });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/\/api\/scores\?/, (r) => { const u = new URL(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'classic', map: 'centrs', period: 'all', scores: u.searchParams.get('archive') ? ROWS(7, 88000) : ROWS(7, 241000) }) }); });   // (later routes win)
  await ctx.addInitScript(() => { try { localStorage.setItem('bedre.lang', 'lv'); localStorage.setItem('bedre.name', 'Tu'); localStorage.setItem('bedre.a2hs.dismissed', '1'); } catch {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${srv.base}/?intro=0&radio=0&puseed=5&quality=low`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  const P = (name) => path.join(out, `${name}-${cfg.tag}.png`);
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: P(name) }); console.log('shot', P(name)); };
  const E = (fn, a) => page.evaluate(fn, a);

  await E(() => { window.__game.start(); window.__game.skipIntro(); });
  // ---- each token on the street: the player stands ~16 m away, the camera looks at both
  for (const type of ['magnet', 'speed', 'double', 'shield']) {
    await E((type) => {
      const g = window.__life.game, f = g.field, s = f.slots.find((q) => q.type === type && q.state === 'on') || f.slots[0];
      g.autopilot = true; g.player.control = { mode: 'none', x: 0, z: 0 };
      window.__game.teleport(s.x + 3, s.z + 15); g.step(0.5);
      g.cam.snap(g.player); g.step(0.3);
    }, type);
    await shot(`powerup-token-${type}`);
  }
  // ---- the minimap with its pickup dots (clip of the minimap card)
  await E(() => { const g = window.__life.game; g.step(0.5); });
  const mm = await page.$('#minimap-box');
  if (mm) { await page.waitForTimeout(300); await mm.screenshot({ path: P('powerup-minimap') }); console.log('shot', P('powerup-minimap')); }
  // ---- magnet pulling things in: a bigger hole in the Old Town, magnet on
  await E(() => {
    const g = window.__life.game; g.autopilot = true; g.player.control = { mode: 'none', x: 0, z: 0 };
    window.__game.setRadius(6); window.__game.teleport(-700, 230); g.step(0.3);
    window.__game.givePowerup('magnet'); g.step(0.18);
  });
  await shot('powerup-magnet-pull');
  // ---- badges + pickup toast (all four effects) and the chip at several combo levels
  await E(() => { const g = window.__life.game; for (const t of ['magnet', 'speed', 'double', 'shield']) g.player.pick(t); g.hud.puToast('shield', 8); g.step(0.1); });
  await shot('powerup-badges');
  for (const [name, count, mult, withDouble] of [['x1.2', 6, 1.2, false], ['x1.5', 14, 1.5, false], ['x2', 30, 2, false], ['x2.5', 50, 2.5, false], ['x3', 90, 3, false], ['x5-with-double', 90, 3, true]]) {
    await E(([count, mult, dbl]) => {
      const g = window.__life.game, p = g.player;
      p.fx.clear(); if (dbl) p.pick('double');
      g.hud.fxToast && (g.hud.fxToast.hidden = true);
      p.combo.count = count; p.combo.mult = mult; p.combo.best = Math.max(p.combo.best, count); p.combo.bestMult = Math.max(p.combo.bestMult, mult); p.combo.until = g.playT + 0.9; g._overlay(0.3);
      g.pop.sum = 120 * mult; g.pop.n = 1; g.pop.hot = mult > 1; g.pop.x = p.x; g.pop.z = p.z - 4; g._flushPopup(1);
    }, [count, mult, withDouble]);
    await shot(`combo-chip-${name}`);
  }
  // ---- a real round: results with the best combo
  await E(() => { const g = window.__life.game; g.player.fx.clear(); g.hud.clearTransient(); });
  await E(() => { window.__life.game.autoplay(120); });
  await E(() => { window.__life.game.end(); });
  await sleep(800);
  await shot('combo-results');
  // ---- Top scores with the Archive toggle
  await E(() => document.getElementById('again') && document.getElementById('open-scores2').click());
  await sleep(600);
  await shot('combo-scores-current');
  await E(() => document.getElementById('ts-archive').click());
  await sleep(600);
  await shot('combo-scores-archive');
  if (errs.length) console.log('PAGE ERRORS', cfg.tag, errs.slice(0, 3));
  await browser.close();
}
srv.stop();
process.exit(0);
