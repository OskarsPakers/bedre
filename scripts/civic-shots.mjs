// Review shots for the civic landmarks (tools/detail/heroes-civic.mjs CIVIC_SHOTS).
//   PORT=5186 GPU=1 node scripts/civic-shots.mjs [slug ...] --prefix=civic-before-        (THEME=day|evening|night, MAP=<slug>)
//   node scripts/civic-shots.mjs --compose [slug ...]      -> scripts/out/civic-before-after-<slug>.png + civic-sheet.png (needs civic-before-* and civic-after-* shots)
//   --extra=station   station-only views (square at gameplay zoom, top-down)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CIVIC_SHOTS } from '../tools/detail/heroes-civic.mjs';
const MAP = process.env.MAP || 'centrs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5186;
const base = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const prefix = opt('prefix', 'civic-after-');
const extra = opt('extra', '');
const targets = CIVIC_SHOTS.filter((h) => (h.map || 'centrs') === (process.env.ALLMAPS ? (h.map || 'centrs') : MAP)).filter((h) => !names.length || names.includes(h.slug));

if (args.includes('--compose')) {
  const slugs = (names.length ? names : CIVIC_SHOTS.map((h) => h.slug));
  const ex = (f) => fs.existsSync(path.join(out, f));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1980, height: 1000 } });
  const img = (f, l) => (ex(f) ? `<figure><img src="${pathToFileURL(path.join(out, f))}"><figcaption>${l}</figcaption></figure>` : `<figure><div class=none>no ${f}</div></figure>`);
  const css = `<style>body{margin:0;background:#1d2127;font:13px sans-serif;color:#fff}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:6px;top:3px;text-shadow:0 0 3px #000}.none{height:150px;background:#333}.g{display:grid;gap:3px;padding:3px}</style>`;
  const done = [];
  for (const s of slugs) {
    const hasB = ex(`civic-before-${s}-a.png`), hasA = ex(`civic-after-${s}-a.png`);
    if (!hasB && !hasA) continue;
    const row = (p) => ['a', 'b', 'play'].map((k) => img(`${p}${s}-${k}.png`, `${p.replace('civic-', '').replace('-', '')} ${s} ${k}`)).join('');
    const html = `<html><body>${css}<div class=g style="grid-template-columns:repeat(3,1fr)">${row('civic-before-')}${row('civic-after-')}</div></body></html>`;
    const p = await ctx.newPage(); await p.setViewportSize({ width: 1980, height: 1000 });
    const tmp = path.join(out, `.tmp-${s}.html`); fs.writeFileSync(tmp, html);
    await p.goto(pathToFileURL(tmp).href); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(out, `civic-before-after-${s}.png`), fullPage: true });
    fs.rmSync(tmp); await p.close(); done.push(s);
  }
  const cells = done.filter((s) => ex(`civic-after-${s}-a.png`)).map((s) => img(`civic-before-${s}-a.png`, 'before ' + s) + img(`civic-after-${s}-a.png`, 'after ' + s)).join('');
  const p = await ctx.newPage(); await p.setViewportSize({ width: 1980, height: 1000 });
  const tmp = path.join(out, '.tmp-sheet.html'); fs.writeFileSync(tmp, `<html><body>${css}<div class=g style="grid-template-columns:repeat(6,1fr)">${cells}</div></body></html>`);
  await p.goto(pathToFileURL(tmp).href); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(out, 'civic-sheet.png'), fullPage: true });
  fs.rmSync(tmp);
  console.log('composed', done.join(','));
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
  await page.goto(`${base}/?quality=high&intro=0&bots=0&placements=generate&theme=${process.env.THEME || 'day'}${MAP === 'centrs' ? '' : '&map=' + MAP}`);
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
      if (o.dist > 240) w.scene.fog = null;
      window.__game.render();
    };
    window.__release = () => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; };
    window.__heroInfo = (t) => {
      const w = window.__life.world;
      if (t.pt) return { x: t.pt[0], z: t.pt[1], h: 20, rad: 60, area: 1 };
      if (t.kind) { const o = w.objects.find((q) => q.kind === t.kind); return o ? { x: o.x, z: o.z, h: o.h || 20, rad: 10, area: 1 } : null; }
      const its = t.ids.map((id) => w.buildingItems.find((i) => i.id === id)).filter(Boolean);
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
const snap = async (file, setup, arg) => {
  for (let t = 0; t < 5; t++) {
    await G(setup, arg);
    await page.waitForTimeout(450);
    if (await page.evaluate(() => !!document.querySelector('style[data-shots]') && typeof window.__freeCam === 'function')) { await page.screenshot({ path: path.join(out, file) }); await log(file); return; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('could not get a stable page for ' + file);
};
const play = (file, info, r) => snap(file, (o) => { window.__release(); const g = window.__game; g.teleport(o.x, o.z); g.setRadius(o.r); g.step(0.8); }, { x: info.x, z: info.z, r });
const sfx = process.env.THEME && process.env.THEME !== 'day' ? '-' + process.env.THEME : '';
if (!extra) {
  for (const h of targets) {
    const info = await G((t) => window.__heroInfo(t), h);
    if (!info) { console.log('not in this build:', h.slug); continue; }
    const dist = h.dist || Math.max(65, info.rad * 3.3 + info.h * 0.8), el = h.el ?? 30, y = h.y ?? Math.min(info.h * 0.4, 30);
    for (const [k, az] of [['a', h.a ?? 35], ['b', h.b ?? 215]]) await snap(`${prefix}${h.slug}-${k}${sfx}.png`, (o) => window.__freeCam(o), { x: info.x, z: info.z, y, dist, el, az });
    await play(`${prefix}${h.slug}-play${sfx}.png`, info, h.r || Math.max(10, Math.min(24, info.rad * 0.5)));
  }
}
if (extra === 'station') {
  const st = CIVIC_SHOTS.find((h) => h.slug === 'station');
  const c = { x: st.pt[0], z: st.pt[1] };
  // top-down, hall + tower + canopies
  await snap(`${prefix}station-top${sfx}.png`, (o) => window.__freeCam(o), { ...c, y: 0, dist: 520, el: 88, az: 0 });
  await snap(`${prefix}station-top2${sfx}.png`, (o) => window.__freeCam(o), { ...c, y: 0, dist: 260, el: 80, az: 10 });
  // from the square at gameplay zoom (front of the station); square = west of the hall
  for (const [k, p] of [['square', [Number(opt('sx', 300)), Number(opt('sz', 520))]]]) await play(`${prefix}station-${k}${sfx}.png`, { x: p[0], z: p[1] }, 14);
  await snap(`${prefix}station-front${sfx}.png`, (o) => window.__freeCam(o), { x: c.x, z: c.z, y: 14, dist: 190, el: 14, az: Number(opt('az', 270)) });
}
await browser.close(); kill(); process.exit(0);
