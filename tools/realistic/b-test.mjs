import { openA } from './lib.mjs'; import { loadTrack, poseAt, tramSym } from './poses.mjs';
const T = loadTrack('centrs-3'); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/_probe/'; const A = await openA({ w: 1280, h: 720, dsf: 1 });
const s = +process.argv[2] || 1250, hOff = +process.argv[3] || 0; const p = poseAt(T, s + 30);
await A.page.evaluate((o) => window.__tram(o), { ...tramSym(T, s + 30), hOff });
await A.shot(p.chase, out + `b-test.png`, { settle: 3000, timeout: 30000 }); await A.browser.close();
