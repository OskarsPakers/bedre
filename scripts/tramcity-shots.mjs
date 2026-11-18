// Screenshots of the tram game at fixed viewpoints (before = ?city=0 / after), via the game's own test hooks.
//   node scripts/tramcity-shots.mjs [--url http://localhost:5193] [--route centrs-3] [--s 1200,1250] [--view cab|chase] [--city 0|1] [--theme day|evening|winter] [--tag after] [--out scripts/out/tramcity] [--w 1280 --h 720]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { buildTrack } from '../src/proto/tram/track.js';
import { poseAt } from '../tools/realistic/poses.mjs';
const A = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, r) => (v.startsWith('--') ? [...a, [v.slice(2), r[i + 1]]] : a), []));
const url = A.url || 'http://localhost:5193', route = A.route || 'centrs-3', view = A.view || 'cab', city = A.city ?? '1', theme = A.theme || 'day', tag = A.tag || (city === '0' ? 'before' : 'after');
const out = A.out || 'scripts/out/tramcity'; fs.mkdirSync(out, { recursive: true });
const W = +(A.w || 1280), H = +(A.h || 720);
const rj = JSON.parse(fs.readFileSync(`src/proto/tram/routes/${route}.json`, 'utf8')); const T = buildTrack(rj);
const ss = (A.s || '1200,1250,1300,1400,1500').split(',').map(Number);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${url}/tramvajs/?route=${route}&city=${city}&quality=high&lang=en`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
if (theme !== 'day') await page.evaluate((t) => window.__tram.setTheme(t), theme);
await page.addStyleTag({ content: '#start,#hud,.hud,#menu,#loading{display:none!important}' });
const stats = await page.evaluate(() => (window.__tram.S.city ? window.__tram.S.city.stats : null)); console.log('city', JSON.stringify(stats));
for (const s of ss) {
  const p = poseAt(T, s, 9); const c = view === 'cab' ? p.cab : p.chase;
  await page.evaluate((o) => window.__tram.setCamera(o), { x: c.x, y: c.up, z: c.z, lx: c.lx, ly: c.lup, lz: c.lz, fov: view === 'cab' ? 78 : 62 });
  await page.waitForTimeout(1200);
  const f = path.join(out, `${tag}-${theme}-${view}-${route}-${s}.png`); await page.screenshot({ path: f });
  const i = await page.evaluate(() => { const r = window.__tram.S.renderer.info.render; return { calls: r.calls, tris: r.triangles }; }); console.log(f, JSON.stringify(i));
}
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close();
