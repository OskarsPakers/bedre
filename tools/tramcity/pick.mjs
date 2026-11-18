// debug: ray-pick a pixel of the tram city at a route position and print the face's attributes.  node tools/tramcity/pick.mjs <s> <px> <py> [route]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { buildTrack } from '../../src/proto/tram/track.js';
import { poseAt } from '../realistic/poses.mjs';
const [s, px, py, route = 'centrs-3'] = process.argv.slice(2);
const T = buildTrack(JSON.parse(fs.readFileSync(`src/proto/tram/routes/${route}.json`, 'utf8')));
const c = poseAt(T, +s, 9).cab;
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
await pg.goto(`http://localhost:5193/tramvajs/?route=${route}&lang=en`);
await pg.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await pg.evaluate((o) => window.__tram.setCamera(o), { x: c.x, y: c.up, z: c.z, lx: c.lx, ly: c.lup, lz: c.lz, fov: 78 });
await pg.waitForTimeout(800);
const r = await pg.evaluate(([px, py]) => { const S = window.__tram.S, T = S.THREE, cam = window.__tram.camera; const rc = new T.Raycaster(); rc.setFromCamera(new T.Vector2(px / 1280 * 2 - 1, -(py / 720) * 2 + 1), cam);
  const h = rc.intersectObject(S.city.group, true)[0]; if (!h) return null; const g = h.object.geometry, a = g.attributes, i = h.face.a;
  const o = { dist: h.distance, point: h.point.toArray(), col: [a.color.getX(i), a.color.getY(i), a.color.getZ(i)], nrm: [a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i)] };
  if (a.aA) { o.aA = [a.aA.getX(i), a.aA.getY(i), a.aA.getZ(i), a.aA.getW(i)]; o.aB = [a.aB.getX(i), a.aB.getY(i), a.aB.getZ(i), a.aB.getW(i)]; o.uvw = [a.uvw.getX(i), a.uvw.getY(i), a.uvw.getZ(i), a.uvw.getW(i)]; }
  const its = S.world.buildingItems.map((it) => [Math.hypot(it.x - h.point.x, it.z - h.point.z), it]).sort((p, q) => p[0] - q[0]).slice(0, 3).map(([d, it]) => ({ d: Math.round(d), id: it.id, h: it.h, t: it.t, name: it.name }));
  o.near = its; return o; }, [+px, +py]);
console.log(JSON.stringify(r)); await b.close();
