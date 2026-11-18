// Layout audit across phone / small-desktop viewports (REAL WebKit for the iPhones, Chromium for the rest): start screen, every panel,
// solo play, results. Runs scripts/lib/layout-audit.mjs in the page and fails on any violation.
//   [GPU=1] node scripts/smoke-layout.mjs [--shots] [--only <substr>] [--no-build]     (builds + serves its own client on LAYOUT_PORT, default 5192; LAYOUT_URL=<url> uses a running one)
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLayout } from './lib/layout-audit.mjs';
import { startBuilt } from './lib/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const srv = await startBuilt({ url: process.env.LAYOUT_URL, port: +(process.env.LAYOUT_PORT || 5192), outDir: '.dist-layout', noBuild: process.argv.includes('--no-build') });
const BASE = srv.base;
const only = arg('--only', ''), shots = process.argv.includes('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

const VPS = [
  { name: 'iPhoneSE', eng: 'webkit', dev: 'iPhone SE', touch: true },
  { name: 'iPhoneSE-land', eng: 'webkit', dev: 'iPhone SE landscape', touch: true },
  { name: 'iPhone13', eng: 'webkit', dev: 'iPhone 13', touch: true },
  { name: 'iPhone13-land', eng: 'webkit', dev: 'iPhone 13 landscape', touch: true },
  { name: 'iPhone14PM', eng: 'webkit', dev: 'iPhone 14 Pro Max', touch: true },
  { name: 'iPhone14PM-land', eng: 'webkit', dev: 'iPhone 14 Pro Max landscape', touch: true },
  { name: 'Pixel5', eng: 'chromium', dev: 'Pixel 5', touch: true },
  { name: 'Pixel5-land', eng: 'chromium', dev: 'Pixel 5 landscape', touch: true },
  { name: 'd1920x1080', eng: 'chromium', size: [1920, 1080], touch: false },
  { name: 'd1600x900', eng: 'chromium', size: [1600, 900], touch: false },
  { name: 'd1280x720', eng: 'chromium', size: [1280, 720], touch: false },
  { name: 'd1024x600', eng: 'chromium', size: [1024, 600], touch: false },
  { name: 'd853x480', eng: 'chromium', size: [853, 480], touch: false },
  { name: 'd640x360', eng: 'chromium', size: [640, 360], touch: false },
].filter((v) => !only || v.name.includes(only));
const LANGS = (arg('--langs', 'lv,en')).split(',');

let fails = 0, passes = 0;
const browsers = {};
const getB = async (e) => browsers[e] || (browsers[e] = await (e === 'webkit' ? webkit : chromium).launch({ headless: true, args: e === 'chromium' ? GPU : [] }));
const report = (tag, viol) => {
  const seen = new Set(); const u = viol.filter((v) => !seen.has(v.kind + v.msg) && seen.add(v.kind + v.msg));
  if (u.length) { fails++; console.log(`FAIL  ${tag}`); for (const v of u.slice(0, 8)) console.log(`        ${v.kind}: ${v.msg}`); } else { passes++; if (process.env.VERBOSE) console.log(`PASS  ${tag}`); }
};

for (const vp of VPS) {
  const b = await getB(vp.eng);
  for (const lang of LANGS) {
    const prof = vp.dev ? { ...devices[vp.dev] } : { viewport: { width: vp.size[0], height: vp.size[1] } };
    const ctx = await b.newContext({ ...prof, locale: lang === 'lv' ? 'lv-LV' : 'en-GB', timezoneId: 'Europe/Riga' });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.addInitScript((l) => { try { localStorage.setItem('bedre.lang', l); localStorage.setItem('bedre.name', 'Tests'); localStorage.setItem('bedre.a2hs.dismissed', '0'); } catch {} }, lang);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/?quality=low&intro=0&radio=0`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    await sleep(500);
    const A = async (state, tag) => {
      const v = await page.evaluate(auditLayout, { touch: vp.touch });
      report(`${vp.name}/${lang}/${state}`, v);
      if (shots) await page.screenshot({ path: path.join(out, `layout-${vp.name}-${lang}-${state}.png`) });
    };
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
    await A('menu');
    // panels reachable from the menu
    for (const [state, open, close] of [
      ['opts', '#opts summary, #opts', null], ['scores', '#open-scores, [data-open="scores"], #scores-btn', '#scores .close, #scores-close'],
      ['about', '#open-about, [data-open="about"], #about-btn, .about-link', '#about .close, #about-close'],
    ]) {
      const opened = await page.evaluate(([o]) => { for (const s of o.split(',')) { const e = document.querySelector(s.trim()); if (e) { e.click(); return s.trim(); } } return null; }, [open]);
      if (!opened) continue;
      await sleep(250);
      await A(state);
      await page.keyboard.press('Escape'); await sleep(200);
    }
    // solo play
    await page.evaluate(() => { window.__game.start(); window.__game.skipIntro(); });
    await sleep(800);
    await page.evaluate(() => {
      const g = window.__life.game, sp = (t) => { const e = document.createElement('span'); e.textContent = t; return e; };
      g.hud.feedItem([sp('Hunter'), sp(' swallowed '), sp('Tests'), sp(' +120')], '#d9552f');
      if (window.__metaToast) window.__metaToast('★', 'Sasniegums: Pirmais kumoss', { ms: 6000 });
    });
    await sleep(500);
    await A('play');
    // the phone layout's compact leaderboard chip must never show next to the full leaderboard (wide layouts)
    if (!vp.touch && vp.size[0] > 900) {
      const chip = await page.evaluate(() => { const c = document.getElementById('board-chip'), r = c && c.getBoundingClientRect(); return { shown: !!c && getComputedStyle(c).display !== 'none' && r.width > 0, listShown: getComputedStyle(document.getElementById('board-list')).display !== 'none' }; });
      report(`${vp.name}/${lang}/no-compact-chip`, chip.shown || !chip.listShown ? [{ kind: 'chip', msg: JSON.stringify(chip) }] : []);
    }
    // combo chip + the four power-up badges + the pickup toast, all at once: none of them may touch a HUD card, the hole or a banner lane
    await page.evaluate(() => { const g = window.__life.game, p = g.player; p.combo.count = 80; p.combo.mult = 3; p.combo.until = g.playT + 5; for (const t of ['magnet', 'speed', 'double', 'shield']) p.pick(t); g.hud.puToast('magnet', 8); g._overlay(0.3); });
    await sleep(120);
    await A('play-fx');
    await page.evaluate(() => { const g = window.__life.game; g.player.score = 1200; });
    await page.evaluate(() => window.__life.game.end());
    await sleep(700);
    await A('results');
    if (errs.length) { fails++; console.log(`FAIL  ${vp.name}/${lang} page errors: ${errs.slice(0, 2).join(' | ')}`); }
    await ctx.close();
  }
}
for (const b of Object.values(browsers)) await b.close();
srv.stop();
console.log(fails ? `\n${fails} layout check(s) FAILED (${passes} passed)` : `\nall ${passes} layout checks passed`);
process.exit(fails ? 1 : 0);
