// Total triangles of the whole scene (the "overview" worst case: everything in view) per map. PORT (default 5188, vite dev) / MAPS
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const map of (process.env.MAPS || 'centrs,agenskalns,mezaparks,purvciems').split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${process.env.PORT || 5188}/?map=${map}&quality=${process.env.Q || 'high'}&intro=0&bots=0`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
  const r = await page.evaluate(() => {
    const w = window.__life.world; let props = 0, trees = 0, bld = 0;
    for (const m of w.propMeshes) { const g = m.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3; const n = m.count * t; props += n; if (w.treeMeshes.includes(m)) trees += n; }
    const bm = w.buildingMesh; if (bm) { let t = 0; for (let i = 0; i < bm._geometryInfo.length; i++) { const gi = bm._geometryInfo[i]; if (gi && !gi.reservedIndexCount === undefined) t += 0; } }
    const info = window.__life.renderer && window.__life.renderer.info; return { skirt: w.ground && w.ground.userData.skirt, groundStats: w.ground && w.ground.userData.stats && { texMB: w.ground.userData.stats.texMB }, props: Math.round(props), trees: Math.round(trees), treeMeshes: w.treeMeshes.length, buildingsTrisReported: info ? info.render.triangles : null };
  });
  console.log(map, JSON.stringify(r)); await ctx.close();
}
await browser.close();
