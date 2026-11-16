// Game renders for the QA views (tools/.cache/qa-map/views.json) -> tools/.cache/qa-map/game/<key>.png  (MAP=<slug> or all)
import { chromium } from 'playwright';
import fs from 'node:fs';
const PORT = process.env.PORT || 5188, base = `http://localhost:${PORT}`;
const QC = 'tools/.cache/qa-map';
const V = JSON.parse(fs.readFileSync(`${QC}/views.json`));
const maps = (process.env.MAPS || 'centrs,agenskalns,mezaparks,purvciems').split(',');
const browser = await chromium.launch({ headless: true, args: process.env.GPU === '0' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const MAP of maps) {
  const list = V.filter((v) => v.map === MAP && (!process.env.ONLY || process.env.ONLY.split(',').includes(v.key)));
  if (!list.length) continue;
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(`${base}/?quality=high&intro=0&bots=0&theme=day${MAP === 'centrs' ? '' : '&map=' + MAP}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  await page.evaluate(() => { window.__game.start(); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.body.classList.add('shots'); const st = document.createElement('style'); st.textContent = 'body > *:not(canvas):not(script){display:none !important}'; document.head.appendChild(st);
    window.__freeCam = (o) => {
      const w = window.__life.world; const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
      const c = cm.camera, r = Math.PI / 180;
      c.position.set(o.x + o.dist * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.dist * Math.sin(o.el * r), o.z + o.dist * Math.cos(o.el * r) * Math.cos(o.az * r));
      c.fov = 30.8; c.near = 1; c.far = 8000; c.lookAt(o.x, o.y, o.z); c.updateProjectionMatrix();
      const f = w.scene.fog; if (f && !w.__fog0) w.__fog0 = [f.near, f.far];
      if (f) { f.near = (w.__fog0?.[0] || f.near) * 4; f.far = (w.__fog0?.[1] || f.far) * 4; }
      w.scene.fog = null;
      window.__game.render();
    };
  });
  for (const v of list) {
    await page.evaluate((o) => window.__freeCam(o), { x: v.x, z: v.z, y: v.y, dist: v.dist, el: v.el, az: v.az });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__game.render());
    await page.screenshot({ path: `${QC}/game/${v.key}.png` });
    console.log('game', v.key);
  }
  await ctx.close();
}
await browser.close();
