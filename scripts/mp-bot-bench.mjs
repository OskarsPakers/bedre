// Calibrates MP.botSkill: bots-only 300 s rounds of the server simulation (plain Node, public/data/riga-objects.bin.gz) for several skill levels,
// next to a casual-human stand-in (value/distance pick with noise, 0.65x speed, 0.5-1.4 s re-targeting, wanders, flees after 0.6 s: the same
// model as the 'casual' strategy of tools/sim-lib.mjs). Prints top / median bot score and the human's place + share of top-3 finishes.
//   node scripts/mp-bot-bench.mjs [--runs 6] [--skills 0.55,0.4,0.35] [--grace 60] [--speed 0.65]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomSim, speedOf } from '../worker/mp/sim.js';
import { loadTable } from '../tools/mp/load-table.mjs';
import { mpConfig, MP } from '../worker/mp/protocol.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('--runs', 6), SKILLS = arg('--skills', `${MP.botSkill}`).split(',').map(Number), GRACE = +arg('--grace', MP.botHumanGrace), SPEED = +arg('--speed', 0.65);
const table = loadTable('centrs');   // public/data/riga-objects.bin.gz (the server's table)
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (const skill of SKILLS) {
  const tops = [], meds = [], means = [], humanPlace = [], humanScore = [];
  for (let run = 0; run < RUNS; run++) {
    const sim = new RoomSim(table, { ...mpConfig({}), botSkill: skill, botHumanGrace: GRACE, totalHoles: 8 }, 100 + run);
    const human = sim.addHuman('H', 'tok' + run + '12345678');
    sim.start(0, 3700, 300000);
    let now = 3700; sim.tick(now);
    let tgt = null, nextPick = 0, wander = 0, wDir = 0, threatT = 0, dir = null;
    for (let s = 0; s < 20 * 300; s++) {
      now += 50;
      if (s % 2 === 0 && human.state === 0) {
        const sec = (now - 3700) / 1000;
        if (sec >= nextPick || tgt == null || sim.eaten[tgt]) {
          nextPick = sec + 0.5 + rnd() * 0.9;
          if (wander <= 0 && rnd() < 0.04) { wander = 1.2 + rnd() * 1.8; wDir = rnd() * Math.PI * 2; }
          let best = -1, bs = -1;
          sim.index.query(human.x, human.z, Math.max(25, human.r * 8), sim.eaten, (id, d) => {
            if (table.fit[id] >= human.r * 0.95) return;
            const sc = table.value[id] / (d + human.r * 1.5 + 4) * (0.75 + rnd() * 0.5);
            if (sc > bs) { bs = sc; best = id; }
          });
          tgt = best >= 0 ? best : null;
        }
        let threat = null;
        for (const o of sim.holes) if (o !== human && o.state === 0 && o.r >= human.r * 1.15 * 0.92 && Math.hypot(o.x - human.x, o.z - human.z) < o.r * 3.2 + 14) threat = o;
        threatT = threat ? threatT + 0.1 : 0;
        let gx = null, gz = null;
        if (threat && threatT >= 0.6) { const ax = human.x - threat.x, az = human.z - threat.z, l = Math.hypot(ax, az) || 1; gx = human.x + (ax / l) * 60; gz = human.z + (az / l) * 60; }
        else if (wander > 0) { gx = human.x + Math.cos(wDir) * 80; gz = human.z + Math.sin(wDir) * 80; wander -= 0.1; }
        else if (tgt != null && !sim.eaten[tgt]) { gx = table.x[tgt]; gz = table.z[tgt]; }
        if (gx != null) {
          const dx = gx - human.x, dz = gz - human.z, d = Math.hypot(dx, dz) || 1, st = Math.min(d, speedOf(human.r) * SPEED * 0.1);
          sim.handlePos(human, human.x + (dx / d) * st, human.z + (dz / d) * st, now);
        }
        // swallow everything that fits within reach (like the client does)
        const claims = [];
        sim.index.query(human.x, human.z, human.r * 0.92, sim.eaten, (id) => { if (table.fit[id] < human.r * 0.95 && claims.length < 30) claims.push(id); });
        if (claims.length) sim.handleClaims(human, claims, [], now);
      }
      sim.tick(now);
    }
    const rk = sim.ranking();
    const bots = rk.filter((r) => r.bot).map((r) => r.score).sort((a, b) => b - a);
    tops.push(bots[0]); meds.push(bots[Math.floor(bots.length / 2)]); means.push(bots.reduce((a, b) => a + b, 0) / bots.length);
    humanPlace.push(rk.findIndex((r) => !r.bot) + 1); humanScore.push(rk.find((r) => !r.bot).score);
  }
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  console.log(`botSkill ${skill} grace ${GRACE}s: top bot avg ${avg(tops)} mean bot ${avg(means)} median bot ${avg(meds)} | casual human score ${avg(humanScore)} (alone: no other humans) place ${humanPlace.join(',')} of 8 | wins ${humanPlace.filter((p) => p === 1).length}/${RUNS} top3 ${humanPlace.filter((p) => p <= 3).length}/${RUNS}`);
}
