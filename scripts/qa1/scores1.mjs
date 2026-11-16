import { launch, newPage, sleep, note } from './lib.mjs';
const b = await launch();
const p = await newPage(b, { tag: 'scores', locale: 'en-US' });
await p.openGame('');
await p.click('#open-scores'); await sleep(800);
const modes = await p.$$eval('#scores [role=tab], #scores .tabs button, #scores button', (bs) => bs.map((b) => ({ t: b.textContent.trim(), cls: b.className, id: b.id, aria: b.getAttribute('aria-selected') || b.getAttribute('aria-checked') })));
note('buttons ' + JSON.stringify(modes));
const getTxt = () => p.evaluate(() => ({ rows: [...document.querySelectorAll('#ts-body tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6), msg: document.getElementById('ts-msg').textContent, msgVisible: !!document.getElementById('ts-msg').offsetParent, title: document.getElementById('ts-title').textContent, vis: [...document.querySelectorAll('#scores button')].filter(b => b.offsetParent).map(b => b.textContent.trim()).join(',') }));
const labels = modes.map(m => m.t).filter(t => t && t !== 'Close');
for (const label of ['Classic', 'Quick', 'Daily', 'Online']) {
  await p.click(`#scores button:text-is("${label}")`); await sleep(900);
  note(`mode ${label}: ` + JSON.stringify(await getTxt()));
  for (const m of ['Centre', 'Āgenskalns', 'Mežaparks', 'Purvciems']) { const el = await p.$(`#scores button:text-is("${m}")`); if (el && await el.isVisible()) { await el.click(); await sleep(700); note(`   ${label}/${m}: ` + JSON.stringify(await getTxt())); } }
  for (const r of ['Today', 'This week', 'All time', 'Yesterday']) { const el = await p.$(`#scores button:text-is("${r}")`); if (el && await el.isVisible()) { await el.click(); await sleep(600); note(`   ${label}/${r}: ` + JSON.stringify((await getTxt()).rows.length) + ' rows'); } }
  await p.shot('scores-' + label);
}
await b.close();
