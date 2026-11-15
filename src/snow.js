// Falling snow: GPU-animated points in a box that follows the camera focus (one draw call, zero per-frame CPU beyond a few uniforms).
// Flakes are static seeds in [0,1)^3; the vertex shader drifts + wraps them. Off at the `low` quality tier.
import * as THREE from 'three';

const COUNTS = [0, 1500, 3000];
const MAXN = COUNTS[2];
const VERT = `
attribute vec2 aSeed;
uniform vec3 uCenter; uniform vec3 uBox; uniform float uTime; uniform float uScale; uniform float uSize;
varying float vA;
void main() {
  vec3 s = position;
  float sp = 1.1 + aSeed.x * 1.3;
  vec3 p;
  p.y = mod(s.y * uBox.y - sp * uTime * 0.9, uBox.y);
  float sway = sin(uTime * (0.6 + aSeed.y) + s.x * 20.0) * 0.8;
  p.x = s.x * uBox.x + (0.9 + sway) * uTime * 0.6;
  p.z = s.z * uBox.x + cos(uTime * (0.5 + aSeed.x) + s.z * 20.0) * 0.7 + uTime * 0.25;
  p.x = mod(p.x - uCenter.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5 + uCenter.x;
  p.z = mod(p.z - uCenter.z + uBox.x * 0.5, uBox.x) - uBox.x * 0.5 + uCenter.z;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.6 + aSeed.y * 0.9);
  gl_PointSize = clamp(sz * uScale / max(0.1, -mv.z), 1.6, 14.0);
  vA = 0.85 * smoothstep(0.0, 0.05 * uBox.y, p.y);
}`;
const FRAG = `
varying float vA;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(p));
  if (a * vA < 0.02) discard;
  gl_FragColor = vec4(0.95, 0.97, 1.0, a * vA);
  #include <colorspace_fragment>
}`;

export class Snow {
  constructor(scene) {
    const seed = new Float32Array(MAXN * 3), aSeed = new Float32Array(MAXN * 2);
    for (let i = 0; i < MAXN; i++) {
      seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random();
      aSeed[i * 2] = Math.random(); aSeed[i * 2 + 1] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 2));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(100, 60, 100) }, uTime: { value: 0 }, uScale: { value: 800 }, uSize: { value: 0.1 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      this.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    scene.add(this.points);
    this.on = false; this.level = 2;
  }

  setActive(on, level) {
    this.on = on; this.level = level;
    const n = on ? COUNTS[level] : 0;
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
  }

  update(time, focus, dist) {
    if (!this.points.visible) return;
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uCenter.value.set(focus.x, 0, focus.z);
    const w = Math.max(24, dist * 2.4);
    u.uBox.value.set(w, Math.max(20, dist * 1.25), w);
    u.uSize.value = Math.max(0.06, dist * 0.0075);
  }
}
