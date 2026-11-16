import fs from 'node:fs'; import path from 'node:path';
import { openLayers, localToMerc, MERC_K, netStats } from '../detail/i3s.mjs';
const MAP = process.argv[2]||'centrs';
const b = {centrs:{minX:-2100,maxX:1200,minZ:-1200,maxZ:1500}}[MAP];
const a = localToMerc(b.minX,b.maxZ), c = localToMerc(b.maxX,b.minZ);
const bbox=[Math.min(a[0],c[0]),Math.min(a[1],c[1]),Math.max(a[0],c[0]),Math.max(a[1],c[1])];
const ls = await openLayers(bbox);
for (const sp of [1.0, 1.5, 2.5]) {
 let tot=0,miss=0,vc=0,mv=0;
 for (const L of ls) {
  const nodes = await L.select(bbox, sp);
  for (const n of nodes){ tot++; vc+=n.mesh.geometry.vertexCount; const f=path.join(L.dir,'g',n.mesh.geometry.resource+'.bin'); if(!fs.existsSync(f)){ miss++; mv+=n.mesh.geometry.vertexCount;} }
 }
 console.log('spacing',sp,'nodes',tot,'missing',miss,'vertices',vc, 'missMBraw',(mv*32/1e6).toFixed(0));
}
