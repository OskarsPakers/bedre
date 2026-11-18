// node shots.mjs <levels e.g. 0,1,2,3> [kinds tram,top]  -> scripts/out/sampling/raw/*.png (1600x900) ; top views also write raw/top-poses.json (camera pose per view, reused for the real-mesh render)
import { launch, BASE } from './pw.mjs'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../scripts/out/sampling/raw2'); fs.mkdirSync(OUT, { recursive: true });
const levels = (process.argv[2] || '0,1,2,3').split(',').map(Number), kinds = (process.argv[3] || 'tram,top').split(',');
const SS = [1200, 1250, 1300, 1400, 1500]; const W = 1600, H = 900;
const TOPS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'tops.json'), 'utf8')).concat(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'overviews.json'), 'utf8'))); // [{name, x, z, r}]
const poses = {};
for (const lv of levels) {
  const { b, p } = await launch({ width: W, height: H }); await p.goto(`${BASE}/play.html?level=${lv}`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 }); await p.evaluate(([w, h]) => window.__p.size(w, h), [W, H]);
  console.log('level', lv, JSON.stringify(await p.evaluate(() => window.__p.info())));
  if (kinds.includes('tram')) for (const view of ['chase', 'cab']) for (const s of SS) { await p.evaluate(([s, v]) => window.__p.tram(s, v), [s, view]); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${view}-${s}-L${lv}.png` }); }
  if (kinds.includes('top')) for (const t of TOPS) { const pose = await p.evaluate(([x, z, r]) => { const d = window.__p.top(x, z, r); const c = window.__p.S.camera || null; return d; }, [t.x, t.z, t.r]); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/top-${t.name}-L${lv}.png` });
    if (lv === levels[0]) poses[t.name] = await p.evaluate(() => window.__p.pose()); }
  await b.close();
}
if (Object.keys(poses).length) fs.writeFileSync(`${OUT}/top-poses.json`, JSON.stringify(poses));
