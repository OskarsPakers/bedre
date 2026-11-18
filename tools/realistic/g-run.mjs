// Screenshots of the CURRENT low-poly tram game (live site) at the same poses as A / C.
import { chromium } from 'playwright'; import { loadTrack, poseAt } from './poses.mjs';
const T = loadTrack('centrs-3'), out = '/Users/oskars/projects/holeio/scripts/out/realistic/'; const S = [1150, 1200, 1250, 1300, 1400, 1500, 1550];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('https://bedre.pakers.lv/tramvajs/?route=centrs-3&theme=day&quality=high'); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
await p.evaluate(() => window.__tram.start('short', 'centrs-3')); await p.waitForTimeout(3000);
await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
console.log(await p.evaluate(() => JSON.stringify({ route: window.__tram.route.id, phase: window.__tram.phase, q: window.__tram.stats() })));
for (const s of S) for (const mode of ['chase', 'cab']) {
  const q = poseAt(T, s)[mode]; const fov = mode === 'cab' ? 70 : 48;
  await p.evaluate(([s, q, mode, fov]) => { const t = window.__tram; t.run.s = s; t.run.v = 0; t.tram.place(t.track, s, 0, 1); t.setCamera({ x: q.x, y: mode === 'cab' ? 2.4 : 7, z: q.z, lx: q.lx, ly: q.lup + (mode === 'cab' ? 0 : 0), lz: q.lz, fov }); Object.defineProperty(t.tram.group, 'visible', { get: () => mode === 'chase', set: () => {}, configurable: true }); t.camera.fov = fov; t.camera.updateProjectionMatrix(); }, [s, q, mode, fov]);
  await p.waitForTimeout(2500); await p.screenshot({ path: out + `g-${mode}-${s}.png` }); console.log('g', mode, s);
}
await b.close();
