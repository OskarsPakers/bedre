// Sights review shots at NORMAL GAMEPLAY ZOOM (the steep follow camera at a medium hole size) + contact sheets + before/after pairs + wide overviews.
//   PORT=5185 GPU=1 node scripts/sights-shots.mjs --prefix=before-            (MAP=<slug> THEME=day|evening QUALITY=high|low  TIERS=AB|A  ONLY=key,key  LIMIT=n)
//     -> scripts/out/sights/<prefix><map>-<id>.png (one gameplay-zoom tile per sight) + tools/detail/data/ (nothing)
//   node scripts/sights-shots.mjs --sheet --prefix=after- [--out=sights-sheet-]   -> scripts/out/sights-sheet-<map>-{1..n}.png (12 tiles per sheet, name on each tile; marker = the sight)
//   node scripts/sights-shots.mjs --pairs --slugs=castle,blackheads ...            -> scripts/out/sights-before-after-<slug>.png (needs before- and after- tiles)
//   --overview  4 wide obliques (N/E/S/W) per map: scripts/out/sights-overview-<prefix><map>-{n,e,s,w}.png ; --sheet-overview composes before/after
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
const tiles = path.join(out, 'sights');
fs.mkdirSync(tiles, { recursive: true });
const MAP = process.env.MAP || 'centrs';
const PORT = process.env.PORT || 5185;
const base = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const prefix = opt('prefix', 'after-');
const theme = process.env.THEME || 'day', quality = process.env.QUALITY || 'high';
const sfx = (theme !== 'day' ? '-' + theme : '') + (quality !== 'high' ? '-' + quality : '');
const TIERS = process.env.TIERS || 'AB';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const S = JSON.parse(fs.readFileSync(path.join(root, 'tools/detail/data', `sights-${MAP}.json`), 'utf8'));
const sel = S.sights.filter((s) => TIERS.includes(s.tier) && (!only.length || only.includes(s.key) || only.includes(String(s.lead)))).slice(0, +(process.env.LIMIT || 9999));
const tileFile = (s, pre = prefix) => path.join(tiles, `${pre}${MAP}-${s.lead}${sfx}.png`);
const safe = (t) => String(t || '').replace(/[<>&]/g, '');

async function compose(htmlBody, file, w, h) {
  const browser = await chromium.launch({ headless: true });
  const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const tmp = path.join(out, `.tmp-${path.basename(file)}.html`);
  fs.writeFileSync(tmp, `<html><body style="margin:0;background:#1d2127;font:13px sans-serif;color:#fff"><style>
    .g{display:grid;gap:3px;padding:3px}figure{margin:0;position:relative;overflow:hidden}img{width:100%;display:block}
    figcaption{position:absolute;left:0;right:0;top:0;padding:2px 6px;background:rgba(0,0,0,.55);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .none{height:160px;background:#333;display:flex;align-items:center;justify-content:center}</style>${htmlBody}</body></html>`);
  await p.goto(pathToFileURL(tmp).href); await p.waitForTimeout(600);
  await p.screenshot({ path: file, fullPage: true });
  fs.rmSync(tmp); await browser.close();
}
const img = (f, cap) => (fs.existsSync(f) ? `<figure><img src="${pathToFileURL(f)}"><figcaption>${safe(cap)}</figcaption></figure>` : `<figure><div class=none>no ${path.basename(f)}</div></figure>`);

if (args.includes('--sheet')) {
  const name = opt('out', 'sights-sheet-');
  const N = 12, cols = 4;
  const list = sel.filter((s) => fs.existsSync(tileFile(s)));
  for (let k = 0; k * N < list.length; k++) {
    const part = list.slice(k * N, (k + 1) * N);
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(tiles, `meta-${prefix}${MAP}${sfx}.json`), 'utf8')); } catch { /* no markers */ }
    const mark = (s) => { const m = meta[s.lead]; return m ? `<svg style="position:absolute;left:calc(${(m.sx / 960) * 100}% - 9px);top:calc(${(m.sy / 600) * 100}% - 24px)" width=18 height=18><path d="M1 1 L17 1 L9 15 Z" fill="#ff2d55" stroke="#fff" stroke-width="1.4"/></svg>` : ''; };
    const body = `<div class=g style="grid-template-columns:repeat(${cols},1fr)">${part.map((s) => img(tileFile(s), `${s.tier} ${s.cat} | ${s.name || s.lead}`).replace('</figure>', mark(s) + '</figure>')).join('')}</div>`;
    await compose(body, path.join(out, `${name}${MAP}${sfx}-${k + 1}.png`), 1920, 1000);
  }
  console.log('sheets', Math.ceil(list.length / N), 'for', MAP);
  process.exit(0);
}
if (args.includes('--pairs')) {
  const slugs = opt('slugs', '').split(',').filter(Boolean);
  for (const s of S.sights.filter((q) => slugs.includes(q.key))) {
    const b = tileFile(s, 'before-'), a = tileFile(s, 'after-');
    if (!fs.existsSync(b) || !fs.existsSync(a)) continue;
    await compose(`<div class=g style="grid-template-columns:1fr 1fr">${img(b, 'before ' + s.name)}${img(a, 'after ' + s.name)}</div>`, path.join(out, `sights-before-after-${s.key}.png`), 1600, 520);
  }
  process.exit(0);
}
if (args.includes('--sheet-overview')) { // three columns: before the sights pass (?sights=0) | over-coloured first version | toned-down (current)
  const body = ['n', 'e', 's', 'w'].map((d) => img(path.join(out, `sights-overview-before-${MAP}-${d}.png`), 'before ' + d) + img(path.join(out, `sights-overview-over-${MAP}-${d}.png`), 'over-coloured ' + d) + img(path.join(out, `sights-overview-after-${MAP}-${d}.png`), 'toned down ' + d)).join('');
  await compose(`<div class=g style="grid-template-columns:1fr 1fr 1fr">${body}</div>`, path.join(out, `sights-overview-${MAP}.png`), 2400, 1000);
  process.exit(0);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
await page.goto(`${base}/?sights=${process.env.SIGHTS || 1}&quality=${quality}&intro=0&bots=0&placements=generate&theme=${theme}${MAP === 'centrs' ? '' : '&map=' + MAP}`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
await page.evaluate(() => { window.__game.start(); });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  document.body.classList.add('shots');
  const st = document.createElement('style'); st.dataset.shots = '1'; st.textContent = 'body > *:not(canvas):not(script){display:none !important}'; document.head.appendChild(st);
  window.__freeCam = (o) => {
    const w = window.__life.world, cm = window.__life.game.cam;
    if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
    const c = cm.camera, r = Math.PI / 180;
    c.position.set(o.x + o.dist * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.dist * Math.sin(o.el * r), o.z + o.dist * Math.cos(o.el * r) * Math.cos(o.az * r));
    c.fov = o.fov || 42; c.near = 1; c.far = 9000; c.lookAt(o.x, o.y, o.z); c.updateProjectionMatrix();
    const f = w.scene.fog; if (f && !w.__fog0) w.__fog0 = [f.near, f.far];
    if (f) { f.near = w.__fog0[0] * 6; f.far = w.__fog0[1] * 6; }
    if (o.nofog) w.scene.fog = null;
    window.__game.render();
  };
  window.__release = () => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; };
  // gameplay tile: hole of radius r just south of the sight, so the building stands in the upper half of the frame; returns the screen position of the sight
  window.__tile = (o) => {
    window.__release();
    const g = window.__game;
    g.teleport(o.x, o.z + o.off); g.setRadius(o.r); g.step(0.7);
    const cam = window.__life.game.cam.camera, V = cam.position.clone().set(o.x, o.h * 0.6, o.z).project(cam);
    return { sx: (V.x * 0.5 + 0.5) * innerWidth, sy: (1 - (V.y * 0.5 + 0.5)) * innerHeight };
  };
  window.__info = (id) => { const it = window.__life.world.buildingItems.find((i) => i.id === id); return it ? { x: it.x, z: it.z, h: it.h, area: it.area, fit: it.fit } : null; };
});
const snap = async (file) => { await page.waitForTimeout(350); await page.screenshot({ path: file }); };
const MARK = `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><path d='M2 2 L20 2 L11 18 Z' fill='#ff2d55' stroke='white' stroke-width='1.5'/></svg>`;
void MARK;
if (args.includes('--overview')) {
  const b = (await page.evaluate(() => window.__life.world.data.meta.bounds));
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  for (const [d, az] of [['n', 180], ['e', 270], ['s', 0], ['w', 90]]) {
    await page.evaluate((o) => window.__freeCam(o), { x: cx, z: cz, y: 0, dist: ext * 0.33, el: 40, az, fov: 42, nofog: 1 });
    await snap(path.join(out, `sights-overview-${prefix.replace(/-?$/, '-')}${MAP}-${d}${sfx}.png`));
  }
  await browser.close(); kill(); process.exit(0);
}
const meta = {};
for (const s of sel) {
  const info = await page.evaluate((id) => window.__info(id), s.lead);
  if (!info) { console.log('not in this build:', s.lead, s.name); continue; }
  const rad = Math.sqrt(info.area / Math.PI);
  if (args.includes('--close')) { // free camera, one oblique view (az 35) per sight: for judging the details
    const dist = Math.max(60, rad * 3.4 + info.h * 0.9);
    await page.evaluate((o) => window.__freeCam(o), { x: info.x, z: info.z, y: Math.min(info.h * 0.4, 28), dist, el: 30, az: Number(opt('az', 35)) });
    await snap(path.join(tiles, `close-${prefix}${MAP}-${s.lead}${sfx}.png`));
    continue;
  }
  const r = Math.max(7, Math.min(16, rad * 0.45)); // medium hole for the sight's size
  const pos = await page.evaluate((o) => window.__tile(o), { x: info.x, z: info.z, h: info.h, r, off: rad * 0.9 + r * 2 + 4 });
  await snap(tileFile(s));
  meta[s.lead] = pos;
}
fs.writeFileSync(path.join(tiles, `meta-${prefix}${MAP}${sfx}.json`), JSON.stringify(meta));
console.log('tiles', Object.keys(meta).length, 'for', MAP, sfx || '(day, high)');
await browser.close(); kill(); process.exit(0);
