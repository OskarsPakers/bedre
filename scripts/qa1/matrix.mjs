import { launch, newPage, sleep, note, frameStats } from './lib.mjs';
const maps = ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];
const themes = ['day', 'evening', 'winter', 'nov18'];
const b = await launch();
for (const map of maps) for (const th of themes) {
  const p = await newPage(b, { tag: `m-${map}-${th}`, locale: 'lv-LV' });
  await p.openGame(`map=${map}&theme=${th}&mode=free&autostart=1&intro=0`);
  await sleep(1500);
  // real mouse: wander toward things
  for (let i = 0; i < 40; i++) { const a = i * 0.25; await p.mouse.move(640 + Math.cos(a) * 250, 400 + Math.sin(a) * 160); await sleep(250); if (i === 10 || i === 39) await p.shot(`mx-${map}-${th}-${i}`); }
  const fs = await frameStats(p);
  const info = await p.evaluate(() => ({ th: document.documentElement.dataset.theme, h: window.__game.hole, sc: window.__game.state.score, unr: window.__game.unranked, ph: window.__game.state.phase, texts: [...document.querySelectorAll('#labels *, #tags *, #feed *, #popups *')].map(e => e.textContent).filter(t => /undefined|NaN|null|\[object/.test(t)).slice(0, 5), timeTxt: document.getElementById('time').textContent, rend: window.__life.renderer.info.render, mem: window.__life.renderer.info.memory }));
  note(`${map}/${th} fps avg=${fs.avg.toFixed(1)} p99=${fs.p99.toFixed(1)} max=${fs.max.toFixed(0)} ` + JSON.stringify(info));
  await p.context().close();
}
await b.close();
