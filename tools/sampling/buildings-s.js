// EXPERIMENT COPY of src/buildings.js (tools/sampling): same geometry + material + colour logic, extended so per-building SAMPLED parameters (tools/sampling/data/params.json,
// measured from the reality mesh) can drive wall / roof colours (level 1), the facade rhythm (level 2) and a per-facade window bitmask + hero colours (level 3).
// Level 0 (globalThis.__SAMP missing or level 0) renders exactly like the game. Every change against the original is marked  // [S]  (search for it).
// Not wired into the game: tools/sampling/server.mjs serves src/world.js with its './buildings.js' import pointed here.
import * as THREE from 'three';
import { CFG, LIFE } from '/src/config.js';
import { cleanRing, centroid, bbox, minBox, pointInPoly } from '/src/geo.js';
import { mulberry32 } from '/src/rng.js';
import { span } from '/src/perfMark.js';
import { renderClass } from '/src/shapes.js';
import { landmarkRule, pickCatHouse, addDeco, addCat } from '/src/landmarks.js';
import { treatmentFor, neighbourRef, TIER_A } from '/src/sights.js';
import { addSightFeature, SF_KINDS } from '/src/sightFeatures.js';
import { wallEdgesFlat, wallEdgesShape, facadeRuns } from '/facade.js'; // [S]
import { themeHook, GLSL_BLD_VERT_DECL, GLSL_BLD_VERT_SET, GLSL_BLD_FRAG_DECL, GLSL_BLD_WINDOWS } from '/src/themeUniforms.js';

const TIER_A_BY_KEY = new Map(TIER_A.map((a) => [a.key, a]));
const _tri = [];
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

function shade(c, k) { return [c.r * k, c.g * k, c.b * k]; }

// ---- [S] sampled-parameter plumbing ---------------------------------------------------------------------------------------------------------
const SAMP = () => globalThis.__SAMP || null; // { level: 0..3, params: Map(buildingId -> record), collect: bool }
export const SAMP_BITS = { rows: [], uniform: { value: null } };
function bitsTexture(rows) { const n = Math.max(1, rows.length / 16), t = new THREE.DataTexture(rows.length ? Uint32Array.from(rows) : new Uint32Array(16), 16, n, THREE.RedIntegerFormat, THREE.UnsignedIntType); t.internalFormat = 'R32UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; }
SAMP_BITS.uniform.value = bitsTexture([]); // per-facade window bitmasks of the sampled buildings: 16 u32 rows per facade (texture 16 x n, R32UI)
function rgb2lab(hex) { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const R = f((hex >> 16) & 255), G = f((hex >> 8) & 255), B = f(hex & 255); const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); const X = g((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = g(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = g((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; }
/** CIELAB distance between a sampled rgb triple and a hex colour (THREE.Color.getHex() gives sRGB hex) */
function labDist(rgb, hex) { const p = rgb2lab((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]), q = rgb2lab(hex); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
const hexOf = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
const b255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** per-building adapter the two wall builders consult: samp.edge(k) -> { top, bot (wall colours), win(top) (aWin params), ext (extra attributes) } or null */
function makeSamp(SP, level, edges, RI, legacy, sampW) {
  const cache = new Map(), byK = new Map(edges.map((e) => [e.k, e]));
  const lin = (c) => { const k = new THREE.Color(hexOf(c)); return [k.r, k.g, k.b]; }; // sRGB bytes -> the linear working values the game keeps in its vertex colours
  const colTop = (c) => lin(c), colBot = (c) => lin(c).map((v) => v * 0.78);
  const flags = (SP.gk === 1 ? 2 : SP.gk === 2 ? 4 : 0) | (SP.sc ? 8 : 0) | (SP.pil ? 16 : 0);
  return {
    edge(k) {
      const m = RI.of.get(k); if (!m) return null;
      let R = cache.get(m.run);
      if (!R) {
        const run = RI.runs[m.run], two = SP.w2 && SP.w2r && SP.w2r.includes(m.run), c = two ? SP.w2 : (SP.w || [200, 195, 185]);
        R = { top: sampW ? colTop(c) : null, bot: sampW ? colBot(c) : null, run, ext: null, win: (top) => [legacy.floorH, top, legacy.spacing, legacy.frac] };
        if (level >= 2 && run.len >= 2.4) {
          const fr = (level >= 3 && SP.fr && SP.fr[m.run]) || null;
          const frr = SP.fr && SP.fr[m.run], nb = Math.max(1, Math.round(run.len / ((frr && frr.sp) || SP.sp || 3.5))), Sadj = run.len / nb, gh = SP.gh || 0, co = SP.co || 0;
          let slot = -1, fl = flags;
          if (fr && fr.b && fr.r <= 16 && fr.c === nb) { // bitmask row k = u32 over the facade's bays, row 0 = ground band; skipped unless the bay count matches the run (building geometry changed)
            slot = SAMP_BITS.rows.length / 16; for (let i = 0; i < 16; i++) SAMP_BITS.rows.push(fr.b[i] >>> 0); fl |= 32;
          }
          R.ext = { s1: [b255(SP.ww * 255), b255(SP.wh * 255), b255(SP.wy * 255), b255(co / 2 * 255)], s2: [SP.trim[0], SP.trim[1], SP.trim[2], fl | 1], s3: [b255(gh / 8 * 255), b255((SP.gs ?? 0.6) * 255), b255((SP.pil || 0) * 16), 0],
            slot, invS: 1 / Sadj, len: 0, u0: 0, x0: 0, z0: 0, dx: 0, dz: 0, l2: 1 };
          R.sampled = true; R.Sadj = Sadj; R.gh = gh; R.co = co;
        }
        cache.set(m.run, R);
      }
      const e = byK.get(k);
      const out = { top: R.top, bot: R.bot, win: R.win, ext: null };
      if (R.sampled) {
        out.win = (top) => { const U = Math.max(1, top - R.gh - R.co * 0.5), nF = SP.nF || Math.max(1, Math.round(U / (SP.fh || 3.2))); return [U / nF, top, R.Sadj, 1]; };
        const dx = e.x1 - e.x0, dz = e.z1 - e.z0;
        out.ext = { ...R.ext, x0: e.x0, z0: e.z0, dx, dz, l2: dx * dx + dz * dz || 1, len: e.len, u0: m.u0 };
      }
      return out;
    },
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v) => Math.round(clamp01(v) * 255);

/** Accumulates indexed geometry. Vertex = position (f32) + normal (i8x4) + colour (u8x4) + window params aWin (u8x4: floorH/12, wallTop/127.5, spacing/8, frac). */
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.win = []; this.idx = []; this.s1 = []; this.s2 = []; this.s3 = []; this.fac = []; this.ext = null; } // [S] s1 s2 s3 = sampled facade params (u8x4 each), fac = (facade run, metres along it); b.ext is set around wall quads
  get count() { return this.pos.length / 3; }
  vert(x, y, z, c, win, n) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127), 0);
    this.col.push(byte(c[0]), byte(c[1]), byte(c[2]), 255);
    this.win.push(byte(win[0] / 12), byte(win[1] / 127.5), byte(win[2] / 8), byte(win[3]));
    const E = this.ext; // [S]
    if (E) { this.s1.push(E.s1[0], E.s1[1], E.s1[2], E.s1[3]); this.s2.push(E.s2[0], E.s2[1], E.s2[2], E.s2[3]); this.s3.push(E.s3[0], E.s3[1], E.s3[2], E.s3[3]); this.fac.push(E.slot, (E.u0 + (((x - E.x0) * E.dx + (z - E.z0) * E.dz) / E.l2) * E.len) * E.invS); } // fac = (bitmask slot or -1, bay coordinate along the facade)
    else { this.s1.push(0, 0, 0, 0); this.s2.push(0, 0, 0, 0); this.s3.push(0, 0, 0, 0); this.fac.push(-1, 0); }
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
    g.setAttribute('aS1', new THREE.BufferAttribute(new Uint8Array(this.s1), 4, true)); // [S]
    g.setAttribute('aS2', new THREE.BufferAttribute(new Uint8Array(this.s2), 4, true));
    g.setAttribute('aS3', new THREE.BufferAttribute(new Uint8Array(this.s3), 4, true));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.fac, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Build geometry for ring `ring` (CCW in x,z, relative to centroid), total height h.
 * Returns BufferGeometry or null.
 */
export function buildBuildingGeometry(ring, h, wallCol, roofCol, mansard, winParams, spire = null, samp = null) { // [S] samp
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
    const sp = samp && samp.edge(i); // [S]
    if (sp) { b.ext = sp.ext; b.quad([x0, 0, z0], [x1, 0, z1], [x1, hw, z1], [x0, hw, z0], sp.bot || wallBot, sp.bot || wallBot, sp.top || wallTop, sp.top || wallTop, sp.win(hw), [nx, 0, nz]); b.ext = null; continue; }
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
      else extra = Math.max(extra, SF_KINDS.has(d.kind) ? addSightFeature(b, { ...d, base: d.base ?? h }, ring, wallCol, roofCol) : addDeco(b, d, ring, h, wallCol, roofCol));
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

/** [S] sampled facade: bays of the (adjusted) spacing along the facade run, floors of the (adjusted) height above a ground band; window rectangle, shop glazing / rustication in the band,
 *  light or dark window surrounds (trim colour), string courses, cornice band, pilaster strips, and the per-facade window bitmask (uBits row = facade slot, 16 u32 = floors, bit = bay). */
const SAMPLED_GLSL = `
  if (sampled > 0.5) {
    float wl = step(abs(vLN.y), 0.25);
    float fhS = max(vWin.x, 0.5), SS = max(vWin.z, 0.5), gH = vS3.x * 8.0, co = vS1.w * 2.0;
    float uu = vFac.y, bay = floor(uu), fb = fract(uu);
    float yy = vLP.y - gH, upper = step(0.0, yy);
    float fyU = max(yy, 0.0) / fhS, fl = floor(fyU), ffU = fract(fyU);
    float ww = vS1.x, wh = vS1.y, wy0 = vS1.z;
    vec3 trim = pow(vS2.rgb, vec3(2.2));
    float shop = float((sflags >> 1) & 1), rust = float((sflags >> 2) & 1), strc = float((sflags >> 3) & 1), pilN = vS3.z * 255.0 / 16.0, hasMask = float((sflags >> 5) & 1);
    float present = 1.0;
    if (hasMask > 0.5) {
      float row = upper > 0.5 ? min(fl + 1.0, 15.0) : 0.0;
      uint bits = texelFetch(uBits, ivec2(int(row), int(vFac.x + 0.5)), 0).r;
      present = float((bits >> uint(clamp(bay, 0.0, 31.0))) & 1u);
    }
    float inTop = step(vLP.y, vWin.y - co - 0.15);
    // upper floors: window rectangle (+ a surround ring)
    float hxw = ww * 0.5, sm = 0.03;
    float wxU = smoothstep(0.5 - hxw - sm, 0.5 - hxw, fb) * (1.0 - smoothstep(0.5 + hxw, 0.5 + hxw + sm, fb));
    float wyU = smoothstep(wy0 - 0.03, wy0, ffU) * (1.0 - smoothstep(wy0 + wh, wy0 + wh + 0.03, ffU));
    float winUp = wl * upper * inTop * wxU * wyU * present;
    float mg = 0.07 / max(SS / 3.0, 0.6);
    float wxO = smoothstep(0.5 - hxw - mg - sm, 0.5 - hxw - mg, fb) * (1.0 - smoothstep(0.5 + hxw + mg, 0.5 + hxw + mg + sm, fb));
    float wyO = smoothstep(wy0 - mg * 1.2 - 0.03, wy0 - mg * 1.2, ffU) * (1.0 - smoothstep(wy0 + wh + mg * 0.8, wy0 + wh + mg * 0.8 + 0.03, ffU));
    float surr = wl * upper * inTop * wxO * wyO * present * (1.0 - clamp(winUp * 1.5, 0.0, 1.0));
    // ground band: shop glazing (wide dark panes with a plinth) or rustication joints with small windows
    float gy = vLP.y;
    float gwid = mix(0.46, 0.8, shop * vS3.y);
    float wxG = smoothstep(0.5 - gwid * 0.5 - sm, 0.5 - gwid * 0.5, fb) * (1.0 - smoothstep(0.5 + gwid * 0.5, 0.5 + gwid * 0.5 + sm, fb));
    float gTop = gH - mix(0.55, 0.35, shop);
    float wyG = smoothstep(mix(0.9, 0.5, shop) - 0.05, mix(0.9, 0.5, shop), gy) * (1.0 - smoothstep(gTop - 0.05, gTop, gy));
    float winG = wl * (1.0 - upper) * step(0.4, gH) * wxG * wyG * present;
    float win2 = max(winUp, winG);
    vec3 glass2 = mix(vec3(0.16, 0.22, 0.29), vec3(0.17, 0.22, 0.27), shop * (1.0 - upper)) * (0.8 + 0.4 * fract(sin(bay * 12.9898 + (upper > 0.5 ? fl : -1.0) * 78.233) * 43758.5453));
    diffuseColor.rgb = mix(diffuseColor.rgb, trim, 0.7 * surr);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass2, mix(0.85, 0.5, shop * (1.0 - upper)) * win2);
    float joint = rust * wl * (1.0 - upper) * (step(fract(gy / 0.75), 0.07)) * step(0.3, gy);
    diffuseColor.rgb *= 1.0 - 0.16 * joint;
    diffuseColor.rgb *= 1.0 - 0.05 * wl * (1.0 - upper) * step(gy, 0.9);                    // faint plinth
    float course = strc * wl * upper * step(ffU, 0.04) * step(0.5, fl + 1.0) + wl * step(abs(yy), 0.1) * strc;
    float corn = wl * step(vWin.y - co, vLP.y) * step(0.01, co);
    diffuseColor.rgb = mix(diffuseColor.rgb, trim, clamp(0.6 * course + 0.75 * corn, 0.0, 0.85));
    float pil = step(0.5, pilN) * wl * upper * inTop * (1.0 - smoothstep(0.045, 0.09, abs(fract(uu / max(pilN, 1.0) + 0.5) - 0.5)));
    diffuseColor.rgb = mix(diffuseColor.rgb, trim, 0.55 * pil * (1.0 - win2));
    win = win2; u = uu; fy = fyU + 1.0;
  }`;
export function makeBuildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    themeHook(shader); // theme.js: shared night / snow uniforms
    shader.uniforms.uBits = SAMP_BITS.uniform; // [S]
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec4 vWin;\nattribute vec4 aS1;\nattribute vec4 aS2;\nattribute vec4 aS3;\nattribute vec2 aFac;\nvarying vec4 vS1;\nvarying vec4 vS2;\nvarying vec4 vS3;\nvarying vec2 vFac;\n' + GLSL_BLD_VERT_DECL) // [S] aS1..aFac
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal; vWin = vec4(aWin.x * 12.0, aWin.y * 127.5, aWin.z * 8.0, aWin.w); vS1 = aS1; vS2 = aS2; vS3 = aS3; vFac = aFac;\n' + GLSL_BLD_VERT_SET);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec4 vWin;\nvarying vec4 vS1;\nvarying vec4 vS2;\nvarying vec4 vS3;\nvarying vec2 vFac;\nuniform highp usampler2D uBits;\n' + GLSL_BLD_FRAG_DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float rnd = step(0.64, vWin.w) * step(vWin.w, 0.66); // round-arch church windows (frac code 0.65)
  float inst = step(0.84, vWin.w) * step(vWin.w, 0.86);  // sights: institutional (school / hospital): ribbon windows + dark base band + stone string course
  float blind = step(0.74, vWin.w) * step(vWin.w, 0.76); // theatre / museum: blank monumental walls, glazed foyer band, pilasters, cornice
  float slit = step(0.24, vWin.w) * step(vWin.w, 0.26);  // castle: thick stone, small slit windows, courses
  float hist = step(0.94, vWin.w) * step(vWin.w, 0.96);  // historic house: windows with light plaster surrounds
  float strong = max(max(step(0.44, vWin.w) * step(vWin.w, 0.46), rnd), max(max(inst, blind), max(slit, hist)));
  int sflags = int(vS2.w * 255.0 + 0.5); float sampled = float(sflags & 1); // [S] sampled facade (level 2+): the legacy window pattern is skipped, the block below draws it
  float wall = step(abs(vLN.y), 0.25) * mix(vWin.w, 0.9, strong) * (1.0 - sampled);
  float fh = max(vWin.x, 0.5);
  float fy = vLP.y / fh;
  float ff = fract(fy);
  float u = dot(vLP.xz, vec2(-vLN.z, vLN.x)) / max(vWin.z, 0.5);
  float fu = fract(u);
  float goth = step(0.44, vWin.w) * step(vWin.w, 0.46); // gothic brick style code (frac 0.45): tall pointed-arch windows
  float archC = clamp(abs(fu - 0.45) / 0.25, 0.0, 1.0);
  float archTop = mix(0.73, 0.5, goth * archC);
  archTop = mix(archTop, mix(0.82, 0.6, archC * archC), rnd);
  float wy = smoothstep(0.2, 0.27, ff) * (1.0 - smoothstep(archTop - 0.07, archTop, ff));
  float wx = smoothstep(0.2, 0.27, fu) * (1.0 - smoothstep(0.66, 0.73, fu));
  float inside = step(fh * 0.9, vLP.y) * step(vLP.y, vWin.y - fh * 0.2);
  wx = mix(wx, smoothstep(0.1, 0.14, fu) * (1.0 - smoothstep(0.86, 0.9, fu)), inst);
  wx = mix(wx, smoothstep(0.42, 0.46, fu) * (1.0 - smoothstep(0.54, 0.58, fu)), slit);
  wy = mix(wy, smoothstep(0.3, 0.34, ff) * (1.0 - smoothstep(0.66, 0.7, ff)), slit);
  float foyer = smoothstep(0.08, 0.14, fu) * (1.0 - smoothstep(0.86, 0.92, fu)) * step(0.7, vLP.y) * step(vLP.y, 4.3);
  float win = wall * wx * wy * inside;
  win = mix(win, wall * foyer, blind);
  vec3 glass = vec3(0.16, 0.22, 0.29) * (0.8 + 0.4 * fract(sin(floor(u) * 12.9898 + floor(fy) * 78.233) * 43758.5453));
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, 0.82 * win);
${SAMPLED_GLSL}
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
  if (inst > 0.5) { // dark base band + light stone string course above it
    diffuseColor.rgb *= 1.0 - 0.3 * wall * step(vLP.y, 1.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.85, 0.78), 0.6 * wall * step(1.9, vLP.y) * step(vLP.y, 2.3));
  }
  if (blind > 0.5) { // pilaster lines, a light string course over the foyer and a heavy cornice
    float pil = wall * step(4.9, vLP.y) * (smoothstep(0.0, 0.04, fu) * (1.0 - smoothstep(0.04, 0.1, fu)));
    diffuseColor.rgb *= 1.0 - 0.12 * pil;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.87, 0.8), 0.55 * wall * step(4.4, vLP.y) * step(vLP.y, 4.9));
    diffuseColor.rgb *= 1.0 - 0.2 * wall * step(vWin.y - 1.2, vLP.y) * step(vLP.y, vWin.y);
  }
  if (slit > 0.5) { // stone courses and a darker parapet band
    diffuseColor.rgb *= 1.0 - 0.1 * wall * step(fract(vLP.y / 1.3), 0.07);
    diffuseColor.rgb *= 1.0 - 0.14 * wall * step(vWin.y - 1.4, vLP.y);
  }
  if (hist > 0.5) { // light plaster window surrounds + string course
    float wxo = smoothstep(0.1, 0.16, fu) * (1.0 - smoothstep(0.74, 0.8, fu));
    float wyo = smoothstep(0.14, 0.2, ff) * (1.0 - smoothstep(0.78, 0.84, ff));
    float surr = wall * wxo * wyo * inside * (1.0 - clamp(wx * wy * 1.5, 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.89, 0.8), clamp(0.75 * surr + 0.55 * wall * step(ff, 0.05) * step(fh * 0.9, vLP.y), 0.0, 0.8));
  }
  float cornice = wall * step(vWin.y - 0.45, vLP.y) * step(vLP.y, vWin.y);
  diffuseColor.rgb *= 1.0 - 0.1 * cornice;
}`);
  };
  mat.customProgramCacheKey = () => 'building-win6-samp1'; // [S]
  return mat;
}


const RE_ADDR = /(\s\d+[A-Za-zĀ-ž]?(\s*k-\d+)?(\s*-\s*\d+)?$)|^Bez adreses/;
/** True for names that are just street addresses ("Kuģu iela 22"). */
export function isAddressName(n) { return !n || RE_ADDR.test(n); }
const RE_CHURCH = /baznīca|katedrāle|doms|sinagoga|church|cathedral|bazn/i;
const RE_TOWER = /torn/i;
const RE_MONUMENT = /piemineklis|pulkstenis/i;

/**
 * Roof material mix per neighbourhood of the Centre map (review M-04: real roofs are mostly grey zinc / tin / slate with green copper on monuments, clay tile is the minority).
 * Shares are set per building from its position (deterministic, no rng draw): Old Town: 90 % of the pitched roofs keep the clay tile (kept predominantly red on purpose; rendered area share red 48.5 -> 47 %, grey 44 -> 46 %),
 * 8 % grey zinc / slate, 2 % verdigris (orthophoto measurement: 17-25 % red / 70-78 % grey / 5 % green); the surrounding centre grid 18 % tile, 74 % grey, 8 % green (measured ~5 % red / 93 % grey: the detector under-reads dull rusty tile; rendered 37 / 48.5 / 14 -> 13 / 72 / 15 %).
 * Returns a hex colour, or 0 = keep the building's own (tile) colour. Districts keep their palettes.
 */
const GREY_ROOFS = [0x6b6f72, 0x7b8084, 0x62676c, 0x707a82, 0x7f868c, 0x5e646a, 0x74726e];
const GREY_OLD = [0x6b6f72, 0x62676c, 0x707a82, 0x5e646a, 0x5f6368];
const VERDIGRIS = [0x6a9484, 0x78a090, 0x5f8f7c];
export function zoneRoof(slug, zone, x, z) {
  if (slug !== 'centrs') return 0;
  const u = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1, v = Math.abs(Math.sin(x * 4.1414 + z * 9.2653) * 24634.6345) % 1;
  if (zone === 'old') return u < 0.9 ? 0 : u < 0.98 ? GREY_OLD[Math.floor(v * GREY_OLD.length)] : VERDIGRIS[Math.floor(v * VERDIGRIS.length)];
  return u < 0.18 ? 0 : u < 0.92 ? GREY_ROOFS[Math.floor(v * GREY_ROOFS.length)] : VERDIGRIS[Math.floor(v * VERDIGRIS.length)];
}

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

/**
 * Roof height (m above ground) just inside each footprint corner of a building, read from its own geometry by a vertical ray.
 * `it.h` is the building's HIGHEST point (spire tip, dome), so anything that stands "on the roof" at a corner (flags) must use
 * this instead. Corners the ray misses (simplified outlines, courtyards) fall back to the lowest roof height found.
 */
const CORNER_INSET = 0.08; // must match the inset src/flags.js uses for rooftop poles
function cornerHeights(it) {
  const pos = it.geo.attributes.position, idx = it.geo.index, ring = it.ring;
  const P = pos.array, st = pos.itemSize, n = idx ? idx.count : pos.count;
  const out = new Float32Array(ring.length).fill(-1);
  const at = (i) => (idx ? idx.array[i] : i) * st;
  // plan-view bounding box of every triangle (padded by far more than the 1e-4 barycentric tolerance below can reach), so a sample point only runs the full test on the few triangles near it
  // (was every triangle for every corner: the biggest part of the building batch time, 75 ms on the Centre, ~330 ms on a phone). The accepted triangles and the result are the same.
  const nt = n / 3, tbb = new Float32Array(nt * 4);
  for (let t = 0, q = 0; t < n; t += 3, q += 4) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const x0 = Math.min(P[a], P[b], P[c]), x1 = Math.max(P[a], P[b], P[c]), z0 = Math.min(P[a + 2], P[b + 2], P[c + 2]), z1 = Math.max(P[a + 2], P[b + 2], P[c + 2]);
    const pad = 5e-4 * (x1 - x0 + z1 - z0) + 1e-3;
    tbb[q] = x0 - pad; tbb[q + 1] = x1 + pad; tbb[q + 2] = z0 - pad; tbb[q + 3] = z1 + pad;
  }
  const sample = (lx, lz) => {
    let best = -1;
    for (let t = 0, q = 0; t < n; t += 3, q += 4) {
      if (lx < tbb[q] || lx > tbb[q + 1] || lz < tbb[q + 2] || lz > tbb[q + 3]) continue;
      const a = at(t), b = at(t + 1), c = at(t + 2);
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d > -1e-9 && d < 1e-9) continue;                    // vertical face: no area in plan
      const u = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / d;
      const v = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
      const y = u * P[a + 1] + v * P[b + 1] + w * P[c + 1];
      if (y > best) best = y;
    }
    return best;
  };
  let lo = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const vx = ring[k][0] - it.x, vz = ring[k][1] - it.z;
    let y = sample(vx * (1 - CORNER_INSET), vz * (1 - CORNER_INSET));
    if (y < 0.5) y = sample(vx * 0.8, vz * 0.8);              // just outside a simplified outline: step further in
    if (y >= 0.5) { out[k] = y; if (y < lo) lo = y; }
  }
  if (!Number.isFinite(lo)) lo = Math.min(it.h, it.hBox || it.h);
  for (let k = 0; k < out.length; k++) if (out[k] < 0.5) out[k] = lo;
  return out;
}

export function flatHeight(b, area, hs) {
  const rh = Math.max(3, +b.h || 8);
  if (b.t === 'aux' && hs && hs[0] < 0.5 && rh > 6) return 3.2; // courtyard 'building' the reality mesh shows as open ground (76 in the centre): a low shed, not an 18 m box with a stray roof colour
  if (!hs || b.t === 'aux') return rh;
  const [p90, p50] = hs;
  if (!(p90 >= 2)) return rh;
  if ((area < 60 && p90 > rh * 1.8 + 3) || (area < 250 && p90 > rh * 1.5 + 4)) return rh; // small + much taller than the survey says: tree canopy / crane in the mesh (review M-15: tall thin blades in the forest)
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

const GLASS_COL = [0.5, 0.62, 0.72], TRIM_COL = [0.2, 0.21, 0.23], GLASS_WIN = [3.2, 127.5, 1.7, 0.9]; // curtain-wall panes (window shader draws the dark panes), clock hands / frames
STYLE_WIN[10] = { floorH: 4.6, spacing: 5.4, frac: 0.7 };  // 10 modernist public hall (station, theatre slab): wide low ribbon windows
STYLE_WIN[11] = { floorH: 4.4, spacing: 3.3, frac: 0.55 }; // 11 brick warehouse / market hall: small regular openings
STYLE_WIN[12] = { floorH: 3.0, spacing: 2.6, frac: 0.9 };  // 12 timber house: board walls with many small windows
STYLE_WIN[13] = { floorH: 3.8, spacing: 2.2, frac: 0.85 }; // 13 institutional (school / hospital / public): ribbon windows, dark base band, string course (sights)
STYLE_WIN[14] = { floorH: 6.0, spacing: 4.5, frac: 0.75 }; // 14 blind monumental (theatre / museum): blank walls, glazed foyer band, pilasters, cornice
STYLE_WIN[15] = { floorH: 5.0, spacing: 6.0, frac: 0.25 }; // 15 castle stone: thick plain walls, small slit windows
STYLE_WIN[16] = { floorH: 3.4, spacing: 2.8, frac: 0.95 }; // 16 historic plaster house: windows with light surrounds
STYLE_WIN[7] = { floorH: 7.4, spacing: 4.2, frac: 0.65 };  // 7 plastered baroque / classicist church: tall round-arched windows (frac 0.65 = round-arch code in the window shader)
STYLE_WIN[8] = { floorH: 3.4, spacing: 2.3, frac: 0.8 };   // 8 wooden church: small rectangular windows in rows (Jēzus baznīca, Mežaparks)
STYLE_WIN[9] = { floorH: 6.4, spacing: 3.3, frac: 0.65 };  // 9 Orthodox church: narrow tall round-arched windows, cream walls
/** Indexed geometry from a decoded riga-shapes record: roof triangles (colour by slope / type) + walls extruded from the outline loops. */
function buildShapeGeometry(S, rec, colFn, winParams, wallCol, decoFn, samp = null) { // [S] samp
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
  const classCol = [cols.roof, cols.roof, plain, cols.special, plain, cols.accent, plain, GLASS_COL, TRIM_COL]; // 7 glass, 8 dark trim (shapes.js)
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
      } else b.idx.push(b.vert(px(i), py(i), pz(i), col, c === 7 ? GLASS_WIN : noWin, [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]]));
    }
  }
  // walls
  const L = S.L;
  let p = rec.ol;
  const end = rec.ol + rec.nl;
  let ek = 0; // [S] running edge number (key of wallEdges / facadeRuns)
  while (p < end) {
    const len = L[p], y0 = L[p + 1] * inv; p += 3;
    for (let i = 0; i < len; i++) {
      const A = L[p + i], B = L[p + ((i + 1) % len)]; const myK = ek++;
      const ya = py(A), yb = py(B);
      if (ya - y0 < 0.05 && yb - y0 < 0.05) continue;
      const ex = px(B) - px(A), ez = pz(B) - pz(A), el = Math.hypot(ex, ez);
      if (el < 0.01) continue; // zero-length edge between two welded/step vertices
      let win = [winParams.floorH, Math.max(ya, yb), winParams.spacing, winParams.frac];
      const wn = [ez / el, 0, -ex / el];
      const sp = samp && samp.edge(myK); // [S]
      let wTop = wallTop, wBot = wallBot;
      if (sp) { win = sp.win(Math.max(ya, yb)); wTop = sp.top || wallTop; wBot = sp.bot || wallBot; b.ext = sp.ext; }
      const a0 = b.vert(px(A), y0, pz(A), wBot, win, wn), b0 = b.vert(px(B), y0, pz(B), wBot, win, wn);
      const b1 = b.vert(px(B), yb, pz(B), wTop, win, wn), a1 = b.vert(px(A), ya, pz(A), wTop, win, wn);
      b.ext = null; // [S]
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
  SAMP_BITS.rows.length = 0; // [S]
  const tb1 = performance.now();
  const rng = mulberry32(CFG.seed + 11);
  const C = new THREE.Color();
  const pickCol = (arr) => C.set(arr[Math.floor(rng() * arr.length)]).clone();
  const items = [];
  const geos = [];
  const landmarks = data.landmarks || [];
  const S = data.shapes || null;
  const slug = (data.meta && data.meta.slug) || 'centrs';
  const SIGHTS = data.sights ? data.sights.s : null; // id -> [cat, tier, lead, key, hint, piece] (src/sights.js)
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
    items.push({ id: b.id, x: cx, z: cz, area, h, hBox, fit, value, name: b.n || null, t: b.t || 'oth', landmark: false, ring: ring0, rel: ring, lmH: 0, rec, sight: SIGHTS ? SIGHTS[b.id] || null : null });
  }

  span('bld-pass1', tb1);
  const tb2 = performance.now();
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

  // tier A sights carry their real names (the cadastre often only has the street address): album / labels / achievements match on the name; value, fit and landmark flags are untouched
  for (const it of items) {
    if (!it.sight || !it.sight[3]) continue;
    const A = TIER_A_BY_KEY.get(it.sight[3]);
    if (A && (!it.name || isAddressName(it.name))) it.name = A.lv;
  }

  // a sight needs a hole proportionate to its real size: fit from the footprint AND the height (a 40 m landmark is not a 6 m kiosk with a nice texture)
  for (const it of items) {
    if (it.landmark || (it.sight && it.sight[3] && TIER_A_BY_KEY.has(it.sight[3]))) it.fit = Math.max(it.fit, Math.min(CFG.sightFit.heightFrac * it.h, CFG.sightFit.max));
  }

  const OTHERS = SIGHTS ? items.filter((it) => !it.sight) : []; // ordinary buildings: the neighbours a tier B sight must differ from (src/sights.js neighbourRef)

  span('bld-landmarks-sights', tb2);
  const tb3 = performance.now();
  let tSight = 0;
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
    if (t === 'res' || t === 'pub' || t === 'oth' || t === 'rel') { const zr = zoneRoof(slug, zone, it.x, it.z); if (zr) roofCol.setHex(zr); }
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
    const panel = slug === 'purvciems' && !rule && !it.sight && (t === 'res' || t === 'com' || t === 'pub' || t === 'oth') && area > 200 && it.h >= 8 && !(rec && rec.style);
    const bigFlat = slug === 'purvciems' && !rule && !it.sight && !panel && area > 350 && t !== 'rel' && t !== 'aux' && !(rec && rec.style); // big shops / halls: flat grey roofs too
    if (bigFlat) roofCol.setHex([0x77797c, 0x6e7073, 0x808285][Math.abs((it.x * 3 + it.z * 5) | 0) % 3]);
    if (panel) {
      wallCol.setHex(PANEL_WALLS[Math.abs((it.x * 7 + it.z * 13) | 0) % PANEL_WALLS.length]); it.wallCol = wallCol.getHex();
      Object.assign(winParams, { floorH: 2.8, spacing: 2.7, frac: 1 });
      roofCol.setHex([0x77797c, 0x6e7073, 0x808285][Math.abs((it.x * 3 + it.z * 5) | 0) % 3]);
    }
    // sights (src/sights.js): category facade style + wall / roof palette outside the housing palette + one signature feature (tier A overrides per building)
    const tt0 = it.sight ? performance.now() : 0;
    const T = it.sight ? treatmentFor(it.sight, rec, it.x, it.z, it.sight[1] <= 1 ? neighbourRef(it, OTHERS, slug) : 0) : null;
    if (tt0) tSight += performance.now() - tt0;
    if (T) {
      if (T.wall != null) { wallCol.setHex(T.wall); it.wallCol = T.wall; }
      if (T.roof != null) roofCol.setHex(T.roof);
      if (STYLE_WIN[T.style]) Object.assign(winParams, STYLE_WIN[T.style]);
      it.sightCat = T.cat;
    }
    const nm = it.name || '';
    // [S] sampled parameters: ordinary buildings from level 1, landmark-rule / tier A sight heroes (curated palettes and styles) only at level 3
    const SM = SAMP(), SP = SM && SM.level >= 1 && SM.params ? SM.params.get(it.id) : null;
    const curated = !!rule || !!(it.sight && it.sight[3] && TIER_A_BY_KEY.has(it.sight[3])); // hand-curated heroes (landmark rules, tier A sights)
    const guarded = curated; // hand-curated heroes (landmark rules, tier A sights) keep palette + facade style; sights with a treatment (tiers B / C) take the sampled colours but keep their facade style and features (rhythm is not applied to them)
    const useS = !!SP && (!guarded || SM.level >= 3);
    it.sampled = useS; it.hero = curated;
    let sampW = null, sampR = null, sampRhythm = false;
    if (useS) {
      sampW = SP.w || null; sampR = SP.r || null;
      if (guarded) { // level 3: a curated colour is only replaced by a high-confidence sample that is close to it
        if (sampW && !(SP.q && SP.q[0] >= 3 && labDist(sampW, wallCol.getHex()) < 22)) sampW = null;
        if (sampR && !(SP.q && SP.q[2] >= 3 && labDist(sampR, roofCol.getHex()) < 22)) sampR = null;
      } else sampRhythm = !!SP.fh && !T;
      if (sampW) { wallCol.setHex(hexOf(sampW)); it.wallCol = hexOf(sampW); } if (sampR) roofCol.setHex(hexOf(sampR));
      if (SM.level >= 2 && sampRhythm) Object.assign(winParams, { floorH: SP.fh, spacing: SP.sp, frac: 1 });
    }
    it.wallHex = it.wallCol; it.roofHexIn = roofCol.getHex();

    if (rec) {
      // ---- measured shape: roof colours by type, decorations dropped (the data has the real spires/domes), except the cat
      const orth = RE_ORTHODOX.test(nm);
      if (!T && rec.wallRGB && !(useS && sampW)) { wallCol.setHex(rec.wallRGB); it.wallCol = rec.wallRGB; } // [S] !useS
      if (!T && rec.style && STYLE_WIN[rec.style] && !(useS && sampRhythm && SM.level >= 2)) Object.assign(winParams, STYLE_WIN[rec.style]);
      const hash = Math.abs((it.x * 7 + it.z * 3) | 0);
      let pitchCol;
      if (rec.roofRGB) pitchCol = new THREE.Color(rec.roofRGB);
      else if (rule && rule.roof) pitchCol = roofCol.clone();
      else if (zone === 'old') { const zr = t === 'res' || t === 'pub' || t === 'oth' || t === 'rel' ? zoneRoof(slug, zone, it.x, it.z) : 0; pitchCol = new THREE.Color(zr || P.oldTownRoof[hash % P.oldTownRoof.length]); }
      else { const r = rng(); const zr = t === 'res' || t === 'pub' || t === 'oth' || t === 'rel' ? zoneRoof(slug, zone, it.x, it.z) : 0; pitchCol = new THREE.Color(slug === 'centrs' && (t === 'res' || t === 'pub' || t === 'oth' || t === 'rel') ? zr || TILE[hash % TILE.length] : r < 0.62 ? TILE[hash % TILE.length] : r < 0.93 ? TIN[hash % TIN.length] : TIN_GREEN[hash % TIN_GREEN.length]); }
      if (panel || bigFlat || (T && T.roof != null)) pitchCol = roofCol.clone();
      if (useS && sampR) pitchCol = new THREE.Color(hexOf(sampR)); // [S]
      let flatCol = panel || bigFlat || (T && T.roof != null) ? roofCol.clone() : rec.roofRGB ? pitchCol.clone() : new THREE.Color(TAR[hash % TAR.length]);
      const specialCol = new THREE.Color(T && T.dome ? T.dome : T && !rec.domeRGB ? pitchCol.getHex() : rec.domeRGB ? rec.domeRGB : orth ? 0xe2b23a : rule && rule.roof ? rule.roof : (hash % 3 === 0 ? 0x5a6a74 : 0x5f9d89));
      const accentCol = new THREE.Color(rec.accentRGB || 0xe3b53c);
      if (useS && sampR) flatCol = pitchCol.clone(); // [S]
      const colFn = (flatDominant) => { const r = flatDominant ? flatCol : pitchCol; return { roof: [r.r, r.g, r.b], special: [specialCol.r, specialCol.g, specialCol.b], accent: [accentCol.r, accentCol.g, accentCol.b] }; };
      let decoFn = null, sfTop = 0;
      const flatRoof = rec.hmax - rec.eave < 1.5;
      if (T && T.feats.length) { // signature feature(s) of the sight (src/sightFeatures.js) on the measured roof: eave height for pitched roofs, the top for flat ones / crowns
        decoFn = (b) => {
          for (const f of T.feats) {
            const base = f.kind === 'crown' ? rec.hmax - 0.4 : flatRoof ? rec.hmax : Math.max(3, rec.eave);
            const spec = { ...f, base, flat: flatRoof, top: rec.hmax };
            const ex = SF_KINDS.has(f.kind) ? addSightFeature(b, spec, ring, wallCol, roofCol) : addDeco(b, spec, ring, base, wallCol, roofCol);
            sfTop = Math.max(sfTop, base + ex);
          }
        };
      } else if (rule && rule.deco && rule.deco.kind === 'cat') {
        decoFn = (b, px, py, pz) => { // cat on the highest points (turret tips), at most two, >5 m apart
          const pts = [];
          for (let i = 0; i < rec.nv; i++) pts.push([px(i), py(i), pz(i)]);
          pts.sort((a, c) => c[1] - a[1]);
          const tips = [];
          for (const q of pts) { if (tips.length < 2 && tips.every((u) => Math.hypot(u[0] - q[0], u[2] - q[2]) > 5)) tips.push(q); }
          for (const q of tips) addCat(b, q[0], q[1] - 0.1, q[2]);
        };
      }
      let samp = null; // [S]
      if (SM && (useS || SM.collect)) {
        const edges = wallEdgesShape(S, rec), RI = facadeRuns(edges); it.edges = edges; it.runs = RI.runs; it.runOf = RI.of;
        if (useS) samp = makeSamp(SP, sampRhythm ? SM.level : 1, edges, RI, winParams, sampW);
      }
      const geo = buildShapeGeometry(S, rec, colFn, winParams, wallCol, decoFn, samp);
      it.h = T && T.feats.length ? Math.max(rec.hmax, sfTop) : rec.hmax + (decoFn ? 2 : 0);
      it.shaped = true;
      if (rec.src === 2) stats.osm++; else if (rec.src === 1) stats.meshNotable++; else stats.meshRelief++;
      it.geo = geo;
      it.roofHex = (geo.userData.flatDominant ? flatCol : pitchCol).getHex();
      if (rec.src === 3) { // lighter variant for the `low` quality tier: a flat extrusion with the measured height
        const bg = buildBuildingGeometry(ring, it.hBox, wallCol, roofCol, null, winParams, T && T.feats.length ? T.feats.map((f) => ({ ...f, base: it.hBox, flat: true })) : null);
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
    if (T && T.feats.length) { // signature feature(s) replace the generic rule / flag decorations (the rng draws above stay as they were, so ordinary buildings keep their looks)
      if (!spire) { decos.length = 0; for (const f of T.feats) decos.push({ ...f, base: h, flat: true }); }
      else for (const f of T.feats) if (f.kind !== 'cote') decos.push({ ...f, base: h, flat: true });
    }
    let mansard = null;
    if (!panel && !bigFlat && !spire && !(rule && rule.deco) && (t === 'res' || t === 'pub' || t === 'oth' || t === 'rel') && h > 7 && h < 40 && hull > 0 && area / hull > 0.82 &&
        minSide > 8 && ring.length <= 24 && rng() < 0.7) {
      mansard = { s: 0.62 + rng() * 0.12, rh: Math.min(4.5, 0.22 * minSide + 0.5) };
    }
    if (T) mansard = null; // sights are not mansard-roofed housing
    let samp = null; // [S]
    if (SM && (useS || SM.collect)) {
      const edges = wallEdgesFlat(ring), RI = facadeRuns(edges); it.edges = edges; it.runs = RI.runs; it.runOf = RI.of;
      if (useS) samp = makeSamp(SP, sampRhythm ? SM.level : 1, edges, RI, winParams, sampW);
    }
    const geo = buildBuildingGeometry(ring, h, wallCol, roofCol, mansard, winParams, decos.length ? decos : null, samp);
    if (!geo) { it.drop = true; continue; }
    it.h = h + (geo.userData.extraH || 0);
    it.roofHex = roofCol.getHex();
    stats.flat++;
    it.geo = geo;
    totalV += geo.attributes.position.count;
    totalI += geo.index.count;
  }
  const kept = items.filter((it) => !it.drop);
  stats.buildings = kept.length;

  const mat = makeBuildingMaterial();
  span('bld-geometry', tb3);
  try { performance.measure('bd:bld-sights-treatment(in geometry)', { start: tb3, end: tb3 + tSight }); } catch { /* ignore */ }
  const tb4 = performance.now();
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
    // roof height at every footprint corner (for rooftop flags)
    if (it.ring) it.cornerH = cornerHeights(it);
    it.geo.dispose(); it.geo = null;
    if (it.boxGeo) { it.boxGeo.dispose(); it.boxGeo = null; }
    it.rec = null;
  }
  span('bld-batch', tb4);
  SAMP_BITS.uniform.value = bitsTexture(SAMP_BITS.rows); // [S]
  return { mesh, items: kept, stats };
}
