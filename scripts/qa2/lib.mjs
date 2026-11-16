import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const out = path.join(root, 'scripts/out');
export const BASE = process.env.QA_BASE || 'http://localhost:8802';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GL = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const engines = {};
export const browser = async (eng) => engines[eng] || (engines[eng] = await ({ chromium, webkit, firefox }[eng]).launch({ headless: true, args: eng === 'chromium' ? GL : [] }));
export const closeAll = async () => { for (const b of Object.values(engines)) await b.close().catch(() => {}); };
export const log = { errs: [], shots: 0, notes: [] };
export const note = (s) => { log.notes.push(s); console.log('NOTE', s); };
// profile: {eng, dev, land, name}
export async function open(profile, { name = 'QA', lang = 'en', q = 'quality=low&radio=0', storage = {}, base = BASE, route = null, size = null } = {}) {
  const b = await browser(profile.eng);
  const prof = profile.dev ? { ...devices[profile.land ? profile.dev + ' landscape' : profile.dev] } : { viewport: { width: 1100, height: 680 } };
  if (size) prof.viewport = { width: size[0], height: size[1] };
  const ctx = await b.newContext({ ...prof, locale: lang === 'lv' ? 'lv-LV' : 'en-US', timezoneId: 'Europe/Riga' });
  await ctx.addInitScript(([n, l, st]) => { try { if (localStorage.getItem('__seed') == null) { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', l); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); localStorage.setItem('__seed', '1'); } } catch {} }, [name, lang, storage]);
  if (route) await ctx.route('**/api/**', route);
  const page = await ctx.newPage();
  const tag = profile.name + (profile.land ? '-L' : '');
  page.__tag = tag; page.__ctx = ctx; page.__p = profile; page.__pts = new Map(); page.__nav = 0; page.__crash = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.__nav++; });
  page.on('crash', () => { page.__crash++; log.errs.push(`[${tag}] PAGE CRASH`); });
  page.on('pageerror', (e) => log.errs.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) log.errs.push(`[${tag}] console: ${m.text().slice(0, 200)}`); });
  page.on('requestfailed', (r) => log.errs.push(`[${tag}] reqfail ${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
  page.on('websocket', (ws) => { ws.on('close', () => { page.__wsclose = (page.__wsclose || 0) + 1; }); ws.on('socketerror', (e) => log.errs.push(`[${tag}] ws error ${e}`)); });
  if (profile.eng === 'chromium' && profile.dev) page.__cdp = await ctx.newCDPSession(page);
  page.__base = base; page.__q = q;
  return page;
}
export async function load(page, extra = '') {
  await page.goto(`${page.__base}/?${page.__q}${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
  const e = await page.evaluate(() => document.body.dataset.error); if (e) throw new Error('boot error ' + e);
  await sleep(300);
}
export async function shot(page, label) {
  const f = path.join(out, `qa2-${page.__tag}-${label}.png`);
  await page.screenshot({ path: f }).catch((e) => log.errs.push(`shot fail ${label} ${e.message}`)); log.shots++; return f;
}
// ---- touch ----
async function cdpTouch(page, type) { const pts = [...page.__pts.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 1, radiusY: 1, force: 1 })); await page.__cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); }
const synth = (page, type, id, x, y) => page.evaluate(([type, id, x, y]) => {
  const c = document.getElementById('c');
  c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1, bubbles: true, cancelable: true }));
}, [type, id, x, y]);
export const T = {
  async down(page, id, x, y) { page.__pts.set(id, { x, y }); if (page.__cdp) await cdpTouch(page, 'touchStart'); else await synth(page, 'pointerdown', id, x, y); },
  async move(page, id, x, y) { page.__pts.set(id, { x, y }); if (page.__cdp) await cdpTouch(page, 'touchMove'); else await synth(page, 'pointermove', id, x, y); },
  async up(page, id) { const p = page.__pts.get(id); page.__pts.delete(id); if (page.__cdp) await cdpTouch(page, 'touchEnd'); else await synth(page, 'pointerup', id, p.x, p.y); },
  async tapEl(page, sel) { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); const b = await l.boundingBox(); if (!b) throw new Error('no box ' + sel); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); },
  async drag(page, id, from, to, steps = 8, dt = 16) { for (let i = 1; i <= steps; i++) { await T.move(page, id, from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await sleep(dt); } },
};
export const vp = (page) => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
export const holeScreen = (page) => page.evaluate(() => { const g = window.__life.game; g._v.set(g.player.x, 0, g.player.z).project(g.cam.camera); return { x: (g._v.x * 0.5 + 0.5) * innerWidth, y: (-g._v.y * 0.5 + 0.5) * innerHeight }; });
// A thumb-joystick "player": touch down at a spot, steer toward the nearest edible object (reads state only, steers by finger only)
export async function steerStep(page, opts = {}) {
  const st = await page.evaluate(() => {
    const g = window.__life.game, w = window.__life.world, pl = g.player;
    const lim = pl.radius * 0.85; let best = null, bd = 1e9;
    for (const o of w.objects) { if (o.state !== 0 || o.fit >= lim) continue; const d = Math.hypot(o.x - pl.x, o.z - pl.z); const score = d - Math.min(o.value, 40) * 0.2; if (d < 70 && score < bd) { bd = score; best = o; } }
    g._v.set(pl.x, 0, pl.z).project(g.cam.camera);
    const hx = (g._v.x * 0.5 + 0.5) * innerWidth, hy = (-g._v.y * 0.5 + 0.5) * innerHeight;
    let sx = null, sy = null;
    if (best) { g._v.set(best.x, 0, best.z).project(g.cam.camera); sx = (g._v.x * 0.5 + 0.5) * innerWidth; sy = (-g._v.y * 0.5 + 0.5) * innerHeight; }
    return { hx, hy, sx, sy, W: innerWidth, H: innerHeight, has: !!best };
  });
  return st;
}
export async function stickDrive(page, ms, { id = 1, scheme = 'stick' } = {}) {
  // drive toward targets by dragging a finger: joystick -> offset from touch origin in the screen direction of the target
  const { w: W, h: H } = await vp(page);
  const ox = W * 0.5, oy = H * 0.78;
  await T.down(page, id, ox, oy);
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < ms) {
    const s = await steerStep(page);
    let dx = 0, dy = -1;
    if (s.has) { dx = s.sx - s.hx; dy = s.sy - s.hy; }
    const L = Math.hypot(dx, dy) || 1;
    if (scheme === 'finger') { await T.move(page, id, s.hx + dx / L * 60, s.hy + dy / L * 60); }
    else await T.move(page, id, ox + dx / L * 55, oy + dy / L * 55);
    n++; if (process.env.QA_DEBUG && n % 5 === 1) console.log('drive', n, Math.round(dx), Math.round(dy), JSON.stringify(await page.evaluate(() => ({ x: window.__game.hole.x, t: window.__life.game.input.touch })))); await sleep(120);
  }
  await T.up(page, id);
  return n;
}
export const gstate = (page) => page.evaluate(() => { const g = window.__game; return { phase: g.state.phase, score: g.state.score, t: g.state.time, r: g.hole?.radius }; });
