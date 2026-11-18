// "Back to the start" UX + friend-room cold load, end to end on the BUILT game served by a local `wrangler dev` (own build dir / state / port, short
// server-timed rounds). Stages (run all, or `--only <stage>`):
//   cold    friend rooms on a COLD load (fresh browser context = no service worker, no caches): Create room clicked the moment the button exists, with
//           4x CPU throttling and the "Fast 3G" profile (Chromium) and on WebKit (iPhone 13); joining by code; a `?room=CODE` link on a cold load
//   solo    results -> Main menu in every mode (classic / quick / daily + practice / free roam): working start screen, the finished round was submitted
//           exactly once, a new round in ANOTHER mode starts and scores normally; Esc on the results; focus order
//   pause   pause -> Main menu: confirm, abandon: nothing submitted, no streak / XP; a new round afterwards is normal
//   online  public room results -> Main menu leaves the room (server sees it, no rejoin prompt) and a new public Online join works; private room results -> same
//   freedom Freedom Monument protected in the 18 Nov theme (toast once, honour album entry, bots, theme=day eats it) + online (server date)
//   shots   screenshots scripts/out/ux-*.png (desktop 1280x720, WebKit iPhone 13, 320x568; LV + EN)
//   UX_PORT=8795 GPU=1 node scripts/smoke-ux.mjs [--only cold|solo|pause|online|shots] [--skip-build]
import { chromium, webkit, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.UX_PORT || 8795);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND = 6, MP_ROUND = 14;
const dist = path.join(root, 'scripts', '.dist-ux-t');
const state = path.join(root, 'scripts', '.ux-state');
const cfgPath = path.join(root, 'scripts', '.wrangler-ux.jsonc');
const bundleDir = path.join(root, 'scripts', '.ux-worker');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const only = arg('--only', '');
const want = (n) => !only || only.split(',').includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GL = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + info}`); if (!ok) fails++; };
const until = async (fn, timeout = 20000, step = 120) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; await sleep(step); } return false; };
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };

// ---- build (a build-time hook exposes the Game as window.__G; no source edits) + server ----------------------------------------------------
if (!process.argv.includes('--skip-build')) {
  await build({
    root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 },
    plugins: [{ name: 'expose-game', transform(code, id) { return id.replace(/\\/g, '/').endsWith('/src/main.js') ? code.replace('window.__game = game.api();', 'window.__game = game.api(); window.__G = game;') : null; } }],
  });
}
fs.rmSync(state, { recursive: true, force: true });
const baseCfg = {
  name: 'bedre-ux-test', compatibility_date: '2026-11-01',
  assets: { directory: './.dist-ux-t', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
};
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir], { stdio: 'pipe' });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: './.ux-worker/index.js' }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state], { stdio: 'pipe' });
const VARS = { ROUND_SECONDS_OVERRIDE: ROUND, RATE_ROUNDS_PER_HOUR: 500, MP_ROUND_SECONDS: MP_ROUND, MP_LOBBY_SECONDS: 3, MP_RESULTS_SECONDS: 60, MP_TEST_CLOSE_SPAWN: 1, MP_TEST_DATE: '2026-11-15', RATE_PRIV_CREATE: 500, RATE_PRIV_FAIL: 500 };
let wr = null, wlog = '';
wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(VARS).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: root, stdio: 'pipe', detached: true });
wr.stdout.on('data', (d) => (wlog += d)); wr.stderr.on('data', (d) => (wlog += d));
const stopWrangler = () => { try { process.kill(-wr.pid, 'SIGKILL'); } catch {} };
process.on('exit', stopWrangler);
for (let i = 0; ; i++) { try { if ((await fetch(BASE + '/api/mp/status')).ok) break; } catch {} await sleep(500); if (i > 160) { console.error(wlog); throw new Error('wrangler dev not ready'); } }

const post = (p, body = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const errors = [];
const engines = {};
const launch = async (e) => engines[e] || (engines[e] = await (e === 'webkit' ? webkit : chromium).launch({ headless: true, args: e === 'chromium' ? GL : [] }));
/** A fresh browser context (= a cold visitor: no service worker, no caches) + page. */
async function mkPage(eng, { dev = null, size = { width: 1280, height: 720 }, lang = 'en', name = 'UxTest', init = '', extra = {} } = {}) {
  const b = await launch(eng);
  const ctx = await b.newContext(dev ? { ...devices[dev], locale: lang === 'lv' ? 'lv-LV' : 'en-GB', ...extra } : { viewport: size, locale: lang === 'lv' ? 'lv-LV' : 'en-GB', permissions: ['clipboard-read', 'clipboard-write'], ...extra });
  const page = await ctx.newPage();
  page.__ctx = ctx; page.__name = name;
  page.posts = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('request', (r) => { if (r.method() === 'POST') { const u = new URL(r.url()); if (/^\/api\/(scores|rounds)/.test(u.pathname)) page.posts.push(u.pathname); } });
  await page.addInitScript(([n, l, extra]) => { try { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', l); } catch {} window.__metaAllowDebug = false; if (extra) { try { new Function(extra)(); } catch {} } }, [name, lang, init]);
  return page;
}
const open = async (page, q = '') => {
  await page.goto(`${BASE}/?quality=low&radio=0${q ? '&' + q : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
  if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
  await page.waitForSelector('#loading', { state: 'detached', timeout: 15000 }).catch(() => {});
  await sleep(250);
};
const E = (p, fn, a) => p.evaluate(fn, a);
const vis = (p, sel) => E(p, (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.hidden,[hidden]'); }, sel);
const waitFor = (p, fn, a, timeout = 30000) => until(() => p.evaluate(fn, a), timeout, 120);
const shot = async (p, name) => { await sleep(350); await p.screenshot({ path: path.join(out, name) }); };

try {
  if (want('cold')) await (await import('./lib/ux-cold.mjs')).run({ BASE, check, until, sleep, mkPage, open, E, vis, waitFor, shot, errors, post, out, devices, launch });
  if (want('solo') || want('pause') || want('online') || want('shots') || want('freedom')) await (await import('./lib/ux-flows.mjs')).run({ BASE, PORT, ROUND, MP_ROUND, check, until, sleep, mkPage, open, E, vis, waitFor, shot, errors, post, out, want, launch });
} catch (e) { console.error(e); fails++; }
const real = errors.filter((e) => !/favicon|ERR_CONNECTION|Failed to fetch|net::/.test(e));
check('no unexpected page / console errors', real.length === 0, real.slice(0, 5).join(' | '));
stopWrangler();
for (const b of Object.values(engines)) await b.close().catch(() => {});
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
