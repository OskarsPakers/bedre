// Cross-feature regression matrix: boots the built game and plays ~20-25 s (autoplay hook) for ~24 combinations of
// map x theme x mode x quality (+ LV/EN, a phone and a landscape viewport). Per combination it asserts:
//   no console / page errors, key HUD nodes do not overlap and stay inside the viewport, the score rises, the results panel renders
//   (Play again reachable and not covered), Play again starts a new round. One screenshot each (scripts/out/matrix-*.png) + a contact sheet.
//   MATRIX_PORT=5188 GPU=1 node scripts/smoke-matrix.mjs [--only <substring>] [--no-build] [--fast]
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.MATRIX_PORT || 5188);
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', '.dist-matrix');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const only = arg('--only', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const D = { viewport: { width: 1280, height: 720 } };
const PH = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
// [map, theme, mode, quality, lang, viewport]
const COMBOS = [
  ['centrs', 'day', 'classic', 'high', 'lv', D], ['centrs', 'evening', 'classic', 'low', 'en', D], ['centrs', 'winter', 'quick', 'high', 'lv', D],
  ['centrs', 'nov18', 'classic', 'high', 'lv', D], ['centrs', 'day', 'free', 'low', 'en', D], ['centrs', 'evening', 'daily', 'high', 'lv', D],
  ['centrs', 'winter', 'daily', 'low', 'en', D], ['centrs', 'nov18', 'quick', 'low', 'lv', D],
  ['agenskalns', 'day', 'classic', 'high', 'lv', D], ['agenskalns', 'evening', 'quick', 'low', 'en', D], ['agenskalns', 'winter', 'classic', 'low', 'lv', D],
  ['agenskalns', 'nov18', 'free', 'high', 'lv', D],
  ['mezaparks', 'day', 'classic', 'low', 'en', D], ['mezaparks', 'evening', 'classic', 'high', 'lv', D], ['mezaparks', 'winter', 'quick', 'high', 'lv', D],
  ['mezaparks', 'nov18', 'classic', 'low', 'lv', D],
  ['purvciems', 'day', 'classic', 'high', 'lv', D], ['purvciems', 'evening', 'free', 'low', 'en', D], ['purvciems', 'winter', 'classic', 'high', 'lv', D],
  ['purvciems', 'nov18', 'quick', 'low', 'lv', D],
  ['centrs', 'day', 'classic', 'low', 'lv', { name: 'phone390', ...PH(390, 780) }], ['purvciems', 'evening', 'classic', 'low', 'en', { name: 'land780', ...PH(780, 390) }],
  ['agenskalns', 'day', 'quick', 'high', 'en', { name: 'phone360', ...PH(360, 640) }], ['mezaparks', 'winter', 'classic', 'low', 'lv', { name: 'phone430', ...PH(430, 932) }],
].map(([map, theme, mode, quality, lang, vp]) => ({ map, theme, mode, quality, lang, vp, id: `${map}-${theme}-${mode}-${quality}-${lang}-${vp.name || 'desktop'}` }));

if (!process.argv.includes('--no-build')) await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 } });
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
const kill = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(250); }
const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] });

let failures = 0;
const results = [];
const HUD = ['#card-score', '#card-time', '#board', '#minimap-box', '#sizebox', '#meta-pct', '#end-free', '#pause-btn', '#mute-btn', '#radio-btn', '#attrib', '#daily-intro.show'];
const overlapTest = (page) => page.evaluate((sel) => {
  const W = window.innerWidth, H = window.innerHeight, boxes = [];
  const add = (name, el) => {
    if (!el) return; const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    boxes.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
  };
  for (const s of sel) add(s, document.querySelector(s));
  for (const el of document.querySelectorAll('#feed .feed-item')) add('feed-item', el);
  const bad = [];
  for (const b of boxes) if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) bad.push(`${b.name} outside viewport`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 1.5 && oy > 1.5) bad.push(`${a.name} overlaps ${b.name} (${Math.round(ox)}x${Math.round(oy)})`);
  }
  return { n: boxes.length, bad, names: boxes.map((b) => b.name) };
}, HUD);

async function runCombo(c) {
  const errs = [], problems = [];
  const ctx = await browser.newContext({ ...c.vp, locale: c.lang === 'lv' ? 'lv-LV' : 'en-US', timezoneId: 'Europe/Riga' });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline (matrix test)"}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\/|503|Failed to load resource|GL Driver|GPU stall/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  const q = new URLSearchParams({ map: c.map, theme: c.theme, mode: c.mode, quality: c.quality, intro: '0' });
  if (c.mode !== 'free') q.set('time', '24');
  await page.goto(`${base}/?${q}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  if (await page.evaluate(() => document.body.dataset.error)) problems.push('boot error ' + await page.evaluate(() => document.body.dataset.error));
  await sleep(400);
  // start screen
  if (!(await page.isVisible('#start'))) problems.push('start screen not visible');
  const sel = await page.evaluate(() => ({ mode: document.querySelector('#modesw [aria-checked=true]')?.dataset.mode, map: document.body.dataset.map }));
  if (sel.mode !== c.mode) problems.push(`mode selector shows ${sel.mode}, wanted ${c.mode}`);
  const playBox = await page.locator('#play').boundingBox();
  if (!playBox || playBox.y + playBox.height > c.vp.viewport.height) problems.push('Play button below the fold');
  const so = await page.evaluate(() => {
    const r = document.querySelector('#start .panel-inner').getBoundingClientRect(), bad = [];
    for (const s of ['#mute-btn', '#radio-btn']) { const e = document.querySelector(s); if (!e) continue; const b = e.getBoundingClientRect(); const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left), oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top); if (ox > 1 && oy > 1) bad.push('start card: ' + s + ' overlaps the card'); }
    return bad;
  });
  for (const b of so) problems.push(b);
  await page.click('#play');
  await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase), null, { timeout: 15000 });
  await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state.phase === 'playing', null, { timeout: 15000 });
  const s0 = await page.evaluate(() => window.__game.state.score);
  await page.evaluate(() => window.__game.autoplay(8));
  await sleep(500);
  const s1 = await page.evaluate(() => window.__game.state.score);
  if (!(s1 > s0)) problems.push(`score did not increase (${s0} -> ${s1})`);
  const ov = await overlapTest(page);
  for (const b of ov.bad) problems.push('HUD: ' + b);
  await page.screenshot({ path: path.join(out, `matrix-play-${c.id}.png`) });
  // the daily intro banner may still show; wait it out, then more play + a toast-ish interaction
  await page.evaluate(() => window.__game.autoplay(6));
  await sleep(300);
  if (c.mode === 'free') { await page.click('#end-free'); } else { await page.evaluate(() => window.__game.autoplay(20)); }
  await page.waitForFunction(() => window.__game.state.phase === 'ended', null, { timeout: 20000 }).catch(() => problems.push('round did not end'));
  await sleep(1600);
  const res = await page.evaluate(() => {
    const r = document.getElementById('results'), again = document.getElementById('again');
    const vis = r && !r.classList.contains('hidden');
    const ab = again.getBoundingClientRect(), cx = ab.left + ab.width / 2, cy = ab.top + ab.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const card = document.querySelector('#results .panel-inner').getBoundingClientRect();
    return { vis, score: document.getElementById('r-score').textContent, againOk: !!top && (top === again || again.contains(top)), againInView: ab.bottom <= window.innerHeight + 1 && ab.top >= 0, cardInView: card.top >= -1 && card.bottom <= window.innerHeight + 1 && card.left >= -1 && card.right <= window.innerWidth + 1,
      toasts: document.querySelectorAll('#meta-toasts .meta-toast').length, rows: document.querySelectorAll('#r-table tr').length };
  });
  if (!res.vis) problems.push('results panel not visible');
  if (!res.againOk) problems.push('Play again is covered');
  if (!res.againInView) problems.push('Play again below the fold');
  if (!res.cardInView) problems.push('results card not inside viewport');
  if (!(parseInt(res.score.replace(/\D/g, ''), 10) > 0)) problems.push('results score is ' + res.score);
  if (res.toasts) problems.push(`${res.toasts} toast(s) over the results`);
  const ro = await page.evaluate((sel) => {
    const r = document.querySelector('#results .panel-inner').getBoundingClientRect(), bad = [];
    for (const s of ['#mute-btn', '#radio-btn']) { const e = document.querySelector(s); if (!e) continue; const b = e.getBoundingClientRect(); const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left), oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top); if (ox > 1 && oy > 1) bad.push(s + ' overlaps the results card'); }
    return bad;
  });
  for (const b of ro) problems.push(b);
  await page.screenshot({ path: path.join(out, `matrix-${c.id}.png`) });
  // Play again
  await page.click('#again');
  await page.waitForFunction(() => ['intro', 'playing'].includes(window.__game.state.phase), null, { timeout: 15000 }).catch(() => problems.push('Play again did not start a round'));
  await page.evaluate(() => window.__game.skipIntro());
  await sleep(300);
  const again = await page.evaluate(() => ({ phase: window.__game.state.phase, hud: !document.getElementById('hud').classList.contains('hidden'), results: !document.getElementById('results').classList.contains('hidden') }));
  if (again.phase !== 'playing' || !again.hud || again.results) problems.push('Play again: ' + JSON.stringify(again));
  for (const e of errs) problems.push(e);
  await ctx.close();
  return problems;
}

for (const c of COMBOS) {
  if (only && !c.id.includes(only)) continue;
  let problems;
  const t0 = Date.now();
  try { problems = await runCombo(c); } catch (e) { problems = ['EXCEPTION ' + e.message.split('\n')[0]]; }
  const ok = !problems.length; if (!ok) failures++;
  results.push({ id: c.id, ok, problems });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.id}  (${((Date.now() - t0) / 1000).toFixed(0)}s)${ok ? '' : '\n        - ' + problems.join('\n        - ')}`);
}

// ---- contact sheets: gameplay HUD (matrix-contact-sheet.png) and results (matrix-contact-sheet-results.png) ------------------
for (const [prefix, name] of [['matrix-play-', 'matrix-contact-sheet.png'], ['matrix-', 'matrix-contact-sheet-results.png']]) {
  const files = results.map((r) => ({ r, f: path.join(out, `${prefix}${r.id}.png`) })).filter((x) => fs.existsSync(x.f));
  const cells = files.map(({ r, f }) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption style="color:${r.ok ? '#8f8' : '#f88'}">${r.id}</figcaption></figure>`).join('');
  const html = `<body style="margin:0;background:#111;font:11px system-ui"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px">${cells}</div><style>figure{margin:0}img{width:100%;height:230px;object-fit:contain;background:#222;display:block}figcaption{padding:2px 0}</style></body>`;
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await sheet.setContent(html); await sleep(800);
  await sheet.screenshot({ path: path.join(out, name), fullPage: true });
  await sheet.close();
}
console.log(`\nmatrix: ${results.length - failures}/${results.length} combinations clean`);
await browser.close(); kill();
process.exit(failures ? 1 : 0);
