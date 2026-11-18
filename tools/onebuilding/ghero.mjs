// the current game at the hero camera (live site, read-only)
import { chromium } from 'playwright'; import { toWorld } from './frame.js';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }); const p = await (await b.newContext({ viewport: { width: 2000, height: 1125 } })).newPage();
await p.goto('https://bedre.pakers.lv/tramvajs/?route=centrs-3&theme=day&quality=high'); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 }); await p.evaluate(() => window.__tram.start('short', 'centrs-3')); await p.waitForTimeout(3000);
await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
const c = toWorld(-44, -30, 8), t = toWorld(10, 16, 12);
await p.evaluate(([c, t]) => { const T = window.__tram; Object.defineProperty(T.tram.group, 'visible', { get: () => false, set: () => {}, configurable: true }); T.setCamera({ x: c[0], y: 8, z: c[2], lx: t[0], ly: 12, lz: t[2], fov: 50 }); T.camera.fov = 50; T.camera.updateProjectionMatrix(); }, [c, t]);
await p.waitForTimeout(3000); await p.screenshot({ path: '/Users/oskars/projects/holeio/scripts/out/onebuilding/hero-game.png' }); await b.close();
