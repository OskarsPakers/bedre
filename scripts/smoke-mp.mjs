// Multiplayer end-to-end test: the BUILT game served by a local `wrangler dev` (port 8793, own local D1, own build dir) with a short
// test round configured through `--var` overrides (never in wrangler.jsonc). Real Chromium (GPU=1 for the real GPU), 2-3 browser contexts.
//   GPU=1 [MP_PORT=8798] node scripts/smoke-mp.mjs [--skip-table]    (--skip-table: reuse scripts/.dist-mp[-port] from the previous run)
// (the cross-engine part - Chromium + WebKit + Firefox in one room - is scripts/smoke-engines.mjs; `npm run smoke:mp` runs both)
// Screenshots: scripts/out/mp-*.png
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, loadTableFile } from './lib/mp-bot.mjs';
import { speedOf } from '../worker/mp/sim.js';
import { tcpProxy } from './lib/tcp-proxy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.MP_PORT || 8793);        // MP_PORT=8798: own wrangler port; dirs below are suffixed with it so parallel runs never share a build / state dir
const SUFFIX = PORT === 8793 ? '' : `-${PORT}`;
const BASE = `http://localhost:${PORT}`;
const ROUND = 70, LOBBY = 4;
const dist = path.join(root, 'scripts', `.dist-mp${SUFFIX}`);
const state = path.join(root, 'scripts', `.mp-state${SUFFIX}`);
const cfgPath = path.join(root, 'scripts', `.wrangler-mp${SUFFIX}.jsonc`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };

// ---- build ---------------------------------------------------------------------------------------------------
// One build snapshot: the table is dumped from it AND it is the build that gets served (sources are edited concurrently by other
// agents, so a separate vite build would drift away from the table).
if (!process.argv.includes('--skip-table')) run('node', ['tools/mp/build-objects.mjs'], { env: { ...process.env, PORT: process.env.PORT || '5186', MP_TABLE_PORT: process.env.MP_TABLE_PORT || (PORT === 8793 ? process.env.PORT || '5186' : '5185'), MP_KEEP_DIST: `scripts/.dist-mp${SUFFIX}` } });
// the placement files (= the server's table) must match the sources (fails loudly when it is stale; with --skip-table it guards the reused build)
run('node', ['tools/mp/check-objects.mjs', '--dist', `scripts/.dist-mp${SUFFIX}`]);
fs.rmSync(state, { recursive: true, force: true });
// temp wrangler config: same bindings as wrangler.jsonc but its own asset dir (the build above) and a throw-away local D1
const baseCfg = {
  name: 'bedre-mp-test', compatibility_date: '2026-11-01',
  assets: { directory: `./.dist-mp${SUFFIX}`, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
};
// Bundle the Worker ONCE (snapshot): other agents edit worker/** while this test runs and `wrangler dev` would hot-reload (= restart every Durable Object).
const bundleDir = path.join(root, 'scripts', `.mp-worker${SUFFIX}`);
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir]);
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: `./.mp-worker${SUFFIX}/index.js` }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state]);
let wr = null, wlog = '';
const startWrangler = async (extraVars = [], round = ROUND) => {
  wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--persist-to', state,
    '--var', `MP_ROUND_SECONDS:${round}`, '--var', `MP_LOBBY_SECONDS:${LOBBY}`, '--var', 'MP_RESULTS_SECONDS:25', '--var', 'MP_TEST_CLOSE_SPAWN:1', ...extraVars.flatMap((v) => ['--var', v])], { cwd: root, stdio: 'pipe', detached: true });
  wr.stdout.on('data', (d) => (wlog += d)); wr.stderr.on('data', (d) => (wlog += d));
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/api/mp/status')).ok) return; } catch {} await sleep(500); if (i === 119) { console.error(wlog); throw new Error('wrangler dev not ready'); } }
};
const stopWrangler = async () => { try { process.kill(-wr.pid, 'SIGKILL'); } catch {} wr = null; await sleep(1500); };
const killAll = () => { try { if (wr) process.kill(-wr.pid, 'SIGKILL'); } catch {} };
process.on('exit', killAll);
await startWrangler();

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const mkPage = async (name, w = 1100, h = 680) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
    await page.addInitScript((n) => { try { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', 'en'); } catch {} }, name);
    await page.goto(`${BASE}/?quality=medium`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error(`[${name}] boot error`);
    return page;
  };
  const tag = Math.random().toString(36).slice(2, 6);
  const nameA = `SmkA${tag}`, nameB = `SmkB${tag}`, nameC = `SmkC${tag}`;
  const [A, B] = await Promise.all([mkPage(nameA), mkPage(nameB)]);
  const O = (p, fn, arg) => p.evaluate(fn, arg);
  const until = async (p, fn, arg, timeout = 30000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await p.evaluate(fn, arg)) return true; await sleep(step); } return false; };
  const shot = async (p, name) => { await p.waitForTimeout(250); await p.screenshot({ path: path.join(out, name) }); };

  const fxOnly = process.argv.includes('--fx-only');   // development: only the combos + power-ups phase
  if (!fxOnly) {
  // ---- server up, object table agrees ---------------------------------------------------------------------------
  const info = await (await fetch(BASE + '/api/mp/info')).json();
  const hashA = await O(A, () => window.__mpHash());
  check('object table hash: server == client world', info.hash === hashA, `server ${info.hash} client ${hashA} (${info.objects} objects)`);

  await shot(A, 'mp-start.png');
  // ---- join the lobby (two players) -----------------------------------------------------------------------------------
  await Promise.all([O(A, () => document.getElementById('play-online').click()), O(B, () => document.getElementById('play-online').click())]);
  check('both reach the lobby', (await until(A, () => window.__online.state === 'lobby', null, 15000)) && (await until(B, () => window.__online.state === 'lobby', null, 15000)));
  await until(A, () => (window.__online.lobby?.players.length || 0) >= 2, null, 8000);
  const lobA = await O(A, () => window.__online.lobby), lobB = await O(B, () => window.__online.lobby);
  check('same room, 2 humans listed on both sides', (await O(A, () => window.__online.room)) === (await O(B, () => window.__online.room)) && lobA.players.length === 2 && lobB.players.length === 2, JSON.stringify(lobA.players.map((p) => p.name)));
  check('lobby has a countdown', typeof lobA.startsAt === 'number');
  await shot(A, 'mp-lobby.png');

  // ---- synchronized start ----------------------------------------------------------------------------------------------
  check('both enter the intro', (await until(A, () => window.__online.state === 'intro', null, 15000)) && (await until(B, () => window.__online.state === 'intro', null, 15000)));
  const rA = await O(A, () => window.__online.round), rB = await O(B, () => window.__online.round);
  check('same startAt / playAt / endAt for both', rA.startAt === rB.startAt && rA.playAt === rB.playAt && rA.endAt === rB.endAt && rA.endAt - rA.playAt === ROUND * 1000, `round ${(rA.endAt - rA.playAt) / 1000}s, ${rA.holes.length} holes`);
  check('8 holes: 2 humans + 6 server bots', rA.holes.length === 8 && rA.holes.filter((h) => h.bot).length === 6);
  await shot(A, 'mp-intro.png');
  check('both playing', (await until(A, () => window.__online.state === 'playing', null, 10000)) && (await until(B, () => window.__online.state === 'playing', null, 10000)));
  const s0 = await Promise.all([A, B].map((p) => O(p, () => ({ ...window.__online.self, ss: window.__online.serverScore }))));
  check('everyone starts at start size and score 0', s0.every((s) => Math.abs(s.radius - 2.2) < 0.01 && s.score === 0 && s.ss === 0));
  const meA = await O(A, () => window.__online.me), meB = await O(B, () => window.__online.me);
  check('A and B are different holes', meA !== meB);

  // helpers inside the page
  const pickTarget = (p, maxFit, minD = 0, maxD = 80) => O(p, ([maxFit, minD, maxD]) => {
    const w = window.__life.world, pl = window.__online.self;
    let best = null, bd = 1e9;
    for (const o of w.objects) {
      if (o.state !== 0 || o.mover || o.fit >= maxFit) continue;
      const d = Math.hypot(o.x - pl.x, o.z - pl.z);
      if (d >= minD && d < maxD && d < bd) { bd = d; best = o; }
    }
    return best ? { id: best.id, x: best.x, z: best.z, fit: best.fit, value: best.value, d: bd } : null;
  }, [maxFit, minD, maxD]);
  const eatOne = async (p, maxFit) => {
    const tg = await pickTarget(p, maxFit);
    if (!tg) return null;
    await O(p, (t) => window.__online.drive(t.x, t.z), tg);
    const ok = await until(p, (id) => window.__life.world.objects[id].state !== 0, tg.id, 9000, 80);
    return ok ? tg : null;
  };

  // ---- B sees A move (interpolated), an object eaten by A disappears for B, scores come from the server ------------------
  const trackA = async () => O(B, (id) => { const r = window.__online.remotes().find((h) => h.id === id); return r ? { x: r.x, z: r.z, r: r.radius, score: r.score } : null; }, meA);
  const p0 = await trackA(), a0 = await O(A, () => window.__online.self);
  const eatenIds = [];
  for (let i = 0; i < 6; i++) { const t = await eatOne(A, 1.5); if (t) eatenIds.push(t); }
  await sleep(600);
  const p1 = await trackA(), a1 = await O(A, () => window.__online.self);
  check('A moved (legit eating by driving)', Math.hypot(a1.x - a0.x, a1.z - a0.z) > 5, `${Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(1)} m`);
  check('B sees A\'s hole move', p0 && p1 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 4, `B saw ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);
  check('B\'s interpolated A is close to A\'s real position (<= 12 m)', Math.hypot(p1.x - a1.x, p1.z - a1.z) < 12, `${Math.hypot(p1.x - a1.x, p1.z - a1.z).toFixed(1)} m`);
  check('A ate things (score > 0)', eatenIds.length >= 3 && a1.score > 0, `${eatenIds.length} objects, score ${a1.score}`);
  const gone = [];
  for (const t of eatenIds) gone.push(await until(B, (id) => window.__life.world.objects[id].state !== 0, t.id, 3000, 100));
  check('objects eaten by A are gone on B', gone.length > 0 && gone.every(Boolean), `${gone.filter(Boolean).length}/${gone.length}`);
  await O(A, () => window.__online.drive(null));
  await sleep(700);
  const ssA = await O(A, () => ({ ss: window.__online.serverScore, opt: window.__online.optimistic, score: window.__online.self.score }));
  const seenByB = (await trackA()).score;
  check('A\'s score = server score (nothing pending)', ssA.opt === 0 && Math.abs(ssA.ss - ssA.score) <= 1, JSON.stringify(ssA));
  check('B shows the same score for A (from the server)', Math.abs(seenByB - ssA.ss) <= 1, `B sees ${seenByB}`);
  await shot(A, 'mp-A-play.png'); await shot(B, 'mp-B-play.png');

  // ---- forged claims + speed hack are rejected ---------------------------------------------------------------------------
  const forge = await O(A, () => {
    const w = window.__life.world, pl = window.__online.self;
    let big = -1, far = -1, bd = 1e9;
    for (const o of w.objects) {
      const d = Math.hypot(o.x - pl.x, o.z - pl.z);
      if (o.state === 0 && o.fit > pl.radius * 1.3 && d < bd) { bd = d; big = o.id; } // nearest object that is too big for A
      if (far < 0 && o.state === 0 && !o.mover && o.fit < 1 && Math.hypot(o.x - pl.x, o.z - pl.z) > 400) far = o.id;
    }
    return { big, far };
  });
  const scoreBefore = await O(A, () => window.__online.serverScore);
  const eatenAlready = eatenIds[0].id;
  await O(A, (f) => window.__online.send({ t: 'u', q: 777001, c: f }), [forge.big, forge.far, eatenAlready].filter((x) => x >= 0));
  await until(A, () => window.__online.log.some((m) => m.t === 'a' && m.q === 777001), null, 4000);
  const ack = await O(A, () => window.__online.log.find((m) => m.t === 'a' && m.q === 777001));
  check('forged claims rejected: too big / far away / already eaten', ack && forge.big >= 0 && forge.far >= 0 && ack.b.length === 3 && ack.s === scoreBefore, `big ${forge.big} far ${forge.far} eaten ${eatenAlready} -> bad ${JSON.stringify(ack && ack.b)} score ${ack && ack.s} (was ${scoreBefore})`);
  const bigState = await O(B, (id) => window.__life.world.objects[id].state, forge.big);
  check('forged object untouched on the other client', bigState === 0);
  const pos = await O(A, () => window.__online.self);
  await O(A, (p) => window.__online.send({ t: 'u', q: 777002, x: p.x + 420, z: p.z }), pos);
  await until(A, () => window.__online.log.some((m) => m.t === 'rb'), null, 4000);
  const rb = await O(A, () => window.__online.log.find((m) => m.t === 'rb'));
  const posAfter = await trackA();
  check('speed hack (400 m jump) rubber-banded', !!rb && Math.hypot(rb.x - pos.x, rb.z - pos.z) < 40, rb ? `rb to (${rb.x}, ${rb.z}) from (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)})` : 'no rb');
  check('server position did not jump (B still sees A nearby)', posAfter && Math.hypot(posAfter.x - pos.x, posAfter.z - pos.z) < 60, posAfter ? `${Math.hypot(posAfter.x - pos.x, posAfter.z - pos.z).toFixed(0)} m` : '');

  // ---- A grows by legit eating and swallows B; B respawns -----------------------------------------------------------------------
  await eatOne(B, 0.8);   // B eats one small thing (so its score is > 0 but it stays small)
  await O(B, () => window.__online.drive(null));
  let growTries = 0;
  while ((await O(A, () => window.__online.self.score)) < 26 && growTries++ < 40) {
    const lim = await O(A, () => window.__online.self.radius * 0.9);
    const t = await eatOne(A, lim);
    if (!t) { // nothing near: walk somewhere new
      const pl = await O(A, () => window.__online.self);
      await O(A, (p) => window.__online.drive(p.x + 40, p.z - 25), pl); await sleep(1500);
    }
  }
  await O(A, () => window.__online.drive(null));
  await sleep(500);
  const grown = await O(A, () => ({ score: window.__online.self.score, r: window.__online.self.radius }));
  const bNow = await O(B, () => ({ ...window.__online.self, ss: window.__online.serverScore }));
  check('A grew by legit eating (radius ratio vs B >= 1.2)', grown.r / bNow.radius >= 1.2, `A score ${Math.round(grown.score)} r ${grown.r.toFixed(2)}, B score ${bNow.ss} r ${bNow.radius.toFixed(2)}`);
  const bPos = await O(A, (id) => window.__online.remotes().find((h) => h.id === id), meB);
  await O(A, (p) => window.__online.drive(p.x, p.z), bPos);
  const killed = await until(B, () => window.__online.self.dying || !window.__online.self.alive, null, 25000, 100);
  check('A swallowed B (hole vs hole, server authoritative)', killed);
  await O(A, () => window.__online.drive(null));
  const feedTxt = await O(A, () => document.getElementById('feed').textContent);
  check('kill feed shows it on A', feedTxt.includes(nameA) && feedTxt.includes(nameB), feedTxt.slice(0, 60));
  await shot(B, 'mp-B-swallowed.png');
  const respawned = await until(B, () => window.__online.self.alive && !window.__online.self.dying && window.__online.self.protectT > 0, null, 9000, 100);
  const bAfter = await O(B, () => ({ ...window.__online.self, ss: window.__online.serverScore }));
  check('B respawned after ~3 s with protection at 50% score', respawned && Math.abs(bAfter.ss - Math.round(bNow.ss * 0.5)) <= 1, `before ${bNow.ss} after ${bAfter.ss} protect ${bAfter.protectT.toFixed(1)}`);
  const aKills = await O(A, () => window.__online.self.kills);
  check('A has a kill', aKills >= 1);

  // ---- third client mid-round goes to the NEXT lobby ---------------------------------------------------------------------------
  const C = await mkPage(nameC, 900, 640);
  await O(C, () => document.getElementById('play-online').click());
  check('C reaches a lobby', await until(C, () => window.__online.state === 'lobby', null, 15000));
  const roomA = await O(A, () => window.__online.room), roomC = await O(C, () => window.__online.room);
  check('C is NOT in the running round (different room)', roomA !== roomC, `A ${roomA} C ${roomC}`);
  await until(C, () => !document.getElementById('mp-running').classList.contains('hidden'), null, 8000);
  const runTxt = await O(C, () => document.getElementById('mp-running').textContent);
  check('C\'s lobby shows the running round (time left + leaderboard rows, bots marked AI)', /Round in progress/.test(runTxt) && /AI/.test(runTxt), runTxt.slice(0, 90));
  const cCount = await O(C, () => document.getElementById('mp-count').textContent);
  check('C\'s lobby says "Next round starts in N s"', /Next round starts in \d+ s/.test(cCount), cCount);
  await shot(C, 'mp-C-next-lobby.png');

  // ---- disconnect + reconnect resumes the same hole -----------------------------------------------------------------------------
  const preDrop = await O(B, () => ({ me: window.__online.me, ss: window.__online.serverScore, eaten: window.__online.eatenIds().length }));
  await O(B, () => window.__online.drop());
  check('B notices the drop', await until(B, () => window.__online.reconnecting, null, 3000, 50));
  check('B resumes (same hole, same score, same eaten set)', await until(B, () => !window.__online.reconnecting && window.__online.state === 'playing' && window.__online.log.some((m) => m.t === 'resume'), null, 14000));
  const postDrop = await O(B, () => ({ me: window.__online.me, ss: window.__online.serverScore, eaten: window.__online.eatenIds().length }));
  console.log('  [debug B after drop]', JSON.stringify(await O(B, () => ({ st: window.__online.state, rec: window.__online.reconnecting, log: window.__online.log.slice(-6).map((m) => m.t + (m.code ? ':' + m.code : '')) }))));
  check('resumed identity/score preserved', postDrop.me === preDrop.me && postDrop.ss >= preDrop.ss - 1 && postDrop.eaten >= preDrop.eaten, JSON.stringify({ preDrop, postDrop }));
  await sleep(1200);
  const stillIn = await O(A, (id) => window.__online.remotes().some((h) => h.id === id), meB);
  check('A still sees B after the reconnect', stillIn);

  // ---- round ends for both with the same ranking, results, server-written rows -----------------------------------------------------
  const left = await O(A, () => Math.max(0, (window.__online.round.endAt - window.__online.serverNow()) / 1000));
  console.log(`  ... waiting ${left.toFixed(0)} s for the round to end`);
  await O(C, () => window.__online.leave());
  check('both rounds end', (await until(A, () => window.__online.state === 'ended', null, (left + 20) * 1000, 300)) && (await until(B, () => window.__online.state === 'ended', null, 20000, 300)));
  const fA = await O(A, () => window.__online.final), fB = await O(B, () => window.__online.final);
  check('same final ranking for both', JSON.stringify(fA) === JSON.stringify(fB) && fA.length === 8, fA.map((r) => `${r.rank}.${r.name}:${r.score}`).join(' '));
  const resTxt = await O(A, () => document.getElementById('r-table').textContent);
  check('results table lists both humans', resTxt.includes(nameA) && resTxt.includes(nameB));
  const hl = await O(A, () => ({ human: document.querySelectorAll('#r-table tr.human').length, bot: document.querySelectorAll('#r-table tr.bot').length, me: document.querySelectorAll('#r-table tr.me').length }));
  check('results: humans highlighted, bots marked', hl.human === 2 && hl.bot === 6 && hl.me === 1, JSON.stringify(hl));
  await shot(A, 'mp-results-A.png'); await shot(B, 'mp-results-B.png');
  check('server reports the scores as saved', (await until(A, () => window.__online.saved === true, null, 8000)) && (await until(B, () => window.__online.saved === true, null, 8000)));
  const rowsRes = await (await fetch(`${BASE}/api/scores?mode=online&period=day&limit=50`)).json();
  const rows = (rowsRes.scores || []).filter((r) => r.name === nameA || r.name === nameB);
  const rankA = fA.find((r) => r.name === nameA), rankB = fA.find((r) => r.name === nameB);
  check('one server-written online row per human with the ranking scores', rows.length === 2 && rows.find((r) => r.name === nameA)?.score === rankA.score && rows.find((r) => r.name === nameB)?.score === rankB.score, JSON.stringify(rows.map((r) => [r.name, r.score, r.rank])));
  const sql = spawnSync('npx', ['wrangler', 'd1', 'execute', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state, '--json', '--command', `SELECT name, mode, score, kills, deaths FROM scores WHERE name IN ('${nameA}','${nameB}')`], { cwd: root, encoding: 'utf8' });
  let dbRows = []; try { dbRows = JSON.parse(sql.stdout)[0].results; } catch {}
  check('rows have mode=online', dbRows.length === 2 && dbRows.every((r) => r.mode === 'online'), JSON.stringify(dbRows));
  const stA = await O(A, () => window.__online.stats), stB = await O(B, () => window.__online.stats);
  const secs = ROUND + 5;
  console.log(`  traffic A: in ${(stA.bytesIn / 1024).toFixed(0)} KB (${stA.msgIn} msgs, ${stA.snapshots} snapshots) out ${(stA.bytesOut / 1024).toFixed(1)} KB (${stA.msgOut} msgs) => ~${(stA.bytesIn / secs / 1024).toFixed(1)} KB/s down, ${(stA.bytesOut / secs / 1024).toFixed(2)} KB/s up (8 holes)`);
  console.log(`  traffic B: in ${(stB.bytesIn / 1024).toFixed(0)} KB (${stB.msgIn} msgs) out ${(stB.bytesOut / 1024).toFixed(1)} KB`);
  const pingA = await O(A, () => window.__online.rtt);
  console.log(`  ping A: ${pingA.toFixed(1)} ms`);

  // ---- play again -> back in a lobby; solo still works ------------------------------------------------------------------------------------
  await O(A, () => document.getElementById('again').click());
  check('Play again rejoins a lobby', await until(A, () => window.__online.state === 'lobby', null, 15000));
  await O(A, () => window.__online.leave());
  check('leaving online restores the solo menu', await until(A, () => !document.getElementById('start').classList.contains('hidden') && window.__game.state.phase === 'menu', null, 5000));
  await O(A, () => window.__game.start());
  await O(A, () => window.__game.skipIntro());
  await O(A, () => window.__game.step(2));
  const solo = await O(A, () => ({ phase: window.__game.state.phase, holes: window.__game.holes.length, bots: window.__game.holes.filter((h) => h.isBot).length }));
  check('solo mode works after online (phase playing, local bots)', solo.phase === 'playing' && solo.bots >= 7, JSON.stringify(solo));

  // ---- graceful fallback: server unavailable -> message, solo still works --------------------------------------------------------
  {
    const E = await mkPage('SmkE' + tag);
    await E.context().route('**/api/mp/join*', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }));
    await O(E, () => document.getElementById('play-online').click());
    check('unavailable server: friendly message, back at the menu', await until(E, () => /not available/i.test(document.getElementById('mp-status').textContent) && !document.getElementById('start').classList.contains('hidden'), null, 8000));
    await O(E, () => document.getElementById('play').click());
    check('solo still starts after a failed online attempt', await until(E, () => window.__game.state.phase === 'intro' || window.__game.state.phase === 'playing', null, 5000) && (await O(E, () => window.__online.state)) === 'idle');
    await shot(E, 'mp-unavailable.png');
    await E.context().close();
  }
  // ---- mobile layout + hostile name -------------------------------------------------------------------------------------------------
  {
    const D = await mkPage('<i>Bob</i>', 390, 780);
    await O(D, () => document.getElementById('play-online').click());
    check('mobile client reaches a lobby', await until(D, () => window.__online.state === 'lobby', null, 15000));
    await shot(D, 'mp-mobile-lobby.png');
    const lobTxt = await O(D, () => document.getElementById('mp-players').innerHTML);
    check('hostile name sanitised server-side (no markup in the lobby list)', !/[<>]/.test(lobTxt.replace(/<\/?(li|i|span|em)[^>]*>/g, '')) && !/Bob<\/i>/.test(lobTxt), lobTxt.replace(/<[^>]+>/g, ' ').trim().slice(0, 40));
    const fits = await O(D, () => { const r = document.querySelector('#mp-lobby .panel-inner').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
    check('lobby panel fits the phone screen', fits);
    await O(D, () => window.__online.leave());
    await D.context().close();
  }

  }   // (end of the classic multiplayer phase)

  // ==================================================================================================================================
  // COMBOS + POWER-UPS online: a second server instance with test variables (MP_TEST_PU: the first pickups sit next to the humans' starts,
  // MP_TEST_START_MASS: human 0 - the protocol bot that joins first - starts as a big hole). 3 real browsers (one of them behind a 300 ms-each-way
  // lag proxy) + the protocol bot against the REAL server: same pickups for everybody, one winner per pickup, effects applied by the server,
  // forged claims rejected, shield vs a bigger hole, a laggy player keeps combos, reconnect in the middle of an effect.
  // ==================================================================================================================================
  {
    console.log('  --- online combos + power-ups ---');
    await stopWrangler();
    await startWrangler(['MP_TEST_PU:1', 'MP_TEST_START_MASS:3000', 'MP_BOT_GRACE:300', 'MP_BOT_SKILL:0.2', 'MP_TEST_FX_SCALE:3'], 400);   // (a 6.5 minute round: the steps below take a few minutes)   // (effects last 3x longer here: the browser steps are slower than 6 s)
    const table = loadTableFile(dist);
    const proxy = tcpProxy(PORT + 100, PORT); await proxy.listen();   // (no lag while the page loads; the lag starts before it joins)
    const LAGBASE = `http://localhost:${PORT + 100}`;
    const mkLag = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 620 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
      await page.addInitScript((n) => { try { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', 'en'); } catch {} }, name);
      await page.goto(`${LAGBASE}/?quality=low`);
      await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
      return page;
    };
    // (named Big...: MP_TEST_START_MASS goes to the human whose name starts with it)
    const P = new Bot({ base: BASE, name: 'Big' + tag, table }); P.walk = false;
    const A2 = await mkPage('PuA' + tag), B2 = await mkPage('PuB' + tag), L2 = await mkLag('PuL' + tag);   // (pages first: the 4 s lobby starts with the bot's join)
    proxy.delay(300, 60);
    await P.join();                                   // human 0: the first to join gets MP_TEST_START_MASS (a big hole)
    const room2 = P.room;
    await Promise.all([A2, B2, L2].map((p) => O(p, () => document.getElementById('play-online').click())));
    check('p2: three browsers + the bot are in the same lobby', await Promise.all([A2, B2, L2].map((p) => until(p, (r) => window.__online.room === r && window.__online.state === 'lobby', room2, 15000))).then((a) => a.every(Boolean)));
    check('p2: everybody is playing', (await Promise.all([A2, B2, L2].map((p) => until(p, () => window.__online.state === 'playing', null, 30000)))).every(Boolean) && await P.until(() => P.state === 'playing', 20000));
    await sleep(500);

    // ---- same power-ups for everyone (server list: browsers + protocol client agree), not part of the objects
    const lists = await Promise.all([A2, B2, L2].map((p) => O(p, () => window.__online.powerups.slice().sort((a, b) => a[0] - b[0]))));
    const botList = [...P.pu.values()].map((q) => [q.slot, q.type, q.x, q.z]).sort((a, b) => a[0] - b[0]);
    const TYPES = ['magnet', 'speed', 'double', 'shield'];
    const norm = (l) => JSON.stringify(l.map((r) => [r[0], typeof r[1] === 'number' ? TYPES[r[1]] : r[1], Math.round(r[2] * 10) / 10, Math.round(r[3] * 10) / 10]));
    check('p2: every client sees the same pickups (slots, types, positions) as the server sent', lists.every((l) => norm(l) === norm(lists[0])) && norm(botList) === norm(lists[0]) && lists[0].length >= 6, `${lists[0].length} pickups, types ${[...new Set(lists[0].map((r) => r[1]))].join()}`);
    check('p2: all four types are present', new Set(lists[0].map((r) => r[1])).size === 4);
    check('p2: pickups are not objects: the world still has exactly the placement file\'s objects and no pickup id is among the eaten ones', (await O(A2, () => window.__life.world.objects.length)) === table.n && (await O(A2, () => window.__online.eatenIds().every((id) => id < window.__life.world.objects.length))));
    await shot(A2, 'powerup-online-start.png');

    // ---- the race: A and B both drive to slot 0 (Ātrums); exactly one wins
    const s0 = lists[0].find((r) => r[0] === 0);
    await Promise.all([A2, B2].map((p) => O(p, (t) => window.__online.drive(t[2], t[3]), s0)));
    await Promise.all([A2, B2].map((p) => until(p, () => !window.__online.powerups.some((r) => r[0] === 0), null, 15000, 100)));
    await sleep(600);
    const fxA = await O(A2, () => ({ fx: window.__online.fx, picks: window.__online.picks })), fxB = await O(B2, () => ({ fx: window.__online.fx, picks: window.__online.picks }));
    const winners = [fxA, fxB].filter((f) => f.picks.speed > 0);
    check('p2: exactly one winner for the contested pickup', winners.length === 1 && fxA.picks.speed + fxB.picks.speed === 1, JSON.stringify([fxA.picks, fxB.picks]));
    check('p2: the token is gone for every client (the lagged one a little later)', (await Promise.all([A2, B2, L2].map((p) => until(p, () => window.__online.powerups.every((r) => r[0] !== 0), null, 4000, 100)))).every(Boolean));
    console.log('  [lagged client]', JSON.stringify(await O(L2, () => ({ st: window.__online.state, rtt: Math.round(window.__online.rtt), lastRx: Math.round(window.__online.lastRxAge), snaps: window.__online.stats.snapshots, rec: window.__online.reconnecting, pu: window.__online.powerups.length, log: window.__online.log.slice(-4).map((m) => m.t) }))));
    const W = fxA.picks.speed ? A2 : B2, Lz = fxA.picks.speed ? B2 : A2, wMe = await O(W, () => window.__online.me);
    const wfx = await O(W, () => window.__online.fx);
    check('p2: the server started the effect (Ātrums on the winner: 6 s x3 test scale, none on the loser)', wfx.speed > 6 && wfx.speed <= 18.2 && (await O(Lz, () => window.__online.fx.speed)) === 0, `winner speed fx ${wfx.speed.toFixed(1)} s`);
    check('p2: the other clients see the effect on the winner (snapshot mask)', await until(L2, (id) => { const r = window.__online.remotes().find((h) => h.id === id); return !!r && r.fx.speed > 0; }, wMe, 3000, 100));
    await shot(W, 'powerup-online-pickup.png');
    // reconnect in the middle of the effect: the server still knows it
    const before = await O(W, () => window.__online.fx.speed);
    await O(W, () => window.__online.drop());
    check('p2: reconnect mid-effect: resumes with the effect still running', await until(W, () => !window.__online.reconnecting && window.__online.state === 'playing' && window.__online.log.some((m) => m.t === 'resume'), null, 14000) && (await O(W, () => window.__online.fx.speed)) > 0 && (await O(W, () => window.__online.fx.speed)) <= before + 0.2, `before ${before.toFixed(1)} after ${await O(W, () => window.__online.fx.speed)}`);
    await Promise.all([A2, B2].map((p) => O(p, () => window.__online.drive(null))));

    // ---- forged claims through the protocol client
    const farSlot = [...P.pu.values()].find((q) => Math.hypot(q.x - P.x, q.z - P.z) > 60);
    const q0 = P.seq + 5000;
    P.send({ t: 'u', q: q0, x: P.x, z: P.z, p: [farSlot.slot, 0, 99] });
    P.send({ t: 'u', q: q0 + 1, x: P.x, z: P.z, c: [], mult: 99, score: 1e9, fx: [9, 9, 9, 9], combo: 500 });
    await P.until(() => P.acks.some((a) => a.q === q0), 4000);
    const ackF = P.acks.find((a) => a.q === q0);
    check('p2: forged pickup claims (far slot, taken slot, bogus slot) are rejected by the server', ackF && ackF.pb.length === 3 && P.mask === 0 && (P.fx || []).every((v) => v === 0) , JSON.stringify(ackF));
    const scoreP = P.score;
    await sleep(500);
    check('p2: a forged multiplier / score field changes nothing', P.score === scoreP && P.score < 100000 && P.state === 'playing', `score ${P.score}`);
    P.walk = false; P.state = 'paused';   // (the bot's own 12 Hz position frames stop while the forged ones are sent)
    const rb0 = P.msgs.filter((m) => m.t === 'rb').length;
    let ex = P.x; const stepV = speedOf(P.r) * 1.9 / 12;
    for (let i = 0; i < 70; i++) { ex += stepV; P.send({ t: 'u', q: ++P.seq, x: Math.round(ex * 10) / 10, z: P.z }); await sleep(83); }
    check('p2: claiming a speed boost without the pickup (1.9x speed) gets rubber-banded', P.msgs.filter((m) => m.t === 'rb').length > rb0);
    P.state = 'playing';

    // ---- A collects Dubultpunkti + Magnēts (next to its start), swallows a few things with them, then takes the shield; the big hole (human 0, the bot) goes for it
    const eatSome = async (pg, n, maxFit) => {
      for (let i = 0; i < n; i++) {
        const tg = await O(pg, (mf) => { const w = window.__life.world, pl = window.__online.self; let best = null, bd = 1e9; for (const o of w.objects) { if (o.state !== 0 || o.mover || o.fit >= mf) continue; const d = Math.hypot(o.x - pl.x, o.z - pl.z); if (d < 80 && d < bd) { bd = d; best = o; } } return best ? { id: best.id, x: best.x, z: best.z } : null; }, maxFit);
        if (!tg) break;
        await O(pg, (t) => window.__online.drive(t.x, t.z), tg);
        await until(pg, (id) => window.__life.world.objects[id].state !== 0, tg.id, 9000, 80);
      }
      await O(pg, () => window.__online.drive(null));
    };
    const driveTo = async (pg, type, tmo = 20000) => {
      const row = (await O(pg, () => window.__online.powerups)).filter((r) => (typeof r[1] === 'number' ? TYPES[r[1]] : r[1]) === type);
      const pl = await O(pg, () => window.__online.self);
      row.sort((a, b2) => Math.hypot(a[2] - pl.x, a[3] - pl.z) - Math.hypot(b2[2] - pl.x, b2[3] - pl.z));
      row.sort((a, b2) => Math.hypot(a[2] - pl.x, a[3] - pl.z) - Math.hypot(b2[2] - pl.x, b2[3] - pl.z));
      if (!row.length) { console.log('  [driveTo]', type, 'no such pickup'); return false; }
      await O(pg, (t) => window.__online.drive(t[2], t[3]), row[0]);
      const ok = await until(pg, (ty) => window.__online.fx[ty] > 0, type, tmo, 100);
      if (!ok) console.log('  [driveTo]', type, 'timed out; target', JSON.stringify(row[0]), 'now', JSON.stringify(await O(pg, () => ({ ...window.__online.self, fx: window.__online.fx }))));
      await O(pg, () => window.__online.drive(null));
      return ok;
    };
    await until(A2, () => window.__online.self.alive && !window.__online.self.dying, null, 9000, 100);
    // the big hole (protocol bot) waits ~30 m from A: close enough to be on top of it within a second once A has the shield, too far to reach it before
    { const ap = await O(A2, () => window.__online.self), bp = await O(B2, () => window.__online.self);
      let dx = bp.x - ap.x, dz = bp.z - ap.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;   // 30 m from A on the side of B: far from the pickups next to A (they sit on its other sides)
      // the waiting spot must also be away from EVERY pickup (the layout depends on the room seed: a shield 10 m from the waiting hole made A drive into it and get eaten)
      const pus = await O(A2, () => window.__online.powerups);
      let gx = ap.x + dx * 30, gz = ap.z + dz * 30, best = -1;
      for (let k = 0; k < 12; k++) {        // 12 spots 30 m around A: take the one furthest from every pickup (the waiting hole must not sit next to a pickup A drives to)
        const ang = k * Math.PI / 6, cx = ap.x + (dx * Math.cos(ang) - dz * Math.sin(ang)) * 30, cz = ap.z + (dx * Math.sin(ang) + dz * Math.cos(ang)) * 30;
        const dmin = Math.min(1e9, ...pus.map((r) => Math.hypot(r[2] - cx, r[3] - cz)));
        if (dmin > best + (k === 0 ? 0 : 8)) { best = dmin; gx = cx; gz = cz; }
      }
      console.log('  [P before]', JSON.stringify({ x: P.x, z: P.z, r: P.r, st: P.st, state: P.state, goal: [gx, gz] }));
      P.goal = { x: gx, z: gz }; P.walk = true; await P.until(() => Math.hypot(P.x - gx, P.z - gz) < 3, 30000); console.log('  [P after]', JSON.stringify({ x: P.x, z: P.z, rb: P.msgs.filter((m) => m.t === 'rb').length })); P.walk = false; P.goal = null; }
    const gotD = await driveTo(A2, 'double'), gotM = await driveTo(A2, 'magnet');
    check('p2: A collects Dubultpunkti and Magnēts (server effects, 12 s / 8 s x3, both running at once)', gotD && gotM && (await O(A2, () => window.__online.fx.double > 8 && window.__online.fx.magnet > 6)), JSON.stringify(await O(A2, () => window.__online.fx)));
    console.log('  [lagged client 2]', JSON.stringify(await O(L2, () => ({ st: window.__online.state, rtt: Math.round(window.__online.rtt), lastRx: Math.round(window.__online.lastRxAge), snaps: window.__online.stats.snapshots, rec: window.__online.reconnecting, remotes: window.__online.remotes().map((h) => [h.id, h.fx.double, h.fx.magnet]) }))));
    check('p2: the others see both effects on A (snapshot mask)', await until(L2, (id) => { const r = window.__online.remotes().find((h) => h.id === id); return !!r && r.fx.double > 0 && r.fx.magnet > 0; }, await O(A2, () => window.__online.me), 3000, 100));
    const pts0 = await O(A2, () => ({ s: window.__online.serverScore, m: window.__online.serverMass }));
    await eatSome(A2, 4, 1.2);
    await sleep(500);
    const pts1 = await O(A2, () => ({ s: window.__online.serverScore, m: window.__online.serverMass, c: window.__online.combo.best }));
    check('p2: with Dubultpunkti the server counts double points (points gained >= 1.9 x mass gained; the size follows the mass)', pts1.m > pts0.m && (pts1.s - pts0.s) >= 1.9 * (pts1.m - pts0.m), JSON.stringify([pts0, pts1]));
    const gotShield = await driveTo(A2, 'shield');
    check('p2: A collects the shield (server effect, ~8 s)', gotShield, JSON.stringify(await O(A2, () => window.__online.fx)));
    await shot(A2, 'powerup-online-badges.png');
    const aPos = await O(A2, () => window.__online.self), shLeft = await O(A2, () => window.__online.fx.shield);
    const kills0 = P.kills.length, aId = await O(A2, () => window.__online.me);   // the kill feed holds every kill of the room (server bots hunt each other too): only a kill of A counts
    P.walk = true; P.goal = { x: aPos.x, z: aPos.z };
    const chase = setInterval(() => { P.goal = { x: aPos.x, z: aPos.z }; }, 400);
    const onTop = await P.until(() => Math.hypot(P.x - aPos.x, P.z - aPos.z) < 6, 12000);
    await sleep(900);
    const aliveShield = await O(A2, () => window.__online.self.alive && !window.__online.self.dying && window.__online.fx.shield > 0);
    check('p2: a much bigger hole sits on the shielded A and cannot swallow it', onTop && aliveShield && !P.kills.slice(kills0).some((x) => x.k[1] === aId), `on top ${onTop}, shield left ${shLeft.toFixed(1)} s, kills of A ${P.kills.slice(kills0).filter((x) => x.k[1] === aId).length} (room kills meanwhile ${P.kills.length - kills0}), P at (${P.x.toFixed(0)}, ${P.z.toFixed(0)}) r ${P.r.toFixed(1)} st ${P.st} state ${P.state}, A at (${aPos.x.toFixed(0)}, ${aPos.z.toFixed(0)})`);
    await shot(A2, 'powerup-online-shield.png');
    const swallowed = await until(A2, () => window.__online.self.dying || !window.__online.self.alive, null, 40000, 150);
    clearInterval(chase); P.walk = false; P.goal = null;
    check('p2: ...and swallows it once the shield has run out', swallowed);
    await until(A2, () => window.__online.self.alive && !window.__online.self.dying, null, 9000, 150);

    // ---- combos online: a greedy chain on A (direct) and on L (300 ms each way): the SERVER's combo follows
    const chainRun = (p, ms) => O(p, (ms) => new Promise((resolve) => {
      const o = window.__online, w = window.__life.world, t0 = performance.now();
      let maxC = 0, maxCm = 1, seen = new Set(), best = 0, rbs = 0;
      const iv = setInterval(() => {
        for (const m of o.log) { if (m.t === 'a' && !seen.has(m.q)) { seen.add(m.q); maxC = Math.max(maxC, m.c || 0); maxCm = Math.max(maxCm, m.cm || 1); } if (m.t === 'rb' && !seen.has('rb' + m.at)) { seen.add('rb' + m.at); rbs++; } }
        best = Math.max(best, o.combo.best);
        const pl = o.self; let tgt = null, bs = 0;
        w.query(pl.x, pl.z, Math.max(20, pl.radius * 8), (ob, d) => { if (ob.state !== 0 || ob.mover || ob.fit >= pl.radius * 0.9) return; const sc = ob.value / (d + pl.radius + 3); if (sc > bs) { bs = sc; tgt = ob; } });
        if (tgt) o.drive(tgt.x, tgt.z);
        if (performance.now() - t0 > ms) { clearInterval(iv); o.drive(null); resolve({ maxC, maxCm, acks: [...seen].filter((x) => typeof x === 'number').length, rbs, rtt: Math.round(o.rtt), pos: [Math.round(o.self.x), Math.round(o.self.z)], alive: o.self.alive, pending: o.pending, lastRx: Math.round(o.lastRxAge), best: Math.max(best, o.combo.best), local: o.combo.best, score: o.self.score, mass: o.self.mass, serverMass: o.serverMass }); }
      }, 120);
    }), ms);
    const [cA, cL] = await Promise.all([chainRun(A2, 16000), chainRun(L2, 16000)]);
    console.log('  [chain] direct', JSON.stringify(cA), ' lagged', JSON.stringify(cL));
    check('p2: direct client: the server-side combo follows (>= 80% of the local counter) and has a multiplier', cA.best >= 8 && cA.maxC >= cA.best * 0.8 && cA.maxCm >= 1.2, JSON.stringify(cA));
    check('p2: 300 ms-each-way client keeps its combo (server counter >= 80% of the local one, multiplier reached)', cL.best >= 8 && cL.maxC >= cL.best * 0.8 && cL.maxCm >= 1.2, JSON.stringify(cL));
    check('p2: score > mass for both (points are multiplied, the size follows the mass)', cA.score > cA.mass && cL.score > cL.mass, `${cA.score}/${cA.mass} ${cL.score}/${cL.mass}`);
    await shot(L2, 'powerup-online-combo.png');

    P.close(); proxy.close();
    for (const pg of [A2, B2, L2]) { try { await O(pg, () => window.__online.leave()); } catch {} await pg.context().close(); }
  }

  const real = errors.filter((e) => !/favicon|Failed to load resource.*(404|410|503)|WebSocket connection .* failed|net::ERR/.test(e));
  check('no console / page errors', real.length === 0, real.slice(0, 4).join(' | '));
  if (errors.length !== real.length) console.log(`  (ignored ${errors.length - real.length} expected network messages)`);
} catch (e) {
  console.error(e);
  fails++;
  console.error(wlog.slice(-2500));
} finally {
  console.log(wlog.split('\n').filter((l) => !/\] (GET|POST) \//.test(l) && /error|Error|mp /i.test(l)).slice(-12).join('\n'));
  if (process.env.MP_DEBUG) console.log(wlog.split('\n').filter((l) => /mp dbg/.test(l)).slice(0, 25).join('\n'));
  try { await browser?.close(); } catch {}
  killAll();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall multiplayer checks passed');
process.exit(fails ? 1 : 0);
