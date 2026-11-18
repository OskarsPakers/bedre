// experiment: triangles per frame when top-level groups are hidden (phone profile). node tools/tramcity/shadowtest.mjs [route] [s]
import { chromium, devices } from 'playwright';
const route = process.argv[2] || 'centrs-3', s0 = +(process.argv[3] || 0);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['Pixel 5'] }); const p = await ctx.newPage();
await p.goto(`http://localhost:5193/tramvajs/?route=${route}&run=full&lang=en&autostart=1${process.env.Q||''}`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
await p.evaluate((s0) => { const t = window.__tram; t.setManual(true); t.setAuto('perfect'); let k = 0; while (t.run.s < s0 && k++ < 60000) t.advance(0.1); }, s0);
await p.waitForTimeout(2500);
const tri = () => p.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return window.__tram.stats().triangles; });
console.log('all', await tri());
const names = ["tram-city", "tram-street"]; const rest = async () => 0;
for (const n of names) { await p.evaluate((n) => { window.__tram.S.scene.traverse((o) => { if (o.name === n) o.visible = false; }); }, n); console.log("hide", n, await tri()); await p.evaluate((n) => { window.__tram.S.scene.traverse((o) => { if (o.name === n) o.visible = true; }); }, n); }
await p.evaluate(() => { window.__tram.S.scene.traverse((o) => { if (o.name === "tram-city") o.visible = false; }); window.__tram.S.world.buildingMesh.visible = false; }); console.log("city hidden, engine bm hidden", await tri());
await b.close();
