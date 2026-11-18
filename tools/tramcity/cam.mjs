// one screenshot from an absolute camera: node tools/tramcity/cam.mjs out.png x y z lx ly lz [fov] [route] [theme]   (dev server on :5193)
import { chromium } from 'playwright';
const [out, x, y, z, lx, ly, lz, fov = '60', route = 'centrs-3', theme = 'day'] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:5198/tramvajs/?route=${route}&lang=en&quality=high`);
await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
if (theme !== 'day') await p.evaluate((t) => window.__tram.setTheme(t), theme);
await p.addStyleTag({ content: '#start,#hud,.hud,#menu,#loading{display:none!important}' });
await p.evaluate((o) => window.__tram.setCamera(o), { x: +x, y: +y, z: +z, lx: +lx, ly: +ly, lz: +lz, fov: +fov });
await p.waitForTimeout(1200); await p.screenshot({ path: out }); await b.close();
