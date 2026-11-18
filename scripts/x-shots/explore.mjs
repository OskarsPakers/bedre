import { open } from './lib.mjs';
const views = JSON.parse(process.argv[2]); // [[tag,x,z,r,zoom?]]
const theme = process.argv[3] || 'day';
const { browser, page } = await open({ dsf: 1, theme });
await page.fill('input[type=text]', 'Rīga').catch(()=>{});
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(2500);
for (const [tag, x, z, r, zoom] of views) {
  await page.evaluate(([x, z, r, zoom]) => { const g = window.__game; g.teleport(x, z); g.setRadius(r); g.step(0.5); if (zoom) g.zoomBy(zoom); }, [x, z, r, zoom || 0]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `scripts/out/x-shots/candidates/ex-${tag}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => ({ cam: window.__game.cam, un: window.__game.unranked, lb: window.__game.leaderboard().slice(0,4) }))));
await browser.close();
