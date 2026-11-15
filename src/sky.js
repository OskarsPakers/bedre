// Sky dome for the evening / night themes: vertical gradient (zenith -> mid -> warm horizon), a few twinkling stars, a soft moon,
// and a firework flash tint. One draw call, follows the camera. Hidden in the day theme (scene.background colour is used instead).
import * as THREE from 'three';

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;
const FRAG = `
varying vec3 vDir;
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uBelow;
uniform float uStars; uniform float uTime; uniform vec3 uMoonDir; uniform float uMoon;
uniform vec3 uFlashCol; uniform float uFlash;
float h31(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c;
  if (h >= 0.0) {
    float a = pow(clamp(h, 0.0, 1.0), 0.4);
    c = mix(uHor, uMid, smoothstep(0.0, 0.32, a));
    c = mix(c, uTop, smoothstep(0.3, 1.0, a));
    // stars
    vec3 g = d * 160.0;
    vec3 cell = floor(g);
    float r = h31(cell);
    float star = step(0.9935, r) * smoothstep(0.0, 0.05, h);
    vec3 f = fract(g) - 0.5;
    float disc = smoothstep(0.34, 0.0, length(f));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 6.0) + r * 40.0);
    c += vec3(0.9, 0.93, 1.0) * star * disc * tw * uStars;
  } else {
    c = mix(uHor, uBelow, smoothstep(0.0, -0.06, h));
  }
  // moon
  float md = dot(d, normalize(uMoonDir));
  c += vec3(0.78, 0.84, 1.0) * (smoothstep(0.9993, 0.9998, md) * 0.9 + pow(max(md, 0.0), 90.0) * 0.18) * uMoon;
  c += uFlashCol * uFlash * (0.35 + 0.65 * (1.0 - clamp(abs(h) * 1.6, 0.0, 1.0)));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class SkyDome {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() },
      uStars: { value: 0 }, uTime: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0.4, 0.5, -0.5) }, uMoon: { value: 0 },
      uFlashCol: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** T = theme (colours as THREE.Color) */
  setTheme(T) {
    const u = this.uniforms;
    this.mesh.visible = !!T.sky;
    if (!T.sky) return;
    u.uTop.value.copy(T.sky.top); u.uMid.value.copy(T.sky.mid); u.uHor.value.copy(T.sky.horizon); u.uBelow.value.copy(T.fog);
    u.uStars.value = T.stars; u.uMoon.value = T.moon ? 1 : 0;
    u.uMoonDir.value.copy(T.sun.dir);
  }

  update(camera, time, flash, flashCol) {
    if (!this.mesh.visible) return;
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
    this.uniforms.uFlash.value = flash;
    if (flashCol) this.uniforms.uFlashCol.value.copy(flashCol);
  }
}
