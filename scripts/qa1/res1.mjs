import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
for (const [w, h] of [[600, 900], [800, 500], [900, 600], [1024, 600], [480, 800]]) {
  const p = await newPage(b, { w, h, tag: 'res', locale: 'en-US' });
  await p.openGame('autostart=1&intro=0');
  await sleep(2500);
  const o = await p.evaluate(() => { const r = {}; for (const id of ['hud', 'card-score', 'card-time', 'board', 'minimap-box', 'sizebox', 'hud-btns', 'labels']) { const e = document.getElementById(id); if (!e) { r[id] = 'none'; continue; } const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); r[id] = [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom), cs.display, cs.visibility, cs.opacity].join(','); } r.body = document.body.className; r.ph = window.__game.state.phase; return r; });
  note(`${w}x${h} ` + JSON.stringify(o));
  await p.shot(`res-${w}x${h}`);
  await p.context().close();
}
await b.close();
