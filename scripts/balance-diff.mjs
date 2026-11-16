// Difficulty calibration: for every map x difficulty plays full rounds with a CASUAL player (0.6x speed, reaction delay, wandering)
// and a PERFECT greedy player (Game.autoplay) against the bots, and prints score / placement / best-median-worst bot.
//   node scripts/balance-diff.mjs [--maps centrs,agenskalns,mezaparks,purvciems] [--diffs easy,normal,hard] [--players casual,greedy] [--runs 5]
//        [--mode classic] [--nobots] [--port 5191] [--no-build] [--set bots.gain=0.6,duel.keepScore=0.7]   (GPU=1 for the metal backend)
// Output ends with a table (one row per map x difficulty x player). Used to calibrate DIFFICULTY in src/config.js (README 6.1).
import path from 'node:path';
import { openSim, simRound } from '../tools/sim-lib.mjs';
import { MAP_SLUGS } from '../tools/maps.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('--runs', 5), MODE = arg('--mode', 'classic');
const MAPS = arg('--maps', MAP_SLUGS.join(',')).split(',').filter((m) => MAP_SLUGS.includes(m));
const DIFFS = arg('--diffs', 'easy,normal,hard').split(',');
const PLAYERS = arg('--players', 'casual,greedy').split(',');
const sets = (arg('--set', '') || '').split(',').filter(Boolean).map((s) => s.split('='));
const distArg = arg('--dist', null);   // build / serve another copy (lets a calibration run keep going while the source changes)
const sim = await openSim({ port: +arg('--port', 5191), noBuild: process.argv.includes('--no-build'), ...(distArg ? { dist: path.resolve(distArg) } : {}) });
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const rows = [];
for (const slug of MAPS) {
  await sim.open(`map=${slug}${process.argv.includes('--nobots') ? '&bots=0' : ''}`);
  for (const diff of DIFFS) {
    for (const player of PLAYERS) {
      const res = [];
      for (let i = 0; i < RUNS; i++) {
        if (sets.length) await sim.page.evaluate((sets) => { for (const [k, v] of sets) { const p = k.split('.'); let o = window.__CFG; while (p.length > 1) o = o[p.shift()]; o[p[0]] = +v; } window.__modes.reapply(); }, sets);
        const r = await simRound(sim.page, { mode: MODE, strategy: player, difficulty: diff });
        const bs = [...r.botScores].sort((a, b) => b - a);
        res.push({ score: r.final.score, rank: r.final.rank, best: bs[0], med: med(bs), worst: bs[bs.length - 1], kills: r.final.kills, deaths: r.final.deaths });
        process.stdout.write(`${slug} ${diff} ${player} #${i + 1}: score ${r.final.score} place ${r.final.rank} | bots best ${bs[0]} med ${med(bs)} worst ${bs[bs.length - 1]} | k${r.final.kills} d${r.final.deaths}\n`);
      }
      rows.push({ slug, diff, player, n: res.length, score: avg(res.map((r) => r.score)), place: avg(res.map((r) => r.rank)), win: res.filter((r) => r.rank === 1).length / res.length, top3: res.filter((r) => r.rank <= 3).length / res.length,
        best: avg(res.map((r) => r.best)), med: avg(res.map((r) => r.med)), worst: avg(res.map((r) => r.worst)), deaths: avg(res.map((r) => r.deaths)), ranks: res.map((r) => r.rank).join(',') });
    }
  }
}
await sim.close();
console.log('\nmap        diff    player  n  score   place win  top3 | best   med    worst  best/player | deaths ranks');
for (const r of rows) console.log(`${r.slug.padEnd(10)} ${r.diff.padEnd(7)} ${r.player.padEnd(7)} ${r.n}  ${String(Math.round(r.score)).padStart(6)}  ${r.place.toFixed(1)}   ${(r.win * 100).toFixed(0).padStart(3)}% ${(r.top3 * 100).toFixed(0).padStart(3)}% | ${String(Math.round(r.best)).padStart(6)} ${String(Math.round(r.med)).padStart(6)} ${String(Math.round(r.worst)).padStart(6)}  ${(r.best / r.score * 100).toFixed(0).padStart(4)}%       | ${r.deaths.toFixed(1)}  ${r.ranks}`);
process.exit(0);
