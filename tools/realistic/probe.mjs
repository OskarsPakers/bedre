import { openA } from './lib.mjs'; import { loadTrack, poseAt } from './poses.mjs';
const T = loadTrack(process.argv[2] || 'centrs-3'); const out = '/Users/oskars/projects/holeio/scripts/out/realistic/_probe/'; (await import('node:fs')).mkdirSync(out, { recursive: true });
const A = await openA({ w: 1280, h: 720, dsf: 1 });
for (const s of process.argv.slice(3).map(Number)) {
  const p = poseAt(T, s); const t0 = Date.now();
  const i1 = await A.shot(p.chase, out + `chase-${s}.png`, { settle: 1500, timeout: 25000 });
  const i2 = await A.shot({ ...p.cab, cab: 1 }, out + `cab-${s}.png`, { settle: 1500, timeout: 25000 });
  console.log(s, JSON.stringify(i1), ((Date.now() - t0) / 1000).toFixed(0) + 's', A.reqs.length);
}
await A.browser.close();
