// Local-only API smoke test: builds, applies local D1 migrations into a fresh
// state dir, runs `wrangler dev` on 8791 with a 2 s round, and asserts the API.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const persist = resolve(root, '.wrangler/smoke-state');
rmSync(persist, { recursive: true, force: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')}`); process.exit(1); }
};
run('npm', ['run', 'build']);
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--persist-to', persist]);

const child = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--persist-to', persist,
  '--var', 'ROUND_SECONDS_OVERRIDE:2'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
process.on('exit', killAll);

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body, headers = {}, raw) => fetch(BASE + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: raw ?? JSON.stringify(body),
});

try {
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try { ready = (await fetch(BASE + '/')).ok; } catch {}
    if (!ready) await sleep(500);
  }
  if (!ready) throw new Error('wrangler dev not ready\n' + log);

  let r = await fetch(BASE + '/');
  check('static index.html at /', r.ok && (await r.text()).includes('<html'));
  r = await fetch(BASE + '/data/riga.json');
  check('/data/riga.json served', r.ok && (await r.text()).includes('"buildings"'));

  r = await fetch(BASE + '/api/scores?period=all&limit=20');
  let j = await r.json();
  check('GET /api/scores empty', r.ok && Array.isArray(j.scores) && j.scores.length === 0, JSON.stringify(j));
  check('leaderboard cache-control', (r.headers.get('cache-control') || '').includes('max-age=15'));
  check('bad period -> 400', (await fetch(BASE + '/api/scores?period=zzz')).status === 400);
  check('DELETE /api/scores -> 405', (await fetch(BASE + '/api/scores', { method: 'DELETE' })).status === 405);
  check('GET /api/rounds -> 405', (await fetch(BASE + '/api/rounds')).status === 405);
  check('unknown /api path -> 404', (await fetch(BASE + '/api/nope')).status === 404);

  r = await post('/api/rounds', {});
  j = await r.json();
  const roundId = j.roundId;
  check('POST /api/rounds', r.status === 201 && typeof roundId === 'string' && j.roundSeconds === 2, JSON.stringify(j));

  const good = { roundId, name: 'Anna', score: 1234, eaten: 50, radius: 12.5, rank: 3, biggest: 'Dom Cathedral' };
  r = await post('/api/scores', good);
  check('immediate submit rejected (too early)', r.status === 403, `${r.status}`);

  await sleep(2300);
  r = await post('/api/scores', { ...good, roundId: 'nonexistent' });
  check('unknown roundId rejected', r.status === 403, `${r.status}`);

  // invalid payloads must not consume the round
  for (const [label, patch] of [
    ['empty name', { name: '   ' }], ['name too long', { name: 'x'.repeat(17) }],
    ['negative score', { score: -1 }], ['float score', { score: 1.5 }],
    ['huge score', { score: 1e12 }], ['string score', { score: '99' }],
    ['huge radius', { radius: 1e9 }],
  ]) {
    r = await post('/api/scores', { ...good, ...patch });
    check(`reject ${label}`, r.status === 400, `${r.status}`);
  }
  r = await post('/api/scores', good, {}, 'not json');
  check('reject invalid JSON', r.status === 400, `${r.status}`);
  r = await fetch(BASE + '/api/scores', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(good) });
  check('reject non-JSON content-type', r.status === 415, `${r.status}`);
  r = await post('/api/scores', { ...good, pad: 'x'.repeat(3000) });
  check('reject oversized body', r.status === 413, `${r.status}`);
  r = await post('/api/scores', good, { origin: 'https://evil.example' });
  check('reject cross-origin POST', r.status === 403, `${r.status}`);

  // sanitised name
  r = await post('/api/scores', { ...good, name: '  <b>Ann\u0007a</b>\n  "Z"  ' });
  j = await r.json();
  check('valid submit succeeds (name sanitised)', r.status === 201 && j.ok && j.rankAllTime === 1 && j.rankToday === 1, JSON.stringify(j));
  check('sanitised name has no html/control/extra spaces', j.name === 'bAnn a/b Z', j.name);

  r = await post('/api/scores', good);
  check('replay of same roundId rejected', r.status === 409, `${r.status}`);

  // second round, same-origin Origin header accepted, lower score ranks second
  const j2 = await (await post('/api/rounds', {})).json();
  await sleep(2300);
  r = await post('/api/scores', { ...good, roundId: j2.roundId, name: 'Bruno', score: 99 }, { origin: BASE });
  j = await r.json();
  check('same-origin submit ok, ranked 2nd', r.status === 201 && j.rankAllTime === 2, JSON.stringify(j));

  r = await fetch(BASE + '/api/scores?period=day&limit=1');
  j = await r.json();
  check('limit=1 honoured', j.scores.length === 1 && j.scores[0].score === 1234, JSON.stringify(j));
  r = await fetch(BASE + '/api/scores?period=all&limit=999');
  j = await r.json();
  check('leaderboard ordered desc with fields',
    j.scores.length === 2 && j.scores[0].score === 1234 && j.scores[1].score === 99 &&
    ['name', 'score', 'radius', 'eaten', 'rank', 'biggest', 'at'].every((k) => k in j.scores[0]), JSON.stringify(j));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  killAll();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
