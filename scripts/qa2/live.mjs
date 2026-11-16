import * as L from './lib.mjs';
for (const prof of [{ eng: 'webkit', dev: 'iPhone 13', name: 'live-wk13' }, { eng: 'firefox', name: 'live-ff' }, { eng: 'chromium', dev: 'Pixel 5', name: 'live-px5' }]) {
  const p = await L.open(prof, { name: 'QAlive', base: 'https://bedre.pakers.lv', q: 'radio=0' });
  await L.load(p); await L.shot(p, 'start');
  if (prof.dev) await L.T.tapEl(p, '#play-online'); else await p.click('#play-online');
  await L.sleep(3500);
  const r = await p.evaluate(() => ({ st: window.__online.state, n: window.__online.lobby?.players?.length, cnt: document.getElementById('mp-count')?.textContent, net: document.getElementById('mp-net')?.textContent }));
  await L.shot(p, 'lobby'); console.log(prof.name, JSON.stringify(r));
  await p.evaluate(() => window.__online.leave()); await L.sleep(800);
  console.log(' after leave', await p.evaluate(() => window.__online.state));
  await p.__ctx.close();
}
console.log(JSON.stringify(L.log.errs)); await L.closeAll();
