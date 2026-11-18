// temp: frame-time measurement of a tram build (old: scripts/.dist-tram-before, new: scripts/.dist-tram) -- usage: node scripts/.tram-frames.mjs <dist dir> <label>
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
const [,, dist, label, route = ''] = process.argv;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', '5193', '--strictPort', '--host', 'localhost'], { cwd: process.cwd(), stdio: 'pipe' });
for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:5193/tramvajs/'); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 300)); }
const gpu = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const D = [['chromium-desktop', chromium, { viewport: { width: 1280, height: 720 } }, 1], ['chromium-pixel5-4x', chromium, devices['Pixel 5'], 4], ['webkit-iphone13', webkit, devices['iPhone 13'], 1]];
for (const [name, eng, ctxo, thr] of D) {
  const b = await eng.launch({ headless: true, args: eng === chromium ? gpu : [] }); const ctx = await b.newContext(ctxo); const p = await ctx.newPage();
  await p.goto('http://localhost:5193/tramvajs/' + route); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  const cdp = eng === chromium ? await ctx.newCDPSession(p) : null; if (cdp && thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
  await p.evaluate(() => { const t = window.__tram; t.start('full'); t.setAuto('perfect'); if (t.run) t.run.awaitBell = false; window.__ft = []; let last = performance.now(); const f = (n) => { window.__ft.push(n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.waitForTimeout(3000); await p.evaluate(() => { window.__ft.length = 0; }); await p.waitForTimeout(thr > 1 || eng === webkit ? 16000 : 12000);
  const r = await p.evaluate(() => { const a = window.__ft.slice(1).sort((x, y) => x - y), pc = (q) => a[Math.min(a.length - 1, Math.floor(a.length * q))]; const s = window.__tram.stats(); return { n: a.length, avg: a.reduce((x, y) => x + y, 0) / a.length, p50: pc(0.5), p95: pc(0.95), p99: pc(0.99), max: a[a.length - 1], o33: a.filter((v) => v > 33.4).length, o50: a.filter((v) => v > 50).length, calls: s.calls, tris: s.triangles, level: s.level }; });
  console.log(`${label} ${name}: ${r.n} frames, avg ${r.avg.toFixed(1)} ms (${(1000 / r.avg).toFixed(0)} fps), p50 ${r.p50.toFixed(1)}, p95 ${r.p95.toFixed(1)}, p99 ${r.p99.toFixed(1)}, max ${r.max.toFixed(0)} ms, >33ms ${r.o33}, >50ms ${r.o50}; ${r.calls} calls, ${(r.tris / 1e6).toFixed(2)} M tris, tier ${r.level}`);
  await b.close();
}
server.kill('SIGTERM'); process.exit(0);
