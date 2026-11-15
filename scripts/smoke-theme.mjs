// Theme system test + screenshots (own dev server on :5187, Playwright, GPU=1 for the real GPU).
//   PORT=5187 GPU=1 node scripts/smoke-theme.mjs            # tests + all screenshots
//   PORT=5187 GPU=1 node scripts/smoke-theme.mjs --shots-only [name ...]   # only screenshots (optionally by name)
//   PORT=5187 GPU=1 node scripts/smoke-theme.mjs --no-shots               # tests only
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5187;
if ([5199, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189].includes(+PORT)) { console.error('refusing to use port', PORT); process.exit(2); }
const base = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const shotsOnly = args.includes('--shots-only'), noShots = args.includes('--no-shots');
const onlyNames = args.filter((a) => !a.startsWith('--'));
// build into a private dir and serve it with `vite preview` (a dev server full-reloads whenever another agent edits a file)
const dist = path.join(root, 'scripts', `.dist-${PORT}`);
const build = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, encoding: 'utf8' });
if (build.status !== 0) { console.error(build.stdout + build.stderr); process.exit(2); }
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let slog = ''; server.stdout.on('data', (d) => (slog += d)); server.stderr.on('data', (d) => (slog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

let failed = 0;
const ok = (c, msg, extra = '') => { if (!c) { failed++; console.log('  FAIL', msg, extra); } else console.log('  ok  ', msg, extra); };

const mockDate = (iso) => `(() => { const R = Date; const base = new R('${iso}').getTime(); const t0 = R.now();
  class D extends R { constructor(...a) { if (a.length === 0) super(base + (R.now() - t0)); else super(...a); } static now() { return base + (R.now() - t0); } }
  window.Date = D; })();`;

let browser;
async function open(query, { viewport = { width: 1280, height: 720 }, date = null, errors = [] } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: 'Europe/Riga', deviceScaleFactor: 1, serviceWorkers: 'block', hasTouch: viewport.width < 600 });
  if (date) await ctx.addInitScript(mockDate(date));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (/\/api\//.test(m.location().url || '')) return; if (m.type() === 'error' || (m.type() === 'warning' && /\[bus\]|THREE\.WebGLProgram|shader/i.test(m.text()))) errors.push(m.type() + ': ' + m.text()); });
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  page.ctx = ctx;
  return page;
}
const close = async (p) => { try { await p.ctx.close(); } catch { /* ignore */ } };
const save = async (page, name) => { if (process.env.DBG) console.log('  state', JSON.stringify(await page.evaluate(() => ({ ph: window.__game.state.phase, st: document.getElementById('start').className })))); await page.screenshot({ path: path.join(out, `theme-${name}.png`) }); console.log('  saved theme-' + name + '.png'); };
const want = (n) => !onlyNames.length || onlyNames.includes(n);

// free camera at p looking at l (the theme runtime reads cam.focus / cam.dist, so keep them in sync)
async function freeCam(page, p, l, fov = 42) {
  await page.evaluate(([p, l, f]) => {
    const g = window.__life.game, cm = g.cam;
    g.teleport(1150, 1150);
    if (!cm._apply) cm._apply = cm.apply;
    cm.apply = () => {};
    if (!cm._update) cm._update = cm.update;
    cm.update = () => {};
    cm.focus.set(l[0], 0, l[2]); cm.dist = Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]) * 0.8;
    const c = cm.camera; c.position.set(...p); c.fov = f; c.near = 1; c.far = 6000; c.lookAt(...l); c.updateProjectionMatrix();
    const L = g.light; if (!L._upd) L._upd = L.update; const fd = cm.dist; L.update = () => L._upd.call(L, { x: l[0], z: l[2] }, fd);
  }, [p, l, fov]);
}
async function unFree(page) {
  await page.evaluate(() => { const g = window.__life.game, cm = g.cam; if (cm._apply) { cm.apply = cm._apply; cm._apply = null; } if (cm._update) { cm.update = cm._update; cm._update = null; } const L = g.light; if (L._upd) { L.update = L._upd; L._upd = null; } });
}
async function playAt(page, x, z, r, zoom = 1) {
  await unFree(page);
  await page.evaluate(([x, z, r, zoom]) => { const g = window.__game; g.zoomBy(zoom / g.cam.zoom); const sp = window.__life.world.findSpawn(x, z); g.teleport(sp[0], sp[1]); g.setRadius(r); }, [x, z, r, zoom]);
}

async function main() {
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch { /* wait */ } if (i > 100) throw new Error('no server\n' + slog); await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({
    headless: true,
    args: process.env.GPU
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });

  if (!shotsOnly) {
    // ---- 1. every theme loads without errors; uniforms / flags set
    console.log('themes via ?theme=');
    const expect = {
      day: { night: 0, snow: 0, flags: false, fw: false, glow: false },
      evening: { night: 0.9, snow: 0, flags: false, fw: false, glow: true },
      winter: { night: 0, snow: 1, flags: false, fw: false, glow: false },
      'winter-evening': { night: 0.85, snow: 1, flags: false, fw: false, glow: true },
      nov18: { night: 0.92, snow: 0, flags: true, fw: true, glow: true },
      ligo: { night: 0.35, snow: 0, flags: false, fw: false, glow: true },
    };
    const perfRows = [];
    for (const [id, e] of Object.entries(expect)) {
      const errors = [];
      const page = await open(`theme=${id}&intro=0&bots=2&quality=high`, { errors });
      await page.evaluate(() => window.__game.start());
      await page.waitForTimeout(1500);
      const i = await page.evaluate(() => window.__theme.info());
      ok(Math.abs(i.night - e.night) < 1e-6, `${id}: night factor ${i.night}`);
      ok(i.snow === e.snow && i.snowVisible === !!e.snow, `${id}: snow ${i.snow}/${i.snowVisible}`);
      ok(!!(i.flags && i.flags.on) === e.flags, `${id}: flags ${JSON.stringify(i.flags)}`);
      ok(i.glowVisible === e.glow, `${id}: glow visible ${i.glowVisible}`);
      ok(i.skyVisible === (e.night > 0), `${id}: sky dome ${i.skyVisible}`);
      // frame cost in gameplay
      await page.evaluate(() => { window.__game.teleport(-330, 230); window.__game.setRadius(4); });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(async () => {
        window.__perf.frames = 0; window.__perf.ms = 0; const f0 = performance.now();
        await new Promise((r) => setTimeout(r, 4000));
        const ri = window.__life.renderer.info;
        return { cpu: window.__perf.ms / window.__perf.frames, fps: window.__perf.frames / ((performance.now() - f0) / 1000), calls: ri.render.calls, tris: ri.render.triangles, geos: ri.memory.geometries, tex: ri.memory.textures };
      });
      perfRows.push({ id, cpu: +r.cpu.toFixed(2), fps: +r.fps.toFixed(0), calls: r.calls, tris: r.tris });
      ok(r.cpu < 5, `${id}: cpu ${r.cpu.toFixed(2)} ms/frame (<5), ${r.fps.toFixed(0)} fps, ${r.calls} calls`);
      ok(errors.length === 0, `${id}: no console errors`, errors.slice(0, 3).join(' | '));
      await close(page);
    }
    console.log('perf', JSON.stringify(perfRows));
    {
      const day = perfRows.find((r) => r.id === 'day'), nv = perfRows.find((r) => r.id === 'nov18');
      ok(nv.calls - day.calls <= 10, `draw call overhead nov18 vs day: +${nv.calls - day.calls} (<=10)`);
    }

    // ---- 2. automatic selection with a mocked clock (Riga timezone)
    console.log('auto selection by date');
    const cases = [
      ['2026-11-18T17:00:00Z', 'nov18', '18 Nov 19:00'], ['2026-11-12T10:00:00Z', 'nov18', '12 Nov noon'], ['2026-01-15T10:00:00Z', 'winter', '15 Jan noon'],
      ['2026-01-15T15:30:00Z', 'winterEve', '15 Jan 17:30'], ['2026-07-10T09:00:00Z', 'day', '10 Jul noon'], ['2026-07-10T20:00:00Z', 'evening', '10 Jul 23:00'],
      ['2026-06-23T10:00:00Z', 'ligo', '23 Jun'], ['2026-09-20T09:00:00Z', 'day', '20 Sep noon'], ['2026-09-20T17:30:00Z', 'evening', '20 Sep 20:30'],
      ['2026-03-10T21:00:00Z', 'evening', '10 Mar 23:00'],
    ];
    for (const [iso, want, label] of cases) {
      const errors = [];
      const page = await open('intro=0&bots=0&quality=low', { date: iso, errors });
      const i = await page.evaluate(() => window.__theme.info());
      ok(i.id === want, `${label} -> ${i.id} (want ${want})`);
      if (label === '18 Nov 19:00') {
        const cap = await page.evaluate(() => document.getElementById('themecap')?.textContent);
        ok(/novembra|November/.test(cap || ''), 'start-screen caption', cap);
        // picker: choose Winter -> persisted + applied; reload keeps it
        await page.click('#themesw button[data-theme="winter"]');
        ok((await page.evaluate(() => window.__theme.id)) === 'winter', 'picker applies winter');
        ok((await page.evaluate(() => localStorage.getItem('bedre.theme'))) === 'winter', 'picker stored');
        await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === '1');
        ok((await page.evaluate(() => window.__theme.id)) === 'winter', 'stored choice survives reload');
        await page.goto(`${base}/?theme=day&intro=0&bots=0&quality=low`); await page.waitForFunction(() => document.body.dataset.ready === '1');
        ok((await page.evaluate(() => window.__theme.id)) === 'day', '?theme= beats the stored choice');
      }
      ok(errors.length === 0, `${label}: no errors`, errors.slice(0, 2).join(' | '));
      await close(page);
    }

    // ---- 3. fireworks: spawn, pooled, end; finale at round end; no leaks across rounds
    console.log('fireworks');
    {
      const errors = [];
      const page = await open('theme=nov18&intro=0&bots=2&quality=high&time=14', { errors });
      await page.evaluate(() => window.__game.start());
      await page.waitForTimeout(500);
      const a = await page.evaluate(() => { const t = window.__theme; const n = t.volley(5); return { n, info: t.info() }; });
      ok(a.n >= 3, `volley launched ${a.n} rockets`);
      await page.waitForTimeout(1800);
      const b = await page.evaluate(() => window.__theme.info());
      ok(b.fw.visible && b.fw.active > 0, `fireworks active ${b.fw.active}, explosions ${b.fw.explosions}`);
      const maxVerts = b.fw.slots;
      // flood: many launches must stay inside the pool
      await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__theme.volley(5); });
      const c = await page.evaluate(() => window.__theme.info());
      ok(c.fw.active <= c.fw.slots, `pool bounded: active ${c.fw.active} <= slots ${c.fw.slots}`);
      await page.waitForFunction(() => window.__game.state.phase === 'ended', null, { timeout: 40000 });
      await page.waitForTimeout(1500);
      const d = await page.evaluate(() => ({ i: window.__theme.info(), p: window.__game.state.phase }));
      ok(d.i.stats.finales >= 1, `finale played at round end (phase ${d.p}, finales ${d.i.stats.finales})`);
      await page.waitForTimeout(16000);
      const e = await page.evaluate(() => window.__theme.info());
      ok(e.fw.active === 0 && !e.fw.visible, `fireworks ended (active ${e.fw.active}, visible ${e.fw.visible})`);
      // a second round: themes switch cleanly, memory stable
      const m0 = await page.evaluate(() => { const i = window.__life.renderer.info.memory; return { g: i.geometries, t: i.textures }; });
      for (let k = 0; k < 3; k++) {
        await page.evaluate((k) => { window.__theme.setPick(['winter', 'evening', 'nov18'][k], false); }, k);
        await page.click('#again').catch(() => {});
        await page.evaluate(() => window.__game.start());
        await page.waitForTimeout(1200);
      }
      const m1 = await page.evaluate(() => { const i = window.__life.renderer.info.memory; return { g: i.geometries, t: i.textures }; });
      ok(m1.g <= m0.g + 4 && m1.t <= m0.t + 1, `memory stable across theme switches / rounds: geometries ${m0.g}->${m1.g}, textures ${m0.t}->${m1.t}`);
      ok(errors.length === 0, 'fireworks run: no errors', errors.slice(0, 3).join(' | '));
      await close(page);
    }
    // sample city works with a theme
    {
      const errors = [];
      const page = await open('theme=nov18&sample=1&intro=0&bots=2&quality=medium', { errors });
      await page.evaluate(() => window.__game.start());
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__theme.volley(3));
      await page.waitForTimeout(2500);
      ok(errors.length === 0, 'sample city + nov18: no errors', errors.slice(0, 3).join(' | '));
      await close(page);
    }
    // quality tiers
    for (const q of ['low', 'medium']) {
      const errors = [];
      const page = await open(`theme=winter-evening&intro=0&bots=2&quality=${q}`, { errors });
      await page.evaluate(() => window.__game.start());
      await page.waitForTimeout(1200);
      const i = await page.evaluate(() => window.__theme.info());
      ok(q === 'low' ? !i.snowVisible : i.snowVisible, `quality ${q}: snow ${i.snowVisible}`);
      ok(errors.length === 0, `quality ${q}: no errors`, errors.slice(0, 2).join(' | '));
      await close(page);
    }
  }

  if (!noShots) await shots();
  console.log(failed ? `\n${failed} FAILED` : '\nall theme checks passed');
}

async function shots() {
  console.log('screenshots');
  const el = (d, deg = 57) => [Math.cos((deg * Math.PI) / 180) * d, Math.sin((deg * Math.PI) / 180) * d];
  const mk = async (query, o = {}) => { const errs = []; const p = await open(query, { errors: errs, ...o }); p.errs = errs; await p.evaluate(() => window.__game.start()); await p.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 20000 }); await p.waitForTimeout(1200); return p; };
  if (want('day')) { const p = await mk('theme=day&intro=0&bots=0&quality=high'); await playAt(p, -392, 452, 2.2, 1.3); await p.waitForTimeout(1500); await save(p, 'day'); await close(p); }
  if (want('evening-oldtown') || want('evening-street') || want('night-overview')) {
    const p = await mk('theme=evening&intro=0&bots=0&quality=high');
    if (want('evening-oldtown')) { await freeCam(p, [-830, 140, 330], [-430, 30, 300], 44); await p.waitForTimeout(1200); await save(p, 'evening-oldtown'); }
    if (want('evening-street')) { await playAt(p, -392, 452, 2.2, 1.3); await p.waitForTimeout(1500); await save(p, 'evening-street'); }
    if (want('night-overview')) { await freeCam(p, [-250, 1500, 1500], [-250, 0, 100], 42); await p.waitForTimeout(1500); await save(p, 'night-overview'); }
    await close(p);
  }
  if (want('nov18-flags') || want('nov18-fireworks') || want('nov18-finale') || want('nov18-krastmala') || want('nov18-street')) {
    const p = await mk('theme=nov18&intro=0&bots=0&quality=high');
    if (want('nov18-flags')) { await freeCam(p, [-300, 75, 430], [-440, 12, 320], 46); await p.waitForTimeout(1200); await save(p, 'nov18-flags'); }
    if (want('nov18-fireworks')) {
      await freeCam(p, [-330, 110, 330], [-950, 70, 330], 48);
      await p.evaluate(() => { window.__theme.volley(5); });
      await p.waitForTimeout(2300);
      await save(p, 'nov18-fireworks');
      await p.evaluate(() => { window.__theme.volley(4); });
      await p.waitForTimeout(2600);
      await save(p, 'nov18-fireworks2');
    }
    if (want('nov18-finale')) {
      await freeCam(p, [-330, 120, 330], [-950, 80, 330], 52);
      await p.evaluate(() => { window.__theme.playFinale(); });
      await p.waitForTimeout(4200);
      await save(p, 'nov18-finale');
    }
    if (want('nov18-krastmala')) {
      const sp = await p.evaluate(() => { const r = window.__theme.river || (window.__theme._r = null); const s = window.__theme.river.shore; const m = s[Math.floor(s.length / 2)]; return m; });
      await freeCam(p, [sp[0] + 34, 26, sp[1] + 34], [sp[0] - 6, 1, sp[1] - 4], 46);
      await p.waitForTimeout(1200); await save(p, 'nov18-krastmala');
    }
    if (want('nov18-street')) { await playAt(p, -392, 452, 2.2, 1.3); await p.waitForTimeout(1500); await save(p, 'nov18-street'); }
    await close(p);
  }
  if (want('winter-day') || want('winter-evening')) {
    for (const [id, name] of [['winter', 'winter-day'], ['winter-evening', 'winter-evening']]) {
      if (!want(name)) continue;
      const p = await mk(`theme=${id}&intro=0&bots=0&quality=high`);
      await playAt(p, -392, 452, 2.4, 1.4); await p.waitForTimeout(2000); await save(p, name);
      await close(p);
    }
  }
  if (want('mobile-evening')) {
    const p = await mk('theme=evening&intro=0&bots=3&quality=medium', { viewport: { width: 390, height: 780 } });
    await playAt(p, -392, 452, 2.4, 1.0); await p.waitForTimeout(2000); await save(p, 'mobile-evening');
    await close(p);
  }
  if (want('start-picker')) {
    const p = await open('theme=auto&quality=low', { date: '2026-11-18T17:00:00Z' });
    await p.waitForTimeout(800); await save(p, 'start-picker');
    await close(p);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { if (failed) process.exitCode = 1; kill(); setTimeout(() => process.exit(), 300); });
