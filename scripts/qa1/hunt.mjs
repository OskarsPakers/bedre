// get eaten on purpose by steering (real mouse) into bigger bots; check overlay, respawn, score/size after death
import { launch, newPage, sleep, note, Driver, frameStats } from './lib.mjs';
const map = process.argv[2] || 'centrs';
const b = await launch();
const p = await newPage(b, { tag: 'hunt-' + map, locale: 'en-US' });
await p.openGame('map=' + map);
await p.fill('#name', 'Hunter');
await p.click('#opts-toggle'); await p.click('#modesw [data-mode=classic]'); await p.click('#diffsw [data-diff=hard]');
await p.click('#play');
const d = new Driver(p, { w: 1280, h: 720 });
const T0 = Date.now(); let deaths = 0, shots = 0, lastDying = false, phaseLog = [];
const S = () => p.evaluate(() => { const g = window.__game; const me = g.holes.find(h => !h.isBot); return { ph: g.state.phase, sc: g.state.score, t: g.state.timeLeft, h: g.hole, me, bots: g.holes.filter(h => h.isBot).map(h => ({ n: h.name, x: h.x, z: h.z, r: h.radius, alive: h.alive, pt: h.protectT })), ov: g.overlay, un: g.unranked }; });
while (Date.now() - T0 < 150000) {
  const s = await S();
  if (s.ph !== 'playing') { await sleep(300); continue; }
  const age = (Date.now() - T0) / 1000;
  let tx, tz;
  const hunt = age > 25 && deaths < 3;
  if (hunt) {
    const big = s.bots.filter(b => b.alive && b.r > s.h.radius * 1.15).sort((a, c) => Math.hypot(a.x - s.h.x, a.z - s.h.z) - Math.hypot(c.x - s.h.x, c.z - s.h.z))[0];
    if (big) { tx = big.x; tz = big.z; } else { tx = s.h.x + 50; tz = s.h.z; }
  } else {
    const t = await p.evaluate(() => { const L = window.__life, g = window.__game, q = g.hole; let best = null, bs = -1; L.world.query(q.x, q.z, Math.max(30, q.radius * 10), (o, dd) => { if (o.state !== 0 || o.fit >= q.radius * 0.95) return; const sc = o.value / (dd + q.radius * 1.5 + 4); if (sc > bs) { bs = sc; best = o; } }); return best && { x: best.x, z: best.z }; });
    if (t) { tx = t.x; tz = t.z; } else { tx = s.h.x + 80; tz = s.h.z; }
  }
  await d.aim(tx - s.h.x, tz - s.h.z);
  const dying = !!(s.me && s.me.dying);
  if (dying && !lastDying) {
    deaths++; note(`DEATH#${deaths} at t=${s.t | 0} score=${s.sc} r=${s.h.radius.toFixed(1)} overlay=${JSON.stringify(s.ov)}`);
    for (let k = 0; k < 6; k++) { await sleep(500); const q = await S(); await p.shot(`hunt-${map}-death${deaths}-${k}`); note(`  +${k * 0.5}s ph=${q.ph} dying=${q.me && q.me.dying} alive=${q.me && q.me.alive} score=${q.sc} r=${q.h.radius.toFixed(1)} protect=${q.me && q.me.protectT} overlay=${JSON.stringify(q.ov)} pos=${q.h.x | 0},${q.h.z | 0}`); }
  }
  lastDying = dying;
  i: if (Date.now() - T0 > shots * 10000) { shots++; await p.shot(`hunt-${map}-t${shots}`); }
  await sleep(150);
  if (s.ph === 'ended') break;
}
note(`hunt done deaths=${deaths}`);
await sleep(8000);
const r = await p.evaluate(() => ({ place: document.getElementById('r-place').textContent, deaths: document.getElementById('r-deaths').textContent, kills: document.getElementById('r-kills').textContent, score: document.getElementById('r-score').textContent }));
note('RESULTS ' + JSON.stringify(r));
await p.shot(`hunt-${map}-results`);
note('FRAME ' + JSON.stringify(await frameStats(p)));
await b.close();
