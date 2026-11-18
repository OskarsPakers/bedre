// Local-only API smoke test (no browser). Parallel-safe: builds into scripts/.dist-api, own wrangler config / persistence
// dirs / ports. Covers modes, per-mode boards, daily day handling, migrations (fresh + upgrade from 0001), trace validation
// (accept / suspect / reject), suspect rows hidden, rate limits, profanity, Turnstile (mock siteverify), analytics
// endpoint + DNT, stats endpoint.   API_PORT=8794 node scripts/smoke-api.mjs
import http from 'node:http';
import { buildInto, writeConfig, migrate, sql, startWorker, freshDir, resolve, root, run, cpSync, rmSync, mkdirSync } from './lib-test.mjs';
import { LIMITS, limitsFor } from '../worker/lib/limits.js';
import { MAP_SLUGS } from '../tools/maps.mjs';
import { validateSubmission, expectedSamples } from '../worker/lib/validate.js';
import { MODES, radiusForMode, rigaDay, dailySeed, shiftDay, isDayString } from '../src/rules.js';
import { sanitizeName } from '../worker/lib/moderation.js';

const PORT = Number(process.env.API_PORT || 8794);
const PORT_TS = PORT + 10, PORT_MOCK = PORT + 20;
const dist = buildInto('api');
const config = writeConfig('api', dist);
const persistA = freshDir(resolve(root, '.wrangler/smoke-api-a'));
const persistB = freshDir(resolve(root, '.wrangler/smoke-api-b'));
const persistU = freshDir(resolve(root, '.wrangler/smoke-api-upgrade'));

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
process.on('exit', () => procs.forEach((p) => p.kill()));

// ---- helpers ---------------------------------------------------------------------------------------------------
// trace v2 (scoring rules 2): points s, growth mass m (= s when no combo), raw value w, swallow points p, best combo c, pickups u
const U0 = (n) => ({ magnet: Array(n).fill(0), speed: Array(n).fill(0), double: Array(n).fill(0), shield: Array(n).fill(0) });
const mkTrace = ({ mode = 'classic', score, eaten = 1, kinds = { building: 1 }, kills = 0, deaths = 0, t = 2 }) => ({
  v: 2, t: [t], s: [score], m: [score], r: [Math.round(radiusForMode(score, mode) * 100) / 100], e: [eaten], k: [kills], w: [score], p: [score], c: [0], u: U0(1), kinds, kills, deaths,
});
const mkTraceV1 = ({ mode = 'classic', score, eaten = 1, kinds = { building: 1 }, kills = 0, deaths = 0, t = 2 }) => ({
  v: 1, t: [t], s: [score], r: [Math.round(radiusForMode(score, mode) * 100) / 100], e: [eaten], k: [kills], kinds, kills, deaths,
});
const gain0 = (mode) => limitsFor('centrs').modes[mode].gain[0];
const okScore = (mode) => Math.max(5, Math.floor(gain0(mode) * 0.5));
const susScore = (mode) => Math.floor(gain0(mode) * 2.5);           // between SOFT x2 and HARD x3 (single 2 s interval: stretch 1)
const badScore = (mode) => Math.ceil(gain0(mode) * 3.5);
const body = (mode, roundId, score, extra = {}) => ({
  roundId, name: 'Anna', score, eaten: 1, radius: Math.round(radiusForMode(score, mode) * 100) / 100, rank: 3, biggest: 'Dom Cathedral',
  trace: mkTrace({ mode, score }), ...extra,
});

async function main() {
  let r, j;
  // ================= migrations: fresh DB (all) and upgrades from EVERY earlier schema (0001 ... 0005) ===============
  {
    const MIGS = ['0001_init.sql', '0002_modes_anticheat.sql', '0003_stats.sql', '0004_maps.sql', '0005_difficulty.sql'];
    for (let k = 1; k <= MIGS.length; k++) {
      const onlyK = resolve(root, `scripts/.tmp-api/mig-000${k}`);
      freshDir(onlyK); for (const f of MIGS.slice(0, k)) cpSync(resolve(root, 'migrations', f), resolve(onlyK, f));
      const persist = freshDir(resolve(root, `.wrangler/smoke-api-upgrade-${k}`));
      const cfgK = writeConfig(`api-mig${k}`, dist, onlyK);
      migrate(cfgK, persist);
      sql(cfgK, persist, "INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at) VALUES ('Old Timer', 777, 10, 5.5, 2, 'tram', 1700000000)");
      sql(cfgK, persist, "INSERT INTO rounds (id, created_at, ip_hash, used) VALUES ('old-round', 1700000000, 'x', 1)");
      migrate(config, persist);   // now the full set (up to 0006) on the same DB
      const row = sql(config, persist, 'SELECT name, score, mode, map, day, suspect, rules FROM scores')[0];
      check(`upgrade 0001..000${k} -> 0006: the old score row survives (classic + centrs, not suspect, rules NULL = archive)`, row && row.name === 'Old Timer' && row.mode === 'classic' && row.map === 'centrs' && row.suspect === 0 && row.day === null && row.rules === null, JSON.stringify(row));
      const rr = sql(config, persist, "SELECT mode, map FROM rounds WHERE id='old-round'")[0];
      check(`upgrade from 000${k}: old round row becomes classic + centrs`, rr && rr.mode === 'classic' && rr.map === 'centrs', JSON.stringify(rr));
      const tabs = sql(config, persist, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stats','rate_limits') ORDER BY name").map((r) => r.name);
      check(`upgrade from 000${k}: stats + rate_limits tables exist`, tabs.join() === 'rate_limits,stats', tabs.join());
      migrate(config, persist);   // idempotent re-run
      check(`upgrade from 000${k}: re-apply is a no-op`, sql(config, persist, 'SELECT COUNT(*) AS n FROM scores')[0].n === 1);
      rmSync(persist, { recursive: true, force: true });
    }
    migrate(config, persistA); migrate(config, persistB);
    const cols = sql(config, persistA, "SELECT name FROM pragma_table_info('scores')").map((r) => r.name);
    check('fresh DB has the 0002 + 0004 + 0005 + 0006 columns (rules is nullable)', ['mode', 'day', 'suspect', 'flags', 'trace', 'round_id', 'map', 'difficulty', 'rules'].every((c) => cols.includes(c)), cols.join());
    check('0006 column is nullable INTEGER', sql(config, persistA, "SELECT type, \"notnull\" AS nn FROM pragma_table_info('scores') WHERE name='rules'").map((r) => r.type + r.nn).join() === 'INTEGER0');
  }

  const A = await startWorker({ config, persist: persistA, port: PORT, vars: { ROUND_SECONDS_OVERRIDE: 2, RATE_ROUNDS_PER_HOUR: 28, CAP_DAILY: 2 } });
  procs.push(A);
  const BASE = A.base;
  const req = (path, init = {}) => fetch(BASE + path, init);
  const post = (path, b, headers = {}, raw) => req(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ?? JSON.stringify(b) });
  const newRound = async (b = {}, ip) => { const r = await post('/api/rounds', b, ip ? { 'cf-connecting-ip': ip } : {}); return { status: r.status, j: await r.json() }; };
  const scores = async (q) => (await (await req('/api/scores?' + q)).json());

  r = await req('/');
  check('static index.html at /', r.ok && (await r.text()).includes('<html'));
  r = await req('/data/riga.json');
  check('/data/riga.json served', r.ok && (await r.text()).includes('"buildings"'));
  r = await req('/stats.html');
  check('/stats.html served', r.ok && (await r.text()).includes('/api/stats'));

  // ---- boards: empty, validation
  for (const m of ['classic', 'quick', 'daily', 'online']) {
    const j = await scores(`mode=${m}&period=all&limit=20`);
    check(`GET /api/scores mode=${m} empty`, Array.isArray(j.scores) && j.scores.length === 0 && j.mode === m, JSON.stringify(j));
  }
  r = await req('/api/scores?period=all&limit=20');
  check('default mode is classic, cache-control set', (await r.json()).mode === 'classic' && (r.headers.get('cache-control') || '').includes('max-age=15'));
  check('bad period -> 400', (await req('/api/scores?period=zzz')).status === 400);
  check('bad mode -> 400', (await req('/api/scores?mode=zzz')).status === 400);
  check('bad day -> 400', (await req('/api/scores?mode=daily&day=2026-13-99')).status === 400);
  check('DELETE /api/scores -> 405', (await req('/api/scores', { method: 'DELETE' })).status === 405);
  check('GET /api/rounds -> 405', (await req('/api/rounds')).status === 405);
  check('unknown /api path -> 404', (await req('/api/nope')).status === 404);

  // ---- rounds: modes, daily day handling
  const today = rigaDay(Math.floor(Date.now() / 1000));
  const rc = await newRound({});
  check('POST /api/rounds {} = classic, 2 s (override), has seed', rc.status === 201 && rc.j.mode === 'classic' && rc.j.roundSeconds === 2 && Number.isInteger(rc.j.seed) && !rc.j.turnstileSiteKey, JSON.stringify(rc.j));
  const rq = await newRound({ mode: 'quick' });
  check('POST /api/rounds quick', rq.status === 201 && rq.j.mode === 'quick', JSON.stringify(rq.j));
  const rd = await newRound({ mode: 'daily', day: today });
  check('POST /api/rounds daily returns day + deterministic seed', rd.status === 201 && rd.j.day === today && rd.j.seed === dailySeed(today), JSON.stringify(rd.j));
  const rd0 = await newRound({ mode: 'daily' });
  check('daily without day defaults to today (same seed)', rd0.status === 201 && rd0.j.day === today && rd0.j.seed === rd.j.seed, JSON.stringify(rd0.j));
  const yesterday = shiftDay(today, -1), tomorrow = shiftDay(today, 1);
  const graceOpen = rigaDay(Math.floor(Date.now() / 1000) - 120) !== today;       // within 2 min after Riga midnight yesterday is still allowed
  let x = await newRound({ mode: 'daily', day: yesterday });
  check('daily with yesterday -> 409 (outside the midnight grace)', graceOpen ? x.status === 201 : x.status === 409, JSON.stringify(x));
  x = await newRound({ mode: 'daily', day: tomorrow });
  check('daily with tomorrow -> 409', x.status === 409 && x.j.today === today, JSON.stringify(x));
  x = await newRound({ mode: 'daily', day: 'garbage' });
  check('daily with malformed day -> 400', x.status === 400, JSON.stringify(x));
  for (const m of ['online', 'free', 'zzz', 5]) check(`rounds: mode ${JSON.stringify(m)} not startable by clients -> 400`, (await newRound({ mode: m })).status === 400);
  const seeds = new Set([(await newRound({})).j.seed, (await newRound({})).j.seed]);
  check('classic seeds are random per round', seeds.size === 2);

  // ---- create the rounds used below, then wait once for the round age
  const roundNames = ['staleV1', 'okA', 'dup', 'quick', 'daily', 'sus', 'rej', 'notrace', 'prof', 'modeMis', 'badTrace', 'invalid', 'diffOk', 'diffBad', 'diffNone'];
  const R = {};
  for (const n of roundNames) R[n] = (await newRound(n === 'quick' ? { mode: 'quick' } : n === 'daily' ? { mode: 'daily' } : n.startsWith('diff') ? { map: 'mezaparks' } : {})).j.roundId;
  r = await post('/api/scores', body('classic', R.okA, okScore('classic')));
  check('immediate submit rejected (too early)', r.status === 403, `${r.status}`);
  await sleep(2400);

  r = await post('/api/scores', body('classic', 'nonexistent', 5));
  check('unknown roundId rejected', r.status === 403, `${r.status}`);
  const good = body('classic', R.invalid, okScore('classic'));
  for (const [label, patch] of [
    ['empty name', { name: '   ' }], ['name too long', { name: 'x'.repeat(17) }], ['negative score', { score: -1 }], ['float score', { score: 1.5 }],
    ['huge score', { score: 1e12 }], ['string score', { score: '99' }], ['huge radius', { radius: 1e9 }], ['bad rank', { rank: -2 }],
    ['client mode online', { mode: 'online' }], ['client mode free', { mode: 'free' }],
  ]) {
    r = await post('/api/scores', { ...good, ...patch });
    check(`reject (400) ${label}`, r.status === 400, `${r.status}`);
  }
  r = await post('/api/scores', good, {}, 'not json'); check('reject invalid JSON', r.status === 400, `${r.status}`);
  r = await req('/api/scores', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(good) });
  check('reject non-JSON content-type', r.status === 415, `${r.status}`);
  r = await post('/api/scores', { ...good, pad: 'x'.repeat(13000) }); check('reject oversized body', r.status === 413, `${r.status}`);
  r = await post('/api/scores', good, { origin: 'https://evil.example' }); check('reject cross-origin POST', r.status === 403, `${r.status}`);
  r = await post('/api/scores', { ...good, mode: 'quick' }); check('mode mismatch with the round -> 400', r.status === 400, `${r.status}`);
  // none of the above burnt the round
  r = await post('/api/scores', body('classic', R.invalid, okScore('classic')));
  check('invalid payloads did not consume the round', r.status === 201, `${r.status}`);

  // ---- trace validation through the API
  r = await post('/api/scores', { ...body('classic', R.notrace, okScore('classic')), trace: undefined });
  check('missing trace -> 422', r.status === 422 && (await r.json()).reasons.includes('trace_missing'), `${r.status}`);
  r = await post('/api/scores', body('classic', R.notrace, okScore('classic')));
  check('a rejected submission burns the round token (replay -> 409)', r.status === 409, `${r.status}`);
  const broken = body('classic', R.badTrace, 5); broken.trace.kinds = { person: 99 };
  r = await post('/api/scores', broken); j = await r.json();
  check('kinds count != eaten -> 422', r.status === 422 && j.reasons.includes('kinds_sum'), JSON.stringify(j));
  r = await post('/api/scores', body('classic', R.rej, badScore('classic')));
  j = await r.json();
  check('gain above HARD ceiling -> 422, nothing stored', r.status === 422 && j.reasons.some((x) => /gain_hard|cap_hard|kind_values_hard/.test(x)), JSON.stringify(j));
  r = await post('/api/scores', body('classic', R.sus, susScore('classic')));
  j = await r.json();
  check('gain between SOFT and HARD -> accepted as suspect (looks like success)', r.status === 201 && j.ok && j.rankAllTime >= 1, JSON.stringify(j));

  // ---- a stale tab (old client) still sends the v1 trace: accepted, but it is a pre-combo score -> rules 1 = the archive, never the current board
  r = await post('/api/scores', { ...body('classic', R.staleV1, okScore('classic')), trace: mkTraceV1({ mode: 'classic', score: okScore('classic') }), name: 'Stale Sam' }); j = await r.json();
  check('v1 trace (old client) accepted, answered as an archive result', r.status === 201 && j.rules === 1, JSON.stringify(j));
  check('...stored with rules = 1', sql(config, persistA, "SELECT rules FROM scores WHERE name = 'Stale Sam'")[0].rules === 1);

  // ---- good submissions + sanitising + per-mode boards
  r = await post('/api/scores', { ...body('classic', R.okA, okScore('classic')), name: '  <b>Ann\u0007a</b>\n  "Z"  ' });
  j = await r.json();
  check('valid classic submit succeeds, name sanitised', r.status === 201 && j.ok && j.mode === 'classic' && j.name === 'bAnn a/b "Z"', JSON.stringify(j));
  r = await post('/api/scores', body('classic', R.okA, okScore('classic'))); check('replay of same roundId rejected', r.status === 409, `${r.status}`);
  r = await post('/api/scores', { ...body('classic', R.prof, 5), name: 'F u c k er' }); j = await r.json();
  check('profanity -> "Anonīms"', r.status === 201 && j.name === 'Anonīms', JSON.stringify(j));
  check('moderation unit: names', sanitizeName('Pizdets') === 'Anonīms' && sanitizeName('Хуй') === 'Anonīms' && sanitizeName('Jānis Bērziņš') === 'Jānis Bērziņš' && sanitizeName('') === null);
  check('name policy: & " \' kept, angle brackets and invisibles dropped, same on every path',
    sanitizeName('<b>Ann</b>&"x') === 'bAnn/b&"x' && sanitizeName("O'Neil & Co") === "O'Neil & Co" && sanitizeName('A\u200bB\u202eC') === 'A B C' && sanitizeName('<>') === null && sanitizeName('x'.repeat(17)) === null && sanitizeName('😀 Ann') === '😀 Ann');
  r = await post('/api/scores', { ...body('classic', R.modeMis, 5), mode: 'daily' }); check('mode field != round mode -> 400', r.status === 400, `${r.status}`);

  r = await post('/api/scores', { ...body('quick', R.quick, okScore('quick')), name: 'Quicky' }); j = await r.json();
  check('quick submit ok', r.status === 201 && j.mode === 'quick', JSON.stringify(j));
  r = await post('/api/scores', { ...body('daily', R.daily, okScore('daily')), name: 'Daily Dan' }); j = await r.json();
  check('daily submit ok, bound to the day', r.status === 201 && j.mode === 'daily' && j.day === today && j.rankAllTime === 1, JSON.stringify(j));

  sql(config, persistA, `INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at, mode, rules) VALUES ('Net Nina', 999, 5, 9.5, 1, 'tram', ${Math.floor(Date.now() / 1000)}, 'online', 2)`);
  // pre-combo rows (rules NULL / 1): not on the current boards, visible in the archive only
  sql(config, persistA, `INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at, mode) VALUES ('Old Olga', 123456, 50, 90, 1, 'tram', ${Math.floor(Date.now() / 1000)}, 'classic')`);
  sql(config, persistA, `INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at, mode, rules) VALUES ('Old Oleg', 654321, 50, 90, 1, 'tram', ${Math.floor(Date.now() / 1000)}, 'online', 1)`);
  const names = (j2) => j2.scores.map((s) => s.name);
  const c = await scores('mode=classic&period=all'), q = await scores('mode=quick&period=all'), d = await scores(`mode=daily&day=${today}`), o = await scores('mode=online&period=all');
  check('classic board: only current-rules classic rows, suspect row hidden (3 rows)', c.scores.length === 3 && ['bAnn a/b "Z"', 'Anna', 'Anonīms'].every((x) => names(c).includes(x)), JSON.stringify(names(c)));
  check('quick board has only the quick score', names(q).join() === 'Quicky', JSON.stringify(names(q)));
  check('daily board (today) has only the daily score', names(d).join() === 'Daily Dan' && d.day === today, JSON.stringify(d));
  check('daily board of yesterday is empty', (await scores(`mode=daily&day=${yesterday}`)).scores.length === 0);
  check('online board shows server-written rows', names(o).join() === 'Net Nina', JSON.stringify(o));
  const flagged = sql(config, persistA, "SELECT suspect, flags, mode, length(trace) AS tl FROM scores WHERE suspect = 1");
  check('suspect row stored (suspect=1, reason codes, trace kept) but hidden', flagged.length === 1 && /gain_soft|cap_soft|kind_values/.test(flagged[0].flags) && flagged[0].tl > 20, JSON.stringify(flagged));
  check('rejected rounds stored nothing (exactly 10 rows: 8 new + 2 archive rows)', sql(config, persistA, 'SELECT COUNT(*) AS n FROM scores')[0].n === 10);
  // ---- scoring rules (migration 0006): boards = the current rules, ?archive=1 = the older ones; new rows carry rules 2
  {
    const ar = await scores('mode=classic&period=all&archive=1'), ao = await scores('mode=online&period=all&archive=1');
    check('current board has no pre-combo rows (Old Olga hidden), says which rules', !names(c).includes('Old Olga') && c.rules === 2, JSON.stringify([names(c), c.rules]));
    check('archive board (?archive=1) shows exactly the pre-combo rows (incl. the stale-tab v1 score), labelled', names(ar).join() === 'Old Olga,Stale Sam' && ar.rules === 'archive' && names(ao).join() === 'Old Oleg', JSON.stringify([names(ar), names(ao)]));
    check('new rows are stored with rules = 2', sql(config, persistA, "SELECT rules FROM scores WHERE name = 'Quicky'")[0].rules === 2);
    check('archive of a map without old rows is empty', (await scores('mode=classic&map=purvciems&period=all&archive=1')).scores.length === 0);
  }

  // ---- per-map boards (migration 0004): rounds are bound to a map, boards are one per map x mode, daily / online are centre-only
  {
    const MIP = 'map-ip';
    const mr = (b) => newRound(b, MIP);
    const rP = await mr({ mode: 'classic', map: 'purvciems' }), rDef = await mr({ mode: 'classic' }), rQa = await mr({ mode: 'quick', map: 'agenskalns' });
    const rMz = await mr({ mode: 'classic', map: 'mezaparks' }), rMis = await mr({ mode: 'classic', map: 'purvciems' });
    check('rounds: map is echoed (and defaults to centrs)', rP.status === 201 && rP.j.map === 'purvciems' && rDef.status === 201 && rDef.j.map === 'centrs', JSON.stringify([rP.j, rDef.j]));
    for (const bad of ['nowhere', 5, '', '../centrs', null]) check(`rounds: map ${JSON.stringify(bad)} -> 400`, (await mr({ mode: 'classic', map: bad })).status === 400);
    check('rounds: daily on a district map -> 400 (centre only)', (await mr({ mode: 'daily', map: 'mezaparks' })).status === 400);
    check('rounds: daily on centrs with map given -> 201', (await mr({ mode: 'daily', map: 'centrs' })).status === 201);
    check('map allow-list matches tools/maps.mjs', MAP_SLUGS.includes('centrs') && MAP_SLUGS.length === 4);
    await sleep(2400);
    r = await post('/api/scores', { ...body('classic', rMis.j.roundId, okScore('classic')), map: 'agenskalns' }, MIP ? { 'cf-connecting-ip': MIP } : {});
    check('scores: map field != the round map -> 400', r.status === 400, `${r.status}`);
    r = await post('/api/scores', { ...body('classic', rMis.j.roundId, okScore('classic')), map: 'zzz' }, { 'cf-connecting-ip': MIP });
    check('scores: unknown map -> 400', r.status === 400, `${r.status}`);
    r = await post('/api/scores', { ...body('classic', rP.j.roundId, okScore('classic') + 3), map: 'purvciems', name: 'Purv' }, { 'cf-connecting-ip': MIP }); j = await r.json();
    check('scores: purvciems classic submit ok, answer names the map', r.status === 201 && j.map === 'purvciems' && j.rankAllTime === 1, JSON.stringify(j));
    r = await post('/api/scores', { ...body('quick', rQa.j.roundId, okScore('quick')), name: 'Agen' }, { 'cf-connecting-ip': MIP }); j = await r.json();
    check('scores: map omitted -> the round\'s map (agenskalns quick)', r.status === 201 && j.map === 'agenskalns', JSON.stringify(j));
    r = await post('/api/scores', { ...body('classic', rMz.j.roundId, okScore('classic')), map: 'mezaparks', name: 'Meza' }, { 'cf-connecting-ip': MIP });
    check('scores: mezaparks classic submit ok', r.status === 201);
    const pc = await scores('mode=classic&map=purvciems&period=all'), cc = await scores('mode=classic&period=all'), ac = await scores('mode=classic&map=agenskalns&period=all'), aq = await scores('mode=quick&map=agenskalns&period=all');
    check('board per map: purvciems classic has only Purv', names(pc).join() === 'Purv' && pc.map === 'purvciems', JSON.stringify(pc));
    check('board per map: the centre classic board is untouched (3 rows) and default map = centrs', cc.scores.length === 3 && cc.map === 'centrs', JSON.stringify(names(cc)));
    check('board per map: agenskalns classic empty, agenskalns quick has Agen', ac.scores.length === 0 && names(aq).join() === 'Agen', JSON.stringify([names(ac), names(aq)]));
    check('boards: unknown map -> 400', (await req('/api/scores?mode=classic&map=zzz')).status === 400);
    const dq = await scores('mode=daily&map=purvciems&period=all'), oq = await scores('mode=online&map=mezaparks&period=all');
    check('boards: daily / online on a district map are empty', dq.scores.length === 0 && oq.scores.length === 0);
    const mrow = sql(config, persistA, "SELECT map FROM scores WHERE name = 'Purv'")[0];
    check('scores row stores the map column', mrow && mrow.map === 'purvciems', JSON.stringify(mrow));
    // the plausibility limits are per map: every map has its own table and an unknown slug falls back to the centre
    check('limits: every map has a table with the three required parts', MAP_SLUGS.every((m) => { const L = limitsFor(m); return L && L.modes.classic && L.modes.quick && L.value && L.valueOther > 0; }));
    check('limits: daily limits exist for the centre only', !!limitsFor('centrs').modes.daily && MAP_SLUGS.filter((m) => m !== 'centrs').every((m) => !limitsFor(m).modes.daily));
    check('limits: unknown map falls back to the centre', limitsFor('nope') === limitsFor('centrs'));
  }

  {
  // difficulty tag (migration 0005): informational, optional, validated; never splits a board
  r = await post('/api/scores', body('classic', R.diffBad, okScore('classic'), { map: 'mezaparks', difficulty: 'impossible' }));
  check('invalid difficulty -> 400 (round not burnt)', r.status === 400, `${r.status}`);
  r = await post('/api/scores', body('classic', R.diffBad, okScore('classic'), { map: 'mezaparks', difficulty: 'hard' }));
  check('difficulty hard accepted', r.status === 201, `${r.status}`);
  r = await post('/api/scores', body('classic', R.diffOk, okScore('classic') + 1, { map: 'mezaparks', difficulty: 'easy' }));
  check('difficulty easy accepted', r.status === 201, `${r.status}`);
  r = await post('/api/scores', body('classic', R.diffNone, okScore('classic') + 2, { map: 'mezaparks' }));
  check('score without difficulty (old client) still accepted', r.status === 201, `${r.status}`);
  j = await scores('mode=classic&map=mezaparks&period=all');
  check('GET scores returns the difficulty tag (null for old clients) in ONE board', j.scores.length === 4 && j.scores.map((x) => x.difficulty).sort().join() === 'easy,hard,,' && j.scores.every((x) => 'difficulty' in x), JSON.stringify(j.scores.map((x) => x.difficulty)));

  }

  // ---- rate limits (per hashed IP)
  const cap = [];
  for (let i = 0; i < 3; i++) cap.push((await newRound({ mode: 'daily' }, 'cap-ip')).j.roundId);
  await sleep(2400);
  const st = [];
  for (const id of cap) st.push((await post('/api/scores', { ...body('daily', id, okScore('daily')), name: 'Cap' }, { 'cf-connecting-ip': 'cap-ip' })).status);
  check('daily cap per IP-hash (2): 201, 201, 429', st.join() === '201,201,429', st.join());
  const rl = [];
  for (let i = 0; i < 30; i++) rl.push((await newRound({}, 'rl-ip')).status);
  check('rounds/hour limit per IP-hash returns 429', rl[0] === 201 && rl.includes(429) && rl.filter((s) => s === 201).length === 28, rl.join(''));
  check('another IP is not affected', (await newRound({}, 'other-ip')).status === 201);

  // ---- analytics beacon + stats
  const ev = (d, headers = {}, ct = 'application/json') => req('/api/e', { method: 'POST', headers: { 'content-type': ct, ...headers }, body: JSON.stringify({ d }) });
  check('beacon 204', (await ev({ pv: 1, 'rs:classic': 2, 'dev:desktop': 1, 'sb:classic:3': 1, 'theme:night': 1 }, { 'cf-connecting-ip': 'ev1' })).status === 204);
  check('beacon accepts text/plain (sendBeacon)', (await ev({ pv: 1 }, { 'cf-connecting-ip': 'ev1' }, 'text/plain')).status === 204);
  await ev({ 'hack:x': 5, 'rs:evil': 3, '__proto__': 1, 'err:js': 'many', pv: 9999 }, { 'cf-connecting-ip': 'ev2' });
  await ev({ pv: 1, 'rs:classic': 1 }, { dnt: '1', 'cf-connecting-ip': 'ev3' });
  await ev({ pv: 1 }, { 'sec-gpc': '1', 'cf-connecting-ip': 'ev3' });
  r = await req('/api/stats?days=30'); j = await r.json();
  const t0 = j.days.find((x) => x.day === today);
  check('stats: allow-listed counters aggregated (pv 1+1+50 cap, rs:classic 2)', t0 && t0.keys.pv === 52 && t0.keys['rs:classic'] === 2 && t0.keys['dev:desktop'] === 1 && t0.keys['theme:night'] === 1, JSON.stringify(t0));
  check('stats: unknown keys ignored', t0 && !('hack:x' in t0.keys) && !('rs:evil' in t0.keys) && !('err:js' in t0.keys), JSON.stringify(t0));
  check('stats: DNT / Sec-GPC beacons not counted', t0 && t0.keys['rs:classic'] === 2);
  check('stats: public cache header, days param validated', (r.headers.get('cache-control') || '').includes('max-age') && (await req('/api/stats?days=abc')).ok);
  check('beacon: GET -> 405, oversized -> 413', (await req('/api/e')).status === 405 && (await post('/api/e', { d: { pv: 1 }, pad: 'x'.repeat(3000) }, {}, undefined)).status === 413);
  let sent = 0; for (let i = 0; i < 45; i++) { await ev({ 'share': 1 }, { 'cf-connecting-ip': 'flood' }); sent++; }
  j = await (await req('/api/stats?days=1')).json();
  const shares = (j.days.find((x) => x.day === today) || { keys: {} }).keys.share || 0;
  check('beacon rate limit per IP-hash (40 / 10 min)', shares === 40, `share=${shares} of ${sent}`);

  A.kill(); procs.pop();

  // ================= instance B: Turnstile on (mock siteverify) + STATS_KEY ====================================
  const verifyCalls = [];
  const mock = http.createServer((q, s) => {
    let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => {
      const p = new URLSearchParams(b); verifyCalls.push(Object.fromEntries(p));
      s.setHeader('content-type', 'application/json');
      s.end(JSON.stringify(p.get('response') === 'good-token' && p.get('secret') === 'test-secret' ? { success: true, hostname: 'localhost' } : { success: false, 'error-codes': ['invalid-input-response'] }));
    });
  }).listen(PORT_MOCK);
  procs.push({ kill: () => mock.close() });
  const B = await startWorker({ config, persist: persistB, port: PORT_TS, vars: {
    ROUND_SECONDS_OVERRIDE: 2, TURNSTILE_SECRET: 'test-secret', TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_VERIFY_URL: `http://127.0.0.1:${PORT_MOCK}/siteverify`, STATS_KEY: 'sekret' } });
  procs.push(B);
  const postB = (path, b, h = {}) => fetch(B.base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  const rb = [];
  for (let i = 0; i < 4; i++) rb.push(await (await postB('/api/rounds', { mode: 'classic' })).json());
  check('Turnstile on: round response carries the public site key', rb[0].turnstileSiteKey === '1x00000000000000000000AA', JSON.stringify(rb[0]));
  await sleep(2400);
  r = await postB('/api/scores', body('classic', rb[0].roundId, okScore('classic')));
  check('Turnstile on: submit without token -> 403', r.status === 403, `${r.status}`);
  r = await postB('/api/scores', { ...body('classic', rb[0].roundId, okScore('classic')), turnstile: 'bad-token' });
  check('Turnstile on: invalid token -> 403 (round kept for retry)', r.status === 403, `${r.status}`);
  r = await postB('/api/scores', { ...body('classic', rb[0].roundId, okScore('classic')), turnstile: 'good-token' });
  check('Turnstile on: valid token -> 201', r.status === 201, `${r.status}`);
  check('siteverify called (not for the token-less request) with secret + response form fields', verifyCalls.length === 2 && verifyCalls.every((c) => c.secret === 'test-secret' && c.response) && verifyCalls[1].response === 'good-token', JSON.stringify(verifyCalls));
  r = await req_B('/api/stats?days=7'); check('STATS_KEY set: no key -> 401', r.status === 401);
  r = await fetch(B.base + '/api/stats?days=7', { headers: { authorization: 'Bearer sekret' } }); check('STATS_KEY set: bearer -> 200', r.status === 200 && (r.headers.get('cache-control') || '').includes('no-store'));
  B.kill(); mock.close(); procs.length = 0;
  function req_B(p) { return fetch(B.base + p); }

  // ================= validator unit tests (no server) ===========================================================
  const sec = 300, n = 30;
  const long = (mode, perStep, kinds = { building: 30 }) => {
    const tr = { v: 1, t: [], s: [], r: [], e: [], k: [], kinds, kills: 0, deaths: 0 };
    let s = 0;
    for (let i = 0; i < n; i++) { s += perStep; tr.t.push(10 * (i + 1)); tr.s.push(Math.round(s)); tr.r.push(Math.round(radiusForMode(s, mode) * 100) / 100); tr.e.push(i + 1); tr.k.push(0); }
    return tr;
  };
  const v = (tr, mode = 'classic', extra = {}) => validateSubmission({ mode, seconds: sec, age: sec + 3, score: tr.s[n - 1], eaten: tr.e[n - 1], radius: tr.r[n - 1], rank: 2, trace: tr, ...extra });
  const low = Math.max(10, Math.floor(gain0('classic') * 0.4));
  check('validator: a modest 30-sample round is ok', v(long('classic', low)).verdict === 'ok', JSON.stringify(v(long('classic', low))));
  check('validator: expectedSamples(300)=30, (300.06)=30, (6)=1, (12)=2', expectedSamples(300) === 30 && expectedSamples(300.06) === 30 && expectedSamples(6) === 1 && expectedSamples(12) === 2);
  check('validator: huge steady gains rejected on every map', MAP_SLUGS.every((m) => v(long('classic', limitsFor(m).modes.classic.gain[2] * 4), 'classic', { map: m }).verdict !== 'ok'));
  check('validator: huge steady gains rejected', v(long('classic', limitsFor('centrs').modes.classic.gain[2] * 4)).verdict !== 'ok');
  let tr = long('classic', low); tr.t[10] += 5;
  check('validator: sample off its 10 s slot -> reject', v(tr).verdict === 'reject');
  tr = long('classic', low); tr.t.splice(5, 1); tr.s.splice(5, 1); tr.r.splice(5, 1); tr.e.splice(5, 1); tr.k.splice(5, 1);
  check('validator: missing samples -> reject', v(tr).verdict === 'reject');
  tr = long('classic', low); tr.e[7] = 0;
  check('validator: eaten decreasing -> reject', v(tr).verdict === 'reject');
  tr = long('classic', low);
  check('validator: round shorter than the server length -> reject', v(tr, 'classic', { seconds: 400 }).verdict === 'reject');
  check('validator: claimed play time longer than the round age -> reject', v(tr, 'classic', { age: 100 }).verdict === 'reject');
  check('validator: rank beyond the number of holes -> reject', v(tr, 'classic', { rank: 9 }).verdict === 'reject');
  tr = long('classic', low); tr.r[29] = tr.r[29] * 3;
  check('validator: radius inconsistent with growth formula -> not ok', v(tr).verdict !== 'ok');
  // ---- trace v2 (combos + power-ups): the consistency checks
  {
    const long2 = (mode, perStep, { mult = 1, c = 0, eat = 1 } = {}) => {
      const tr = { v: 2, t: [], s: [], m: [], r: [], e: [], k: [], w: [], p: [], c: [], u: U0(n), kinds: { building: eat * n }, kills: 0, deaths: 0 };
      let raw = 0;
      for (let i = 0; i < n; i++) {
        raw += perStep; const pts = raw * mult;
        tr.t.push(10 * (i + 1)); tr.s.push(Math.round(pts)); tr.m.push(Math.round(raw)); tr.w.push(Math.round(raw)); tr.p.push(Math.round(pts));
        tr.r.push(Math.round(radiusForMode(raw, mode) * 100) / 100); tr.e.push(eat * (i + 1)); tr.k.push(0); tr.c.push(c);
      }
      return tr;
    };
    const v2 = (tr, mode = 'classic', extra = {}) => validateSubmission({ mode, seconds: sec, age: sec + 3, score: tr.s[n - 1], eaten: tr.e[n - 1], radius: tr.r[n - 1], rank: 2, trace: tr, ...extra });
    const lowRaw = Math.max(10, Math.floor(gain0('classic') * 0.3));
    check('v2: a modest round without a combo is ok', v2(long2('classic', lowRaw)).verdict === 'ok', JSON.stringify(v2(long2('classic', lowRaw))));
    check('v2: a x3 combo round (counter 120) with points = 3 x raw is not rejected', v2(long2('classic', lowRaw / 2, { mult: 3, c: 120, eat: 40 })).verdict !== 'reject', JSON.stringify(v2(long2('classic', lowRaw / 2, { mult: 3, c: 120, eat: 40 }))));
    let t2 = long2('classic', lowRaw, { mult: 1 });  t2.p = t2.p.map((x) => x * 4); t2.s = t2.s.map((x) => x * 4);
    check('v2: inflated multiplier (points x4 with no combo) -> reject points_mult', (() => { const x = v2(t2); return x.verdict === 'reject' && x.reasons.includes('points_mult'); })(), JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw / 2, { mult: 4, c: 120, eat: 40 });
    check('v2: x4 with a x3 combo and no Dubultpunkti -> reject points_mult', v2(t2).reasons.includes('points_mult'), JSON.stringify(v2(t2)));
    // an honest x5 interval (x3 combo x2 Dubultpunkti): 100 raw -> 500 points in interval 9, the pickup counted at sample 9
    {
      const q = long2('classic', 20, { mult: 1, c: 120, eat: 40 });
      q.u.double = q.u.double.map((_, i) => (i >= 9 ? 1 : 0));
      for (let i = 9; i < n; i++) { const extra = i === 9 ? 20 * 4 : 0; q.p[i] += extra * 1; q.s[i] += extra; for (let j = i + 1; j < n; j++) { q.p[j] += extra; q.s[j] += extra; } }
      // (interval 9: raw +20, points +20 + 80 = 100 = x5; every later interval is plain again)
      check('v2: x3 combo x Dubultpunkti = x5 right after the pickup is accepted (combined cap 5), x6 would not be', !v2(q).reasons.includes('points_mult'), JSON.stringify(v2(q)));
      const q6 = long2('classic', 20, { mult: 1, c: 120, eat: 40 }); q6.u.double = q6.u.double.map((_, i) => (i >= 9 ? 1 : 0));
      for (let i = 9; i < n; i++) { const extra = i === 9 ? 20 * 5 : 0; q6.p[i] += extra; q6.s[i] += extra; for (let j = i + 1; j < n; j++) { q6.p[j] += extra; q6.s[j] += extra; } }
      check('v2: ...x6 in that interval (beyond the combined cap) -> reject', v2(q6).reasons.includes('points_mult'), JSON.stringify(v2(q6)));
    }
    t2 = long2('classic', lowRaw); t2.u.speed = t2.u.speed.map((_, i) => 500 + i);
    check('v2: impossible power-up count -> reject powerups_count', v2(t2).reasons.includes('powerups_count'), JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw); t2.u.shield = t2.u.shield.map((_, i) => (i >= 12 ? 70 : 0));
    check('v2: more pickups in one interval than the map has slots -> reject powerups_burst', v2(t2).reasons.includes('powerups_burst'), JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw, { c: 9000 });
    check('v2: combo longer than the swallowed count allows -> reject combo_eaten', v2(t2).reasons.includes('combo_eaten'), JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw); t2.m = t2.m.map((x) => x * 5);
    check('v2: growth mass above the raw swallowed value -> reject mass_mismatch / mass_gt_points', v2(t2).verdict === 'reject', JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw, { mult: 3, c: 120 }); t2.r = t2.s.map((x) => Math.round(radiusForMode(x, 'classic') * 100) / 100);
    check('v2: a radius that follows the multiplied points instead of the mass is flagged', v2(t2).verdict !== 'ok' && v2(t2).reasons.includes('radius_formula'), JSON.stringify(v2(t2)));
    t2 = long2('classic', lowRaw); t2.u.magnet[3] = -1;
    check('v2: negative / malformed pickup counts -> reject (format)', v2(t2).verdict === 'reject');
    t2 = long2('classic', lowRaw); delete t2.u;
    check('v2: missing power-up arrays -> reject (format)', v2(t2).verdict === 'reject');
    t2 = long2('classic', lowRaw); t2.s[29] = t2.s[29] * 3; 
    check('v2: final points x3 while the swallow points stay -> reject points_mismatch', v2(t2).verdict === 'reject', JSON.stringify(v2(t2)));
  }
  check('validator: mode caps differ (quick growth is faster)', MODES.quick.growthK < MODES.classic.growthK && radiusForMode(500, 'quick') > radiusForMode(500, 'classic'));
  check('rigaDay: summer midnight (UTC+3) and winter midnight (UTC+2)',
    rigaDay(Date.UTC(2026, 5, 30, 20, 59, 59) / 1000) === '2026-06-30' && rigaDay(Date.UTC(2026, 5, 30, 21, 0, 0) / 1000) === '2026-07-01' &&
    rigaDay(Date.UTC(2026, 0, 31, 21, 59, 59) / 1000) === '2026-01-31' && rigaDay(Date.UTC(2026, 0, 31, 22, 0, 0) / 1000) === '2026-02-01');
  check('rigaDay: DST switch days stay consecutive', rigaDay(Date.UTC(2026, 2, 28, 23, 0, 0) / 1000) === '2026-03-29' && rigaDay(Date.UTC(2026, 9, 24, 22, 0, 0) / 1000) === '2026-10-25' && isDayString('2026-02-28') && !isDayString('2026-02-30x'));
  rmSync(resolve(root, 'scripts/.tmp-api/mig-0001'), { recursive: true, force: true });
}

try { await main(); } catch (e) { console.error(e); failed++; }
procs.forEach((p) => p.kill());
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
