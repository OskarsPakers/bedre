// Static server for the one-building experiment. Port 5196 only. / = tools/onebuilding, /cache/ = tools/.cache/onebuilding, /three/ = node_modules/three, /tram/ = src/proto/tram (read-only), /rcache/ = tools/.cache/realistic
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const HERE = import.meta.dirname, ROOT = path.resolve(HERE, '..', '..');
const MAP = [['/cache/', path.join(ROOT, 'tools/.cache/onebuilding')], ['/three/', path.join(ROOT, 'node_modules/three')], ['/tram/', path.join(ROOT, 'src/proto/tram')], ['/data/', path.join(ROOT, 'public/data')], ['/rcache/', path.join(ROOT, 'tools/.cache/realistic')], ['/', HERE]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.mp4': 'video/mp4' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  for (const [pre, dir] of MAP) if (u.startsWith(pre)) {
    const f = path.join(dir, u.slice(pre.length)); if (!f.startsWith(dir)) break;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(404); res.end('nf');
}).listen(5196, '127.0.0.1', () => console.log('http://127.0.0.1:5196'));
