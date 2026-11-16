// Bot behaviour audit during a real Quick round (greedy human-like player via mouse): idle time, jitter, edge-hugging, modes, deaths
import { launch, newPage, sleep, note, Driver } from './lib.mjs';
const map = process.argv[2] || 'centrs', diff = process.argv[3] || 'hard';
const b = await launch();
const p = await newPage(b, { tag: 'bots-' + map, locale: 'en-US' });
await p.openGame('map=' + map);
await p.click('#opts-toggle'); await p.click('#modesw [data-mode=quick]'); await p.click(`#diffsw [data-diff=${diff}]`);
await p.click('#play');
const d = new Driver(p, { w: 1280, h: 720 });
const samples = []; const T0 = Date.now(); let shots = 0;
const bounds = await p.evaluate(() => window.__life.world.bounds);
while (Date.now() - T0 < 150000) {
  const s = await p.evaluate(() => { const g = window.__game, L = window.__life; const q = g.hole; let best = null, bs = -1; L.world.query(q.x, q.z, Math.max(30, q.radius * 10), (o, dd) => { if (o.state !== 0 || o.fit >= q.radius * 0.95) return; const sc = o.value / (dd + q.radius * 1.5 + 4); if (sc > bs) { bs = sc; best = o; } }); return { ph: g.state.phase, t: g.state.timeLeft, h: q, tgt: best && { x: best.x, z: best.z }, holes: g.holes.map(h => ({ n: h.name, x: h.x, z: h.z, r: h.radius, a: h.alive, m: h.mode, sc: h.score, k: h.kills, d: h.deaths })) }; });
  if (s.ph === 'ended') break;
  if (s.ph === 'playing') { const tx = s.tgt ? s.tgt.x : s.h.x + 80, tz = s.tgt ? s.tgt.z : s.h.z + 30; await d.aim(tx - s.h.x, tz - s.h.z); samples.push({ t: (Date.now() - T0) / 1000, holes: s.holes }); }
  if ((Date.now() - T0) / 1000 > shots * 20) { shots++; await p.shot(`bots-${map}-${shots}`); }
  await sleep(450);
}
const nb = samples[0] ? samples[0].holes.length : 0;
for (let i = 1; i < nb; i++) {
  let path = 0, idle = 0, idleRun = 0, maxIdle = 0, rev = 0, edge = 0, prevAng = null, dts = 0, modes = {}, alive = 0, minr = 1e9, maxr = 0;
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1].holes[i], c = samples[k].holes[i], dt = samples[k].t - samples[k - 1].t; if (!a.a || !c.a) continue;
    const dd = Math.hypot(c.x - a.x, c.z - a.z); path += dd; dts += dt; const sp = dd / dt;
    if (sp < 0.4) { idle += dt; idleRun += dt; maxIdle = Math.max(maxIdle, idleRun); } else idleRun = 0;
    if (dd > 0.5) { const ang = Math.atan2(c.z - a.z, c.x - a.x); if (prevAng !== null) { let da = Math.abs(ang - prevAng); if (da > Math.PI) da = 2 * Math.PI - da; if (da > 2.5) rev++; } prevAng = ang; }
    if (c.x < bounds.minX + 25 || c.x > bounds.maxX - 25 || c.z < bounds.minZ + 25 || c.z > bounds.maxZ - 25) edge += dt;
    modes[c.m] = (modes[c.m] || 0) + 1; minr = Math.min(minr, c.r); maxr = Math.max(maxr, c.r);
  }
  const last = samples[samples.length - 1].holes[i];
  note(`BOT ${map}/${diff} ${last.n}: path=${path.toFixed(0)}m idle=${idle.toFixed(0)}s maxIdleRun=${maxIdle.toFixed(0)}s reversals=${rev} edgeTime=${edge.toFixed(0)}s r ${minr.toFixed(1)}->${maxr.toFixed(1)} score=${last.sc} kills=${last.k} deaths=${last.d} modes=${JSON.stringify(modes)}`);
}
note('bounds ' + JSON.stringify(bounds));
await b.close();
