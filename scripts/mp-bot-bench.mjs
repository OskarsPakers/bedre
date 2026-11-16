// Calibrates MP.botSkill: bots-only 300 s rounds of the server simulation (plain Node, public/mp/objects.bin) for several skill levels,
// next to a casual-human stand-in (nearest edible, 55 % of full speed, 0.6 s reaction). Prints top / median bot score and the human's place.
//   node scripts/mp-bot-bench.mjs [--runs 4] [--skills 1,0.8,0.65,0.5]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomSim, speedOf } from '../worker/mp/sim.js';
import { parseTable } from '../worker/mp/table.js';
import { mpConfig } from '../worker/mp/protocol.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('--runs', 4), SKILLS = arg('--skills', '1,0.8,0.65,0.5').split(',').map(Number);
const buf = fs.readFileSync(path.join(root, 'public', 'mp', 'objects.bin'));
const table = parseTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
for (const skill of SKILLS) {
  const tops = [], meds = [], means = [], humanPlace = [], humanScore = [];
  for (let run = 0; run < RUNS; run++) {
    const sim = new RoomSim(table, { ...mpConfig({}), botSkill: skill, totalHoles: 8 }, 100 + run);
    const human = sim.addHuman('H', 'tok' + run + '12345678');
    sim.start(0, 3700, 300000);
    let now = 3700; sim.tick(now);
    let tgt = null, lastPick = 0;
    for (let s = 0; s < 20 * 300; s++) {
      now += 50;
      if (s % 2 === 0 && human.state === 0) {
        if ((!tgt || sim.eaten[tgt]) && now - lastPick > 600) {
          let best = -1, bd = 1e9; lastPick = now;
          sim.index.query(human.x, human.z, Math.max(30, human.r * 5), sim.eaten, (id, d) => { if (table.fit[id] < human.r * 0.85 && d < bd) { bd = d; best = id; } });
          tgt = best >= 0 ? best : null;
        }
        if (tgt != null && !sim.eaten[tgt]) {
          const dx = table.x[tgt] - human.x, dz = table.z[tgt] - human.z, d = Math.hypot(dx, dz) || 1, st = Math.min(d, speedOf(human.r) * 0.55 * 0.1);
          sim.handlePos(human, human.x + (dx / d) * st, human.z + (dz / d) * st, now);
          if (d < human.r * 0.85) sim.handleClaims(human, [tgt], [], now);
        }
      }
      sim.tick(now);
    }
    const rk = sim.ranking();
    const bots = rk.filter((r) => r.bot).map((r) => r.score).sort((a, b) => b - a);
    tops.push(bots[0]); meds.push(bots[Math.floor(bots.length / 2)]); means.push(bots.reduce((a, b) => a + b, 0) / bots.length);
    humanPlace.push(rk.findIndex((r) => !r.bot) + 1); humanScore.push(rk.find((r) => !r.bot).score);
  }
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  console.log(`botSkill ${skill}: top bot avg ${avg(tops)} mean bot ${avg(means)} median bot ${avg(meds)} | casual human score ${avg(humanScore)} place ${humanPlace.join(',')} of 8`);
}
