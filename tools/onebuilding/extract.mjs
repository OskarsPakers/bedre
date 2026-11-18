// Extract the reality-mesh triangles around the Opera from the cached corridor tiles (centrs-3). Output: tools/.cache/onebuilding/work/mesh.json + tiles' textures stay in the realistic cache.
import fs from 'node:fs'; import { MX0, MY0, K, Y0 } from './lib.mjs';
const C = 'tools/.cache/realistic/'; const man = JSON.parse(fs.readFileSync(C + 'corridor-centrs-3.json'));
const BOX = { x0: 5, x1: 125, z0: 170, z1: 335 };
const TS = { Float32: [4, Float32Array], UInt8: [1, Uint8Array], UInt16: [2, Uint16Array], UInt32: [4, Uint32Array] };
const out = []; let total = 0;
for (const m of man.nodes) {
  const f = `${C}i3s/${m.layer}/g/${m.res}.bin`; if (!fs.existsSync(f)) continue;
  const gb = fs.readFileSync(f); const ab = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength); const dv = new DataView(ab), vc = dv.getUint32(0, true);
  const def = man.layerDefs[m.layer].geom[m.def]; let off = 8; const A = {};
  for (const k of ['position', 'normal', 'uv0', 'color']) { const a = def[k]; if (!a) continue; const [sz, Ctor] = TS[a.type]; const n = vc * a.component; A[k] = new Ctor(ab.slice(off, off + n * sz)); off += n * sz; }
  const c = m.center, P = new Float32Array(vc * 3);
  for (let i = 0; i < vc; i++) { P[i*3] = (c[0] + A.position[i*3] - MX0) / K; P[i*3+1] = c[2] + A.position[i*3+2] - Y0; P[i*3+2] = -((c[1] + A.position[i*3+1] - MY0) / K); }
  const keep = []; let edge = 0;
  for (let t = 0; t < vc; t += 3) { let cx = 0, cz = 0; for (let j = 0; j < 3; j++) { cx += P[(t+j)*3]; cz += P[(t+j)*3+2]; } cx /= 3; cz /= 3;
    if (cx >= BOX.x0 && cx <= BOX.x1 && cz >= BOX.z0 && cz <= BOX.z1) { keep.push(t); const a = t*3; edge += Math.hypot(P[a]-P[a+3], P[a+1]-P[a+4], P[a+2]-P[a+5]); } }
  if (keep.length > 30) { out.push({ layer: m.layer, res: m.res, mat: m.mat, tris: keep.length / 3 | 0, vc, meanEdge: +(edge / (keep.length / 3 | 0)).toFixed(3), depth: m.depth, texel: m.texel }); total += keep.length / 3; }
}
console.log(out.length, 'nodes', total | 0, 'tris'); console.table(out.map(o => ({ ...o })));
fs.writeFileSync('tools/.cache/onebuilding/work/nodes.json', JSON.stringify(out));
