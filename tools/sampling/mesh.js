// Loads the cached I3S corridor (tools/.cache/realistic, read only, via /cache/) into three.js: one Mesh per node, world-space positions (game-local metres: x east, z south, y = mesh height - 5),
// the node's JPEG as texture. Same decoding as tools/realistic/c.html (geometry buffer 0, UVs 0..1, image uploaded flipped, texture.flipY=false).
import * as THREE from 'three';
const R = 6378137, D2R = Math.PI / 180, LAT0 = 56.9515, LON0 = 24.1133, MX0 = LON0 * D2R * R, MY0 = Math.log(Math.tan(Math.PI / 4 + LAT0 * D2R / 2)) * R, K = 1 / Math.cos(LAT0 * D2R), Y0 = 5;
const TS = { Float32: [4, Float32Array], UInt8: [1, Uint8Array], UInt16: [2, Uint16Array], UInt32: [4, Uint32Array] };
export const MESH_Y0 = Y0;
export async function loadCorridor(route = 'centrs-3', { concurrency = 6, onProgress = () => {}, makeMaterial = null, nodeFilter = null, man: manIn = null, base = null } = {}) { // base '/mesh/' = streaming lookup across the caches (server.mjs); man = a manifest object (plan-0.4.json)
  const man = manIn || await (await fetch(`/cache/corridor-${route}.json`)).json();
  const nodes = []; const group = new THREE.Group(); let qi = 0, done = 0; const stats = { vertices: 0, geoBytes: 0, texBytes: 0, nodes: 0 };
  const list = man.nodes.filter((m) => !nodeFilter || nodeFilter(m));
  async function one(m) {
    const def = man.layerDefs[m.layer].geom[m.def];
    const [gb, tb] = await Promise.all([fetch(base ? `${base}${m.layer}/g/${m.res}.bin` : `/cache/i3s/${m.layer}/g/${m.res}.bin`).then((r) => r.arrayBuffer()), m.mat != null ? fetch(base ? `${base}${m.layer}/t/${m.mat}.jpg` : `/cache/i3s/${m.layer}/t/${m.mat}.jpg`).then((r) => r.blob()) : null]);
    stats.geoBytes += gb.byteLength; const dv = new DataView(gb), vc = dv.getUint32(0, true); let off = 8; const A = {};
    for (const k of ['position', 'normal', 'uv0', 'color']) { const a = def[k]; if (!a) continue; const [sz, Ctor] = TS[a.type]; const n = vc * a.component; A[k] = new Ctor(gb.slice(off, off + n * sz)); off += n * sz; }
    const pos = new Float32Array(vc * 3), c = m.center; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < vc; i++) {
      const x = (c[0] + A.position[i * 3] - MX0) / K, y = c[2] + A.position[i * 3 + 2] - Y0, z = -((c[1] + A.position[i * 3 + 1] - MY0) / K);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(A.uv0, 2)); g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)); g.computeBoundingSphere();
    let tex = null; if (tb) { stats.texBytes += tb.size; const bmp = await createImageBitmap(tb, { imageOrientation: 'none' }); tex = new THREE.Texture(bmp); tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4; tex.needsUpdate = true; }
    const mat = makeMaterial ? makeMaterial(tex, m) : new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: tex ? 0xffffff : 0x888888 });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = true; group.add(mesh);
    nodes.push({ m, pos, uv: A.uv0, bbox: g.boundingBox, mesh, tex, vc, layer: m.layer, depth: m.depth }); stats.vertices += vc; stats.nodes++; onProgress(++done / list.length);
  }
  await Promise.all(Array.from({ length: concurrency }, async () => { while (qi < list.length) await one(list[qi++]); }));
  const dispose = () => { for (const n of nodes) { n.mesh.geometry.dispose(); n.mesh.material.dispose(); if (n.tex) { n.tex.dispose(); n.tex.image && n.tex.image.close && n.tex.image.close(); } n.pos = null; n.uv = null; } nodes.length = 0; };
  return { group, nodes, stats, man, dispose };
}
