// Playwright helpers: one Chromium at a time, real GPU (Metal), logs page errors.
import { chromium } from 'playwright';
export const BASE = 'http://127.0.0.1:5198';
export async function launch({ width = 1600, height = 900, dpr = 1 } = {}) {
  const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'] });
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: dpr }); const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', e.message)); p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /^\[(s|m)\]/.test(t)) console.log('[console]', t.slice(0, 300)); });
  return { b, p };
}
