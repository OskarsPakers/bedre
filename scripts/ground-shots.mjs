// Ground-surface review shots (no assertions): scripts/out/ground-<name>.png
//   PORT=5183 GPU=1 node scripts/ground-shots.mjs [prefix=ground] [name ...]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5183;
const base = `http://localhost:${PORT}`;
const [prefix = 'ground', ...only] = process.argv.slice(2);
const MAPSLUG = process.env.MAP || 'centrs';
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
const want = (n) => !only.length || only.includes(n);

async function main() {
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i > 80) throw new Error('no server\n' + log); await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const errors = [];
  const mk = async (w, h, url, touch = false) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    return page;
  };
  const page = await mk(1280, 720, `${base}/?quality=high&intro=0&bots=0&theme=day&autostart=1&map=${MAPSLUG}`);
  const G = (fn, arg) => page.evaluate(fn, arg);
  await G(() => window.__game.start());
  await page.waitForTimeout(2500);
  const save = async (name, pg = page) => { await pg.screenshot({ path: path.join(out, `${prefix}-${name}.png`) }); console.log('saved', `${prefix}-${name}.png`); };
  const cam = async (name, p, l, fov = 42) => {
    if (!want(name)) return;
    await G(() => { window.__game.teleport(1150, 1450); window.__game.setRadius(2); });
    await G(([p, l, f]) => { const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {}; const c = cm.camera; c.position.set(...p); c.fov = f; c.near = 1; c.far = 9000; c.lookAt(...l); c.updateProjectionMatrix(); const L = window.__life.game.light; if (!L._upd) L._upd = L.update; const fd = Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]) * 0.8; L.update = () => L._upd.call(L, { x: l[0], z: l[2] }, fd); const D = window.__life.world.ground.userData.detail; D.update(l[0], l[2], Math.min(60, fd)); }, [p, l, fov]);
    await page.waitForTimeout(900);
    await save(name);
    await G(() => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; const L = window.__life.game.light; if (L._upd) L.update = L._upd; });
  };
  const top = (name, x, z, h) => cam(name, [x, h, z + 0.01], [x, 0, z], 42);
  const tilt = (name, x, z, d, deg = 57) => cam(name, [x, Math.sin((deg * Math.PI) / 180) * d, z + Math.cos((deg * Math.PI) / 180) * d], [x, 0, z], 42);
  const play = async (name, x, z, r, zoom = 1, wait = 1200) => {
    if (!want(name)) return;
    await G(([x, z, r, zoom]) => { const g = window.__game; g.zoomBy(zoom / g.cam.zoom); g.teleport(x, z); g.setRadius(r); }, [x, z, r, zoom]);
    await page.waitForTimeout(wait);
    await save(name);
  };
  const info = await G(() => { const w = window.__life.world; return { bounds: w.bounds, ground: w.ground.userData.stats, objects: w.objects.length, tris: window.__life.renderer.info.render.triangles }; });
  console.log('info', JSON.stringify(info));
  // spots for the path/carriageway audit (MAP=centrs unless noted; coordinates in local metres)
  if (MAPSLUG === 'centrs') {
    await top('pf-freedom-top', -2, 20, 120);
    await top('pf-freedom-wide', 0, 0, 300);
    await tilt('pf-freedom-tilt', 0, 10, 110);
    await play('pf-freedom-small', 20, -10, 2.5, 1);
    await play('pf-freedom-large', 20, -10, 14, 1);
    await top('pf-esplanade-w', 190, -330, 150);
    await top('pf-bastejkalns', -150, 120, 150);
    await top('pf-krastmala', -735, 330, 120);
    await top('pf-station', 650, 590, 160);
    await top('pf-market', 90, 850, 160);
    await top('pf-vansu', -1020, 90, 170);
    await top('pf-akmens', -740, 770, 170);
    await top('pf-oldtown', -430, 230, 110);
    await top('pf-zebra', 489, -538, 45);
  } else if (process.env.SPOTS) {
    for (const s of process.env.SPOTS.split(';')) { const [n, x, z, h] = s.split(','); await top('pf-' + MAPSLUG + '-' + n, +x, +z, +h); }
  }
  // Freedom Monument plaza
  await top('freedom-top', -2, 20, 120);
  await tilt('freedom-tilt', -2, 20, 110);
  await play('freedom-game', -2, 40, 3, 1);
  await top('bastejkalns', -190, 90, 210);
  await top('esplanade', 110, -300, 230);
  await top('vermanes', 322, -367, 200);
  await tilt('street', 490, -538, 60);
  await play('street-close', 489, -548, 2.2, 1.0);
  await play('crossing-close', 489, -538, 2.2, 0.6);
  await play('crossing-game', 489, -520, 3.5, 1.0);
  await top('doma', -455, 224, 100);
  await top('ratslaukums', -358, 462, 100);
  await top('livu', -316, 190, 100);
  await tilt('promenade', -735, 330, 110);
  await play('promenade-game', -735, 330, 3, 1.1);
  await top('market', 90, 850, 230);
  await top('railyard', 850, 560, 240);
  await top('kronvalda', -380, -150, 230);
  await tilt('library', -1005, 1162, 220);
  await top('library-top', -1005, 1162, 170);
  await tilt('vansu', -1120, 60, 170);
  await play('vansu-game', -1100, 40, 4, 1.4);
  await tilt('akmens', -740, 770, 220);
  await tilt('railbridge', -420, 1040, 200);
  await top('kipsala', -1750, 380, 300);
  await tilt('saules', -1629, 384, 170);
  await play('library-game', -1005, 1115, 3, 1.2);
  await play('market-game', 90, 850, 4, 1.2);
  await play('railyard-game', 850, 560, 4, 1.2);
  await top('overview-top', -450, 150, 2900);
  if (want('minimap')) {
    await G(() => { window.__game.teleport(-300, 300); window.__game.setRadius(12); });
    await page.waitForTimeout(800);
    await (await page.$('#minimap-box')).screenshot({ path: path.join(out, `${prefix}-minimap.png`) });
    console.log('saved', `${prefix}-minimap.png`);
  }
  if (want('intro')) {
    const p = await mk(1280, 720, `${base}/?quality=high&bots=7&theme=day&autostart=1&introhold=8`);
    await p.waitForTimeout(3000);
    await save('intro-overview', p);
    await p.close();
  }
  if (want('mobile')) {
    const p = await mk(390, 780, `${base}/?quality=medium&bots=7&theme=day&autostart=1&introhold=8`, true);
    await p.waitForTimeout(3000);
    await save('mobile-overview', p);
    await p.waitForTimeout(12000);
    await save('mobile-play', p);
    await p.close();
  }
  if (errors.length) console.log('ERRORS', errors.slice(0, 8));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { kill(); setTimeout(() => process.exit(), 300); });
