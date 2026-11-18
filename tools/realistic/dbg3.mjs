import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1000, height: 600 } })).newPage(); p.on('pageerror', e => console.log('pageerror', e.message)); p.on('console', m => console.log('console', m.text().slice(0, 200)));
await p.goto('http://localhost:5197/drive.html?route=centrs-1&auto=0'); await p.waitForFunction(() => window.__d); await p.evaluate(() => { window.__d.warp(1400); window.__d.setView(0); }); await p.waitForTimeout(15000);
const idx = await (await fetch('http://localhost:5197/api/index/centrs-1')).json();
const r = await p.evaluate(() => { const d = window.__d; const c = d.camera.position; const out = []; for (const [i, t] of d.tiles) { const bb = t.bb; if (!bb) continue; const dx = Math.max(bb[0] - c.x, 0, c.x - bb[3]), dz = Math.max(bb[2] - c.z, 0, c.z - bb[5]); const dd = Math.hypot(dx, dz); if (dd < 120) out.push([i, +dd.toFixed(0), t.state, t.mesh.visible, t.tri, bb.map(Math.round).join(',')]); } return { cam: [c.x, c.y, c.z], g: d.groundAt(1400), out: out.sort((a, b) => a[1] - b[1]).slice(0, 25) }; });
console.log(JSON.stringify(r.cam), r.g); for (const o of r.out) { const n = idx.nodes[o[0]]; console.log(o.join(' '), idx.layers[n.l].name, 'sp', n.sp, 'vc', n.vc); }
await p.screenshot({ path: '/Users/oskars/projects/holeio/scripts/out/realistic/_t/bridge-dbg.png' }); await b.close();
