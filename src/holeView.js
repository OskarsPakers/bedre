// Visuals for holes: shared shader uniforms (ground discard + rim), shaft meshes.
import * as THREE from 'three';
import { CFG } from './config.js';

export const holeUniforms = {
  uHoles: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Vector3(0, 0, 0)) },
  uHoleCol: { value: Array.from({ length: CFG.hole.maxHoles }, () => new THREE.Color(1, 1, 1)) },
  uDetail: { value: 1 },
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
uniform float uDetail;
uniform sampler2D uDetMap;
uniform vec4 uDetRect;
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
    float d = distance(vWXZ, h.xy) - h.z;
    float rim = h.z * 0.06 + 0.12;
    float ring = 1.0 - smoothstep(rim * 0.55, rim, d);
    float ao = 1.0 - smoothstep(0.0, h.z * 0.4 + 0.6, d);
    diffuseColor.rgb *= 1.0 - 0.38 * ao * (1.0 - ring);
    diffuseColor.rgb = mix(diffuseColor.rgb, uHoleCol[i], ring * 0.92);
  }
}`);
  };
  mat.customProgramCacheKey = () => 'ground-hole' + (detail ? 'D' : '') + (detailMap ? 'M' : '');
  return mat;
}

function makeShaftGeometry() {
  const seg = 10;
  const g = new THREE.CylinderGeometry(1, 1, 1, 40, seg, true);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x3a2a26), bot = new THREE.Color(0x000000);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) + 0.5); // 0 top, 1 bottom
    c.copy(top).lerp(bot, Math.pow(t, 0.55));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class HoleViews {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = makeShaftGeometry();
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    this.floorGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    this.pool = [];
  }

  _get(i) {
    if (!this.pool[i]) {
      const shaft = new THREE.Mesh(this.geo, this.mat);
      const floor = new THREE.Mesh(this.floorGeo, this.floorMat);
      shaft.frustumCulled = false; floor.frustumCulled = false;
      shaft.renderOrder = -1;
      this.group.add(shaft, floor);
      this.pool[i] = { shaft, floor };
    }
    return this.pool[i];
  }

  /** Sync uniforms and shaft meshes from the holes array. */
  update(holes) {
    for (let i = 0; i < N; i++) {
      const h = holes[i];
      const u = holeUniforms.uHoles.value[i];
      if (h && h.alive) {
        u.set(h.x, h.z, h.radius);
        const col = holeUniforms.uHoleCol.value[i].copy(h.color);
        if (h.protectT > 0 && Math.floor(h.protectT * 7) % 2 === 0) col.lerp(WHITE, 0.85); // blinking spawn protection
        const v = this._get(i);
        const depth = h.radius * 1.4 + 6;
        const r = h.radius * 0.999;
        v.shaft.visible = v.floor.visible = true;
        v.shaft.position.set(h.x, -depth / 2, h.z);
        v.shaft.scale.set(r, depth, r);
        v.floor.position.set(h.x, -depth, h.z);
        v.floor.scale.set(r, 1, r);
      } else {
        u.set(0, 0, 0);
        if (this.pool[i]) this.pool[i].shaft.visible = this.pool[i].floor.visible = false;
      }
    }
  }
}
