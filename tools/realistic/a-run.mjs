import { openA } from './lib.mjs'; import { loadTrack, poseAt } from './poses.mjs'; import fs from 'node:fs';
const T = loadTrack('centrs-3'); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/'; const meta = {};
const A = await openA({ w: 1600, h: 900, dsf: 2 });
for (const s of [1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550]) {
  const p = poseAt(T, s); const opt = { settle: 3500, timeout: 30000 };
  meta[s] = { chase: await A.shot(p.chase, out + `a-chase-${s}.png`, opt), cab: await A.shot({ ...p.cab, cab: 1 }, out + `a-cab-${s}.png`, opt) };
  console.log(s, 'done', A.reqs.length); fs.writeFileSync(out + 'a-meta.json', JSON.stringify(meta, null, 1));
}
await A.browser.close();
