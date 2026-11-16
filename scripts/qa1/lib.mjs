import { chromium, firefox, webkit } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, appendFileSync } from 'node:fs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = resolve(root, 'scripts/out');
export const BASE = process.env.BASE || 'http://127.0.0.1:8801';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const LOG = resolve(root, 'scripts/qa1/events.log');
export const note = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

export async function launch(engine = 'chromium') {
  const E = { chromium, firefox, webkit }[engine];
  const args = engine === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] : [];
  return E.launch({ headless: true, args });
}
export async function newPage(browser, { w = 1280, h = 720, locale = 'lv-LV', tag = 'p', zoom } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale });
  const page = await ctx.newPage();
  page.tag = tag; page.errs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) { const s = `[${tag}] console.${m.type()}: ${m.text()}`; page.errs.push(s); note(s); } });
  page.on('pageerror', (e) => { const s = `[${tag}] PAGEERROR: ${e.message}`; page.errs.push(s); note(s); });
  page.on('requestfailed', (r) => { const s = `[${tag}] REQFAIL ${r.url()} ${r.failure() && r.failure().errorText}`; page.errs.push(s); note(s); });
  page.on('response', (r) => { if (r.status() >= 400) { const s = `[${tag}] HTTP ${r.status()} ${r.url()}`; page.errs.push(s); note(s); } });
  await page.addInitScript(() => {
    window.__ft = []; window.__long = [];
    let last = performance.now();
    const f = (n) => { const d = n - last; last = n; window.__ft.push(d); if (d > 100) window.__long.push([Math.round(n), Math.round(d)]); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  page.openGame = async (q = '') => {
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    await sleep(500);
  };
  page.shot = async (name) => { const p = resolve(OUT, `qa1-${name}.png`); await page.screenshot({ path: p }); return p; };
  return page;
}
export const ev = (page, fn, arg) => page.evaluate(fn, arg);
export async function frameStats(page, reset = true) {
  return page.evaluate((reset) => {
    const a = window.__ft.slice(3).sort((x, y) => x - y); const n = a.length || 1;
    const r = { n, avg: a.reduce((s, v) => s + v, 0) / n, p50: a[Math.floor(n * 0.5)], p95: a[Math.floor(n * 0.95)], p99: a[Math.floor(n * 0.99)], max: a[n - 1], long: window.__long.slice(-12) };
    if (reset) { window.__ft = []; window.__long = []; }
    return r;
  }, reset);
}
/** Human-ish mouse steering. */
export class Driver {
  constructor(page, { w, h }) { this.page = page; this.w = w; this.h = h; }
  async aim(dx, dz, r = 220) { // world direction (dx right, dz down-screen)
    const L = Math.hypot(dx, dz) || 1;
    const cx = this.w / 2, cy = this.h * 0.55;
    await this.page.mouse.move(Math.max(5, Math.min(this.w - 5, cx + dx / L * r)), Math.max(5, Math.min(this.h - 5, cy + dz / L * r * 0.8)));
  }
  state() { return this.page.evaluate(() => ({ s: window.__game.state, h: window.__game.hole, u: window.__game.unranked, ph: window.__game.state.phase })); }
  /** greedy: head for the best edible thing near the hole. */
  async play(seconds, { onTick, shotEvery = 0, shotName, stopOn } = {}) {
    const t0 = Date.now(); let lastShot = 0, i = 0;
    while ((Date.now() - t0) / 1000 < seconds) {
      const st = await this.state();
      if (st.ph !== 'playing') { if (st.ph === 'results' || st.ph === 'ended' || st.ph === 'over') break; await sleep(300); continue; }
      const r = st.h.radius;
      const o = await this.page.evaluate((r) => { const g = window.__game; for (const k of [null]) { } return g.nearest(null, 0); }, r);
      // choose the nearest edible whose fit < radius via repeated nearest(kind=null,minFit) isn't available; use nearest() and fall back to wandering
      let tx = st.h.x + 80, tz = st.h.z + 30;
      const cand = await this.page.evaluate((r) => { const g = window.__game; const res = []; return g.nearest(null, 0); }, r);
      if (o && o.fit < r * 0.95) { tx = o.x; tz = o.z; }
      else if (o) { this._wander = (this._wander || 0) + 0.7; tx = st.h.x + Math.cos(this._wander) * 100; tz = st.h.z + Math.sin(this._wander) * 100; }
      await this.aim(tx - st.h.x, tz - st.h.z);
      if (onTick) await onTick(st, i);
      if (shotEvery && Date.now() - lastShot > shotEvery * 1000) { lastShot = Date.now(); await this.page.shot(`${shotName}-${String(i).padStart(3, '0')}`); }
      i++; await sleep(200);
    }
  }
}
