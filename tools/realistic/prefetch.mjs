// Prefetch: simulate the client's cut selection along the whole route, union the nodes, estimate / download them (cache first, <= 4 concurrent via the shared limiter).
import fs from 'node:fs'; import path from 'node:path';
import { getCached } from '../detail/i3s.mjs'; import { buildIndex, OUT, DET, layerDir } from './index.mjs';
import { selectCut, PRESETS } from './select.mjs'; import { loadTrack } from './poses.mjs';
export function planRoute(idx, routeId, preset = 'balanced', step = 8) {
  // mirrors the drive's predictive loader: the FINAL cut (distance scale 0.8) of the chase camera (33 m behind the tram) and the cab camera at every `step` m of the route, in travel order
  const T = loadTrack(routeId), P = PRESETS[preset], set = new Set(), tmp = [], p = {}, q = {};
  for (let s = 0; s <= T.length; s += step) for (const off of [-33.4, 3]) { T.at(Math.max(0, s + off), p); T.at(Math.max(0, s + off) + 3, q); const fx = q.x - p.x, fz = q.z - p.z, l = Math.hypot(fx, fz) || 1; for (const i of selectCut(idx, p.x, p.z, fx / l, fz / l, P, false, 0.8, tmp)) set.add(i); }
  const nodes = [...set]; let vc = 0, tex = 0; for (const i of nodes) { vc += idx.nodes[i].vc; tex += idx.nodes[i].texel; }
  return { nodes, vertices: vc, texels: tex, estWireMB: Math.round((vc * 32 * 0.40 + tex * 0.085) / 1e6), estRawGeoMB: Math.round(vc * 32 / 1e6) };
}
export function files(idx, i) { const n = idx.nodes[i], L = idx.layers[n.l], dir = layerDir(L.name);
  return [{ url: `${L.url}/nodes/${n.res}/geometries/0`, file: path.join(dir, 'g', n.res + '.bin'), seed: path.join(DET, L.name, 'g', n.res + '.bin') }, ...(n.mat != null ? [{ url: `${L.url}/nodes/${n.mat}/textures/0`, file: path.join(dir, 't', n.mat + '.jpg') }] : [])]; }
export function cachedFraction(idx, plan) { let have = 0, tot = 0; for (const i of plan.nodes) for (const f of files(idx, i)) { tot++; if (fs.existsSync(f.file) || (f.seed && fs.existsSync(f.seed))) have++; } return { have, tot }; }
export async function fetchFiles(list, onProgress) {
  let done = 0, bytes = 0, k = 0; const todo = list.filter(f => !fs.existsSync(f.file));
  for (const f of todo) if (f.seed && fs.existsSync(f.seed)) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.copyFileSync(f.seed, f.file); }
  const rest = todo.filter(f => !fs.existsSync(f.file)); const total = rest.length;
  await Promise.all([0, 1, 2, 3].map(async () => { while (k < rest.length) { const f = rest[k++]; try { const b = await getCached(f.url, f.file); bytes += b.length; } catch (e) { console.warn('fail', f.url, e.message); } done++; onProgress?.({ done, total, bytes }); } }));
  return { files: total, bytes };
}
export async function prefetchRoute(routeId, preset, { yes = false, log = console.log } = {}) {
  const idx = await buildIndex(routeId, log), plan = planRoute(idx, routeId, preset), cf = cachedFraction(idx, plan);
  log(`route ${routeId} (${preset}): ${plan.nodes.length} nodes, ${(plan.vertices / 1e6).toFixed(1)} M vertices, ${(plan.texels / 1e6).toFixed(0)} M texels; cached ${cf.have}/${cf.tot} files; estimated download ~${plan.estWireMB} MB (geometry ${plan.estRawGeoMB} MB raw)`);
  if (plan.estWireMB > 1500 && !yes) { log('more than ~1.5 GB: re-run with --yes to proceed'); return { plan, aborted: true }; }
  const list = plan.nodes.flatMap(i => files(idx, i)); const t0 = Date.now();
  const r = await fetchFiles(list, ({ done, total, bytes }) => { if (done % 25 === 0 || done === total) { process.stdout?.write?.(`\r  ${done}/${total} files  ${(bytes / 1e6).toFixed(0)} MB  ${((Date.now() - t0) / 1000) | 0}s   `); } });
  log(`\ndone: ${r.files} new files, ${(r.bytes / 1e6).toFixed(0)} MB (decompressed bytes) in ${((Date.now() - t0) / 1000) | 0}s`); return { plan, ...r };
}
