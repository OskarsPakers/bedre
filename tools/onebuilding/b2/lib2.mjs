import { withPage } from '../shot.mjs'; import fs from 'node:fs';
export const BLD = { stockmann: { box: { x0: 122 - 15, x1: 286 + 15, z0: 540 - 15, z1: 645 + 15 } }, bernu: { box: { x0: 1239 - 15, x1: 1305 + 15, z0: -668 - 15, z1: -588 + 15 } } };
export const OUT = '/Users/oskars/projects/holeio/scripts/out/tramcity/', WORK = s => `/Users/oskars/projects/holeio/tools/.cache/onebuilding/work-${s}/`;
export const save = (f, d) => fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
export async function run(slug, fn, o = {}) { const b = BLD[slug].box; return withPage(async pg => { await pg.goto(`http://localhost:5198/scene.html?slug=${slug}&x0=${b.x0}&x1=${b.x1}&z0=${b.z0}&z1=${b.z1}`); await pg.waitForFunction('window.__d?.ready', null, { timeout: 400000 }); console.log(slug, JSON.stringify(await pg.evaluate('__d.stats'))); return fn(pg); }, { w: 1600, h: 900 }); }
