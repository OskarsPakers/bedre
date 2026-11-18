// tiny Playwright helper: node shot.mjs <url> <out.png> [w h]
import { chromium } from 'playwright';
export async function withPage(fn, { w = 1600, h = 900 } = {}) {
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); const pg = await b.newPage({ viewport: { width: w, height: h } });
  pg.on('pageerror', e => console.log('PAGEERR', e.message)); pg.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  try { return await fn(pg); } finally { await b.close(); }
}
