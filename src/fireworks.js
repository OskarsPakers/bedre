// Fireworks: a pooled burst system simulated entirely in the vertex shader (one THREE.Points draw call, additive).
// A burst "slot" holds a rising rocket (a short trail of points) and up to SPARKS sparks, each drawn as TRAIL points that sample the
// same analytic trajectory at earlier times (so trails cost no CPU). Spawning a burst writes its slot once; nothing is touched per frame
// except two uniforms. Explosion events (flash + sound) are queued on the CPU. Quality tiers: low = no trails, fewer sparks.
import * as THREE from 'three';

const ROCKET_K = 12;       // trail points of the rising rocket
const TIERS = [            // per quality level: sparks per burst, trail points per spark, slots in the pool
  { sparks: 56, trail: 1, slots: 8 },
  { sparks: 110, trail: 3, slots: 12 },
  { sparks: 170, trail: 6, slots: 16 },
];
const MAX_VERTS = TIERS.reduce((m, t) => Math.max(m, t.slots * (ROCKET_K + t.sparks * t.trail)), 0);

const VERT = `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD;
uniform float uTime; uniform float uTrailDt; uniform float uTrailN; uniform float uScale;
varying vec4 vCol;
void main() {
  float idx = aC.w;
  float age = uTime - aA.w - idx * uTrailDt;
  float life = aB.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }
  float k = max(aD.x, 0.001);
  float e = (1.0 - exp(-k * age)) / k;
  vec3 p = aA.xyz + aB.xyz * e;
  p.y -= aD.y * (age - e) / k;
  float u = age / life;
  float tf = 1.0 - idx / max(uTrailN, 1.0);
  float seed = fract(sin(dot(aB.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float tw = 0.75 + 0.25 * sin(age * (18.0 + seed * 22.0) + seed * 30.0);
  vec3 c = aC.xyz;
  float fade;
  if (aD.w > 0.5) { // rocket
    c = vec3(1.0, 0.72, 0.38);
    fade = tf * tf * (1.0 - 0.5 * u);
  } else {
    c = mix(vec3(1.0, 0.95, 0.85), c, smoothstep(0.0, 0.14, u));
    c = mix(c, c * vec3(1.0, 0.55, 0.35), smoothstep(0.55, 1.0, u));
    fade = pow(1.0 - u, 1.4) * tf * tw * min(1.0, age * 14.0);
  }
  vCol = vec4(c, fade);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aD.z * (1.0 - 0.45 * u) * (0.45 + 0.55 * tf);
  gl_PointSize = clamp(sz * uScale / max(0.1, -mv.z), 1.5, 54.0);
}`;
const FRAG = `
varying vec4 vCol;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a;
  float core = smoothstep(0.35, 0.0, d);
  if (vCol.a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb * (1.15 + core * 1.4), min(1.0, vCol.a * a * 1.25));
  #include <colorspace_fragment>
}`;

const PAL = {
  red: new THREE.Color(0xff1f3c), white: new THREE.Color(0xffffff), gold: new THREE.Color(0xffb830),
  amber: new THREE.Color(0xff7a1a), pink: new THREE.Color(0xff5fa0), blue: new THREE.Color(0x4aa0ff), green: new THREE.Color(0x5dff8a),
};

export class Fireworks {
  constructor(scene, rng = Math.random) {
    this.rng = rng;
    this.level = 2;
    this.time = 0;
    this.enabled = false;
    this.palette = ['red', 'white', 'gold'];
    const mk = (n) => { const a = new THREE.BufferAttribute(new Float32Array(MAX_VERTS * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aA = mk(4); this.aB = mk(4); this.aC = mk(4); this.aD = mk(4);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.setAttribute('aC', this.aC); g.setAttribute('aD', this.aD);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uTrailDt: { value: 0.05 }, uTrailN: { value: 6 }, uScale: { value: 800 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      this.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    scene.add(this.points);
    this.slotEnd = new Float32Array(16);          // time at which each slot is finished
    this.next = 0;
    this.queue = Array.from({ length: 48 }, () => ({ t: 0, x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, big: 0, on: false }));
    this.onExplode = null;                        // (ev) => void
    this.onLaunch = null;                         // (x, y, z) => void
    this.stats = { bursts: 0, explosions: 0, active: 0, maxActive: 0, verts: 0 };
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this.setLevel(2);
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(2, level));
    this.tier = TIERS[this.level];
    this.slotVerts = ROCKET_K + this.tier.sparks * this.tier.trail;
    this.mat.uniforms.uTrailN.value = Math.max(1, this.tier.trail);
    this.mat.uniforms.uTrailDt.value = this.tier.trail > 1 ? 0.05 : 0;
    this.slotEnd.fill(0);
    this.geo.setDrawRange(0, 0);
    this.stats.verts = this.tier.slots * this.slotVerts;
  }

  setEnabled(on) { this.enabled = !!on; if (!on) this.reset(); }

  reset() {
    this.slotEnd.fill(0);
    for (const q of this.queue) q.on = false;
    this.points.visible = false;
    this.geo.setDrawRange(0, 0);
    this.stats.active = 0;
  }

  /** number of slots whose effect is still running */
  active() { let n = 0; for (let i = 0; i < this.tier.slots; i++) if (this.slotEnd[i] > this.time) n++; return n; }

  /**
   * Launch one rocket from (x, 0, z) that bursts at height `apex` with radius `R` metres after `delay` seconds.
   * type: 'peony' | 'ring' | 'willow' | 'glitter'. colors: palette names (1 or 2).
   */
  launch(x, z, apex, R, type = 'peony', colors = this.palette, delay = 0, vol = 1) {
    const T = this.tier, rng = this.rng;
    // pick a free slot (oldest first)
    let s = -1;
    for (let n = 0; n < T.slots; n++) { const i = (this.next + n) % T.slots; if (this.slotEnd[i] <= this.time) { s = i; break; } }
    if (s < 0) { s = this.next % T.slots; }
    this.next = (s + 1) % T.slots;
    const base = s * this.slotVerts;
    const t0 = this.time + delay, ascent = 0.85 + apex / 260 + rng() * 0.2;
    const A = this.aA.array, B = this.aB.array, C = this.aC.array, D = this.aD.array;
    // rocket: rises with air drag so it decelerates towards the apex (velocity chosen so the position at `ascent` ~ apex)
    const kr = 1.1, er = (1 - Math.exp(-kr * ascent)) / kr, vy = apex / er;
    for (let k = 0; k < ROCKET_K; k++) {
      const v = base + k, o4 = v * 4;
      A[o4] = x + (rng() - 0.5) * 0.4; A[o4 + 1] = 1; A[o4 + 2] = z + (rng() - 0.5) * 0.4; A[o4 + 3] = t0;
      B[o4] = (rng() - 0.5) * 2; B[o4 + 1] = vy; B[o4 + 2] = (rng() - 0.5) * 2; B[o4 + 3] = ascent;
      C[o4] = 1; C[o4 + 1] = 0.8; C[o4 + 2] = 0.5; C[o4 + 3] = k * 0.7;
      D[o4] = kr; D[o4 + 1] = 0; D[o4 + 2] = Math.max(0.5, R * 0.035); D[o4 + 3] = 1;
    }
    // burst centre (analytic position of the rocket at `ascent`)
    const cy = 1 + vy * er;
    const col1 = PAL[colors[Math.floor(rng() * colors.length)]] || PAL.gold;
    const col2 = PAL[colors[Math.floor(rng() * colors.length)]] || PAL.white;
    let life = 2.0 + rng() * 0.6, drag = 1.55, grav = R * 0.22, speed = R * drag * 0.92, size = Math.max(1.0, R * 0.07);
    let n = T.sparks;
    if (type === 'willow') { life = 3.4; drag = 1.7; grav = R * 0.55; speed = R * drag * 0.7; n = Math.round(n * 0.8); }
    else if (type === 'glitter') { life = 1.7; drag = 2.0; grav = R * 0.3; speed = R * drag * 0.9; size *= 0.7; }
    else if (type === 'ring') { life = 2.1; }
    // ring plane
    const nx = rng() - 0.5, ny = rng() * 0.7 + 0.3, nz = rng() - 0.5;
    const nl = Math.hypot(nx, ny, nz); const px = nx / nl, py = ny / nl, pz = nz / nl;
    // two vectors spanning the ring plane
    let ux = -pz, uy = 0, uz = px; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const vx2 = py * uz - pz * uy, vy2 = pz * ux - px * uz, vz2 = px * uy - py * ux;
    const tCount = T.trail;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      let dx, dy, dz, sp = speed * (0.78 + rng() * 0.3);
      if (type === 'ring') {
        const a = (i / n) * 6.2832 + rng() * 0.04;
        dx = Math.cos(a) * ux + Math.sin(a) * vx2; dy = Math.cos(a) * uy + Math.sin(a) * vy2; dz = Math.cos(a) * uz + Math.sin(a) * vz2;
        sp = speed * (0.92 + rng() * 0.06);
      } else {
        const yy = 1 - (i / Math.max(1, n - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), th = i * golden + rng() * 0.3;
        dx = Math.cos(th) * rr; dy = yy; dz = Math.sin(th) * rr;
      }
      const c = (type === 'peony' || type === 'ring') ? (i % 2 ? col1 : col2) : (type === 'willow' ? PAL.gold : (i % 3 ? PAL.white : col1));
      const l = life * (0.85 + rng() * 0.3);
      for (let k = 0; k < tCount; k++) {
        const v = base + ROCKET_K + i * tCount + k, o4 = v * 4;
        A[o4] = x; A[o4 + 1] = cy; A[o4 + 2] = z; A[o4 + 3] = t0 + ascent;
        B[o4] = dx * sp; B[o4 + 1] = dy * sp; B[o4 + 2] = dz * sp; B[o4 + 3] = l;
        C[o4] = c.r; C[o4 + 1] = c.g; C[o4 + 2] = c.b; C[o4 + 3] = k;
        D[o4] = drag; D[o4 + 1] = grav; D[o4 + 2] = size; D[o4 + 3] = 0;
      }
    }
    // unused tail of the slot (when the tier has fewer sparks than the buffer) is never drawn
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = this.aD.needsUpdate = true;
    this.slotEnd[s] = t0 + ascent + life * 1.15 + tCount * 0.05 + 0.1;
    this.points.visible = true;
    this.geo.setDrawRange(0, T.slots * this.slotVerts);
    // explosion event
    for (const q of this.queue) {
      if (q.on) continue;
      q.on = true; q.t = t0 + ascent; q.x = x; q.y = cy; q.z = z; q.r = col1.r; q.g = col1.g; q.b = col1.b; q.big = R; q.vol = vol;
      break;
    }
    this.stats.bursts++;
    if (this.onLaunch) this.onLaunch(x, cy, z, delay);
    return s;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const q = this.queue;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      if (e.on && this.time >= e.t) { e.on = false; this.stats.explosions++; if (this.onExplode) this.onExplode(e); }
    }
    if (this.points.visible) {
      const a = this.active();
      this.stats.active = a;
      if (a > this.stats.maxActive) this.stats.maxActive = a;
      if (a === 0) { let pend = false; for (const e of q) if (e.on) pend = true; if (!pend) { this.points.visible = false; this.geo.setDrawRange(0, 0); } }
    }
  }
}
