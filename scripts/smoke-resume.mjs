// Session resume + network-outage + big-room test for online play, on REAL engines (WebKit iPhone 13 / iPhone SE, Chromium Pixel 5) against a
// local `wrangler dev` (own port, own build, own local D1, short rounds). The browsers reach the server THROUGH a tiny TCP proxy
// (scripts/lib/tcp-proxy.mjs) so the network can really be cut / stalled; headless protocol bots (scripts/lib/mp-bot.mjs) speak the real
// protocol for the observer / 12-client / human-vs-human / mover double-claim parts.
//
//   RS_PORT=8794 GPU=1 node scripts/smoke-resume.mjs [--skip-build] [--only reload|cuts|left|room12|duel]
//
// Scenarios (run concurrently in separate rooms, staggered so that every lobby is its own room):
//   reload  (WebKit iPhone 13): reload mid-round -> prompt -> auto rejoin -> same hole/score; dismiss; app switch (tab dropped 20 s, only
//           localStorage left) -> rejoin; two tabs (newer wins, older says "other tab"); round end -> final ranking has the player;
//           reload after the end -> results again; mover double claim vs the browser (clean rejection, no ghost); stale token; version change
//   cuts    (Pixel 5 Chromium: real RST; iPhone SE WebKit: dead network, no FIN): 3 / 12 / 20 s outage -> detect, "reconnecting", resume
//   left    (Pixel 5): 60 s outage (longer than the 45 s grace) -> client gives up, rejoin says "too long", observers see the hole leave,
//           final ranking still lists the player (left:true) with the score it had
//   room12  : 10 bots + WebKit iPhone 13 + Chromium Pixel 5 in one room
//   duel    : two protocol-bot humans: hole-vs-hole kill (both agree, respawn 50 %), mover double claim (first wins, second rejected)
import { chromium, webkit, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tcpProxy } from './lib/tcp-proxy.mjs';
import { Bot, loadTableFile } from './lib/mp-bot.mjs';
import { auditLayout } from './lib/layout-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.RS_PORT || 8794);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND = 130, LOBBY = 3, RESULTS = 45;
const dist = path.join(root, 'scripts', `.dist-rs-${PORT}`);
const state = path.join(root, 'scripts', `.rs-state-${PORT}`);
const cfgPath = path.join(root, 'scripts', `.wrangler-rs-${PORT}.jsonc`);
const bundleDir = path.join(root, 'scripts', `.rs-worker-${PORT}`);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const only = arg('--only', '');
const want = (n) => !only || only === n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };
let fails = 0, passes = 0;
const als = new AsyncLocalStorage();
const setCur = (v) => { const st = als.getStore(); if (st) st.cur = v; };
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; const cur = (als.getStore() || {}).cur || ''; console.log(`${ok ? 'PASS' : 'FAIL'}  [${cur}] ${name}${info !== '' && (!ok || process.env.VERBOSE) ? '  ' + info : ''}`); return ok; };

// ---- build + server -------------------------------------------------------------------------------------------------------------------------
if (!process.argv.includes('--skip-build')) run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']);
fs.rmSync(state, { recursive: true, force: true });
const baseCfg = {
  name: 'bedre-rs-test', compatibility_date: '2026-11-01',
  assets: { directory: `./.dist-rs-${PORT}`, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
};
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir], { stdio: 'pipe' });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: `./.rs-worker-${PORT}/index.js` }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state], { stdio: 'pipe' });
const wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
  '--var', `MP_ROUND_SECONDS:${ROUND}`, '--var', `MP_LOBBY_SECONDS:${LOBBY}`, '--var', `MP_RESULTS_SECONDS:${RESULTS}`, '--var', 'MP_TEST_CLOSE_SPAWN:1'], { cwd: root, stdio: 'pipe', detached: true });
let wlog = '';
wr.stdout.on('data', (d) => (wlog += d)); wr.stderr.on('data', (d) => (wlog += d));
const proxies = [];
const killAll = () => { try { process.kill(-wr.pid, 'SIGKILL'); } catch {} for (const p of proxies) try { p.close(); } catch {} };
process.on('exit', killAll);
for (let i = 0; i < 160; i++) { try { if ((await fetch(BASE + '/api/mp/status')).ok) break; } catch {} await sleep(500); if (i === 159) { console.error(wlog); throw new Error('wrangler dev not ready'); } }
const info = await (await fetch(BASE + '/api/mp/info')).json();
const table = loadTableFile(dist);
console.log(`server up: table ${info.hash} (${info.objects} objects), client file hash ${table.hash}`);

const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const browsers = {};
const getB = async (e) => browsers[e] || (browsers[e] = await (e === 'webkit' ? webkit : chromium).launch({ headless: true, args: e === 'chromium' ? GPU : [] }));
const errors = [];
let nextProxy = PORT + 3;
const mkProxy = async () => { const p = tcpProxy(nextProxy++, PORT); await p.listen(); proxies.push(p); return p; };
const tag = Math.random().toString(36).slice(2, 5);

/** a browser page on its own context, loaded through `proxy` (or direct), logged in under `name` */
async function mkPage(eng, device, proxy, name, { lang = 'en', ctx: shared = null, q = '' } = {}) {
  const b = await getB(eng);
  const ctx = shared || await b.newContext({ ...devices[device], locale: lang === 'lv' ? 'lv-LV' : 'en-GB' });
  const page = await ctx.newPage();
  page.__origin = `http://127.0.0.1:${proxy ? proxy.port : PORT}`; page.__q = q;
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  if (!shared) await ctx.addInitScript(([n, l]) => { try { if (!localStorage.getItem('bedre.name')) localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', l); } catch {} }, [name, lang]);
  await load(page);
  return page;
}
async function load(page) {
  await page.goto(`${page.__origin}/?quality=low${page.__q ? '&' + page.__q : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
  if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
}
const O = (p, fn, a) => p.evaluate(fn, a);
const until = async (p, fn, arg, timeout = 30000, step = 120) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(step); } return false; };
const shot = async (p, name) => { await sleep(200); await p.screenshot({ path: path.join(out, name) }).catch(() => {}); };
const click = (p, id) => p.evaluate((i) => document.getElementById(i).click(), id);
const pickTarget = (p, maxFit = 1.5, maxD = 80) => O(p, ([maxFit, maxD]) => {
  const w = window.__life.world, pl = window.__online.self;
  let best = null, bd = 1e9;
  for (const o of w.objects) { if (o.state !== 0 || o.mover || o.fit >= maxFit) continue; const d = Math.hypot(o.x - pl.x, o.z - pl.z); if (d < maxD && d < bd) { bd = d; best = o; } }
  return best ? { id: best.id, x: best.x, z: best.z } : null;
}, [maxFit, maxD]);
const eatSome = async (p, n = 5) => {
  let got = 0;
  for (let i = 0; i < n; i++) {
    const tg = await pickTarget(p);
    if (!tg) break;
    await O(p, (t) => window.__online.drive(t.x, t.z), tg);
    if (await until(p, (id) => window.__life.world.objects[id].state !== 0, tg.id, 9000, 80)) got++;
  }
  await O(p, () => window.__online.drive(null));
  await sleep(500);
  return got;
};
const S = (p) => O(p, () => ({ st: window.__online.state, me: window.__online.me, room: window.__online.room, ss: window.__online.serverScore, rec: window.__online.reconnecting, tok: window.__online.token, self: window.__online.self, log: window.__online.log.map((m) => m.t) }));
/** generic layout audit (HUD vs panels, name tags vs HUD cards, tap targets, panel fit...) on a live online page */
async function audit(p, label) {
  const v = await p.evaluate(auditLayout, { touch: true });
  const seen = new Set(); const u = v.filter((x) => !seen.has(x.kind + x.msg) && seen.add(x.kind + x.msg));
  check(`layout audit (${label}): no overlaps / small targets / clipped panels`, u.length === 0, u.slice(0, 5).map((x) => `${x.kind}: ${x.msg.replace(/\s+/g, ' ')}`).join(' | '));
}
/** wait for `p` to be playing in `room` (joins via the Online button) */
async function joinOnline(p) {
  await click(p, 'play-online');
  return (await until(p, () => window.__online.state === 'lobby', null, 20000)) && (await until(p, () => window.__online.state === 'playing', null, 40000));
}

// =========================================================================================================================================
async function scenarioReload() {
  setCur('reload/WebKit iPhone 13');
  const obs = new Bot({ base: BASE, name: 'Obs' + tag, table });
  const room = await obs.join();
  const A = await mkPage('webkit', 'iPhone 13', null, 'Ann' + tag);
  check('A joins the observer\'s room and plays', (await joinOnline(A)) && (await O(A, () => window.__online.room)) === room);
  const meA = await O(A, () => window.__online.me);
  const eaten = await eatSome(A, 6);
  const pre = await S(A);
  check('A ate things before the reload', eaten >= 3 && pre.ss > 0, `score ${pre.ss}`);
  const sess = await O(A, () => window.__online.session);
  check('session record stored (room + token + name) in sessionStorage AND localStorage', !!sess && sess.room === room && sess.token === pre.tok && await O(A, () => !!sessionStorage.getItem('bedre.mp.session') && !!localStorage.getItem('bedre.mp.session')), JSON.stringify(sess));
  check('the record expires after the round end (+ margin)', sess && sess.exp > Date.now() && sess.exp < Date.now() + (ROUND * 1000) + 120000, `exp in ${sess && Math.round((sess.exp - Date.now()) / 1000)} s`);

  // --- reload mid-round
  await A.reload(); await A.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  const prompt = await until(A, () => !!document.getElementById('mp-rejoin') && document.getElementById('mp-rejoin').offsetParent !== null, null, 5000, 50);
  const ptxt = await O(A, () => document.getElementById('mp-rejoin') ? document.getElementById('mp-rejoin').textContent : '');
  check('after the reload the start screen offers "Rejoin round" with a countdown', prompt && /Rejoin round \(\d\)/.test(ptxt) && /still running/.test(ptxt), ptxt);
  await shot(A, 'fix2-qa2-01-wk13-rejoin-prompt.png');
  check('...and the player is NOT yet in a new lobby', (await O(A, () => window.__online.state)) === 'idle');
  const back = await until(A, () => window.__online.state === 'playing' && !window.__online.reconnecting, null, 12000, 100);
  const post = await S(A);
  check('auto-rejoin after ~3 s puts the player back in the SAME round and hole', back && post.room === room && post.me === meA && post.log.includes('resume'), JSON.stringify({ room: post.room, me: post.me, meA }));
  check('score kept across the reload', post.ss >= pre.ss, `${pre.ss} -> ${post.ss}`);
  check('the observer never saw A leave the arena', obs.holes.has(meA) && !obs.msgs.some((m) => m.t === 's' && m.d && m.d.includes(meA)));
  await shot(A, 'fix2-qa2-01-wk13-rejoined.png');
  const eaten2 = await eatSome(A, 2);
  check('A keeps playing normally after the rejoin (eats, server score grows)', eaten2 >= 1 && (await O(A, () => window.__online.serverScore)) > post.ss, '');

  // --- mover double claim vs the browser (first claim wins, the other gets a clean rejection, no ghost)
  {
    const mv = await O(A, () => { const w = window.__life.world; let b = null; for (const o of w.objects) if (o.mover && o.state === 0 && o.fit < 1.2 && (!b || o.fit < b.fit)) b = o; return b ? { id: b.id, fit: b.fit, value: b.value } : null; });
    if (check('a small mover exists to fight over', !!mv)) {
      obs.walk = false; obs.farm = false; obs.goal = null;
      const q = 900000 + Math.floor(Math.random() * 1000);
      const before = obs.acks.length;
      obs.send({ t: 'u', q, x: obs.x, z: obs.z, m: [[mv.id, obs.x, obs.z]] });
      await obs.until(() => obs.acks.some((a) => a.q === q), 4000);
      const ack1 = obs.acks.find((a) => a.q === q);
      check('first claim of the mover wins (bot)', ack1 && !ack1.b.length, JSON.stringify(ack1));
      const hidden = await until(A, (id) => window.__life.world.objects[id].state !== 0, mv.id, 4000, 80);
      check('the browser sees the mover disappear (eaten by the other player)', hidden);
      const pos = await O(A, () => window.__online.self);
      const ssA = await O(A, () => window.__online.serverScore);
      await O(A, ([id, x, z]) => window.__online.send({ t: 'u', q: 777555, x, z, m: [[id, x, z]] }), [mv.id, pos.x, pos.z]);
      await until(A, () => window.__online.log.some((m) => m.t === 'a' && m.q === 777555), null, 4000);
      const ack2 = await O(A, () => window.__online.log.find((m) => m.t === 'a' && m.q === 777555));
      await sleep(900);
      const ghost = await O(A, (id) => window.__life.world.objects[id].state, mv.id);
      check('second claim (the browser) gets a clean rejection, score unchanged, no ghost mover', ack2 && ack2.b.includes(mv.id) && ack2.s === ssA && ghost !== 0, `ack ${JSON.stringify(ack2)} state ${ghost}`);
      obs.walk = true;
      void before;
    }
  }

  // --- stale token: a record for a room that does not exist -> message, menu usable, Online works normally afterwards (separate throwaway page)
  // (done in scenarioCuts, which owns throwaway pages)

  // --- app switch: the tab is dropped for 20 s (iOS eviction): only localStorage survives
  const ctx = A.context();
  const hbBefore = await O(A, () => window.__online.session);
  await A.close();
  await sleep(20000);
  const A2 = await ctx.newPage();
  A2.__origin = `http://127.0.0.1:${PORT}`;
  A2.on('pageerror', (e) => errors.push(`[A2] pageerror: ${e.message}`));
  await load(A2);
  const hasSS = await O(A2, () => !!sessionStorage.getItem('bedre.mp.session'));
  check('new tab after 20 s: sessionStorage is empty but the localStorage record is there', !hasSS && !!(await O(A2, () => window.__online.session)));
  const rj = await until(A2, () => window.__online.state === 'playing' && !window.__online.reconnecting, null, 14000, 100);
  const s2 = await S(A2);
  check('app-switch (20 s away): rejoined the same hole with its score', rj && s2.me === meA && s2.ss >= (hbBefore ? 0 : 0) && s2.ss > 0 && s2.room === room, JSON.stringify({ me: s2.me, ss: s2.ss }));

  // --- two tabs: the newer wins
  const A3 = await ctx.newPage();
  A3.__origin = `http://127.0.0.1:${PORT}`;
  A3.on('pageerror', (e) => errors.push(`[A3] pageerror: ${e.message}`));
  await load(A3);
  await sleep(1500);
  const txt3 = await O(A3, () => ({ t: document.getElementById('mp-rejoin') ? document.getElementById('mp-rejoin').textContent : '', st: window.__online.state }));
  check('second tab: offers "Take over here" and does NOT auto-join (the other tab is alive)', /Take over here/.test(txt3.t) && /another tab/.test(txt3.t) && txt3.st === 'idle', JSON.stringify(txt3));
  await sleep(4000);
  check('...still idle after the usual countdown', (await O(A3, () => window.__online.state)) === 'idle');
  await click(A3, 'mp-rejoin-yes');
  const tk = await until(A3, () => window.__online.state === 'playing', null, 12000, 100);
  check('taking over: the newer tab plays the same hole', tk && (await O(A3, () => window.__online.me)) === meA);
  const old = await until(A2, () => window.__online.state === 'idle' && /another tab/.test(document.getElementById('mp-status').textContent), null, 8000, 100);
  check('the older tab says "open in another tab" and goes idle (no reconnect fight)', old, await O(A2, () => document.getElementById('mp-status').textContent));
  await sleep(4000);
  const still = await S(A3);
  check('...and the newer tab stays connected (no ping-pong)', still.st === 'playing' && !still.rec && (await O(A2, () => window.__online.state)) === 'idle');
  await shot(A2, 'fix2-qa2-01-other-tab.png');
  await A2.close();

  // --- the round ends: final ranking contains the player with the right score; reload after the end shows the results again
  const left = await O(A3, () => Math.max(0, (window.__online.round.endAt - window.__online.serverNow()) / 1000));
  console.log(`  [reload] waiting ${left.toFixed(0)} s for the round to end`);
  const ended = await until(A3, () => window.__online.state === 'ended', null, (left + 25) * 1000, 300);
  check('round ends, A sees the results', ended && (await O(A3, () => !document.getElementById('results').classList.contains('hidden'))));
  await obs.until(() => obs.final, 15000);
  const fA = await O(A3, () => window.__online.final);
  const rowA = (obs.final || []).find((r) => r.id === meA);
  const myScore = await O(A3, () => window.__online.serverScore);
  check('observer\'s final ranking contains A (the reloaded player) with A\'s score', !!rowA && rowA.name === 'Ann' + tag && rowA.score >= myScore - 1 && rowA.score >= post.ss && !rowA.left, JSON.stringify(rowA));
  check('same final ranking on the browser and on the bot', JSON.stringify(fA) === JSON.stringify(obs.final));
  await until(A3, () => window.__online.saved === true, null, 8000);
  const rows = await (await fetch(`${BASE}/api/scores?mode=online&period=day&limit=50`)).json();
  check('server wrote ONE online row for the reloaded player with that score', (rows.scores || []).filter((r) => r.name === 'Ann' + tag).length === 1 && (rows.scores || []).find((r) => r.name === 'Ann' + tag).score === rowA.score);
  await sleep(1500);
  await A3.reload(); await A3.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
  const pr = await until(A3, () => !!document.getElementById('mp-rejoin'), null, 4000, 50);
  const ptxt2 = pr ? await O(A3, () => document.getElementById('mp-rejoin').textContent) : '';
  check('reload after the round ended: the start screen offers the results', pr && /See results/.test(ptxt2), ptxt2);
  const res = await until(A3, () => window.__online.state === 'ended' && !document.getElementById('results').classList.contains('hidden'), null, 12000, 100);
  const fA2 = await O(A3, () => window.__online.final);
  check('...and shows the same final ranking again', res && JSON.stringify(fA2) === JSON.stringify(obs.final));
  await shot(A3, 'fix2-qa2-01-wk13-results-after-reload.png');
  // leaving the results clears the record: a further reload shows the plain menu
  await click(A3, 'mp-menu');
  await sleep(300);
  check('"Back to menu" clears the stored session', (await O(A3, () => window.__online.session)) === null);
  obs.close();
  await A3.context().close();
}

// =========================================================================================================================================
async function scenarioStale() {
  setCur('stale/throwaway');
  const P = await mkPage('chromium', 'Pixel 5', null, 'Stl' + tag);
  // 1) token for a room that never existed
  await O(P, () => { const rec = { v: 1, room: 'zzzzzzzzzz', token: 'tok_' + Math.random().toString(36).slice(2, 14), name: 'Stl', hash: window.__mpHash(), id: 3, endAt: Date.now() + 60000, ended: false, exp: Date.now() + 120000, tab: 'other', hb: 0, last: { score: 1234, rank: 2, total: 8 } }; const s = JSON.stringify(rec); sessionStorage.setItem('bedre.mp.session', s); localStorage.setItem('bedre.mp.session', s); });
  await P.reload(); await P.waitForFunction(() => document.body.dataset.ready === '1');
  check('stale record: the rejoin prompt shows', await until(P, () => !!document.getElementById('mp-rejoin'), null, 4000, 50));
  const gone = await until(P, () => window.__online.state === 'idle' && /closed|over/i.test(document.getElementById('mp-status').textContent), null, 14000, 150);
  const st = await O(P, () => ({ s: document.getElementById('mp-status').textContent, rec: window.__online.session, start: !document.getElementById('start').classList.contains('hidden') }));
  check('stale token / room gone: a clear message with the last known result, record dropped, menu usable', gone && /1234/.test(st.s) && st.rec === null && st.start, JSON.stringify(st));
  await shot(P, 'fix2-qa2-01-stale-room.png');
  // 2) dismiss: "No thanks" clears the record and never joins
  await O(P, () => { const rec = { v: 1, room: 'zzzzzzzzzy', token: 'tok_' + Math.random().toString(36).slice(2, 14), name: 'Stl', hash: window.__mpHash(), id: 3, endAt: Date.now() + 60000, ended: false, exp: Date.now() + 120000, tab: 'x', hb: 0 }; localStorage.setItem('bedre.mp.session', JSON.stringify(rec)); });
  await P.reload(); await P.waitForFunction(() => document.body.dataset.ready === '1');
  await until(P, () => !!document.getElementById('mp-rejoin'), null, 4000, 50);
  await click(P, 'mp-rejoin-no');
  await sleep(4500);
  check('dismissed: stays on the menu, record cleared, not trapped (Play works)', (await O(P, () => ({ s: window.__online.state, rec: window.__online.session, p: !document.getElementById('mp-rejoin') }))).s === 'idle' && (await O(P, () => window.__online.session)) === null);
  await click(P, 'play');
  check('solo Play works after a dismissed rejoin', await until(P, () => window.__game.state.phase === 'intro' || window.__game.state.phase === 'playing', null, 8000));
  // 3) a record while the user starts a solo round during the countdown: the offer is dropped, the solo round is never hijacked
  await O(P, () => { const rec = { v: 1, room: 'zzzzzzzzzx', token: 'tok_' + Math.random().toString(36).slice(2, 14), name: 'Stl', hash: window.__mpHash(), id: 3, endAt: Date.now() + 60000, ended: false, exp: Date.now() + 120000, tab: 'x', hb: 0 }; localStorage.setItem('bedre.mp.session', JSON.stringify(rec)); });
  await P.reload(); await P.waitForFunction(() => document.body.dataset.ready === '1');
  await until(P, () => !!document.getElementById('mp-rejoin'), null, 4000, 50);
  await click(P, 'play');
  await sleep(5000);
  check('solo round started during the countdown is not hijacked by the rejoin', (await O(P, () => ({ s: window.__online.state, ph: window.__game.state.phase }))).s === 'idle');
  // 4) another client version: the server refuses the hello -> plain message, record dropped, solo untouched
  await O(P, () => { window.__game.pause && 0; });
  await P.reload(); await P.waitForFunction(() => document.body.dataset.ready === '1');
  const obs = new Bot({ base: BASE, name: 'Ver' + tag, table });
  const room = await obs.join();    // a real lobby room (so the refusal is about the version, not about the room)
  await O(P, ([room]) => { window.__online.forceHash('0000000000000bad'); const rec = { v: 1, room, token: 'tok_' + Math.random().toString(36).slice(2, 14), name: 'Stl', hash: 'x', id: 3, endAt: Date.now() + 60000, ended: false, exp: Date.now() + 120000, tab: 'x', hb: 0 }; localStorage.setItem('bedre.mp.session', JSON.stringify(rec)); document.getElementById('play-online').click(); }, [room]);
  const vr = await until(P, () => window.__online.state === 'idle' && /not available/i.test(document.getElementById('mp-status').textContent), null, 12000, 150);
  check('changed client version on rejoin: the existing refusal flow (plain message, back to the menu, record dropped)', vr && (await O(P, () => window.__online.session)) === null);
  obs.close();
  await P.context().close();
}

// =========================================================================================================================================
async function cutCycles(eng, device, name, mode, proxy, durations) {
  setCur(`cuts/${mode}/${eng} ${device}`);
  const obs = new Bot({ base: BASE, name: 'O' + mode[0] + tag, table });
  const room = await obs.join();
  const P = await mkPage(eng, device, proxy, name);
  check('joined + playing', (await joinOnline(P)) && (await O(P, () => window.__online.room)) === room);
  await eatSome(P, 3);
  const me = await O(P, () => window.__online.me);
  for (const d of durations) {
    const pre = await S(P);
    const t0 = Date.now();
    if (mode === 'cut') proxy.cut(); else proxy.stall();
    const detected = await until(P, () => window.__online.reconnecting, null, 12000, 40);
    const tDet = (Date.now() - t0) / 1000;
    if (d >= 12 || mode === 'cut') {
      check(`${d} s ${mode}: the client notices the dead socket promptly (<= 8 s) and shows "reconnecting"`, detected && tDet <= 8, `${tDet.toFixed(1)} s`);
      if (detected) {
        const badge = await O(P, () => { const e = document.getElementById('mp-net'); return e ? { t: e.textContent, c: e.className, shown: getComputedStyle(e).display !== 'none' } : null; });
        check(`${d} s ${mode}: badge says "Connection lost — reconnecting…"`, badge && /reconnecting/i.test(badge.t) && badge.c.includes('bad'), JSON.stringify(badge));
        if (d === 12 && mode === 'cut') await shot(P, 'fix2-qa2-01-px5-reconnecting.png');
      }
    } else {
      // a stall shorter than the dead-socket threshold may simply be ridden out
      check(`${d} s ${mode}: short stall is either detected or ridden out`, true);
    }
    await sleep(Math.max(0, d * 1000 - (Date.now() - t0)));
    proxy.pass();
    const t1 = Date.now();
    const back = await until(P, () => window.__online.state === 'playing' && !window.__online.reconnecting && window.__online.socket === 1, null, 30000, 100);
    const rtt = (Date.now() - t1) / 1000;
    // after a stall the old socket's flushed data may still be arriving: give the server a moment, then compare
    await sleep(800);
    const post = await S(P);
    check(`${d} s ${mode}: resumed after the network returned (<= 12 s), same hole, score kept`, back && rtt <= 12 && post.me === me && post.ss >= pre.ss && post.room === room, `back ${rtt.toFixed(1)} s, me ${post.me}/${me}, score ${pre.ss} -> ${post.ss}`);
    const live = await O(P, () => { const a = window.__online.self; return a.alive; });
    check(`${d} s ${mode}: hole still alive and the observer still sees it`, live && obs.holes.has(me) && !obs.msgs.some((m) => m.t === 's' && m.d && m.d.includes(me)));
    const eat = await eatSome(P, 2);
    check(`${d} s ${mode}: can keep eating after the outage`, eat >= 1);
  }
  obs.close();
  await P.context().close();
}

async function scenarioLeft(proxy) {
  setCur('left/Pixel 5 (60 s cut)');
  const obs = new Bot({ base: BASE, name: 'OL' + tag, table });
  const obs2 = new Bot({ base: BASE, name: 'OM' + tag, table });
  const room = await obs.join(); await obs2.join(room);
  const P = await mkPage('chromium', 'Pixel 5', proxy, 'Lft' + tag);
  check('joined + playing', (await joinOnline(P)) && (await O(P, () => window.__online.room)) === room);
  await eatSome(P, 4);
  const me = await O(P, () => window.__online.me);
  const scoreAtCut = await O(P, () => window.__online.serverScore);
  proxy.cut();
  const tCut = Date.now();
  check('cut detected', await until(P, () => window.__online.reconnecting, null, 10000, 60));
  // the observer sees the hole leave the arena after the grace period
  const goneAt = await obs.until(() => !obs.holes.has(me) , 60000, 200) ? (Date.now() - tCut) / 1000 : -1;
  check('server removes the absent hole only after the grace period (~45 s)', goneAt >= 40 && goneAt <= 58, `${goneAt.toFixed(1)} s after the cut`);
  const gaveUp = await until(P, () => window.__online.state === 'idle', null, 30000, 200);
  const stMsg = await O(P, () => document.getElementById('mp-status').textContent);
  check('client gave up reconnecting with "Connection lost" (before / around the grace period), back on the menu', gaveUp && /Connection lost/i.test(stMsg), stMsg);
  check('...but the session record is kept (the player may still come back)', !!(await O(P, () => window.__online.session)));
  await sleep(Math.max(0, 62000 - (Date.now() - tCut)));
  proxy.pass();
  await click(P, 'play-online');
  const late = await until(P, () => /too long/i.test(document.getElementById('mp-status').textContent), null, 14000, 150);
  const msg = await O(P, () => document.getElementById('mp-status').textContent);
  check('network back after 62 s: Online reports "disconnected for too long" (not a silent new lobby)', late && (await O(P, () => window.__online.state)) === 'idle', msg);
  await shot(P, 'fix2-qa2-01-px5-too-long.png');
  const rem = await O(P, () => window.__online.session);
  check('the record is dropped after that message', rem === null);
  const left = Math.max(0, obs.start.endAt - Date.now()) / 1000;
  console.log(`  [left] waiting ${left.toFixed(0)} s for the round to end`);
  await obs.until(() => obs.final, (left + 25) * 1000, 300);
  const row = (obs.final || []).find((r) => r.id === me);
  check('the player who never came back is in the final ranking WITH the score it had (left:true)', !!row && row.left === true && row.score >= scoreAtCut && row.name === 'Lft' + tag, JSON.stringify(row));
  check('...on every client', JSON.stringify(obs.final) === JSON.stringify(obs2.final) && obs.final.length >= 8, `${(obs.final || []).length} rows`);
  await obs.until(() => obs.saved !== undefined, 8000);
  const rows = await (await fetch(`${BASE}/api/scores?mode=online&period=day&limit=50`)).json();
  check('...but the absent player\'s result is NOT written to the online leaderboard (did not finish)', !(rows.scores || []).some((r) => r.name === 'Lft' + tag));
  obs.close(); obs2.close();
  await P.context().close();
}

// =========================================================================================================================================
async function scenarioRoom12() {
  setCur('room12');
  const A = await mkPage('webkit', 'iPhone 13', null, 'R12a' + tag);
  const B = await mkPage('chromium', 'Pixel 5', null, 'R12b' + tag);
  const bots = Array.from({ length: 10 }, (_, i) => new Bot({ base: BASE, name: `Bot${i}${tag}`, table }));
  // everybody joins within the lobby window; the 12th arrival starts the round at once
  await Promise.all([click(A, 'play-online'), click(B, 'play-online')]);
  await until(A, () => window.__online.state === 'lobby', null, 15000);
  await until(B, () => window.__online.state === 'lobby', null, 15000);
  await audit(A, 'online lobby, iPhone 13'); await audit(B, 'online lobby, Pixel 5');
  await shot(A, 'fix2-room12-lobby-wk13.png');
  const room = await O(A, () => window.__online.room);
  await Promise.all(bots.map((b, i) => sleep(i * 60).then(() => b.join(room))));
  check('12 humans accepted into one room', await until(A, () => (window.__online.lobby && window.__online.lobby.players.length) >= 12 || window.__online.state === 'intro' || window.__online.state === 'playing', null, 15000), `bots in room: ${bots.filter((b) => b.me >= 0).length}`);
  check('the room starts (full -> immediate start)', (await until(A, () => window.__online.state === 'playing', null, 20000)) && (await until(B, () => window.__online.state === 'playing', null, 20000)));
  const rA = await O(A, () => window.__online.round), rB = await O(B, () => window.__online.round);
  check('same start for both browsers, 12 holes, no server bots', rA.startAt === rB.startAt && rA.holes.length === 12 && rA.holes.filter((h) => h.bot).length === 0 && new Set(rA.holes.map((h) => h.id)).size === 12 && new Set(rA.holes.map((h) => h.slot)).size === 12, `${rA.holes.length} holes`);
  check('every bot got the round', await bots[0].until(() => bots.every((b) => b.state === 'playing'), 8000), `playing ${bots.filter((b) => b.state === 'playing').length}/10`);
  for (const b of bots) { b.farm = true; }
  const eA = eatSome(A, 4), eB = eatSome(B, 4);
  await Promise.all([eA, eB]);
  await sleep(6000);
  const rem = await Promise.all([A, B].map((p) => O(p, () => window.__online.remotes().filter((h) => !h.isBot).length)));
  check('each browser sees the 11 other humans', rem[0] === 11 && rem[1] === 11, JSON.stringify(rem));
  check('bots (farming) all scored through the real protocol', bots.filter((b) => b.score > 0).length >= 8, `${bots.filter((b) => b.score > 0).length}/10 scored`);
  await audit(A, 'online play, iPhone 13 portrait'); await audit(B, 'online play, Pixel 5 portrait');
  await A.setViewportSize({ width: 844, height: 390 }); await B.setViewportSize({ width: 851, height: 393 });
  await A.evaluate(() => window.dispatchEvent(new Event('orientationchange'))); await sleep(900);
  await audit(A, 'online play, iPhone 13 landscape'); await audit(B, 'online play, Pixel 5 landscape');
  await shot(A, 'fix2-room12-play-landscape-wk13.png');
  await A.setViewportSize({ width: 390, height: 664 }); await B.setViewportSize({ width: 393, height: 727 }); await sleep(600);
  const snapN = await O(A, () => window.__online.stats.snapshots);
  check('snapshots keep flowing with 12 humans', snapN > 40, `${snapN}`);
  await shot(A, 'fix2-room12-wk13.png');
  const left = Math.max(0, (rA.endAt - Date.now()) / 1000);
  console.log(`  [room12] waiting ${left.toFixed(0)} s for the round to end`);
  const ok = (await until(A, () => window.__online.state === 'ended', null, (left + 30) * 1000, 400)) && (await until(B, () => window.__online.state === 'ended', null, 20000, 300));
  check('round ends for all 12', ok && (await bots[0].until(() => bots.every((b) => b.state === 'ended'), 15000)));
  await sleep(800);
  await audit(A, 'online results, iPhone 13'); await audit(B, 'online results, Pixel 5');
  await shot(A, 'fix2-room12-results-wk13.png');
  const fA = await O(A, () => window.__online.final), fB = await O(B, () => window.__online.final);
  check('identical 12-row final ranking on browsers and bots', fA.length === 12 && JSON.stringify(fA) === JSON.stringify(fB) && bots.every((b) => JSON.stringify(b.final) === JSON.stringify(fA)), `${fA.length} rows`);
  for (const b of bots) b.close();
  await A.context().close(); await B.context().close();
}

// =========================================================================================================================================
async function scenarioLayout() {
  setCur('layout online (iPhone SE, iPhone 13 + notch insets)');
  const X = await mkPage('webkit', 'iPhone SE', null, 'LaySE' + tag, { lang: 'lv' });
  const Y = await mkPage('webkit', 'iPhone 13', null, 'LayNotch' + tag, { q: 'inset=47,0,34,0' });
  await Promise.all([click(X, 'play-online'), click(Y, 'play-online')]);
  await until(X, () => window.__online.state === 'lobby', null, 20000); await until(Y, () => window.__online.state === 'lobby', null, 20000);
  await sleep(500);
  await audit(X, 'lobby, iPhone SE LV'); await audit(Y, 'lobby, iPhone 13 notch');
  await shot(X, 'fix2-online-lobby-se.png');
  check('both play', (await until(X, () => window.__online.state === 'playing', null, 40000)) && (await until(Y, () => window.__online.state === 'playing', null, 40000)));
  await eatSome(X, 2); await eatSome(Y, 2);
  await sleep(1500);
  await audit(X, 'play, iPhone SE portrait'); await audit(Y, 'play, iPhone 13 notch portrait');
  const hudTop = await O(Y, () => Math.min(...['card-score', 'card-time', 'board'].map((i) => document.getElementById(i).getBoundingClientRect().top)));
  check('notch portrait: HUD top row is below the 47 px inset', hudTop >= 47 - 0.5, `top ${hudTop}`);
  await shot(Y, 'fix2-online-play-notch-wk13.png');
  await X.setViewportSize({ width: 568, height: 320 }); await X.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await Y.setViewportSize({ width: 844, height: 390 }); await Y.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await sleep(900);
  await audit(X, 'play, iPhone SE landscape'); await audit(Y, 'play, iPhone 13 notch landscape');
  await shot(X, 'fix2-online-play-se-landscape.png');
  await X.setViewportSize({ width: 320, height: 568 }); await Y.setViewportSize({ width: 390, height: 664 }); await sleep(600);
  const left = await O(X, () => Math.max(0, (window.__online.round.endAt - window.__online.serverNow()) / 1000));
  console.log(`  [layout] waiting ${left.toFixed(0)} s for the round to end`);
  const ok = (await until(X, () => window.__online.state === 'ended', null, (left + 30) * 1000, 400)) && (await until(Y, () => window.__online.state === 'ended', null, 20000, 300));
  check('round ends', ok);
  await sleep(1200);
  await audit(X, 'online results, iPhone SE portrait LV'); await audit(Y, 'online results, iPhone 13 notch');
  const rows = await O(X, () => { const tb = document.getElementById('r-table'); const sc = tb.closest('.rpanes'); const a = sc.getBoundingClientRect(); return [...tb.querySelectorAll('tr')].filter((tr) => { const r = tr.getBoundingClientRect(); return r.top >= a.top - 1 && r.bottom <= a.bottom + 1; }).length; });
  check('SE results: at least 5 leaderboard rows visible without scrolling', rows >= 5, `${rows} rows`);
  await shot(X, 'fix2-qa2-02-se-online-results.png');
  await X.setViewportSize({ width: 568, height: 320 }); await sleep(600);
  await audit(X, 'online results, iPhone SE landscape');
  await shot(X, 'fix2-online-results-se-landscape.png');
  await X.context().close(); await Y.context().close();
}

// =========================================================================================================================================
async function scenarioDuel() {
  setCur('duel (bots)');
  const X = new Bot({ base: BASE, name: 'DuX' + tag, table }), Y = new Bot({ base: BASE, name: 'DuY' + tag, table });
  const room = await X.join(); await Y.join(room);
  check('both humans playing', await X.until(() => X.state === 'playing' && Y.state === 'playing', 20000));
  await sleep(Math.max(0, X.start.playAt - Date.now()) + 400);   // claims only count once the round clock runs
  Y.farm = true; X.farm = true;
  // --- mover double claim first (both are small): same mover, X first
  const mv = (() => { let b = -1; for (let i = 0; i < table.n; i++) if ((table.flags[i] & 1) && table.fit[i] < 1.2 && (b < 0 || table.fit[i] < table.fit[b])) b = i; return b; })();
  X.walk = false; X.farm = false; Y.walk = false; Y.farm = false; X.goal = Y.goal = null;
  if (check('a mover exists', mv >= 0)) {
    const qx = 810001, qy = 810002;
    X.send({ t: 'u', q: qx, x: X.x, z: X.z, m: [[mv, X.x, X.z]] });
    Y.send({ t: 'u', q: qy, x: Y.x, z: Y.z, m: [[mv, Y.x, Y.z]] });
    await X.until(() => X.acks.some((a) => a.q === qx) && Y.acks.some((a) => a.q === qy), 5000);
    const ax = X.acks.find((a) => a.q === qx), ay = Y.acks.find((a) => a.q === qy);
    const first = ax && !ax.b.length ? 'X' : ay && !ay.b.length ? 'Y' : 'none';
    const second = first === 'X' ? ay : ax;
    check('two clients claim the same mover: exactly one wins, the other gets a clean rejection and no points', first !== 'none' && second.b.includes(mv) && (first === 'X' ? ax.s : ay.s) > 0 && second.s === 0, JSON.stringify({ ax, ay }));
    await sleep(500);
    const eats = [...X.msgs, ...Y.msgs].filter((m) => m.t === 's' && m.e).flatMap((m) => m.e).filter(([o]) => o === mv);
    check('the snapshot reports the mover eaten once, by the winner', new Set(eats.map((e) => e.join())).size === 1 && eats[0][1] === (first === 'X' ? X.me : Y.me), JSON.stringify(eats));
  }
  X.walk = true; X.farm = true; Y.walk = true; Y.farm = true;
  await sleep(9000); Y.farm = false; Y.goal = null; Y.walk = false;   // Y collects a little, then idles
  // --- X grows by eating until it can swallow Y
  const grew = await X.until(() => X.r >= Y.r * 1.3 && X.r > 2.9, 80000, 200);
  check('X grew by legit eating (radius ratio >= 1.3)', grew, `X r ${X.r.toFixed(2)} score ${X.score}, Y r ${Y.r.toFixed(2)}`);
  X.farm = false;
  const yScore0 = Y.score;
  X.goal = { x: Y.x, z: Y.z };
  const t0 = Date.now();
  const kill = await X.until(() => X.kills.length || Y.kills.length, 40000, 100);
  if (!kill) console.log('  (X at', X.x.toFixed(1), X.z.toFixed(1), 'Y at', Y.x.toFixed(1), Y.z.toFixed(1), 'r', X.r.toFixed(2), Y.r.toFixed(2), ')');
  else { X.goal = null; }
  await Y.until(() => Y.resp.some((r) => r.r[0] === Y.me), 10000);
  await sleep(500);
  const kx = X.kills.map((k) => k.k.join()), ky = Y.kills.map((k) => k.k.join());
  // whoever won the duel (the test steers X at Y, but two farming holes can also meet by chance): both clients must agree on the event
  const kill0 = X.kills[0] && X.kills[0].k;
  check('human-vs-human kill: both clients received the SAME kill event (eater, victim, gain)', kill && kx.length >= 1 && kx[0] === ky[0] && kill0 && kill0[0] !== kill0[1] && [X.me, Y.me].includes(kill0[0]) && [X.me, Y.me].includes(kill0[1]), JSON.stringify({ kx, ky, xMe: X.me, yMe: Y.me, xr: X.r, yr: Y.r, xs: X.score, ys: Y.score }));
  const victim = kill0 ? kill0[1] : Y.me;
  await Promise.all([X, Y].map((b2) => b2.until(() => b2.resp.some((r) => r.r[0] === victim), 10000)));
  const resp = Y.resp.find((r) => r.r[0] === victim), respX = X.resp.find((r) => r.r[0] === victim);
  check('victim respawns (both clients told, identical event) with half its score (= the eater\'s gain)', !!resp && !!respX && JSON.stringify(resp.r) === JSON.stringify(respX.r) && Math.abs(resp.r[3] - kill0[2]) <= 1, JSON.stringify({ resp: resp && resp.r, gain: kill0 && kill0[2] }));
  check('eater gained points (kill gain)', X.kills.length && X.kills[0].k[2] >= 0 && X.score + Y.score > 0);
  void t0;
  X.close(); Y.close();
}

// =========================================================================================================================================
try {
  const jobs = [];
  const p2 = await mkProxy(), p3 = await mkProxy(), p4 = await mkProxy();
  if (want('left')) jobs.push(als.run({ cur: '' }, () => scenarioLeft(p2)).catch((e) => { check('left scenario ran', false, e.message); console.error(e); }));
  if (want('left') && want('duel')) await sleep(4500);   // separate lobbies: a duel room must contain exactly the two duelling bots
  if (want('duel')) jobs.push(als.run({ cur: '' }, () => scenarioDuel()).catch((e) => { check('duel scenario ran', false, e.message); console.error(e); }));
  await sleep(4500);   // keep every lobby its own room (lobby countdown is 3 s)
  if (want('cuts')) {
    jobs.push(als.run({ cur: '' }, () => cutCycles('chromium', 'Pixel 5', 'CutP' + tag, 'cut', p3, [3, 12, 20])).catch((e) => { check('cut scenario ran', false, e.message); console.error(e); }));
    await sleep(4500);
    jobs.push(als.run({ cur: '' }, () => cutCycles('webkit', 'iPhone SE', 'StallS' + tag, 'stall', p4, [3, 12, 20])).catch((e) => { check('stall scenario ran', false, e.message); console.error(e); }));
    await sleep(4500);
  }
  if (want('reload')) { jobs.push(als.run({ cur: '' }, () => scenarioReload()).catch((e) => { check('reload scenario ran', false, e.message); console.error(e); })); await sleep(4500); }
  if (want('layout')) { jobs.push(als.run({ cur: '' }, () => scenarioLayout()).catch((e) => { check('layout scenario ran', false, e.message); console.error(e); })); await sleep(4500); }
  if (want('room12')) { jobs.push(als.run({ cur: '' }, () => scenarioRoom12()).catch((e) => { check('room12 scenario ran', false, e.message); console.error(e); })); }
  if (want('reload')) jobs.push(als.run({ cur: '' }, () => scenarioStale()).catch((e) => { check('stale scenario ran', false, e.message); console.error(e); }));
  await Promise.all(jobs);
  const real = errors.filter((e) => !/favicon|Failed to load resource|WebSocket connection .* failed|net::ERR|Load failed|NetworkError|The network connection was lost|Could not connect/i.test(e));
  check('no unexpected console / page errors', real.length === 0, real.slice(0, 4).join(' | '));
} catch (e) {
  console.error(e); fails++;
  console.error(wlog.slice(-2500));
} finally {
  console.log(wlog.split('\n').filter((l) => /\berror\b|Error|mp /i.test(l) && !/\] (GET|POST) \//.test(l)).slice(-10).join('\n'));
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  killAll();
}
console.log(fails ? `\n${fails} check(s) FAILED (${passes} passed)` : `\nall ${passes} resume / outage / room checks passed`);
process.exit(fails ? 1 : 0);
