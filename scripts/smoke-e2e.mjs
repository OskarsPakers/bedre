// End-to-end test of modes + anti-cheat + leaderboards: the BUILT game (own build dir, with a build-time hook that exposes
// the Game object as window.__G, no source edits) served from the real worker (wrangler dev, local D1) with short
// server-timed rounds (ROUND_SECONDS_OVERRIDE). Parallel-safe: own build dir / config / state / ports.
//   E2E_PORT=8795 GPU=1 node scripts/smoke-e2e.mjs        (screenshots -> scripts/out/modes-*.png)
import { build } from 'vite';
import { chromium } from 'playwright';
import { writeConfig, migrate, startWorker, freshDir, resolve, root } from './lib-test.mjs';

const PORT = Number(process.env.E2E_PORT || 8795);
const out = resolve(root, 'scripts/out');
const ROUND = 6;
const dist = resolve(root, 'scripts/.dist-e2e');
await build({
  root, logLevel: 'error',
  build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 },
  plugins: [{
    name: 'expose-game',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/main.js')) return null;
      return code.replace('window.__game = game.api();', 'window.__game = game.api(); window.__G = game;');
    },
  }],
});
const config = writeConfig('e2e', dist);
const persist = freshDir(resolve(root, '.wrangler/smoke-e2e'));
migrate(config, persist);
const worker = await startWorker({ config, persist, port: PORT, vars: { ROUND_SECONDS_OVERRIDE: ROUND, RATE_ROUNDS_PER_HOUR: 100 } });
const BASE = worker.base;

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const scoresOf = async (q) => (await (await fetch(`${BASE}/api/scores?${q}`)).json()).scores;

const browser = await chromium.launch({
  headless: true,
  args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});
async function newPage(viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.reqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/rounds') || (r.url().includes('/api/scores') && r.method() === 'POST')) page.reqs.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  page.openGame = async (q = '') => {
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
    await page.waitForSelector('#loading', { state: 'detached', timeout: 15000 }).catch(() => {});
    await sleep(300);
  };
  return page;
}
const pick = (page, mode) => page.click(`#modesw [data-mode=${mode}]`);
const waitPlaying = (page) => page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 30000 });
const waitResults = (page) => page.waitForSelector('#results:not(.hidden)', { timeout: 40000 });
const globalText = (page) => page.waitForFunction(() => /#\d+|saved|unranked|practice|Practice|Free roam|Treni|Brīvā/i.test(document.getElementById('r-global').textContent), null, { timeout: 15000 }).then(() => page.textContent('#r-global'));
/** A real-time greedy controller running in the page (like a player: it only steers; the sim, the trace and the submission are the game's own). */
const startAutopilot = (page) => page.evaluate(() => {
  const g = window.__G; g.autopilot = true;
  window.__pilot = setInterval(() => {
    if (g.phase !== 'playing') return;
    const p = g.player; let best = null, bs = -1;
    g.world.query(p.x, p.z, Math.max(25, p.radius * 9), (o, d) => { if (o.state !== 0 || o.fit >= p.radius * 0.95) return; const s = o.value / (d + p.radius * 1.5 + 4); if (s > bs) { bs = s; best = o; } });
    p.control = best ? { mode: 'target', x: best.x, z: best.z } : { mode: 'target', x: p.x + 80, z: p.z + 40 };
  }, 150);
});
const stopAutopilot = (page) => page.evaluate(() => { clearInterval(window.__pilot); window.__G.autopilot = false; });
const rows = (page) => page.$$eval('#ts-body tr', (trs) => trs.map((tr) => ({ me: tr.classList.contains('me'), cells: [...tr.children].map((c) => c.textContent) })));

try {
  // ============ Classic: server round length, ranked, boards ============================================
  const page = await newPage();
  await page.openGame('intro=0');
  await page.screenshot({ path: resolve(out, 'modes-start-desktop.png') });
  check('start screen: mode selector with 4 modes, Classic selected by default', (await page.$$eval('#modesw [data-mode]', (b) => b.map((x) => x.dataset.mode + ':' + x.getAttribute('aria-checked')))).join() === 'classic:true,quick:false,daily:false,free:false');
  check('9 bots are built, classic uses 7', (await page.evaluate(() => window.__game.botCount)) === 7);
  await page.fill('#name', 'E2E Tester');
  await page.click('#play');
  await waitPlaying(page); await sleep(600);
  const tl = await page.evaluate(() => window.__game.state.timeLeft);
  check(`classic: round length comes from the server (${ROUND}s, not 300s)`, tl <= ROUND && tl > 0, `timeLeft=${tl}`);
  await startAutopilot(page);
  await waitResults(page); await stopAutopilot(page);
  let g = await globalText(page);
  check('classic: a legit (autopilot) round is accepted -> global rank shown', /Global rank: #1 all-time · #1 today/.test(g), g);
  let list = await scoresOf('mode=classic&period=all');
  check('classic board has exactly that row', list.length === 1 && list[0].name === 'E2E Tester', JSON.stringify(list));

  await page.click('#open-scores2');
  await page.waitForSelector('#ts-body tr', { timeout: 10000 });
  let r = await rows(page);
  check('Top scores opens on the last played mode (classic), row highlighted', r.length === 1 && r[0].me && r[0].cells[1].startsWith('E2E Tester'), JSON.stringify(r));
  await page.click('#scores [data-smode=quick]');
  await page.waitForFunction(() => /No scores yet|Vēl nav/.test(document.getElementById('ts-msg').textContent), null, { timeout: 5000 });
  check('quick tab is empty (per-mode boards)', (await rows(page)).length === 0);
  await page.click('#ts-close');

  // ============ Tampered submission is rejected ========================================================
  await page.route('**/api/scores', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const b = JSON.parse(route.request().postData()); b.score = b.score + 500000;   // cheat: inflate the score, keep the trace
    await route.continue({ postData: JSON.stringify(b) });
  });
  await page.click('#again');
  await waitPlaying(page); await startAutopilot(page);
  await waitResults(page); await stopAutopilot(page);
  g = await globalText(page);
  check('tampered score (trace does not match) -> not saved', /not saved/i.test(g), g);
  check('board unchanged after the tampered submission', (await scoresOf('mode=classic&period=all')).length === 1);
  await page.unroute('**/api/scores');

  // ============ Quick ===============================================================================
  await page.evaluate(() => location.reload());
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await pick(page, 'quick');
  check('quick: selector + description', (await page.getAttribute('#modesw [data-mode=quick]', 'aria-checked')) === 'true' && /2:00/.test(await page.textContent('#mode-desc')));
  await page.fill('#name', 'Quick Q');
  await page.click('#play');
  await waitPlaying(page); await sleep(400);
  check('quick: growth constant switched for the round', (await page.evaluate(() => window.__modes.state.id)) === 'quick');
  await startAutopilot(page);
  await waitResults(page); await stopAutopilot(page);
  g = await globalText(page);
  check('quick: legit round accepted (own board)', /Global rank: #1/.test(g), g);
  await page.screenshot({ path: resolve(out, 'modes-quick-results.png') });
  list = await scoresOf('mode=quick&period=all');
  check('quick board has the quick row; classic board is untouched', list.length === 1 && list[0].name === 'Quick Q' && (await scoresOf('mode=classic&period=all')).length === 1);
  await page.click('#open-scores2');
  await page.waitForSelector('#ts-body tr');
  check('Top scores follows the played mode (quick)', (await page.getAttribute('#scores [data-smode=quick]', 'aria-selected')) === 'true');
  await page.screenshot({ path: resolve(out, 'modes-top-scores.png') });
  await page.click('#ts-close');

  // ============ Free roam ===========================================================================
  await page.evaluate(() => location.reload());
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await pick(page, 'free');
  page.reqs.length = 0;
  await page.click('#play');
  await waitPlaying(page); await sleep(1500);
  const st = await page.evaluate(() => ({ bots: window.__game.botCount, left: window.__game.state.timeLeft, unranked: window.__game.unranked, end: getComputedStyle(document.getElementById('end-free')).display, time: getComputedStyle(document.getElementById('card-time')).display }));
  check('free roam: no bots, no timer, End button, ranking off', st.bots === 0 && st.left > 1e6 && st.unranked === 'free' && st.end !== 'none' && st.time === 'none', JSON.stringify(st));
  await page.screenshot({ path: resolve(out, 'modes-free-roam-hud.png') });
  await page.click('#end-free');
  await waitResults(page);
  g = await globalText(page);
  check('free roam: results say nothing is saved; no server round was requested', /Free roam/.test(g) && page.reqs.length === 0, `${g} ${page.reqs.join()}`);
  check('free roam: results title is "Walk finished"', /Walk finished/.test(await page.textContent('#results .sub')));
  check('free roam submitted nothing', (await scoresOf('mode=classic&period=all')).length === 1 && (await scoresOf('mode=quick&period=all')).length === 1);

  // ============ Daily: same setup in two fresh browsers, one ranked attempt =========================
  const setupOf = async (p) => p.evaluate(() => ({ spawn: window.__game.spawn.map((v) => Math.round(v)), names: window.__game.holes.slice(1).map((h) => h.name).join('|'), day: window.__modes.daily().day, twist: window.__modes.daily().twist.id, bots: window.__game.botCount }));
  const A = await newPage();
  await A.openGame('intro=1');
  await pick(A, 'daily');
  A.reqs.length = 0;
  await A.fill('#name', 'Daily Dan');
  await A.click('#play');
  await A.waitForSelector('#daily-intro.show', { timeout: 5000 });   // shown while the fly-in intro runs
  check('daily intro banner shows the twist', /Daily challenge/.test(await A.textContent('#daily-intro')) && /Today's twist/.test(await A.textContent('#daily-intro')));
  await A.screenshot({ path: resolve(out, 'modes-daily-intro.png') });
  await waitPlaying(A);
  const setA = await setupOf(A);
  check('daily: today\'s twist/bots are applied', setA.bots === (setA.twist === 'bots9' || setA.twist === 'crowd' ? 9 : setA.twist === 'quiet' ? 3 : 7), JSON.stringify(setA));
  await startAutopilot(A);
  await waitResults(A); await stopAutopilot(A);
  g = await globalText(A);
  check('daily: first attempt is ranked (own daily board)', /Daily board: #1/.test(g), g);
  const dl = await scoresOf(`mode=daily&day=${setA.day}`);
  check('daily board has the row for today', dl.length === 1 && dl[0].name === 'Daily Dan', JSON.stringify(dl));

  // second attempt on the same browser = practice: same setup, no server round, nothing submitted
  A.reqs.length = 0;
  await A.click('#again');
  await waitPlaying(A);
  check('daily: second attempt is practice (unranked)', (await A.evaluate(() => window.__game.unranked)) === 'practice');
  const setA2 = await setupOf(A);
  check('daily: practice has the same setup as the ranked attempt', setA2.names === setA.names && setA2.twist === setA.twist, JSON.stringify([setA, setA2]));
  await A.evaluate(() => window.__G.end());
  await waitResults(A);
  g = await globalText(A);
  check('daily practice: note shown, no round requested, nothing submitted', /Practice/.test(g) && A.reqs.length === 0 && (await scoresOf(`mode=daily&day=${setA.day}`)).length === 1, `${g} ${A.reqs.join()}`);

  // a second fresh browser context: same seed / spawn / bot names
  const B = await newPage();
  await B.openGame('intro=0');
  await pick(B, 'daily');
  await B.click('#play');
  await waitPlaying(B);
  const setB = await setupOf(B);
  check('daily: two fresh browsers get the same bot names + twist', setB.names === setA.names && setB.twist === setA.twist && setB.day === setA.day, JSON.stringify([setA, setB]));
  check('daily: two fresh browsers get the same player spawn', Math.hypot(setB.spawn[0] - setA.spawn[0], setB.spawn[1] - setA.spawn[1]) < 1, JSON.stringify([setA.spawn, setB.spawn]));
  await B.evaluate(() => window.__G.end());
  await B.context().close();

  // ============ Top scores: daily tab shows the day + twist ============================================
  await A.click('#open-scores2');
  await A.waitForSelector('#ts-body tr', { timeout: 10000 });
  check('Top scores opens on daily with the twist line', /Twist:/.test(await A.textContent('.ts-twist')) && (await A.getAttribute('#scores [data-smode=daily]', 'aria-selected')) === 'true');
  await A.click('#scores [data-dpick="-1"]');
  await A.waitForFunction(() => /No scores yet|Vēl nav/.test(document.getElementById('ts-msg').textContent), null, { timeout: 5000 });
  check('daily: yesterday board is empty', (await rows(A)).length === 0);
  await A.screenshot({ path: resolve(out, 'modes-top-scores-daily.png') });
  await A.click('#ts-close');

  // ============ analytics: counters landed (DNT-free browser) ===========================================
  await sleep(500);
  await A.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await sleep(1500);
  const stats = await (await fetch(`${BASE}/api/stats?days=2`)).json();
  const keys = stats.days.reduce((a, d) => ({ ...a, ...Object.fromEntries(Object.entries(d.keys).map(([k, v]) => [k, (a[k] || 0) + v])) }), {});
  check('analytics: page views + round counters recorded', keys.pv >= 1 && keys['rs:classic'] >= 1 && keys['rs:daily'] >= 1, JSON.stringify(keys));

  // ============ mobile start screen (crowding check) ====================================================
  const M = await newPage({ width: 390, height: 780 });
  await M.openGame('intro=0');
  await M.screenshot({ path: resolve(out, 'modes-start-mobile.png') });
  const overflow = await M.evaluate(() => { const pi = document.querySelector('#start .panel-inner'); return { sw: pi.scrollWidth, cw: pi.clientWidth, bodyX: document.documentElement.scrollWidth > innerWidth }; });
  check('mobile start screen: no horizontal overflow', overflow.sw <= overflow.cw + 1 && !overflow.bodyX, JSON.stringify(overflow));

  // ============ stats page (sample data + the real, tiny local data) ====================================
  const S = await newPage({ width: 1100, height: 900 });
  await S.goto(`${BASE}/stats.html?sample=1`);
  await S.waitForSelector('#charts svg', { timeout: 10000 });
  check('stats page renders charts with sample data', (await S.$$('#charts svg')).length >= 6 && /SAMPLE/.test(await S.textContent('#sub')));
  await S.screenshot({ path: resolve(out, 'modes-stats.png'), fullPage: true });
  await S.goto(`${BASE}/stats.html`);
  await S.waitForSelector('#out:not([hidden])', { timeout: 10000 });
  check('stats page renders the real (local) aggregates', (await S.$$('#tiles .tile')).length === 6);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
  failed++;
}
await browser.close().catch(() => {});
worker.kill();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall e2e checks passed');
process.exit(failed ? 1 : 0);
