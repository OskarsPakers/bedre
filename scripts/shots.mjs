// Visual review shots of Rīga landmarks / Old Town / far zoom (no assertions). Writes scripts/out/<prefix>-<name>.png.
//   PORT=5184 GPU=1 node scripts/shots.mjs [prefix=shot] [name ...]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5184;
const base = `http://localhost:${PORT}`;
const [prefix = 'shot', ...only] = process.argv.slice(2);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);

async function main() {
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i > 80) throw new Error('no server\n' + log); await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?quality=high&intro=0&bots=0`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  await G(() => window.__game.start());
  await page.waitForTimeout(2500);
  const pos = await G(() => {
    const w = window.__life.world;
    const f = (pred) => { const o = w.objects.find(pred); return o ? [o.x, o.z] : null; };
    return {
      opera: f((o) => o.name === 'Nacionālā opera'), pylon: f((o) => o.kind === 'pylon'), arch: f((o) => o.kind === 'railarch'),
      castle: f((o) => o.name === 'Rīgas pils'), market: f((o) => o.name === 'Zivju paviljons'), cathedral: f((o) => /Piedzimšanas/.test(o.name || '')),
      heads: f((o) => o.name === 'Melngalvju nams'),
      counts: (() => { const c = {}; for (const o of w.objects) if (['parasol', 'cafeset', 'stall'].includes(o.kind)) c[o.kind] = (c[o.kind] || 0) + 1; return c; })(),
    };
  });
  console.log('positions', JSON.stringify(pos));
  const want = (n) => !only.length || only.includes(n);
  const save = async (name) => { await page.screenshot({ path: path.join(out, `${prefix}-${name}.png`) }); console.log('saved', `${prefix}-${name}.png`); };
  // free camera (hole parked far away so nothing gets eaten)
  const cam = async (name, p, l, fov = 42) => {
    if (!want(name)) return;
    await G(() => { window.__game.teleport(1150, 1150); window.__game.setRadius(2); });
    await G(([p, l, f]) => { const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {}; const c = cm.camera; c.position.set(...p); c.fov = f; c.near = 1; c.far = 6000; c.lookAt(...l); c.updateProjectionMatrix(); const L = window.__life.game.light; if (!L._upd) L._upd = L.update; const fd = Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]) * 0.8; L.update = () => L._upd.call(L, { x: l[0], z: l[2] }, fd); }, [p, l, fov]);
    await page.waitForTimeout(600);
    await save(name);
    await G(() => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; const L = window.__life.game.light; if (L._upd) L.update = L._upd; });
  };
  // gameplay camera: hole at (x,z), radius r, zoom multiplier
  const play = async (name, x, z, r, zoom = 1, wait = 1200) => {
    if (!want(name)) return;
    await G(([x, z, r, zoom]) => { const g = window.__game; g.zoomBy(zoom / g.cam.zoom); g.teleport(x, z); g.setRadius(r); }, [x, z, r, zoom]);
    await page.waitForTimeout(wait);
    await save(name);
  };
  const el = (d, deg = 57) => [Math.cos((deg * Math.PI) / 180) * d, Math.sin((deg * Math.PI) / 180) * d]; // [horizontal, vertical]
  if (pos.opera) {
    const [o0, o1] = pos.opera, fx = o0 - 14, fz = o1 - 44; // portico (NW end, facing Opera Square / Freedom Monument)
    const [hd, vd] = el(85);
    await cam('opera', [fx + 15, vd, fz - hd], [fx, 6, fz + 5], 42);            // 57° from Opera Square (north), portico side
    await cam('opera-low', [fx + 40, 16, fz - 55], [fx, 9, fz], 42);
    await play('opera-game', o0 + 10, o1 - 70, 3, 1.4);                         // default gameplay camera (from the south)
  }
  if (pos.pylon) {
    const [x, z] = pos.pylon;
    await cam('vansu', [x + 160, 90, z + 190], [x + 20, 35, z], 50);
    await cam('vansu-side', [x + 40, 30, z + 260], [x + 20, 40, z], 50);
    await play('vansu-game', x + 60, z + 20, 4, 2.6);
  }
  if (pos.arch) await cam('railbridge', [pos.arch[0] + 200, 90, pos.arch[1] + 130], [pos.arch[0], 5, pos.arch[1]], 50);
  if (pos.castle) await cam('castle', [pos.castle[0] + 50, 40, pos.castle[1] + 70], [pos.castle[0], 8, pos.castle[1]]);
  if (pos.market) await cam('market', [pos.market[0] + 120, 110, pos.market[1] + 190], [pos.market[0] + 30, 5, pos.market[1] - 40]);
  if (pos.cathedral) await cam('cathedral', [pos.cathedral[0] + 20, 38, pos.cathedral[1] + 95], [pos.cathedral[0], 22, pos.cathedral[1]]);
  // Old Town squares (Rātslaukums, Līvu laukums, Doma laukums) at gameplay-ish angles
  await cam('oldtown-terraces', [-440, 62, 234 + 58], [-452, 0, 226]);          // Doma laukums
  await cam('ratslaukums', [-345, 62, 520], [-358, 0, 462]);
  await cam('livu', [-316, 60, 200 + 50], [-316, 0, 190]);
  await cam('doma', [-455, 60, 234 + 50], [-455, 0, 224]);
  await play('oldtown-game', -330, 230, 2.2, 1.6);
  // far zoom: shadows faded out
  await play('widest-zoom', -250, 150, 30, 2.6, 2500);
  await play('mid-zoom', -250, 150, 12, 1.5, 2500);
  const perf = await G(async () => {
    const g = window.__game; g.zoomBy(1 / g.cam.zoom); g.teleport(-250, 150); g.setRadius(9);
    await new Promise((r) => setTimeout(r, 1500));
    window.__perf.frames = 0; window.__perf.ms = 0;
    await new Promise((r) => setTimeout(r, 4000));
    const a = window.__perf.ms / window.__perf.frames;
    g.zoomBy(2.6); g.setRadius(30);
    await new Promise((r) => setTimeout(r, 2000));
    window.__perf.frames = 0; window.__perf.ms = 0;
    await new Promise((r) => setTimeout(r, 4000));
    const b = window.__perf.ms / window.__perf.frames;
    return { midCpuMs: +a.toFixed(2), widestCpuMs: +b.toFixed(2), shadowFade: +window.__life.game.light.shadowFade.toFixed(2), calls: window.__life.renderer.info.render.calls };
  });
  console.log('perf', JSON.stringify(perf));
  if (errors.length) console.log('ERRORS', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { kill(); setTimeout(() => process.exit(), 300); });
