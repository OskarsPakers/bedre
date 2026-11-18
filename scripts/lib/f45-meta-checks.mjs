// Feature 5 in the browser (called from scripts/smoke-meta.mjs): wardrobe tab (locked / owned / worn), unlock mapping from stored reward ids (past weeks),
// equip persistence across reloads, level badge, XP for eligible rounds only (none in free roam / debug rounds), level-up block on the results.
import path from 'node:path';
import { xpAt } from '../../src/meta/level.js';
import { SKINS } from '../../src/skins.js';

export async function runWardrobe(env) {
  const { chromium, base, out, check, errors } = env;
  const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = async ({ wardrobe = null, global = null, allowDebug = true, lang = 'en', size = { width: 1100, height: 760 } } = {}) => {
    const ctx = await browser.newContext({ viewport: size, locale: lang === 'lv' ? 'lv-LV' : 'en-GB', timezoneId: 'Europe/Riga' });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.addInitScript(([w, g, a, l]) => {
      window.__metaAllowDebug = a;
      try {
        localStorage.setItem('bedre.lang', l); localStorage.setItem('bedre.name', 'Tests');
        if (!sessionStorage.getItem('f45-init')) { sessionStorage.setItem('f45-init', '1'); if (w) localStorage.setItem('bedre.wardrobe.v1', JSON.stringify(w)); if (g) localStorage.setItem('bedre.meta.global.v1', JSON.stringify(g)); }
      } catch {}
    }, [wardrobe, global, allowDebug, lang]);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('wardrobe console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('wardrobe pageerror: ' + e.message));
    return { ctx, page };
  };
  const open = async (page, q = '') => {
    await page.goto(`${base}/?quality=low&intro=0&radio=0&${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (document.body.dataset.ready === '1' && window.__meta && window.__meta.wd) || document.body.dataset.error, null, { timeout: 180000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
  };
  const W = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bedre.wardrobe.v1') || 'null'));
  const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#mp-body .wd-card')].map((c) => ({ slot: +c.dataset.slot, id: +c.dataset.id, state: c.dataset.state, text: c.textContent })));
  const round = async (page, { warm = 21 } = {}) => {
    await page.evaluate((warm) => { const g = window.__life.game; g.start(); g.skipIntro(); g.step(warm); }, warm);
    await sleep(300);
    await page.evaluate(() => window.__life.game.end());
    await sleep(800);
  };
  const state = (cs, slot, id) => (cs.find((c) => c.slot === slot && c.id === id) || {}).state;
  try {
    // ---- fresh device -----------------------------------------------------------------------------------------------------------
    const A = await mk();
    await open(A.page, 'time=40');
    check('level badge on the start screen\'s progress button (level 1)', (await A.page.evaluate(() => { const b = document.getElementById('open-progress'); return b && b.dataset.level === '1' && !!b.querySelector('.lv-badge') && b.querySelector('.lv-badge text').textContent === '1'; })));
    await A.page.evaluate(() => window.__meta.open('wardrobe')); await sleep(600);
    let cs = await cards(A.page);
    const total = SKINS.rim.length + SKINS.trail.length + SKINS.tag.length;
    check(`wardrobe: ${total} cards, only the 3 defaults owned and worn on a fresh device`, cs.length === total && cs.filter((c) => c.state === 'worn').length === 3 && cs.filter((c) => c.state === 'locked').length === total - 3, `${cs.length} cards`);
    check('locked cards say how to unlock (level / streak / weekly goal / achievement / album)', cs.filter((c) => c.state === 'locked').every((c) => /level|Streak|streak|Weekly|Achievement|Album/i.test(c.text)), cs.find((c) => c.slot === 0 && c.id === 1).text);
    check('the level card shows level 1 and XP 0', await A.page.evaluate(() => /Level 1/.test(document.querySelector('#wd-top .wd-lv').textContent) && /^0 \//.test(document.querySelector('#wd-top .wd-xp').textContent)));
    await A.page.evaluate(() => document.querySelector('#mp-body .wd-card[data-slot="0"][data-id="1"]').click()); await sleep(250);
    cs = await cards(A.page);
    check('tapping a locked item only previews it (nothing is worn, nothing stored)', state(cs, 0, 1) === 'locked' && state(cs, 0, 0) === 'worn' && (await A.page.evaluate(() => window.__life.game.player.skin.join())) === '0,0,0');
    check('a locked id forced into the store is ignored (sanitised to the default)', await (async () => { await A.page.evaluate(() => { const w = JSON.parse(localStorage.getItem('bedre.wardrobe.v1') || '{"v":1}'); w.eq = [9, 7, 8]; localStorage.setItem('bedre.wardrobe.v1', JSON.stringify(w)); }); await A.page.reload(); await A.page.waitForFunction(() => document.body.dataset.ready === '1' && window.__meta); return (await A.page.evaluate(() => window.__life.game.player.skin.join())) === '0,0,0'; })());
    await A.ctx.close();

    // ---- unlock mapping from stored reward ids (past weeks) + level; equip persists across reloads -----------------------------------------------------------
    const rewards = { 'streak-3': { d: '2026-10-01', s: 'streak' }, 'streak-30': { d: '2026-10-28', s: 'streak' }, 'week-2025-50-hard': { d: '2025-12-12', s: 'goal' }, 'week-2026-03-hard': { d: '2026-01-20', s: 'goal' }, 'week-2026-01-medium': { d: '2026-01-05', s: 'goal' } };
    const B = await mk({ wardrobe: { v: 1, xp: xpAt(5) + 10, eq: [2, 0, 0], seen: [], ach: [], alb: 0, rounds: 12 }, global: { v: 1, rewards } });
    await open(B.page, 'time=40');
    await B.page.evaluate(() => window.__meta.open('wardrobe')); await sleep(600);
    cs = await cards(B.page);
    const exp = { '0:1': 'owned', '0:2': 'worn', '0:3': 'locked', '0:4': 'owned', '0:7': 'owned', '1:1': 'owned', '1:3': 'locked', '1:4': 'owned', '1:2': 'locked', '2:1': 'owned', '2:2': 'owned', '2:6': 'owned', '2:4': 'locked', '2:8': 'locked' };
    const bad = Object.entries(exp).filter(([k, v]) => state(cs, +k[0], +k[2]) !== v);
    check('level 5 + streak-3 / streak-30 + two weekly-hard ids from PAST weeks + one weekly-medium unlock exactly the mapped items', bad.length === 0, bad.map(([k, v]) => `${k} want ${v} got ${state(cs, +k[0], +k[2])}`).join('; '));
    check('NEW marks on owned items that were never opened', (await B.page.evaluate(() => document.querySelectorAll('#mp-body .wd-new').length)) >= 5);
    await B.page.screenshot({ path: path.join(out, 'f45-wardrobe-grid.png') });
    await B.page.evaluate(() => document.querySelector('#mp-body .wd-card[data-slot="0"][data-id="4"]').click()); await sleep(300);
    await B.page.evaluate(() => document.querySelector('#mp-body .wd-card[data-slot="1"][data-id="1"]').click()); await sleep(300);
    cs = await cards(B.page);
    check('tapping an owned item wears it (one per slot)', state(cs, 0, 4) === 'worn' && state(cs, 0, 2) === 'owned' && state(cs, 1, 1) === 'worn');
    await B.page.screenshot({ path: path.join(out, 'f45-wardrobe-equipped.png') });
    await B.page.reload(); await B.page.waitForFunction(() => document.body.dataset.ready === '1' && window.__meta && window.__meta.wd);
    check('the worn skin persists across reloads (store + the player\'s hole)', (await B.page.evaluate(() => window.__life.game.player.skin.join())) === '4,1,0' && JSON.stringify((await W(B.page)).eq) === '[4,1,0]');
    check('...and the start screen badge shows level 5', await B.page.evaluate(() => document.getElementById('open-progress').dataset.level === '5'));
    const wrong = await B.page.evaluate(() => { const h = window.__life.game.holeViews; h.update(window.__life.game.holes); const i = h.rimInfo(window.__life.game.player.id); return i; });
    check('the ground shader gets the worn rim (pattern, both colours, identity colour untouched)', wrong && wrong.pat === SKINS.rim[4].pat && wrong.c1 === SKINS.rim[4].c1 && wrong.c2 === SKINS.rim[4].c2 && wrong.tint === SKINS.rim[4].tint && wrong.ident > 0);
    await B.ctx.close();

    // ---- XP: eligible rounds only ---------------------------------------------------------------------------------------------------------------------------
    const X = await mk({ wardrobe: { v: 1, xp: xpAt(2) - 30, eq: [0, 0, 0], seen: [], ach: [], alb: 0, rounds: 0 } });
    await open(X.page, 'time=40');
    await round(X.page, { warm: 5 });
    check('a too-short round (below the streak rule) gives NO XP', (await W(X.page)).xp === xpAt(2) - 30 && (await X.page.evaluate(() => window.__lastXp)).total === 0);
    await open(X.page, 'time=40');
    await round(X.page);
    const w1 = await W(X.page), xp1 = await X.page.evaluate(() => window.__lastXp);
    check('an eligible round pays XP (same eligibility as the streak) and levels up', xp1.total >= 20 && w1.xp === xpAt(2) - 30 + xp1.total && xp1.levelUp && xp1.after.level === 2, JSON.stringify({ total: xp1.total, lvl: xp1.after.level }));
    check('results show "+N XP" + the level-up moment in the header and the newly unlocked item in the Progress tab', await X.page.evaluate(() => { const b = document.getElementById('wd-xp-block'); return b && b.classList.contains('up') && /XP/.test(b.textContent) && /Level up: 2/.test(b.textContent) && !!b.querySelector('.lv-badge'); }) && await X.page.evaluate(() => /New in the wardrobe/.test(document.getElementById('rt-ach').textContent) && !!document.querySelector('#rt-ach .wd-open')));
    await X.page.screenshot({ path: path.join(out, 'f45-results-levelup.png') });
    await X.page.evaluate(() => document.querySelector('#rt-ach .wd-open').click()); await sleep(500);
    check('"Open wardrobe" jumps into the wardrobe tab', await X.page.evaluate(() => !document.getElementById('meta-panel').classList.contains('hidden') && document.querySelectorAll('#mp-body .wd-card').length > 5));
    await X.page.screenshot({ path: path.join(out, 'f45-wardrobe-after-levelup.png') });
    await X.page.evaluate(() => window.__meta.close());
    await open(X.page, 'time=40&mode=free');
    await round(X.page);
    check('free roam gives NO XP', (await W(X.page)).xp === w1.xp && !(await X.page.evaluate(() => document.getElementById('wd-xp-block') && document.getElementById('wd-xp-block').dataset.xp > 0)));
    await X.ctx.close();
    const D = await mk({ wardrobe: { v: 1, xp: 100, eq: [0, 0, 0], seen: [], ach: [], alb: 0, rounds: 0 }, allowDebug: false });
    await open(D.page, 'time=40&bots=3');
    await round(D.page);
    check('a debug round (?time= / ?bots=) gives NO XP', (await W(D.page)).xp === 100);
    await D.ctx.close();

    // ---- LV text + badge look ---------------------------------------------------------------------------------------------------------------------------------
    const L = await mk({ wardrobe: { v: 1, xp: xpAt(12) + 400, eq: [0, 0, 0], seen: [], ach: [], alb: 0, rounds: 30 }, global: { v: 1, rewards }, lang: 'lv' });
    await open(L.page, '');
    await L.page.screenshot({ path: path.join(out, 'f45-level-badge-start.png'), clip: { x: 300, y: 380, width: 500, height: 300 } });
    await L.page.evaluate(() => window.__meta.open('wardrobe')); await sleep(600);
    check('LV: the wardrobe tab speaks Latvian', await L.page.evaluate(() => /Līmenis 12/.test(document.querySelector('#wd-top .wd-lv').textContent) && [...document.querySelectorAll('.mp-tabs button')].some((b) => b.textContent === 'Skapis')));
    await L.page.screenshot({ path: path.join(out, 'f45-wardrobe-lv.png') });
    await L.ctx.close();
  } finally { await browser.close(); }
}
