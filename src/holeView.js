// Visuals for holes: shared shader uniforms (ground discard + rim), shaft meshes.
import * as THREE from 'three';
import { CFG } from './config.js';
import { SKINS, DEFAULT_SKIN, SHAPE, botSkin, hexRgb } from './skins.js';

export const holeUniforms = {
  uHoles: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Vector3(0, 0, 0)) },
  uHoleCol: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Color(1, 1, 1)) },
  uDetail: { value: 1 },
  // cosmetic skins (src/skins.js): per hole a pattern id (x), two pattern colours; the identity colour stays in uHoleCol
  uHoleS1: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Color(1, 1, 1)) },
  uHoleS2: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Color(1, 1, 1)) },
  uHoleSk: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uSkT: { value: 0 },
  uDetMap: { value: null },
  uDetRect: { value: new THREE.Vector4(0, 0, 1, 0) }, // x0, z0, size, enabled
};

const N = CFG.hole.maxHoles;
const WHITE = new THREE.Color(1, 1, 1);

/** Patch a MeshLambert/Standard material so fragments inside holes are discarded and a rim is drawn. */
export function patchGroundMaterial(mat, { detail = true, detailMap = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHoles = holeUniforms.uHoles;
    shader.uniforms.uHoleCol = holeUniforms.uHoleCol;
    shader.uniforms.uHoleS1 = holeUniforms.uHoleS1;
    shader.uniforms.uHoleS2 = holeUniforms.uHoleS2;
    shader.uniforms.uHoleSk = holeUniforms.uHoleSk;
    shader.uniforms.uSkT = holeUniforms.uSkT;
    shader.uniforms.uDetail = holeUniforms.uDetail;
    shader.uniforms.uDetMap = holeUniforms.uDetMap;
    shader.uniforms.uDetRect = holeUniforms.uDetRect;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vWXZ;
uniform vec3 uHoles[${N}];
uniform vec3 uHoleCol[${N}];
uniform vec3 uHoleS1[${N}];
uniform vec3 uHoleS2[${N}];
uniform vec4 uHoleSk[${N}];
uniform float uSkT;
uniform float uDetail;
uniform sampler2D uDetMap;
uniform vec4 uDetRect;
vec3 skinPattern(float p, float f, float u, vec3 a, vec3 b, float tm) {
  if (p < 1.5) return mix(a, b, step(0.5, fract(u * 24.0)));                                  // stripes
  if (p < 2.5) return f < 0.38 ? a : (f < 0.62 ? b : a);                                      // flag: carmine / white / carmine
  if (p < 3.5) { vec2 q = vec2(fract(u * 44.0) - 0.5, (f - 0.5) * 1.3); return length(q) < 0.36 ? b : a; }   // dots
  if (p < 4.5) { float w = sin(u * 6.2831853 * 12.0 + f * 3.2) * 0.5 + 0.5; return mix(a, b, smoothstep(0.3, 0.7, w * 0.75 + f * 0.45)); }   // waves
  if (p < 5.5) { float cx = floor(u * 40.0), cy = floor(f * 2.0); return mod(cx + cy, 2.0) < 1.0 ? a : b; }   // checker
  if (p < 6.5) return mix(a, b, 0.5 + 0.5 * sin(u * 6.2831853 * 3.0 - tm * 2.2 + f * 2.0));                // shimmer
  if (p < 7.5) { float x = fract(u * 30.0) - 0.5; return f < 0.26 + 0.46 * (1.0 - 4.0 * x * x) ? b : a; }  // scallops
  vec3 m = mix(b, a, smoothstep(0.0, 1.0, f)); return m + 0.28 * exp(-pow((f - 0.35) * 4.5, 2.0));         // polished metal
}
float bHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float bNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(bHash(i),bHash(i+vec2(1,0)),f.x), mix(bHash(i+vec2(0,1)),bHash(i+vec2(1,1)),f.x), f.y); }
`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < ${N}; i++) {
  vec3 h = uHoles[i];
  if (h.z > 0.0 && distance(vWXZ, h.xy) < h.z) discard;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${detailMap ? `{
  vec2 duv = (vWXZ - uDetRect.xy) / uDetRect.z;
  vec2 e = min(duv, 1.0 - duv);
  float w = uDetRect.w * smoothstep(0.0, 0.08, min(e.x, e.y));
  if (w > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uDetMap, vec2(duv.x, 1.0 - duv.y)).rgb, w);
}` : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${detail ? `{
  float n = bNoise(vWXZ * 1.7) * 0.6 + bNoise(vWXZ * 5.3) * 0.4;
  diffuseColor.rgb *= 0.93 + 0.12 * n * uDetail;
  // faint paving grid
  vec2 g = abs(fract(vWXZ * 0.5) - 0.5);
  float line = smoothstep(0.47, 0.5, max(g.x, g.y));
  diffuseColor.rgb *= 1.0 - 0.035 * line * uDetail;
}` : ''}
for (int i = 0; i < ${N}; i++) {
  vec3 h = uHoles[i];
  if (h.z > 0.0) {
    float sk = uHoleSk[i].x;
    float d = distance(vWXZ, h.xy) - h.z;
    float rim = (h.z * 0.06 + 0.12) * (sk > 0.5 ? 2.3 : 1.0);
    float ring = 1.0 - smoothstep(rim * (sk > 0.5 ? 0.88 : 0.55), rim, d);
    float ao = 1.0 - smoothstep(0.0, h.z * 0.4 + 0.6, d);
    diffuseColor.rgb *= 1.0 - 0.38 * ao * (1.0 - ring);
    vec3 rc = uHoleCol[i];
    if (sk > 0.5) {
      vec2 dv = vWXZ - h.xy;
      float u = atan(dv.y, dv.x) * 0.15915494 + 0.5;
      float f = clamp(d / (rim * 0.68), 0.0, 1.0);
      rc = mix(skinPattern(sk, f, u, uHoleS1[i], uHoleS2[i], uSkT), uHoleCol[i], smoothstep(0.66, 0.74, d / rim));   // pattern inside, identity colour on the outer edge
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, ring * 0.92);
  }
}`);
  };
  mat.customProgramCacheKey = () => 'ground-hole2' + (detail ? 'D' : '') + (detailMap ? 'M' : '');
  return mat;
}

function makeShaftGeometry(neutral = false) {
  const seg = 10;
  const g = new THREE.CylinderGeometry(1, 1, 1, 40, seg, true);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  // default shaft: brown -> black. Tinted skins use a neutral grey gradient that the material colour (the skin's tint) multiplies.
  const top = new THREE.Color(neutral ? 0xffffff : 0x3a2a26), bot = new THREE.Color(0x000000);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) + 0.5); // 0 top, 1 bottom
    c.copy(top).lerp(bot, Math.pow(t, 0.55));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const skinOf = (h) => h.skin || (h.isBot ? botSkin(h.id) : DEFAULT_SKIN);

// ---- ground trail: ONE instanced mesh (one draw call for every hole), a ring buffer of fading marks; position / size / age all live in
// per-instance attributes and are evaluated in the shader, so nothing is touched per frame except when a mark is spawned. Off on the low tier.
const TRAIL_MAX = 384;
class Trails {
  constructor(group) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 4), 4);   // x, z, size, birth (s)
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 4), 4);  // shape, seed, life (s), 0
    this.c1 = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    this.c2 = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    for (const a of [this.pos, this.look, this.c1, this.c2]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.pos); geo.setAttribute('aLook', this.look); geo.setAttribute('aC1', this.c1); geo.setAttribute('aC2', this.c2);
    geo.instanceCount = TRAIL_MAX;
    this.uNow = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uNow: this.uNow, uHoles: holeUniforms.uHoles },
      vertexShader: `attribute vec4 aPos; attribute vec4 aLook; attribute vec3 aC1; attribute vec3 aC2;
uniform float uNow; varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying vec4 vLook; varying float vAge; varying vec2 vW;
void main() {
  float age = clamp((uNow - aPos.w) / aLook.z, 0.0, 1.0);
  float sz = aPos.z * (0.75 + 0.55 * age);
  if (aPos.w < 0.0 || age >= 1.0) sz = 0.0;
  vec3 wp = vec3(aPos.x + position.x * sz, 0.13, aPos.y + position.z * sz);
  vUv = position.xz; vC1 = aC1; vC2 = aC2; vLook = aLook; vAge = age; vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`,
      fragmentShader: `uniform vec3 uHoles[${N}]; varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying vec4 vLook; varying float vAge; varying vec2 vW;
void main() {
  for (int i = 0; i < ${N}; i++) { vec3 h = uHoles[i]; if (h.z > 0.0 && distance(vW, h.xy) < h.z * 1.02) discard; }
  vec2 p = vUv; float len = length(p); float shape = vLook.x; float m; vec3 c = vC1;
  if (shape < 0.5) { m = smoothstep(1.0, 0.2, len) * 0.78; }                                            // puff
  else if (shape < 1.5) { m = clamp(1.0 - min(abs(p.x), abs(p.y)) * 5.0, 0.0, 1.0) * smoothstep(1.0, 0.1, len); c = mix(vC1, vC2, smoothstep(0.5, 0.0, len)); }   // spark
  else if (shape < 2.5) { m = smoothstep(0.62, 0.78, len) * (1.0 - smoothstep(0.88, 1.0, len)) * 0.9 + (1.0 - smoothstep(0.0, 0.8, len)) * 0.12; c = mix(vC1, vC2, 0.5 * len); }   // bubble
  else if (shape < 3.5) { float a = vLook.y * 6.2831853; vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p; m = (1.0 - smoothstep(0.78, 0.92, length(vec2(q.x * 1.7, q.y * 0.85)))) * 0.9; c = mix(vC1, vC2, q.y * 0.5 + 0.5); }   // petal
  else if (shape < 4.5) { float a = vLook.y * 6.2831853; vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p; float body = 1.0 - smoothstep(0.82, 0.92, length(vec2(q.x * 0.85, q.y * 1.25 + 0.15))); float cut = smoothstep(0.62, 0.7, length(q - vec2(0.0, -0.78))); m = body * cut * 0.95; c = mix(vC1, vC2, smoothstep(0.55, 0.9, len)); }   // dumpling
  else { m = smoothstep(1.0, 0.0, len) * 0.5; c = mix(vC1, vC2, 0.5 + 0.5 * sin(vLook.y * 40.0 + vAge * 3.0)); }  // glow
  m *= pow(1.0 - vAge, 1.3);
  if (m < 0.012) discard;
  gl_FragColor = vec4(c, m);
}`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -0.5;
    group.add(this.mesh);
    for (let i = 0; i < TRAIL_MAX; i++) this.pos.setW(i, -1);
    this.head = 0; this.dirty = false;
    this.last = new Map();   // hole index -> {x, z}
    this.rng = 1;
  }
  rand() { this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; return this.rng / 4294967296; }
  clear() { for (let i = 0; i < TRAIL_MAX; i++) this.pos.setW(i, -1); this.pos.needsUpdate = true; this.last.clear(); }
  /** Called for every alive hole each frame; spawns a mark behind a moving hole that wears a trail. */
  feed(key, h, item, now) {
    const lp = this.last.get(key);
    if (!lp) { this.last.set(key, { x: h.x, z: h.z, acc: 0 }); return; }
    const dx = h.x - lp.x, dz = h.z - lp.z, d = Math.hypot(dx, dz);
    lp.x = h.x; lp.z = h.z;
    if (d > h.radius * 4) { lp.acc = 0; return; }   // teleport (respawn)
    lp.acc += d;
    const step = Math.max(0.45, h.radius * (item.shape === SHAPE.spark ? 0.2 : 0.28));
    if (lp.acc < step || d < 1e-4) return;
    lp.acc = 0;
    const ux = dx / d, uz = dz / d, size = Math.max(0.6, h.radius * (item.shape === SHAPE.glow ? 0.5 : item.shape === SHAPE.spark ? 0.27 : 0.31)) * (0.8 + 0.4 * this.rand());
    const back = h.radius + size * 0.9, side = (this.rand() - 0.5) * h.radius * 0.5;
    const i = this.head; this.head = (this.head + 1) % TRAIL_MAX;
    const life = item.shape === SHAPE.glow ? 2.4 : item.shape === SHAPE.spark ? 1.15 : 1.8;
    this.pos.setXYZW(i, h.x - ux * back - uz * side, h.z - uz * back + ux * side, size, now);
    this.look.setXYZW(i, item.shape, this.rand(), life, 0);
    const a = hexRgb(item.c1), b = hexRgb(item.c2);
    this.c1.setXYZ(i, a[0], a[1], a[2]);   // raw sRGB: this ShaderMaterial writes the canvas colour directly
    this.c2.setXYZ(i, b[0], b[1], b[2]);
    this.dirty = true;
  }
  flush(now) {
    this.uNow.value = now;
    if (!this.dirty) return;
    this.dirty = false;
    this.pos.needsUpdate = this.look.needsUpdate = this.c1.needsUpdate = this.c2.needsUpdate = true;
  }
}

export class HoleViews {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = makeShaftGeometry();
    this.geoN = makeShaftGeometry(true);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    this.floorGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    this.pool = [];
    this.trails = new Trails(this.group);
    this.applied = new Map();   // hole id -> what the shader got last (tests: the rendered rim parameters of a remote hole)
    this.t0 = performance.now();
    this._qLevel = 2;
  }

  _get(i) {
    if (!this.pool[i]) {
      // one material per pooled shaft (same program: no extra draw calls) so each hole can carry its own tint
      const shaft = new THREE.Mesh(this.geo, this.mat.clone());
      const floor = new THREE.Mesh(this.floorGeo, this.floorMat.clone());
      shaft.frustumCulled = false; floor.frustumCulled = false;
      shaft.renderOrder = -1;
      this.group.add(shaft, floor);
      this.pool[i] = { shaft, floor, tint: -1 };
    }
    return this.pool[i];
  }

  /** The cosmetic parameters currently applied to a hole (by id): { rim, trail, tag, pat, c1, c2, ident, tint, trailOn } or null. */
  rimInfo(id) { return this.applied.get(id) || null; }

  clearTrails() { this.trails.clear(); }

  /** Sync uniforms and shaft meshes from the holes array. */
  update(holes) {
    const now = (performance.now() - this.t0) / 1000;
    holeUniforms.uSkT.value = now;
    let tier = 2;
    try { const q = window.__life && window.__life.quality; if (q && typeof q.level === 'number') tier = q.level; } catch { /* ignore */ }
    const trailsOn = tier > 0;
    this.trails.mesh.visible = trailsOn;
    this.applied.clear();
    for (let i = 0; i < N; i++) {
      const h = holes[i];
      const u = holeUniforms.uHoles.value[i];
      if (h && h.alive) {
        u.set(h.x, h.z, h.radius);
        const sk = skinOf(h);
        const rim = SKINS.rim[sk[0]] || SKINS.rim[0];
        const col = holeUniforms.uHoleCol.value[i].copy(h.color);
        const s1 = holeUniforms.uHoleS1.value[i], s2 = holeUniforms.uHoleS2.value[i], sv = holeUniforms.uHoleSk.value[i];
        if (rim.pat > 0) {
          const a = hexRgb(rim.c1), b = hexRgb(rim.c2);
          s1.setRGB(a[0], a[1], a[2]).convertSRGBToLinear(); s2.setRGB(b[0], b[1], b[2]).convertSRGBToLinear();
          sv.x = rim.pat;
        } else sv.x = 0;
        const blink = h.protectT > 0 && Math.floor(h.protectT * 7) % 2 === 0;
        if (blink) { col.lerp(WHITE, 0.85); if (rim.pat > 0) { s1.lerp(WHITE, 0.85); s2.lerp(WHITE, 0.85); } } // blinking spawn protection
        const v = this._get(i);
        const depth = h.radius * 1.4 + 6;
        const r = h.radius * 0.999;
        v.shaft.visible = v.floor.visible = true;
        v.shaft.position.set(h.x, -depth / 2, h.z);
        v.shaft.scale.set(r, depth, r);
        v.floor.position.set(h.x, -depth, h.z);
        v.floor.scale.set(r, 1, r);
        const tint = rim.tint || 0;
        if (v.tint !== tint) {   // only on a change: tinted skins use the neutral gradient + material colour, the default keeps the brown shaft
          v.tint = tint;
          if (tint) {
            const tc = hexRgb(tint); v.shaft.geometry = this.geoN;
            v.shaft.material.color.setRGB(tc[0], tc[1], tc[2]).convertSRGBToLinear().multiplyScalar(0.36);
            v.floor.material.color.setRGB(tc[0], tc[1], tc[2]).convertSRGBToLinear().multiplyScalar(0.05);
          } else { v.shaft.geometry = this.geo; v.shaft.material.color.setRGB(1, 1, 1); v.floor.material.color.setRGB(0, 0, 0); }
        }
        const tr = SKINS.trail[sk[1]];
        const trailOn = trailsOn && sk[1] > 0 && !!tr;
        if (trailOn && h.alive && !h.dying) this.trails.feed(i * 1000 + (h.id | 0), h, tr, now);
        this.applied.set(h.id, { rim: sk[0], trail: sk[1], tag: sk[2], pat: sv.x, c1: sv.x ? rim.c1 : 0, c2: sv.x ? rim.c2 : 0, ident: h.color.getHex(), tint, trailOn });
      } else {
        u.set(0, 0, 0);
        holeUniforms.uHoleSk.value[i].x = 0;
        if (this.pool[i]) this.pool[i].shaft.visible = this.pool[i].floor.visible = false;
      }
    }
    this.trails.flush(now);
  }
}
