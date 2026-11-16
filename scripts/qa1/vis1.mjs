import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 'vis', locale: 'en-US' });
await p.openGame('autostart=1&intro=0');
await sleep(3000);
const st = () => p.evaluate(() => ({ ph: window.__game.state.phase, paused: window.__game.paused, t: +window.__game.state.timeLeft.toFixed(2), overlay: !document.getElementById('pause').classList.contains('hidden') }));
note('start ' + JSON.stringify(await st()));
// simulate tab hidden (event handler path only; headless Chromium never flips real visibility)
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(4000);
note('simulated hidden 4s ' + JSON.stringify(await st()));
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(1500);
note('simulated visible ' + JSON.stringify(await st()));
await p.shot('vis-back');
// CDP lifecycle freeze/resume + focus loss
const cdp = await p.context().newCDPSession(p);
await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(3000); await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await sleep(1500);
note('after freeze/active ' + JSON.stringify(await st()));
// Window blur while keys held
await p.keyboard.down('d'); await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(1500);
const x0 = await p.evaluate(() => window.__game.hole.x); await sleep(1000); const x1 = await p.evaluate(() => window.__game.hole.x);
note(`after blur with D held: hole moves? ${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
await p.keyboard.up('d');
// extreme mouse: pointer leaves window while steering
await p.mouse.move(1270, 400); await sleep(500); await p.mouse.move(1279, 719); await sleep(1000);
// hold edge at far right for a while: does hole keep full speed?
await b.close();
