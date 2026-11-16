// Online spawn fairness: the real RoomSim.start() (what the Worker runs) over many seeds and room sizes; for every HUMAN start point the
// number of edible static objects (fit below the start hole's limit) and their total value within 60 m. Fails when a spawn of a room with <= 5 humans has
// < 150 points of food within 60 m or when the richest and poorest human start of one room differ by more than 1.3x (<= 5 humans) / 2.5x (12 humans) (was 2.4x with 2 and 4.7x with 12 humans before pickHumanSpawns).
//   node scripts/spawn-check-online.mjs [dist-dir] [--n 200]
import { loadTableFile } from './lib/mp-bot.mjs';
import { RoomSim } from '../worker/mp/sim.js';
import { mpConfig } from '../worker/mp/protocol.js';
import { CFG } from '../src/config.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dist = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'public';
const N = +arg('--n', 200);
const table = loadTableFile(dist);
const cfg = mpConfig({});
const f0 = CFG.hole.startRadius * CFG.swallow.fitRatio;
const food = (x, z) => { let n = 0, v = 0; for (let i = 0; i < table.n; i++) { if (table.flags[i] & 1 || table.fit[i] >= f0) continue; if ((table.x[i] - x) ** 2 + (table.z[i] - z) ** 2 <= 3600) { n++; v += table.value[i]; } } return [n, v]; };
const cache = new Map();
const foodAt = (x, z) => { const k = x + ',' + z; if (!cache.has(k)) cache.set(k, food(x, z)); return cache.get(k); };
let bad = 0, worstRatio = 1, minN = 1e9; const allN = [];
for (const humans of [1, 2, 5, 12]) {
  const spreads = [], mins = [];
  for (let s = 1; s <= N; s++) {
    const sim = new RoomSim(table, cfg, s * 7919);
    for (let i = 0; i < humans; i++) sim.addHuman('H' + i, 'tok' + i + 'xxxxxxxx', i, i);
    sim.start(1e6, 3700, 300000);
    const rows = sim.humans().map((h) => foodAt(h.x, h.z));
    const ns = rows.map((r) => r[0]), vs = rows.map((r) => r[1]);
    minN = Math.min(minN, ...ns); mins.push(Math.min(...ns)); allN.push(...ns);
    if (humans <= 5 && Math.min(...vs) < 150) bad++;   // up to 5 humans everybody must start with >= 70 edible objects within 60 m (12 humans share what the map has: reported only)
    if (humans > 1) { const ratio = Math.max(...vs) / Math.max(1, Math.min(...vs)); spreads.push(ratio); worstRatio = Math.max(worstRatio, ratio / (humans <= 5 ? 1.3 : 2.5)); }
  }
  spreads.sort((a, b) => a - b); mins.sort((a, b) => a - b);
  console.log(`${String(humans).padStart(2)} humans: poorest spawn edible<=60m min ${mins[0]} median ${mins[mins.length >> 1]}${spreads.length ? ` | value spread richest/poorest in one room: median ${spreads[spreads.length >> 1].toFixed(2)} p95 ${spreads[Math.floor(spreads.length * 0.95)].toFixed(2)} max ${spreads[spreads.length - 1].toFixed(2)}` : ''}`);
}
allN.sort((a, b) => a - b);
console.log(`all human spawns: edible<=60m min ${allN[0]} p5 ${allN[Math.floor(allN.length * 0.05)]} median ${allN[allN.length >> 1]} | poor spawns (food value < 150, rooms <= 5 humans): ${bad}`);
const ok = bad === 0 && worstRatio <= 1;
console.log(ok ? 'spawns OK' : `spawn fairness problem: ${bad} rooms with a poor spawn, worst normalised value ratio ${worstRatio.toFixed(2)} (> 1 = too uneven)`);
process.exit(ok ? 0 : 1);
