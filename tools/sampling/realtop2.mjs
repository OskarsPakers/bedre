// real-mesh renders of every hole-camera pose in raw2/top-poses.json from the full centre plan -> raw2/top-<name>-real.png
import { launch, BASE } from './pw.mjs'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../scripts/out/sampling/raw2'); const poses = JSON.parse(fs.readFileSync(`${OUT}/top-poses.json`, 'utf8'));
const { b, p } = await launch({ width: 1600, height: 900 }); await p.goto(`${BASE}/meshview2.html`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
for (const [name, q] of Object.entries(poses)) { if (/^map-/.test(name)) continue; const dist = Math.hypot(q.x - q.lx, q.y, q.z - q.lz); const st = await p.evaluate(([x, z, h]) => window.__v.show(x, z, h), [q.lx, q.lz, Math.max(160, dist * 0.9)]); await p.evaluate((q) => window.__v.view({ ...q, far: 4000 }), q); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/top-${name}-real.png` }); console.log(name, st.nodes, 'nodes'); }
await b.close();
