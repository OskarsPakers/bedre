// Performance matrix: map x quality tier (+ phone profiles). Builds a private copy (scripts/.dist-perf), serves it, and for each
// combination boots the game, starts a round at gameplay zoom and reports draw calls, triangles, cpu ms/frame, texture memory and
// (optionally) the triangle share of trees / props / buildings.
//   PERF_PORT=5189 GPU=1 node scripts/perf-matrix.mjs [--maps centrs,purvciems] [--tiers low,medium,high] [--phones] [--breakdown] [--throttle] [--no-build]
// --phones   also runs emulated iPhone 13 (auto tier) and a low-end Android (Pixel 5 profile, 4x CPU throttle, ?quality=low)
// --throttle [--rates 4,6,12] checks that the quality scaler steps down under CDP CPU throttling and never oscillates (prints the tier history)
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { MAP_SLUGS } from '../tools/maps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PERF_PORT || 5189);
const base = `http://localhost:${PORT}`;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const maps = (arg('--maps', MAP_SLUGS.join(',')) || '').split(',').filter((m) => MAP_SLUGS.includes(m));
const tiers = (arg('--tiers', 'low,medium,high') || '').split(',');
const dist = path.join(root, 'scripts', '.dist-perf');
if (!has('--no-build')) await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 } });
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
const kill = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function probe({ map, quality, ctxOpts, throttle = 1, breakdown = false }) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const t0 = Date.now();
  await page.goto(`${base}/?map=${map}${quality ? '&quality=' + quality : ''}&intro=0&bots=0&radio=0`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  const bootMs = Date.now() - t0;
  const out = { map, quality: quality || 'auto', throttle, bootMs, errs };
  await page.evaluate(() => { const g = window.__game; g.start(); g.skipIntro(); });
  const sample = async (radius) => {
    await page.evaluate((r) => { const g = window.__game; g.setRadius(r); g.step(0.3); window.__perf.frames = 0; window.__perf.ms = 0; }, radius);
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
      const L = window.__life, i = L.renderer.info;
      let calls = 0, tris = 0; const frames = 8;
      return new Promise((res) => {
        const vals = [];
        const tick = () => { vals.push([i.render.calls, i.render.triangles]); if (vals.length < frames) requestAnimationFrame(tick); else { vals.sort((a, b) => a[1] - b[1]); const m = vals[frames >> 1]; res({ calls: m[0], tris: m[1], cpu: window.__perf.ms / Math.max(1, window.__perf.frames), frames: window.__perf.frames, level: L.quality ? L.quality.name : null, tex: i.memory.textures, geo: i.memory.geometries }); } };
        requestAnimationFrame(tick);
      });
    });
  };
  out.r9 = await sample(9);
  out.r30 = await sample(30);
  out.r60 = await sample(60);   // wide camera: the worst case for visible instances
  out.ground = await page.evaluate(() => { const w = window.__life.world; const g = w.ground && w.ground.userData && w.ground.userData.stats; return g ? { texMB: g.texMB, detailMB: g.detailMB, tiles: g.tiles } : null; });
  if (breakdown) {
    out.breakdown = await page.evaluate(async () => {
      const L = window.__life, w = L.world, i = L.renderer.info;
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(i.render.triangles))));
      const base = await frame();
      const part = async (list, name, res) => { const v = list.map((m) => m.visible); list.forEach((m) => { m.visible = false; }); res[name] = base - (await frame()); list.forEach((m, k) => { m.visible = v[k]; }); };
      const res = { total: base };
      await part(w.treeMeshes || [], 'trees', res);
      await part((w.propMeshes || []).filter((m) => !(w.treeMeshes || []).includes(m)), 'props', res);
      if (w.buildingMesh) await part([w.buildingMesh], 'buildings', res);
      return res;
    });
  }
  out.instances = await page.evaluate(() => { const w = window.__life.world; const n = (l) => (l || []).reduce((a, m) => a + (m.count || 0), 0); return { objects: w.objects.length, trees: n(w.treeMeshes), props: n(w.propMeshes) }; });
  out.history = await page.evaluate(() => (window.__life.quality ? window.__life.quality.history : null));
  await ctx.close();
  return out;
}

const rows = [];
const fmt = (r) => `${r.map.padEnd(10)} ${String(r.quality).padEnd(7)} x${r.throttle}  r9: ${(r.r9.tris / 1e6).toFixed(2)}M tris ${String(r.r9.calls).padStart(4)} calls cpu ${r.r9.cpu.toFixed(1)}ms | r30: ${(r.r30.tris / 1e6).toFixed(2)}M ${String(r.r30.calls).padStart(4)} cpu ${r.r30.cpu.toFixed(1)}ms | r60: ${(r.r60.tris / 1e6).toFixed(2)}M ${String(r.r60.calls).padStart(4)} cpu ${r.r60.cpu.toFixed(1)}ms | tex ${r.ground ? r.ground.texMB + '+' + r.ground.detailMB + ' MB' : '?'} boot ${(r.bootMs / 1000).toFixed(1)}s${r.breakdown ? ' | ' + JSON.stringify(r.breakdown) : ''}${r.errs.length ? ' ERR ' + r.errs[0] : ''}`;
for (const map of maps) for (const quality of tiers) {
  const r = await probe({ map, quality, ctxOpts: { viewport: { width: 1280, height: 720 } }, breakdown: has('--breakdown') });
  rows.push(r); console.log(fmt(r));
}
if (has('--phones')) {
  for (const map of maps) {
    const iph = await probe({ map, quality: null, ctxOpts: { ...devices['iPhone 13'] } }); iph.quality = 'auto(iPhone13)'; rows.push(iph); console.log(fmt(iph));
    const an = await probe({ map, quality: 'low', throttle: 4, ctxOpts: { ...devices['Pixel 5'] } }); an.quality = 'low(Pixel5 x4)'; rows.push(an); console.log(fmt(an));
  }
}
if (has('--throttle')) {
  for (const rate of (arg('--rates', '4,6') || '4,6').split(',').map(Number)) {
    const map = maps[0];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${base}/?map=${map}&intro=0&radio=0`);   // auto quality
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    await page.evaluate(() => { const g = window.__game; g.start(); g.skipIntro(); g.autoplay(1); });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const t0 = Date.now(); let hist = [];
    while (Date.now() - t0 < 70000) { await page.waitForTimeout(5000); hist = await page.evaluate(() => { const g = window.__game; return window.__life.quality.history; }); }
    const lvl = await page.evaluate(() => ({ name: window.__life.quality.name, avgMs: +window.__life.quality.avgMs.toFixed(1), ceiling: window.__life.quality.ceiling, failedUps: window.__life.quality.failedUps }));
    console.log(`throttle x${rate} (${map}, auto): history ${JSON.stringify(hist)} final ${JSON.stringify(lvl)}`);
    rows.push({ throttleTest: rate, map, hist, lvl });
    await ctx.close();
  }
}
fs.writeFileSync(path.join(root, 'scripts', 'out', 'perf-matrix.json'), JSON.stringify(rows, null, 1));
await browser.close(); kill(); process.exit(0);
