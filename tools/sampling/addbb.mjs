// add local-metre AABBs (bb: [x0, z0, x1, z1]) to a plan manifest (read-only on the caches)
import fs from 'node:fs'; import { obbAabb, mercToLocal } from '../detail/i3s.mjs';
const f = process.argv[2]; const m = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const n of m.nodes) { const a = obbAabb({ center: n.center, halfSize: n.half, quaternion: n.quat }); const [x0, z1] = mercToLocal(a.min[0], a.min[1]), [x1, z0] = mercToLocal(a.max[0], a.max[1]); n.bb = [x0, z0, x1, z1]; }
fs.writeFileSync(f, JSON.stringify(m)); console.log('bb added', m.nodes.length);
