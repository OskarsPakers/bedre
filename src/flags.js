// 18 November: many Latvian flags (carmine red #9E3039, white stripe = 1/5 of the height: proportions 2:1:2, flag 1:2) on rooftops,
// hung on facades, and on poles along the riverside / around the Freedom Monument. Two instanced meshes (poles + banners), a shared
// waving shader driven by the theme clock. Flags belong to their building: swallowed -> gone; free poles vanish when a hole covers them.
import * as THREE from 'three';
import { themeUniforms } from './themeUniforms.js';
import { pointInPoly } from './geo.js';
import { zoneOf } from './buildings.js';
import { mulberry32 } from './rng.js';

export const FLAG_RED = 0x9e3039;
const RED = new THREE.Color(FLAG_RED), WHITE = new THREE.Color(0xf4f1ea), POLE = new THREE.Color(0xc9c4b6), GOLD = new THREE.Color(0xd9b24a);

/** cloth strips (x: 0..len, y: 0..H); stripes along the length: red 2/5, white 1/5, red 2/5 of the height */
function cloth(g, x0, y0, len, H, vertical) {
  const segs = 8;
  const strips = [[0, 0.4, RED], [0.4, 0.6, WHITE], [0.6, 1, RED]];
  for (const [a, b, col] of strips) {
    const base = g.pos.length / 3;
    for (let r = 0; r <= 1; r++) for (let i = 0; i <= segs; i++) {
      const u = i / segs, v = r ? b : a;
      if (vertical) g.pos.push(x0 + v * H, y0 + (1 - u) * len, 0); else g.pos.push(x0 + u * len, y0 + v * H, 0);
      g.col.push(col.r, col.g, col.b); g.nrm.push(0, 0, 1);
    }
    for (let i = 0; i < segs; i++) { const p = base + i, q = base + segs + 1 + i; g.idx.push(p, q, p + 1, p + 1, q, q + 1); }
  }
}
function cyl(g, r, h, y, col, seg = 6) {
  const base = g.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    g.pos.push(c * r, y, s * r, c * r, y + h, s * r); g.nrm.push(c, 0, s, c, 0, s); g.col.push(col.r, col.g, col.b, col.r, col.g, col.b);
  }
  for (let i = 0; i < seg; i++) { const a = base + i * 2; g.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
}
function build(fn) {
  const g = { pos: [], col: [], nrm: [], idx: [] };
  fn(g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
  geo.setIndex(g.idx);
  return geo;
}

function makeMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x000000 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThemeTime = themeUniforms.uThemeTime; shader.uniforms.uFlagK = FLAG_K;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uThemeTime;\nuniform float uFlagK;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
transformed.z += sin(position.x * 3.2 - uThemeTime * 4.2 + ph) * 0.085 * max(position.x, 0.0);
transformed *= uFlagK;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.62;');
  };
  mat.customProgramCacheKey = () => 'festive-flag';
  return mat;
}
const BANNER_MAT_KEY = 'festive-banner';
function makeBannerMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x000000 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThemeTime = themeUniforms.uThemeTime; shader.uniforms.uFlagK = FLAG_K;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uThemeTime;\nuniform float uFlagK;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
transformed.z += sin(position.y * 2.4 + uThemeTime * 2.6 + ph) * 0.05 * (1.0 - position.y / 3.0);
transformed *= uFlagK;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.62;');
  };
  mat.customProgramCacheKey = () => BANNER_MAT_KEY;
  return mat;
}

const FLAG_K = { value: 1 }; // flags grow with camera distance so they stay noticeable when zoomed out
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class FestiveFlags {
  constructor(scene, world, { shore = [] } = {}) {
    this.world = world;
    this.items = []; // {mesh, i, o|null, x, z, r, dead}
    this.density = 1;
    // upright flag on a pole: pole 6 m, cloth 1.2 x 2.4 at the top
    const poleGeo = build((g) => { cyl(g, 0.06, 6.2, 0, POLE); cyl(g, 0.1, 0.22, 6.2, GOLD, 5); cloth(g, 0.07, 4.9, 2.4, 1.2, false); });
    // banner hung on a facade: 1.4 wide (stripes run vertically for a hung flag), 2.8 high
    const bannerGeo = build((g) => { cloth(g, -0.7, 0, 2.8, 1.4, true); });
    this.poleMesh = null; this.bannerMesh = null;
    this._build(scene, world, shore, poleGeo, bannerGeo);
  }

  _build(scene, world, shore, poleGeo, bannerGeo) {
    const rng = mulberry32(1918);
    const poles = [], banners = [];
    const free = (x, z, r) => world.blockers.free(x, z, r);
    // ---- rooftop flags + facade banners on buildings (old town + centre first, public buildings always)
    const items = world.buildingItems;
    const cand = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.ring || it.ring.length < 3 || it.h < 7 || it.area < 90) continue;
      const zone = zoneOf(it.x, it.z);
      const w = (it.t === 'pub' ? 3 : 0) + (zone === 'old' ? 1.6 : zone === 'centre' ? 1.0 : 0.25) + (it.landmark ? 3 : 0) + rng() * 1.2;
      cand.push([w, i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (const [, i] of cand) {
      if (poles.length >= 150 && banners.length >= 150) break;
      const it = items[i], o = world.objects[i];
      // longest edge
      let be = null, bl = 0;
      for (let k = 0; k < it.ring.length; k++) {
        const [x0, z0] = it.ring[k], [x1, z1] = it.ring[(k + 1) % it.ring.length];
        const l = Math.hypot(x1 - x0, z1 - z0);
        if (l > bl) { bl = l; be = [x0, z0, x1, z1]; }
      }
      if (!be || bl < 5) continue;
      const dx = be[2] - be[0], dz = be[3] - be[1];
      let nx = dz / bl, nz = -dx / bl;
      const mx = (be[0] + be[2]) / 2, mz = (be[1] + be[3]) / 2;
      if (pointInPoly(mx + nx * 0.6, mz + nz * 0.6, it.ring)) { nx = -nx; nz = -nz; }
      if (banners.length < 150 && rng() < 0.85) {
        const h = Math.min(it.h, 40), y = Math.max(2.6, Math.min(h * 0.45, 9));
        banners.push({ o, x: mx + nx * 0.14, y, z: mz + nz * 0.14, yaw: Math.atan2(nx, nz), s: 1.35 + rng() * 0.35 });
      }
      if (poles.length < 150 && rng() < 0.75) {
        // roof corner flag at a polygon vertex (or on the long edge when tiny)
        let vi = Math.floor(rng() * it.ring.length);
        if (it.cornerH && it.cornerH.length > 3) { // churches: never plant a flag on a tower / spire flank (corner heights far above the median eave); pick another corner
          const srt = Array.from(it.cornerH).sort((a, b) => a - b), med = srt[srt.length >> 1];
          for (let t = 0; t < it.ring.length && it.cornerH[vi] > med * 1.5 + 5; t++) vi = (vi + 1) % it.ring.length;
        }
        const v = it.ring[vi];
        // stand the pole on the roof AT THAT CORNER: it.h is the highest point of the building (spire, dome), not the eave
        const roofY = it.cornerH ? it.cornerH[vi] - 0.15 : it.h * 0.96;
        const s = roofY > 30 ? 2.0 : 1.5;
        poles.push({ o, x: v[0] + (it.x - v[0]) * 0.08, y: roofY, z: v[1] + (it.z - v[1]) * 0.08, yaw: Math.atan2(-nz, nx) + (rng() - 0.5) * 0.8, s });
      }
    }
    // ---- free poles along the riverside promenade and around the Freedom Monument
    const addFree = (x, z, s = 1.6) => { if (free(x, z, 0.6)) poles.push({ o: null, x, z, y: 0, yaw: rng() * 6.28, s, r: 1.2 }); };
    for (let i = 0; i < shore.length; i += 7) addFree(shore[i][0] + (rng() - 0.5), shore[i][1] + (rng() - 0.5));
    const fm = world.objects.find((o) => o.kind === 'freedom');
    if (fm) for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + 0.2; addFree(fm.x + Math.cos(a) * 22, fm.z + Math.sin(a) * 22, 1.9); }
    // ---- meshes
    const mk = (geo, mat, list) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((f, i) => {
        _p.set(f.x, f.y, f.z); _q.setFromAxisAngle(_up, f.yaw); _s.setScalar(f.s);
        _m.compose(_p, _q, _s); m.setMatrixAt(i, _m);
        f.mesh = m; f.i = i; f.dead = false; f.shown = true; f.mat = _m.clone();
        this.items.push(f);
      });
      m.instanceMatrix.needsUpdate = true;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.poleMesh = mk(poleGeo, makeMaterial(), poles);
    this.bannerMesh = mk(bannerGeo, makeBannerMaterial(), banners);
    this.counts = { poles: poles.length, banners: banners.length };
    this._t = 0;
    this._dirty = new Set();
  }

  setActive(on, density = 1, level = 2) {
    this.on = on; this.density = density * (level === 0 ? 0.45 : 1);
    this.poleMesh.visible = this.bannerMesh.visible = on;
    this._t = 0; this.sync(true);
  }

  clearDead() { for (const f of this.items) f.dead = false; this.sync(true); }

  /** hide flags whose building is gone / whose pole a hole covers (4 Hz) */
  sync(force = false) {
    if (!this.on) return;
    const holes = this.world.holesRef ? this.world.holesRef() : null;
    const dirty = this._dirty; dirty.clear();
    const N = this.items.length;
    for (let n = 0; n < N; n++) {
      const f = this.items[n];
      if (!f.dead) {
        if (f.o) { if (f.o.state !== 0) f.dead = true; }
        else if (holes) {
          for (let h = 0; h < holes.length; h++) {
            const H = holes[h];
            if (!H.alive) continue;
            const dx = H.x - f.x, dz = H.z - f.z, rr = H.radius + f.r;
            if (dx * dx + dz * dz < rr * rr) { f.dead = true; break; }
          }
        }
      }
      // density: deterministic thinning by instance index
      const thin = ((f.i * 0.6180339) % 1) >= this.density;
      const show = !f.dead && !thin;
      if (show !== f.shown || force) {
        f.shown = show;
        f.mesh.setMatrixAt(f.i, show ? f.mat : _zero);
        dirty.add(f.mesh);
      }
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
  }

  update(dt, camDist = 60) {
    if (!this.on) return;
    FLAG_K.value = Math.max(1, Math.min(3.4, 0.45 + camDist / 75));
    this._t -= dt;
    if (this._t <= 0) { this._t = 0.25; this.sync(); }
  }
}
