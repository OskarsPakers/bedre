import { chromium } from 'playwright'; import path from 'node:path'; import fs from 'node:fs';
export const ORIGIN = { lat: 56.9515, lon: 24.1133 }; const M_LAT = 111320, M_LON = 111320 * Math.cos(56.9515 * Math.PI / 180);
export function camFor({ x, z, y = 8, dist = 200, el = 30, az = 180 }) { // game convention (az: camera offset = (sin az, cos az) in x,z)
  const r = Math.PI / 180, cx = x + dist * Math.cos(el * r) * Math.sin(az * r), cz = z + dist * Math.cos(el * r) * Math.cos(az * r);
  const alt = y + dist * Math.sin(el * r);
  const c = 180 - az; // compass bearing of the camera position from target
  return { lon: ORIGIN.lon + cx / M_LON, lat: ORIGIN.lat - cz / M_LAT, z: alt, heading: (c + 180 + 360) % 360, tilt: 90 - el, game: { x, z, y, dist, el, az } };
}
export async function openRef({ w = 960, h = 600 } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, userAgent: 'Mozilla/5.0 (qa-map review client)' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('file://' + path.resolve(import.meta.dirname, 'ref.html'));
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  return { browser, page, async shot(cam, file, timeout = 25000) { await page.evaluate((o) => window.__goto(o), { ...cam, timeout }); await page.screenshot({ path: file }); } };
}
