// Static server for the realistic-mesh experiment. Port 5197 only. Serves tools/realistic/ at / , tools/.cache/realistic at /cache/ , node_modules/three at /three/ , src/proto/tram (read-only) at /tram/
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const HERE = import.meta.dirname, ROOT = path.resolve(HERE, '..', '..');
const MAP = [['/cache/', path.join(ROOT, 'tools/.cache/realistic')], ['/three/', path.join(ROOT, 'node_modules/three')], ['/tram/', path.join(ROOT, 'src/proto/tram')], ['/', HERE]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  for (const [pre, dir] of MAP) if (u.startsWith(pre)) {
    const f = path.join(dir, u.slice(pre.length)); if (!f.startsWith(dir)) break;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(404); res.end('nf');
}).listen(5197, '127.0.0.1', () => console.log('http://127.0.0.1:5197'));
