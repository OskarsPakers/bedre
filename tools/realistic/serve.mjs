// Local server for the reality-mesh tram drive (PRIVATE LOCAL EXPERIMENT).  node tools/realistic/serve.mjs            -> http://localhost:5197
//   node tools/realistic/serve.mjs --prefetch centrs-3 [--quality high] [--yes]   download a route corridor in advance (asks for --yes above ~1.5 GB)
// Tiles are served from tools/.cache/realistic (git-ignored); missing ones are fetched from the public I3S services (<= 4 concurrent, retry/backoff) and cached.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { discoverLayers, getCached } from '../detail/i3s.mjs'; import { buildIndex, OUT, ROOT, DET, seedLayerCache } from './index.mjs'; import { PRESETS } from './select.mjs'; import { prefetchRoute, planRoute, cachedFraction } from './prefetch.mjs';
const HERE = import.meta.dirname, args = process.argv.slice(2), argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--prefetch')) { const r = argOf('--prefetch'); const out = await prefetchRoute(r, argOf('--quality') || 'balanced', { yes: args.includes('--yes') }); process.exit(out.aborted ? 2 : 0); }
const PORT = 5197, ROUTES = ['centrs-1', 'centrs-2', 'centrs-3'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream' };
const STATIC = [['/lib/', HERE], ['/three/', path.join(ROOT, 'node_modules/three')], ['/tram/', path.join(ROOT, 'src/proto/tram')], ['/', path.join(HERE, 'play')]];
const layerUrl = {}; for (const l of await discoverLayers()) layerUrl[l.name] = l.url;
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
let job = null;   // { route, quality, phase, done, total, bytes, error }
const routeInfo = async (id, quality) => {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/proto/tram/routes', id + '.json'), 'utf8')); const have = fs.existsSync(path.join(OUT, `index-${id}.json`)); const o = { id, title: r.title, length: r.length, indexed: have };
  if (have) { const idx = await buildIndex(id), plan = planRoute(idx, id, quality), cf = cachedFraction(idx, plan); Object.assign(o, { estMB: plan.estWireMB, cachedPct: Math.round(100 * cf.have / cf.tot), vertices: plan.vertices }); } return o;
};
async function tile(req, res, u) {   // /i3s/<layer>/(nodepages/<n> | nodes/<res>/geometries/0 | nodes/<res>/textures/0 | layer.json)
  const m = u.match(/^\/i3s\/([\w\-]+)\/(nodepages\/(\d+)|nodes\/(\d+)\/(geometries|textures)\/0|layer\.json)$/); if (!m || !layerUrl[m[1]]) return send(res, 404, 'nf', 'text/plain');
  const [, layer, rest, page, node, kind] = m, dir = path.join(OUT, 'i3s', layer); seedLayerCache(layer);
  const file = page ? path.join(dir, 'pages', page + '.json') : node ? (kind === 'geometries' ? path.join(dir, 'g', node + '.bin') : path.join(dir, 't', node + '.jpg')) : path.join(dir, 'layer.json');
  const seed = node && kind === 'geometries' ? path.join(DET, layer, 'g', node + '.bin') : null; if (seed && !fs.existsSync(file) && fs.existsSync(seed)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(seed, file); }
  try { const buf = await getCached(`${layerUrl[layer]}/${page ? 'nodepages/' + page + '?f=json' : node ? `nodes/${node}/${kind}/0` : '?f=json'}`, file); send(res, 200, buf, TYPES[path.extname(file)]); } catch (e) { send(res, 502, String(e.message), 'text/plain'); }
}
async function tileFile(layer, kind, id) {   // cached file (seeded from the detail cache), fetched politely when missing
  const dir = path.join(OUT, 'i3s', layer); const file = kind === 'g' ? path.join(dir, 'g', id + '.bin') : path.join(dir, 't', id + '.jpg');
  if (!fs.existsSync(file)) { const seed = kind === 'g' ? path.join(DET, layer, 'g', id + '.bin') : null; if (seed && fs.existsSync(seed)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(seed, file); } }
  if (fs.existsSync(file)) return fs.promises.readFile(file);
  return getCached(`${layerUrl[layer]}/nodes/${id}/${kind === 'g' ? 'geometries' : 'textures'}/0`, file);
}
async function combined(res, u) {   // /tile/<layer>/<geoRes>/<texRes|x>  ->  [u32 geoLen][u32 texLen][geometry][jpg]: one request per tile (browsers allow only ~6 connections per host)
  const m = u.match(/^\/tile\/([\w\-]+)\/(\d+)\/(\d+|x)$/); if (!m || !layerUrl[m[1]]) return send(res, 404, 'nf', 'text/plain');
  try { const [g, t] = await Promise.all([tileFile(m[1], 'g', m[2]), m[3] === 'x' ? Buffer.alloc(0) : tileFile(m[1], 't', m[3])]); const h = Buffer.alloc(8); h.writeUInt32LE(g.length, 0); h.writeUInt32LE(t.length, 4); res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache', 'content-length': 8 + g.length + t.length }); res.end(Buffer.concat([h, g, t])); } catch (e) { send(res, 502, String(e.message), 'text/plain'); }
}
const server = http.createServer(async (req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]), q = new URLSearchParams(req.url.split('?')[1] || '');
  try {
    if (u.startsWith('/tile/')) return await combined(res, u);
    if (u.startsWith('/i3s/')) return await tile(req, res, u);
    if (u === '/api/routes') { const quality = PRESETS[q.get('q')] ? q.get('q') : 'balanced'; return send(res, 200, { quality, job, routes: await Promise.all(ROUTES.map((r) => routeInfo(r, quality))) }); }
    if (u.startsWith('/api/index/')) { const id = u.slice(11); if (!ROUTES.includes(id)) return send(res, 404, 'nf', 'text/plain'); await buildIndex(id); return send(res, 200, fs.readFileSync(path.join(OUT, `index-${id}.json`)), 'application/json'); }
    if (u.startsWith('/api/offsets/')) { const f = path.join(OUT, `offsets-${u.slice(13)}.json`); return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, 'none', 'text/plain'); }
    if (u === '/api/job') return send(res, 200, job || {});
    if (u.startsWith('/api/prefetch/')) { const id = u.slice(14), quality = q.get('q') || 'balanced'; if (!ROUTES.includes(id)) return send(res, 404, 'nf', 'text/plain'); if (job && job.phase !== 'done' && job.phase !== 'error') return send(res, 200, job);
      job = { route: id, quality, phase: 'indexing', done: 0, total: 0, bytes: 0 };
      (async () => { try { const idx = await buildIndex(id, () => {}), plan = planRoute(idx, id, quality); const { files } = await import('./prefetch.mjs'), { fetchFiles } = await import('./prefetch.mjs'); job.phase = 'downloading'; job.estMB = plan.estWireMB;
        await fetchFiles(plan.nodes.flatMap((i) => files(idx, i)), (p) => Object.assign(job, p)); job.phase = 'done'; } catch (e) { job.phase = 'error'; job.error = String(e.message); } })(); return send(res, 200, job); }
    for (const [pre, dir] of STATIC) if (u.startsWith(pre)) { const f = path.join(dir, u === '/' ? 'index.html' : u.slice(pre.length)); if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream'); }
    send(res, 404, 'nf', 'text/plain');
  } catch (e) { console.error(e); send(res, 500, String(e.message), 'text/plain'); }
});
server.keepAliveTimeout = 120000; server.headersTimeout = 125000;
server.listen(PORT, '127.0.0.1', () => console.log(`Reality-mesh tram drive (private local experiment): http://localhost:${PORT}`));
