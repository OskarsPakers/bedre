// Freedom Monument protection, server side (plain Node): RoomSim.protectFreedom() makes the monument unclaimable for any hole (a forged claim is rejected,
// bots never target it), the unprotected sim still lets a big hole eat it; the 11-18 Nov Riga-calendar rule; the validator rejects a trace that claims the
// monument while the round ran protected (fm: 1) and still accepts the same trace without the flag.   node scripts/test-freedom.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomSim, fmDay, radiusOf } from '../worker/mp/sim.js';
import { parseTable } from '../worker/mp/table.js';
import { readTableBytes } from '../tools/mp/load-table.mjs';
import { mpConfig } from '../worker/mp/protocol.js';
import { validateSubmission } from '../worker/lib/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`); if (!ok) fails++; };
const table = parseTable(readTableBytes('centrs'));
const ki = table.kinds.indexOf('freedom');
let fid = -1; for (let i = 0; i < table.n; i++) if (table.kind[i] === ki) { fid = i; break; }
check('the table has a Freedom Monument object', ki >= 0 && fid >= 0, `kind ${ki} id ${fid}`);

for (const [label, d] of [['2026-11-10', false], ['2026-11-11', true], ['2026-11-15', true], ['2026-11-18', true], ['2026-11-19', false], ['2026-06-18', false], ['2025-12-18', false]]) check(`fmDay(${label}) = ${d}`, fmDay(label) === d);

const cfg = mpConfig({});
check('mpConfig: MP_TEST_DATE is validated', mpConfig({ MP_TEST_DATE: '2026-11-15' }).testDate === '2026-11-15' && mpConfig({ MP_TEST_DATE: 'nope' }).testDate === null && mpConfig({}).testDate === null);
const room = (protect) => {
  const sim = new RoomSim(table, { ...cfg, testCloseSpawn: false }, 4242);
  if (protect) sim.protectFreedom();
  const h = sim.addHuman('Big', 'tok1234567890abcd');
  sim.start(1000, 3700, 300000);
  sim.tick(1000 + 3700);
  h.mass = h.score = 200000; h.r = radiusOf(h.mass); h.x = table.x[fid]; h.z = table.z[fid]; h.lastPosAt = 1000 + 3700;
  return { sim, h };
};
const claim = ({ sim, h }) => sim.handleClaims(h, [fid], [], 1000 + 3800);
const A = room(false);
check('unprotected: a big hole at the monument eats it (as before)', claim(A).bad.length === 0 && A.sim.eaten[fid] === 1, JSON.stringify(claim(A)));
const B = room(true);
check('protected: protectFreedom marks the id and the shared table stays untouched', B.sim.fmId === fid && table.fit[fid] < 1e8 && B.sim.table.fit[fid] >= 1e8);
const r = claim(B);
check('protected: the same claim is rejected (forged claim), nothing eaten', r.bad.length === 1 && r.bad[0] === fid && B.sim.eaten[fid] === 0, JSON.stringify(r));
// the server's own swallow loop (bots) and the bots' food search never take it: a BOT-sized big hole at the monument
const C = room(true);
let eatenByBot = false;
const bot = C.sim.holes.find((q) => q.bot);
if (bot) { bot.mass = bot.score = 200000; bot.r = radiusOf(bot.mass); bot.x = table.x[fid]; bot.z = table.z[fid]; for (let i = 1; i <= 60; i++) { C.sim.tick(1000 + 3700 + i * 100); if (C.sim.eaten[fid]) eatenByBot = true; } }
check('protected: bots never swallow it (60 simulated ticks of a huge bot standing on it)', !!bot && !eatenByBot);

// ---- validator: a trace that claims the monument while the round ran protected -------------------------------------------------------------------
const n = 3, tr = (fm, kinds) => ({ v: 2, fm, t: [5, 10, 14], s: [10, 20, 30], m: [10, 20, 30], r: [2.2, 2.3, 2.4], e: [1, 2, kinds.freedom ? 3 : 3], k: [0, 0, 0], w: [10, 20, 30], p: [10, 20, 30], c: [0, 0, 0], u: { magnet: [0, 0, 0], speed: [0, 0, 0], double: [0, 0, 0], shield: [0, 0, 0] }, kinds, kills: 0, deaths: 0 });
const sub = (trace) => validateSubmission({ mode: 'classic', map: 'centrs', seconds: 14, age: 15, score: 30, eaten: 3, radius: 2.4, rank: 3, trace });
const bad = sub(tr(1, { person: 2, freedom: 1 }));
check('validator: fm:1 + a swallowed freedom kind -> rejected (freedom_protected)', bad.verdict === 'reject' && bad.reasons.includes('freedom_protected'), JSON.stringify(bad));
const ok = sub(tr(1, { person: 3 }));
check('validator: fm:1 without the monument is not flagged for it', !ok.reasons.includes('freedom_protected'), JSON.stringify(ok));
const free = sub(tr(0, { person: 2, freedom: 1 }));
check('validator: the same kinds with fm:0 are not rejected for the monument rule', !free.reasons.includes('freedom_protected'), JSON.stringify(free));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
