// where do the triangles of a frame go? node tools/tramcity/tribreak.mjs [route=centrs-3] [s=0] [phone=1]   (dev server :5193). Groups visible, frustum-inside meshes by parent name / material kind.
import { chromium, devices } from 'playwright';
const route = process.argv[2] || 'centrs-3', s0 = +(process.argv[3] || 0), phone = process.argv[4] !== '0';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(phone ? { ...devices['Pixel 5'] } : { viewport: { width: 1280, height: 720 } }); const p = await ctx.newPage();
await p.goto(`http://localhost:5193/tramvajs/?route=${route}&run=full&lang=en&autostart=1`); await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 });
await p.evaluate((s0) => { const t = window.__tram; t.setManual(true); t.setAuto('perfect'); let k = 0; while (t.run.s < s0 && k++ < 60000) t.advance(0.1); }, s0); await p.waitForTimeout(2500);
const r = await p.evaluate(() => { const T = window.__tram, S = T.S, cam = T.camera, sc = S.scene; const THREE_F = S.renderer; const out = {}; const fr = S.frustumOf ? null : null;
  const m4 = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse); const e = m4.elements;
  const planes = []; for (const [a, sg] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) { const p = [e[3] + sg * e[a], e[7] + sg * e[a + 4], e[11] + sg * e[a + 8], e[15] + sg * e[a + 12]]; const l = Math.hypot(p[0], p[1], p[2]); planes.push(p.map((v) => v / l)); }
  const inside = (o) => { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld); const sc2 = o.matrixWorld.getMaxScaleOnAxis() * g.boundingSphere.radius; return planes.every((p) => p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] > -sc2); };
  sc.traverse((o) => { if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return; let v = true; for (let q = o; q; q = q.parent) if (!q.visible) { v = false; break; } if (!v || !inside(o)) return;
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); let key = (o.parent && o.parent.name) || (o.parent && o.parent.type) || '?'; key += '|' + (o.isInstancedMesh ? 'inst' : 'mesh') + '|' + (o.material && o.material.type) + '|' + (o.name || '');
    out[key] = (out[key] || 0) + n; });
  return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + Math.round(v / 1000) + 'k'); });
console.log(r.join('\n')); console.log(JSON.stringify(await p.evaluate(() => window.__tram.stats()))); await b.close();
