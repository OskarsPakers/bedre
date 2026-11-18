// Static server for the sampling experiment, port 5198 ONLY. Read-only views of the repo (src/, tools/maps.mjs, worker/, public/data, node_modules/three, the realistic-mesh cache),
// plus POST /save/<scratch|out>/<file> that writes into tools/.cache/sampling/ or scripts/out/sampling/ (nothing else is writable).
// The game's src/world.js is served with ONE import rewritten (./buildings.js -> the experiment's copy), the file on disk is untouched.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const HERE = import.meta.dirname, ROOT = path.resolve(HERE, '..', '..');
const SCRATCH = path.join(ROOT, 'tools/.cache/sampling'), OUT = path.join(ROOT, 'scripts/out/sampling');
const MAP = [['/cache/', path.join(ROOT, 'tools/.cache/realistic')], ['/sc/', SCRATCH], ['/out/', OUT], ['/sdata/', path.join(HERE, 'data')], ['/three/', path.join(ROOT, 'node_modules/three')], ['/src/', path.join(ROOT, 'src')],
  ['/tools/', path.join(ROOT, 'tools')], ['/worker/', path.join(ROOT, 'worker')], ['/data/', path.join(ROOT, 'public/data')], ['/', HERE]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const REWRITE = { '/src/world.js': [["from './buildings.js'", "from '/buildings-s.js'"]] };
const MESH_DIRS = [path.join(ROOT, 'tools/.cache/sampling/i3s'), path.join(ROOT, 'tools/.cache/realistic/i3s'), path.join(ROOT, 'tools/.cache/detail/i3s')]; // read-only lookup: own cache, then the other agent's cache, then the detail cache (geometry only)
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/mesh/')) { const [, , layer, kind, file] = u.split('/'); for (const d of MESH_DIRS) { const f = path.join(d, layer, kind, file); if (f.startsWith(d) && fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }); return fs.createReadStream(f).pipe(res); } } res.writeHead(404); return res.end('nf'); }
  if (req.method === 'POST' && u.startsWith('/save/')) {
    const [, , kind, ...rest] = u.split('/'); const base = kind === 'out' ? OUT : kind === 'scratch' ? SCRATCH : null; const f = base && path.join(base, rest.join('/'));
    if (!f || !f.startsWith(base)) { res.writeHead(400); return res.end('bad'); }
    fs.mkdirSync(path.dirname(f), { recursive: true }); const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { fs.writeFileSync(f, Buffer.concat(ch)); res.writeHead(200); res.end('ok'); }); return;
  }
  if (u.endsWith('.css') && req.headers['sec-fetch-dest'] === 'script') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(''); } // `import './x.css'` in engine modules: no-op
  for (const [pre, dir] of MAP) if (u.startsWith(pre)) {
    const f = path.join(dir, u.slice(pre.length)); if (!f.startsWith(dir)) break;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const h = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
      if (REWRITE[u]) { let s = fs.readFileSync(f, 'utf8'); for (const [a, b] of REWRITE[u]) { if (!s.includes(a)) console.log('REWRITE MISS', u, a); s = s.replace(a, b); } res.writeHead(200, h); return res.end(s); }
      res.writeHead(200, h); return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404); res.end('nf');
}).listen(5198, '127.0.0.1', () => console.log('http://127.0.0.1:5198'));
