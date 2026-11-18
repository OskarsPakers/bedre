import { chromium } from 'playwright'; import { toLL } from './poses.mjs';
export async function openA({ w = 1600, h = 900, dsf = 2, query = '' } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, userAgent: 'Mozilla/5.0 (internal realistic-mesh experiment)' });
  const page = await ctx.newPage(); const reqs = [];
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('request', (r) => { const u = r.url(); if (u.includes('tiles-eu1.arcgis.com') && /\/nodes\/\d+\//.test(u)) reqs.push(u); });
  await page.goto('http://127.0.0.1:5197/a.html' + query);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  return { browser, page, reqs, async shot(view, file, extra = {}) { const a = toLL(view.x, view.z), b = toLL(view.lx, view.lz); const info = await page.evaluate((o) => window.__goto(o), { lon: a.lon, lat: a.lat, up: view.up, tlon: b.lon, tlat: b.lat, tup: view.lup, fovV: view.fovV ?? (view.cab ? 70 : 48), ...extra }); await page.screenshot({ path: file }); return info; } };
}
