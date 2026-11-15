// Client side of the multiplayer object table (see worker/mp/table.js): the hash the server compares against, and the dump used by
// tools/mp/build-objects.mjs (which drives this very function inside a real browser against the real world build).
import { encodeTable, hashObjects } from '../../worker/mp/table.js';
import { CFG } from '../config.js';

export const worldHash = (world) => hashObjects(world.objects);

/** Build the table bytes from the live world (every object id = index in world.objects) + spawn candidates. */
export function dumpTable(world, picker) {
  const objs = world.objects;
  const maxFit = CFG.hole.startRadius * CFG.swallow.fitRatio * 1.5;
  const best = new Map();
  for (const c of picker.pts) {
    let n = 0;
    world.query(c.x, c.z, 55, (o) => { if (!o.mover && o.state === 0 && o.fit < maxFit) n++; });
    if (n < 30) continue;
    const key = Math.floor(c.x / 30) * 100003 + Math.floor(c.z / 30);   // thin to the best point per 30 m cell
    const cur = best.get(key);
    if (!cur || cur.dens < n) best.set(key, { x: c.x, z: c.z, dens: n });
  }
  const spawns = [...best.values()];
  const buf = encodeTable(objs, spawns, world.bounds);
  return { buf, hash: worldHash(world), objects: objs.length, spawns: spawns.length };
}
