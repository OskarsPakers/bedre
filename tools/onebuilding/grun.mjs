// Screenshots of the CURRENT tram game (live site, read-only, 1 page load) at our poses: cab / chase / four orbit views of the Opera, day theme. Also probes what the game builds for the Opera.
import { chromium } from 'playwright'; import { loadTrack, poseAt } from '../realistic/poses.mjs'; import { toWorld } from './frame.js';
const OUT = '/Users/oskars/projects/holeio/scripts/out/onebuilding/', T = loadTrack('centrs-3');
const theme = process.argv[2] || 'day';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(`https://bedre.pakers.lv/tramvajs/?route=centrs-3&theme=${theme}&quality=high`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
await p.evaluate(() => window.__tram.start('short', 'centrs-3')); await p.waitForTimeout(3000);
await p.addStyleTag({ content: 'body > *:not(canvas):not(script){visibility:hidden !important} #c{visibility:visible !important}' });
console.log(await p.evaluate(() => JSON.stringify({ keys: Object.keys(window.__tram), q: window.__tram.stats() })).catch(e => String(e)));
const shots = [['cab', 1260], ['chase', 1300]].map(([mode, s]) => ({ name: `${mode}`, mode, s, q: poseAt(T, s)[mode], fov: mode === 'cab' ? 70 : 48 }));
for (const sh of shots) {
  await p.evaluate(([s, q, mode, fov]) => { const t = window.__tram; t.run.s = s; t.run.v = 0; t.tram.place(t.track, s, 0, 1); t.setCamera({ x: q.x, y: mode === 'cab' ? 2.4 : 7, z: q.z, lx: q.lx, ly: q.lup, lz: q.lz, fov }); Object.defineProperty(t.tram.group, 'visible', { get: () => mode === 'chase', set: () => {}, configurable: true }); t.camera.fov = fov; t.camera.updateProjectionMatrix(); }, [sh.s, sh.q, sh.mode, sh.fov]);
  await p.waitForTimeout(2500); await p.screenshot({ path: OUT + `game-${theme}-${sh.name}.png` }); console.log('shot', sh.name);
}
const C = toWorld(20, 20, 12), orb = [[-62, 20], [22, -62], [22, 102], [122, 20]];
for (let k = 0; k < 4; k++) { const c = toWorld(orb[k][0], orb[k][1], 26);
  await p.evaluate(([c, C]) => { const t = window.__tram; Object.defineProperty(t.tram.group, 'visible', { get: () => false, set: () => {}, configurable: true }); t.setCamera({ x: c[0], y: c[1], z: c[2], lx: C[0], ly: C[1], lz: C[2], fov: 40 }); t.camera.fov = 40; t.camera.updateProjectionMatrix(); }, [c, C]);
  await p.waitForTimeout(2500); await p.screenshot({ path: OUT + `game-${theme}-orbit${k}.png` }); console.log('shot orbit', k); }
await b.close();
