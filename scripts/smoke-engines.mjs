// Cross-engine test: the same BUILT game on Chromium, WebKit (iPhone 13 profile = what every iOS browser runs) and Firefox must build
// exactly the same swallowable objects (same ids, positions, fit, value, kinds) on all four maps, and players on different engines must be
// able to share one online room. Also the stale-tab recovery (new deploy -> refused -> "new version" -> reload) with and without the service worker.
//   GPU=1 [ENG_PORT=8798] node scripts/smoke-engines.mjs [--static-only | --rooms-only | --stale-only] [--fix]
//     stage 1 (static)  per engine x map: object count, per-kind counts, placement-file hash, full per-id dump (x, z, fit, value, kind) identical to
//                       Chromium's; solo Play works; no console errors; no mismatch message in solo
//     stage 2 (rooms)   local `wrangler dev`: Chromium + WebKit and Chromium + Firefox join the SAME room, both accepted, see each other move, an object eaten
//                       by one disappears for the other under the same id, identical final ranking
//     stage 3 (stale)   build A served, page loaded, server swapped to build B (other placement file) -> Online -> "new version" offer -> reload -> online works;
//                       solo unaffected; repeated with ?sw=1 (service worker active)
//   --fix: regenerate the placement files first when stale (needs the GPU/Chromium generator). Ports: vite 5185, wrangler ENG_PORT (default 8798).
import { chromium, webkit, firefox, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../worker/mp/table.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.ENG_PORT || 8798), VPORT = +(process.env.ENG_VITE_PORT || 5185);
const arg = (a) => process.argv.includes(a);
const only = arg('--static-only') ? 'static' : arg('--rooms-only') ? 'rooms' : arg('--stale-only') ? 'stale' : null;
const want = (s) => !only || only === s;
const tag = `-eng${PORT}`;
const distA = path.join(root, 'scripts', `.dist${tag}`);
const distB = path.join(root, 'scripts', `.dist${tag}-B`);
const state = path.join(root, 'scripts', `.state${tag}`);
const cfgPath = path.join(root, 'scripts', `.wrangler${tag}.jsonc`);
const bundleDir = path.join(root, 'scripts', `.worker${tag}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status) throw new Error(`${cmd} ${args.join(' ')} failed`); };
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const MAPS = ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];
const GL = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
const ENGINES = [
  { name: 'chromium', type: chromium, args: GL, ctx: { viewport: { width: 1100, height: 680 } } },
  { name: 'webkit', type: webkit, args: [], ctx: { ...devices['iPhone 13'] } },
  { name: 'firefox', type: firefox, args: [], ctx: { viewport: { width: 1100, height: 680 } } },
];
const launch = (e) => e.type.launch({ headless: true, args: e.args });

// ---- build (one snapshot of the sources + placement files) ----------------------------------------------------------------------------
console.log('== build');
run('node', ['tools/mp/check-objects.mjs', ...(arg('--fix') ? ['--fix'] : [])]);
run('npx', ['vite', 'build', '--outDir', distA, '--emptyOutDir', '--logLevel', 'error']);
run('node', ['tools/mp/check-objects.mjs', '--dist', distA]);
const manifest = JSON.parse(fs.readFileSync(path.join(distA, 'data', 'placements.json'), 'utf8'));

const procs = [];
const killAll = () => { for (const p of procs) try { p.kill('SIGTERM'); } catch {} };
process.on('exit', killAll);

// =========================================================================================================================================
// stage 1: identical worlds
// =========================================================================================================================================
async function staticStage() {
  console.log('\n== stage 1: identical worlds on every engine (4 maps)');
  const srv = spawn('npx', ['vite', 'preview', '--outDir', distA, '--port', String(VPORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  procs.push(srv);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${VPORT}/`)).ok) break; } catch {} await sleep(250); }
  const dumps = {};   // map -> engine -> dump
  const solo = {};
  for (const e of ENGINES) {
    const browser = await launch(e);
    for (const slug of MAPS) {
      const ctx = await browser.newContext(e.ctx);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (er) => errors.push('pageerror: ' + er.message));
      await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.goto(`http://localhost:${VPORT}/?map=${slug}&quality=low&intro=0`);
      await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
      const err = await page.evaluate(() => document.body.dataset.error);
      if (err) { check(`${e.name}/${slug}: boots`, false, err); await ctx.close(); continue; }
      const d = await page.evaluate(() => {
        const w = window.__life.world, objs = w.objects, kinds = {};
        const rows = new Array(objs.length);
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          kinds[o.kind] = (kinds[o.kind] || 0) + 1;
          // movers are simulated per client (their live x/z differ by definition): their id, kind, fit and value still have to match
          rows[i] = o.mover ? [o.kind, null, null, o.fit, o.value] : [o.kind, o.x, o.z, o.fit, o.value];
        }
        return { source: w.placements.source, hash: w.placements.hash, reason: w.placements.reason, n: objs.length, kinds, rows, timing: window.__timing, status: document.getElementById('mp-status') ? document.getElementById('mp-status').textContent : '' };
      });
      (dumps[slug] ||= {})[e.name] = d;
      // solo play works
      await page.evaluate(() => document.getElementById('play').click());
      const ok = await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 30000 }).then(() => true, () => false);
      const t0 = await page.evaluate(() => ({ f: window.__perf.frames, tl: window.__game.state.timeLeft }));
      await sleep(1500);
      const t1 = await page.evaluate(() => ({ f: window.__perf.frames, tl: window.__game.state.timeLeft, txt: document.body.innerText }));
      solo[`${e.name}/${slug}`] = ok && t1.f > t0.f && t1.tl < t0.tl;
      const mismatchShown = /versij|version/i.test(d.status || '') || /out of date|novecojusi/i.test(t1.txt);
      check(`${e.name}/${slug}: solo Play runs, no console errors, no mismatch message`, solo[`${e.name}/${slug}`] && !errors.length && !mismatchShown, `${errors.length ? 'ERRORS ' + errors.slice(0, 2).join(' | ') : ''} frames ${t1.f - t0.f} timeLeft ${t0.tl} -> ${t1.tl} world build ${d.timing && d.timing.buildMs} ms`);
      await ctx.close();
    }
    await browser.close();
  }
  for (const slug of MAPS) {
    const m = dumps[slug] || {};
    const ref = m.chromium;
    if (!ref) { check(`${slug}: chromium dump`, false); continue; }
    check(`${slug}: chromium built from the placement file`, ref.source === 'file' && ref.hash === manifest.maps[slug].hash, `source ${ref.source} reason ${ref.reason} hash ${ref.hash} (manifest ${manifest.maps[slug].hash})`);
    for (const e of ENGINES.slice(1)) {
      const d = m[e.name];
      if (!d) { check(`${slug}: ${e.name} dump`, false); continue; }
      let firstDiff = -1, nDiff = 0;
      for (let i = 0; i < Math.max(ref.n, d.n); i++) {
        const a = ref.rows[i], b = d.rows[i];
        if (!a || !b || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3] || a[4] !== b[4]) { nDiff++; if (firstDiff < 0) firstDiff = i; }
      }
      const kc = JSON.stringify(Object.entries(ref.kinds).sort()) === JSON.stringify(Object.entries(d.kinds).sort());
      check(`${slug}: ${e.name} == chromium  (objects ${d.n}/${ref.n}, per-kind counts equal ${kc}, hash ${d.hash}, ${nDiff} differing ids${firstDiff >= 0 ? ', first ' + firstDiff + ' ' + JSON.stringify(ref.rows[firstDiff]) + ' vs ' + JSON.stringify(d.rows[firstDiff]) : ''})`,
        d.n === ref.n && kc && d.hash === ref.hash && d.source === 'file' && nDiff === 0, `build ${d.timing && d.timing.buildMs} ms vs chromium ${ref.timing && ref.timing.buildMs} ms`);
    }
  }
  // fallback: placement file missing (404) / wrong revision under the right URL: the game is fully playable solo, online is off with a plain note
  console.log('\n   fallback (placement file missing / stale)');
  for (const e of ENGINES.slice(0, 2)) {
    const browser = await launch(e);
    for (const mode of ['missing', 'stale']) {
      const ctx = await browser.newContext(e.ctx);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404/i.test(m.text())) errors.push(m.text()); });
      page.on('pageerror', (er) => errors.push('pageerror: ' + er.message));
      await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      const other = fs.readFileSync(path.join(distA, 'data', 'purvciems', 'riga-objects.bin.gz'));
      await page.route('**/riga-objects.bin.gz*', (r) => (mode === 'missing' ? r.fulfill({ status: 404, body: 'nope' }) : r.fulfill({ status: 200, contentType: 'application/gzip', body: other })));
      await page.goto(`http://localhost:${VPORT}/?quality=low&intro=0`);
      await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
      const d = await page.evaluate(() => ({ src: window.__life.world.placements.source, reason: window.__life.world.placements.reason, hash: window.__mpHash(), n: window.__life.world.objects.length, status: document.getElementById('mp-status').textContent }));
      await page.evaluate(() => document.getElementById('play-online').click());
      await sleep(600);
      const st = await page.evaluate(() => ({ state: window.__online.state, status: document.getElementById('mp-status').textContent }));
      await page.evaluate(() => document.getElementById('play').click());
      const playing = await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 30000 }).then(() => true, () => false);
      check(`${e.name}: placement file ${mode} -> procedural fallback, solo plays, online off with a plain note, no mismatch text`,
        d.src === 'procedural' && d.reason === mode && d.hash === null && d.n > 1000 && playing && st.state === 'idle' && /nav pieejama|unavailable/i.test(st.status) && !/versij|version|novecojusi/i.test(st.status) && !errors.length,
        `${d.src}/${d.reason}, ${d.n} objects, note "${st.status.slice(0, 50)}" ${errors.slice(0, 2).join('|')}`);
      await ctx.close();
    }
    await browser.close();
  }
  srv.kill('SIGTERM');
}

// =========================================================================================================================================
// wrangler helper
// =========================================================================================================================================
function wranglerCfg(assetsDir, main) {
  return {
    name: 'bedre-eng-test', compatibility_date: '2026-11-01', main,
    assets: { directory: assetsDir, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
    d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
    durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
    migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }],
  };
}
let bundled = false;
function bundleWorker() {
  if (bundled) return; bundled = true;
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
  fs.writeFileSync(cfgPath, JSON.stringify(wranglerCfg(distA, '../worker/index.js')));
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundleDir], { stdio: 'pipe' });
  fs.writeFileSync(cfgPath, JSON.stringify(wranglerCfg(distA, `./.worker${tag}/index.js`)));
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state], { stdio: 'pipe' });
}
async function startWrangler(assetsDir, round = 40) {
  bundleWorker();
  fs.writeFileSync(cfgPath, JSON.stringify(wranglerCfg(assetsDir, `./.worker${tag}/index.js`)));
  const wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--persist-to', state, '--var', `MP_ROUND_SECONDS:${round}`, '--var', 'MP_LOBBY_SECONDS:3', '--var', 'MP_RESULTS_SECONDS:20', '--var', 'MP_TEST_CLOSE_SPAWN:1'], { cwd: root, stdio: 'pipe', detached: true });
  let log = '';
  wr.stdout.on('data', (d) => (log += d)); wr.stderr.on('data', (d) => (log += d));
  const kill = () => { try { process.kill(-wr.pid, 'SIGKILL'); } catch {} };
  procs.push({ kill: kill });
  const base = `http://localhost:${PORT}`;
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base + '/api/mp/status')).ok) return { base, kill }; } catch {} await sleep(500); }
  kill(); throw new Error('wrangler dev not ready\n' + log);
}
const stopWrangler = async (w) => { w.kill(); await sleep(1500); };
const until = async (p, fn, arg, timeout = 30000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(step); } return false; };

// =========================================================================================================================================
// stage 2: cross-engine rooms
// =========================================================================================================================================
async function roomsStage() {
  console.log('\n== stage 2: cross-engine online rooms (local wrangler dev)');
  const w = await startWrangler(distA, 40);
  const info = await (await fetch(w.base + '/api/mp/info')).json();
  check('server table id == manifest id of the centre file', info.hash === manifest.maps.centrs.hash, `${info.hash} ${info.objects} objects`);
  const browsers = {};
  for (const e of ENGINES) browsers[e.name] = await launch(e);
  try {
    for (const other of ['webkit', 'firefox']) {
      console.log(`\n-- chromium + ${other}`);
      const errors = [];
      const mk = async (eng, name) => {
        const e = ENGINES.find((x) => x.name === eng);
        const ctx = await browsers[eng].newContext(e.ctx);
        const page = await ctx.newPage();
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${eng}] ${m.text()}`); });
        page.on('pageerror', (er) => errors.push(`[${eng}] pageerror ${er.message}`));
        await page.addInitScript((n) => { try { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', 'en'); } catch {} }, name);
        await page.goto(`${w.base}/?quality=low`);
        await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
        if (await page.evaluate(() => document.body.dataset.error)) throw new Error(`${eng}: boot error`);
        return page;
      };
      const t = Math.random().toString(36).slice(2, 5);
      const nA = `ChA${t}`, nB = `${other === 'webkit' ? 'Wk' : 'Ff'}B${t}`;
      const A = await mk('chromium', nA), B = await mk(other, nB);
      const O = (p, fn, a) => p.evaluate(fn, a);
      const hA = await O(A, () => window.__mpHash()), hB = await O(B, () => window.__mpHash());
      check(`chromium and ${other} compute the same handshake id as the server`, hA === hB && hA === info.hash, `${hA} ${hB} server ${info.hash}`);
      await Promise.all([O(A, () => document.getElementById('play-online').click()), O(B, () => document.getElementById('play-online').click())]);
      const inLobby = (await until(A, () => window.__online.state === 'lobby', null, 20000)) && (await until(B, () => window.__online.state === 'lobby', null, 20000));
      check(`both accepted (no version refusal): chromium + ${other} reach the lobby`, inLobby);
      await until(A, () => (window.__online.lobby?.players.length || 0) >= 2, null, 8000);
      const rA = await O(A, () => ({ room: window.__online.room, n: window.__online.lobby.players.length })), rB = await O(B, () => window.__online.room);
      check('same room, 2 humans', rA.room === rB && rA.n === 2, `room ${rA.room}`);
      check('both playing', (await until(A, () => window.__online.state === 'playing', null, 25000)) && (await until(B, () => window.__online.state === 'playing', null, 25000)));
      const meA = await O(A, () => window.__online.me), meB = await O(B, () => window.__online.me);
      const pickTarget = (p) => O(p, () => {
        const wd = window.__life.world, pl = window.__online.self;
        let best = null, bd = 1e9;
        for (const o of wd.objects) {
          if (o.state !== 0 || o.mover || o.fit >= 1.5) continue;
          const d = Math.hypot(o.x - pl.x, o.z - pl.z);
          if (d < 80 && d < bd) { bd = d; best = o; }
        }
        return best ? { id: best.id, x: best.x, z: best.z, kind: best.kind, fit: best.fit, value: best.value } : null;
      });
      const eat = async (p, other) => {
        const tg = await pickTarget(p);
        if (!tg) return null;
        const twin = await O(other, (id) => { const o = window.__life.world.objects[id]; return { kind: o.kind, x: o.x, z: o.z, fit: o.fit, value: o.value }; }, tg.id);
        const same = twin.kind === tg.kind && twin.x === tg.x && twin.z === tg.z && twin.fit === tg.fit && twin.value === tg.value;
        await O(p, (t) => window.__online.drive(t.x, t.z), tg);
        const ok = await until(p, (id) => window.__life.world.objects[id].state !== 0, tg.id, 9000, 80);
        const gone = ok && (await until(other, (id) => window.__life.world.objects[id].state !== 0, tg.id, 4000, 100));
        return { id: tg.id, kind: tg.kind, same, gone };
      };
      const track = (p, id) => O(p, (i) => { const r = window.__online.remotes().find((h) => h.id === i); return r ? { x: r.x, z: r.z, score: r.score } : null; }, id);
      const b0 = await track(B, meA), a0 = await track(A, meB);
      const ea = [], eb = [];
      for (let i = 0; i < 4; i++) { const r = await eat(A, B); if (r) ea.push(r); }
      for (let i = 0; i < 4; i++) { const r = await eat(B, A); if (r) eb.push(r); }
      await O(A, () => window.__online.drive(null)); await O(B, () => window.__online.drive(null));
      await sleep(700);
      check(`objects eaten by chromium: same id/kind/position/fit/value on ${other}, and gone there`, ea.length >= 3 && ea.every((r) => r.same && r.gone), JSON.stringify(ea.map((r) => `${r.id}:${r.kind}`)));
      check(`objects eaten by ${other}: same id on chromium, and gone there`, eb.length >= 3 && eb.every((r) => r.same && r.gone), JSON.stringify(eb.map((r) => `${r.id}:${r.kind}`)));
      const b1 = await track(B, meA), a1 = await track(A, meB);
      check(`${other} sees chromium's hole move`, b0 && b1 && Math.hypot(b1.x - b0.x, b1.z - b0.z) > 2, b0 && b1 ? `${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(1)} m` : 'n/a');
      check(`chromium sees ${other}'s hole move`, a0 && a1 && Math.hypot(a1.x - a0.x, a1.z - a0.z) > 2, a0 && a1 ? `${Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(1)} m` : 'n/a');
      const sA = await O(A, () => ({ ss: window.__online.serverScore, score: window.__online.self.score })), sB = await O(B, () => ({ ss: window.__online.serverScore }));
      check('scores come from the server and agree on both engines', (await track(B, meA)).score === sA.ss && (await track(A, meB)).score === sB.ss, `A ${sA.ss} B ${sB.ss}`);
      const left = await O(A, () => Math.max(0, (window.__online.round.endAt - window.__online.serverNow()) / 1000));
      console.log(`  ... waiting ${left.toFixed(0)} s for the round to end`);
      check('both rounds end', (await until(A, () => window.__online.state === 'ended', null, (left + 20) * 1000, 300)) && (await until(B, () => window.__online.state === 'ended', null, 20000, 300)));
      const fA = await O(A, () => window.__online.final), fB = await O(B, () => window.__online.final);
      check('identical final ranking on both engines', !!fA && JSON.stringify(fA) === JSON.stringify(fB) && fA.length === 8, (fA || []).map((r) => `${r.rank}.${r.name}:${r.score}`).join(' '));
      check(`no console errors (chromium + ${other})`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await O(A, () => window.__online.leave()).catch(() => {}); await O(B, () => window.__online.leave()).catch(() => {});
      await A.context().close(); await B.context().close();
    }
  } finally {
    for (const b of Object.values(browsers)) await b.close().catch(() => {});
    await stopWrangler(w);
  }
}

// =========================================================================================================================================
// stage 3: stale tab after a deploy
// =========================================================================================================================================
/** build B = copy of A with another centre placement file (one value changed), new content id baked into renamed JS chunks, new service-worker build id */
function makeBuildB() {
  fs.rmSync(distB, { recursive: true, force: true });
  fs.cpSync(distA, distB, { recursive: true });
  const f = path.join(distB, 'data', 'riga-objects.bin.gz');
  const raw = zlib.gunzipSync(fs.readFileSync(f));
  const oldHash = manifest.maps.centrs.hash;
  // flip one byte inside the f32/u16 value area of a late (prop) object: any change of the bytes is a new revision
  raw[raw.length - 64] ^= 0x01;
  fs.writeFileSync(f, zlib.gzipSync(raw, { level: 9 }));
  const newHash = hashBytes(new Uint8Array(raw));
  const man = JSON.parse(fs.readFileSync(path.join(distB, 'data', 'placements.json'), 'utf8'));
  man.maps.centrs.hash = newHash;
  fs.writeFileSync(path.join(distB, 'data', 'placements.json'), JSON.stringify(man, null, 1) + '\n');
  const assets = path.join(distB, 'assets');
  const renames = [];
  for (const n of fs.readdirSync(assets)) {
    if (!n.endsWith('.js')) continue;
    const p = path.join(assets, n), s = fs.readFileSync(p, 'utf8');
    if (!s.includes(oldHash)) continue;
    fs.writeFileSync(p, s.replaceAll(oldHash, newHash));
    const nn = n.replace(/-[^-.]+\.js$/, `-${newHash.slice(0, 8)}.js`);
    fs.renameSync(p, path.join(assets, nn)); renames.push([n, nn]);
  }
  // references to a renamed chunk are rewritten everywhere; a file whose text changed that way is itself a new revision, so (like a real vite build, where the importer's content hash changes
  // with its imports) it is renamed too, until nothing changes: otherwise an unchanged-name entry chunk would be served from the immutable browser cache and keep importing build A's chunk
  const listText = () => [path.join(distB, 'index.html'), ...fs.readdirSync(assets).filter((n) => /\.(js|css)$/.test(n)).map((n) => path.join(assets, n))];
  for (let round = 0; round < 6; round++) {
    const changed = [];
    for (const p of listText()) { let s = fs.readFileSync(p, 'utf8'); const o = s; for (const [a, b] of renames) s = s.replaceAll(a, b); if (s !== o) { fs.writeFileSync(p, s); changed.push(p); } }
    let more = false;
    for (const p of changed) {
      const n = path.basename(p);
      if (!n.endsWith('.js') || renames.some((r) => r[1] === n)) continue;
      const nn = n.replace(/-[^-.]+\.js$/, `-${newHash.slice(0, 7)}${renames.length}.js`);
      fs.renameSync(p, path.join(assets, nn)); renames.push([n, nn]); more = true;
    }
    if (!more) break;
  }
  const sw = path.join(distB, 'sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const BUILD = '[^']*'/, `const BUILD = 'b${newHash.slice(0, 9)}'`));
  return { oldHash, newHash, renames };
}

async function staleStage() {
  console.log('\n== stage 3: stale tab after a deploy (build A loaded, server swapped to build B)');
  const B = makeBuildB();
  check('build B has another content id than build A', B.oldHash !== B.newHash && B.renames.length >= 1, `${B.oldHash} -> ${B.newHash}, renamed ${B.renames.map((r) => r[1]).join(',')}`);
  for (const sw of [false, true]) {
    for (const eng of ['chromium', 'webkit']) {
      const e = ENGINES.find((x) => x.name === eng);
      console.log(`\n-- ${eng}, service worker ${sw ? 'ACTIVE (?sw=1)' : 'off'}`);
      let w = await startWrangler(distA, 40);
      const browser = await launch(e);
      const ctx = await browser.newContext({ ...e.ctx, serviceWorkers: 'allow' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (er) => errors.push('pageerror ' + er.message));
      await page.addInitScript(() => { try { localStorage.setItem('bedre.name', 'Stale'); localStorage.setItem('bedre.lang', 'en'); } catch {} });
      try {
        await page.goto(`${w.base}/?quality=low&intro=0${sw ? '&sw=1' : ''}`);
        await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
        if (sw) {
          const active = await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 40000 }).then(() => true, () => false);
          check(`${eng}: service worker controls the page`, active);
        }
        const hOld = await page.evaluate(() => window.__mpHash());
        check(`${eng}: build A loaded (hash ${hOld})`, hOld === B.oldHash);
        // swap the server to build B
        await stopWrangler(w);
        w = await startWrangler(distB, 40);
        // solo is untouched by the stale state: Play works and no mismatch text is shown
        const statusBefore = await page.evaluate(() => document.getElementById('mp-status').textContent);
        check(`${eng}: no mismatch message before pressing Online`, !/versij|version|novecojusi/i.test(statusBefore), JSON.stringify(statusBefore));
        await page.evaluate(() => document.getElementById('play-online').click());
        const offered = await page.waitForSelector('#mp-status-act', { timeout: 25000 }).then(() => true, () => false);
        const txt = await page.evaluate(() => document.getElementById('mp-status').textContent);
        check(`${eng}: refused -> "new version" offer with a reload button`, offered, JSON.stringify(txt));
        // solo still works on the stale page (menu is back)
        const soloOk = await page.evaluate(() => { document.getElementById('play').click(); return true; }) && await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 20000 }).then(() => true, () => false);
        check(`${eng}: solo Play unaffected on the stale page`, soloOk);
        // follow the offer: the reload must really fetch build B (service worker + caches dropped first)
        const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }).catch(() => null);
        await page.evaluate(() => document.getElementById('mp-status-act').click());
        await nav;
        await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
        const hNew = await page.evaluate(() => window.__mpHash());
        check(`${eng}: after the offered reload the page runs build B (hash ${hNew})`, hNew === B.newHash, hNew === B.newHash ? '' : await page.evaluate(() => JSON.stringify({ reason: window.__life.world.placements.reason, errs: window.__errs || null })));
        // a stored online session from before the deploy (its room died with the old server): the rejoin offer resolves into a plain message, never a stuck screen
        await page.evaluate(() => { const rec = { v: 1, room: 'zzzzzzzzzz', token: 'tok_' + Math.random().toString(36).slice(2, 14), name: 'Stale', hash: window.__mpHash(), id: 2, endAt: Date.now() + 30000, ended: false, exp: Date.now() + 120000, tab: 'old', hb: 0, last: { score: 321, rank: 3, total: 8 } }; const j = JSON.stringify(rec); sessionStorage.setItem('bedre.mp.session', j); localStorage.setItem('bedre.mp.session', j); });
        await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
        const offeredRejoin = await until(page, () => !!document.getElementById('mp-rejoin'), null, 6000, 100);
        const resolved = await until(page, () => window.__online.state === 'idle' && /over|closed/i.test(document.getElementById('mp-status').textContent) && !window.__online.session, null, 20000, 150);
        check(`${eng}: stored session + new build: rejoin offered, then resolves to "round over" (record dropped)`, offeredRejoin && resolved, await page.evaluate(() => document.getElementById('mp-status').textContent));
        await page.evaluate(() => document.getElementById('play-online').click());
        const joined = await until(page, () => window.__online.state === 'lobby', null, 25000);
        check(`${eng}: online accepted after the reload (recovered, not stuck)`, joined);
        await page.evaluate(() => window.__online.leave()).catch(() => {});
        const real = errors.filter((m) => !/ERR_CONNECTION_REFUSED|Could not connect|Beacon API|Load failed|NetworkError/i.test(m)); // the server is deliberately down for a moment while it is swapped
        check(`${eng}: no console errors (besides the expected connection errors while the server was swapped)`, real.length === 0, real.slice(0, 3).join(' | '));
      } catch (er) {
        check(`${eng}: stale flow`, false, er.message);
      }
      await ctx.close(); await browser.close(); await stopWrangler(w);
    }
  }
}

if (want('static')) await staticStage();
if (want('rooms')) await roomsStage();
if (want('stale')) await staleStage();
killAll();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall cross-engine checks passed');
process.exit(fails ? 1 : 0);
