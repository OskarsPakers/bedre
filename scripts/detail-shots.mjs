// Close-up / overview screenshots of the shaped buildings (scripts/out/detail-*.png).
//   PORT=5187 GPU=1 node scripts/detail-shots.mjs [name ...] [--quality=low]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5187;
const base = `http://localhost:${PORT}`;
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const quality = (process.argv.find((a) => a.startsWith('--quality=')) || '--quality=high').slice(10);
const sfx = quality === 'high' ? '' : '-' + quality;
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
await page.goto(`${base}/?quality=${quality}&intro=0&bots=0`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
const G = (fn, a) => page.evaluate(fn, a);
await G(() => { window.__game.start(); });
await page.waitForTimeout(2400);
await G(() => { { const f = window.__life.world.scene.fog; if (f) { f.near *= 4; f.far *= 4; } } window.__game.teleport(1150, 1150); window.__game.step(0.1); const hud = document.getElementById('hud'); document.body.classList.add('shots'); for (const id of ['hud', 'minimap-box', 'attrib', 'pause-btn', 'labels']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } });
// targets: [file, x, z | {bid}|{name}, dist, elevDeg, azimDeg, lookY, fov]
const T = {
  artmuseum: [{ bid: 49615452 }, 130, 35, 200, 10],
  nativity: [{ pt: [136.7, -271.6] }, 90, 16, 210, 18],
  oldgertrude: [{ bid: 49619142 }, 110, 25, 200, 14],
  newgertrude: [{ bid: 49622206 }, 110, 30, 200, 8],
  stpeter: [{ pt: [-242.7, 444.2] }, 330, 22, 200, 60],
  oldtown: [{ pt: [-380, 330] }, 700, 24, 200, 18],
  dome: [{ pt: [-517.7, 267.7] }, 170, 28, 160, 15],
  opera: [{ name: 'Nacionālā opera' }, 120, 28, 330, 10],
  castle: [{ name: 'Rīgas pils' }, 180, 30, 30, 8],
  nouveau: [{ bid: 49618813 }, 150, 26, 200, 10],
  market: [{ pt: [90, 870] }, 220, 30, 330, 6],
  academy: [{ bid: 49628422 }, 280, 25, 200, 40],
  hotel: [{ bid: 49619752 }, 230, 22, 200, 40],
  overview: [{ pt: [-100, 100] }, 2100, 52, 200, 0],
  overview2: [{ pt: [-100, 100] }, 900, 38, 200, 0],
};
const list = names.length ? names : Object.keys(T);
for (const n of list) {
  const [tg, dist, el, az, ly] = T[n];
  await G(([tg, dist, el, az, ly, n]) => {
    const w = window.__life.world;
    let x, z, y = ly;
    if (tg.pt) [x, z] = tg.pt;
    else if (tg.bid) { const it = w.buildingItems.find((i) => i.id === tg.bid); x = it.x; z = it.z; }
    else { const it = w.buildingItems.find((i) => i.name === tg.name); x = it.x; z = it.z; }
    window.__shotInfo = { x, z };
    const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
    const c = cm.camera, r = Math.PI / 180;
    c.position.set(x + dist * Math.cos(el * r) * Math.sin(az * r), y + dist * Math.sin(el * r), z + dist * Math.cos(el * r) * Math.cos(az * r));
    c.fov = 42; c.near = 1; c.far = 8000; c.lookAt(x, y, z); c.updateProjectionMatrix();
    if (dist > 500) window.__life.world.scene.fog = null;
    window.__game.render();
  }, [tg, dist, el, az, ly, n]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `detail-${n}${sfx}.png`) });
  console.log('shot', n, JSON.stringify(await G(() => ({ ...window.__shotInfo, calls: window.__life.renderer.info.render.calls, tris: window.__life.renderer.info.render.triangles }))));
}
await browser.close(); kill(); process.exit(0);
