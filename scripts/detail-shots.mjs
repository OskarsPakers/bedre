// Review screenshots of the shaped buildings (scripts/out/).
//   PORT=5181 GPU=1 node scripts/detail-shots.mjs [slug ...] [--quality=low] [--prefix=before-] [--only=heroes|blocks|overview|sheet]
// Writes, per hero (tools/detail/heroes.mjs): hero-<slug>-a.png, -b.png (two opposite 3/4 close-ups), -play.png (gameplay zoom);
// hero-sheet.png (contact sheet of the a-shots + play shots); block-1..6.png (fixed ordinary shaped blocks); detail-overview*.png.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HEROES, BLOCK_IDS as CENTRE_BLOCKS, DISTRICT_BLOCKS } from '../tools/detail/heroes.mjs';
const MAP = process.env.MAP || 'centrs'; // MAP=<slug>: shoot a district (files become district-<slug>-shapes-*.png)
const BLOCK_IDS = MAP === 'centrs' ? CENTRE_BLOCKS : DISTRICT_BLOCKS[MAP] || [];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5181;
const base = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const quality = opt('quality', 'high');
const prefix = opt('prefix', MAP === 'centrs' ? '' : `district-${MAP}-shapes-`);
const only = opt('only', 'all');
const sfx = quality === 'high' ? '' : '-' + quality;
const want = (k) => only === 'all' || only === k;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text()); });
async function boot() {
  await page.goto(`${base}/?quality=${quality}&intro=0&bots=0&theme=day${MAP === 'centrs' ? '' : '&map=' + MAP}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  await page.evaluate(() => { window.__game.start(); });
  await page.waitForTimeout(2400);
  await page.evaluate(() => { document.body.classList.add('shots'); const st = document.createElement('style'); st.dataset.shots = '1'; st.textContent = 'body > *:not(canvas):not(script){display:none !important}'; document.head.appendChild(st); });
  // free camera aimed at a world point: freeCam({x, z, y, dist, el, az, fog})
  await page.evaluate(() => {
    window.__freeCam = (o) => {
      const w = window.__life.world;
      const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
      const c = cm.camera, r = Math.PI / 180;
      c.position.set(o.x + o.dist * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.dist * Math.sin(o.el * r), o.z + o.dist * Math.cos(o.el * r) * Math.cos(o.az * r));
      c.fov = 42; c.near = 1; c.far = 8000; c.lookAt(o.x, o.y, o.z); c.updateProjectionMatrix();
      const f = w.scene.fog; if (f && !w.__fog0) w.__fog0 = [f.near, f.far];
      if (f) { f.near = (w.__fog0?.[0] || f.near) * 4; f.far = (w.__fog0?.[1] || f.far) * 4; }
      if (o.dist > 500) w.scene.fog = null;
      window.__game.render();
    };
    window.__release = () => { const cm = window.__life.game.cam; if (cm._apply) { cm.apply = cm._apply; } };
    window.__heroInfo = (ids) => {
      const w = window.__life.world;
      const its = ids.map((id) => w.buildingItems.find((i) => i.id === id)).filter(Boolean);
      if (!its.length) return null;
      let sa = 0, cx = 0, cz = 0, hm = 0;
      for (const i of its) { sa += i.area; cx += i.x * i.area; cz += i.z * i.area; hm = Math.max(hm, i.h); }
      cx /= sa; cz /= sa;
      let rad = 0;
      for (const i of its) rad = Math.max(rad, Math.hypot(i.x - cx, i.z - cz) + Math.sqrt(i.area / Math.PI));
      return { x: cx, z: cz, h: hm, rad, area: sa };
    };
  });

}
const G = async (fn, a) => {
  for (let t = 0; t < 4; t++) {
    try { if (!(await page.evaluate(() => typeof window.__freeCam === 'function'))) await boot(); return await page.evaluate(fn, a); } catch (e) { if (t === 3) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
};
await boot();
const log = async (n) => console.log('shot', n, JSON.stringify(await G(() => ({ calls: window.__life.renderer.info.render.calls, tris: window.__life.renderer.info.render.triangles }))));
const snap = async (file, setup, arg) => { // setup runs (again) whenever a dev-server reload wiped the page between setup and screenshot
  for (let t = 0; t < 5; t++) {
    await G(setup, arg);
    await page.waitForTimeout(450);
    if (await page.evaluate(() => !!document.querySelector('style[data-shots]') && typeof window.__freeCam === 'function')) { await page.screenshot({ path: path.join(out, file) }); await log(file); return; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('could not get a stable page for ' + file);
};

const heroes = HEROES.filter((h) => (h.map || 'centrs') === MAP).filter((h) => (!names.length || names.includes(h.slug)) && h.ids.length);
if (want('heroes')) {
  for (const h of heroes) {
    const info = await G((ids) => window.__heroInfo(ids), h.ids);
    if (!info) { console.log('hero not in this build:', h.slug); continue; }
    const cam = h.cam || {};
    const dist = cam.dist || Math.max(65, info.rad * 3.3 + info.h * 0.8);
    const el = cam.el ?? 30, y = cam.y ?? Math.min(info.h * 0.4, 30);
    for (const [k, az] of [['a', cam.a ?? 35], ['b', cam.b ?? 215]]) {
      await snap(`${prefix}hero-${h.slug}-${k}${sfx}.png`, (o) => window.__freeCam(o), { x: info.x, z: info.z, y, dist, el, az });
    }
    // gameplay zoom: the real game camera over the building with a mid-size hole
    await snap(`${prefix}hero-${h.slug}-play${sfx}.png`, (o) => { window.__release(); const g = window.__game; g.teleport(o.x, o.z); g.setRadius(o.r); g.step(0.8); }, { x: info.x, z: info.z, r: Math.max(10, Math.min(24, info.rad * 0.5)) });
  }
}
if (want('blocks') && !names.length) {
  for (let n = 0; n < BLOCK_IDS.length; n++) {
    const info = await G((ids) => window.__heroInfo(ids), [BLOCK_IDS[n]]);
    if (!info) continue;
    await snap(`${prefix}block-${n + 1}${sfx}.png`, (o) => window.__freeCam(o), { x: info.x, z: info.z, y: Math.min(info.h * 0.35, 12), dist: Math.max(70, info.rad * 3.4 + info.h), el: 28, az: 30 + n * 55 });
  }
}
if (want('overview') && !names.length) {
  const ov = MAP === 'centrs' ? { x: -100, z: 100 } : await G(() => { const b = window.__life.world.bounds; return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }; });
  for (const [n, d, el] of [['overview', 2100, 52], ['overview2', 900, 38]]) {
    await snap(`detail-${prefix}${n}${sfx}.png`, (o) => window.__freeCam(o), { x: ov.x, z: ov.z, y: 0, dist: d, el, az: 200 });
  }
}
if (want('sheet') || (only === 'all' && !names.length)) {
  const cells = HEROES.filter((h) => (h.map || 'centrs') === MAP && h.ids.length && fs.existsSync(path.join(out, `${prefix}hero-${h.slug}-a${sfx}.png`)));
  const bl = BLOCK_IDS.map((_, n) => `${prefix}block-${n + 1}${sfx}.png`).filter((f) => fs.existsSync(path.join(out, f)));
  const cell = (f, label) => `<figure><img src="${pathToFileURL(path.join(out, f))}"><figcaption>${label}</figcaption></figure>`;
  const html = `<html><body style="margin:0;background:#1d2127;font:12px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(6,320px);gap:4px;padding:4px">${
    cells.map((h) => cell(`${prefix}hero-${h.slug}-a${sfx}.png`, h.slug + ' a') + cell(`${prefix}hero-${h.slug}-play${sfx}.png`, h.slug + ' play')).join('') + bl.map((f, i) => cell(f, 'block ' + (i + 1))).join('')
  }</div><style>figure{margin:0;position:relative}img{width:320px;height:200px;object-fit:cover;display:block}figcaption{position:absolute;left:4px;top:2px;text-shadow:0 0 3px #000}</style></body></html>`;
  const tmp = path.join(os.tmpdir(), 'hero-sheet.html');
  fs.writeFileSync(tmp, html);
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 1980, height: 1000 });
  await sp.goto(pathToFileURL(tmp).href);
  await sp.waitForTimeout(800);
  await sp.screenshot({ path: path.join(out, `${prefix}hero-sheet${sfx}.png`), fullPage: true });
  fs.rmSync(tmp, { force: true });
  console.log('sheet written');
}
await browser.close(); kill(); process.exit(0);
