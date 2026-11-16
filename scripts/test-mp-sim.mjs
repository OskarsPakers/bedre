// Plain-Node tests for the authoritative room simulation (worker/mp/sim.js): claim / position validator, kills, respawn,
// bots, and a CPU benchmark with 12 simulated humans + bots. Uses the centre placement file (public/data/riga-objects.bin.gz = the server's table) when present (else a synthetic city).
//   node scripts/test-mp-sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomSim, speedOf, radiusOf } from '../worker/mp/sim.js';
import { parseTable, encodeTable, F_MOVER, F_BUILDING } from '../worker/mp/table.js';
import { readTableBytes } from '../tools/mp/load-table.mjs';
import { mpConfig, parseClientMessage, RateLimiter } from '../worker/mp/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };

function synthetic() {
  const objs = [];
  for (let i = 0; i < 40000; i++) {
    const x = ((i * 7919) % 3000) - 1500, z = ((i * 104729) % 2400) - 1200;
    const k = i % 10;
    objs.push({ kind: 0, x, z, fit: k < 6 ? 0.5 : k < 8 ? 1.5 : k < 9 ? 4 : 30, value: k < 6 ? 1 : k < 8 ? 4 : k < 9 ? 14 : 400, flags: (i % 17 === 0 ? F_MOVER : 0) | (k === 9 ? F_BUILDING : 0), yaw: 0, s: 1, tint: null });
  }
  const spawns = [];
  for (let i = 0; i < 400; i++) spawns.push({ x: ((i * 131) % 1400) - 700, z: ((i * 71) % 1400) - 700, dens: 40 + (i % 50) });
  const movers = new Float32Array(objs.filter((o) => o.flags & F_MOVER).length * 12);
  return encodeTable({ objs, nB: 0, movers, spawns, meta: { bounds: { minX: -2100, maxX: 1200, minZ: -1200, maxZ: 1500 }, kinds: ['x'] } });
}

const binPath = path.join(root, 'public', 'data', 'riga-objects.bin.gz');
const real = fs.existsSync(binPath);
const table = parseTable(real ? readTableBytes('centrs') : synthetic());
console.log(`table: ${real ? 'public/data/riga-objects.bin.gz' : 'synthetic'}  ${table.n} objects, ${table.spawn.n} spawns, hash ${table.hash}`);

const cfg = mpConfig({});
const mk = (names, close = false) => {
  const sim = new RoomSim(table, { ...cfg, testCloseSpawn: close }, 12345);
  const hs = names.map((n, i) => sim.addHuman(n, 'tok' + i + '12345678'));
  sim.start(1000, 3700, 300000);
  sim.tick(1000 + 3700);           // intro -> playing
  return { sim, hs, t: 1000 + 3700 };
};
const firstStatic = (pred) => { for (let i = 0; i < table.n; i++) if (!(table.flags[i] & F_MOVER) && pred(i)) return i; return -1; };

// ---- protocol hygiene ----
check('malformed json ignored', parseClientMessage('{nope') === null);
check('oversized message ignored', parseClientMessage('{"t":"ping","c":1,"x":"' + 'a'.repeat(3000) + '"}') === null);
check('bad claim shape ignored', parseClientMessage('{"t":"u","c":["a"]}') === null && parseClientMessage('{"t":"u","x":"1","z":2}') === null);
check('too many claims ignored', parseClientMessage(JSON.stringify({ t: 'u', c: Array.from({ length: 65 }, (_, i) => i) })) === null);
check('valid update parses', parseClientMessage('{"t":"u","q":3,"x":1.5,"z":-2,"c":[1,2],"m":[[3,1,2]]}')?.c.length === 2);
const rl = new RateLimiter(40, 80, 0); let allowed = 0; for (let i = 0; i < 500; i++) if (rl.allow(0)) allowed++;
check('rate limiter caps a burst', allowed === 80, `allowed ${allowed}`);

// ---- start: everyone equal ----
{
  const { sim, hs } = mk(['A', 'B', 'C']);
  check('bots fill to 8 holes', sim.holes.length === 8 && sim.holes.filter((h) => h.bot).length === 5);
  check('everyone starts at start size / score 0', sim.holes.every((h) => h.score === 0 && Math.abs(h.r - 2.2) < 1e-9));
  check('server bots are gentle by default: botSkill <= 0.4 and a quiet first minute for humans', mpConfig({}).botSkill <= 0.4 && mpConfig({}).botHumanGrace >= 60, JSON.stringify([mpConfig({}).botSkill, mpConfig({}).botHumanGrace]));
  check('humans start apart', Math.hypot(hs[0].x - hs[1].x, hs[0].z - hs[1].z) > 50);
}

// ---- claims ----
{
  const { sim, hs, t } = mk(['A', 'B']);
  const a = hs[0];
  const small = firstStatic((i) => table.fit[i] < 1 && Math.hypot(table.x[i] - a.x, table.z[i] - a.z) < 6);
  const near = small >= 0 ? small : firstStatic((i) => table.fit[i] < 1);
  if (small < 0) { a.x = table.x[near]; a.z = table.z[near]; }
  let r = sim.handleClaims(a, [near], [], t + 100);
  check('legit claim accepted', r.bad.length === 0 && a.score === table.value[near], `score ${a.score}`);
  r = sim.handleClaims(a, [near], [], t + 200);
  check('already-eaten claim rejected', r.bad.length === 1);
  const big = firstStatic((i) => table.fit[i] > 20);
  const bigFar = big;
  a.x = table.x[big]; a.z = table.z[big];
  r = sim.handleClaims(a, [big], [], t + 300);
  check('too-big object rejected (even when standing on it)', r.bad.length === 1 && sim.eaten[big] === 0);
  const far = firstStatic((i) => table.fit[i] < a.r * 0.9 && !sim.eaten[i] && Math.hypot(table.x[i] - a.x, table.z[i] - a.z) > 300);
  check('far-away test object exists', far >= 0, `id ${far}`);
  r = sim.handleClaims(a, [far], [], t + 400);
  check('far-away small object rejected', r.bad.length === 1 && sim.eaten[far] === 0);
  r = sim.handleClaims(a, [table.n + 5, -1 >>> 0], [], t + 500);
  check('out-of-range ids rejected', r.bad.length === 2);
  r = sim.handleClaims(a, [-1, 1.5, NaN], [], t + 550);
  check('negative / non-integer ids rejected', r.bad.length === 3 && Number.isFinite(a.score));
  const mv = (() => { for (let i = 0; i < table.n; i++) if ((table.flags[i] & F_MOVER) && table.fit[i] < 1) return i; return -1; })();
  if (mv >= 0) {
    r = sim.handleClaims(a, [], [[mv, a.x + 500, a.z]], t + 600);
    check('mover claim far from the hole rejected', r.bad.length === 1);
    r = sim.handleClaims(a, [], [[mv, a.x + 1, a.z]], t + 700);
    check('mover claim near the hole accepted', r.bad.length === 0);
    r = sim.handleClaims(a, [mv], [], t + 800);
    check('mover claimed as static rejected', r.bad.length === 1);
  }
  // spam budget
  a.claimBudget = 3;
  const many = []; for (let i = 0; i < 50; i++) many.push(i);
  r = sim.handleClaims(a, many, [], t + 900);
  check('claim spam is budgeted', r.bad.length >= 45, `bad ${r.bad.length}`);
}

// ---- movement ----
{
  const { sim, hs, t } = mk(['A']);
  const a = hs[0];
  const x0 = a.x, z0 = a.z, v = speedOf(a.r);
  let now = t, x = x0, ok = 0, rb = 0;
  for (let i = 0; i < 25; i++) { now += 80; x += v * 0.08 * 0.9; const r = sim.handlePos(a, x, z0, now); if (r) { rb++; x = r.x; } else ok++; }
  check('legit speed accepted', rb === 0, `ok ${ok} rb ${rb}`);
  const jump = sim.handlePos(a, a.x + 400, a.z, now + 80);
  check('teleport rejected (rubber-band)', jump && Math.abs(jump.x - a.x) < 1e-6);
  // sustained 3x speed: the distance budget refills at 1.3x speed, so the real displacement stays <= ~1.3x (+ the initial burst)
  const sx = a.x; let now2 = now + 80, rbs = 0;
  for (let i = 0; i < 50; i++) { now2 += 80; const r = sim.handlePos(a, a.x + 3 * v * 0.08, a.z, now2); if (r) rbs++; }
  const travelled = a.x - sx, allowed = 1.3 * v * 4 + v * 1.5 * 1.3 + 3 + 1;
  check('3x speed hack is capped (rubber-banded)', rbs > 20 && travelled <= allowed, `rejected ${rbs}/50, moved ${travelled.toFixed(1)} m in 4 s, cap ${allowed.toFixed(1)}, 3x would be ${(3 * v * 4).toFixed(1)}`);
  const edge = sim.handlePos(a, 1e5, 1e5, now2 + 80);
  check('out-of-bounds clamped/rejected', edge !== undefined);
}

// ---- kills + respawn ----
{
  const { sim, hs, t } = mk(['A', 'B'], true);
  const [a, b] = hs;
  a.score = 40; a.r = radiusOf(a.score); b.score = 10; b.r = radiusOf(b.score);
  b.x = a.x + 1; b.z = a.z; a.protectUntil = b.protectUntil = 0;
  sim.tick(t + 50);
  check('bigger hole swallows smaller (>=1.15x)', b.state === 1 && sim.ev.k.length >= 1, `ratio ${(a.r / b.r).toFixed(2)}`);
  check('eater gains 50% of victim score', Math.abs(a.score - 45) < 1e-6, String(a.score));
  const kill = sim.ev.k.find((k) => k[1] === b.id);
  check('kill event has eater, victim, gain', kill && kill[0] === a.id && kill[2] === 5);
  sim.tick(t + 50 + 700 + 3000 + 50); sim.tick(t + 50 + 700 + 3000 + 100);
  check('victim respawns after 3 s at 50% score with protection', b.state === 0 && Math.abs(b.score - 5) < 1e-6 && b.protectUntil > t + 3000, `state ${b.state} score ${b.score}`);
  // equal sizes never kill each other
  const c = sim.addHuman('C', 'tokC12345678'); c.x = a.x; c.z = a.z; c.score = 45; c.r = a.r; c.protectUntil = 0;
  sim.tick(t + 5000); sim.tick(t + 5050);
  check('equal size cannot swallow', c.state === 0 && a.state === 0);
}

// ---- bots + CPU benchmark ----
{
  const cfgB = { ...cfg, totalHoles: 8 };
  for (const [nHum, total] of [[1, 8], [12, 12], [12, 20]]) {
    const sim = new RoomSim(table, { ...cfgB, totalHoles: total }, 777);
    const hs = [];
    for (let i = 0; i < nHum; i++) hs.push(sim.addHuman('H' + i, 'tok' + i + '1234567'));
    sim.start(0, 3700, 300000);
    let now = 3700; sim.tick(now);
    // humans: simple driver that walks to the nearest edible object and claims it (like a client would, ~12 Hz)
    const tgt = hs.map(() => null);
    let simMs = 0, snapMs = 0, simN = 0, snapN = 0, bytes = 0, maxBytes = 0, claims = 0, inMs = 0, inN = 0, simMax = 0;
    const steps = 20 * 120; // 120 s of game
    for (let s = 0; s < steps; s++) {
      now += 50;
      if (s % 2 === 0) { // 12 Hz-ish client updates (every other tick = 10 Hz)
        hs.forEach((h, i) => {
          if (h.state !== 0) return;
          if (!tgt[i] || sim.eaten[tgt[i]]) {
            let best = -1, bd = 1e9;
            sim.index.query(h.x, h.z, Math.max(30, h.r * 6), sim.eaten, (id, d) => { if (table.fit[id] < h.r * 0.9 && d < bd) { bd = d; best = id; } });
            tgt[i] = best >= 0 ? best : null;
          }
          if (tgt[i] != null) {
            const dx = table.x[tgt[i]] - h.x, dz = table.z[tgt[i]] - h.z, d = Math.hypot(dx, dz) || 1, st = Math.min(d, speedOf(h.r) * 0.1);
            const ti = process.hrtime.bigint();
            sim.handlePos(h, h.x + (dx / d) * st, h.z + (dz / d) * st, now);
            if (d < h.r * 0.85) { sim.handleClaims(h, [tgt[i]], [], now); claims++; }
            inMs += Number(process.hrtime.bigint() - ti) / 1e6; inN++;
          }
        });
      }
      const t0 = process.hrtime.bigint();
      sim.tick(now);
      const dtm = Number(process.hrtime.bigint() - t0) / 1e6; simMs += dtm; simN++; simMax = Math.max(simMax, dtm);
      if (s % 2 === 0) {
        const t1 = process.hrtime.bigint();
        const txt = JSON.stringify(sim.snapshot(now));
        snapMs += Number(process.hrtime.bigint() - t1) / 1e6; snapN++;
        bytes += txt.length; maxBytes = Math.max(maxBytes, txt.length);
      }
    }
    const top = sim.ranking().slice(0, 3).map((r) => `${r.name}:${r.score}`).join(' ');
    console.log(`bench ${nHum} humans + ${sim.holes.length - nHum} bots, 120 s sim: sim ${(simMs / simN).toFixed(3)} ms/tick avg, ${simMax.toFixed(2)} ms worst (20 Hz), snapshot ${(snapMs / snapN).toFixed(3)} ms (10 Hz), input msg ${(inMs / Math.max(1, inN) * 1000).toFixed(1)} us, `
      + `snapshot avg ${(bytes / snapN).toFixed(0)} B max ${maxBytes} B => ${(bytes / (snapN * 0.1) / 1024).toFixed(1)} KB/s per client; claims ${claims}; top ${top}`);
    check(`bots stay alive and eat (${nHum} humans, ${total} holes)`, sim.holes.filter((h) => h.bot).every((h) => h.score > 0 || sim.holes.length === nHum));
    check(`sim CPU is tiny (${nHum} humans, ${total} holes)`, simMs / simN < 5);
  }
}

// ---- bots do not hunt humans during the grace period (first 60 s), but do afterwards ----
{
  const huntedBy = (graceSec, atSec) => {
    const sim = new RoomSim(table, { ...mpConfig({}), botHumanGrace: graceSec, botSkill: 1, totalHoles: 2 }, 5);
    const h = sim.addHuman('X', 'tokgrace12345678');
    sim.start(0, 3700, 300000);
    let now = 3700; sim.tick(now);
    const bot = sim.holes.find((q) => q.bot);
    bot.score = 3000; bot.r = radiusOf(3000); bot.x = h.x + 30; bot.z = h.z; h.tx = h.x; h.tz = h.z; h.score = 800; h.r = radiusOf(800);
    now += atSec * 1000; sim.tick(now);                // jump into the round: the brain thinks at the (round) time given
    bot.brain.think(sim, now / 1000);
    return !!bot.brain.prey;
  };
  check('bot hunts a human prey when there is no grace (control)', huntedBy(0, 30) === true);
  check('bot ignores human prey inside the grace period', huntedBy(60, 30) === false);
  check('bot hunts humans again after the grace period', huntedBy(60, 75) === true);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);

