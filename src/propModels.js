// Tiny procedural models for swallowable props. Units: metres, origin at ground, long axis = +X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';

const WHITE = new THREE.Color(1, 1, 1);

function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const box = (w, h, d, c, x, y, z) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z);
const cyl = (r, h, c, x, y, z, seg = 8) => part(new THREE.CylinderGeometry(r, r, h, seg), c, x, y, z);
const merge = (parts) => mergeGeometries(parts, false);

function person(shirt, pants) {
  return merge([
    // 90 triangles (was 168): people are the most numerous prop on the dense district maps and only ~2 m tall on screen
    part(new THREE.CapsuleGeometry(0.17, 0.5, 1, 5), pants, 0, 0.5, 0),
    part(new THREE.CapsuleGeometry(0.22, 0.4, 1, 5), shirt, 0, 1.2, 0),
    part(new THREE.SphereGeometry(0.16, 5, 4), 0xe6b99a, 0, 1.72, 0),
  ]);
}

const NAVY = 0x1d5ea8, TWHITE = 0xf1f4f6, TDARK = 0x24303b, TGREY = 0xccd3d9, AMBER = 0xffb21a;
const rbox = (w, h, d, c, x, y, z, rx = 0, ry = 0, rz = 0) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);

function car(body = WHITE, taxi = false) {
  const dark = 0x232a31;
  return merge([
    box(4.2, 0.7, 1.8, body, 0, 0.62, 0),
    box(2.2, 0.62, 1.62, 0x2c3944, -0.25, 1.26, 0),
    box(2.0, 0.08, 1.5, body, -0.25, 1.62, 0),
    ...(taxi ? [box(0.55, 0.16, 0.28, 0xfff3c4, -0.25, 1.74, 0), box(4.22, 0.1, 1.82, 0x1b1b1b, 0, 0.84, 0)] : []),
    ...[[1.3, 0.85], [-1.3, 0.85], [1.3, -0.85], [-1.3, -0.85]].map(([x, z]) =>
      part(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 6), dark, x, 0.33, z, Math.PI / 2)),
  ]);
}

function van() {
  const dark = 0x232a31;
  return merge([
    box(5.2, 1.5, 1.95, WHITE, 0, 1.25, 0),
    box(1.5, 0.7, 1.97, 0x2c3944, 1.85, 1.65, 0),
    box(5.2, 0.12, 1.97, 0xdddddd, 0, 2.05, 0),
    ...[[1.6, 0.9], [-1.6, 0.9], [1.6, -0.9], [-1.6, -0.9]].map(([x, z]) =>
      part(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 8), dark, x, 0.38, z, Math.PI / 2)),
  ]);
}

/** Rīga-municipal-style blue/white body segment centred at x0 with length len (front = +x). */
function transitBody(len, x0, h, roofBlue) {
  const y0 = 0.5;
  return [
    rbox(len, 0.9, 2.5, NAVY, x0, y0 + 0.45, 0),                   // blue skirt
    rbox(len, h - 1.4, 2.5, TWHITE, x0, y0 + 0.9 + (h - 1.4) / 2, 0), // white upper body
    rbox(len + 0.04, 0.85, 2.54, TDARK, x0, y0 + 1.5, 0),           // dark window band
    rbox(len - 0.3, 0.2, 2.2, roofBlue ? NAVY : TGREY, x0, y0 + h + 0.0, 0), // roof
  ];
}
const wheel = (x, z, r = 0.5) => part(new THREE.CylinderGeometry(r, r, 0.3, 8), 0x1d2227, x, r, z, Math.PI / 2);
const board = (x, y) => [rbox(0.1, 0.38, 1.5, AMBER, x, y, 0), rbox(0.11, 0.2, 1.1, 0x5a3b08, x, y, 0)];

function bus() {
  return merge([
    ...transitBody(11.5, 0, 3.0, false),
    ...board(5.78, 3.6),
    rbox(0.1, 1.3, 2.3, TDARK, 5.78, 1.9, 0),
    ...[[3.6, 1.2], [-3.4, 1.2], [3.6, -1.2], [-3.4, -1.2]].map(([x, z]) => wheel(x, z)),
  ]);
}

function trolleybus() {
  const pole = (z) => rbox(4.8, 0.07, 0.07, 0x30363b, -4.3, 4.35, z, 0, 0, -0.5);
  return merge([
    ...transitBody(11.8, 0, 3.0, true),
    ...board(5.9, 3.6),
    rbox(0.1, 1.3, 2.3, TDARK, 5.9, 1.9, 0),
    pole(0.45), pole(-0.45),
    rbox(0.5, 0.2, 1.4, 0x30363b, -2.4, 3.65, 0),
    ...[[3.6, 1.2], [-3.4, 1.2], [3.6, -1.2], [-3.4, -1.2]].map(([x, z]) => wheel(x, z)),
  ]);
}

/** low-floor articulated tram, ~25 m */
function tram() {
  return merge([
    ...transitBody(11.4, -6.3, 3.0, true),
    ...transitBody(11.4, 6.3, 3.0, true),
    rbox(1.4, 2.3, 2.3, 0x1f262c, 0, 1.9, 0),            // articulation bellows
    rbox(1.2, 0.2, 2.0, NAVY, 0, 3.5, 0),
    ...board(12.05, 3.6),
    rbox(0.1, 1.5, 2.3, TDARK, 12.05, 1.95, 0),
    rbox(1.3, 0.05, 1.0, 0x30363b, -6.5, 4.15, 0), rbox(0.06, 0.6, 0.06, 0x30363b, -6.5, 3.85, 0),
    rbox(24.6, 0.35, 2.2, 0x3a4047, 0, 0.45, 0),          // undercarriage
    ...[-9, -3.5, 3.5, 9].map((x) => rbox(1.6, 0.5, 2.0, 0x24282d, x, 0.35, 0)),
  ]);
}

function shelter() {
  return merge([
    rbox(3.2, 0.12, 1.5, 0x9aa7b0, 0, 2.45, 0),
    rbox(3.2, 1.9, 0.06, 0x7fa0b6, 0, 1.4, -0.7),
    rbox(0.08, 2.45, 0.08, 0x3a4047, -1.55, 1.22, 0.65), rbox(0.08, 2.45, 0.08, 0x3a4047, 1.55, 1.22, 0.65),
    rbox(2.0, 0.07, 0.4, 0x7a5a3a, 0, 0.55, -0.4),
    cyl(0.05, 3.2, 0x3a4047, 2.3, 1.6, 0.4, 6),
    rbox(0.1, 0.55, 0.55, NAVY, 2.3, 3.0, 0.4),
    rbox(0.11, 0.3, 0.3, 0xffffff, 2.3, 3.0, 0.4),
  ]);
}

function flag() {
  return merge([
    cyl(0.07, 7, 0xb9b3a6, 0, 3.5, 0, 6),
    part(new THREE.SphereGeometry(0.12, 6, 4), 0xd9b24a, 0, 7.05, 0),
    rbox(1.7, 0.4, 0.03, 0x9e1b32, 0.9, 6.5, 0),
    rbox(1.7, 0.2, 0.03, 0xffffff, 0.9, 6.2, 0),
    rbox(1.7, 0.4, 0.03, 0x9e1b32, 0.9, 5.9, 0),
  ]);
}

function parasol() {
  return merge([
    cyl(0.04, 2.4, 0x6a6a6a, 0, 1.2, 0, 5),
    part(new THREE.ConeGeometry(1.5, 0.55, 8), WHITE, 0, 2.55, 0),
    cyl(0.5, 0.05, 0xf0ece2, 0, 0.78, 0.0, 8), cyl(0.04, 0.78, 0x4a4a4a, 0, 0.39, 0, 5),
    rbox(0.4, 0.05, 0.4, 0x6b4a33, 1.0, 0.45, 0), rbox(0.4, 0.05, 0.4, 0x6b4a33, -1.0, 0.45, 0),
    rbox(0.4, 0.05, 0.4, 0x6b4a33, 0, 0.45, 1.0), rbox(0.4, 0.05, 0.4, 0x6b4a33, 0, 0.45, -1.0),
  ]);
}

function cafeset() { // café table for two: white round top, two rattan chairs facing each other
  const chair = (x, ry) => [
    rbox(0.42, 0.06, 0.42, 0x8a5e3b, x, 0.46, 0), rbox(0.06, 0.42, 0.42, 0x6b4a33, x + Math.sign(x) * 0.2, 0.7, 0),
    rbox(0.04, 0.44, 0.04, 0x3a3f44, x - 0.17, 0.22, 0.17), rbox(0.04, 0.44, 0.04, 0x3a3f44, x + 0.17, 0.22, -0.17),
    rbox(0.04, 0.44, 0.04, 0x3a3f44, x + 0.17, 0.22, 0.17), rbox(0.04, 0.44, 0.04, 0x3a3f44, x - 0.17, 0.22, -0.17),
  ];
  return merge([
    cyl(0.4, 0.05, 0xf3efe6, 0, 0.76, 0, 10), cyl(0.04, 0.74, 0x3a3f44, 0, 0.37, 0, 5), cyl(0.2, 0.04, 0x3a3f44, 0, 0.02, 0, 6),
    cyl(0.07, 0.12, 0xb94a3a, 0.08, 0.84, 0.05, 5), // a cup / candle
    ...chair(0.75), ...chair(-0.75),
  ]);
}

function stall() {
  const flowers = [0xe84a6f, 0xf4c430, 0xffffff, 0xb066d9, 0xff8a3d];
  return merge([
    rbox(2.4, 0.9, 1.0, 0x8a5e3b, 0, 0.45, 0),
    rbox(0.07, 2.3, 0.07, 0x5a4a3a, -1.15, 1.15, -0.55), rbox(0.07, 2.3, 0.07, 0x5a4a3a, 1.15, 1.15, -0.55),
    rbox(0.07, 1.9, 0.07, 0x5a4a3a, -1.15, 0.95, 0.65), rbox(0.07, 1.9, 0.07, 0x5a4a3a, 1.15, 0.95, 0.65),
    rbox(2.7, 0.07, 1.6, WHITE, 0, 2.15, 0.05, -0.18, 0, 0),
    ...flowers.map((c, i) => part(new THREE.CylinderGeometry(0.17, 0.13, 0.4, 6), c, -0.9 + i * 0.45, 1.1, 0.1)),
  ]);
}

function bike() {
  const ring = (x) => part(new THREE.TorusGeometry(0.33, 0.03, 4, 10), 0x2b2b2b, x, 0.36, 0);
  return merge([ring(0.5), ring(-0.5), rbox(1.0, 0.04, 0.04, WHITE, 0, 0.62, 0, 0, 0, 0.0), rbox(0.5, 0.04, 0.04, WHITE, 0.2, 0.5, 0, 0, 0, -0.9),
    rbox(0.04, 0.35, 0.04, 0x2b2b2b, 0.5, 0.8, 0), rbox(0.04, 0.04, 0.5, 0x2b2b2b, 0.5, 0.98, 0), rbox(0.25, 0.05, 0.12, 0x2b2b2b, -0.4, 0.82, 0)]);
}

function scooter() {
  return merge([
    rbox(0.9, 0.06, 0.2, WHITE, 0, 0.18, 0), rbox(0.04, 1.0, 0.04, 0x2b2b2b, 0.42, 0.65, 0), rbox(0.04, 0.04, 0.45, 0x2b2b2b, 0.42, 1.15, 0),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8), 0x1d2227, 0.42, 0.1, 0, Math.PI / 2),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8), 0x1d2227, -0.4, 0.1, 0, Math.PI / 2)]);
}

function lantern() { // old-style cast iron street lantern
  return merge([
    cyl(0.18, 0.5, 0x23292d, 0, 0.25, 0, 6), cyl(0.07, 3.0, 0x23292d, 0, 2.0, 0, 6),
    rbox(0.5, 0.06, 0.06, 0x23292d, 0.25, 3.4, 0, 0, 0, 0.3),
    rbox(0.32, 0.5, 0.32, 0xffe3a0, 0, 3.55, 0), part(new THREE.ConeGeometry(0.28, 0.3, 4), 0x23292d, 0, 3.95, 0, 0, Math.PI / 4),
  ]);
}

function boat() { // canal tour boat ~9 m
  return merge([
    rbox(9, 0.8, 2.4, TWHITE, 0, 0.3, 0), rbox(9.05, 0.25, 2.45, NAVY, 0, 0.1, 0),
    part(new THREE.ConeGeometry(1.2, 1.4, 4), TWHITE, 4.9, 0.3, 0, 0, Math.PI / 4, -Math.PI / 2),
    rbox(6, 0.85, 2.1, 0x6e93ad, -0.5, 1.15, 0), rbox(6.2, 0.1, 2.3, TWHITE, -0.5, 1.65, 0),
    rbox(0.4, 0.5, 0.4, 0x30363b, -3.2, 1.9, 0),
  ]);
}

function ferry() { // ~26 m
  return merge([
    rbox(26, 1.6, 6, TWHITE, 0, 0.7, 0), rbox(26.1, 0.5, 6.1, NAVY, 0, 0.1, 0),
    part(new THREE.ConeGeometry(2.9, 3.0, 4), TWHITE, 14.4, 0.7, 0, 0, Math.PI / 4, -Math.PI / 2),
    rbox(18, 1.6, 5.2, 0xdfe5e9, -1, 2.2, 0), rbox(18.1, 0.9, 5.25, TDARK, -1, 2.35, 0),
    rbox(10, 1.4, 4.4, 0xdfe5e9, -2, 3.7, 0), rbox(10.1, 0.7, 4.45, TDARK, -2, 3.8, 0),
    cyl(0.9, 2.6, NAVY, -4, 5.4, 0, 8), cyl(0.92, 0.5, 0xd9d9d9, -4, 6.2, 0, 8),
  ]);
}

function swan() {
  return merge([
    part(new THREE.CapsuleGeometry(0.25, 0.5, 2, 6), 0xffffff, 0, 0.3, 0, 0, 0, Math.PI / 2),
    part(new THREE.CapsuleGeometry(0.06, 0.55, 2, 5), 0xffffff, 0.45, 0.7, 0, 0, 0, -0.25),
    part(new THREE.SphereGeometry(0.1, 5, 4), 0xffffff, 0.55, 1.05, 0),
    rbox(0.14, 0.05, 0.06, 0xf08a24, 0.7, 1.04, 0),
    rbox(0.35, 0.05, 0.3, 0xf2f2f2, -0.3, 0.55, 0, 0, 0, 0.5),
  ]);
}

function pigeon() {
  return merge([
    part(new THREE.CapsuleGeometry(0.09, 0.16, 2, 5), WHITE, 0, 0.16, 0, 0, 0, Math.PI / 2),
    part(new THREE.SphereGeometry(0.06, 5, 4), WHITE, 0.17, 0.25, 0),
    rbox(0.03, 0.12, 0.03, 0x704a3a, 0.02, 0.06, 0),
    rbox(0.16, 0.02, 0.4, 0x9aa0a6, -0.02, 0.22, 0),
  ]);
}

function laima() { // slim clock column ~12 m
  const dial = (x, z, ry) => part(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 14), 0xf6f1e4, x, 9.8, z, Math.PI / 2, ry);
  return merge([
    box(2.4, 0.8, 2.4, 0xd6cfc0, 0, 0.4, 0), box(1.5, 8.6, 1.5, 0xe4ddcf, 0, 5.1, 0), box(2.2, 0.35, 2.2, 0xd6cfc0, 0, 9.5, 0),
    box(2.0, 2.4, 2.0, 0xe4ddcf, 0, 10.7, 0), dial(0, 1.02, 0), dial(0, -1.02, 0), dial(1.02, 0, Math.PI / 2), dial(-1.02, 0, Math.PI / 2),
    part(new THREE.ConeGeometry(1.5, 1.6, 4), 0x7a8f86, 0, 12.7, 0, 0, Math.PI / 4),
  ]);
}

/** Vanšu-style cable-stayed pylon: one tall tapering concrete pylon in the deck median with a single-plane harp/fan of stays,
 *  long main-span fan towards +x (over the river), shorter back-span fan towards -x. Bridge axis = +x; origin at deck level. */
function pylon() {
  const H = 96, CAB = 0xeef1f3, CON = 0xdedad2;
  const cab = (x0, y0, x1, y1, z) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
    return rbox(l, 0.16, 0.16, CAB, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, Math.atan2(dy, dx));
  };
  const parts = [
    rbox(7, 1.0, 6.5, 0xb9b4a9, 0, 0.5, 0),                                        // pier cap on the median
    part(new THREE.CylinderGeometry(1.5, 2.6, H, 4, 1), CON, 0, H / 2, 0, 0, Math.PI / 4), // tapering shaft
    rbox(2.6, 6, 2.6, 0xc9c4b9, 0, H - 9, 0),                                         // anchorage head
    part(new THREE.ConeGeometry(1.4, 3, 4), CON, 0, H + 1.5, 0, 0, Math.PI / 4),
    rbox(30, 0.5, 1.2, 0xc4bfb4, 0, 0.8, 0),                                          // median barrier under the stays
  ];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const ty = H - 12 - i * 3.2;                       // anchor heights on the pylon head
    const dm = 22 + i * 17, db = 14 + i * 7.5;         // deck anchors: main span (+x), back span (-x)
    for (const z of [0.55, -0.55]) parts.push(cab(0.8, ty, dm, 1.3, z), cab(-0.8, ty, -db, 1.3, z));
  }
  return merge(parts);
}

/** one steel arch span of a railway bridge (axis +x), ~48 m span */
function railarch() {
  const rx = 24, ry = 9, W = 5.2, parts = [];
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; pts.push([-Math.cos(a) * rx, 1 + Math.sin(a) * ry]); }
  for (const z of [W, -W]) {
    for (let i = 0; i < 12; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0;
      parts.push(rbox(Math.hypot(dx, dy) + 0.2, 0.7, 0.7, 0x5a6b78, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, Math.atan2(dy, dx)));
    }
    for (let i = 1; i < 12; i += 1) parts.push(rbox(0.1, pts[i][1] - 0.3, 0.1, 0x6f808c, pts[i][0], (pts[i][1] + 0.3) / 2, z));
    parts.push(rbox(50, 1.0, 0.8, 0x4d5964, 0, 0.5, z));
  }
  for (let i = 2; i <= 10; i += 2) parts.push(rbox(0.5, 0.5, W * 2, 0x5a6b78, pts[i][0], pts[i][1], 0));
  parts.push(rbox(50, 0.4, W * 2, 0x40484f, 0, 0.1, 0));
  return merge(parts);
}

function tree(low = false) {
  if (low) return merge([ // phone tier: 30 triangles
    part(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 4, 1, true), 0x6b4a33, 0, 1.3, 0),
    part(new THREE.IcosahedronGeometry(2.3, 0), WHITE, 0, 4.0, 0),
  ]);
  return merge([
    // 70 triangles (was 110): street / yard / park trees went from ~6 k to ~20 k per map (review M-08)
    part(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 5, 1, true), 0x6b4a33, 0, 1.3, 0),
    part(new THREE.IcosahedronGeometry(2.2, 0), WHITE, 0, 3.9, 0),
    part(new THREE.IcosahedronGeometry(1.5, 0), 0xe9f2d8, 0.9, 4.9, 0.5),
    part(new THREE.IcosahedronGeometry(1.3, 0), 0xdde9cc, -0.9, 4.5, -0.6),
  ]);
}

/** Scots pine (kind 'tree2'; the trace key is still 'tree'): tall slim bare trunk, a narrow dark layered crown. 28 triangles. */
function pine(low = false) {
  if (low) return merge([ // phone tier: 16 triangles
    part(new THREE.CylinderGeometry(0.2, 0.28, 6, 4, 1, true), 0x6e4b34, 0, 3, 0),
    part(new THREE.ConeGeometry(2.7, 5.2, 5, 1, true), 0x305a3b, 0, 4.2 + 2.6, 0),
    part(new THREE.ConeGeometry(1.7, 4.4, 5, 1, true), 0x3d6f47, 0, 7.8 + 2.2, 0),
  ]);
  const crown = (r, h, y, c) => part(new THREE.ConeGeometry(r, h, 6, 1, true), c, 0, y + h / 2, 0);
  return merge([
    part(new THREE.CylinderGeometry(0.18, 0.28, 7, 5, 1, true), 0x6e4b34, 0, 3.5, 0),
    crown(2.7, 3.6, 4.4, 0x2b5236), crown(2.15, 3.4, 6.5, 0x33603e), crown(1.45, 3.2, 8.6, 0x3d6f47),
  ]);
}

function bench() {
  return merge([
    box(1.6, 0.07, 0.45, 0x8a5e3b, 0, 0.45, 0),
    box(1.6, 0.4, 0.06, 0x8a5e3b, 0, 0.75, -0.22),
    box(0.08, 0.45, 0.4, 0x3a3f44, 0.7, 0.22, 0),
    box(0.08, 0.45, 0.4, 0x3a3f44, -0.7, 0.22, 0),
  ]);
}

function lamp() {
  return merge([
    cyl(0.07, 5.2, 0x3b4a45, 0, 2.6, 0, 6),
    cyl(0.16, 0.35, 0x3b4a45, 0, 0.17, 0, 6),
    box(1.0, 0.07, 0.07, 0x3b4a45, 0.45, 5.15, 0),
    box(0.5, 0.14, 0.28, 0xffe9b0, 0.9, 5.08, 0),
  ]);
}

function bin() {
  return merge([
    cyl(0.28, 0.9, 0x2f6b62, 0, 0.45, 0, 8),
    cyl(0.3, 0.07, 0x20463f, 0, 0.93, 0, 8),
  ]);
}

function kiosk() {
  return merge([
    box(2.6, 2.4, 2.0, WHITE, 0, 1.2, 0),
    box(2.9, 0.18, 2.3, 0x8a3f30, 0, 2.5, 0),
    box(2.0, 0.9, 0.06, 0x2c3944, 0, 1.5, 1.02),
    box(2.6, 0.12, 0.8, 0x6d8c7c, 0, 2.2, 1.35),
  ]);
}

function monument() { // ~20 m tall, base 8x8 (scaled per instance)
  return merge([
    box(8, 1.2, 8, 0xcfc8bb, 0, 0.6, 0),
    box(6, 1.2, 6, 0xd8d1c4, 0, 1.8, 0),
    box(3.4, 7, 3.4, 0xcdc6b8, 0, 5.9, 0),
    box(2.4, 6, 2.4, 0xd5cec0, 0, 12.4, 0),
    box(1.5, 2.6, 1.5, 0xb89868, 0, 16.7, 0),
    part(new THREE.ConeGeometry(0.7, 2.2, 5), 0xc9a24a, 0, 19.0, 0),
  ]);
}

/** Stylised Freedom Monument, ~42 m: stepped granite base, relief blocks, tapering shaft, copper figure with three gold stars. */
function freedom() {
  const g = 0xcfc8bb, g2 = 0xd8d1c4, g3 = 0xbdb5a6, cu = 0xb97a52, gold = 0xe8c34a;
  const shaft = (rt, rb, h, c, y) => part(new THREE.CylinderGeometry(rt, rb, h, 4, 1), c, 0, y, 0, 0, Math.PI / 4);
  return merge([
    box(15, 0.6, 15, g3, 0, 0.3, 0),
    box(12, 0.7, 12, g, 0, 0.95, 0),
    box(9, 6, 9, g2, 0, 4.3, 0),
    box(9.6, 0.4, 9.6, g3, 0, 7.5, 0),
    box(6.6, 4.2, 6.6, g, 0, 9.8, 0),
    box(7.1, 0.4, 7.1, g3, 0, 12.1, 0),
    shaft(1.6, 2.9, 21, g2, 22.8),
    box(3.4, 0.5, 3.4, g3, 0, 33.55, 0),
    box(1.7, 1.2, 1.7, g, 0, 34.4, 0),
    part(new THREE.CylinderGeometry(0.45, 0.9, 4.6, 8), cu, 0, 37.3, 0),
    part(new THREE.SphereGeometry(0.55, 8, 6), cu, 0, 40.0, 0),
    box(2.6, 0.22, 0.28, cu, 0, 39.2, 0),
    part(new THREE.SphereGeometry(0.4, 6, 5), gold, -1.35, 40.6, 0),
    part(new THREE.SphereGeometry(0.42, 6, 5), gold, 0, 41.5, 0),
    part(new THREE.SphereGeometry(0.4, 6, 5), gold, 1.35, 40.6, 0),
    box(0.16, 1.5, 0.16, cu, -1.2, 39.9, 0),
    box(0.16, 1.5, 0.16, cu, 1.2, 39.9, 0),
  ]);
}

/** Platform canopy (Rīga Central Station): arched silver-green barrel roof on two rows of steel posts, ~48 x 13 m, ridge along +x. */
function platformroof() {
  const L = 48, hw = 6.5, ys = 6.0, rise = 3.4, N = 8, roof = 0xa3b3ae, steel = 0x59636a, trim = 0xc9d2d0;
  const R = (hw * hw + rise * rise) / (2 * rise), ph = Math.asin(hw / R), yc = ys + rise - R;
  const pos = [];
  const pt = (i, x) => { const a = -ph + (2 * ph * i) / N; return [x, yc + R * Math.cos(a), R * Math.sin(a)]; };
  for (let i = 0; i < N; i++) { const A = pt(i, -L / 2), B = pt(i + 1, -L / 2), C = pt(i + 1, L / 2), D = pt(i, L / 2); pos.push(...A, ...C, ...D, ...A, ...B, ...C); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const roofG = part(g, roof, 0, 0, 0);
  const parts = [roofG];
  for (const z of [-hw + 0.5, hw - 0.5]) {
    for (let i = 0; i <= 6; i++) parts.push(cyl(0.2, ys, steel, -L / 2 + 1 + (i * (L - 2)) / 6, ys / 2, z, 6));
    parts.push(box(L, 0.45, 0.5, trim, 0, ys + 0.1, z)); // edge beam
  }
  parts.push(box(L + 0.2, 0.2, 2.2, trim, 0, ys + rise + 0.05, 0)); // ridge lantern strip
  return merge(parts);
}

export const PEOPLE_COLORS = [[0xd9533a, 0x2b3440], [0x3b82c4, 0x3a3a3a], [0xe8b83a, 0x2e3e52], [0x6a9a4a, 0x40372f],
  [0xe6dcc6, 0x2b2f38], [0x9a5aa8, 0x2a2a2a]];

/** kind -> definition. fit = swallow fit radius (m, before per-instance scale). */
export const PROP_DEFS = {};
PEOPLE_COLORS.forEach(([s, p], i) => {
  PROP_DEFS['person' + i] = { cls: 'person', make: () => person(s, p), fit: 0.4, h: 1.9, value: CFG.value.person, tint: false };
});
Object.assign(PROP_DEFS, {
  car: { cls: 'car', make: car, fit: 2.25, h: 1.7, value: CFG.value.car, tint: true },
  van: { cls: 'van', make: van, fit: 2.9, h: 2.4, value: CFG.value.van, tint: true },
  taxi: { cls: 'car', make: () => car(0xf2c418, true), fit: 2.25, h: 1.8, value: CFG.value.car + 2, tint: false },
  bus: { cls: 'bus', make: bus, fit: 5.6, h: 3.6, value: CFG.value.bus, tint: false },
  trolleybus: { cls: 'bus', make: trolleybus, fit: 5.8, h: 5.4, value: CFG.value.trolley, tint: false },
  tram: { cls: 'tram', make: tram, fit: 11, h: 4.6, value: CFG.value.tram, tint: false },
  shelter: { cls: 'kiosk', make: shelter, fit: 1.7, h: 3.2, value: CFG.value.shelter, tint: false },
  flag: { cls: 'flag', make: flag, fit: 0.6, h: 7.1, value: CFG.value.flag, tint: false },
  parasol: { cls: 'parasol', make: parasol, fit: 1.5, h: 2.8, value: CFG.value.parasol, tint: true },
  cafeset: { cls: 'bench', make: cafeset, fit: 0.9, h: 1.0, value: CFG.value.bench, tint: false },
  stall: { cls: 'stall', make: stall, fit: 1.6, h: 2.4, value: CFG.value.stall, tint: true },
  bike: { cls: 'bike', make: bike, fit: 0.5, h: 1.0, value: CFG.value.bike, tint: true },
  scooter: { cls: 'scooter', make: scooter, fit: 0.5, h: 1.2, value: CFG.value.bike, tint: true },
  lantern: { cls: 'lamp', make: lantern, fit: 0.5, h: 4.1, value: CFG.value.lamp + 1, tint: false },
  boat: { cls: 'boat', make: boat, fit: 4.6, h: 2.3, value: CFG.value.boat, tint: false },
  ferry: { cls: 'boat', make: ferry, fit: 13, h: 6.5, value: CFG.value.ferry, tint: false },
  swan: { cls: 'swan', make: swan, fit: 0.7, h: 1.2, value: CFG.value.swan, tint: false },
  pigeon: { cls: 'bird', make: pigeon, fit: 0.3, h: 0.4, value: CFG.value.bird, tint: true },
  laima: { cls: 'monument', make: laima, fit: 1.9, h: 13.5, value: CFG.value.laima, tint: false },
  pylon: { cls: 'monument', make: pylon, fit: 9, h: 98, value: CFG.value.pylon, tint: false },
  railarch: { cls: 'monument', make: railarch, fit: 13, h: 10, value: CFG.value.railarch, tint: false },
  tree: { cls: 'tree', make: tree, fit: 1.9, h: 6.3, value: CFG.value.tree, tint: true },
  tree2: { cls: 'tree', make: pine, fit: 1.5, h: 11.6, value: CFG.value.tree, tint: true },
  bench: { cls: 'bench', make: bench, fit: 0.85, h: 1.1, value: CFG.value.bench, tint: false },
  lamp: { cls: 'lamp', make: lamp, fit: 0.55, h: 5.3, value: CFG.value.lamp, tint: false },
  bin: { cls: 'bin', make: bin, fit: 0.35, h: 1.0, value: CFG.value.bin, tint: false },
  kiosk: { cls: 'kiosk', make: kiosk, fit: 1.9, h: 2.7, value: CFG.value.kiosk, tint: true },
  monument: { cls: 'monument', make: monument, fit: 4.2, h: 20, value: CFG.value.monument, tint: false },
  freedom: { cls: 'monument', make: freedom, fit: 6.2, h: 42, value: CFG.value.freedom, tint: false },
  platformroof: { cls: 'monument', make: platformroof, fit: 11, h: 10, value: CFG.value.platformroof, tint: false },
});

export const CAR_TINTS = [0xc9402f, 0x2f6fb5, 0xe9e5da, 0x2d3338, 0xb9bec2, 0x4b7a52, 0xe0b53c, 0x8c3b55];
export const BUS_TINTS = [0xd9a53a, 0x3b7fc4, 0xc9402f, 0x4b9a68];
export const TRAM_TINTS = [0xc9402f, 0xe4dcc5];
export const TREE_TINTS = [0x7fa65a, 0x6c9a4e, 0x8fb061, 0x5f8f50, 0xa3a85a, 0x7aa069];
export const PINE_TINTS = [0xffffff, 0xeaf2e4, 0xd9e6d2, 0xf4f4ea, 0xc9dcc4];
export const PARASOL_TINTS = [0xd9533a, 0x2f6fb5, 0xe8b83a, 0x4b9a68, 0xe9e5da, 0xc9402f];
export const STALL_TINTS = [0xd9533a, 0xe8b83a, 0x4b9a68, 0xc9a24a, 0xe4a0b8, 0x7fa0b6];
export const BIKE_TINTS = [0x2b6cb0, 0xc9402f, 0x2d3338, 0xe0b53c, 0x4b9a68, 0xb9bec2];
export const SCOOTER_TINTS = [0x2fd0b0, 0xb6e33a, 0xf2f2f2, 0xff7a3d];
export const BIRD_TINTS = [0x9aa0a8, 0xb8bdc4, 0x888e96, 0xf2f2f2];
export const KIOSK_TINTS = [0xe5c07b, 0xd8d2c4, 0x9bbfa8, 0xd98a6c];
