// Night glow: soft additive sprites (ONE THREE.Points draw call, no real lights) for street lamps / lanterns, landmark floodlight washes,
// riverside candles (18 November) and moving vehicle headlights. Static sources are written once; vehicle headlights are rewritten
// per frame from the traffic list (no allocations). Sources vanish together with the object they belong to (swallowed -> state != 0).
import * as THREE from 'three';

const VERT = `
attribute vec4 aCol; attribute float aSize; attribute vec2 aFx;
uniform float uScale; uniform float uTime; uniform float uAlpha; uniform float uMinPx;
varying vec4 vC; varying float vSoft;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fl = 1.0 + aFx.x * sin(uTime * (7.0 + aFx.y * 5.0) + aFx.y * 40.0) * (0.6 + 0.4 * sin(uTime * 2.3 + aFx.y * 17.0));
  float px = aSize * uScale / max(0.1, -mv.z);
  float vis = aSize > 0.001 ? 1.0 : 0.0;
  gl_PointSize = vis * clamp(px, uMinPx, 140.0);
  // sub-pixel sources keep their energy: fade when the minimum size kicked in
  float k = clamp(px / uMinPx, 0.0, 1.0);
  vSoft = aCol.a < 0.0 ? 1.0 : 0.0;
  vC = vec4(aCol.rgb, abs(aCol.a) * uAlpha * fl * (0.55 + 0.45 * k) * vis);
}`;
const FRAG = `
varying vec4 vC; varying float vSoft;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  float core = a * a * a;
  if (vC.a < 0.004) discard;
  if (vSoft > 0.5) gl_FragColor = vec4(vC.rgb, vC.a * a * a);
  else gl_FragColor = vec4(vC.rgb * (0.6 + 1.6 * core), vC.a * (a * a + core));
  #include <colorspace_fragment>
}`;

const WARM = new THREE.Color(1.0, 0.7, 0.34);
const HEAD = new THREE.Color(1.0, 0.95, 0.8);
const RED = new THREE.Color(0xff2a3a), WHITE = new THREE.Color(1, 1, 1);
const CAPACITY_CANDLES = 520;
const VEH_LEN = { car: 4.6, taxi: 4.6, van: 5.2, bus: 12, trolleybus: 12, trolley: 12, tram: 25 };

export class Glow {
  constructor(scene, world) {
    this.world = world;
    this.level = 2;
    this.alphaK = 0;
    this.festive = false;
    // ---- gather sources
    this.lamps = [];     // {o, head, halo}  object + vertex indices
    this.washes = [];    // {o, v: [indices]}
    this.veh = [];       // traffic objects with headlights
    const objs = world.objects;
    const lampObjs = [], lmObjs = [];
    for (const o of objs) {
      if (o.isBuilding) { if (o.landmark && o.h > 14) lmObjs.push(o); continue; }
      if (o.kind === 'lamp' || o.kind === 'lantern') lampObjs.push(o);
      else if (o.landmark && (o.kind === 'monument' || o.kind === 'freedom' || o.kind === 'laima' || o.kind === 'pylon' || o.kind === 'railarch')) lmObjs.push(o);
      else if (o.mover && VEH_LEN[o.kind] && o.moverM) this.veh.push(o);
    }
    this.nLamp = lampObjs.length * 2;
    this.nWash = lmObjs.length * 2;
    this.nCandle = CAPACITY_CANDLES;
    this.nVeh = this.veh.length * 2;
    const N = this.N = this.nLamp + this.nWash + this.nCandle + this.nVeh;
    this.iLamp = 0; this.iWash = this.nLamp; this.iCandle = this.iWash + this.nWash; this.iVeh = this.iCandle + this.nCandle;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N); this.fx = new Float32Array(N * 2);
    this.baseSize = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize);
    g.setAttribute('aFx', new THREE.BufferAttribute(this.fx, 2));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 800 }, uTime: { value: 0 }, uAlpha: { value: 1 }, uMinPx: { value: 2.2 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      this.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    scene.add(this.points);

    // lamps: bulb + halo
    let n = 0;
    for (const o of lampObjs) {
      const lan = o.kind === 'lantern';
      const hx = lan ? 0 : 0.9 * Math.cos(o.yaw) * o.s, hz = lan ? 0 : -0.9 * Math.sin(o.yaw) * o.s;
      const y = (lan ? 3.55 : 5.1) * o.s;
      const rec = { o, v: this.iLamp + n * 2 };
      for (let k = 0; k < 2; k++) {
        const v = rec.v + k;
        this.pos[v * 3] = o.x + hx; this.pos[v * 3 + 1] = y; this.pos[v * 3 + 2] = o.z + hz;
        this.col[v * 4] = WARM.r; this.col[v * 4 + 1] = WARM.g; this.col[v * 4 + 2] = WARM.b;
        this.col[v * 4 + 3] = k === 0 ? 1.0 : -0.22;
        this.baseSize[v] = k === 0 ? (lan ? 1.5 : 2.0) : (lan ? 6 : 9);
        this.fx[v * 2] = 0.04; this.fx[v * 2 + 1] = Math.random();
      }
      this.lamps.push(rec); n++;
    }
    // landmark washes
    this.washCol = [];
    n = 0;
    for (const o of lmObjs) {
      const h = Math.max(10, o.h || 20);
      const rec = { o, v: this.iWash + n * 2, h, idx: n };
      for (let k = 0; k < 2; k++) {
        const v = rec.v + k;
        this.pos[v * 3] = o.x; this.pos[v * 3 + 1] = k === 0 ? Math.min(h * 0.16, 7) : Math.min(h * 0.5, 30); this.pos[v * 3 + 2] = o.z;
        this.col[v * 4 + 3] = k === 0 ? -0.22 : -0.08;
        this.baseSize[v] = Math.min(40, Math.max(9, h * (k === 0 ? 0.6 : 0.5)));
        this.fx[v * 2] = 0; this.fx[v * 2 + 1] = 0.5;
      }
      this.washes.push(rec); n++;
    }
    this._colourWashes(false);
    // candles slots start empty
    for (let i = 0; i < this.nCandle; i++) { const v = this.iCandle + i; this.fx[v * 2] = 0.35; this.fx[v * 2 + 1] = Math.random(); this.col[v * 4] = 1.0; this.col[v * 4 + 1] = 0.62; this.col[v * 4 + 2] = 0.22; this.col[v * 4 + 3] = 0.95; }
    this.candleN = 0;
    // vehicles
    for (let i = 0; i < this.nVeh; i++) {
      const v = this.iVeh + i;
      this.col[v * 4] = HEAD.r; this.col[v * 4 + 1] = HEAD.g; this.col[v * 4 + 2] = HEAD.b; this.col[v * 4 + 3] = 0.85;
      this.fx[v * 2] = 0; this.fx[v * 2 + 1] = Math.random();
    }
    this.aCol.needsUpdate = true;
    this._sync = 0;
    this.applyLevel();
  }

  _colourWashes(festive) {
    const c = this.col;
    for (const w of this.washes) {
      let col = WARM;
      if (festive) col = (w.idx % 3 === 1) ? WHITE : RED;
      for (let k = 0; k < 2; k++) { const v = w.v + k; c[v * 4] = col.r; c[v * 4 + 1] = col.g; c[v * 4 + 2] = col.b; }
    }
    this.aCol.needsUpdate = true;
  }

  /** 18 November: red / white / red floodlight on the landmarks */
  setFestive(on) { if (on !== this.festive) { this.festive = on; this._colourWashes(on); } }

  /** riverside candles: array of [x, z] */
  setCandles(list) {
    const n = Math.min(list.length, this.nCandle);
    for (let i = 0; i < this.nCandle; i++) {
      const v = this.iCandle + i;
      if (i < n) { this.pos[v * 3] = list[i][0]; this.pos[v * 3 + 1] = 0.55; this.pos[v * 3 + 2] = list[i][1]; this.baseSize[v] = 0.9; }
      else this.baseSize[v] = 0;
      this.size[v] = this.baseSize[v];
    }
    this.candleN = n;
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true;
  }

  /** a = overall glow factor (0 = off .. 1), level = quality tier */
  setTheme(a, level) {
    this.alphaK = a;
    this.mat.uniforms.uAlpha.value = a;
    this.points.visible = a > 0.01;
    this.level = level;
    this._syncStatic();
  }

  setLevel(level) { if (level !== this.level) { this.level = level; this._syncStatic(); } }
  applyLevel() { this._syncStatic(); }

  /** show/hide static sources according to quality tier and whether their object still stands */
  _syncStatic() {
    const sz = this.size, bs = this.baseSize;
    const low = this.level === 0;
    for (let i = 0; i < this.lamps.length; i++) {
      const r = this.lamps[i], alive = r.o.state === 0;
      const show = alive && !(low && (i & 1));
      sz[r.v] = show ? bs[r.v] : 0;
      sz[r.v + 1] = show && !low ? bs[r.v + 1] : 0;
    }
    for (const w of this.washes) {
      const alive = w.o.state === 0;
      sz[w.v] = alive ? bs[w.v] : 0; sz[w.v + 1] = alive && !low ? bs[w.v + 1] : 0;
    }
    for (let i = 0; i < this.nCandle; i++) { const v = this.iCandle + i; sz[v] = i < this.candleN ? bs[v] : 0; }
    this.aSize.needsUpdate = true;
  }

  update(dt, time) {
    if (!this.points.visible) return;
    this.mat.uniforms.uTime.value = time;
    this._sync -= dt;
    if (this._sync <= 0) { this._sync = 0.25; this._syncStatic(); }
    // vehicle headlights
    const P = this.pos, S = this.size, veh = this.veh, low = this.level === 0;
    let v = this.iVeh;
    for (let i = 0; i < veh.length; i++, v += 2) {
      const o = veh[i], m = o.moverM;
      if (o.state !== 0 || (m && m.off) || (low && (i & 1))) { S[v] = 0; S[v + 1] = 0; continue; }
      const L = VEH_LEN[o.kind] * 0.5 * (o.s || 1), W = (o.kind === 'bus' || o.kind === 'trolleybus' || o.kind === 'trolley' || o.kind === 'tram' ? 0.9 : 0.62) * (o.s || 1);
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      // forward = (cos yaw, -sin yaw) in (x, z); right = (sin yaw, cos yaw)
      const fx = o.x + c * L, fz = o.z - s * L, y = (o.kind === 'tram' ? 1.3 : o.kind === 'bus' || o.kind === 'trolleybus' || o.kind === 'trolley' ? 0.9 : 0.62);
      const sz = o.kind === 'tram' ? 2.0 : 1.5;
      P[v * 3] = fx + s * W; P[v * 3 + 1] = y; P[v * 3 + 2] = fz + c * W; S[v] = sz;
      P[(v + 1) * 3] = fx - s * W; P[(v + 1) * 3 + 1] = y; P[(v + 1) * 3 + 2] = fz - c * W; S[v + 1] = sz;
    }
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true;
  }
}
