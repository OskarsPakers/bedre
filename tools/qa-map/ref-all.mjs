import fs from 'node:fs'; import { openRef, camFor } from './ref-lib.mjs'; import { QC } from './lib.mjs';
const V = JSON.parse(fs.readFileSync(`${QC}/views.json`));
const R = await openRef({ w: 800, h: 500 });
let n = 0;
for (const v of V) {
  const f = `${QC}/ref/${v.key}.png`; if (fs.existsSync(f)) continue;
  const c = camFor({ x: v.x, z: v.z, y: v.y + 4, dist: v.dist, el: v.el, az: v.az }); c.fov = 55;
  try { await R.shot(c, f, 30000); n++; console.log('ref', v.key); } catch (e) { console.log('FAIL', v.key, e.message.slice(0, 80)); }
  if (n % 15 === 14) { await new Promise((r) => setTimeout(r, 4000)); }
}
await R.browser.close(); console.log('done');
