// Select + download the FINEST reality-mesh nodes (I3S) around the Opera. Polite: <=4 concurrent, backoff, generic UA, cached under tools/.cache/onebuilding/i3s/.
// usage: node fetch.mjs [--dry] ; env SP=<target spacing m, default 0.12>
import { openLayers, localToMerc, MERC_K, nodeSpacing } from '../../detail/i3s.mjs'; import fs from 'node:fs'; import path from 'node:path';
const [SLUG, X0, X1, Z0, Z1] = process.argv.filter(a => !a.startsWith('--')).slice(2); const dry = process.argv.includes('--dry'), SP = +(process.env.SP || 0.12);
const BOX = { x0: +X0 - 15, x1: +X1 + 15, z0: +Z0 - 15, z1: +Z1 + 15 };
const ROOT = path.resolve(import.meta.dirname, '../../..'), OUT = path.join(ROOT, 'tools/.cache/onebuilding/i3s-' + SLUG), WORK = path.join(ROOT, 'tools/.cache/onebuilding/work-' + SLUG), OLD = [path.join(ROOT, 'tools/.cache/detail/i3s'), path.join(ROOT, 'tools/.cache/realistic/i3s')];
const a = localToMerc(BOX.x0, BOX.z1), b = localToMerc(BOX.x1, BOX.z0), bbox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const ls = (await openLayers(bbox)).filter(L => !/^Pazeme|region_3_AM/i.test(L.name)); console.log('layers', ls.map(l => l.name).join(' '));
const sel = [];
for (const L of ls) {
  L.dir = path.join(OUT, L.name); fs.mkdirSync(path.join(L.dir, 'pages'), { recursive: true });
  for (const o of OLD) { const p = path.join(o, L.name, 'pages'); if (fs.existsSync(p)) for (const f of fs.readdirSync(p)) if (!fs.existsSync(path.join(L.dir, 'pages', f))) fs.copyFileSync(path.join(p, f), path.join(L.dir, 'pages', f)); }
  fs.writeFileSync(path.join(L.dir, 'layer.json'), JSON.stringify(L.json));
  const walk = async (id, depth) => { const n = await L.node(id), A = n._aabb; if (A.max[0] < bbox[0] || A.min[0] > bbox[2] || A.max[1] < bbox[1] || A.min[1] > bbox[3]) return;
    const kids = n.children || []; if (n.mesh && (!kids.length || nodeSpacing(n) <= SP)) { sel.push({ L, n, depth }); return; } await Promise.all(kids.map(k => walk(k, depth + 1))); };
  await walk(0, 0);
}
const by = {}; for (const c of sel) { const o = by[c.L.name + ' d' + c.depth] ||= { nodes: 0, vc: 0 }; o.nodes++; o.vc += c.n.mesh.geometry.vertexCount; } console.table(by);
const V = sel.reduce((s, c) => s + c.n.mesh.geometry.vertexCount, 0); console.log('nodes', sel.length, 'vertices', V, 'geom MB raw ~', (V * 32 / 1e6).toFixed(0));
const manifest = { box: BOX, nodes: sel.map(c => ({ layer: c.L.name, res: c.n.mesh.geometry.resource, vc: c.n.mesh.geometry.vertexCount, def: c.n.mesh.geometry.definition || 0, mat: c.n.mesh.material?.resource, center: c.n.obb.center, half: c.n.obb.halfSize, quat: c.n.obb.quaternion, depth: c.depth })),
  layerDefs: Object.fromEntries(ls.map(L => [L.name, { geom: L.json.geometryDefinitions.map(g => g.geometryBuffers[0]), url: L.url }])) };
if (dry) process.exit(0); fs.mkdirSync(WORK, { recursive: true });
const UA = 'Mozilla/5.0 (research client; polite)', sleep = ms => new Promise(r => setTimeout(r, ms)); let wire = 0, req = 0, hit = 0;
async function get(url, file) { if (fs.existsSync(file)) { hit++; return; } for (const o of OLD) { const rel = path.relative(OUT, file), f2 = path.join(o, rel); if (fs.existsSync(f2)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(f2, file); hit++; return; } }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 5; i++) { try { const r = await fetch(url, { headers: { 'User-Agent': UA } , signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const buf = Buffer.from(await r.arrayBuffer()); wire += +(r.headers.get('content-length') || buf.length); req++; fs.writeFileSync(file, buf); return; } catch (e) { await sleep(500 * 2 ** i); } } console.error('FAILED', url); }
const jobs = []; for (const m of manifest.nodes) { const L = manifest.layerDefs[m.layer]; jobs.push(() => get(`${L.url}/nodes/${m.res}/geometries/0`, path.join(OUT, m.layer, 'g', m.res + '.bin'))); if (m.mat != null) jobs.push(() => get(`${L.url}/nodes/${m.mat}/textures/0`, path.join(OUT, m.layer, 't', m.mat + '.jpg'))); }
let k = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (k < jobs.length) await jobs[k++](); }));
fs.writeFileSync(path.join(WORK, 'manifest.json'), JSON.stringify(manifest)); console.log(JSON.stringify({ requests: req, wireMB: +(wire / 1e6).toFixed(1), cacheHits: hit }));
