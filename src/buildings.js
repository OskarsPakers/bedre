// Building geometry (walls + roof) and a BatchedMesh holding all of them.
import * as THREE from 'three';
import { CFG, LIFE } from './config.js';
import { cleanRing, centroid, bbox, minBox, pointInPoly } from './geo.js';
import { mulberry32 } from './rng.js';
import { renderClass } from './shapes.js';
import { landmarkRule, pickCatHouse, addDeco, addCat } from './landmarks.js';
import { themeHook, GLSL_BLD_VERT_DECL, GLSL_BLD_VERT_SET, GLSL_BLD_FRAG_DECL, GLSL_BLD_WINDOWS } from './themeUniforms.js';

const _tri = [];
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

function shade(c, k) { return [c.r * k, c.g * k, c.b * k]; }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v) => Math.round(clamp01(v) * 255);

/** Accumulates indexed geometry. Vertex = position (f32) + normal (i8x4) + colour (u8x4) + window params aWin (u8x4: floorH/12, wallTop/127.5, spacing/8, frac). */
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.win = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, c, win, n) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127), 0);
    this.col.push(byte(c[0]), byte(c[1]), byte(c[2]), 255);
    this.win.push(byte(win[0] / 12), byte(win[1] / 127.5), byte(win[2] / 8), byte(win[3]));
    return i;
  }
  /** add triangle with vertex attributes; flips winding so it faces `want` normal */
  tri(a, b, c, ca, cb, cc, win, want) {
    tmpA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    tmpB.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    tmpC.crossVectors(tmpA, tmpB);
    if (tmpC.lengthSq() < 1e-10) return;
    const flip = tmpC.x * want[0] + tmpC.y * want[1] + tmpC.z * want[2] < 0;
    const i0 = this.vert(a[0], a[1], a[2], ca, win, want);
    const i1 = this.vert(b[0], b[1], b[2], cb, win, want);
    const i2 = this.vert(c[0], c[1], c[2], cc, win, want);
    if (flip) this.idx.push(i0, i2, i1); else this.idx.push(i0, i1, i2);
  }
  quad(a, b, c, d, ca, cb, cc, cd, win, want) { // a,b,c,d around the quad
    this.tri(a, b, c, ca, cb, cc, win, want);
    this.tri(a, c, d, ca, cc, cd, win, want);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(this.nor), 4, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true));
    g.setAttribute('aWin', new THREE.BufferAttribute(new Uint8Array(this.win), 4, true));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Build geometry for ring `ring` (CCW in x,z, relative to centroid), total height h.
 * Returns BufferGeometry or null.
 */
export function buildBuildingGeometry(ring, h, wallCol, roofCol, mansard, winParams, spire = null) {
  const b = new GeoBuilder();
  const n = ring.length;
  const rh = mansard ? mansard.rh : 0;
  const hw = h - rh;
  const wallTop = shade(wallCol, 1.0), wallBot = shade(wallCol, 0.78);
  const roofC = [roofCol.r, roofCol.g, roofCol.b];
  const win = [winParams.floorH, hw, winParams.spacing, winParams.frac];
  const noWin = [1, 1, 1, 0];
  // walls
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len; // outward for area > 0
    b.quad([x0, 0, z0], [x1, 0, z1], [x1, hw, z1], [x0, hw, z0], wallBot, wallBot, wallTop, wallTop, win, [nx, 0, nz]);
  }
  if (mansard) {
    const s = mansard.s;
    const inner = ring.map(([x, z]) => [x * s, z * s]);
    for (let i = 0; i < n; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
      const [u0, v0] = inner[i], [u1, v1] = inner[(i + 1) % n];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // slope normal
      const hor = (1 - s) * 0.5 * len; // rough run
      const nl = Math.hypot(rh, Math.max(0.3, hor));
      const nxz = Math.max(0.3, hor) / nl, ny = rh / nl;
      b.quad([x0, hw, z0], [x1, hw, z1], [u1, h, v1], [u0, h, v0], roofC, roofC, roofC, roofC, noWin, // one flat roof colour: shading comes from the lighting only
       
        [(dz / len) * nxz, ny, (-dx / len) * nxz]);
    }
    capTop(b, inner, h, roofC);
  } else {
    // flat roof with a thin parapet look (slightly darker cap)
    capTop(b, ring, h, roofC);
  }
  let extra = 0;
  if (spire) {
    for (const d of Array.isArray(spire) ? spire : [spire]) {
      if (d.kind === 'roof' || d.kind === 'spire') { d.wallCol = d.wallCol || wallCol; addSpire(b, d, h); extra = Math.max(extra, d.hgt); }
      else extra = Math.max(extra, addDeco(b, d, ring, h, wallCol, roofCol));
    }
  }
  if (!b.pos.length) return null;
  const g = b.geometry();
  g.userData.extraH = extra;
  return g;
}

function capTop(b, ring, h, roofC) {
  const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  for (const [i, j, k] of tris) {
    b.tri([ring[i][0], h, ring[i][1]], [ring[j][0], h, ring[j][1]], [ring[k][0], h, ring[k][1]],
      roofC, roofC, roofC, [1, 1, 1, 0], [0, 1, 0]);
  }
}

/** convex hull (x, z) of a shape record's vertices, local metres */
function shapeHull(S, rec) {
  const inv = 1 / S.q, p = [];
  for (let i = 0; i < rec.nv; i++) p.push([S.V[(rec.ov + i) * 3] * inv, S.V[(rec.ov + i) * 3 + 2] * inv]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

function convexHullArea(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  const hull = lower.concat(upper);
  let a = 0;
  for (let i = 0; i < hull.length; i++) { const [x0, z0] = hull[i], [x1, z1] = hull[(i + 1) % hull.length]; a += x0 * z1 - x1 * z0; }
  return Math.abs(a) / 2;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; }
  return a / 2;
}

export function makeBuildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    themeHook(shader); // theme.js: shared night / snow uniforms
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec4 vWin;\n' + GLSL_BLD_VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal; vWin = vec4(aWin.x * 12.0, aWin.y * 127.5, aWin.z * 8.0, aWin.w);\n' + GLSL_BLD_VERT_SET);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec4 vWin;\n' + GLSL_BLD_FRAG_DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float wall = step(abs(vLN.y), 0.25) * mix(vWin.w, 0.9, step(0.44, vWin.w) * step(vWin.w, 0.46));
  float fh = max(vWin.x, 0.5);
  float fy = vLP.y / fh;
  float ff = fract(fy);
  float u = dot(vLP.xz, vec2(-vLN.z, vLN.x)) / max(vWin.z, 0.5);
  float fu = fract(u);
  float goth = step(0.44, vWin.w) * step(vWin.w, 0.46); // gothic brick style code (frac 0.45): tall pointed-arch windows
  float archTop = mix(0.73, 0.5, goth * clamp(abs(fu - 0.45) / 0.25, 0.0, 1.0));
  float wy = smoothstep(0.2, 0.27, ff) * (1.0 - smoothstep(archTop - 0.07, archTop, ff));
  float wx = smoothstep(0.2, 0.27, fu) * (1.0 - smoothstep(0.66, 0.73, fu));
  float inside = step(fh * 0.9, vLP.y) * step(vLP.y, vWin.y - fh * 0.2);
  float win = wall * wx * wy * inside;
  vec3 glass = vec3(0.16, 0.22, 0.29) * (0.8 + 0.4 * fract(sin(floor(u) * 12.9898 + floor(fy) * 78.233) * 43758.5453));
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, 0.82 * win);
  ${GLSL_BLD_WINDOWS}
  // cornice line under roof and ground-floor plinth
  if (goth > 0.5) { // light stone trim on the red brick: plinth, floor string courses and pointed-arch window surrounds
    float archO = mix(0.78, 0.55, clamp(abs(fu - 0.45) / 0.3, 0.0, 1.0));
    float wxo = smoothstep(0.1, 0.16, fu) * (1.0 - smoothstep(0.74, 0.8, fu));
    float wyo = smoothstep(0.14, 0.2, ff) * (1.0 - smoothstep(archO - 0.05, archO, ff));
    float surr = wall * wxo * wyo * inside * (1.0 - clamp(wx * wy * 1.5, 0.0, 1.0));
    float course = wall * (step(ff, 0.045) * step(fh * 0.9, vLP.y) + step(vLP.y, 1.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.77, 0.64), clamp(0.8 * surr + 0.7 * course, 0.0, 0.8));
  }
  float cornice = wall * step(vWin.y - 0.45, vLP.y) * step(vLP.y, vWin.y);
  diffuseColor.rgb *= 1.0 - 0.1 * cornice;
}`);
  };
  mat.customProgramCacheKey = () => 'building-win4';
  return mat;
}


const RE_ADDR = /(\s\d+[A-Za-zĀ-ž]?(\s*k-\d+)?(\s*-\s*\d+)?$)|^Bez adreses/;
/** True for names that are just street addresses ("Kuģu iela 22"). */
export function isAddressName(n) { return !n || RE_ADDR.test(n); }
const RE_CHURCH = /baznīca|katedrāle|doms|sinagoga|church|cathedral|bazn/i;
const RE_TOWER = /torn/i;
const RE_MONUMENT = /piemineklis|pulkstenis/i;

/** Neighbourhood palettes: Old Town (warm, saturated) south-west of the canal, Art Nouveau centre (pastel). */
export function zoneOf(x, z) {
  const a = (x + 400) / 520, b = (z - 260) / 380;
  if (a * a + b * b < 1) return 'old';
  if (x > -150 && x < 700 && z > -900 && z < -60) return 'centre';
  return 'other';
}

function bestInterior(ring) {
  const bb = bbox(ring);
  let best = [0, 0], bd = -1;
  const cands = [[0, 0]];
  for (let i = 1; i < 7; i++) for (let j = 1; j < 7; j++) cands.push([bb.x0 + ((bb.x1 - bb.x0) * i) / 7, bb.z0 + ((bb.z1 - bb.z0) * j) / 7]);
  for (const [x, z] of cands) {
    if (!pointInPoly(x, z, ring)) continue;
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
      d = Math.min(d, Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)));
    }
    if (d > bd) { bd = d; best = [x, z]; }
  }
  return { p: best, clear: Math.max(0.5, bd) };
}

/** Append a church-style tower + cone spire (or a conical tower roof) to a builder. */
function addSpire(b, spec, h) {
  const noWin = [1, 1, 1, 0];
  const seg = spec.seg || 8;
  const col = (c, k = 1) => [c.r * k, c.g * k, c.b * k];
  const cone = (cx, cz, r0, r1, y0, y1, c) => {
    const dy = y1 - y0, dr = r0 - r1;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const q0 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], q1 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const nl = Math.hypot(dy, dr) || 1;
      const nrm = [Math.cos(am) * dy / nl, dr / nl, Math.sin(am) * dy / nl];
      const lo = col(c, 0.82), hi = col(c, 1);
      if (r1 < 0.01) b.tri(p0, p1, q0, lo, lo, hi, noWin, nrm);
      else b.quad(p0, p1, q1, q0, lo, lo, hi, hi, noWin, nrm);
    }
  };
  if (spec.kind === 'roof') { // conical roof covering the footprint
    cone(0, 0, spec.r * 1.04, 0.05, h, h + spec.hgt, spec.roofCol);
    return;
  }
  const [cx, cz] = spec.p;
  const th = spec.hgt * 0.32;
  cone(cx, cz, spec.r, spec.r, h, h + th, spec.wallCol); // tower shaft
  cone(cx, cz, spec.r * 1.18, spec.r * 0.95, h + th, h + th + 0.35, spec.wallCol); // cornice lip
  cone(cx, cz, spec.r * 1.1, 0.05, h + th + 0.35, h + spec.hgt, spec.roofCol); // spire
}

/** Flat-extrusion height from the measured p90 / p50 mesh heights (fallback: the riga.json value). */
export function flatHeight(b, area, hs) {
  const rh = Math.max(3, +b.h || 8);
  if (b.t === 'aux' && hs && hs[0] < 0.5 && rh > 6) return 3.2; // courtyard 'building' the reality mesh shows as open ground (76 in the centre): a low shed, not an 18 m box with a stray roof colour
  if (!hs || b.t === 'aux') return rh;
  const [p90, p50] = hs;
  if (!(p90 >= 2)) return rh;
  if (area < 60 && p90 > rh * 1.8 + 3) return rh; // small + much taller than the survey says: tree canopy in the mesh
  const d = p90 - p50;
  let h;
  if (p50 < 0.5 * p90) h = p90 * 0.85;       // footprint mostly open ground around a taller core
  else if (d > 2) h = p50 + 0.3 * d;          // pitched roof: eave-ish height for a flat extrusion
  else h = (p50 + p90) / 2;                   // flat roof
  return Math.max(3, Math.min(140, h));
}

// roofs must never render near-black: every colour below has a lightness >= ~0.3
const TAR = [0x6d6f73, 0x74726e, 0x7a766f, 0x696b70, 0x7c7c7c];
const TIN = [0x6b6f72, 0x7b8084, 0x62676c, 0x867b71];
const TIN_GREEN = [0x6a9484, 0x78a090, 0x5f8f7c];
const TILE = [0xb55a3c, 0xa8503a, 0xc0653f, 0x9c4a35, 0xb8613c, 0x8b6b5c];
const RE_ORTHODOX = /Piedzimšanas|pareizticīg|Ņevsk|Trīsvienīb/i;
/** facade styles stored per building in the shapes file (rec.style): window pattern parameters */
const STYLE_WIN = [null, { floorH: 8.5, spacing: 4.8, frac: 0.55 }, { floorH: 5.4, spacing: 4.6, frac: 1 }, { floorH: 4, spacing: 4, frac: 0 }, { floorH: 3.4, spacing: 1.5, frac: 0.5 },
  { floorH: 6.4, spacing: 3.9, frac: 1 },       // 5 tall palace: plain rusticated ground floor, two rows of tall evenly spaced windows (Art Museum)
  { floorH: 6.2, spacing: 3.1, frac: 0.45 }];   // 6 gothic brick: narrow tall pointed-arch windows (frac 0.45 = pointed-arch code in the window shader; Art Academy)

/** Indexed geometry from a decoded riga-shapes record: roof triangles (colour by slope / type) + walls extruded from the outline loops. */
function buildShapeGeometry(S, rec, colFn, winParams, wallCol, decoFn) {
  const b = new GeoBuilder();
  const inv = 1 / S.q, vb = rec.ov * 3;
  const px = (i) => S.V[vb + i * 3] * inv, py = (i) => S.V[vb + i * 3 + 1] * inv, pz = (i) => S.V[vb + i * 3 + 2] * inv;
  const noWin = [1, 1, 1, 0];
  const wallTop = shade(wallCol, 1.0), wallBot = shade(wallCol, 0.78);
  const plain = shade(wallCol, 0.96);
  // decode triangles; roof faces are flat-shaded (own vertices + face normal); facade-like faces (class 2: step walls, drums, towers) get
  // horizontal normals smoothed across neighbouring faces that differ by less than ~35 degrees (round drums read round, corners stay crisp)
  const T = S.T, M = S.M, nt = rec.nt;
  const ids = new Int32Array(nt * 3), cls = new Uint8Array(nt), fn = new Float32Array(nt * 3);
  let nextNew = 0;
  const w2 = new Map(); // vertex -> class-2 triangle list
  let roofA = 0, flatA = 0;
  for (let t = 0; t < nt; t++) {
    const o = (rec.ot + t) * 3;
    for (let k = 0; k < 3; k++) { const d = T[o + k]; ids[t * 3 + k] = d === 0 ? nextNew++ : nextNew - d; }
    const i0 = ids[t * 3], i1 = ids[t * 3 + 1], i2 = ids[t * 3 + 2];
    const ux = px(i1) - px(i0), uy = py(i1) - py(i0), uz = pz(i1) - pz(i0), vx = px(i2) - px(i0), vy = py(i2) - py(i0), vz = pz(i2) - pz(i0);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    const m = M[rec.ot + t];
    cls[t] = renderClass(m);
    if (cls[t] === 1) { const ar = l * 0.5, f = Math.abs(ny) / l > 0.95; roofA += ar; if (f) flatA += ar; }
    if (cls[t] === 2) for (let k = 0; k < 3; k++) { const v = ids[t * 3 + k]; let a = w2.get(v); if (!a) w2.set(v, a = []); a.push(t); }
  }
  // ONE roof colour per building: every roof face (flat or pitched, any slope, any level) takes the same colour, chosen from the dominant roof form
  // (mostly flat -> flat-roof grey, else the neighbourhood's tile / tin colour); step walls, drums and dormer cheeks are class 2 = wall colour.
  // The only other roof colour is the ACCENT of a complete feature (class 3 spire / dome / lantern, class 5 gilded crosses).
  const flatDominant = flatA > 0.5 * roofA;
  const cols = colFn(flatDominant);
  const classCol = [cols.roof, cols.roof, plain, cols.special, plain, cols.accent, plain];
  const wallWin = [winParams.floorH, 127.5, winParams.spacing, winParams.frac];
  const COS = 0.82;
  for (let t = 0; t < nt; t++) {
    const c = cls[t], col = classCol[c];
    for (let k = 0; k < 3; k++) {
      const i = ids[t * 3 + k];
      if (c === 2) {
        const hx = fn[t * 3], hz = fn[t * 3 + 2], hl = Math.hypot(hx, hz) || 1, ox = hx / hl, oz = hz / hl;
        let ax = 0, az = 0;
        for (const u of w2.get(i)) {
          const ux2 = fn[u * 3], uz2 = fn[u * 3 + 2], ul = Math.hypot(ux2, uz2) || 1;
          if ((ux2 * ox + uz2 * oz) / ul >= COS) { ax += ux2 / ul; az += uz2 / ul; }
        }
        const al = Math.hypot(ax, az) || 1;
        b.idx.push(b.vert(px(i), py(i), pz(i), col, wallWin, [ax / al, 0, az / al]));
      } else b.idx.push(b.vert(px(i), py(i), pz(i), col, noWin, [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]]));
    }
  }
  // walls
  const L = S.L;
  let p = rec.ol;
  const end = rec.ol + rec.nl;
  while (p < end) {
    const len = L[p], y0 = L[p + 1] * inv; p += 3;
    for (let i = 0; i < len; i++) {
      const A = L[p + i], B = L[p + ((i + 1) % len)];
      const ya = py(A), yb = py(B);
      if (ya - y0 < 0.05 && yb - y0 < 0.05) continue;
      const ex = px(B) - px(A), ez = pz(B) - pz(A), el = Math.hypot(ex, ez);
      if (el < 0.01) continue; // zero-length edge between two welded/step vertices
      const win = [winParams.floorH, Math.max(ya, yb), winParams.spacing, winParams.frac];
      const wn = [ez / el, 0, -ex / el];
      const a0 = b.vert(px(A), y0, pz(A), wallBot, win, wn), b0 = b.vert(px(B), y0, pz(B), wallBot, win, wn);
      const b1 = b.vert(px(B), yb, pz(B), wallTop, win, wn), a1 = b.vert(px(A), ya, pz(A), wallTop, win, wn);
      b.idx.push(a0, b1, b0, a0, a1, b1);
    }
    p += len;
  }
  if (decoFn) decoFn(b, px, py, pz);
  const g = b.geometry();
  g.userData.flatDominant = flatDominant;
  return g;
}

/**
 * Build all buildings into a BatchedMesh.
 * Returns { mesh, items, stats } where items = [{ batchId, x, z, area, h, fit, value, name, t, landmark, gidShape, gidBox }]
 */
export function buildBuildings(data) {
  const rng = mulberry32(CFG.seed + 11);
  const C = new THREE.Color();
  const pickCol = (arr) => C.set(arr[Math.floor(rng() * arr.length)]).clone();
  const items = [];
  const geos = [];
  const landmarks = data.landmarks || [];
  const S = data.shapes || null;
  const slug = (data.meta && data.meta.slug) || 'centrs';
  const PANEL_WALLS = [0xd2cdc2, 0xc9c6bf, 0xdad4c6, 0xbfc2c3, 0xc8c0b0, 0xd6d1c8];
  const stats = { buildings: 0, osm: 0, meshNotable: 0, meshRelief: 0, flat: 0, measuredHeights: 0 };
  let totalV = 0, totalI = 0;

  // pass 1: footprints, fit, value
  for (const b of data.buildings) {
    const ring0 = cleanRing(b.p || []);
    if (ring0.length < 3) continue;
    const area = polyArea(ring0);
    if (area < 5) continue;
    const [cx, cz] = centroid(ring0);
    const ring = ring0.map(([x, z]) => [x - cx, z - cz]);
    const hs = S ? S.hs.get(b.id) : null;
    let h = flatHeight(b, area, hs), hv = h;
    const rec0 = S ? S.recs.get(b.id) : null;
    const rec = rec0 && (b.t !== 'aux' || rec0.roofRGB) ? rec0 : null; // aux sheds stay flat boxes, except curated hero parts (palette set): a hero's courtyard wings must share its roof colour
    if (rec && (rec.flags & 1)) continue; // cadastre piece absorbed into a curated neighbour (tools/detail/curated.mjs): the neighbour's mesh covers it
    if (hs) stats.measuredHeights++;
    const hBox = h;
    if (rec) { h = Math.max(3, rec.hmax); hv = Math.max(3, rec.vol / area); }
    const mb = minBox(ring);
    let fit = (CFG.buildingFit.boxWeight * (mb.L / 2) + CFG.buildingFit.areaWeight * Math.sqrt(area / Math.PI));
    if (rec && rec.flags >> 4) { // curated building whose cadastre polygon is not the building (museum terrace / two pieces): fit from the measured mesh footprint
      const hb = minBox(shapeHull(S, rec));
      fit = CFG.buildingFit.boxWeight * (hb.L / 2) + CFG.buildingFit.areaWeight * Math.sqrt((rec.flags >> 4) / Math.PI);
    }
    const value = Math.max(CFG.value.buildingMin, Math.round((area * hv) / CFG.value.buildingDiv));
    items.push({ id: b.id, x: cx, z: cz, area, h, hBox, fit, value, name: b.n || null, t: b.t || 'oth', landmark: false, ring: ring0, rel: ring, lmH: 0, rec });
  }

  // Match each landmark to exactly one building: the one containing it, else the nearest close one.
  // Monuments / clocks stay standalone props (see world.js), they must not hijack a neighbouring building.
  for (const lm of landmarks) {
    if (RE_MONUMENT.test(lm.n)) continue;
    let best = null, bd = Infinity;
    for (const it of items) {
      const d = Math.hypot(lm.x - it.x, lm.z - it.z);
      if (d > 80) continue;
      const inside = pointInPoly(lm.x, lm.z, it.ring);
      const score = inside ? d - 1000 : d;
      if ((inside || d < Math.max(10, it.fit * 0.8)) && score < bd) { bd = score; best = it; }
    }
    if (best && !best.landmark) {
      best.landmark = true; best.name = lm.n; best.lmName = lm.n; best.lmH = lm.h || 0;
      best.value = Math.round(best.value * CFG.value.landmarkMul);
    }
  }

  // Riga landmark rules (names / positions) + the Cat House
  for (const it of items) {
    const r = landmarkRule(it);
    if (r) { it.rule = r; }
  }
  const cat = pickCatHouse(items);
  if (cat && !cat.rule) cat.rule = { deco: { kind: 'cat' }, name: 'Kaķu nams', landmark: true, h: Math.max(cat.h, 16), bonus: CFG.value.catHouse };
  for (const it of items) {
    const r = it.rule;
    if (!r) continue;
    if (r.name) { it.name = r.name; it.lmName = r.name; }
    if (r.landmark && !it.landmark) { it.landmark = true; it.value = Math.round(it.value * (r.valueMul || CFG.value.landmarkMul)); }
    if (r.bonus) it.value += r.bonus;
  }

  // pass 2: geometry
  const P = LIFE.palettes;
  for (const it of items) {
    const { rel: ring, area, t, rec } = it;
    let h = it.h;
    const zone = zoneOf(it.x, it.z);
    let walls = CFG.colors.wall[t] || CFG.colors.wall.oth;
    let roofs = CFG.colors.roof;
    if (t === 'res' || t === 'pub' || t === 'oth' || t === 'com') {
      if (zone === 'old' && t !== 'com') { walls = P.oldTown; roofs = P.oldTownRoof; }
      else if (zone === 'centre' && t !== 'com') walls = P.centre;
    }
    const wallCol = pickCol(walls);
    wallCol.multiplyScalar(0.92 + rng() * 0.14);
    const roofCol = pickCol(roofs);
    const rule = it.rule;
    if (rule) {
      if (rule.wall) wallCol.setHex(rule.wall);
      if (rule.roof) roofCol.setHex(rule.roof);
      if (rule.h && !rec) h = rule.h;
    }
    it.wallCol = wallCol.getHex();
    const winParams = {
      floorH: t === 'ind' || t === 'aux' ? 4 : 3 + rng() * 0.5,
      spacing: t === 'com' ? 2.4 + rng() * 0.6 : 2.9 + rng() * 1.1,
      frac: t === 'aux' || t === 'ind' ? 0.0 : t === 'rel' ? 0.35 : 1.0,
    };
    if (rule && rule.win) Object.assign(winParams, rule.win); // landmark facades (e.g. tall opera windows)
    // Purvciems: Soviet panel blocks = crisp pale boxes with a regular window grid and flat grey roofs (never red mansards)
    const panel = slug === 'purvciems' && !rule && (t === 'res' || t === 'com' || t === 'pub' || t === 'oth') && area > 200 && it.h >= 8 && !(rec && rec.style);
    const bigFlat = slug === 'purvciems' && !rule && !panel && area > 350 && t !== 'rel' && t !== 'aux' && !(rec && rec.style); // big shops / halls: flat grey roofs too
    if (bigFlat) roofCol.setHex([0x77797c, 0x6e7073, 0x808285][Math.abs((it.x * 3 + it.z * 5) | 0) % 3]);
    if (panel) {
      wallCol.setHex(PANEL_WALLS[Math.abs((it.x * 7 + it.z * 13) | 0) % PANEL_WALLS.length]); it.wallCol = wallCol.getHex();
      Object.assign(winParams, { floorH: 2.8, spacing: 2.7, frac: 1 });
      roofCol.setHex([0x77797c, 0x6e7073, 0x808285][Math.abs((it.x * 3 + it.z * 5) | 0) % 3]);
    }
    const nm = it.name || '';

    if (rec) {
      // ---- measured shape: roof colours by type, decorations dropped (the data has the real spires/domes), except the cat
      const orth = RE_ORTHODOX.test(nm);
      if (rec.wallRGB) { wallCol.setHex(rec.wallRGB); it.wallCol = rec.wallRGB; }
      if (rec.style && STYLE_WIN[rec.style]) Object.assign(winParams, STYLE_WIN[rec.style]);
      const hash = Math.abs((it.x * 7 + it.z * 3) | 0);
      let pitchCol;
      if (rec.roofRGB) pitchCol = new THREE.Color(rec.roofRGB);
      else if (rule && rule.roof) pitchCol = roofCol.clone();
      else if (zone === 'old') pitchCol = new THREE.Color(P.oldTownRoof[hash % P.oldTownRoof.length]);
      else { const r = rng(); pitchCol = new THREE.Color(r < 0.62 ? TILE[hash % TILE.length] : r < 0.93 ? TIN[hash % TIN.length] : TIN_GREEN[hash % TIN_GREEN.length]); }
      if (panel || bigFlat) pitchCol = roofCol.clone();
      const flatCol = panel || bigFlat ? roofCol.clone() : rec.roofRGB ? pitchCol.clone() : new THREE.Color(TAR[hash % TAR.length]);
      const specialCol = new THREE.Color(rec.domeRGB ? rec.domeRGB : orth ? 0xe2b23a : rule && rule.roof ? rule.roof : (hash % 3 === 0 ? 0x5a6a74 : 0x5f9d89));
      const accentCol = new THREE.Color(rec.accentRGB || 0xe3b53c);
      const colFn = (flatDominant) => { const r = flatDominant ? flatCol : pitchCol; return { roof: [r.r, r.g, r.b], special: [specialCol.r, specialCol.g, specialCol.b], accent: [accentCol.r, accentCol.g, accentCol.b] }; };
      let decoFn = null;
      if (rule && rule.deco && rule.deco.kind === 'cat') {
        decoFn = (b, px, py, pz) => { // cat on the highest points (turret tips), at most two, >5 m apart
          const pts = [];
          for (let i = 0; i < rec.nv; i++) pts.push([px(i), py(i), pz(i)]);
          pts.sort((a, c) => c[1] - a[1]);
          const tips = [];
          for (const q of pts) { if (tips.length < 2 && tips.every((u) => Math.hypot(u[0] - q[0], u[2] - q[2]) > 5)) tips.push(q); }
          for (const q of tips) addCat(b, q[0], q[1] - 0.1, q[2]);
        };
      }
      const geo = buildShapeGeometry(S, rec, colFn, winParams, wallCol, decoFn);
      it.h = rec.hmax + (decoFn ? 2 : 0);
      it.shaped = true;
      if (rec.src === 2) stats.osm++; else if (rec.src === 1) stats.meshNotable++; else stats.meshRelief++;
      it.geo = geo;
      if (rec.src === 3) { // lighter variant for the `low` quality tier: a flat extrusion with the measured height
        const bg = buildBuildingGeometry(ring, it.hBox, wallCol, roofCol, null, winParams, null);
        if (bg) { it.boxGeo = bg; totalV += bg.attributes.position.count; totalI += bg.index.count; }
      }
      totalV += geo.attributes.position.count;
      totalI += geo.index.count;
      continue;
    }

    // ---- flat extrusion (+ procedural decorations) with the measured height
    const bb = bbox(ring);
    const minSide = Math.min(bb.x1 - bb.x0, bb.z1 - bb.z0);
    const hull = convexHullArea(ring);
    const isTowerName = RE_TOWER.test(nm) && !isAddressName(nm);
    const isChurch = !isTowerName && (t === 'rel' || (!isAddressName(nm) && RE_CHURCH.test(nm)));
    let spire = null;
    const decos = [];
    if (rule && rule.deco) {
      const d = { ...rule.deco };
      if (d.kind === 'stepspire') { const T = Math.max(it.h, it.lmH || 0); h = Math.min(T, Math.max(22, Math.min(30, 0.28 * T))); d.S = Math.min(Math.max(T - h, 40), 95); }
      if (d.kind === 'domespire') { const T = Math.max(it.h, it.lmH || 0); h = Math.min(T, Math.max(22, Math.min(32, 0.7 * T))); d.S = Math.min(Math.max(T - h, 22), 60); }
      decos.push(d);
    } else if (t === 'pub' && area > 500 && it.h > 8 && rng() < 0.7) decos.push({ kind: 'flag' });
    if (rule && rule.deco) { /* landmark decoration replaces the generic church / tower logic */ }
    else if (isTowerName && area < 900) {
      const r = Math.max(...ring.map(([x, z]) => Math.hypot(x, z)));
      const hgt = Math.min(r * 1.5 + 3, h * 0.4);
      h = Math.max(4, h - hgt);
      spire = { kind: 'roof', r, hgt, roofCol: new THREE.Color(0x8c4632) };
    } else if (isChurch && area > 60) {
      const ip = bestInterior(ring);
      const r = Math.max(1.3, Math.min(0.17 * minSide, ip.clear * 0.7, 3.4));
      // heights usually include the spire: keep a church-proportioned body and put the rest in the spire
      const T = Math.max(h, it.lmH || 0);
      let Sh;
      if (T > 40) { h = Math.min(30, Math.max(18, 0.28 * T)); Sh = Math.min(T - h, 100); }
      else Sh = Math.min(30, Math.max(12, h * 0.8));
      const dark = ((Math.abs(it.x * 7 + it.z * 3) | 0) % 3) === 0;
      spire = { kind: 'spire', p: ip.p, r, hgt: Sh, seg: 8, wallCol: wallCol.clone().multiplyScalar(0.95), roofCol: new THREE.Color(dark ? 0x3f4a52 : 0x5f9d89) };
    }
    if (spire) decos.push(spire);
    let mansard = null;
    if (!panel && !bigFlat && !spire && !(rule && rule.deco) && (t === 'res' || t === 'pub' || t === 'oth' || t === 'rel') && h > 7 && h < 40 && hull > 0 && area / hull > 0.82 &&
        minSide > 8 && ring.length <= 24 && rng() < 0.7) {
      mansard = { s: 0.62 + rng() * 0.12, rh: Math.min(4.5, 0.22 * minSide + 0.5) };
    }
    const geo = buildBuildingGeometry(ring, h, wallCol, roofCol, mansard, winParams, decos.length ? decos : null);
    if (!geo) { it.drop = true; continue; }
    it.h = h + (geo.userData.extraH || 0);
    stats.flat++;
    it.geo = geo;
    totalV += geo.attributes.position.count;
    totalI += geo.index.count;
  }
  const kept = items.filter((it) => !it.drop);
  stats.buildings = kept.length;

  const mat = makeBuildingMaterial();
  const mesh = new THREE.BatchedMesh(kept.length, totalV, totalI, mat);
  mesh.sortObjects = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < kept.length; i++) {
    const it = kept[i];
    it.gidShape = mesh.addGeometry(it.geo);
    it.gidBox = it.boxGeo ? mesh.addGeometry(it.boxGeo) : -1;
    const iid = mesh.addInstance(it.gidShape);
    m.makeTranslation(it.x, 0, it.z);
    mesh.setMatrixAt(iid, m);
    it.batchId = iid;
    it.geo.dispose(); it.geo = null;
    if (it.boxGeo) { it.boxGeo.dispose(); it.boxGeo = null; }
    it.rec = null;
  }
  return { mesh, items: kept, stats };
}
