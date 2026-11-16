// Church review shots.  PORT=5185 GPU=1 node scripts/church-shots.mjs [slug ...] --prefix=church-before-   (MAP=<slug>, THEME=day|evening)
//   per church: <prefix><slug>-{a,b,play}.png ; --compose=<beforePrefix>,<afterPrefix> builds scripts/out/church-before-after-<slug>.png (+ --sheet)
//   --skyline : old-town skyline from the Daugava side (church-skyline-<theme>.png)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHURCH_LIST } from '../tools/detail/heroes-churches.mjs';
const MAP = process.env.MAP || 'centrs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
const PORT = process.env.PORT || 5185;
const base = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const prefix = opt('prefix', 'church-after-');
const list = CHURCH_LIST.filter((c) => (c.map || 'centrs') === MAP && (!names.length || names.includes(c.slug)));

if (args.some((a) => a.startsWith('--compose'))) { // html composites, no game needed
  const [pb, pa] = opt('compose', 'church-before-,church-after-').split(',');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const all = CHURCH_LIST.filter((c) => !names.length || names.includes(c.slug));
  const img = (f) => `<img src="${pathToFileURL(path.join(out, f))}">`;
  for (const c of all) {
    const fs_ = ['a', 'b', 'play'].map((k) => [`${pb}${c.slug}-${k}.png`, `${pa}${c.slug}-${k}.png`]);
    if (!fs_.every(([x, y]) => fs.existsSync(path.join(out, x)) && fs.existsSync(path.join(out, y)))) continue;
    const html = `<html><body style="margin:0;background:#1d2127;font:13px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:640px 640px;gap:3px;padding:3px">${fs_.map(([x, y]) => `<figure>${img(x)}<figcaption>before</figcaption></figure><figure>${img(y)}<figcaption>after</figcaption></figure>`).join('')}</div><div style="padding:3px 8px">${c.name} (${c.slug})</div><style>figure{margin:0;position:relative}img{width:640px;height:400px;object-fit:cover;display:block}figcaption{position:absolute;left:4px;top:2px;text-shadow:0 0 3px #000}</style></body></html>`;
    const tmp = path.join(os.tmpdir(), `cba-${c.slug}.html`); fs.writeFileSync(tmp, html);
    const sp = await ctx.newPage(); await sp.setViewportSize({ width: 1290, height: 1240 });
    await sp.goto(pathToFileURL(tmp).href); await sp.waitForTimeout(500);
    await sp.screenshot({ path: path.join(out, `church-before-after-${c.slug}.png`), fullPage: true }); await sp.close();
  }
  if (args.includes('--sheet')) {
    const have = all.filter((c) => fs.existsSync(path.join(out, `${pa}${c.slug}-a.png`)));
    const cell = (c) => `<figure>${img(`${pa}${c.slug}-a.png`)}<figcaption>${c.slug}</figcaption></figure><figure>${img(`${pa}${c.slug}-play.png`)}<figcaption>${c.slug} play</figcaption></figure>`;
    const html = `<html><body style="margin:0;background:#1d2127;font:12px sans-serif;color:#fff"><div style="display:grid;grid-template-columns:repeat(8,240px);gap:3px;padding:3px">${have.map(cell).join('')}</div><style>figure{margin:0;position:relative}img{width:240px;height:150px;object-fit:cover;display:block}figcaption{position:absolute;left:4px;top:2px;text-shadow:0 0 3px #000}</style></body></html>`;
    const tmp = path.join(os.tmpdir(), 'church-sheet.html'); fs.writeFileSync(tmp, html);
    const sp = await ctx.newPage(); await sp.setViewportSize({ width: 1980, height: 1000 });
    await sp.goto(pathToFileURL(tmp).href); await sp.waitForTimeout(800);
    await sp.screenshot({ path: path.join(out, 'church-sheet.png'), fullPage: true });
  }
  await browser.close(); process.exit(0);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
async function boot() {
  await page.goto(`${base}/?quality=high&intro=0&bots=0&theme=${process.env.THEME || 'day'}${MAP === 'centrs' ? '' : '&map=' + MAP}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  await page.evaluate(() => { window.__game.start(); });
  await page.waitForTimeout(2400);
  await page.evaluate(() => { document.body.classList.add('shots'); const st = document.createElement('style'); st.dataset.shots = '1'; st.textContent = 'body > *:not(canvas):not(script){display:none !important}'; document.head.appendChild(st); });
  await page.evaluate(() => {
    window.__freeCam = (o) => {
      const w = window.__life.world;
      const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
      const c = cm.camera, r = Math.PI / 180;
      c.position.set(o.x + o.dist * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.dist * Math.sin(o.el * r), o.z + o.dist * Math.cos(o.el * r) * Math.cos(o.az * r));
      c.fov = o.fov || 42; c.near = 1; c.far = 8000; c.lookAt(o.x, o.y, o.z); c.updateProjectionMatrix();
      const f = w.scene.fog; if (f && !w.__fog0) w.__fog0 = [f.near, f.far];
      if (f) { f.near = (w.__fog0?.[0] || f.near) * 4; f.far = (w.__fog0?.[1] || f.far) * 4; }
      if (o.dist > 500) w.scene.fog = null;
      window.__game.render();
    };
    window.__release = () => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; };
    window.__heroInfo = (ids) => {
      const w = window.__life.world;
      const its = ids.map((id) => w.buildingItems.find((i) => i.id === id)).filter(Boolean);
      if (!its.length) return null;
      let sa = 0, cx = 0, cz = 0, hm = 0;
      for (const i of its) { sa += i.area; cx += i.x * i.area; cz += i.z * i.area; hm = Math.max(hm, i.h); }
      cx /= sa; cz /= sa;
      let rad = 0;
      for (const i of its) rad = Math.max(rad, Math.hypot(i.x - cx, i.z - cz) + Math.sqrt(i.area / Math.PI));
      const it = its[0];
      return { x: cx, z: cz, h: hm, rad, area: sa, value: it.value, fit: it.fit, cornerH: it.cornerH ? Array.from(it.cornerH).map((v) => +v.toFixed(1)) : null };
    };
  });
}
const G = async (fn, a) => {
  for (let t = 0; t < 4; t++) {
    try { if (!(await page.evaluate(() => typeof window.__freeCam === 'function'))) await boot(); return await page.evaluate(fn, a); } catch (e) { if (t === 3) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
};
await boot();
const snap = async (file, setup, arg) => {
  for (let t = 0; t < 5; t++) {
    await G(setup, arg);
    await page.waitForTimeout(450);
    if (await page.evaluate(() => !!document.querySelector('style[data-shots]') && typeof window.__freeCam === 'function')) { await page.screenshot({ path: path.join(out, file) }); return; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('could not get a stable page for ' + file);
};
if (args.includes('--skyline')) {
  // old-town skyline from the Daugava (west bank, looking east): Peter (-243,444) Dome (-518,268) Jacob (-521,76)
  const sfx = process.env.THEME || 'day';
  for (const [nm, o] of [['', { x: -420, z: 270, y: 45, dist: 620, el: 6, az: 255, fov: 38 }], ['-wide', { x: -380, z: 260, y: 40, dist: 900, el: 9, az: 245, fov: 42 }], ['-air', { x: -380, z: 260, y: 30, dist: 520, el: 24, az: 235, fov: 42 }]])
    await snap(`church-skyline${nm}-${sfx}.png`, (a) => window.__freeCam(a), o);
  await browser.close(); kill(); process.exit(0);
}
const info = {};
for (const c of list) {
  const inf = await G((ids) => window.__heroInfo(ids), c.ids);
  if (!inf) { console.log('not in build:', c.slug); continue; }
  info[c.slug] = inf;
  const dist = Math.max(60, inf.rad * 3.0 + inf.h * 0.8), el = 30, y = Math.min(inf.h * 0.4, 30);
  for (const [k, az] of [['a', 35], ['b', 215]]) await snap(`${prefix}${c.slug}-${k}.png`, (o) => window.__freeCam(o), { x: inf.x, z: inf.z, y, dist, el, az });
  await snap(`${prefix}${c.slug}-play.png`, (o) => { window.__release(); const g = window.__game; g.teleport(o.x, o.z); g.setRadius(o.r); g.step(0.8); }, { x: inf.x, z: inf.z, r: Math.max(10, Math.min(24, inf.rad * 0.5)) });
  console.log('shot', c.slug, JSON.stringify({ h: +inf.h.toFixed(1), v: inf.value, fit: +inf.fit.toFixed(1) }));
}
fs.writeFileSync(path.join(out, `${prefix.replace(/-$/, '')}-${MAP}-info.json`), JSON.stringify(info, null, 1));
await browser.close(); kill(); process.exit(0);
