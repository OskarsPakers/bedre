// Approach C: select + download the I3S nodes covering a corridor around a tram route stretch (geometry buffer 0 + jpg texture) into tools/.cache/realistic/.
// usage: node c-fetch.mjs <route> <s0> <s1> <radius m> <F0> <F1> [--dry]    target vertex spacing = F0 + F1 * distance-to-track (m)
import { openLayers, localToMerc, mercToLocal, nodeSpacing, MERC_K } from '../detail/i3s.mjs'; import { loadTrack } from './poses.mjs';
import fs from 'node:fs'; import path from 'node:path';
const [route, S0, S1, RR, FF0, FF1] = process.argv.slice(2); const dry = process.argv.includes('--dry'); const VS = +(process.env.VS ?? 1), LEAF_D = +(process.env.LEAF_D ?? 60), NODEDUPE = process.env.DEDUPE === '1';
const T = loadTrack(route), s0 = +S0, s1 = +S1, R = +RR, F0 = +FF0, F1 = +FF1;
const ROOT = path.resolve(import.meta.dirname, '../..'), OUT = path.join(ROOT, 'tools/.cache/realistic'), DET = path.join(ROOT, 'tools/.cache/detail/i3s');
const UA = 'Mozilla/5.0 (internal realistic-mesh experiment; polite client)';
const pts = []; for (let s = s0; s <= s1; s += 8) { const p = {}; T.at(s, p); pts.push([p.x, p.z]); }
const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
const a = localToMerc(Math.min(...xs) - R, Math.min(...zs) - R), b = localToMerc(Math.max(...xs) + R, Math.max(...zs) + R);
const bbox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const dist = (n) => { const c = n.obb.center; const [lx, lz] = mercToLocal(c[0], c[1]); const h = Math.max(n.obb.halfSize[0], n.obb.halfSize[1]) / MERC_K; let d = 1e9; for (const [x, z] of pts) d = Math.min(d, Math.hypot(x - lx, z - lz)); return Math.max(0, d - h); };
const ls = (await openLayers(bbox)).filter(L => !/^Pazeme|region_3_AM/i.test(L.name)); console.log("layers", ls.map(l => l.name).join(" "), "bbox", bbox.map(Math.round).join(","));
const cand = [];
for (const L of ls) {
  const dir = path.join(OUT, 'i3s', L.name); fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  for (const f of ['layer.json']) if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(DET, L.name, f))) fs.copyFileSync(path.join(DET, L.name, f), path.join(dir, f));
  const pdir = path.join(DET, L.name, 'pages'); if (fs.existsSync(pdir)) for (const f of fs.readdirSync(pdir)) if (!fs.existsSync(path.join(dir, 'pages', f))) fs.copyFileSync(path.join(pdir, f), path.join(dir, 'pages', f));
  L.dir = dir;
  const walk = async (id, depth) => { const n = await L.node(id), A = n._aabb; if (A.max[0] < bbox[0] || A.min[0] > bbox[2] || A.max[1] < bbox[1] || A.min[1] > bbox[3]) return; const d = dist(n); if (d > 0 && d > R) return;
    const kids = n.children || []; if (n.mesh && (!kids.length || (d > LEAF_D && nodeSpacing(n) <= (F0 + F1 * d) * (/vecriga/i.test(L.name) ? VS : 1)))) { cand.push({ L, n, depth, d }); return; } if (!kids.length) return; await Promise.all(kids.map(k => walk(k, depth + 1))); };
  await walk(0, 0);
}
// dedupe overlapping layers: per 25 m cell keep the layer with the most vertices
const cellOf = (n) => { const [x, z] = mercToLocal(n.obb.center[0], n.obb.center[1]); return Math.floor(x / 25) + ',' + Math.floor(z / 25); };
const tally = new Map(); for (const c of cand) { const k = cellOf(c.n); const m = tally.get(k) || {}; m[c.L.name] = (m[c.L.name] || 0) + c.n.mesh.geometry.vertexCount * (/vecriga/i.test(c.L.name) ? 0.001 : 1); tally.set(k, m); }
const best = new Map(); for (const [k, m] of tally) best.set(k, Object.entries(m).sort((x, y) => y[1] - x[1])[0][0]);
const sel = NODEDUPE ? cand.filter(c => best.get(cellOf(c.n)) === c.L.name) : cand;
const stat = {}; for (const c of sel) { const o = stat[c.L.name] ||= { nodes: 0, vertices: 0, texels: 0 }; o.nodes++; o.vertices += c.n.mesh.geometry.vertexCount; o.texels += c.n.mesh.material?.texelCountHint || 0; }
console.log('selected', sel.length, 'of', cand.length, JSON.stringify(stat)); const V = sel.reduce((s, c) => s + c.n.mesh.geometry.vertexCount, 0);
console.log('vertices', V, 'uncompressed geometry MB ~', (V * 32 / 1e6).toFixed(0), 'texels M', (sel.reduce((s, c) => s + (c.n.mesh.material?.texelCountHint || 0), 0) / 1e6).toFixed(1));
const manifest = { route, s0, s1, R, F0, F1, nodes: sel.map(c => ({ layer: c.L.name, id: c.n.index ?? null, res: c.n.mesh.geometry.resource, vc: c.n.mesh.geometry.vertexCount, def: c.n.mesh.geometry.definition || 0, mat: c.n.mesh.material?.resource, texel: c.n.mesh.material?.texelCountHint, center: c.n.obb.center, half: c.n.obb.halfSize, quat: c.n.obb.quaternion, depth: c.depth, d: +c.d.toFixed(1) })),
  layerDefs: Object.fromEntries(ls.map(L => [L.name, { geom: L.json.geometryDefinitions.map(g => g.geometryBuffers[0]), url: L.url }])) };
if (dry) process.exit(0);
// download
const sleep = ms => new Promise(r => setTimeout(r, ms)); let wire = 0, req = 0, copied = 0, geoB = 0, texB = 0;
async function get(url, file, kind) { if (fs.existsSync(file)) return; fs.mkdirSync(path.dirname(file), { recursive: true }); let err;
  for (let i = 0; i < 5; i++) { try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); const buf = Buffer.from(await r.arrayBuffer()); wire += Number(r.headers.get('content-length')) || buf.length; req++; if (kind === 'g') geoB += buf.length; else texB += buf.length; fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file); return; } catch (e) { err = e; await sleep(1000 * 2 ** i); } } throw err; }
const jobs = []; for (const m of manifest.nodes) { const L = manifest.layerDefs[m.layer]; const gf = path.join(OUT, 'i3s', m.layer, 'g', m.res + '.bin'), df = path.join(DET, m.layer, 'g', m.res + '.bin');
  if (!fs.existsSync(gf) && fs.existsSync(df)) { fs.mkdirSync(path.dirname(gf), { recursive: true }); fs.copyFileSync(df, gf); copied++; geoB += fs.statSync(gf).size; }
  jobs.push(() => get(`${L.url}/nodes/${m.res}/geometries/0`, gf, 'g')); if (m.mat != null) jobs.push(() => get(`${L.url}/nodes/${m.mat}/textures/0`, path.join(OUT, 'i3s', m.layer, 't', m.mat + '.jpg'), 't')); }
let k = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (k < jobs.length) await jobs[k++](); }));
fs.writeFileSync(path.join(OUT, `corridor-${route}.json`), JSON.stringify(manifest));
console.log(JSON.stringify({ requests: req, wireMB: +(wire / 1e6).toFixed(1), geometryCopiedFromDetailCache: copied, geometryMBtotal: +(geoB / 1e6).toFixed(1), textureMB: +(texB / 1e6).toFixed(1) }));
