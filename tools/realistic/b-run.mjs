import { openA } from './lib.mjs'; import { loadTrack, poseAt, tramSym } from './poses.mjs'; import fs from 'node:fs';
const T = loadTrack('centrs-3'); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/'; fs.mkdirSync(out + 'b-frames', { recursive: true });
let A = await openA({ w: 1600, h: 900, dsf: 2 });
const put = (s) => A.page.evaluate((o) => window.__tram(o), { ...tramSym(T, s), hOff: 180 });
for (const s of (process.env.SS||"1130,1200,1250,1300,1380,1480").split(",").map(Number)) { const p = poseAt(T, s); await put(s); await A.shot(p.chase, out + `b-chase-${s}.png`, { settle: 3500, timeout: 30000 }); console.log('still', s); }
await A.browser.close();
A = await openA({ w: 1280, h: 720, dsf: 1 }); const t0 = Date.now();
for (let i = 0; i < +(process.env.NF ?? 100); i++) { const s = 1200 + i * 0.9, p = poseAt(T, s, 10); await put(s); await A.shot(p.chase, out + `b-frames/f${String(i).padStart(3, '0')}.png`, { settle: 500, timeout: 15000 }); if (i % 10 == 0) console.log('frame', i, ((Date.now() - t0) / 1000) | 0); }
await A.browser.close();
