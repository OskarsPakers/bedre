// Browser module: load the dense reality-mesh nodes (manifest.json from fetch.mjs) around the Opera, clipped to a local box, in the game's local frame (x east, y up (ground ~ 0), z south).
import * as THREE from 'three';
const R = 6378137, D2R = Math.PI / 180, LAT0 = 56.9515, LON0 = 24.1133, MX0 = LON0 * D2R * R, MY0 = Math.log(Math.tan(Math.PI / 4 + LAT0 * D2R / 2)) * R, K = 1 / Math.cos(LAT0 * D2R), Y0 = 5;
const TS = { Float32: [4, Float32Array], UInt8: [1, Uint8Array], UInt16: [2, Uint16Array], UInt32: [4, Uint32Array] };
export async function loadDense(box, { onNode, material = 'basic', layers } = {}) {
  const man = await (await fetch('/cache/work/manifest.json')).json(); const group = new THREE.Group(); const stats = { nodes: 0, tris: 0, srcVerts: 0, texJpgBytes: 0, texPx: 0 };
  let qi = 0; const nodes = man.nodes.filter(n => !layers || layers.includes(n.layer));
  async function one(m) {
    const def = man.layerDefs[m.layer].geom[m.def];
    const [gb, tb] = await Promise.all([fetch(`/cache/i3s/${m.layer}/g/${m.res}.bin`).then(r => r.arrayBuffer()), m.mat != null ? fetch(`/cache/i3s/${m.layer}/t/${m.mat}.jpg`).then(r => r.ok ? r.blob() : null) : null]);
    const dv = new DataView(gb), vc = dv.getUint32(0, true); let off = 8; const A = {};
    for (const k of ['position', 'normal', 'uv0', 'color']) { const a = def[k]; if (!a) continue; const [sz, C] = TS[a.type]; const n = vc * a.component; A[k] = new C(gb.slice(off, off + n * sz)); off += n * sz; }
    const c = m.center, pos = [], uv = [];
    for (let t = 0; t < vc; t += 3) {
      const p = [];
      for (let j = 0; j < 3; j++) { const i = t + j; p.push([(c[0] + A.position[i * 3] - MX0) / K, c[2] + A.position[i * 3 + 2] - Y0, -((c[1] + A.position[i * 3 + 1] - MY0) / K)]); }
      const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      if (cx < box.x0 || cx > box.x1 || cz < box.z0 || cz > box.z1) continue;
      for (let j = 0; j < 3; j++) { pos.push(...p[j]); uv.push(A.uv0[(t + j) * 2], A.uv0[(t + j) * 2 + 1]); }
    }
    stats.srcVerts += vc; if (!pos.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    let mat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
    if (tb) { stats.texJpgBytes += tb.size; const bmp = await createImageBitmap(tb, { imageOrientation: 'none' }); stats.texPx += bmp.width * bmp.height; const t = new THREE.Texture(bmp); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; t.needsUpdate = true; mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }); }
    const mesh = new THREE.Mesh(g, mat); mesh.userData = { layer: m.layer, res: m.res, depth: m.depth }; group.add(mesh); stats.nodes++; stats.tris += pos.length / 9; onNode?.(mesh);
  }
  await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { while (qi < nodes.length) await one(nodes[qi++]); }));
  return { group, stats };
}
