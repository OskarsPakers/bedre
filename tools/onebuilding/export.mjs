// Build GLB variants from gen.js + textures with @gltf-transform (node, no browser).  node export.mjs
// Variants: c-hybrid (lod0/1/2, atlas+normal+ORM, WebP textures), b-parametric (palette only: NO photo pixels -> may live in tools/onebuilding/out), a-bake (box proxy + same atlas)
import { Document, NodeIO } from '@gltf-transform/core'; import { EXTTextureWebP, KHRMaterialsEmissiveStrength, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'; import { meshopt, textureCompress, weld, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer'; import sharp from 'sharp'; import fs from 'node:fs'; import { build } from './gen.js';
const TEX = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/out/tex/', OUTM = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/out/', OUTC = '/Users/oskars/projects/holeio/tools/onebuilding/out/'; fs.mkdirSync(OUTC, { recursive: true });
await MeshoptEncoder.ready;
const rd = (f) => fs.readFileSync(TEX + f);
async function make(name, opts, dir, { atlas = true, webp = true, meshoptz = true } = {}) {
  const r = build(opts), doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene(name);
  const T = (n, b, uri) => doc.createTexture(n).setImage(b).setMimeType('image/png');
  const tAlb = atlas ? T('albedo', rd('atlas-albedo.png')) : T('palette', rd('palette.png')), tNrm = atlas ? T('normal', rd('atlas-normal.png')) : null, tOrm = atlas ? T('orm', rd('atlas-orm.png')) : null, tRoof = T('roof', rd('roof.png')), tGl = T('glass', rd('glass.png')), tEm = T('glassEm', rd('glass-emissive.png'));
  const mats = { wall: doc.createMaterial('wall').setBaseColorTexture(tAlb).setRoughnessFactor(0.92).setMetallicFactor(0), roof: doc.createMaterial('roof').setBaseColorTexture(tRoof).setRoughnessFactor(0.6).setMetallicFactor(0.1), glass: doc.createMaterial('glass').setBaseColorTexture(tGl).setRoughnessFactor(0.2).setMetallicFactor(0.1).setEmissiveTexture(tEm).setEmissiveFactor([1, 1, 1]) };
  if (atlas) { mats.wall.setNormalTexture(tNrm).setNormalScale(0.5).setOcclusionTexture(tOrm).setMetallicRoughnessTexture(tOrm); mats.wall.setRoughnessFactor(1) }
  // emissive factor 1 + emissive texture = lit-window mask; the game sets material.emissiveIntensity = 0 by day and ~1.5 in the evening
  const node = doc.createNode(name); scene.addChild(node); const mesh = doc.createMesh(name); node.setMesh(mesh);
  for (const [k, m] of Object.entries(r.mats)) { const prim = doc.createPrimitive().setMaterial(mats[k]);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.p).setBuffer(buf)).setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.n).setBuffer(buf)).setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(m.uv).setBuffer(buf)).setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(m.c).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(m.i).setBuffer(buf)); mesh.addPrimitive(prim); }
  await doc.transform(weld({ tolerance: 0.0005 }), prune());
  const io = new NodeIO().registerExtensions([EXTTextureWebP, KHRMaterialsEmissiveStrength, EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  if (webp) await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: undefined }));
  if (meshoptz) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = dir + name + '.glb'; await io.write(out, doc); const raw = fs.statSync(out).size;
  const gz = (await import('node:zlib')).gzipSync(fs.readFileSync(out)).length; return { name, tris: r.tris, verts: r.verts, prims: Object.keys(r.mats).length, bytes: raw, gz };
}
const res = [];
for (const lod of [0, 1, 2]) res.push(await make(`opera-c-hybrid-lod${lod}`, { lod, uv: 'photo', proxy: lod === 2 }, OUTM));
for (const lod of [0, 1, 2]) res.push(await make(`opera-b-parametric-lod${lod}`, { lod, uv: 'palette' }, OUTC, { atlas: false }));
res.push(await make('opera-a-bake-proxy', { lod: 2, uv: 'photo', proxy: true }, OUTM));
console.table(res); fs.writeFileSync(OUTM + 'sizes.json', JSON.stringify(res, null, 1));
