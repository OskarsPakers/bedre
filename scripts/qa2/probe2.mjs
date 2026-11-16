import * as L from './lib.mjs';
const p = await L.open({ eng: 'webkit', dev: 'iPhone 13', name: 'wk13' }, { name: 'Probe' });
await L.load(p);
await L.T.tapEl(p, '#play'); await L.sleep(1500);
await p.evaluate(() => window.__game.skipIntro?.());  // setup only
await L.sleep(1500);
const h = () => p.evaluate(() => ({ x: window.__game.hole.x, z: window.__game.hole.z, joy: window.__life.game.input.touch, pts: window.__life.game.input.pts.size }));
console.log(await h());
const {w,h:H} = {w:390,h:664};
await L.T.down(p, 1, 195, 520); await L.T.drag(p, 1, [195,520],[195,450], 6, 50); console.log(await h()); await L.sleep(1500); console.log(await h());
await L.T.up(p,1); console.log(await h());
console.log(await p.evaluate(() => Object.keys(window.__life.game).slice(0,60)));
await L.closeAll();
