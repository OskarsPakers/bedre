// Smoke test: starts Vite, drives the game through window.__game in headless Chromium, saves screenshots.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5199;
const base = `http://localhost:${PORT}`;
const tag = process.argv.includes('--sample') ? '-sample' : '';
const query = [process.argv.includes('--sample') ? 'sample=1' : '', process.env.INTRO ? '' : 'intro=0'].filter(Boolean).join('&');

// Build once and serve the static build: immune to HMR reloads while other people edit src/ during the run.
const dist = path.join(root, 'scripts', `.dist-${PORT}`); // per-port build dir so parallel runs don't clash
await new Promise((res, rej) => spawn('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start\n' + serverLog);
}

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const errors = [];

async function main() {
  await waitServer();
  const browser = await chromium.launch({
    headless: true,
    // GPU=1 tries the real GPU (Metal via ANGLE); default is SwiftShader (software) which is slow but always works.
    args: process.env.GPU
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // no worker behind the static preview: answer /api quietly (the offline path is covered by final-shots.mjs, the live one by smoke-e2e.mjs)
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); if (m.type() === 'info') console.log('  [page]', m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const open = async (q) => {
    const qq = q && q.includes('intro=') ? query.replace('intro=0', '') : query;
    await page.goto(`${base}/?${[qq, q, process.env.MAP ? 'map=' + process.env.MAP : ''].filter(Boolean).join('&')}`); // MAP=<slug>: run against a district
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    const err = await page.evaluate(() => document.body.dataset.error);
    if (err) throw new Error('boot error ' + err);
  };
  const shot = async (name) => { await page.evaluate(() => document.querySelectorAll('.go').forEach((e) => e.remove())); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}${tag}.png`) }); };
  const G = (fn, arg) => page.evaluate(fn, arg);
  const perf = async (secs = 4) => {
    await G(() => { window.__perf.frames = 0; window.__perf.ms = 0; });
    const t0 = Date.now();
    await page.waitForTimeout(secs * 1000);
    const p = await G(() => ({ f: window.__perf.frames, ms: window.__perf.ms }));
    const wall = (Date.now() - t0) / p.f;
    return { cpuMs: p.ms / Math.max(1, p.f), wallMs: wall, frames: p.f };
  };

  await open('bots=0'); // legacy single-player block runs without opponents
  if (process.argv.includes('--curve')) {
    await G(() => window.__game.start());
    await G(() => window.__game.skipIntro());
    for (let i = 0; i < 10; i++) {
      await G(() => window.__game.autoplay(30));
      console.log(JSON.stringify(await G(() => ({ t: 300 - Math.round(window.__game.state.timeLeft), score: Math.round(window.__game.state.score), r: +window.__game.hole.radius.toFixed(1), eaten: window.__game.state.eaten }))));
    }
    await browser.close(); return;
  }
  if (process.argv.includes('--botsim')) { // balance: bots only, 300 s, player idle
    for (let run = 0; run < 3; run++) {
      await open('autostart=1');
      await G(() => window.__game.step(299.6));
      const h = (await G(() => window.__game.holes)).slice(1);
      console.log(`run ${run + 1}: scores ${h.map((b) => Math.round(b.score)).sort((a, b) => b - a).join(' ')} | radii ${h.map((b) => b.radius.toFixed(0)).join(' ')} | kills ${h.reduce((a, b) => a + b.kills, 0)}`);
    }
    await browser.close(); return;
  }
  if (process.argv.includes('--botdebug')) {
    await open('autostart=1');
    for (let i = 0; i < 12; i++) {
      await G(() => window.__game.step(20));
      const h = (await G(() => window.__game.holes)).slice(1);
      console.log(i * 20 + 20, h.map((b) => `${b.name.slice(0, 4)} ${Math.round(b.score)} r${b.radius.toFixed(0)} (${Math.round(b.x)},${Math.round(b.z)}) ${b.mode}${b.alive ? '' : 'X'}`).join(' | '));
    }
    await browser.close(); return;
  }
  const info = await G(() => ({ c: window.__game.counts, sample: window.__game.isSample, spawn: window.__game.spawn }));
  console.log('world:', JSON.stringify(info));
  check('world has buildings and props', info.c.buildings > 100 && info.c.props > 500);
  // iteration 5: the map is a rectangle taken from meta.bounds (real map: left bank included, class raster loaded; sample city: whatever it declares)
  const gi = await G(() => { const w = window.__life.world; return { b: w.bounds, g: w.ground.userData.stats, raster: !!w.data.groundRaster, ext: w.ground.userData.extent }; });
  check('ground tiles follow meta.bounds' + (info.sample ? ' (sample)' : ' + class raster + left bank'),
    gi.g && gi.g.tiles >= 1 && gi.ext.W >= gi.b.maxX - gi.b.minX && gi.ext.H >= gi.b.maxZ - gi.b.minZ && (info.sample || (gi.raster && (process.env.MAP || (gi.b.minX <= -2000 && gi.b.maxZ >= 1400)))), JSON.stringify({ b: gi.b, g: gi.g, raster: gi.raster }));
  await shot('1-start');

  // ---- early game
  await G(() => window.__game.start());
  check('phase playing', (await G(() => window.__game.state.phase)) === 'playing');
  await G(() => window.__game.step(0.5));
  await shot('2-early');
  const early = await perf(4);
  console.log('perf early (small hole):', JSON.stringify(early));

  const s0 = await G(() => ({ s: window.__game.state.score, r: window.__game.hole.radius }));
  // eat people: teleport onto the nearest person, repeat
  for (let i = 0; i < 12; i++) {
    const p = await G(() => window.__game.nearest('person'));
    if (!p) break;
    await G((p) => { window.__game.teleport(p.x, p.z); window.__game.step(0.3); }, p);
  }
  await G(() => window.__game.step(2));
  const s1 = await G(() => ({ s: window.__game.state.score, r: window.__game.hole.radius, e: window.__game.state.eaten, c: window.__game.counts }));
  console.log('after people:', JSON.stringify(s1));
  check('score increases when eating props', s1.s > s0.s, `${s0.s} -> ${s1.s}`);
  check('radius grows', s1.r > s0.r, `${s0.r} -> ${s1.r}`);
  await shot('3-after-people');

  // tiny building must NOT be swallowed by small hole
  const big0 = await G(() => { const g = window.__game; const b = g.nearest('building'); g.teleport(b.x, b.z); g.setRadius(2.4); g.step(2); return g.counts.remainingBuildings; });
  const total = await G(() => window.__game.counts.buildings);
  check('small hole does not eat buildings', big0 === total, `${big0}/${total}`);

  // autoplay to see natural growth
  await G(() => { window.__game.start(); });
  const curve = [];
  for (let i = 0; i < 10; i++) {
    await G(() => window.__game.autoplay(30));
    curve.push(await G(() => ({ t: +(300 - window.__game.state.timeLeft).toFixed(0), score: Math.round(window.__game.state.score), r: +window.__game.hole.radius.toFixed(1), eaten: window.__game.state.eaten })));
  }
  console.log('autoplay curve (30 s steps, with bots):', JSON.stringify(curve));
  await G(() => window.__game.step(1));
  await shot('4-autoplay-end');

  // ---- big hole
  await G(() => window.__game.start());
  const bb = await G(() => {
    const g = window.__game; g.setRadius(60);
    const b = g.nearest('building'); g.teleport(b.x, b.z);
    return { before: g.counts.remainingBuildings };
  });
  await shot('5-big-before');
  await G(() => window.__game.step(0.45));
  await shot('5b-big-falling');
  await G(() => window.__game.step(2.5));
  const after = await G(() => ({ c: window.__game.counts, score: window.__game.state.score, r: window.__game.hole.radius }));
  console.log('big hole:', JSON.stringify(after));
  check('big hole swallows buildings', after.c.remainingBuildings <= bb.before - (process.env.MAP ? 1 : 2), `${bb.before} -> ${after.c.remainingBuildings}`);
  await shot('6-big-after');
  const big = await perf(4);
  console.log('perf big hole:', JSON.stringify(big));

  // ---- mid-size fall closeup
  await G(() => { const g = window.__game; g.start(); const b = g.nearest('building'); g.teleport(b.x, b.z); g.setRadius(Math.max(6, b.fit / 0.9)); g.step(0.12); });
  await shot('5c-mid-falling');

  // ---- input: mouse + keyboard
  await G(() => { const g = window.__game; g.start(); g.teleport(g.spawn[0], g.spawn[1]); g.setRadius(5); g.step(0.1); });
  const x0 = await G(() => window.__game.hole.x);
  await page.keyboard.down('d');
  await page.waitForFunction((x) => window.__game.hole.x > x + 3, x0, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('d');
  const x1 = await G(() => window.__game.hole.x);
  check('keyboard moves hole east', x1 > x0 + 3, `${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
  const z1 = await G(() => window.__game.hole.z);
  await page.mouse.move(640, 120);
  await page.waitForFunction((z) => window.__game.hole.z < z - 3, z1, { timeout: 15000 }).catch(() => {});
  const z2 = await G(() => window.__game.hole.z);
  check('mouse above hole moves it north (-z)', z2 < z1 - 3, `${z1.toFixed(1)} -> ${z2.toFixed(1)}`);

  // ---- phone viewport HUD
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(500);
  await shot('8-mobile');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- round end
  await open('time=3&bots=0');
  await G(() => { window.__game.start(); window.__game.autoplay(3.6); });
  await shot('7-results');
  const end = await G(() => ({ phase: window.__game.state.phase, vis: !document.getElementById('results').classList.contains('hidden') }));
  check('round ends and results shown', end.phase === 'ended' && end.vis, JSON.stringify(end));
  await page.click('#again');
  const again = await G(() => ({ phase: window.__game.state.phase, score: window.__game.state.score, c: window.__game.counts }));
  check('play again resets world', again.phase === 'playing' && again.score <= 5 && again.c.remainingBuildings === again.c.buildings, JSON.stringify(again));

  // ======================= iteration 2: opponents & competition =======================
  const H = () => G(() => window.__game.holes);
  await open('autostart=1');
  await page.waitForTimeout(300);
  let hs = await H();
  check('8 holes (player + 7 bots)', hs.length === 8 && hs.filter((h) => h.isBot).length === 7, `n=${hs.length}`);
  check('player named Tu by default', hs[0].name === 'Tu');
  check('bot names distinct + Latvian-flavoured list', new Set(hs.map((h) => h.name)).size === 8, hs.map((h) => h.name).join(','));
  let minD = Infinity;
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) minD = Math.min(minD, Math.hypot(hs[i].x - hs[j].x, hs[i].z - hs[j].z));
  check('holes spawned spread apart', minD > 150, `min pair distance ${minD.toFixed(0)} m`);
  const sp = await G(() => window.__game.spawn);
  console.log('player spawn', sp.map((v) => v.toFixed(0)).join(','), 'dist from centre', Math.hypot(sp[0], sp[1]).toFixed(0));

  // bots move and score
  const before = hs.map((h) => ({ x: h.x, z: h.z }));
  await G(() => window.__game.step(25));
  hs = await H();
  const moved = hs.slice(1).map((h, i) => Math.hypot(h.x - before[i + 1].x, h.z - before[i + 1].z));
  check('bots move (all >8 m, at least 5 of 7 >25 m)', moved.every((d) => d > 8) && moved.filter((d) => d > 25).length >= 5, moved.map((d) => d.toFixed(0)).join(','));
  check('bots score over time', hs.slice(1).filter((h) => h.score > 0).length >= 6, hs.slice(1).map((h) => Math.round(h.score)).join(','));
  console.log('bot scores @20s', hs.slice(1).map((h) => `${h.name}:${Math.round(h.score)}/${h.mode}`).join(' '));

  // hole vs hole: big bot eats small bot, victim respawns protected with reduced score
  const duel = await G(() => {
    const g = window.__game; const a = g.holes.find((h) => h.index === 1), b = g.holes.find((h) => h.index === 2);
    g.setHoleRadius(1, 14); g.setHoleRadius(2, 6);
    const A = g.holes[1]; g.teleportHole(2, A.x, A.z);
    const sc = g.holes[2].score, scA = g.holes[1].score;
    g.step(0.1);
    const dyingNow = g.holes[2].dying;
    return { sc, scA, dyingNow };
  });
  check('victim starts dying when centre is inside bigger hole', duel.dyingNow === true);
  await G(() => window.__game.step(1.0));
  hs = await H();
  check('victim gone after swallow anim', hs[2].alive === false, JSON.stringify({ alive: hs[2].alive }));
  check('eater gained score from victim', hs[1].score > duel.scA + duel.sc * 0.3 || hs[1].score > duel.scA + 20, `${duel.scA.toFixed(0)} -> ${hs[1].score.toFixed(0)}`);
  await G(() => window.__game.step(3.2));
  hs = await H();
  // (districts: denser props make the respawned bot eat a bit before this check, so only alive + protected is required there)
  check('victim respawned, protected, reduced size', hs[2].alive && hs[2].protectT > 0 && (process.env.MAP || (hs[2].radius < 6 * 0.99 + 0.5 && hs[2].score < duel.sc * 0.6 + 5)), `radius ${hs[2].radius.toFixed(2)} score ${hs[2].score.toFixed(0)} prot ${hs[2].protectT.toFixed(2)}`);
  check('kills/deaths tracked', hs[1].kills >= 1 && hs[2].deaths >= 1);
  // smaller cannot eat bigger; equal-ish sizes don't eat
  const noeat = await G(() => {
    const g = window.__game; g.setHoleRadius(3, 8); g.setHoleRadius(4, 8.5); g.teleportHole(4, g.holes[3].x, g.holes[3].z); g.step(0.5);
    return [g.holes[3].alive, g.holes[4].alive];
  });
  check('similar sizes do not eat each other', noeat[0] && noeat[1]);

  // leaderboard ordering
  const lb = await G(() => window.__game.leaderboard());
  check('leaderboard sorted desc with ranks', lb.length === 8 && lb.every((r, i) => r.rank === i + 1 && (i === 0 || lb[i - 1].score >= r.score)), lb.map((r) => `${r.rank}.${r.name}:${Math.round(r.score)}`).join(' '));

  // ---- the player gets eaten
  await G(() => { const g = window.__game; g.start(); g.step(1); g.setHoleRadius(0, 4); g.setHoleRadius(1, 20); g.teleportHole(1, g.holes[0].x, g.holes[0].z); g.step(0.1); });
  const o1 = await G(() => ({ ov: window.__game.overlay, p: window.__game.holes[0] }));
  check('swallowed overlay shows eater name', o1.ov.swallowedVisible && o1.ov.by === (await H())[1].name, JSON.stringify(o1.ov));
  await G(() => window.__game.step(0.4));
  await shot('9-swallowed');
  const camF = await G(() => { const g = window.__game; return { cam: [g.cam.focus.x, g.cam.focus.z], eater: [g.holes[1].x, g.holes[1].z], dying: g.holes[0].alive }; });
  check('camera follows eater while player is out', Math.hypot(camF.cam[0] - camF.eater[0], camF.cam[1] - camF.eater[1]) < 60 && !camF.dying, JSON.stringify(camF));
  await G(() => window.__game.step(1.5));
  const o2 = await G(() => ({ ov: window.__game.overlay, alive: window.__game.holes[0].alive }));
  check('overlay persists with countdown while waiting', o2.ov.swallowedVisible && !o2.alive && +o2.ov.t >= 1 && +o2.ov.t <= 3, JSON.stringify(o2));
  await G(() => window.__game.step(3));
  const o3 = await G(() => ({ ov: window.__game.overlay, h: window.__game.holes[0] }));
  check('player respawns, overlay hidden', o3.h.alive && !o3.ov.swallowedVisible && o3.h.protectT > 0, JSON.stringify({ alive: o3.h.alive, ov: o3.ov.swallowedVisible, prot: o3.h.protectT }));

  // ---- gameplay screenshots: several holes visible
  await G(() => {
    const g = window.__game; g.start(); g.step(8);
    g.setHoleRadius(0, 6); g.teleportHole(1, g.holes[0].x + 24, g.holes[0].z - 10); g.setHoleRadius(1, 4);
    g.teleportHole(2, g.holes[0].x - 20, g.holes[0].z + 16); g.setHoleRadius(2, 9);
    g.teleportHole(3, g.holes[0].x + 30, g.holes[0].z + 24); g.setHoleRadius(3, 3);
    for (const i of [1, 2, 3]) g.holes && 0;
    g.step(0.3);
  });
  await shot('10-multi-gameplay');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(400);
  await G(() => window.__game.step(0.2));
  await shot('11-mobile-multi');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- frame cost with 8 holes (real map): cpuMs = update + render submit
  await open('autostart=1');
  await G(() => window.__game.step(25));
  const p8 = await perf(5);
  console.log('perf 8 holes:', JSON.stringify(p8));
  check('frame cpu cost with 8 holes < 4 ms', p8.cpuMs < 4, `${p8.cpuMs.toFixed(2)} ms`);
  await open('autostart=1&bots=0');
  check('?bots=0 disables bots', (await G(() => window.__game.holes.length)) === 1);
  const pb0 = await perf(3);
  console.log('perf 1 hole (bots=0):', JSON.stringify(pb0));

  // ---- name field persisted
  await open();
  await page.fill('#name', 'Rūdis');
  await page.click('#play');
  check('custom player name used', (await G(() => window.__game.holes[0].name)) === 'Rūdis');
  await open();
  check('name remembered across reloads', (await page.inputValue('#name')) === 'Rūdis');
  await page.fill('#name', '');
  await page.click('#play');
  check('empty name falls back to Tu', (await G(() => window.__game.holes[0].name)) === 'Tu');

  // ---- results ranking
  await open('time=4&autostart=1');
  await G(() => { window.__game.step(4.5); });
  const rr = await G(() => ({ place: document.getElementById('r-place').textContent, rows: document.querySelectorAll('#r-table tr').length, me: document.querySelectorAll('#r-table tr.me').length, phase: window.__game.state.phase }));
  check('results show ranking table + placement', rr.phase === 'ended' && rr.rows === 8 && rr.me === 1 && /^\d+(st|nd|rd|th) of 8$/.test(rr.place), JSON.stringify(rr));
  await shot('12-results-ranking');
  await page.click('#again');
  check('play again after ranking', (await G(() => window.__game.state.phase)) === 'playing');

  // ---- full 2-minute round, bots only (player idle) -> balance
  await open('autostart=1');
  await G(() => window.__game.step(299.6));
  hs = await H();
  const bots = hs.slice(1);
  const st = (a) => ({ min: Math.min(...a), max: Math.max(...a), avg: a.reduce((x, y) => x + y, 0) / a.length });
  console.log('BOTS-ONLY 300 s round:');
  for (const h of hs) console.log(`  ${h.isBot ? 'bot   ' : 'player'} ${h.name.padEnd(10)} score ${String(Math.round(h.score)).padStart(6)}  radius ${h.radius.toFixed(1).padStart(6)}  kills ${h.kills} deaths ${h.deaths}`);
  console.log('  score', JSON.stringify(st(bots.map((b) => Math.round(b.score)))), 'radius', JSON.stringify(st(bots.map((b) => +b.radius.toFixed(1)))));
  check('bots finish round with sensible spread', bots.every((b) => b.score > 20) , '');

  // ---- greedy autoplay "good human" vs bots (full round): placement
  const places = [];
  for (let k = 0; k < 2; k++) {
    await open('autostart=1');
    await G(() => window.__game.autoplay(305));
    const res = await G(() => ({ lb: window.__game.leaderboard(), phase: window.__game.state.phase }));
    const me = res.lb.find((r) => r.isPlayer);
    places.push(me.rank);
    console.log(`autoplay run ${k + 1}: placed ${me.rank}/8 score ${Math.round(me.score)}; top: ${res.lb.slice(0, 3).map((r) => r.name + ':' + Math.round(r.score)).join(' ')}`);
  }

  // ---- COMBOS + POWER-UPS (solo) -------------------------------------------------------------------------------------------------
  {
    console.log('  --- combos + power-ups ---');
    await open('bots=0&puseed=424242');
    await G(() => { window.__game.start(); window.__game.skipIntro(); });
    // a chain: points are multiplied, the SIZE follows the unmultiplied mass
    const ch = await G(() => {
      const g = window.__life.game;
      let lastC = 0, steps = new Set();
      for (let i = 0; i < 80 && g.player.combo.count < 30; i++) { g.autoplay(1); steps.add(g.player.combo.mult); lastC = g.player.combo.count; }
      const p = g.player, C = window.__game.state;
      const want = 2.2 * Math.pow(1 + p.mass / 16, 0.44);
      return { count: p.combo.count, mult: p.combo.mult, score: p.score, mass: p.mass, r: p.targetRadius, want, steps: [...steps], best: p.combo.best };
    });
    check('a chain of quick swallows builds the multiplier (x1.2 ... x2+)', ch.best >= 25 && ch.steps.some((m) => m >= 1.2), JSON.stringify({ best: ch.best, steps: ch.steps }));
    check('points are multiplied: score > mass', ch.score > ch.mass * 1.15, `score ${Math.round(ch.score)} mass ${Math.round(ch.mass)}`);
    check('radius follows the growth formula of the MASS, not the points', Math.abs(ch.r - ch.want) < 0.05, `r ${ch.r.toFixed(3)} want ${ch.want.toFixed(3)} (points would give ${(2.2 * Math.pow(1 + ch.score / 16, 0.44)).toFixed(3)})`);
    const hot = await G(() => { const g = window.__life.game; g.player.combo.hit(g.playT, 40, g.player.radius); g._v.set(g.player.x, 0, g.player.z); g.pop.sum = 50; g.pop.n = 1; g.pop.hot = true; g._flushPopup(1); return !!document.querySelector('#popups .pop.hot'); });
    check('+N popups of multiplied points are the warmer .hot class', hot);
    const chip = await G(() => { const g = window.__life.game; g.player.combo.count = 30; g.player.combo.mult = 2; g.player.combo.until = g.playT + 1; g._overlay(0.3); const c = document.getElementById('combo-chip'); return { shown: !c.hidden, text: c.textContent }; });
    check('combo chip shows count and multiplier', chip.shown && /30/.test(chip.text) && /×2/.test(chip.text), JSON.stringify(chip));
    // expiry
    const ex = await G(() => { const g = window.__life.game; g.player.control = { mode: 'none', x: 0, z: 0 }; g.autopilot = true; const c0 = g.player.combo.count; g.step(0.8); const mid = g.player.combo.count; g.step(3); const lost = g.player.combo.count; g.autopilot = false; return { c0, mid, lost }; });
    check('the combo expires when no swallow lands within the window (~1.6 s)', ex.c0 >= 20 && ex.mid >= 20 && ex.lost === 0, JSON.stringify(ex));
    // ---- power-ups: schedule, determinism
    const pu1 = await G(() => window.__game.powerups.map((r) => [r[0], r[1], Math.round(r[2]), Math.round(r[3])]));
    await open('bots=0&puseed=424242'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const pu2 = await G(() => window.__game.powerups.map((r) => [r[0], r[1], Math.round(r[2]), Math.round(r[3])]));
    await open('bots=0&puseed=777'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const pu3 = await G(() => window.__game.powerups.map((r) => [r[0], r[1], Math.round(r[2]), Math.round(r[3])]));
    const slotsWant = await G(() => { const b = window.__life.world.bounds; return Math.max(6, Math.round(Math.sqrt((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 250)); });
    check('power-ups spawn: max(6, sqrt(area)/250) of them, all four types', pu1.length === slotsWant && new Set(pu1.map((r) => r[1])).size === 4, `${pu1.length} (want ${slotsWant}), types ${[...new Set(pu1.map((r) => r[1]))].join()}`);
    check('same seed -> the same pickups (places and types); another seed -> another layout', JSON.stringify(pu1) === JSON.stringify(pu2) && JSON.stringify(pu1) !== JSON.stringify(pu3));
    const objs = await G(async () => { const m = await (await fetch('/data/placements.json')).json(); return { n: window.__life.world.objects.length, want: m.maps[window.__life.world.data.meta.slug || 'centrs']?.objects ?? null }; });
    check('pickups are not objects: the placement object count is unchanged', objs.want == null || objs.n === objs.want || (await G(() => window.__game.isSample)), JSON.stringify(objs));
    // respawn schedule: a taken pickup reappears 20-30 s later, somewhere else (a candidate point, never the same place)
    const rs = await G(() => {
      const g = window.__life.game, f = g.field, s0 = f.slots[0], x0 = s0.x, z0 = s0.z;
      g.player.x = s0.x; g.player.z = s0.z; g.step(0.2);
      const taken = f.slots[0].state === 'wait', t0 = g.playT, at = f.slots[0].at - t0;
      g.autopilot = true; g.player.control = { mode: 'none', x: 0, z: 0 };
      g.step(35);
      return { taken, delay: at, again: f.slots[0].state === 'on', moved: Math.hypot(f.slots[0].x - x0, f.slots[0].z - z0) };
    });
    check('a collected pickup respawns 20-30 s later at another place', rs.taken && rs.delay >= 19.5 && rs.delay <= 30.5 && rs.again && rs.moved > 100, JSON.stringify(rs));
    // ---- each effect works and expires
    await open('bots=0&puseed=424242'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const spd = await G(() => {
      const g = window.__life.game, p = g.player; g.autopilot = true; g.field.slots.forEach((s) => { s.state = 'wait'; s.at = 1e9; });
      // speed scales with the hole's size (and the hole grows while it eats on the way): normalise each run by the unboosted speed of that moment
      const run = () => { const x0 = p.x, z0 = p.z, u0 = p.speed / p.boost; p.control = { mode: 'target', x: p.x + 400, z: p.z }; g.step(1.2); const d = Math.hypot(p.x - x0, p.z - z0), u1 = p.speed / p.boost; p.control = { mode: 'none', x: 0, z: 0 }; g.step(1.2); return d / ((u0 + u1) / 2); };
      const base = run(); window.__game.givePowerup('speed'); const fast = run(); const left = p.fx.speed;
      g.step(7); const after = run();
      return { base, fast, left, after, fx: p.fx.speed, boost: p.boost, r: p.radius };
    });
    check('Ātrums: ~1.5x speed while it lasts, expires after ~6 s', spd.fast / spd.base > 1.3 && spd.fast / spd.base < 1.85 && spd.after / spd.base < 1.15 && spd.after / spd.base > 0.85 && spd.fx === 0 && spd.boost === 1, JSON.stringify(spd));
    const mag = await G(() => {
      const g = window.__life.game, p = g.player, w = g.world; g.autopilot = true; g.field.slots.forEach((s) => { s.state = 'wait'; s.at = 1e9; });
      const pick = () => { const [sx, sz] = g.spawn; let best = null, bd = 1e9; for (const o of w.objects) if (o.state === 0 && !o.mover && !o.isBuilding && o.fit < 0.5) { const d = Math.hypot(o.x - sx, o.z - sz); if (d < bd) { bd = d; best = o; } } return best; };   // (nearest to the start: works on every map)
      const o1 = pick(); if (!o1) return { err: 'no object' };
      p.setRadius(2.2); p.x = o1.x + 3.3; p.z = o1.z; p.vx = p.vz = 0; p.control = { mode: 'none', x: 0, z: 0 }; // 1.5 radii away: outside the mouth (0.92 r)
      g.step(1.5); const stay = o1.state === 0;
      window.__game.givePowerup('magnet'); const t0 = performance.now(); g.step(1.5); const eaten = o1.state !== 0;
      return { stay, eaten, left: p.fx.magnet };
    });
    check('Magnēts: an object 1.5 radii away stays put without it, is pulled in and swallowed with it', mag.stay && mag.eaten, JSON.stringify(mag));
    const dbl = await G(() => {
      const g = window.__life.game, p = g.player, fake = { value: 5, isBuilding: false, fit: 0.4 };
      p.combo.drop(); window.__game.givePowerup('double');
      const a1 = p.award(fake, g.playT);                         // first swallow: combo x1 -> x2 from Dubultpunkti
      p.combo.count = 100; p.combo.mult = 3; p.combo.until = g.playT + 1;
      const a2 = p.award(fake, g.playT);                         // x3 combo x2 = 6 -> capped at 5
      g.autopilot = true; g.step(13);
      return { r1: a1.pts / a1.mass, r2: a2.pts / a2.mass, fx: p.fx.double };
    });
    check('Dubultpunkti: x2 points; with a x3 combo the combined multiplier is capped at x5; expires after ~12 s', Math.abs(dbl.r1 - 2) < 0.05 && Math.abs(dbl.r2 - 5) < 0.2 && dbl.fx === 0, JSON.stringify(dbl));
    await open('bots=2&puseed=424242'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const sh = await G(() => {
      const g = window.__life.game, p = g.player; g.autopilot = true; g.field.slots.forEach((s) => { s.state = 'wait'; s.at = 1e9; });
      const bot = g.holes[1]; g.bots.brains.forEach((b) => { b.nextThink = 1e9; });
      p.setRadius(3); bot.setRadius(8); bot.protectT = 0; p.protectT = 0; bot.alive = true;
      const place = () => { bot.x = p.x; bot.z = p.z; bot.vx = bot.vz = 0; bot.control = { mode: 'none', x: 0, z: 0 }; };
      window.__game.givePowerup('shield'); place(); p.protectT = 0;
      g.step(4); const aliveShield = p.alive && !p.dying;
      g.step(6); place(); g.step(1.5); const gone = p.dying || !p.alive;
      return { aliveShield, gone, fx: p.fx.shield };
    });
    check('Vairogs: a bigger hole cannot swallow the shielded hole; it can after the ~8 s are over', sh.aliveShield && sh.gone, JSON.stringify(sh));
    // bots collect power-ups too (the same rules)
    await open('bots=7&puseed=31337&difficulty=hard'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const bp = await G(() => {
      const g = window.__life.game, p = g.player, b = g.world.bounds; g.autopilot = true;
      const park = () => { p.alive = false; p.dying = null; p.respawnT = 1e9; p.x = b.maxX + 5000; p.z = b.maxZ + 5000; };
      for (let t = 0; t < 150 && g.phase === 'playing'; t++) { park(); for (let i = 0; i < 60; i++) { g.update(1 / 60, true); park(); } }
      const picks = g.bots.holes.map((h) => Object.values(h.picks).reduce((a, c) => a + c, 0));
      return { picks, total: picks.reduce((a, c) => a + c, 0), withCombo: g.bots.holes.filter((h) => h.score > h.mass * 1.1).length };
    });
    check('bots notice and collect power-ups (hard difficulty, 2:30)', bp.total >= 3, JSON.stringify(bp));
    check('bots get combos by the same rules (their points exceed their mass)', bp.withCombo >= 4, JSON.stringify(bp));
    // free roam: power-ups on, nothing ranked
    await open('mode=free&bots=0&puseed=9'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const fr = await G(() => ({ n: window.__game.powerups.length, unranked: window.__game.unranked }));
    check('free roam: power-ups are on, the round is unranked', fr.n >= 6 && fr.unranked, JSON.stringify(fr));
    if (!process.env.MAP) {   // (the daily challenge and the album / achievements layer are the centre map's)
    // the daily challenge: the same schedule for everybody (seed = the day's seed)
    await open('mode=daily&bots=0'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const d1 = await G(() => ({ seed: window.__game.puSeed, list: window.__game.powerups.map((r) => [r[0], r[1], Math.round(r[2])]) }));
    await open('mode=daily&bots=0'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const d2 = await G(() => ({ seed: window.__game.puSeed, list: window.__game.powerups.map((r) => [r[0], r[1], Math.round(r[2])]) }));
    const dseed = await G(() => window.__modes.daily().seed);   // = dailySeed(today), the seed the server hands out too
    check('daily challenge: the same power-up sequence for everyone (seed = the daily seed)', d1.seed === d2.seed && JSON.stringify(d1.list) === JSON.stringify(d2.list) && d1.list.length >= 6 && d1.seed === dseed, JSON.stringify({ s1: d1.seed, s2: d2.seed, dseed }));
    }
    // the trace carries what the server needs
    await open('bots=0&puseed=424242'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    const tr = await G(() => { const g = window.__life.game; g.autoplay(65); return window.__trace(); });
    check('trace v2: points, mass, raw value, swallow points, combo and pickup counters per 10 s sample', tr.v === 2 && ['s', 'm', 'r', 'e', 'k', 'w', 'p', 'c'].every((k) => tr[k].length === tr.t.length) && ['magnet', 'speed', 'double', 'shield'].every((k) => tr.u[k].length === tr.t.length) && tr.p[tr.p.length - 1] <= tr.w[tr.w.length - 1] * 5 + 5 && tr.m[tr.m.length - 1] <= tr.s[tr.s.length - 1] + 5, JSON.stringify({ t: tr.t, w: tr.w.slice(-1), p: tr.p.slice(-1), m: tr.m.slice(-1), s: tr.s.slice(-1), c: tr.c.slice(-1) }));
    if (!process.env.MAP) {
    // achievements (src/meta/achievements.js): the combo ones and "all four power-ups in one round" unlock through the usual eligibility (a debug round needs __metaAllowDebug)
    await open('bots=0&puseed=424242'); await G(() => { window.__metaAllowDebug = true; window.__game.start(); window.__game.skipIntro(); });
    const ach = await G(() => {
      const g = window.__life.game;
      for (const sl of g.field.slots.slice()) { if (sl.state !== 'on') continue; window.__game.teleport(sl.x, sl.z); g.step(0.15); }   // touch every pickup of the map (all four types)
      // the autoplayer needs a 70+ counter for x3; the tiny sample city is sparse, so give it up to 3 x 80 s (the real maps reach it within one chunk)
      for (let i = 0; i < 3 && window.__game.combo.bestMult < 3; i++) g.autoplay(80);
      window.__meta.evalAch && window.__meta.evalAch();
      const st = JSON.parse(localStorage.getItem('bedre.meta.v1') || '{}');
      return { cb: window.__game.combo, ach: Object.keys(st.ach || {}).filter((k) => /^(combo2|combo3|fullkit)$/.test(k)), picked: [...(window.__life.game.player ? Object.keys(window.__life.game.player.picks).filter((t) => window.__life.game.player.picks[t] > 0) : [])] };
    });
    check('achievements: Chain Reaction (x2), Unbroken Chain (x3) and Full Kit (all four power-ups) unlock', ['combo2', 'combo3', 'fullkit'].every((k) => ach.ach.includes(k)), JSON.stringify(ach));
    }
    await open('bots=0&puseed=424242'); await G(() => { window.__game.start(); window.__game.skipIntro(); });
    await G(() => { window.__life.game.autoplay(305); });
    const rcombo = await G(() => document.getElementById('r-combo').textContent);
    check('results screen shows the best combo', /\d+ · ×\d/.test(rcombo), rcombo);
  }

  // ---- wheel zoom
  await open('autostart=1');
  await G(() => window.__game.step(1));
  const wz0 = await G(() => window.__game.cam);
  await page.mouse.move(640, 360);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1500);
  const wz1 = await G(() => window.__game.cam);
  check('wheel zooms out (camera distance grows)', wz1.zoom > wz0.zoom * 1.2 && wz1.dist > wz0.dist * 1.2, `zoom ${wz0.zoom.toFixed(2)} -> ${wz1.zoom.toFixed(2)}, dist ${wz0.dist.toFixed(0)} -> ${wz1.dist.toFixed(0)}`);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const wz2 = await G(() => window.__game.cam);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  const wz3 = await G(() => window.__game.cam);
  check('zoom clamped to limits', wz2.zoom <= 2.61 && wz3.zoom >= 0.59 && wz3.zoom < wz2.zoom, `max ${wz2.zoom.toFixed(2)} min ${wz3.zoom.toFixed(2)}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await G((z) => window.__game.zoomBy(1 / z), wz3.zoom);
  await G(() => { window.__game.step(1); });
  await page.waitForTimeout(1500);
  await shot('14-default-zoom');
  await G(() => window.__game.zoomBy(2.2));
  await page.waitForTimeout(2500);
  await shot('14b-zoomed-out');
  await G(() => window.__game.zoomBy(1 / 2.2));

  // ---- round-start fly-in
  await open('intro=1&introhold=30&autostart=1');
  await page.waitForTimeout(500);
  let it = await G(() => ({ ph: window.__game.state.phase, tl: window.__game.state.timeLeft, intro: window.__game.intro, bots: window.__game.holes.slice(1).map((h) => [h.x, h.z]) }));
  check('intro: phase is intro, timer frozen', it.ph === 'intro' && it.tl === 300 && it.intro && it.intro.dist > 800, JSON.stringify({ ph: it.ph, tl: it.tl, dist: it.intro && Math.round(it.intro.dist) }));
  await shot('13-intro-overview');
  const it2 = await G(() => { window.__game.step(30.7); return { ph: window.__game.state.phase, d: window.__game.intro && window.__game.intro.dist }; }); // read in the same tick: real-time frames cannot advance it
  await shot('13b-intro-gliding');
  check('intro: gliding down', it2.ph === 'intro' && it2.d < it.intro.dist * 0.9, JSON.stringify(it2));
  await G(() => window.__game.step(2.5));
  const it3 = await G(() => ({ ph: window.__game.state.phase, tl: window.__game.state.timeLeft, bots: window.__game.holes.slice(1).map((h) => [h.x, h.z]) }));
  check('intro ends in playing, timer running', it3.ph === 'playing' && it3.tl < 300);
  await page.setViewportSize({ width: 390, height: 780 });
  await open('intro=1&introhold=30&autostart=1');
  await page.waitForTimeout(500);
  await shot('13c-intro-mobile');
  await page.setViewportSize({ width: 1280, height: 720 });
  await open('intro=1&autostart=1');
  await page.mouse.click(300, 300);
  await page.waitForTimeout(400);
  await page.mouse.click(300, 300);
  check('intro can be skipped by input', (await G(() => window.__game.state.phase)) === 'playing');

  // autostart param
  await open('autostart=1');
  check('autostart skips start screen', (await G(() => window.__game.state.phase)) === 'playing');

  check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error('smoke failed:', e); failures++; }).finally(() => {
  kill();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
});
