import { open } from './lib.mjs';
const { browser, page } = await open({ dsf: 1 });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(1500);
for (const s of [60, 60, 60, 60]) {
  const t0 = Date.now();
  await page.evaluate((s) => window.__game.autoplay(s), s);
  console.log(Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => ({ h: window.__game.hole, st: window.__game.state, lb: window.__game.leaderboard().slice(0, 5), phase: window.__game.state.phase }))));
}
await browser.close();
