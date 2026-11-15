// Juice: pooled dust / debris / sparkle particles (one THREE.Points draw call), growth dust ring, camera shake impulse.
import * as THREE from 'three';
import { LIFE } from './config.js';
import { bus } from './events.js';

/** Camera shake offsets, in units of 1% of camera distance (camera.js multiplies). Read-only for others. */
export const camShake = { x: 0, y: 0, z: 0, amp: 0 };
export function addShake(a) { camShake.amp = Math.min(LIFE.fx.shakeMax, camShake.amp + a); }

const VERT = `
attribute float aSize; attribute float aAlpha; attribute float aSoft; attribute vec3 aColor;
uniform float uScale;
varying float vA; varying float vSoft; varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 220.0);
  vA = aAlpha; vSoft = aSoft; vC = aColor;
}`;
const FRAG = `
varying float vA; varying float vSoft; varying vec3 vC;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float soft = smoothstep(1.0, 0.15, d);
  float hard = step(max(abs(p.x), abs(p.y)), 0.42);
  float a = vA * mix(hard, soft, vSoft);
  if (a < 0.01) discard;
  vec3 c = vC * (0.82 + 0.3 * (0.5 - p.y));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color();

export class Effects {
  constructor(scene) {
    const N = LIFE.fx.maxParticles;
    this.N = N;
    this.next = 0;
    this.high = 0;
    this.alive = 0;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.soft = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);       // remaining
    this.max = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    const mk = (arr, n, name) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk(this.pos, 3, 'position'); this.aCol = mk(this.col, 3, 'aColor');
    this.aSize = mk(this.size, 1, 'aSize'); this.aAlpha = mk(this.alpha, 1, 'aAlpha'); this.aSoft = mk(this.soft, 1, 'aSoft');
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uScale: { value: 800 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      const h = renderer.domElement.height;
      this.mat.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    scene.add(this.points);

    // growth rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      m.visible = false; m.renderOrder = 4; m.userData = { t: 1, r: 1 };
      scene.add(m); this.rings.push(m);
    }
    this.spawned = 0;     // stats (tests)
    this._t = 0;
    this._lastBig = 0;

    bus.on('swallow', (o, hole) => this.onSwallow(o, hole));
    bus.on('landed', (o, hole) => this.onLanded(o, hole));
    bus.on('levelUp', ({ hole }) => this.levelRing(hole));
  }

  emit(x, y, z, vx, vy, vz, size0, size1, life, alpha, soft, r, g, b, grav = 0, drag = 0) {
    const i = this.next;
    this.next = (i + 1) % this.N;
    if (i >= this.high) this.high = i + 1;
    if (this.life[i] <= 0) this.alive++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.s0[i] = size0; this.s1[i] = size1; this.max[i] = this.life[i] = life; this.a0[i] = alpha;
    this.soft[i] = soft; this.grav[i] = grav; this.drag[i] = drag;
    this.size[i] = size0; this.alpha[i] = alpha;
    this.spawned++;
  }

  /** soft dust puffs at ground position */
  dustAt(x, z, y, spread, count, hex = 0xcfc4b0, power = 1) {
    _c.setHex(hex);
    for (let n = 0; n < count; n++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * spread;
      this.emit(x + Math.cos(a) * r, y + Math.random() * 0.8, z + Math.sin(a) * r,
        Math.cos(a) * 0.8 * power, (0.8 + Math.random() * 1.8) * power, Math.sin(a) * 0.8 * power,
        1.2 + Math.random() * 1.5, 3.5 + Math.random() * 4, 0.9 + Math.random() * 0.9, 0.5, 1,
        _c.r * (0.9 + Math.random() * 0.15), _c.g * (0.9 + Math.random() * 0.15), _c.b * (0.9 + Math.random() * 0.15), -0.3, 1.2);
    }
  }

  onSwallow(o, hole) {
    if (o.isBuilding) {
      const fit = o.fit, n = Math.min(70, Math.max(10, Math.round(fit * 1.6)));
      let dx = hole.x - o.x, dz = hole.z - o.z;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const wall = new THREE.Color(o.wallCol ?? 0xd8cdb4);
      const dust = wall.clone().lerp(new THREE.Color(0xe2dccf), 0.7);
      const sc = Math.min(2.2, 0.6 + fit / 14);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * fit * 0.95;
        const up = (1 + Math.random() * 3.5) * (0.7 + Math.min(1, o.h / 30));
        this.emit(o.x + Math.cos(a) * r, 0.4 + Math.random() * Math.min(o.h * 0.4, 8), o.z + Math.sin(a) * r,
          Math.cos(a) * 1.2 + dx * 2.5, up, Math.sin(a) * 1.2 + dz * 2.5,
          (1.5 + Math.random() * 2.2) * sc, (5 + Math.random() * 6) * sc, 1.3 + Math.random() * 1.3, 0.8, 1,
          dust.r * (0.92 + Math.random() * 0.14), dust.g * (0.92 + Math.random() * 0.14), dust.b * (0.92 + Math.random() * 0.14), -0.5, 1.0);
      }
      // debris chunks
      const nd = Math.round(n * 0.7);
      for (let i = 0; i < nd; i++) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * fit * 0.8;
        const k = Math.random();
        _c.copy(k < 0.55 ? wall : _c.setHex(k < 0.8 ? 0xa8503a : 0x6b625a)).multiplyScalar(0.8 + Math.random() * 0.3);
        const sp = 2 + Math.random() * 5;
        this.emit(o.x + Math.cos(a) * r, 1 + Math.random() * Math.min(o.h * 0.5, 10), o.z + Math.sin(a) * r,
          Math.cos(a) * sp * 0.6 + dx * 3, 2 + Math.random() * 6, Math.sin(a) * sp * 0.6 + dz * 3,
          0.35 + Math.random() * 0.5, 0.25, 0.9 + Math.random() * 0.8, 1, 0,
          _c.r, _c.g, _c.b, 14, 0.2);
      }
      if (hole.isPlayer) {
        const now = this._t;
        addShake(LIFE.fx.shakeBuilding * Math.min(1, Math.max(0.12, fit / 22)) * (now - this._lastBig < 0.15 ? 0.5 : 1));
        this._lastBig = now;
      }
    } else if (o.cls === 'tree') {
      // leaves
      _c.setHex(0x86b05a);
      for (let i = 0; i < 4; i++) this.emit(o.x + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, o.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.4, 0.3, 0.8, 1, 0, _c.r, _c.g * (0.9 + Math.random() * 0.2), _c.b, 4, 0.5);
    } else {
      // sparkle
      const n = o.cls === 'person' ? 3 : Math.min(8, 3 + Math.round(o.fit));
      const big = Math.min(1.6, 0.6 + o.fit * 0.25);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283;
        this.emit(o.x, 0.5 + Math.random() * Math.min(o.h * 0.6, 2), o.z, Math.cos(a) * 1.4, 1.6 + Math.random() * 2, Math.sin(a) * 1.4,
          0.35 * big, 0.08, 0.45 + Math.random() * 0.3, 1, 1, 1, 0.93 + Math.random() * 0.07, 0.55 + Math.random() * 0.3, -1.5, 1.5);
      }
    }
  }

  onLanded(o, hole) {
    if (o.isBuilding) {
      const a = Math.atan2(o.sz - hole.z, o.sx - hole.x);
      this.dustAt(hole.x + Math.cos(a) * hole.radius * 0.8, hole.z + Math.sin(a) * hole.radius * 0.8, 0.3, Math.min(hole.radius * 0.4, o.fit * 0.5), Math.min(10, 3 + Math.round(o.fit / 4)), 0xcfc6b6, 1.4);
    }
  }

  levelRing(hole) {
    const m = this.rings.find((r) => r.userData.t >= 1) || this.rings[0];
    m.userData.t = 0; m.userData.r = hole.radius; m.userData.x = hole.x; m.userData.z = hole.z; m.userData.hole = hole;
    m.visible = true;
    _c.setHex(0xe7ddc6);
    const n = LIFE.fx.ringDust ? 44 : 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.1, r0 = hole.radius * 1.08;
      const sp = 3 + hole.radius * 0.9 + Math.random() * 2;
      this.emit(hole.x + Math.cos(a) * r0, 0.25, hole.z + Math.sin(a) * r0, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp,
        0.8 + hole.radius * 0.12, 2.5 + hole.radius * 0.35, 0.9 + Math.random() * 0.4, 0.5, 1, _c.r, _c.g, _c.b, -0.2, 2.2);
    }
    if (hole.isPlayer) addShake(0.45);
  }

  update(dt) {
    this._t += dt;
    // camera shake
    const s = camShake;
    if (s.amp > 0.002) {
      const t = this._t * 47;
      s.x = Math.sin(t * 1.31) * s.amp; s.y = Math.sin(t * 1.73 + 1.3) * s.amp * 0.6; s.z = Math.sin(t * 1.07 + 2.1) * s.amp;
      s.amp *= Math.exp(-5.5 * dt);
    } else { s.amp = 0; s.x = s.y = s.z = 0; }
    // rings
    for (const m of this.rings) {
      const u = m.userData;
      if (u.t >= 1) { if (m.visible) m.visible = false; continue; }
      u.t = Math.min(1, u.t + dt / 0.75);
      const e = 1 - Math.pow(1 - u.t, 3);
      const sc = u.r * (1.05 + e * 2.2);
      m.scale.set(sc, 1, sc);
      m.position.set(u.hole ? u.hole.x : u.x, 0.22, u.hole ? u.hole.z : u.z);
      m.material.opacity = 0.55 * (1 - u.t) * (1 - u.t);
    }
    // particles
    if (this.alive <= 0) return;
    let alive = 0, hi = 0;
    const { pos, vel, life, max, size, alpha, s0, s1, a0, grav, drag } = this;
    for (let i = 0; i < this.high; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; continue; }
      const k = i * 3, u = 1 - life[i] / max[i];
      const d = Math.exp(-drag[i] * dt);
      vel[k] *= d; vel[k + 2] *= d; vel[k + 1] = vel[k + 1] * d - grav[i] * dt;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      if (pos[k + 1] < 0.05 && grav[i] > 0) { pos[k + 1] = 0.05; vel[k + 1] = 0; vel[k] *= 0.5; vel[k + 2] *= 0.5; }
      size[i] = s0[i] + (s1[i] - s0[i]) * u;
      alpha[i] = a0[i] * Math.min(1, u * 10) * (1 - u) * (1 - u * 0.3);
      alive++; hi = i + 1;
    }
    this.alive = alive; this.high = hi;
    this.points.geometry.setDrawRange(0, hi);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aSoft.needsUpdate = true;
  }

  reset() {
    this.life.fill(0); this.alive = 0; this.high = 0; this.next = 0;
    this.points.geometry.setDrawRange(0, 0);
    for (const m of this.rings) { m.userData.t = 1; m.visible = false; }
    camShake.amp = camShake.x = camShake.y = camShake.z = 0;
  }
}
