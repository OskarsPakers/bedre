import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); p.on('console', m => console.log('console', m.text().slice(0, 200))); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:5197/drive.html?route=centrs-3&auto=1&q=high'); await p.waitForFunction(() => window.__d); await p.evaluate(() => window.__d.warp(1250)); await p.waitForTimeout(25000);
const idx = await (await fetch('http://localhost:5197/api/index/centrs-3')).json();
const sh = await p.evaluate(() => { const d = window.__d; const out = []; const c = d.camera.position; for (const [i, t] of d.tiles) if (t.mesh && t.mesh.visible) { const b = t.bb; const dx = Math.max(b[0] - c.x, 0, c.x - b[3]), dz = Math.max(b[2] - c.z, 0, c.z - b[5]); out.push([i, Math.hypot(dx, dz), t.tri, t.tbytes]); } return out.filter(x => x[1] < 20).sort((a, b) => a[1] - b[1]); });
for (const [i, d, tri, tb] of sh.slice(0, 14)) { const n = idx.nodes[i]; console.log(i, idx.layers[n.l].name, 'd', d.toFixed(1), 'sp', n.sp, 'vc', n.vc, 'texel', n.texel, 'children', n.ch.length, 'bb', n.bb.map(v => Math.round(v)).join(',')); }
await b.close();
