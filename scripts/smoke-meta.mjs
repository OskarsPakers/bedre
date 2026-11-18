// Meta features smoke test (album, achievements, % meter, area banner, recap, share card, PWA, radio, daily streak, weekly goals, rewards). PORT=5188 GPU=1 node scripts/smoke-meta.mjs
import { chromium, webkit, devices } from 'playwright';
import { runRetention, retentionShots } from './lib/retention-checks.mjs';
import { runWardrobe } from './lib/f45-meta-checks.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5188;
const base = `http://localhost:${PORT}`;
const dist = path.join(root, 'scripts', `.dist-${PORT}`);
await new Promise((res, rej) => spawn('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d)); server.stderr.on('data', (d) => (serverLog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); if (i === 59) throw new Error('server did not start\n' + serverLog); }

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // the tests drive the game with debug hooks (which flag a round unranked): allow progress for them unless the URL says ?strictdebug=1
  await ctx.addInitScript(() => { window.__metaAllowDebug = !location.search.includes('strictdebug'); });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const open = async (q = '', p = page) => {
    await p.goto(`${base}/?${q}`);
    await p.waitForFunction(() => (document.body.dataset.ready === '1' && window.__meta) || document.body.dataset.error, null, { timeout: 120000 });
    if (await p.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
  };
  const shot = (name, p = page) => p.screenshot({ path: path.join(out, `meta-${name}.png`) });

  // ---- static assets: manifest + icons ---------------------------------------------------------------------------
  const man = await (await fetch(`${base}/manifest.webmanifest`)).json();
  check('manifest fields', man.name && man.short_name && man.display === 'standalone' && man.orientation === 'any' && /^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color) && man.start_url && man.icons.length >= 3);
  let iconOk = true; const iconInfo = [];
  for (const ic of man.icons) {
    const r = await fetch(base + ic.src); const buf = Buffer.from(await r.arrayBuffer());
    const sz = pngSize(buf); const want = +ic.sizes.split('x')[0];
    if (!r.ok || sz.w !== want || sz.h !== want) iconOk = false; iconInfo.push(`${ic.src}:${sz.w}`);
  }
  check('manifest icons exist with declared sizes (incl. maskable)', iconOk && man.icons.some((i) => i.purpose === 'maskable'), iconInfo.join(' '));
  const at = await fetch(`${base}/icons/apple-touch-icon.png`); check('apple-touch-icon 180', at.ok && pngSize(Buffer.from(await at.arrayBuffer())).w === 180);
  const og = fs.readFileSync(path.join(root, 'public', 'og.png')); check('og.png is 1200x630', pngSize(og).w === 1200 && pngSize(og).h === 630);
  const html = await (await fetch(base + '/')).text();
  check('index.html og/twitter image absolute + manifest link', html.includes('og:image" content="https://bedre.pakers.lv/og.png"') && html.includes('twitter:image" content="https://bedre.pakers.lv/og.png"') && html.includes('rel="manifest"'));

  // ---- start screen --------------------------------------------------------------------------------------------------
  await open('');
  check('start screen shows ONE progress button', (await page.locator('#start [data-meta-open]').count()) === 1 && await page.locator('#open-progress').isVisible());
  await sleep(300); await shot('start-desktop');
  await page.setViewportSize({ width: 390, height: 780 }); await sleep(200); await shot('start-mobile');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- radio: visible by default, hidden with ?radio=0, click sets the station ------------------------------------
  check('radio button visible by default', await page.locator('#radio-btn').isVisible());
  const rp = await ctx.newPage(); const rerr = [];
  rp.on('pageerror', (e) => rerr.push(e.message));
  await open('radio=0', rp); check('?radio=0 hides the radio button', (await rp.locator('#radio-btn').count()) === 0);
  await open('', rp);
  check('radio audio idle before any click', await rp.evaluate(() => !window.__radio.on && !window.__radio.audio.dataset.src));
  await rp.click('#radio-btn');
  const st = await rp.evaluate(() => ({ id: window.__radio.audio.dataset.station, src: window.__radio.audio.dataset.src, on: window.__radio.on, pressed: document.getElementById('radio-btn').getAttribute('aria-pressed') }));
  check('radio click: audio element gets the LR2 station URL', st.id === 'lr2' && /lr2_radio/.test(st.src) && st.on && st.pressed === 'true', st.src);
  await sleep(1200);
  check('radio popup shows station + broadcaster link', (await rp.locator('#radio-pop').innerText()).includes('Latvijas Radio 2') && (await rp.locator('#radio-pop a').getAttribute('href')) === 'https://lr2.lsm.lv');
  await rp.setViewportSize({ width: 1280, height: 720 }); await sleep(300); await rp.screenshot({ path: path.join(out, 'meta-radio.png'), clip: { x: 560, y: 0, width: 520, height: 130 } });
  await rp.click('#radio-btn'); check('radio click while playing toggles the station card (still playing)', await rp.evaluate(() => window.__radio.on));
  await rp.click('#radio-pop').catch(() => {}); await rp.evaluate(() => { document.getElementById('radio-pop').hidden = false; }); await rp.click('#radio-stop'); check('radio Stop button stops it', await rp.evaluate(() => !window.__radio.on));
  await rp.close();

  // ---- debug hooks never unlock anything ---------------------------------------------------------------------------
  await open('autostart=1&intro=0&strictdebug=1');
  await page.evaluate(() => { try { localStorage.removeItem('bedre.meta.v1'); } catch {} });
  await open('autostart=1&intro=0&strictdebug=1');
  const dbg = await page.evaluate(() => { const e = window.__meta.album.entries.find((x) => x.id === 'powder') || window.__meta.album.entries[0]; window.__game.setRadius(40); window.__game.teleport(e.x, e.z); window.__game.step(1.5); const st = JSON.parse(localStorage.getItem('bedre.meta.v1') || 'null'); return { album: st ? Object.keys(st.album).length : 0, ach: st ? Object.keys(st.ach).length : 0, pct: window.__meta.pct.me, ctr: st ? st.ctr.buildings || 0 : 0 }; });
  check('rounds flagged unranked by debug hooks unlock no album entries / achievements / progress', dbg.album === 0 && dbg.ach === 0 && dbg.pct === 0 && dbg.ctr === 0, JSON.stringify(dbg));
  // ---- gameplay: album, achievements, % meter, area banner ---------------------------------------------------------
  await open('autostart=1&intro=0');
  await page.evaluate(() => { try { localStorage.removeItem('bedre.meta.v1'); } catch {} });
  await open('autostart=1&intro=0');
  const info = await page.evaluate(() => ({ n: window.__meta.album.entries.length, ids: window.__meta.album.entries.map((e) => e.id), areas: window.__meta.areas.map((a) => a.id), defs: window.__meta.defs.length }));
  check('album has 25-40 entries', info.n >= 25 && info.n <= 40, `n=${info.n} ${info.ids.slice(0, 12).join(',')}…`);
  check('~20+ achievements, areas loaded', info.defs >= 20 && info.areas.length >= 4, `defs=${info.defs} areas=${info.areas.length}`);

  // collect a landmark: teleport onto the Powder Tower (or the first curated building) with a huge hole
  const target = await page.evaluate(() => { const e = window.__meta.album.entries.find((x) => x.id === 'powder') || window.__meta.album.entries.find((x) => x.type !== 'tram' && x.type !== 'ferry'); return { id: e.id, x: e.x, z: e.z, name: e.lv }; });
  const pct0 = await page.evaluate(() => window.__meta.pct.me);
  await page.evaluate((t) => { window.__game.setRadius(40); window.__game.teleport(t.x, t.z); window.__game.step(1.5); }, target);
  await sleep(500);
  const got = await page.evaluate((id) => ({ cnt: window.__meta.collectedCount(), store: JSON.parse(localStorage.getItem('bedre.meta.v1')), toast: [...document.querySelectorAll('.meta-toast')].map((e) => e.textContent) }), target.id);
  check('landmark collected + toast "new in album"', !!got.store.album[target.id] && got.toast.some((s) => /\(\d+\/\d+\)/.test(s)), `${target.id} toasts=${JSON.stringify(got.toast)}`);
  check('achievement unlocked (First Gulp) + persisted', !!got.store.ach.first, JSON.stringify(Object.keys(got.store.ach)));
  const pct1 = await page.evaluate(() => window.__meta.pct.me);
  check('% of Rīga meter increases', pct1 > pct0 && pct1 > 0, `${pct0.toFixed(3)} -> ${pct1.toFixed(3)}`);
  check('HUD chip shows the meter', /%/.test(await page.locator('#meta-pct').innerText()));
  await page.evaluate(() => window.__game.step(0.6)); await sleep(300);
  await shot('ingame-toast-meter');

  // area banner: teleport between two areas
  const pts = await page.evaluate(() => {
    const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    const b = window.__game && window.__life.world.bounds; const res = [];
    for (const a of window.__meta.areas) {
      let best = null;
      for (let x = Math.max(a.x0, b.minX + 50); x <= Math.min(a.x1, b.maxX - 50) && !best; x += 40) for (let z = Math.max(a.z0, b.minZ + 50); z <= Math.min(a.z1, b.maxZ - 50); z += 40) if (inside(a.poly, x, z)) { best = [x, z]; break; }
      if (best) res.push({ id: a.id, x: best[0], z: best[1] });
    }
    return res;
  });
  check('at least two areas reachable inside the map', pts.length >= 2, pts.map((p) => p.id).join(','));
  const seen = [];
  await page.evaluate(() => window.__game.setRadius(2.2));
  for (const p of pts.slice(0, 3)) {
    await page.evaluate((p) => { window.__game.teleport(p.x, p.z); window.__game.step(0.6); }, p);
    seen.push(await page.evaluate(() => ({ banner: document.getElementById('meta-area').dataset.area, text: document.querySelector('#meta-area .an').textContent, player: window.__meta.areaOfPlayer() })));
  }
  check('area banner fires when teleporting between areas', seen.length >= 2 && seen.every((s, i) => s.banner === pts[i].id && s.player === pts[i].id), JSON.stringify(seen.map((s) => s.text)));
  await sleep(250); await shot('ingame-area-banner');

  // album + achievements panels (persisted over a reload)
  await open('');
  const persisted = await page.evaluate((id) => !!JSON.parse(localStorage.getItem('bedre.meta.v1')).album[id], target.id);
  check('collection persists across reload', persisted);
  await page.click('#open-progress'); await sleep(200);
  check('album panel lists the collected card', (await page.locator(`.mp-card.got[data-id="${target.id}"]`).count()) === 1 && /\d+ \/ \d+/.test(await page.locator('.mp-count').innerText()));
  await shot('album');
  await page.click('.mp-tabs [data-tab="ach"]'); await sleep(150);
  check('achievements panel: unlocked persists, progress bars', (await page.locator('.mp-arow.got[data-id="first"]').count()) === 1 && (await page.locator('.mp-arow .mp-bar.thin').count()) >= 20);
  await shot('achievements');
  await page.click('#mp-close');
  await page.setViewportSize({ width: 390, height: 780 }); await page.click('#open-progress'); await sleep(200); await shot('album-mobile'); await page.click('#mp-close');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- recap + share card ---------------------------------------------------------------------------------------------
  await open('autostart=1&intro=0&time=12');
  const first = await page.evaluate(() => { const e = window.__meta.album.entries.find((x) => x.id === 'dome') || window.__meta.album.entries[1]; return { x: e.x, z: e.z }; });
  await page.evaluate((f) => { const g = window.__game; g.setTarget(f.x + 150, f.z + 80); g.step(3); g.setRadius(45); g.teleport(f.x, f.z); g.step(2); g.setTarget(f.x - 100, f.z + 260); g.step(8); }, first);
  await page.waitForFunction(() => window.__game.state.phase === 'ended', null, { timeout: 30000 });
  await page.waitForSelector('#meta-recap-map', { state: 'attached', timeout: 10000 });
  const rc = await page.evaluate(() => {
    const c = document.getElementById('meta-recap-map'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data;
    const set = new Set(); for (let i = 0; i < d.length; i += 4 * 37) set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    const s = document.getElementById('meta-recap-spark'); const sd = s.getContext('2d').getImageData(0, 0, s.width, s.height).data; let sp = 0; for (let i = 3; i < sd.length; i += 4) if (sd[i]) sp++;
    return { colors: set.size, w: c.width, h: c.height, samples: window.__meta.R.samples.length, foot: window.__meta.R.footprints.length, sparkPx: sp, newAlb: document.getElementById('meta-recap').textContent.length };
  });
  check('recap map renders (non-blank) with a recorded path + eaten footprints', rc.colors > 12 && rc.samples >= 4 && rc.foot > 0, JSON.stringify(rc));
  check('recap growth sparkline drawn', rc.sparkPx > 300);
  await sleep(500);
  check('results panel has Result / Map / Progress tabs, Play again visible, no toasts over it', (await page.locator('#rtabs [data-rt]').count()) === 3 && (await page.isVisible('#again')) && (await page.locator('#meta-toasts .meta-toast').count()) === 0);
  await shot('results-score');
  await page.click('#rtabs [data-rt=ach]'); await sleep(150); await shot('results-progress');
  await page.click('#rtabs [data-rt=map]'); await sleep(150);
  await page.locator('#meta-recap').scrollIntoViewIfNeeded(); await shot('results-recap');
  await page.locator('#meta-recap').screenshot({ path: path.join(out, 'meta-recap-section.png') });

  const card = await page.evaluate(() => {
    const c = window.__meta.makeCard(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 101) set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return { w: c.width, h: c.height, colors: set.size, url: c.toDataURL('image/png') };
  });
  fs.writeFileSync(path.join(out, 'meta-share-card.png'), Buffer.from(card.url.split(',')[1], 'base64'));
  check('share card canvas is 1200x630 and non-blank', card.w === 1200 && card.h === 630 && card.colors > 20, `colors=${card.colors}`);
  await page.evaluate(() => { try { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {} });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#meta-share')]);
  const dlPath = path.join(out, 'meta-download.png'); await dl.saveAs(dlPath);
  const dsz = pngSize(fs.readFileSync(dlPath));
  check('share fallback downloads a 1200x630 PNG', dl.suggestedFilename().endsWith('.png') && dsz.w === 1200 && dsz.h === 630, dl.suggestedFilename());
  check('share + copy-link buttons present', (await page.locator('#meta-copy').count()) === 1);
  const canShareCalls = await page.evaluate(async () => { // Web Share path when supported
    let got = null; Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true }); Object.defineProperty(navigator, 'share', { value: async (d) => { got = d; }, configurable: true });
    document.getElementById('meta-share').click(); await new Promise((r) => setTimeout(r, 1500)); return got && got.files && got.files[0] && got.files[0].type;
  });
  check('Web Share API receives the PNG file where supported', canShareCalls === 'image/png', String(canShareCalls));

  // ---- service worker -------------------------------------------------------------------------------------------------
  const sp = await ctx.newPage();
  await open('sw=1', sp);
  const swState = await sp.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    return { scope: reg.scope, active: !!reg.active, ctl: !!navigator.serviceWorker.controller };
  });
  check('service worker registers under ?sw=1 and controls the page', swState.active && swState.ctl, JSON.stringify(swState));
  // the page hands the played map's data URLs to the worker 3 s after load (src/meta/pwa.js): wait until they are cached (real behaviour, not a fixed sleep)
  await sp.evaluate(async () => { for (let i = 0; i < 60; i++) { try { if ((await (await caches.open('bedre-data-v1')).keys()).length >= 4) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } });
  const caches1 = await sp.evaluate(async () => {
    await fetch('/api/rounds').catch(() => {});
    const names = await caches.keys(); const all = {};
    for (const n of names) all[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname);
    return all;
  });
  const keys = Object.values(caches1).flat();
  check('SW precached the shell + assets (map data is cached lazily), never /api', keys.includes('/') && keys.some((k) => k.startsWith('/assets/') && k.endsWith('.js')) && !keys.some((k) => k.startsWith('/api')), `${keys.length} entries in ${Object.keys(caches1).join(',')}`);
  await ctx.setOffline(true);
  await sp.goto(`${base}/?sw=1&autostart=1&intro=0`);
  let offlineOk = true;
  try { await sp.waitForFunction(() => document.body.dataset.ready === '1' && window.__game, null, { timeout: 90000 }); } catch { offlineOk = false; }
  const offlineInfo = offlineOk ? await sp.evaluate(() => ({ phase: window.__game.state.phase, sample: window.__game.isSample })) : null;
  check('app shell + the played map\'s data (cached after the first play) load fully offline', offlineOk && offlineInfo.phase !== 'menu' && !offlineInfo.sample, JSON.stringify(offlineInfo));
  await ctx.setOffline(false);
  // update flow: a changed sw.js (new build id) installs, replaces the shell cache, and shows the reload toast
  // simulate a second deploy: the served sw.js changes (new build id)
  const swFile = path.join(dist, 'sw.js'); const swOrig = fs.readFileSync(swFile, 'utf8');
  fs.writeFileSync(swFile, swOrig.replace(/const BUILD = '[^']*'/, "const BUILD = 'testv2'"));
  await sp.evaluate(() => window.__swReg.update());
  await sp.waitForFunction(() => [...document.querySelectorAll('.meta-toast')].some((e) => /Jauna versija|New version/.test(e.textContent)), null, { timeout: 30000 }).then(() => check('update flow: new SW shows "new version" toast', true), () => check('update flow: new SW shows "new version" toast', false));
  await sleep(1500);
  const names2 = await sp.evaluate(async () => (await caches.keys()));
  check('old shell cache removed on activate', names2.filter((n) => n.startsWith('bedre-shell-')).length === 1 && names2.some((n) => n.endsWith('testv2')), names2.join(','));
  fs.writeFileSync(swFile, swOrig);
  await sp.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
  await sp.close();

  // ---- retention: daily streak, weekly goals, rewards (scripts/lib/retention-checks.mjs) --------------------------------------------
  const renv = { chromium, webkit, devices, base, out, check, errors };
  await runRetention(renv);
  await retentionShots(renv);
  await runWardrobe(renv);   // feature 5: wardrobe, unlock mapping, XP / level (scripts/lib/f45-meta-checks.mjs)

  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

try { await main(); } catch (e) { console.error('FATAL', e); failures++; }
kill();
console.log(failures ? `\n${failures} FAILED` : '\nALL META CHECKS PASSED');
process.exit(failures ? 1 : 0);
