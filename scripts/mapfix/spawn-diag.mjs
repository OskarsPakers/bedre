// Mežaparks slow-start diagnosis: where do the greedy runs spawn and what does the first minute look like. PORT=5183 (balance dist) MAP
import { chromium } from 'playwright';
const PORT = process.env.PORT || 5183;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
await page.goto(`http://localhost:${PORT}/?intro=0&bots=0&map=${process.env.MAP || 'mezaparks'}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
for (let i = 0; i < +(process.env.N || 8); i++) {
  const r = await page.evaluate(() => {
    const g = window.__G, w = window.__W; g.start(); const p = g.player, x0 = Math.round(p.x), z0 = Math.round(p.z);
    let bl = 0, bv = 0, tr = 0; w.query(x0, z0, 150, (o) => { if (o.isBuilding) { bl++; bv += o.value; } else if (o.cls === 'tree') tr++; });
    let nt = 0, vt = 0, ft = 0; const f0 = window.__CFG.hole.startRadius * window.__CFG.swallow.fitRatio; w.query(x0, z0, 60, (o) => { if (o.state === 0 && o.fit < f0) { if (o.cls === 'tree') ft += o.value; else { nt++; vt += o.value; } } });
    g.autoplay(60);
    return { x: x0, z: z0, bld150: bl, bldValue150: Math.round(bv), trees150: tr, nonTree60: nt, nonTreeValue60: vt, treeValue60: ft, score60: Math.round(p.score), r60: +p.radius.toFixed(1), x1: Math.round(p.x), z1: Math.round(p.z) };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
