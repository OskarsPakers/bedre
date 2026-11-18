// Friend rooms (private online rooms) + skins end-to-end: the BUILT game served by a local `wrangler dev` (own build dir, own local D1, short rounds
// through `--var` overrides, never in wrangler.jsonc). Stages:
//   1  HTTP: create / look up / unknown + malformed codes, same-origin rule, public matchmaking never sees a private room (and the other way round)
//   2  protocol (headless clients on the real wire format): host controls (only the host can start / configure), no countdown, bots / no bots, skin ids
//      validated and relayed, late arrival waits + watches, 12 humans max, old protocol refused with the server's version, ranked only with >= 2 humans and
//      the standard length (leaderboard rows checked), rematch returns everybody to the same lobby, host migration, reconnect mid-round resumes, expired code
//   3  browsers (Chromium host, WebKit iPhone 13 guest by LINK, Firefox guest by CODE): create -> link -> lobby -> host starts -> identical results ->
//      Rematch -> host leaves -> migration; skins of the peers rendered as equipped; reload mid-round resumes; expired link -> friendly dialog -> new room;
//      another live session -> prompt; stale protocol -> reload offer. Screenshots scripts/out/f45-*.png
//   4  limits: room creation + failed lookups are rate limited per IP hash (second wrangler with small limits)
//   GPU=1 [FR_PORT=8793] node scripts/smoke-friends.mjs [--no-browsers] [--skip-build]
import { chromium, webkit, firefox, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, loadTableFile } from './lib/mp-bot.mjs';
import { SKINS } from '../src/skins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.FR_PORT || 8793);
const BASE = `http://localhost:${PORT}`;
const ROUND = 36, SHORT = Math.max(5, Math.round(ROUND * 0.4)), TTL = 30000;
const dist = path.join(root, 'scripts', '.dist-f45');
const state = path.join(root, 'scripts', '.f45-state');
const cfgPath = path.join(root, 'scripts', '.wrangler-f45.jsonc');
const bundleDir = path.join(root, 'scripts', '.f45-worker');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };
const arg = (a) => process.argv.includes(a);
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const until = async (fn, timeout = 20000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; await sleep(step); } return false; };

// ---- build + server -------------------------------------------------------------------------------------------------------
if (!arg('--skip-build')) run('npx', ['vite', 'build', '--outDir', 'scripts/.dist-f45', '--emptyOutDir', '--logLevel', 'error']);
fs.rmSync(state, { recursive: true, force: true });
const baseCfg = {
  name: 'bedre-f45-test', compatibility_date: '2026-11-01',
  assets: { directory: './.dist-f45', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
};
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir], { stdio: 'pipe' });
fs.writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, main: './.f45-worker/index.js' }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state], { stdio: 'pipe' });
let wr = null, wlog = '';
const startWrangler = async (vars) => {
  wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: root, stdio: 'pipe', detached: true });
  wr.stdout.on('data', (d) => (wlog += d)); wr.stderr.on('data', (d) => (wlog += d));
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/api/mp/status')).ok) return; } catch {} await sleep(500); if (i === 119) { console.error(wlog); throw new Error('wrangler dev not ready'); } }
};
const stopWrangler = async () => { try { process.kill(-wr.pid, 'SIGKILL'); } catch {} wr = null; await sleep(1500); };
process.on('exit', () => { try { if (wr) process.kill(-wr.pid, 'SIGKILL'); } catch {} });
const MAIN_VARS = { MP_ROUND_SECONDS: ROUND, MP_LOBBY_SECONDS: 4, MP_RESULTS_SECONDS: 25, MP_PRIV_TTL_MS: TTL, MP_TEST_CLOSE_SPAWN: 1, RATE_PRIV_CREATE: 60, RATE_PRIV_FAIL: 40, MP_REMOVE_AFTER_MS: 12000 };
await startWrangler(MAIN_VARS);

const post = (p, body = {}, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const getJson = async (p) => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const create = async (token) => { const r = await post('/api/mp/room', token ? { token } : {}); return { status: r.status, j: await r.json().catch(() => null) }; };
const table = loadTableFile(dist);
const mkBot = (name, opts = {}) => new Bot({ base: BASE, name, table, priv: true, ...opts });
const tag = Math.random().toString(36).slice(2, 6);
const board = async () => (await (await fetch(BASE + '/api/scores?mode=online&map=centrs&period=all&limit=50')).json()).scores || [];

const errors = [];
try {
  // =====================================================================================================================================
  console.log('\n== stage 1: HTTP');
  const c1 = await create();
  const ALPHA = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  check('POST /api/mp/room -> 201 + a 6-symbol code from the unambiguous alphabet', c1.status === 201 && ALPHA.test(c1.j.code) && c1.j.max === 12, JSON.stringify(c1.j));
  const i1 = await getJson('/api/mp/room?code=' + c1.j.code);
  check('GET /api/mp/room?code= -> the lobby is open', i1.status === 200 && i1.j.ok && i1.j.phase === 'lobby' && i1.j.humans === 0, JSON.stringify(i1.j));
  check('lower-case / spaced input is normalised', (await getJson('/api/mp/room?code=' + c1.j.code.toLowerCase().slice(0, 3) + '-' + c1.j.code.toLowerCase().slice(3))).status === 200);
  const un = await getJson('/api/mp/room?code=ZZZZZZ'), bad = await getJson('/api/mp/room?code=abc'), bad2 = await getJson('/api/mp/room?code=ABCDE0');
  check('unknown / malformed codes -> 404 {error: noroom}', un.status === 404 && un.j.error === 'noroom' && bad.status === 404 && bad2.status === 404);
  const xo = await post('/api/mp/room', {}, { origin: 'https://evil.example' });
  check('cross-origin room creation refused', xo.status === 403);
  const codes = new Set(); for (let i = 0; i < 6; i++) codes.add((await create()).j.code);
  check('room codes differ', codes.size === 6);
  // public matchmaking vs private rooms
  const pj = await (await post('/api/mp/join')).json();
  check('public matchmaking hands out a public room name (lower case), never a code', /^[a-z0-9]{6,24}$/.test(pj.room) && !ALPHA.test(pj.room), pj.room);
  const st = await (await fetch(BASE + '/api/mp/status')).json();
  check('the lobby status never lists private rooms', st.running.length === 0 && (!st.open || st.open.humans <= 1));
  const wsTry = (qs, hdr) => new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/api/mp/ws?${qs}`); let done = false; const fin = (v) => { if (!done) { done = true; try { w.close(); } catch {} res(v); } }; w.onopen = () => fin('open'); w.onerror = () => fin('error'); setTimeout(() => fin('timeout'), 5000); });
  check('a private code through the PUBLIC route is refused', (await wsTry('room=' + c1.j.code)) === 'error');
  check('a public room name through the PRIVATE route is refused', (await wsTry('priv=' + pj.room)) === 'error');
  check('a private room only opens through ?priv=', (await wsTry('priv=' + c1.j.code)) === 'open');

  // =====================================================================================================================================
  console.log('\n== stage 2: protocol');
  // an expiring room (nobody joins): checked at the end of this stage
  const expiring = (await create()).j.code;

  const H = mkBot(`FrH${tag}`, { sk: [3, 4, 2] });
  const hc = await create(H.token);
  const code = hc.j.code;
  await H.join(code);
  check('host joins its private room', await until(() => H.state === 'lobby'));
  const l0 = H.lobbyMsg;
  check('lobby frame: priv, code, host is the creator, defaults 5:00 + bots, nobody else yet', l0.priv === true && l0.code === code && l0.host === H.me && l0.cfg.len === 300 && l0.cfg.bots === true && l0.players.length === 1 && l0.ranked === false && l0.startsAt === null && l0.max === 12, JSON.stringify(l0));
  check('host skin relayed in the lobby', JSON.stringify(l0.players[0].sk) === '[3,4,2]');
  const G = mkBot(`FrG${tag}`, { sk: [99, -1, 'x'] });
  await G.join(code);
  check('guest joins by code', await until(() => G.state === 'lobby' && G.lobbyMsg.players.length === 2));
  check('guest: not the host; invalid skin ids defaulted to [0,0,0]', G.lobbyMsg.host === H.me && G.me !== H.me && JSON.stringify(G.lobbyMsg.players.find((p) => p.id === G.me).sk) === '[0,0,0]');
  check('host sees the guest; ranked hint flips with 2 humans + 5:00', await until(() => H.lobbyMsg.players.length === 2 && H.lobbyMsg.ranked === true));
  await sleep(5500);   // the public lobby countdown here is 4 s: a private room has none
  check('NO automatic countdown in a private lobby', H.state === 'lobby' && G.state === 'lobby' && H.lobbyMsg.startsAt === null);
  G.send({ t: 'go' }); G.send({ t: 'cfg', len: 120, bots: false });
  await sleep(1200);
  check('only the host can start or configure (guest frames ignored)', H.state === 'lobby' && G.state === 'lobby' && H.lobbyMsg.cfg.len === 300 && H.lobbyMsg.cfg.bots === true);
  H.send({ t: 'cfg', len: 120, bots: true });
  check('host chooses 2:00 -> lobby says unranked', await until(() => G.lobbyMsg.cfg.len === 120 && G.lobbyMsg.ranked === false));
  H.send({ t: 'cfg', len: 300, bots: true });
  check('host back to 5:00 -> ranked again', await until(() => G.lobbyMsg.cfg.len === 300 && G.lobbyMsg.ranked === true));
  // old protocol refused with the server's version (the client turns it into the reload offer)
  const old = mkBot(`FrO${tag}`);
  const oldWs = await new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/api/mp/ws?priv=${code}`); const frames = []; w.onmessage = (e) => frames.push(JSON.parse(e.data)); w.onopen = () => w.send(JSON.stringify({ t: 'hello', v: 2, name: 'Old', token: 'oldtoken12345', hash: table.hash })); setTimeout(() => { try { w.close(); } catch {} res(frames); }, 1500); });
  check('an old-protocol client is refused with {code: version, sv}', oldWs.some((f) => f.t === 'err' && f.code === 'version' && f.sv === 3));
  // late arrivals / full room are covered below; start the round
  const t0 = Date.now();
  H.farm = true; G.farm = true;
  H.send({ t: 'go' });
  check('host starts: both receive the round layout (same ids, skins relayed)', await until(() => H.start && G.start, 8000));
  const hs = H.start.holes;
  check('8 holes: 2 humans + 6 bots (bots fill by default); everybody gets the same layout', hs.length === 8 && hs.filter((h) => h.bot).length === 6 && JSON.stringify(H.start.holes.map((h) => h.id)) === JSON.stringify(G.start.holes.map((h) => h.id)) && H.start.endAt === G.start.endAt && H.start.priv && H.start.priv.ranked === true, `${Date.now() - t0} ms after Start`);
  check('start frame relays the skins (host [3,4,2], guest [0,0,0], bots have a rim only)', JSON.stringify(hs.find((h) => h.id === H.me).sk) === '[3,4,2]' && JSON.stringify(hs.find((h) => h.id === G.me).sk) === '[0,0,0]' && hs.filter((h) => h.bot).every((h) => h.sk[1] === 0 && h.sk[2] === 0) && new Set(hs.filter((h) => h.bot).map((h) => h.sk[0])).size >= 2);
  // late arrival
  const LATE = mkBot(`FrL${tag}`, { sk: [2, 0, 1] });
  await LATE.join(code);
  check('a late arrival waits in the lobby with the running leaderboard', await until(() => LATE.state === 'lobby' && LATE.lobbyMsg.wait === true && LATE.lobbyMsg.running && LATE.lobbyMsg.running.top.length > 0, 6000), JSON.stringify(LATE.lobbyMsg && LATE.lobbyMsg.running));
  check('the waiter gets light {t:wait} updates, never snapshots / start frames', await until(() => LATE.msgs.some((m) => m.t === 'wait'), 6000) && !LATE.msgs.some((m) => m.t === 's' || m.t === 'start'));
  // reconnect mid-round resumes the same hole
  const myId = G.me; const gtoken = G.token;
  G.ws.close(); await sleep(600);
  const G2 = mkBot(`FrG${tag}`, { token: gtoken }); G2.farm = true;
  await G2.join(code);
  check('reconnect mid-round (same token) resumes the same hole', await until(() => G2.start && G2.me === myId && G2.msgs.some((m) => m.t === 'resume'), 6000));
  // 13th human: fill the room with waiters
  const fillers = [];
  for (let i = 0; i < 9; i++) { const b = mkBot(`FrF${i}${tag}`); fillers.push(b); await b.join(code); }
  await sleep(800);
  check('12 humans max: waiting arrivals count; the 13th is refused with {full}', fillers.filter((b) => b.lobbyMsg).length >= 8 && await (async () => { const x = mkBot(`FrX${tag}`); await x.join(code); await sleep(800); return x.errCode === 'full'; })(), `${fillers.filter((b) => b.state === 'lobby').length} waiting`);
  // meanwhile two other rooms (parallel): bots-only standard round, and 2 humans with the short round
  const roomSolo = (await create()).j.code, roomShort = (await create()).j.code;
  const S = mkBot(`FrS${tag}`); S.farm = true; await S.join(roomSolo);
  const H2 = mkBot(`FrP${tag}`); const G3 = mkBot(`FrQ${tag}`); H2.farm = G3.farm = true;
  const hc2 = await create(H2.token); const roomShort2 = hc2.j.code;
  await H2.join(roomShort2); await G3.join(roomShort2);
  await until(() => S.state === 'lobby' && H2.state === 'lobby' && G3.state === 'lobby' && H2.lobbyMsg.players.length === 2);
  // S's room was created without a creator token: the oldest player is the host at once
  await until(() => S.lobbyMsg.host === S.me, 6000, 200);
  S.send({ t: 'go' });
  H2.send({ t: 'cfg', len: 120, bots: false }); await sleep(400); H2.send({ t: 'go' });
  check('a room without a creator token: the oldest player hosts; bots off -> only humans', await until(() => S.start && H2.start, 10000) && H2.start.holes.length === 2 && S.start.holes.length === 8);
  check('the short round is shorter', (H2.start.endAt - H2.start.playAt) / 1000 === SHORT && (S.start.endAt - S.start.playAt) / 1000 === ROUND, `${(H2.start.endAt - H2.start.playAt) / 1000}s vs ${(S.start.endAt - S.start.playAt) / 1000}s`);

  // wait for the ends
  check('main round ends for host and guest with identical rankings', await until(() => H.state === 'ended' && G2.state === 'ended', (ROUND + 20) * 1000, 300));
  check('identical final ranking (same rows) for both humans', JSON.stringify(H.final) === JSON.stringify(G2.final) && H.final.length === 8 && H.final.every((r) => Array.isArray(r.sk)), `${H.final && H.final.map((r) => r.score).join(',')}`);
  check('end frame: 2 humans + 5:00 -> ranked', H.msgs.find((m) => m.t === 'end').priv.ranked === true);
  await until(() => H.saved !== undefined, 8000);
  const b1 = await board();
  check('2 humans + standard length: BOTH rows are on the online leaderboard', b1.some((r) => r.name === `FrH${tag}`) && b1.some((r) => r.name === `FrG${tag}`) && H.saved === true, `saved=${H.saved}`);
  check('the waiting late arrival is not in the results', !H.final.some((r) => r.name === `FrL${tag}`) && !b1.some((r) => r.name === `FrL${tag}`));
  check('bots-only (1 human) standard round is NOT written to the leaderboard', await until(() => S.state === 'ended', 15000, 300) && S.msgs.find((m) => m.t === 'end').priv.ranked === false && (await until(() => S.saved !== undefined, 5000)) && S.saved === false && S.savedMsg.why === 'unranked' && !(await board()).some((r) => r.name === `FrS${tag}`));
  check('2 humans with the custom short round are NOT written either', await until(() => H2.state === 'ended' && G3.state === 'ended', 15000, 300) && H2.msgs.find((m) => m.t === 'end').priv.ranked === false && (await until(() => G3.saved !== undefined, 5000)) && !(await board()).some((r) => r.name === `FrP${tag}` || r.name === `FrQ${tag}`));
  // rematch
  H.send({ t: 'rematch' });
  check('Rematch: everybody still connected is back in the SAME lobby (host, settings kept)', await until(() => G2.state === 'lobby' && G2.lobbyMsg.phase === 'lobby' && G2.lobbyMsg.code === code && G2.lobbyMsg.players.length >= 2 && !G2.lobbyMsg.wait && G2.lobbyMsg.host === H.me, 6000), JSON.stringify(G2.lobbyMsg && G2.lobbyMsg.players.map((p) => p.name)));
  check('the waiting arrival joined the lobby too (it was connected)', await until(() => LATE.lobbyMsg && !LATE.lobbyMsg.wait && LATE.lobbyMsg.players.some((p) => p.name === `FrL${tag}`), 4000));
  // host leaves -> oldest remaining becomes host
  H.send({ t: 'bye' });
  check('host leaves: the oldest remaining player becomes host', await until(() => G2.lobbyMsg.host === G2.me && G2.lobbyMsg.players.length >= 2 && !G2.lobbyMsg.players.some((p) => p.name === `FrH${tag}`), 6000), `host ${G2.lobbyMsg.host}, me ${G2.me}`);
  G2.send({ t: 'cfg', len: 120, bots: false });
  check('the new host controls the room', await until(() => G2.lobbyMsg.cfg.len === 120 && G2.lobbyMsg.cfg.bots === false, 4000));
  for (const b of [H, G2, LATE, S, H2, G3, ...fillers]) { try { b.ws.close(); } catch {} clearInterval(b.timer); clearInterval(b.pingT); }
  // a host whose socket drops (reload / network) keeps the role for a few seconds; an absent host is replaced by the oldest player (alarm-driven)
  {
    const H3 = mkBot(`FrR${tag}`); const hc3 = await create(H3.token); const rc = hc3.j.code;
    await H3.join(rc);
    const G4 = mkBot(`FrT${tag}`); await G4.join(rc);
    await until(() => G4.lobbyMsg && G4.lobbyMsg.players.length === 2);
    const htoken = H3.token; H3.ws.close();
    await sleep(1500);
    check('host socket dropped: the role is NOT handed over at once (grace)', G4.lobbyMsg.host !== G4.me);
    const H3b = mkBot(`FrR${tag}`, { token: htoken }); await H3b.join(rc);
    check('...the same session coming back (reload) is host again', await until(() => H3b.lobbyMsg && H3b.lobbyMsg.host === H3b.me && H3b.lobbyMsg.players.length === 2, 5000));
    H3b.ws.close();
    check('host gone for good: the oldest remaining player takes over after the grace period', await until(() => G4.lobbyMsg.host === G4.me, 15000, 300));
    G4.ws.close();
  }
  // expired code: nobody joined; the room dies TTL after its last activity
  await sleep(Math.max(0, TTL + 4000 - (Date.now() - t0) % 1000));
  const ex = await until(async () => (await getJson('/api/mp/room?code=' + expiring)).status === 404, TTL + 15000, 1000);
  check('an expired room code -> 404 noroom', ex);
} catch (e) { console.error(e); fails++; }

console.log(fails ? `\n${fails} FAILED (stages 1-2)` : '\nstages 1-2 passed');
if (!arg('--no-browsers')) {
  try { await import('./lib/friends-browsers.mjs').then((m) => m.run({ BASE, PORT, ROUND, SHORT, TTL, dist, out, check, until, sleep, board, getJson, create, tag, errors, startWrangler, stopWrangler, MAIN_VARS, cfgPath, state, root, post, setFails: (n) => { fails += n; } })); }
  catch (e) { console.error(e); fails++; }
}
await stopWrangler();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
