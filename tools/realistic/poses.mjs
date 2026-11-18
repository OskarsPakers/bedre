// Camera poses along a tram route stretch, in the game's local frame (x east, z south, m) + lon/lat. Mirrors src/proto/tram/main.js updateCamera (chase / cab).
import fs from 'node:fs'; import path from 'node:path';
import { buildTrack } from '../../src/proto/tram/track.js';
export const ORIGIN = { lat: 56.9515, lon: 24.1133 }, M_LAT = 111320, M_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
export const toLL = (x, z) => ({ lon: ORIGIN.lon + x / M_LON, lat: ORIGIN.lat - z / M_LAT });
const NOSE = 3.78, LEN = 25.2;
export function loadTrack(id) { const r = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../src/proto/tram/routes', id + '.json'), 'utf8')); return buildTrack(r); }
/** s = arc length of the tram's first door. returns {chase,cab}: {x,z,up (m above rail), lx,lz,lup, headingDeg (compass), pitch-deg}, plus tram {x,z,yaw} */
export function poseAt(T, s, v = 9, o = {}) {
  const p = {}, q = {}; T.at(s - (LEN - NOSE) - (o.chaseBack ?? 12), p); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
  const cx = p.x + rx * (o.chaseRight ?? 1.3), cz = p.z + rz * (o.chaseRight ?? 1.3), cup = o.chaseUp ?? 7.0; T.at(s + NOSE + 32 + v * 1.2, q);
  const chase = { x: cx, z: cz, up: cup, lx: q.x, lz: q.z, lup: 0.2 };
  T.at(s + NOSE - 0.9, p); const ax = -Math.sin(p.yaw), az = Math.cos(p.yaw); T.at(s + NOSE + 60, q);
  const cab = { x: p.x - ax * 0.45, z: p.z - az * 0.45, up: o.cabUp ?? 2.4, lx: q.x, lz: q.z, lup: 1.9 - (3.15 - (o.cabUp ?? 2.4)) };
  const t = {}; T.at(s, t);
  return { chase, cab, tram: { x: t.x, z: t.z, yaw: t.yaw } };
}
/** tram centre for the ArcGIS glTF symbol: lon/lat + compass heading (deg) */
export function tramSym(T, s) { const c = {}; T.at(s + NOSE - LEN / 2, c); return { ...toLL(c.x, c.z), heading: ((Math.atan2(Math.cos(c.yaw), -Math.sin(c.yaw)) * 180 / Math.PI) + 360) % 360 }; }
