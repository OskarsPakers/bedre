import { chromium } from 'playwright';
export const BASE = 'https://bedre.pakers.lv';
export async function open({ w = 1600, h = 900, dsf = 2, theme = 'day', extra = '&time=3000', name = 'Rīga' } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${BASE}/?lang=en&theme=${theme}&quality=high&intro=0${extra}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  // real flow: type the name, press Play
  try { await page.fill('input[type=text]', name); } catch {}
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(2000);
  return { browser, page };
}
// grow genuinely (the game's own greedy autoplay) in a leash around a far-away "farm" area until radius >= r, so the sights stay intact
export async function growTo(page, r, home = [950, 250], leash = 330) {
  await page.evaluate(([x, z]) => window.__game.teleport(x, z), home);
  for (let i = 0; i < 400; i++) {
    const cur = await page.evaluate(([hx, hz, L]) => { const g = window.__game, h = g.hole; if (Math.hypot(h.x - hx, h.z - hz) > L) g.teleport(hx, hz); return h.radius; }, [...home, leash]);
    if (cur >= r) return cur;
    await page.evaluate(() => window.__game.autoplay(3));
  }
  return await page.evaluate(() => window.__game.hole.radius);
}
export const alive = (page) => page.evaluate(() => { const w = window.__life.world; const f = w.objects.find((o) => o.kind === 'freedom'); return { freedom: f ? f.state : 'none', n: w.counts }; });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
