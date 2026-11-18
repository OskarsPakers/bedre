// Freedom Monument protection in the browser (solo): with ?theme=nov18 a radius-20 hole over the monument does not remove it, the toast shows once, huge bots standing on it do not
// eat it; with ?theme=day it is eaten as before.   [GPU=1] [FM_PORT=5193] node scripts/smoke-freedom.mjs
import { chromium } from 'playwright';
import { startBuilt } from './lib/static-server.mjs';

const srv = await startBuilt({ port: +(process.env.FM_PORT || 5193), outDir: '.dist-freedom' });
const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const b = await chromium.launch({ headless: true, args: GPU });
let fails = 0;
const check = (n, ok, i = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : i}`); if (!ok) fails++; };
const errs = [];
async function run(theme, f) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV' });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('bedre.lang', 'lv'); localStorage.setItem('bedre.name', 'Fm'); } catch {} });
  await p.goto(`${srv.base}/?quality=low&radio=0&intro=0&theme=${theme}`);
  await p.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  await p.click('#play'); await p.waitForFunction(() => window.__game.state.phase === 'playing');
  await p.evaluate(() => { const fm = window.__freedom.fm, g = window.__game; g.teleport(fm.x + 4, fm.z + 4); g.setRadius(20); });
  await f(p);
  await ctx.close();
}
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('#meta-toasts > *')].filter((e) => /savā vietā/.test(e.textContent)).length);
await run('nov18', async (p) => {
  check('nov18: protection on, the theme line says so', await p.evaluate(() => window.__freedom.protected && /apēdams/.test(document.getElementById('themecap').textContent)));
  await p.evaluate(() => window.__game.step(1.5));
  check('nov18: a radius-20 hole over the monument does not remove it', await p.evaluate(() => window.__freedom.fm.state === 0));
  check('nov18: the toast "Brīvības piemineklis paliek savā vietā." shows once', (await toasts(p)) === 1);
  await p.evaluate(() => window.__game.step(2));
  check('nov18: no second toast within 20 s', (await toasts(p)) === 1);
  check('nov18: huge bots on top of it do not eat it', await p.evaluate(() => { const g = window.__game, fm = window.__freedom.fm; g.teleport(fm.x + 400, fm.z + 400); for (let i = 1; i < g.holes.length; i++) { g.teleportHole(i, fm.x + i, fm.z); g.setHoleRadius(i, 25); } g.step(6); return fm.state === 0; }));
});
await run('day', async (p) => {
  await p.evaluate(() => window.__game.step(1.5));
  check('theme=day: the monument is eaten as before', await p.evaluate(() => !window.__freedom.protected && window.__freedom.fm.state !== 0));
});
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close(); srv.stop();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
