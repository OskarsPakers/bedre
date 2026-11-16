// Spawn-point richness per map: N fresh round starts (the real SpawnPicker), edible objects within 60 m of the player spawn
// (fit below the start hole's limit), plus the value reachable within 250 m by a hole of radius 8.
//   SPAWN_PORT=5190 GPU=1 node scripts/spawn-check.mjs [--maps a,b] [--n 40] [--no-build]
import { openSim } from '../tools/sim-lib.mjs';
import { MAP_SLUGS } from '../tools/maps.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const maps = (arg('--maps', MAP_SLUGS.join(',')) || '').split(',').filter((m) => MAP_SLUGS.includes(m));
const N = +arg('--n', 40);
const sim = await openSim({ port: +(process.env.SPAWN_PORT || 5190), noBuild: process.argv.includes('--no-build') });
let bad = 0;
for (const map of maps) {
  await sim.open(`bots=0&map=${map}`);
  const rows = await sim.page.evaluate((N) => {
    const g = window.__G, w = window.__W, C = window.__CFG, out = [];
    for (let i = 0; i < N; i++) {
      try { g.start(); } catch (e) { /* */ }
      g.skipIntro();
      const p = g.player, f0 = C.hole.startRadius * C.swallow.fitRatio;
      let now = 0, rich = 0;
      w.query(p.x, p.z, 60, (o) => { if (o.state === 0 && o.fit < f0) now++; });
      w.query(p.x, p.z, 250, (o) => { if (o.state === 0 && o.fit < 8 * C.swallow.fitRatio) rich += o.value; });
      out.push([Math.round(p.x), Math.round(p.z), now, Math.round(rich)]);
    }
    return out;
  }, N);
  const e = rows.map((r) => r[2]).sort((a, b) => a - b), v = rows.map((r) => r[3]).sort((a, b) => a - b);
  const under = rows.filter((r) => r[2] < 80).length; bad += under;
  console.log(`${map.padEnd(11)} edible<=60m: min ${e[0]} median ${e[e.length >> 1]} max ${e[e.length - 1]} | spawns < 80: ${under}/${N} | value<=250m (r8): min ${v[0]} median ${v[v.length >> 1]} | distinct spawns ${new Set(rows.map((r) => r[0] + ',' + r[1])).size}`);
  if (process.argv.includes('--list')) console.log(JSON.stringify(rows));
}
await sim.close();
process.exit(bad ? 1 : 0);
