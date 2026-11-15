// District review shots: scripts/out/district-<slug>-{overview,play-small,play-large,landmark}.png + start screens.
//   PORT=5183 GPU=1 node scripts/district-shots.mjs [slug ...]      (default: all maps)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS } from '../tools/maps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5183;
const base = `http://localhost:${PORT}`;
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : MAPS.map((m) => m.slug);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);

async function main() {
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i > 80) throw new Error('no server\n' + log); await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] });
  const errors = [];
  const open = async (url, w = 1280, h = 720, touch = false) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/502|404/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    return page;
  };
  for (const slug of slugs) {
    const q = `map=${slug}&quality=high&bots=7&theme=day`;
    // start screen (desktop + mobile)
    let p = await open(`${base}/?${q}`); await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(out, `district-${slug}-start.png`) }); await p.close();
    p = await open(`${base}/?${q}`, 390, 780, true); await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(out, `district-${slug}-start-mobile.png`) }); await p.close();
    // overview (intro hold)
    p = await open(`${base}/?${q}&autostart=1&introhold=8`);
    await p.waitForTimeout(3000);
    await p.screenshot({ path: path.join(out, `district-${slug}-overview.png`) });
    const info = await p.evaluate(() => { const w = window.__life.world; return { b: w.bounds, n: w.data.buildings.length, lm: w.data.landmarks.length, spawn: window.__game.spawn, timing: window.__timing, g: w.ground.userData.stats, lms: w.data.landmarks.slice().sort((a, b) => b.h - a.h).slice(0, 3) }; });
    console.log(slug, JSON.stringify(info));
    await p.close();
    p = await open(`${base}/?${q}&autostart=1&intro=0`);
    await p.waitForTimeout(1500);
    const G = (fn, a) => p.evaluate(fn, a);
    await p.screenshot({ path: path.join(out, `district-${slug}-play-small.png`) });
    await G(() => { const g = window.__game; g.setRadius(30); });
    await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(out, `district-${slug}-play-large.png`) });
    const lm = info.lms[0];
    await G(([x, z]) => { const g = window.__game; g.setRadius(3); g.teleport(x, z + 25); }, [lm.x, lm.z]);
    await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(out, `district-${slug}-landmark.png`) });
    await p.close();
  }
  if (errors.length) console.log('ERRORS', errors.slice(0, 10));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { kill(); setTimeout(() => process.exit(), 300); });
