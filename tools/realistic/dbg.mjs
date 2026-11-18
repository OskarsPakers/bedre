import { openA } from './lib.mjs';
const A = await openA({ w: 1280, h: 720, dsf: 1 });
const r = await A.page.evaluate(async () => { const v = window.__view; await new Promise(r=>setTimeout(r,8000)); return { layers: v.map.layers.length, lv: v.allLayerViews.length, upd: v.updating, ground: v.map.ground.layers.length, errs: v.allLayerViews.toArray().filter(l=>l.layer.type=="integrated-mesh").slice(0,3).map(l=>[l.layer.title,!!l.suspended,!!l.updating,!!l.visibleAtCurrentScale]) } });
console.log(JSON.stringify(r));
const info = await A.page.evaluate(() => window.__goto({ lon: 24.1133, lat: 56.9515, up: 900, tlon: 24.1134, tlat: 56.9514, tup: 0, fovV: 50, timeout: 25000, settle: 3000 }));
console.log(info);
await A.page.screenshot({ path: '/Users/oskars/projects/holeio/scripts/out/realistic/_probe/aerial.png' });
await A.browser.close();
