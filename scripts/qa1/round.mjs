// usage: node round.mjs '{"map":"centrs","mode":"quick","diff":"easy","theme":"day","lang":"lv","w":1280,"h":720,"engine":"chromium","name":"r1","secs":130,"shot":6,"skill":1}'
import { launch, newPage, sleep, frameStats, note, Driver, OUT } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const C = Object.assign({ map: 'centrs', mode: 'quick', diff: 'easy', theme: 'day', lang: 'lv', w: 1280, h: 720, engine: 'chromium', name: 'r', secs: 140, shot: 6, skill: 1, again: true, mem: true }, JSON.parse(process.argv[2] || '{}'));
const b = await launch(C.engine);
const page = await newPage(b, { w: C.w, h: C.h, locale: C.lang === 'lv' ? 'lv-LV' : 'en-US', tag: C.name });
const log = []; const L = (s) => { const x = `[${C.name} +${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}`; log.push(x); note(x); }; const T0 = Date.now();
await page.openGame('');   // no URL params: real UI
// set through UI
await page.evaluate((C) => { try { localStorage.setItem('bedre.lang', C.lang); } catch {} }, C);
await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(500);
await page.fill('#name', 'QA' + C.name);
if ((await page.getAttribute('#opts-toggle', 'aria-expanded')) !== 'true') await page.click('#opts-toggle');
await page.click(`#modesw [data-mode=${C.mode}]`);
await page.click(`#diffsw [data-diff=${C.diff}]`);
const curMap = await page.$eval('#map-select', (e) => e.value);
if (curMap !== C.map) { const nav = page.waitForEvent('load', { timeout: 8000 }).catch(() => null); await page.selectOption('#map-select', C.map); await nav; await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 }); await sleep(800); }
await page.click(`#opts-body [data-theme=${C.theme}]`).catch((e) => L('theme click fail ' + e.message));
await sleep(300);
await page.shot(`${C.name}-menu`);
const ui = await page.evaluate(() => ({ map: document.getElementById('map-select').value, mode: [...document.querySelectorAll('#modesw [aria-checked=true]')].map(e => e.dataset.mode), diff: [...document.querySelectorAll('#diffsw [aria-checked=true]')].map(e => e.dataset.diff), play: document.getElementById('play').textContent, bodyClass: document.body.className, theme: window.__life && window.__life.theme && (window.__life.theme.name || window.__life.theme.current) }));
L('UI ' + JSON.stringify(ui));
await page.click('#play');
const d = new Driver(page, { w: C.w, h: C.h });
let i = 0, lastShot = 0, lastSc = -1, stuck = 0, T1 = Date.now(), maxR = 0, deaths = 0, lastDying = false;
const mem0 = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);
while (true) {
  const st = await page.evaluate(() => { const g = window.__game; return { ph: g.state.phase, s: g.state, h: g.hole, un: g.unranked, paused: g.paused, holes: g.holes }; }).catch(() => null);
  if (!st) { L('page evaluate failed'); break; }
  if (st.ph === 'ended') break;
  if (st.ph === 'results') break;
  if (st.ph === 'intro' && i % 5 === 0) { if (Date.now() - lastShot > 1500) { lastShot = Date.now(); await page.shot(`${C.name}-intro-${i}`); } }
  if (st.ph === 'playing' && !st.paused) {
    const r = st.h.radius; maxR = Math.max(maxR, r);
    const me = st.holes[0]; if (me && me.dying && !lastDying) { deaths++; L(`player dying at ${st.h.x | 0},${st.h.z | 0} r=${r.toFixed(1)}`); } lastDying = !!(me && me.dying);
    const tgt = await page.evaluate(({ r, skill }) => {
      const L = window.__life, g = window.__game, p = g.hole; let best = null, bs = -1, danger = null, dd = 1e9;
      L.world.query(p.x, p.z, Math.max(30, r * 10), (o, d) => { if (o.state !== 0 || o.fit >= r * 0.95) return; const s = o.value / (d + r * 1.5 + 4); if (s > bs) { bs = s; best = o; } });
      for (const h of g.holes) { if (h.isBot && h.alive && h.radius > r * 0.95) { const d = Math.hypot(h.x - p.x, h.z - p.z); if (d < dd) { dd = d; danger = h; } } }
      return { best: best && { x: best.x, z: best.z }, danger: danger && dd < r * 6 + 25 ? { x: danger.x, z: danger.z } : null };
    }, { r, skill: C.skill });
    let tx, tz;
    if (tgt.danger && C.skill > 0.5) { tx = st.h.x - (tgt.danger.x - st.h.x); tz = st.h.z - (tgt.danger.z - st.h.z); }
    else if (tgt.best) { tx = tgt.best.x; tz = tgt.best.z; }
    else { d._w = (d._w || 0) + 0.15; tx = st.h.x + Math.cos(d._w) * 100; tz = st.h.z + Math.sin(d._w) * 100; }
    await d.aim(tx - st.h.x, tz - st.h.z);
    if (C.skill < 0.3) await page.mouse.move(C.w / 2, C.h * 0.55); // "stand still" player
    if (st.s.score === lastSc) stuck++; else stuck = 0; lastSc = st.s.score;
    if (Date.now() - lastShot > C.shot * 1000) { lastShot = Date.now(); await page.shot(`${C.name}-p${String(i).padStart(3, '0')}`); L(`t=${st.s.timeLeft | 0} score=${st.s.score} eaten=${st.s.eaten} r=${r.toFixed(1)} pos=${st.h.x | 0},${st.h.z | 0} rank=${await page.evaluate(() => window.__game.leaderboard().findIndex(x => x.isPlayer) + 1)} unranked=${st.un}`); }
  }
  if ((Date.now() - T1) / 1000 > C.secs + 40) { L('timeout waiting round end'); break; }
  i++; await sleep(150);
}
const fs = await frameStats(page, false);
L('FRAME ' + JSON.stringify(fs));
L(`maxR=${maxR.toFixed(1)} deaths=${deaths}`);
await sleep(1500);
await page.shot(`${C.name}-results`);
const res = await page.evaluate(() => { const t = (id) => (document.getElementById(id) || {}).textContent; return { place: t('r-place'), score: t('r-score'), global: t('r-global'), eaten: t('r-eaten'), kills: t('r-kills'), deaths: t('r-deaths'), biggest: t('r-biggest'), size: t('r-size'), table: [...document.querySelectorAll('#r-table tr')].map(r => r.textContent.replace(/\s+/g, ' ')), unranked: window.__game.unranked, vis: !document.getElementById('results').classList.contains('hidden') }; });
L('RESULTS ' + JSON.stringify(res));
await sleep(3000); await page.shot(`${C.name}-results2`);
if (C.again) {
  await page.click('#again').catch((e) => L('again click fail ' + e.message));
  await sleep(2500);
  const s2 = await page.evaluate(() => ({ ph: window.__game.state.phase, score: window.__game.state.score, hole: window.__game.hole, counts: window.__game.counts }));
  L('AFTER AGAIN ' + JSON.stringify(s2));
  for (let k = 0; k < 8; k++) { await page.shot(`${C.name}-again-${k}`); await sleep(1200); if (k === 1) { } }
}
const mem1 = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);
L(`MEM ${mem0} -> ${mem1}`);
L('ERRS ' + page.errs.length);
writeFileSync(`${OUT}/qa1-${C.name}-log.json`, JSON.stringify({ C, log }, null, 1));
await b.close();
