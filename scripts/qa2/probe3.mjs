import * as L from './lib.mjs';
const p = await L.open({ eng: 'webkit', dev: 'iPhone 13', name: 'wk13' }, { name: 'Probe' });
await L.load(p);
await L.T.tapEl(p, '#play'); await L.sleep(9000);
console.log(await L.stickDrive(p, 2000));
await L.closeAll();
