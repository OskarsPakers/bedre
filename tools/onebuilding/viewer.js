// Standalone viewer (port 5196): the Opera model next to the tram, with the tram game's day / evening / winter lighting, LOD + variant switch, wireframe, tram cab / chase cameras on the real route.
import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildTrack } from '/tram/track.js'; import { TramModel } from '/tram/tramModel.js'; import { loadDense } from '/meshload.js'; import { O, TH, toWorld } from '/frame.js';
const Q = new URLSearchParams(location.search);
const S = { model: Q.get('model') || 'hybrid', lod: +(Q.get('lod') ?? 0), theme: Q.get('theme') || 'day', wire: Q.get('wire') === '1', view: Q.get('view') || 'orbit1', s: +(Q.get('s') || 1290), tram: Q.get('tram') !== '0', ctx: Q.get('ctx') !== '0', w: +(Q.get('w') || innerWidth), h: +(Q.get('h') || innerHeight) };
const LOOKS = { // = src/proto/tram/env.js LOOKS (copied values)
  day: { sky: [0x6fa3d6, 0xa4c6e2, 0xcfe0ec], fog: 0xcfe0ec, hemi: [0xe3eefa, 0xb9a98c, 1.25], sun: [0xfff0d4, 2.5, [-0.55, 0.78, 0.35]], exposure: 1.0, snow: 0, night: 0, ground: 0x8c8a84, ctx: 0xd9cdb8 },
  evening: { sky: [0x0d1236, 0x262a6e, 0xd9774f], fog: 0x2f3070, hemi: [0x95a6ec, 0x5a5280, 1.7], sun: [0xb5c8ff, 1.55, [0.52, 0.6, -0.42]], exposure: 1.2, snow: 0, night: 1, ground: 0x4a4a58, ctx: 0x9a96a8 },
  winter: { sky: [0xaab8c8, 0xc8d4e0, 0xdde6ee], fog: 0xdde6ee, hemi: [0xe6eefc, 0xc9d0dc, 1.38], sun: [0xfff4e2, 1.9, [-0.45, 0.5, 0.5]], exposure: 1.02, snow: 1, night: 0, ground: 0xe4e9f0, ctx: 0xe9e6e1 },
};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(S.w, S.h); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, S.w / S.h, 0.3, 2500); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); const SC = 130; Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 500 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06; scene.add(hemi, sun, sun.target);
const C0 = new THREE.Vector3(...toWorld(20, 20, 0)); sun.target.position.copy(C0);
const snowU = { value: 0 }; const lit = { glass: [] };
function patchSnow(m) { if (m.userData.snow) return; m.userData.snow = 1; m.onBeforeCompile = (sh) => { sh.uniforms.uSnow = snowU; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWN = normalize(mat3(modelMatrix) * normal);');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN; uniform float uSnow;').replace('#include <color_fragment>', '#include <color_fragment>\n float sn = smoothstep(0.45, 0.8, vWN.y) * uSnow; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), sn);'); }; m.needsUpdate = true; }
// ground + context
const groundMat = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 1 }); patchSnow(groundMat);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.set(C0.x, -0.02, C0.z); ground.receiveShadow = true; scene.add(ground);
const ctxMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.95 }); patchSnow(ctxMat); const ctxGroup = new THREE.Group(); scene.add(ctxGroup);
if (S.ctx) { const d = await (await fetch('/data/riga.json')).json(); for (const b of d.buildings) { if (b.id === 49616059 || b.id === 49615783) continue; let cx = 0, cz = 0; for (const p of b.p) { cx += p[0]; cz += p[1]; } cx /= b.p.length; cz /= b.p.length; { const dx = cx - O[0], dz = cz - O[1], u = dx * Math.cos(TH) + dz * Math.sin(TH), vv = dx * Math.sin(TH) - dz * Math.cos(TH); if (u > -20 && u < 112 && vv > -3 && vv < 46) continue; } if (Math.hypot(cx - C0.x, cz - C0.z) > 260) continue;
  const sh = new THREE.Shape(b.p.map(p => new THREE.Vector2(p[0], -p[1]))); const g = new THREE.ExtrudeGeometry(sh, { depth: b.h || 10, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, ctxMat); m.castShadow = m.receiveShadow = true; ctxGroup.add(m); } }
// track + tram
const route = await (await fetch('/tram/routes/centrs-3.json')).json(), track = buildTrack(route); const railMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.5, metalness: 0.6 }); const rp = {}; const rails = new THREE.Group(); scene.add(rails);
{ const pts = [[], []]; for (let s = 1100; s <= 1600; s += 2) { track.at(s, rp); const rx = -Math.sin(rp.yaw), rz = Math.cos(rp.yaw); pts[0].push(new THREE.Vector3(rp.x + rx * 0.72, 0.03, rp.z + rz * 0.72)); pts[1].push(new THREE.Vector3(rp.x - rx * 0.72, 0.03, rp.z - rz * 0.72)); }
  for (const P of pts) rails.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(P), new THREE.LineBasicMaterial({ color: 0x40454b }))); const road = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5a5a5e, roughness: 1 }));
  const strip = (w) => { const v = [], idx = []; for (let k = 0, s = 1100; s <= 1600; s += 4, k++) { track.at(s, rp); const rx = -Math.sin(rp.yaw), rz = Math.cos(rp.yaw); v.push(rp.x + rx * w, 0.01, rp.z + rz * w, rp.x - rx * w, 0.01, rp.z - rz * w); if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const rm = new THREE.Mesh(strip(11), new THREE.MeshStandardMaterial({ color: 0x4d4d52, roughness: 1 })); rm.receiveShadow = true; patchSnow(rm.material); scene.add(rm); void road; }
const tram = new TramModel(scene, { line: '11', dest: 'Centrs' }); tram.beams.forEach(b => b.visible = false); tram.group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
// model
let model = null, dense = null; const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function loadModel() {
  if (model) { scene.remove(model); model = null; } if (dense) { scene.remove(dense); dense = null; } lit.glass = [];
  if (S.model === 'ref') { const { group, stats } = await loadDense({ x0: -20, x1: 140, z0: 160, z1: 345 }); group.position.y = -0.8; scene.add(group); dense = group; window.__v.denseStats = stats; return; }
  if (S.model === 'none') return;
  const file = { hybrid: `/cache/out/opera-c-hybrid-lod${S.lod}.glb`, param: `/out/opera-b-parametric-lod${S.lod}.glb`, bake: `/cache/out/opera-a-bake-proxy.glb` }[S.model];
  const g = await gl.loadAsync(file); model = new THREE.Group(); model.add(g.scene); model.position.set(O[0], 0, O[1]); model.rotation.y = Math.PI / 2 - TH; scene.add(model);
  model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; const m = o.material; patchSnow(m); if (m.name === 'glass') lit.glass.push(m); if (m.map) m.map.anisotropy = 8; } }); // vertex colours = baked cavity shade
}
function applyTheme() {
  const L = LOOKS[S.theme] || LOOKS.day; renderer.toneMappingExposure = L.exposure; scene.fog = new THREE.Fog(L.fog, 300, 1400); hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2] * 0.9; sun.color.set(L.sun[0]); sun.intensity = L.sun[1] * 0.9;
  const d = new THREE.Vector3(...L.sun[2]).normalize(); sun.position.copy(C0).addScaledVector(d, 220); snowU.value = L.snow; groundMat.color.set(L.ground); ctxMat.color.set(L.ctx);
  // sky: vertical gradient as background texture
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#' + new THREE.Color(L.sky[0]).getHexString()); gr.addColorStop(0.55, '#' + new THREE.Color(L.sky[1]).getHexString()); gr.addColorStop(1, '#' + new THREE.Color(L.sky[2]).getHexString()); x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t; for (const m of lit.glass) m.emissiveIntensity = L.night ? 1.8 : 0; tram.setNight(!!L.night);
}
function setWire() { scene.traverse(o => { if (o.isMesh && o.material && (o === ground ? false : true)) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (model && model.getObjectById(o.id) || dense) m.wireframe = S.wire; }); } }); }
const _p = {}, _q = {};
function setView(v, s = S.s) {
  S.view = v; S.s = s; const TR = { nose: 3.78, length: 25.2 };
  if (v === 'cab' || v === 'chase') { controls.enabled = false; camera.fov = v === 'cab' ? 70 : 48; camera.updateProjectionMatrix(); tram.group.visible = v === 'chase' && S.tram; tram.place(track, s, 0, 1); tram.group.position.y = 0;
    if (v === 'chase') { track.at(s - (TR.length - TR.nose) - 12, _p); const rx = -Math.sin(_p.yaw), rz = Math.cos(_p.yaw); camera.position.set(_p.x + rx * 1.3, 7.0, _p.z + rz * 1.3); track.at(s + TR.nose + 32 + 9 * 1.2, _q); camera.lookAt(_q.x, 0.2, _q.z); }
    else { track.at(s + TR.nose - 0.9, _p); const rx = -Math.sin(_p.yaw), rz = Math.cos(_p.yaw); camera.position.set(_p.x - rx * 0.45, 2.4, _p.z - rz * 0.45); track.at(s + TR.nose + 60, _q); camera.lookAt(_q.x, 1.9 - 0.75, _q.z); } }
  else { // orbit0..3 around the building: from the portico (NNW), the street (SW), the courtyard (NE), the rear (SSE)
    controls.enabled = true; camera.fov = 40; camera.updateProjectionMatrix(); const k = +v.slice(5) || 0, ang = [[-62, 20], [22, -62], [22, 102], [122, 20]][k]; const p = toWorld(ang[0], ang[1], 0); camera.position.set(p[0], 26, p[2]); controls.target.copy(C0).setY(12); camera.position.sub(controls.target).multiplyScalar(1).add(controls.target); camera.lookAt(controls.target); tram.group.visible = false; controls.update(); }
}
window.__v = { S, ready: false, ctxToggle(on) { ctxGroup.visible = on; }, THREE, scene, camera, renderer, track, set: async (o) => { const need = ('model' in o && o.model !== S.model) || ('lod' in o && o.lod !== S.lod); Object.assign(S, o); if (need) await loadModel(); applyTheme(); setWire(); if (o.view || o.s !== undefined) setView(S.view, S.s); renderer.render(scene, camera); },
  size(w, h) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }, orbit(p, t, fov = 40) { controls.enabled = false; camera.fov = fov; camera.updateProjectionMatrix(); camera.position.set(...p); camera.lookAt(...t); controls.target.set(...t); tram.group.visible = false; renderer.render(scene, camera); },
  info() { const r = renderer.info; return { calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, textures: r.memory.textures }; }, render() { renderer.render(scene, camera); } };
await loadModel(); applyTheme(); setWire(); setView(S.view, S.s); camera.aspect = S.w / S.h; camera.updateProjectionMatrix(); setView(S.view, S.s);
// UI
const ui = document.getElementById('ui'); const row = (label, items, cur, f) => { const d = document.createElement('div'); d.innerHTML = `<b>${label}</b> `; items.forEach(([k, t]) => { const b = document.createElement('button'); b.textContent = t; if (String(k) === String(cur())) b.className = 'on'; b.onclick = async () => { await f(k); build(); }; d.appendChild(b); }); return d; };
function build() { ui.innerHTML = ''; ui.append(row('model', [['hybrid', 'hybrid (c)'], ['param', 'parametric (b)'], ['bake', 'proxy+bake (a)'], ['ref', 'reality mesh'], ['none', 'none']], () => S.model, k => window.__v.set({ model: k })),
  row('LOD', [[0, 'LOD0'], [1, 'LOD1'], [2, 'LOD2']], () => S.lod, k => window.__v.set({ lod: k })), row('light', [['day', 'day'], ['evening', 'evening'], ['winter', 'winter']], () => S.theme, k => window.__v.set({ theme: k })), row('wire', [[0, 'off'], [1, 'on']], () => +S.wire, k => window.__v.set({ wire: !!+k })),
  row('view', [['orbit0', 'portico'], ['orbit1', 'street'], ['orbit2', 'NE'], ['orbit3', 'rear'], ['cab', 'tram cab'], ['chase', 'tram chase']], () => S.view, k => window.__v.set({ view: k })), row('tram s', [[1240, '1240'], [1290, '1290'], [1330, '1330'], [1380, '1380']], () => S.s, k => window.__v.set({ s: +k, view: S.view === 'cab' || S.view === 'chase' ? S.view : 'chase' })));
  const i = document.createElement('div'); i.id = 'info'; ui.appendChild(i); }
if (!Q.get('noui')) { build(); (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); const i = document.getElementById('info'); if (i) { const r = window.__v.info(); i.textContent = `calls ${r.calls}  tris ${r.tris}  tex ${r.textures}`; } })(); } else document.getElementById('ui').remove();
window.__v.ready = true; renderer.render(scene, camera);
