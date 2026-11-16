// Multiplayer end-to-end test: the BUILT game served by a local `wrangler dev` (port 8793, own local D1, own build dir) with a short
// test round configured through `--var` overrides (never in wrangler.jsonc). Real Chromium (GPU=1 for the real GPU), 2-3 browser contexts.
//   GPU=1 node scripts/smoke-mp.mjs [--skip-table]    (--skip-table: reuse scripts/.dist-mp from the previous run)
// Screenshots: scripts/out/mp-*.png
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = 8793;
const BASE = `http://localhost:${PORT}`;
const ROUND = 70, LOBBY = 4;
const dist = path.join(root, 'scripts', '.dist-mp');
const state = path.join(root, 'scripts', '.mp-state');
const cfgPath = path.join(root, 'scripts', '.wrangler-mp.jsonc');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };

// ---- build ---------------------------------------------------------------------------------------------------
// One build snapshot: the table is dumped from it AND it is the build that gets served (sources are edited concurrently by other
// agents, so a separate vite build would drift away from the table).
if (!process.argv.includes('--skip-table')) run('node', ['tools/mp/build-objects.mjs'], { env: { ...process.env, PORT: process.env.PORT || '5186', MP_KEEP_DIST: 'scripts/.dist-mp' } });
// the table in public/mp must match the sources (fails loudly when it is stale; with --skip-table it guards the reused build)
run('node', ['tools/mp/check-objects.mjs']);
fs.rmSync(state, { recursive: true, force: true });
// temp wrangler config: same bindings as wrangler.jsonc but its own asset dir (the build above) and a throw-away local D1
const baseCfg = {
  name: 'bedre-mp-test', compatibility_date: '2026-11-01',
  assets: { directory: './.dist-mp', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
};
// Bundle the Worker ONCE (snapshot): other agents edit worker/** while this test runs and `wrangler dev` would hot-reload (= restart every Durable Object).
const bundleDir = path.join(root, 'scripts', '.mp-worker');
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir]);
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: './.mp-worker/index.js' }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state]);
const wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--persist-to', state,
  '--var', `MP_ROUND_SECONDS:${ROUND}`, '--var', `MP_LOBBY_SECONDS:${LOBBY}`, '--var', 'MP_RESULTS_SECONDS:25', '--var', 'MP_TEST_CLOSE_SPAWN:1'], { cwd: root, stdio: 'pipe' });
let wlog = '';
wr.stdout.on('data', (d) => (wlog += d)); wr.stderr.on('data', (d) => (wlog += d));
const killAll = () => { try { wr.kill('SIGTERM'); } catch {} };
process.on('exit', killAll);
for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/api/mp/status')).ok) break; } catch {} await sleep(500); if (i === 119) { console.error(wlog); throw new Error('wrangler dev not ready'); } }

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

  const real = errors.filter((e) => !/favicon|Failed to load resource.*(404|410|503)|WebSocket connection .* failed|net::ERR/.test(e));
  check('no console / page errors', real.length === 0, real.slice(0, 4).join(' | '));
  if (errors.length !== real.length) console.log(`  (ignored ${errors.length - real.length} expected network messages)`);
} catch (e) {
  console.error(e);
  fails++;
  console.error(wlog.slice(-2500));
} finally {
  console.log(wlog.split('\n').filter((l) => !/\] (GET|POST) \//.test(l) && /error|Error|mp /i.test(l)).slice(-12).join('\n'));
  try { await browser?.close(); } catch {}
  killAll();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall multiplayer checks passed');
process.exit(fails ? 1 : 0);
