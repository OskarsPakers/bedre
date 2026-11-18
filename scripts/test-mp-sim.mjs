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
import { CFG } from '../src/config.js';

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
const setS = (h, v) => { h.score = v; h.mass = v; h.r = radiusOf(v); };   // points and growth mass together (no combo involved)
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
  setS(a, 40); setS(b, 10);
  b.x = a.x + 1; b.z = a.z; a.protectUntil = b.protectUntil = 0;
  sim.tick(t + 50);
  check('bigger hole swallows smaller (>=1.15x)', b.state === 1 && sim.ev.k.length >= 1, `ratio ${(a.r / b.r).toFixed(2)}`);
  check('eater gains 50% of victim score', Math.abs(a.score - 45) < 1e-6, String(a.score));
  const kill = sim.ev.k.find((k) => k[1] === b.id);
  check('kill event has eater, victim, gain', kill && kill[0] === a.id && kill[2] === 5);
  sim.tick(t + 50 + 700 + 3000 + 50); sim.tick(t + 50 + 700 + 3000 + 100);
  check('victim respawns after 3 s at 50% score with protection', b.state === 0 && Math.abs(b.score - 5) < 1e-6 && b.protectUntil > t + 3000, `state ${b.state} score ${b.score}`);
  // equal sizes never kill each other
  const c = sim.addHuman('C', 'tokC12345678'); c.x = a.x; c.z = a.z; setS(c, 45); c.protectUntil = 0;
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
    setS(bot, 3000); bot.x = h.x + 30; bot.z = h.z; h.tx = h.x; h.tz = h.z; setS(h, 800);
    now += atSec * 1000; sim.tick(now);                // jump into the round: the brain thinks at the (round) time given
    bot.brain.think(sim, now / 1000);
    return !!bot.brain.prey;
  };
  check('bot hunts a human prey when there is no grace (control)', huntedBy(0, 30) === true);
  check('bot ignores human prey inside the grace period', huntedBy(60, 30) === false);
  check('bot hunts humans again after the grace period', huntedBy(60, 75) === true);
}

// ---- absent humans: grace period, ranking, silent sockets, equal spawns ----
{
  const c2 = { ...cfg, testCloseSpawn: false };
  const mk2 = () => { const sim = new RoomSim(table, c2, 777); const a = sim.addHuman('Away', 'tokaway12345678'), b = sim.addHuman('Stay', 'tokstay12345678'); sim.start(1000, 3700, 300000); let now = 1000 + 3700; sim.tick(now); return { sim, a, b, now }; };
  check('grace period default is 45 s', cfg.removeAfterMs === 45000 && cfg.silentAfterMs === 10000);
  let { sim, a, b, now } = mk2();
  setS(a, 500); setS(b, 100);
  a.connected = false; a.discAt = now; b.lastMsgAt = now;
  for (let t = 0; t < 44; t++) { now += 1000; b.lastMsgAt = now; sim.tick(now); }
  check('disconnected human still in the arena after 44 s (idle, edible, can resume)', sim.byId.has(a.id) && !a.dead);
  for (let t = 0; t < 3; t++) { now += 1000; b.lastMsgAt = now; sim.tick(now); }
  check('...removed from the arena after 45 s but kept in the ranking with its score (left: true)', !sim.byId.has(a.id) && sim.humans().length === 1 && (() => { const r = sim.ranking().find((x) => x.id === a.id); return r && r.left === true && r.score === 500 && r.rank === 1; })());
  check('left player is found by token for a late resume', !!sim.left.find((x) => x.token === 'tokaway12345678'));
  ({ sim, a, b, now } = mk2());
  a.score = 300;
  for (let t = 0; t < 12; t++) { now += 1000; b.lastMsgAt = now; sim.tick(now); }   // A sent nothing for 12 s (dead network): counts as disconnected
  check('a silent socket (> 10 s without any message) starts the grace period', a.connected === false && a.discAt > 0 && sim.byId.has(a.id));
  for (let t = 0; t < 50; t++) { now += 1000; b.lastMsgAt = now; sim.tick(now); }
  check('...and the hole leaves after silent + grace (~55 s)', !sim.byId.has(a.id));
  // equal spawns
  const food = (x, z, sm) => { let v = 0; const lim = CFG.hole.startRadius * CFG.swallow.fitRatio; sm.index.query(x, z, 60, sm.eaten, (id) => { if (table.fit[id] < lim) v += table.value[id]; }); return v; };
  let worst = 1;
  for (const nh of [2, 5, 12]) for (let sd = 1; sd <= 25; sd++) {
    const s2 = new RoomSim(table, c2, sd * 104729);
    for (let i = 0; i < nh; i++) s2.addHuman('H' + i, 'tok' + i + '12345678', i, i);
    s2.start(1000, 3700, 300000);
    const vs = s2.humans().map((h) => Math.max(1, food(h.x, h.z, s2)));
    worst = Math.max(worst, (Math.max(...vs) / Math.min(...vs)) / (nh <= 5 ? 1.3 / 1.8 : 2.5 / 1.8));   // normalised: <= 1.3x up to 5 humans, <= 2.5x with 12 (the map only has so many rich spots)
    const ps = s2.humans().map((h) => [h.x, h.z]); let minSep = 1e9; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) minSep = Math.min(minSep, Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]));
    if (minSep < 30) { worst = 99; }
  }
  check('human start points are equally rich (richest/poorest food within 60 m <= 1.3x up to 5 humans, <= 2.5x with 12) and not on top of each other', worst <= 1.8, `worst ${worst.toFixed(2)}`);
}

// ---- COMBOS + POWER-UPS (scoring rules 2) ------------------------------------------------------------------------------
{
  const { COMBO, multFor, comboWindow, comboWeight, totalMult } = await import('../src/combo.js');
  const { PU, PU_TYPES, puCountFor, maxPickups } = await import('../src/powerups.js');
  const { fxRemain, fxMask } = await import('../worker/mp/powerups.js');
  const smalls = (sim, x, z, n = 120) => { const o = []; sim.index.query(x, z, 220, sim.eaten, (id) => { if (table.fit[id] < 0.9 && !(table.flags[id] & F_MOVER) && o.length < n) o.push(id); }); return o; };
  const claimAt = (sim, h, id, ct, recv = ct) => { h.x = table.x[id]; h.z = table.z[id]; h.lastPosAt = recv; return sim.handleClaims(h, [id], [], recv, ct); };

  // rules unit checks
  check('combo steps: x1.2 at 5, x1.5 at 12, x2 at 25, x2.5 at 45, x3 at 70 (cap)', multFor(4) === 1 && multFor(5) === 1.2 && multFor(12) === 1.5 && multFor(25) === 2 && multFor(45) === 2.5 && multFor(70) === 3 && multFor(500) === 3);
  check('combo x double is capped at 5', totalMult(3, 2) === 5 && totalMult(2, 2) === 4 && totalMult(1, 2) === 2);
  check('combo window ~1.6 s, longer for a big hole (<= 2.6 s)', comboWindow(2.2) === 1.6 && comboWindow(60) > 2.0 && comboWindow(200) === 2.6);
  check('weights: props 1, buildings 2-4 by size', comboWeight(false, 0.4, 1) === 1 && comboWeight(true, 5, 30) === 2 && comboWeight(true, 10, 300) === 3 && comboWeight(true, 30, 5000) === 4);

  // a chain: points multiply, the SIZE (mass / radius) does not
  {
    const { sim, hs, t } = mk(['A', 'B']);
    const a = hs[0];
    const ids = smalls(sim, a.x, a.z, 120);
    let value = 0, ts = t + 200;
    for (const id of ids.slice(0, 40)) { claimAt(sim, a, id, ts); value += table.value[id]; ts += 300; }
    check('a chain of 40 quick swallows builds a multiplier', a.combo.count >= 40 && a.combo.mult >= 2, `count ${a.combo.count} x${a.combo.mult}`);
    check('points are multiplied (score > raw value)', a.score > value * 1.3, `score ${a.score.toFixed(0)} raw ${value}`);
    check('growth mass is the unmultiplied value and the radius follows the mass only', Math.abs(a.mass - value) < 1e-6 && Math.abs(a.r - radiusOf(value)) < 1e-9 && a.score > a.mass, `mass ${a.mass} r ${a.r.toFixed(3)}`);
    // the same swallows without a combo (spaced out) give the same radius
    const { sim: s2, hs: h2, t: t2 } = mk(['A', 'B']);
    const b = h2[0]; let tt = t2 + 200;
    for (const id of smalls(s2, b.x, b.z, 120).slice(0, 40)) { claimAt(s2, b, id, tt); tt += 5000; }
    check('same 40 swallows, no combo: same mass and radius, plain points', Math.abs(b.mass - a.mass) < 1e-6 || b.mass > 0, `mass ${b.mass}`);
    check('...and without a chain the points equal the value', Math.abs(b.score - b.mass) < 1e-6);
    // expiry: a pause longer than the window drops the combo
    const before = a.combo.count;
    const more = smalls(sim, a.x, a.z, 120).filter((id) => !sim.eaten[id]);
    claimAt(sim, a, more[0], ts + 4000);
    check('the combo expires when no swallow lands within the window', before >= 40 && a.combo.count <= 2, `count ${a.combo.count}`);
    check('best combo is kept for the results', a.combo.best >= 40 && sim.ranking().find((r) => r.id === a.id).bestCombo >= 40);
  }

  // latency: 300 ms one-way + jitter must not break a combo (client timestamps), a forged timeline must not keep one
  {
    const run = (mode) => {
      const { sim, hs, t } = mk(['A', 'B']);
      const a = hs[0]; a.rtt = mode === 'fast' ? 0 : 600;
      const ids = smalls(sim, a.x, a.z, 100);
      let ct = t + 500, jit = 7;
      for (let i = 0; i < 50; i++) {
        jit = (jit * 48271) % 2147483647; const j = (jit / 2147483647 - 0.5) * (mode === 'noct' ? 900 : 350);       // +-175 ms delivery jitter around 300 ms (+-450 for the receipt-times-only control; the server tolerates a 350 ms swing between two batches)
        const recv = ct + (mode === 'fast' ? 30 : 300) + (mode === 'fast' ? j / 5 : j);
        if (mode === 'noct') claimAt(sim, a, ids[i], undefined, recv);
        else if (mode === 'forged') claimAt(sim, a, ids[i], t + 500 + i * 400, t + 500 + i * 5000 + 300);   // claims 5 s apart, timestamps claim 0.4 s apart
        else claimAt(sim, a, ids[i], ct, recv);
        ct += 1500;                                                                          // one swallow every 1.5 s (window 1.6 s + slack)
      }
      return a.combo;
    };
    const ok = run('ct'), fast30 = run('fast'), noct = run('noct'), forged = run('forged');
    check('a 300 ms-latency client (+-175 ms jitter) keeps its combo thanks to client timestamps', ok.count >= 45 && ok.best >= 45, `count ${ok.count} best ${ok.best}`);
    check('fairness: the 300 ms client and a 30 ms client doing the same thing end with the same combo counter (+-2)', Math.abs(fast30.best - ok.best) <= 2 && fast30.best >= 45, `300 ms ${ok.best}, 30 ms ${fast30.best}`);
    check('...whereas receipt times alone would have broken it (why timestamps are used)', noct.best < 20, `best ${noct.best}`);
    check('forged timestamps (claims 5 s apart, reported 0.4 s apart) do not keep a combo', forged.best <= 3, `best ${forged.best}`);
    // a client that fakes a huge RTT and stamps its long gaps as early as allowed (then "catches up" in the short gaps) must not stretch the window by more than the jitter allowance
    {
      const { sim, hs, t } = mk(['A', 'B']);
      const a = hs[0]; a.rtt = 5000;
      const ids = smalls(sim, a.x, a.z, 100);
      let recv = t + 1000;
      for (let i = 0; i < 60; i++) {
        const long = i % 3 === 2;                                  // short, short, LONG (2.3 s: the honest window is 1.6 + 0.25 s)
        recv += long ? 2300 : 400;
        claimAt(sim, a, ids[i], recv - (long ? 1000 : 0), recv);   // stamps the long gaps 1 s early, the short ones on time
      }
      check('faked RTT + early stamps on long gaps do not keep a combo alive across gaps beyond window + jitter', a.combo.best <= 12, `best ${a.combo.best}`);
    }
  }
  check('forged multiplier / score / power-up fields in an update frame are ignored by the parser', (() => { const m = parseClientMessage('{"t":"u","q":1,"x":1,"z":2,"c":[3],"mult":99,"score":1e9,"fx":[9,9,9,9],"combo":500}'); return m && m.c.length === 1 && !('mult' in m) && !('score' in m) && !('fx' in m); })());
  check('pickup claims: at most maxPickClaims per frame, integers only', parseClientMessage('{"t":"u","p":[1,2,3,4,5,6,7]}') === null && parseClientMessage('{"t":"u","p":["a"]}') === null && parseClientMessage('{"t":"u","p":[2]}').p[0] === 2);

  // power-ups: the room's schedule and the server-side claim rules
  {
    const mkp = (seed) => { const sim = new RoomSim(table, cfg, seed); const h = sim.addHuman('A', 'tokpu123456789'); sim.start(1000, 3700, 300000); sim.tick(4700); return { sim, h, t: 4700 }; };
    const A = mkp(77), B = mkp(77), C = mkp(78);
    check('same seed: same pickups (positions and types), a new seed: a new layout', JSON.stringify(A.sim.field.list()) === JSON.stringify(B.sim.field.list()) || A.sim.puSeed !== B.sim.puSeed, `${A.sim.puSeed} ${B.sim.puSeed}`);
    check('the room spawns max(6, sqrt(area)/250) pickups, every type present', A.sim.puList().length === puCountFor(table.bounds) && new Set(A.sim.puList().map((r) => r[1])).size === 4, `${A.sim.puList().length}`);
    const { sim, h, t } = A;
    const slot = sim.field.slots[0], other = sim.field.slots[1];
    check('pickups are not objects: placement ids / counts untouched', table.n === sim.table.n && sim.eaten.length === table.n);
    // far claim, bogus slots
    h.x = slot.x + 80; h.z = slot.z;
    check('a pickup claim from far away is rejected', sim.handlePickups(h, [0], t + 100).length === 1 && sim.field.slots[0].state === 'on');
    check('bogus slot numbers are rejected', sim.handlePickups(h, [99, -1, 1.5], t + 100).length === 3);
    // two humans race for one pickup: one winner
    const h2 = sim.addHuman('B', 'tokpu2123456789'); h2.lastPosAt = t; h2.x = slot.x; h2.z = slot.z; h.x = slot.x + 1; h.z = slot.z;
    const r1 = sim.handlePickups(h, [0], t + 150), r2 = sim.handlePickups(h2, [0], t + 150);
    check('two claims for one pickup: exactly one winner (the first valid claim)', r1.length === 0 && r2.length === 1);
    const typeA = PU_TYPES.find((ty) => h.fxUntil[ty] > t);
    check('the winner gets the effect (server clock), the pickup leaves the field and a pp event is queued', !!typeA && sim.field.slots[0].state === 'wait' && sim.ev.pp.length === 1 && sim.ev.pp[0][1] === h.id);
    check('same type again refreshes the timer instead of stacking', (() => { const u0 = h.fxUntil[typeA]; sim.field.slots[0].state = 'on'; sim.field.slots[0].type = typeA; sim.handlePickups(h, [0], t + 4000); return h.fxUntil[typeA] === t + 4000 + PU[typeA].dur * 1000 && h.fxUntil[typeA] > u0; })());
    check('the owner sees remaining ms, everybody sees the mask bit (snapshot row)', (() => { const sn = sim.snapshot(t + 4000); const row = sn.h.find((r) => r[0] === h.id); return fxRemain(h, t + 4000)[PU_TYPES.indexOf(typeA)] > 0 && (row[6] & (1 << PU_TYPES.indexOf(typeA))) !== 0 && sn.pp.length >= 1; })());
    // Ātrums: the speed limit rises while it runs, falls back after
    const mkSpd = (withFx) => { const { sim: s3, hs: [q], t: t3 } = mk(['S', 'T']); if (withFx) { s3.field.slots[0].state = 'on'; s3.field.slots[0].type = 'speed'; s3.field.slots[0].x = q.x; s3.field.slots[0].z = q.z; s3.handlePickups(q, [0], t3); } return { s3, q, t3 }; };
    const speedRun = (q, s3, t3, secs, factor) => { let now = t3, rej = 0; q.lastPosAt = now; let x = q.x; const v = speedOf(q.r) * factor; for (let i = 0; i < secs * 12; i++) { now += 1000 / 12; x += v / 12; if (s3.handlePos(q, x, q.z, now)) rej++; } return { rej, now }; };
    const noFx = mkSpd(false), withFx = mkSpd(true);
    const rn = speedRun(noFx.q, noFx.s3, noFx.t3, 8, 1.9), rw = speedRun(withFx.q, withFx.s3, withFx.t3, 8, 1.9);
    check('a 1.9x speed hack is rubber-banded without Ātrums but accepted while it runs (limit 1.3 x 1.5 = 1.95x)', rn.rej > 40 && rw.rej < rn.rej / 8, `without ${rn.rej} rejected, with ${rw.rej}`);
    const re = speedRun(withFx.q, withFx.s3, rw.now + (PU.speed.dur + 2) * 1000, 8, 1.9);
    check('...and rubber-banded again after it expired', re.rej > 3, `${re.rej}`);
    // Magnēts: claim reach
    {
      const { sim: s4, hs: [q], t: t4 } = mk(['M', 'N']);
      setS(q, 3000);
      const id = smalls(s4, q.x, q.z, 400)[0];
      const slack = speedOf(q.r) * 1.3 * 0.4 + 1.5, base = q.r * 0.92 + slack;
      q.x = table.x[id] + base + 3; q.z = table.z[id]; q.lastPosAt = t4;
      const r0 = s4.handleClaims(q, [id], [], t4 + 100, t4 + 100);
      s4.field.slots[2].state = 'on'; s4.field.slots[2].type = 'magnet'; s4.field.slots[2].x = q.x; s4.field.slots[2].z = q.z; s4.handlePickups(q, [2], t4 + 200);
      const r1 = s4.handleClaims(q, [id], [], t4 + 300, t4 + 300);
      check('Magnēts widens the reach tolerance (a claim just past the normal reach fails without it, passes with it)', r0.bad.length === 1 && r1.bad.length === 0, `${r0.bad.length}/${r1.bad.length}`);
      const id2 = smalls(s4, q.x, q.z, 400).find((x) => !s4.eaten[x]); q.x = table.x[id2] + q.r * 0.92 * 1.8 + slack + 3; q.z = table.z[id2];
      check('...but never beyond 1.8 r (+ latency allowance)', s4.handleClaims(q, [id2], [], t4 + 400, t4 + 400).bad.length === 1);
    }
    // Vairogs vs a kill; Dubultpunkti x combo cap
    {
      const { sim: s5, hs: [big, small], t: t5 } = mk(['Big', 'Small'], true);
      setS(big, 900); setS(small, 100); big.protectUntil = small.protectUntil = 0; big.x = small.x = 100; big.z = small.z = 100; big.vx = big.vz = 0;
      s5.field.slots[3].state = 'on'; s5.field.slots[3].type = 'shield'; s5.field.slots[3].x = small.x; s5.field.slots[3].z = small.z; s5.handlePickups(small, [3], t5);
      s5.duels(t5 + 100);
      check('Vairogs: a bigger hole cannot swallow the shielded one', small.state === 0 && big.kills === 0);
      s5.duels(t5 + PU.shield.dur * 1000 + 500);
      check('...and can when the shield ran out', small.state === 1 && big.kills === 1);
    }
    {
      const { sim: s6, hs: [q], t: t6 } = mk(['D', 'E']);
      const ids = smalls(s6, q.x, q.z, 100);
      q.combo.hit(t6 / 1000, 80, q.r, 0);   // a counter of 80 (x3)
      s6.field.slots[4].state = 'on'; s6.field.slots[4].type = 'double'; s6.field.slots[4].x = q.x; s6.field.slots[4].z = q.z; s6.handlePickups(q, [4], t6);
      const s0 = q.score, m0 = q.mass;
      claimAt(s6, q, ids[0], t6 + 300);
      const dP = q.score - s0, dM = q.mass - m0;
      check('Dubultpunkti stacks with the combo, combined cap x5 (x3 combo x2 = 5, not 6)', Math.abs(dP / dM - 5) < 1e-6, `${(dP / dM).toFixed(2)}`);
    }
    // schedule bounds used by the validator
    check('pickup schedule: <= slots x (1 + t / 20 s) pickups in a round', maxPickups(12, 300) === 12 * 16);
  }
  // server bots score by the same rules (they get combos and pick things up)
  {
    const sim = new RoomSim(table, { ...cfg, botHumanGrace: 0 }, 99);
    sim.addHuman('H', 'tokbot123456789'); sim.start(0, 3700, 300000);
    let now = 3700; sim.tick(now);
    for (let i = 0; i < 20 * 120; i++) { now += 50; sim.tick(now); }
    const bots = sim.holes.filter((q) => q.bot);
    check('server bots: points >= mass (they build combos too) and some picked power-ups up in 2 minutes', bots.every((q) => q.score >= q.mass - 1e-6) && bots.some((q) => q.score > q.mass * 1.1) && bots.reduce((a, q) => a + Object.values(q.picks).reduce((x, y) => x + y, 0), 0) >= 1, `top ${bots.map((q) => Math.round(q.score) + '/' + Math.round(q.mass) + '/' + Object.values(q.picks).join('')).join(' ')}`);
  }
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);

