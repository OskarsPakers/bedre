import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
const p = await ctx.newPage(); p.tag = 'misc2'; p.errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) note('[misc2] console.' + m.type() + ': ' + m.text().slice(0, 200)); });
p.on('pageerror', (e) => note('[misc2] PAGEERROR ' + e.message));
p.shot = (n) => p.screenshot({ path: `scripts/out/qa1-${n}.png` });
await p.goto('http://127.0.0.1:8801/'); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(600);
// keyboard-only: start with Enter from name field, then play with WASD, pause with Esc, resume with Esc, then end flow
await p.focus('#name'); await p.keyboard.press('Enter'); await sleep(500);
note('Enter on name -> phase ' + await p.evaluate(() => window.__game.state.phase));
await sleep(7000);
await p.keyboard.down('d'); await sleep(2000); await p.keyboard.up('d');
const st = () => p.evaluate(() => ({ ph: window.__game.state.phase, paused: window.__game.paused, t: window.__game.state.timeLeft, h: window.__game.hole }));
note('after WASD ' + JSON.stringify(await st()));
// hidden tab -> pause
const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.bringToFront(); await sleep(1500);
note('hidden? ' + await p.evaluate(() => document.hidden + ' vis=' + document.visibilityState) + ' state ' + JSON.stringify(await st()));
await p.bringToFront(); await sleep(1500);
note('back ' + await p.evaluate(() => document.hidden) + ' ' + JSON.stringify(await st()));
await p.shot('misc2-after-hidden');
// while paused: is time frozen? tab away 5s
const t1 = (await st()).t; await p2.bringToFront(); await sleep(5000); await p.bringToFront(); await sleep(800); const t2 = (await st()).t; note(`hidden 5s timer ${t1.toFixed(1)} -> ${t2.toFixed(1)} paused=${(await st()).paused}`);
if ((await st()).paused) { await p.keyboard.press('Escape'); await sleep(300); note('Esc resumes -> ' + JSON.stringify(await st())); }
// space / Enter on pause overlay? and focus: Tab into HUD buttons, press Enter/Space on pause button
await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); note('focus ' + await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
await p.keyboard.press('Space'); await sleep(300); note('space on focused -> ' + JSON.stringify(await st()));
await p.shot('misc2-focus');
// type letters while playing (name input not focused) - 'm','r','p','f','1'
for (const k of ['m', 'm', 'p', 'f', 'z', 'x', 'Space', 'Enter', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab']) { await p.keyboard.press(k); await sleep(120); }
note('after random keys ' + JSON.stringify(await st()) + ' focus=' + await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
await p.shot('misc2-randomkeys');
// right-click, middle click, drag on canvas, double-click, wheel with ctrl
await p.mouse.click(400, 300, { button: 'right' }); await p.mouse.click(400, 300, { button: 'middle' }); await p.mouse.dblclick(500, 300);
await p.keyboard.down('Control'); await p.mouse.wheel(0, -300); await p.keyboard.up('Control'); await sleep(500);
note('after odd clicks ' + JSON.stringify(await st()));
// text selection / drag
await p.mouse.move(300, 300); await p.mouse.down(); await p.mouse.move(900, 500, { steps: 8 }); await p.mouse.up();
note('selection: ' + await p.evaluate(() => String(getSelection()).length));
await p.shot('misc2-odd');
// tab key focus ring visible on pause button etc: screenshot
await b.close();
