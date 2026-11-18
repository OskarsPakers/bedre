import { open, growTo, alive } from './lib.mjs';
const stages = JSON.parse(process.argv[2]); // [[r,[[tag,x,z,zoom]...]]]
const theme = process.argv[3] || 'day';
const { browser, page } = await open({ dsf: 1, theme });
for (const [r, views] of stages) {
  const got = await growTo(page, r);
  console.log('stage', r, got, JSON.stringify(await alive(page)));
  for (const [tag, x, z, zoom] of views) {
    await page.evaluate(([x, z, zoom]) => { const g = window.__game; g.teleport(x, z); const c = g.cam.zoom; if (zoom) g.zoomBy(zoom / c); }, [x, z, zoom || 1]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `scripts/out/x-shots/candidates/ex2-${tag}.png` });
  }
}
await browser.close();
