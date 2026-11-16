import { launch, newPage, sleep, note, frameStats } from './lib.mjs';
const b = await launch();
// ---- persistence across reloads
const p = await newPage(b, { tag: 'misc', locale: 'lv-LV' });
await p.openGame('');
await p.fill('#name', 'Pēteris Ķēniņš-Šļūka'); // diacritics + long
await p.click('#opts-toggle'); await p.click('#modesw [data-mode=quick]'); await p.click('#diffsw [data-diff=hard]');
await p.click('#opts-body [data-theme=winter]'); await p.click('#qualsw [data-quality=low]'); await p.click('[data-lang=en]');
await p.click('#mute-btn').catch(() => note('no mute-btn on start'));
const snap = () => p.evaluate(() => ({ name: document.getElementById('name').value, mode: [...document.querySelectorAll('#modesw [aria-checked=true]')].map(e => e.dataset.mode).join(), diff: [...document.querySelectorAll('#diffsw [aria-checked=true]')].map(e => e.dataset.diff).join(), theme: [...document.querySelectorAll('#opts-body [data-theme][aria-checked=true],#opts-body [data-theme].on,#opts-body [data-theme][aria-pressed=true]')].map(e => e.dataset.theme).join(), q: [...document.querySelectorAll('#qualsw [aria-checked=true]')].map(e => e.dataset.quality).join(), lang: document.documentElement.lang, play: document.getElementById('play').textContent, ls: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])), optsOpen: document.getElementById('opts-toggle').getAttribute('aria-expanded') }));
note('before reload ' + JSON.stringify(await snap()));
await p.reload(); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(800);
note('after reload ' + JSON.stringify(await snap()));
await p.shot('misc-persist');
// audio state
await p.click('#play'); await sleep(3500);
note('audio ' + JSON.stringify(await p.evaluate(() => { const a = window.__life.audio; return { ctx: a.ctx && a.ctx.state, muted: a.muted, keys: Object.keys(a).slice(0, 25) }; })));
await p.keyboard.press('m'); await sleep(200);
note('after M ' + JSON.stringify(await p.evaluate(() => ({ muted: window.__life.audio.muted, ls: localStorage.getItem('bedre.muted'), btn: document.getElementById('mute-btn').getAttribute('aria-pressed') || document.getElementById('mute-btn').className }))));
await p.keyboard.press('m'); await sleep(200);
note('after M2 ' + JSON.stringify(await p.evaluate(() => ({ muted: window.__life.audio.muted, ctx: window.__life.audio.ctx && window.__life.audio.ctx.state }))));
// free roam: End button
await p.keyboard.press('Escape'); await sleep(300);
note('fonts: ' + await p.evaluate(() => getComputedStyle(document.getElementById('name')).fontFamily));
// reload with free mode, End flow
await p.goto('http://127.0.0.1:8801/?mode=free&autostart=1&intro=0'); await p.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(2000);
for (let i = 0; i < 20; i++) { await p.mouse.move(640 + Math.cos(i / 3) * 200, 360 + Math.sin(i / 3) * 150); await sleep(200); }
note('free state ' + JSON.stringify(await p.evaluate(() => ({ st: window.__game.state, un: window.__game.unranked, endVisible: !document.getElementById('end-free').classList.contains('hidden'), endTxt: document.getElementById('end-free').textContent }))));
await p.click('#end-free'); await sleep(2500); await p.shot('misc-free-end');
note('free results ' + JSON.stringify(await p.evaluate(() => ({ vis: !document.getElementById('results').classList.contains('hidden'), place: document.getElementById('r-place').textContent, g: document.getElementById('r-global').textContent, score: document.getElementById('r-score').textContent, ph: window.__game.state.phase }))));
await p.click('#again'); await sleep(3000); await p.shot('misc-free-again');
note('after again ' + JSON.stringify(await p.evaluate(() => ({ ph: window.__game.state.phase, sc: window.__game.state.score, un: window.__game.unranked }))));
await p.context().close();
// ---- browser zoom emulation 125% / 150% (smaller CSS viewport + dpr)
for (const [w, h, dpr, z] of [[1024, 576, 1.25, '125%'], [853, 480, 1.5, '150%'], [640, 360, 2, '200%']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, locale: 'lv-LV' });
  const q = await ctx.newPage(); q.errs = [];
  q.on('console', (m) => { if (['error'].includes(m.type())) note(`[zoom${z}] ${m.text()}`); });
  await q.goto('http://127.0.0.1:8801/'); await q.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(800);
  await q.screenshot({ path: `scripts/out/qa1-zoom${z}-menu.png` });
  await q.click('#opts-toggle'); await sleep(300); await q.screenshot({ path: `scripts/out/qa1-zoom${z}-menu-adv.png` });
  const cut = await q.evaluate(() => { const c = document.querySelector('.start-card'); const r = c.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, scrollH: c.scrollHeight, clientH: c.clientHeight, ov: getComputedStyle(c).overflowY }; });
  note(`zoom ${z} start card ` + JSON.stringify(cut));
  await q.click('#play'); await sleep(6000); await q.screenshot({ path: `scripts/out/qa1-zoom${z}-play.png` });
  await ctx.close();
}
await b.close();
