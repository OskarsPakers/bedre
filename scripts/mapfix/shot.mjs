// Free-camera game shots for the map-fix review: node scripts/mapfix/shot.mjs <name> <map> '<x,z,y,dist,el,az>' ['<...>' ...]   env PORT (5188 vite dev), Q (quality, default high), THEME, FOG=1 keeps fog, NOHUD=1
// -> scripts/out/mapfix-<name>-<n>.png (game images only)
import { chromium } from 'playwright';
const [name, map, ...cams] = process.argv.slice(2);
const PORT = process.env.PORT || 5188;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +(process.env.W || 1000), height: +(process.env.H || 625) } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${PORT}/?quality=${process.env.Q || 'high'}&intro=0&bots=0&theme=${process.env.THEME || 'day'}${map === 'centrs' ? '' : '&map=' + map}`);
await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
await page.evaluate(() => { window.__game.start(); });
await page.waitForTimeout(2000);
await page.evaluate((keepFog) => {
  const st = document.createElement('style'); st.textContent = 'body > *:not(canvas):not(script){display:none !important}'; document.head.appendChild(st);
  window.__freeCam = (o) => {
    const w = window.__life.world, cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {};
    const c = cm.camera, r = Math.PI / 180;
    c.position.set(o.x + o.dist * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.dist * Math.sin(o.el * r), o.z + o.dist * Math.cos(o.el * r) * Math.cos(o.az * r));
    c.fov = o.fov || 30.8; c.near = 1; c.far = 20000; c.lookAt(o.x, o.y, o.z); c.updateProjectionMatrix();
    if (!keepFog) { const f = w.scene.fog; if (f && !w.__fog0) w.__fog0 = [f.near, f.far]; if (f) w.scene.fog = null; } // FOG=1 keeps the game's own fog (it is the haze that makes the skirt read as 'far away')
    window.__game.render();
  };
}, !!process.env.FOG);
let n = 0;
for (const cs of cams) {
  const [x, z, y, dist, el, az, fov] = cs.split(',').map(Number);
  await page.evaluate((o) => window.__freeCam(o), { x, z, y, dist, el, az, fov });
  await page.waitForTimeout(900); await page.evaluate(() => window.__game.render());
  const f = `scripts/out/mapfix-${name}-${n++}.png`; await page.screenshot({ path: f }); console.log(f);
}
await browser.close();
