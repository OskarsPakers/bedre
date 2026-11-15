// Quick perf/geometry probe: world build time, draw calls, triangles, cpu ms/frame. PORT=5186 GPU=1 node scripts/measure.mjs [--sample] [--quality=low]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5186;
const base = `http://localhost:${PORT}`;
const q = process.argv.filter((a) => a.startsWith('--') ).map((a) => a.slice(2)).map((a) => (a === 'sample' ? 'sample=1' : a)).join('&');
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?${q.includes('quality') ? '' : 'quality=high&'}intro=0&bots=0&${q}`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
const G = (fn, a) => page.evaluate(fn, a);
await G(() => { const g = window.__game; g.start(); g.teleport(-250, 150); g.setRadius(9); g.step(0.5); });
await G(() => { window.__perf.frames = 0; window.__perf.ms = 0; });
await page.waitForTimeout(5000);
const r = await G(() => { const i = window.__life.renderer.info.render; return { f: window.__perf.frames, ms: window.__perf.ms, calls: i.calls, tris: i.triangles, timing: window.__timing, shaped: window.__life.world.shapeStats }; });
console.log(JSON.stringify({ cpuMs: +(r.ms / r.f).toFixed(2), frames: r.f, calls: r.calls, tris: r.tris, timing: r.timing, shaped: r.shaped }));
await browser.close(); kill(); process.exit(0);
