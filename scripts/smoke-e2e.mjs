// End-to-end high-score test: the BUILT game served from the real worker (wrangler dev, local D1) with a short
// server-side round (ROUND_SECONDS_OVERRIDE). The client learns the round length from POST /api/rounds.
//   GPU=1 npm run smoke:e2e
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'scripts/out');
const PORT = Number(process.env.E2E_PORT || 8792);
const BASE = `http://localhost:${PORT}`;
const persist = resolve(root, '.wrangler/e2e-state');
rmSync(persist, { recursive: true, force: true });
const ROUND = 6;

const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) { console.error('failed:', cmd, args.join(' ')); process.exit(1); } };
run('npm', ['run', 'build']);
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--persist-to', persist]);
const child = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', persist, '--var', `ROUND_SECONDS_OVERRIDE:${ROUND}`],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
process.on('exit', killAll);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

try {
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { try { ready = (await fetch(BASE + '/')).ok; } catch {} if (!ready) await sleep(500); }
  if (!ready) throw new Error('wrangler dev not ready\n' + log);

  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const open = async (q = '') => {
    await page.goto(`${BASE}/?intro=0${q}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
  };
  const rows = async () => page.$$eval('#ts-body tr', (trs) => trs.map((tr) => ({ me: tr.classList.contains('me'), cells: [...tr.children].map((c) => c.textContent) })));
  const playRound = async () => {
    await page.click('#play, #again');
    await page.waitForFunction(() => window.__game.state.phase === 'playing');
    for (let i = 0; i < 6; i++) { await page.mouse.move(400 + i * 90, 300 + (i % 2) * 120); await sleep(300); }
    await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  };
  const globalText = () => page.waitForFunction(() => /#\d+/.test(document.getElementById('r-global').textContent) || /not saved|nav saglab/.test(document.getElementById('r-global').textContent), null, { timeout: 15000 }).then(() => page.textContent('#r-global'));

  // ---- round 1 (ranked, no debug hooks, no URL overrides)
  await open();
  await page.fill('#name', 'E2E Tester');
  await page.click('#play');
  await page.waitForFunction(() => window.__game.state.phase === 'playing');
  await sleep(500);
  const tl = await page.evaluate(() => window.__game.state.timeLeft);
  check(`round length comes from the server (${ROUND}s, not 300s)`, tl <= ROUND && tl > 0, `timeLeft=${tl}`);
  for (let i = 0; i < 6; i++) { await page.mouse.move(400 + i * 90, 300 + (i % 2) * 120); await sleep(300); }
  await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  let g = await globalText();
  check('results show global rank', /Global rank: #1 all-time · #1 today/.test(g), g);
  await page.screenshot({ path: resolve(out, 'final-results-global.png') });

  await page.click('#open-scores2');
  await page.waitForSelector('#ts-body tr', { timeout: 10000 });
  let r = await rows();
  check('Top scores (Today) lists the row, highlighted', r.length === 1 && r[0].me && r[0].cells[1].startsWith('E2E Tester'), JSON.stringify(r));
  await page.screenshot({ path: resolve(out, 'final-top-scores.png') });
  for (const tab of ['week', 'all']) {
    await page.click(`#scores [data-period=${tab}]`);
    await page.waitForFunction(() => document.querySelectorAll('#ts-body tr').length > 0);
    r = await rows();
    check(`tab ${tab}: one row`, r.length === 1, JSON.stringify(r));
  }
  await page.click('#ts-close');

  // ---- replay: a new round id, exactly one more row (no duplicate of round 1)
  await page.click('#again');
  await page.waitForFunction(() => window.__game.state.phase === 'playing');
  await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  g = await globalText();
  check('replay submits (global rank shown again)', /Global rank: #\d+/.test(g), g);
  await page.click('#open-scores2');
  await page.waitForSelector('#ts-body tr');
  await page.waitForFunction(() => document.querySelectorAll('#ts-body tr').length === 2, null, { timeout: 5000 }).catch(() => {});
  r = await rows();
  check('after replay: exactly 2 rows (one per round)', r.length === 2, JSON.stringify(r));
  await page.click('#ts-close');

  // ---- debug hook => unranked, nothing submitted
  await page.click('#again');
  await page.waitForFunction(() => window.__game.state.phase === 'playing');
  await page.evaluate(() => window.__game.setRadius(5));
  await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  await sleep(500);
  g = await page.textContent('#r-global');
  check('debug hook marks the round unranked', /unranked/i.test(g) && (await page.evaluate(() => window.__game.unranked)) === 'setRadius', g);

  // ---- ?time= override => unranked
  await open('&time=3&autostart=1');
  await page.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  await sleep(500);
  g = await page.textContent('#r-global');
  check('?time= override is unranked', /unranked/i.test(g), g);

  const list = await (await fetch(`${BASE}/api/scores?period=all&limit=50`)).json();
  check('server holds exactly 2 scores', list.scores.length === 2, JSON.stringify(list));
  check('no page errors', errors.length === 0, errors.join(' | '));

  // ---- seed more rows (incl. hostile names) and check the panel renders them as plain text
  const names = ['Līga', 'Kārlis', '<img src=x>', 'Zane ☕', 'Jānis Bērziņš', 'Anna', 'Uldis'];
  const ids = [];
  const jsonHdr = { 'content-type': 'application/json' };
  for (let i = 0; i < names.length; i++) ids.push((await (await fetch(BASE + '/api/rounds', { method: 'POST', headers: jsonHdr, body: '{}' })).json()).roundId);
  await sleep((ROUND + 1) * 1000);
  for (let i = 0; i < names.length; i++) {
    await fetch(BASE + '/api/scores', { method: 'POST', headers: jsonHdr,
      body: JSON.stringify({ roundId: ids[i], name: names[i], score: 4000 + i * 2900, eaten: 300 + i * 40, radius: 18 + i * 4.5, rank: 1 + (i % 3), biggest: 'tram' }) });
  }
  await page.click('#open-scores2');
  await page.click('#scores [data-period=all]');
  await page.waitForFunction(() => document.querySelectorAll('#ts-body tr').length >= 9);
  check('hostile names rendered as text only', (await page.$$('#ts-body img, #ts-body b')).length === 0 && (await page.$$eval('#ts-body tr', (t) => t.length)) === 9);
  await page.screenshot({ path: resolve(out, 'final-top-scores-data.png') });
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
}
killAll();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall e2e checks passed');
process.exit(failed ? 1 : 0);
