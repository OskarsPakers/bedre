// Route index: the I3S node tree restricted to a corridor around a route (all layers), compact JSON for the client + the prefetcher.
import fs from 'node:fs'; import path from 'node:path';
import { discoverLayers, Layer, obbAabb, nodeSpacing, MERC_K, localToMerc, mercToLocal } from '../detail/i3s.mjs';
import { loadTrack } from './poses.mjs'; import { DMAX } from './select.mjs';
export const ROOT = path.resolve(import.meta.dirname, '../..'), OUT = path.join(ROOT, 'tools/.cache/realistic'), DET = path.join(ROOT, 'tools/.cache/detail/i3s');
const R = 6378137, D2R = Math.PI / 180, MX0 = 24.1133 * D2R * R, MY0 = Math.log(Math.tan(Math.PI / 4 + 56.9515 * D2R / 2)) * R;
export const FINE = { F0: 0.03, F1: 0.01 };
const SKIP = /region_3_AM|vecmilgravis|pazeme_1_|pazeme_2_/i;   // Pazeme_10_07_2024_upd_wgs (the terrain / water / bridge-deck layer) is kept: it is the only mesh under the Akmens tilts
export function layerDir(name) { return path.join(OUT, 'i3s', name); }
export function seedLayerCache(name) {
  const dir = layerDir(name); fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  const lj = path.join(dir, 'layer.json'); if (!fs.existsSync(lj) && fs.existsSync(path.join(DET, name, 'layer.json'))) fs.copyFileSync(path.join(DET, name, 'layer.json'), lj);
  const pd = path.join(DET, name, 'pages'); if (fs.existsSync(pd)) for (const f of fs.readdirSync(pd)) { const t = path.join(dir, 'pages', f); if (!fs.existsSync(t)) fs.copyFileSync(path.join(pd, f), t); }
}
export async function openLayer(entry) { seedLayerCache(entry.name); const L = new Layer(entry); L.dir = layerDir(entry.name); await L.init(); return L; }
export const toLocalBB = (n) => { const a = n._aabb || (n._aabb = obbAabb(n.obb)); return [(a.min[0] - MX0) / MERC_K, -(a.max[1] - MY0) / MERC_K, (a.max[0] - MX0) / MERC_K, -(a.min[1] - MY0) / MERC_K, a.min[2], a.max[2]]; };
const bbDist = (bb, x, z) => Math.hypot(x < bb[0] ? bb[0] - x : x > bb[2] ? x - bb[2] : 0, z < bb[1] ? bb[1] - z : z > bb[3] ? z - bb[3] : 0);
export function routePts(T, step = 8) { const pts = [], p = {}; for (let s = 0; s <= T.length; s += step) { T.at(s, p); pts.push([p.x, p.z]); } return pts; }
export async function buildIndex(routeId, log = console.log) {
  const file = path.join(OUT, `index-${routeId}.json`); if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const T = loadTrack(routeId), pts = routePts(T); const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const a = localToMerc(Math.min(...xs) - DMAX, Math.min(...zs) - DMAX), b = localToMerc(Math.max(...xs) + DMAX, Math.max(...zs) + DMAX);
  const bbox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const dRoute = (bb) => { let d = 1e9; for (const [x, z] of pts) { const q = bbDist(bb, x, z); if (q < d) d = q; } return d; };
  const nodes = [], layers = [], layerDefs = [];
  for (const e of await discoverLayers()) {
    if (SKIP.test(e.name)) continue; const L = await openLayer(e); const ex = L.extent; if (!ex || ex.some(v => v == null) || ex[2] < bbox[0] || ex[0] > bbox[2] || ex[3] < bbox[1] || ex[1] > bbox[3]) continue;
    const li = layers.length; layers.push({ name: L.name, url: L.url }); layerDefs.push(L.json.geometryDefinitions.map(g => g.geometryBuffers[0])); const before = nodes.length;
    const walk = async (id, parent) => {
      const n = await L.node(id), bb = toLocalBB(n); const d = dRoute(bb); if (d > DMAX) return -1;
      const ent = { l: li, id, p: parent, c: n.obb.center.map(v => +v.toFixed(3)), ch: [], res: n.mesh?.geometry.resource, mat: n.mesh?.material?.resource, vc: n.mesh?.geometry.vertexCount || 0, df: n.mesh?.geometry.definition || 0, texel: n.mesh?.material?.texelCountHint || 0, bb: bb.map(v => +v.toFixed(2)), sp: +(nodeSpacing(n)).toFixed(3) };
      const me = nodes.length; nodes.push(ent); const kids = n.children || [];
      if (kids.length && (!n.mesh || nodeSpacing(n) > FINE.F0 + FINE.F1 * d)) { const r = await Promise.all(kids.map(k => walk(k, me))); for (const c of r) if (c >= 0) ent.ch.push(c); }
      return me;
    };
    await walk(0, -1); log(`index ${routeId}: layer ${L.name}: ${nodes.length - before} nodes`);
  }
  // child indices are positions in `nodes` (entries are pushed before their children resolve, ch filled in walk order)
  const roots = nodes.map((n, i) => i).filter(i => nodes[i].p < 0);
  const idx = { route: routeId, layers, layerDefs, nodes: nodes.map(n => { const { id, p, ...r } = n; return r; }), roots, length: T.length };
  fs.writeFileSync(file + '.tmp', JSON.stringify(idx)); fs.renameSync(file + '.tmp', file); return idx;
}
