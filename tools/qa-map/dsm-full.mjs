// Full-map DSM (max elevation, 1 m cells) of a map's box from I3S nodes (cache first, polite fetch for missing). -> tools/.cache/qa-map/dsm-<map>.f32 (+ .json)
import fs from 'node:fs'; import path from 'node:path';
import { openLayers, localToMerc, MERC_K, netStats, ROOT } from '../detail/i3s.mjs';
import { Raster, projectNode, rasterizeTriangles } from '../detail/dsm.mjs';
import { MAPS } from '../maps.mjs';
const MAP = process.argv[2] || 'centrs', SP = +(process.argv[3] || 1.0), CELL = +(process.argv[4] || 1);
const m = MAPS.find((x) => x.slug === MAP); const b = m.bounds;
const pad = 20;
const box = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
const a = localToMerc(box.minX, box.maxZ), c = localToMerc(box.maxX, box.minZ);
const bbox = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])];
const layers = (await openLayers(bbox)).filter((l) => !/^Pazeme|pazeme|LGIA_LOD2/i.test(l.name));
const rs = Raster.forBox(box.minX, box.minZ, box.maxX, box.maxZ, CELL);
const info = [];
for (const L of layers) {
  const nodes = await L.select(bbox, SP);
  if (!nodes.length) continue;
  let vc = 0;
  // fetch in chunks of 16 (cap of 4 concurrent is inside getCached)
  for (let k = 0; k < nodes.length; k += 16) {
    const part = nodes.slice(k, k + 16);
    const geos = await Promise.all(part.map((n) => L.geometry(n)));
    part.forEach((n, q) => { vc += geos[q].n; rasterizeTriangles(rs, projectNode(n, geos[q]), geos[q].idx); });
  }
  info.push({ layer: L.name, nodes: nodes.length, vertices: vc });
  console.log(L.name, nodes.length, vc, 'req', netStats.requests, 'wireMB', (netStats.bytesWire / 1e6).toFixed(1));
}
const out = path.join(ROOT, 'tools', '.cache', 'qa-map');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `dsm-${MAP}.f32`), Buffer.from(rs.d.buffer));
fs.writeFileSync(path.join(out, `dsm-${MAP}.json`), JSON.stringify({ x0: rs.x0, z0: rs.z0, w: rs.w, h: rs.h, cell: CELL, spacing: SP, info, net: netStats }));
console.log('done', JSON.stringify(netStats));
