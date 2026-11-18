// real reality-mesh render from the hole game's top-down camera poses (raw/top-poses.json) -> raw/top-<name>-real.png ; also re-renders the tram poses as raw/{chase,cab}-<s>-real.png without the tram (spike images are used when present)
import { launch, BASE } from './pw.mjs'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../scripts/out/sampling/raw'); const poses = JSON.parse(fs.readFileSync(`${OUT}/top-poses.json`, 'utf8'));
const { b, p } = await launch({ width: 1600, height: 900 }); await p.goto(`${BASE}/meshview.html`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 }); await p.evaluate(() => window.__v.resize(1600, 900));
for (const [name, q] of Object.entries(poses)) { await p.evaluate((q) => window.__v.view({ ...q, near: 1, far: 2000 }), q); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/top-${name}-real.png` }); }
await b.close();
