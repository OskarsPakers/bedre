// clumsy player: Esc spam, resize mid-round, zoom extremes, panels mid-round, held keys, HUD clicks while moving, stand still, edge ramming
import { launch, newPage, sleep, note, frameStats } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 'bad1', locale: 'en-US' });
const S = () => p.evaluate(() => ({ ph: window.__game.state.phase, paused: window.__game.paused, t: window.__game.state.timeLeft, sc: window.__game.state.score, h: window.__game.hole, cam: window.__game.cam, unr: window.__game.unranked }));
await p.openGame('');
await p.click('#opts-toggle'); await p.click('#modesw [data-mode=classic]');
await p.click('#play');
await sleep(2000);
await p.shot('bad-intro-2s');
// click during intro? press Esc during intro
await p.keyboard.press('Escape'); await sleep(500); note('intro Esc: ' + JSON.stringify(await S())); await p.shot('bad-intro-paused');
await p.keyboard.press('Escape'); await sleep(500);
while ((await S()).ph !== 'playing') await sleep(300);
note('playing ' + JSON.stringify(await S()));
// Esc spam
for (let i = 0; i < 12; i++) { await p.keyboard.press('Escape'); await sleep(60); }
await sleep(400); note('after 12 Esc: ' + JSON.stringify(await S()));
await p.shot('bad-esc12');
if ((await S()).paused) { await p.keyboard.press('Escape'); await sleep(300); }
// timer while paused
await p.keyboard.press('Escape'); const t1 = (await S()).t; await sleep(3000); const t2 = (await S()).t; note(`pause timer ${t1}->${t2}`); await p.shot('bad-paused');
await p.click('#resume'); await sleep(500);
// hold several keys
await p.keyboard.down('w'); await p.keyboard.down('d'); await p.keyboard.down('ArrowLeft'); await sleep(2000); await p.keyboard.up('w'); await p.keyboard.up('d'); await p.keyboard.up('ArrowLeft');
note('multi key ' + JSON.stringify((await S()).h));
// zoom all the way out / in
for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, 120); await sleep(30); } await sleep(500); await p.shot('bad-zoom-out'); note('zoomout ' + JSON.stringify((await S()).cam));
for (let i = 0; i < 80; i++) { await p.mouse.wheel(0, -120); await sleep(30); } await sleep(500); await p.shot('bad-zoom-in'); note('zoomin ' + JSON.stringify((await S()).cam));
for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, 120); await sleep(10); }
await sleep(300);
// resize mid-round
for (const [w, h] of [[1024, 600], [800, 500], [2560, 800], [600, 900], [1280, 720]]) { await p.setViewportSize({ width: w, height: h }); await sleep(900); await p.shot(`bad-resize-${w}x${h}`); const o = await p.evaluate(() => { const bad = []; for (const id of ['hud', 'card-score', 'card-time', 'board', 'minimap-box', 'sizebox']) { const e = document.getElementById(id); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1)) bad.push(id + ':' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom)); } return { bad, cw: document.getElementById('c').width, ch: document.getElementById('c').height, iw: innerWidth, ih: innerHeight }; }); note(`resize ${w}x${h} ` + JSON.stringify(o)); }
// panels mid-round
await p.click('#hud-btns button:nth-child(2)').catch(() => {});
for (const sel of ['#pause-btn']) { await p.click(sel); await sleep(500); await p.shot('bad-pausebtn'); note('pause overlay buttons: ' + await p.evaluate(() => [...document.querySelectorAll('#pause button, #pause a')].map(e => e.id + ':' + e.textContent.trim()).join(','))); await p.keyboard.press('Escape'); await sleep(300); note('Esc on pause overlay -> ' + JSON.stringify(await S())); if ((await S()).paused) await p.click('#resume'); }
// click all HUD buttons while moving
await p.mouse.move(900, 300);
const btns = await p.evaluate(() => [...document.querySelectorAll('#hud-btns button, #hud-btns a')].map((e) => ({ id: e.id, cls: e.className, label: e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 15) })));
note('hud btns ' + JSON.stringify(btns));
for (let i = 0; i < btns.length; i++) { await p.mouse.move(700 + i * 20, 250); await p.click(`#hud-btns > :nth-child(${i + 1})`).catch((e) => note('click fail ' + e.message.slice(0, 80))); await sleep(700); await p.shot(`bad-hudbtn-${i}`); note(`after hud btn ${i}: ` + JSON.stringify(await S())); if ((await S()).paused && (await p.$('#resume:visible'))) await p.click('#resume'); }
// ram the edge: go far west
await p.mouse.move(5, 360);
await sleep(25000);
note('edge ram west ' + JSON.stringify((await S()).h)); await p.shot('bad-edge-west');
await p.keyboard.down('ArrowDown'); await sleep(25000); await p.keyboard.up('ArrowDown');
note('edge ram south ' + JSON.stringify((await S()).h)); await p.shot('bad-edge-south');
// spin in circles
for (let i = 0; i < 100; i++) { const a = i * 0.4; await p.mouse.move(640 + Math.cos(a) * 250, 400 + Math.sin(a) * 200); await sleep(60); }
await p.shot('bad-spin');
note('FRAME ' + JSON.stringify(await frameStats(p)));
note('errs ' + p.errs.length);
await b.close();
