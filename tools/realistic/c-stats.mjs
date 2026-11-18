import { openLayers, localToMerc, mercToLocal, nodeSpacing, obbAabb, MERC_K } from '../detail/i3s.mjs'; import { loadTrack } from './poses.mjs'; import fs from 'node:fs';
const T = loadTrack('centrs-3'); const s0 = +process.argv[2] || 1050, s1 = +process.argv[3] || 1650, R = +process.argv[4] || 120;
const pts = []; for (let s = s0; s <= s1; s += 10) { const p = {}; T.at(s, p); pts.push([p.x, p.z]); }
const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
const a = localToMerc(Math.min(...xs) - R, Math.min(...zs) - R), b = localToMerc(Math.max(...xs) + R, Math.max(...zs) + R);
const bbox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const dist = (n) => { const c = n.obb.center; const [lx, lz] = mercToLocal(c[0], c[1]); const h = Math.max(n.obb.halfSize[0], n.obb.halfSize[1]) / MERC_K; let d = 1e9; for (const [x, z] of pts) d = Math.min(d, Math.hypot(x - lx, z - lz)); return Math.max(0, d - h); };
const F0 = +process.argv[5] || 0.2, F1 = +process.argv[6] || 0.012;
const near = (n) => { const c = n.obb.center; const [lx, lz] = mercToLocal(c[0], c[1]); const h = Math.max(n.obb.halfSize[0], n.obb.halfSize[1]) / MERC_K; let d = 1e9; for (const [x, z] of pts) d = Math.min(d, Math.hypot(x - lx, z - lz)); return d < R + h; };
const ls = await openLayers(bbox);
for (const L of ls) {
  const out = []; const walk = async (id, depth) => { const n = await L.node(id); const A = n._aabb; if (A.max[0] < bbox[0] || A.min[0] > bbox[2] || A.max[1] < bbox[1] || A.min[1] > bbox[3]) return; if (!near(n)) return; const kids = n.children || []; if (n.mesh && (!kids.length || nodeSpacing(n) <= F0 + F1 * dist(n))) { out.push({ n, depth }); return; } if (!kids.length) return; await Promise.all(kids.map(k => walk(k, depth + 1))); };
  await walk(0, 0);
  const vc = out.reduce((s, o) => s + o.n.mesh.geometry.vertexCount, 0); const sp = out.map(o => nodeSpacing(o.n)).sort((x, y) => x - y);
  console.log(L.name, 'leaves', out.length, 'vertices', vc, 'depth', [...new Set(out.map(o => o.depth))].join(','), 'spacing med', sp[sp.length >> 1]?.toFixed(2), 'texres sample', JSON.stringify(out[0]?.n.mesh.material), 'lodThr', out[0]?.n.lodThreshold);
}
