// Streak / weekly goals / rewards checks for scripts/smoke-meta.mjs. Two layers:
//   1. pure rules in Node (src/meta/streak.js, goalPool.js) with arbitrary dates;
//   2. the real game in headless Chromium (injectable clock: window.__retentionNow = unix ms) driven with the game's own test hooks.
// Usage (from smoke-meta): await runRetention({ chromium, webkit, devices, base, out, check, errors })
import path from 'node:path';
import { applyDay, viewStreak, blankStreak, MILESTONES, MAX_FREEZES } from '../../src/meta/streak.js';
import { POOL, pickGoals, weekKey, weekStart, weekIndex, goalText, applies } from '../../src/meta/goalPool.js';
import { rigaDay, shiftDay } from '../../src/rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GK = 'bedre.meta.global.v1';
// 2026-11-18 12:00 Riga (UTC+2) -> a Wednesday of ISO week 2026-47
const D0 = '2026-11-18';
const at = (day, h = 12, m = 0, s = 0) => { const [y, mo, d] = day.split('-').map(Number); return Date.UTC(y, mo - 1, d, h - 2, m, s); };   // Riga winter time (UTC+2)

export async function runRetention(env) {
  const { chromium, webkit, devices, base, out, check, errors } = env;

  // ================= 1. pure rules in Node ==================================================================================
  {
    const run = (days, s = blankStreak()) => days.map((d) => applyDay(s, d));
    let s = blankStreak();
    run([D0, D0, D0], s);
    check('streak: three eligible rounds on one day increment once', s.cur === 1 && s.last === D0);
    run([shiftDay(D0, 1)], s); check('streak: next day -> 2', s.cur === 2);
    run([shiftDay(D0, 3)], s); check('streak: a missed day (no freeze) restarts at 1, best kept', s.cur === 1 && s.best === 2);
    s = blankStreak(); let ev = []; for (let i = 0; i < 7; i++) ev.push(applyDay(s, shiftDay(D0, i)));
    check('streak: day 7 earns exactly one freeze + the 7-day milestone', s.cur === 7 && s.freezes === 1 && ev[6].freezeEarned && ev[6].milestone === 7 && ev.slice(0, 6).every((e) => !e.freezeEarned));
    const r8 = applyDay(s, shiftDay(D0, 8));      // day 7 was D0+6; D0+8 skips D0+7
    check('streak: freeze is spent automatically on ONE missed day and the streak continues', r8.froze && s.cur === 8 && s.freezes === 0 && s.frozen.includes(shiftDay(D0, 7)));
    const r9 = applyDay(s, shiftDay(D0, 11));
    check('streak: a freeze cannot cover two missed days', r9.reset && s.cur === 1);
    s = blankStreak(); for (let i = 0; i < 21; i++) applyDay(s, shiftDay(D0, i));
    check(`streak: freezes cap at ${MAX_FREEZES}`, s.freezes === MAX_FREEZES && s.cur === 21);
    for (let i = 21; i < 28; i++) applyDay(s, shiftDay(D0, i));
    check('streak: day 28 with 2 held earns no third', s.freezes === MAX_FREEZES);
    // milestone ids
    s = blankStreak(); const ms = []; for (let i = 0; i < 100; i++) { const r = applyDay(s, shiftDay(D0, i)); if (r.milestone) ms.push(r.milestone); }
    check('streak: milestones 3/7/14/30/60/100 fire once each', JSON.stringify(ms) === JSON.stringify(MILESTONES), ms.join(','));
    // clock backwards
    s = blankStreak(); run([D0, shiftDay(D0, 1), shiftDay(D0, 2)], s);
    const back = applyDay(s, D0); const back2 = applyDay(s, shiftDay(D0, -5));
    check('clock moved BACK: no extra day, nothing destroyed', back.ignored === 'back' && back2.ignored === 'back' && s.cur === 3 && s.last === shiftDay(D0, 2));
    const same = applyDay(s, shiftDay(D0, 2)); const fwd = applyDay(s, shiftDay(D0, 3));
    check('clock back then forward within the same real day: the streak simply continues', same.ignored === 'same' && fwd.extended && s.cur === 4);
    const v = viewStreak({ ...s }, D0);
    check('clock behind the last counted day: chip still shows the streak and today as done', v.alive && v.cur === 4 && v.doneToday);
    // viewStreak: lapsed / saved by freeze
    check('view: yesterday played -> alive, not done today', (() => { const t = viewStreak({ cur: 5, best: 5, last: shiftDay(D0, -1), freezes: 0 }, D0); return t.alive && !t.doneToday && t.cur === 5; })());
    check('view: two days ago without a freeze -> shows 0; with a freeze -> kept', viewStreak({ cur: 5, best: 5, last: shiftDay(D0, -2), freezes: 0 }, D0).cur === 0 && viewStreak({ cur: 5, best: 5, last: shiftDay(D0, -2), freezes: 1 }, D0).cur === 5);
    // midnight crossing / time zones: the day of a round is the Riga day of the moment it ENDS; independent of the process TZ
    check('midnight: 23:59:59 and 00:00:01 Riga time are two different days (winter)', rigaDay(at('2026-11-18', 23, 59, 59) / 1000) === '2026-11-18' && rigaDay(at('2026-11-18', 24, 0, 1) / 1000) === '2026-11-19');
    check('midnight: also across the summer-time change (UTC+3)', rigaDay(Date.UTC(2026, 6, 1, 20, 59, 59) / 1000) === '2026-07-01' && rigaDay(Date.UTC(2026, 6, 1, 21, 0, 1) / 1000) === '2026-07-02');
    check('Riga day is not the UTC day (22:30Z in winter is already tomorrow)', rigaDay(Date.UTC(2026, 10, 18, 22, 30) / 1000) === '2026-11-19');
  }
  {
    // weeks + goal picking
    check('ISO weeks: 2026-11-16..22 = 2026-47, 2026-12-28..2027-01-03 = 2026-53, 2027-01-04 = 2027-01', weekKey('2026-11-16') === '2026-47' && weekKey('2026-11-22') === '2026-47' && weekKey('2026-11-23') === '2026-48' && weekKey('2026-12-28') === '2026-53' && weekKey('2027-01-03') === '2026-53' && weekKey('2027-01-04') === '2027-01');
    check('week starts on Monday', weekStart('2026-11-22') === '2026-11-16' && weekStart('2026-11-16') === '2026-11-16');
    const base0 = (g) => !g.needs;
    const all = (g) => true;
    check(`pool has ${POOL.length} templates (>= 24), each with LV + EN text, target > 0 and a valid tier`, POOL.length >= 24 && POOL.every((g) => g.lv && g.en && g.target > 0 && ['easy', 'medium', 'hard'].includes(g.tier) && (g.sw || g.rd) && ['sum', 'best', 'days'].includes(g.type)), POOL.map((g) => g.id).join(' '));
    check('pool: unique ids, 3 tiers populated, gated templates only combo / power-up', new Set(POOL.map((g) => g.id)).size === POOL.length && ['easy', 'medium', 'hard'].every((t) => POOL.filter((g) => g.tier === t).length >= 6) && POOL.filter((g) => g.needs).every((g) => ['comboBest', 'powerupPicked'].includes(g.needs)));
    check('pool: no template mentions the hard difficulty', POOL.every((g) => !/difficulty|grūtība/i.test(g.en + g.lv)));
    let bad = [], repeats = 0, prev = null, sameTwo = 0;
    for (let w = 0; w < 160; w++) {
      const day = shiftDay('2026-01-05', w * 7 + (w % 7));      // any weekday of the week
      const a = pickGoals(day, { available: base0 }), b = pickGoals(shiftDay(day, w % 7 === 6 ? -1 : 1), { available: base0 });
      if (a.map((g) => g.id).join() !== pickGoals(weekStart(day), { available: base0 }).map((g) => g.id).join()) bad.push('weekday-dependent ' + day);
      if (a.length !== 3 || a.map((g) => g.tier).join() !== 'easy,medium,hard') bad.push('tiers ' + day);
      if (a.filter((g) => g.special).length > 1) bad.push('2 specials ' + day);
      if (a.some((g) => g.needs)) bad.push('gated offered ' + day);
      if (prev && prev.map((g) => g.id).join() === a.map((g) => g.id).join() && weekKey(day) !== prev.k) sameTwo++;
      if (prev) for (let i = 0; i < 3; i++) if (prev[i].id === a[i].id) repeats++;
      prev = Object.assign(a.slice(), { k: weekKey(day) });
    }
    check('goals: 160 weeks -> always easy/medium/hard, same all week, at most ONE district/online goal, no gated one unless seen', bad.length === 0, bad.slice(0, 3).join(' | '));
    check('goals: two consecutive weeks never get an identical trio, a tier template rarely repeats back-to-back', sameTwo === 0 && repeats <= 14, `identicalTrio=${sameTwo} sameTemplateNextWeek=${repeats}`);
    const withG = pickGoals('2027-03-10', { available: all });
    check('gated templates become pickable once available', POOL.filter((g) => g.needs).length >= 3 && Array.from({ length: 80 }, (_, i) => pickGoals(shiftDay('2026-01-05', i * 7), { available: all })).flat().some((g) => g.needs) && withG.length === 3);
    const sa = pickGoals('2026-11-18', { available: base0, salt: 'x' }).map((g) => g.id).join(), sb = pickGoals('2026-11-18', { available: base0, salt: 'y' }).map((g) => g.id).join();
    check('goals: a salt (test seed) changes the picks, the same salt reproduces them', sa !== sb && sa === pickGoals('2026-11-18', { available: base0, salt: 'x' }).map((g) => g.id).join());
    // special never lands on a week alongside another special; district goals spread over the year
    let districtWeeks = 0; for (let w = 0; w < 104; w++) if (pickGoals(shiftDay('2026-01-05', w * 7), { available: base0 }).some((g) => g.special)) districtWeeks++;
    check('district / online goals appear in some weeks but not all', districtWeeks > 10 && districtWeeks < 104, `${districtWeeks}/104`);
    check('text: every template renders in LV and EN without a stray placeholder', POOL.every((g) => !/[{}]/.test(goalText(g, 'lv') + goalText(g, 'en'))));
    check('weekIndex steps by one per ISO week', weekIndex('2026-11-23') - weekIndex('2026-11-17') === 1);
  }

  // ================= 2. the game ===================================================================================================
  const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
  const browser = await chromium.launch({ headless: true, args: GPU });
  const contexts = [];
  const mk = async (b, { now = at(D0), lang = 'lv', profile = { viewport: { width: 1280, height: 720 } }, tz = 'Europe/Riga', strict = false, seed = null } = {}) => {
    const ctx = await b.newContext({ ...profile, timezoneId: tz, locale: lang === 'lv' ? 'lv-LV' : 'en-GB' });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.addInitScript(({ now, lang, strict, seed }) => {
      window.__metaAllowDebug = !strict;
      if (now) window.__retentionNow = now;
      try {
        if (!sessionStorage.getItem('rt-init')) {     // first load of this tab only: later reloads keep what the page stored
          sessionStorage.setItem('rt-init', '1'); localStorage.setItem('bedre.lang', lang); localStorage.setItem('bedre.name', 'Tests');
          if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
        }
      } catch { /* ignore */ }
    }, { now, lang, strict, seed });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('retention console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('retention pageerror: ' + e.message));
    return { ctx, page };
  };
  const open = async (page, q = '') => {
    await page.goto(`${base}/?quality=low&intro=0&radio=0&${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (document.body.dataset.ready === '1' && window.__meta && window.__retention) || document.body.dataset.error, null, { timeout: 180000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error');
    await page.evaluate(() => { window.__rw = window.__rw || []; if (!window.__rwHooked) { window.__rwHooked = 1; window.__life.bus.on('rewardUnlocked', (id) => window.__rw.push(id)); } });
  };
  const G = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), GK);
  /** One eligible (or not) round: start, play `warm` seconds, run `act(page)`, then end it (optionally at another instant: midnight crossing). */
  const round = async (page, { warm = 21, act = null, endNow = null, startNow = null } = {}) => {
    await page.evaluate(({ warm, startNow }) => { if (startNow) window.__retentionNow = startNow; const g = window.__life.game; g.start(); g.skipIntro(); if (warm) g.step(warm); }, { warm, startNow });
    if (act) await act(page);
    await sleep(350);
    await page.evaluate((endNow) => { if (endNow) window.__retentionNow = endNow; window.__life.game.end(); }, endNow);
    await sleep(700);
  };
  const setNow = (page, ms) => page.evaluate((ms) => { window.__retentionNow = ms; }, ms);
  const chipText = (page) => page.evaluate(() => { const c = document.getElementById('rt-chip'); return c ? { s: c.querySelector('.rt-seg b').textContent, st: c.dataset.state, alive: c.dataset.alive, g: c.querySelector('.rt-seg:last-child b').textContent } : null; });

  try {
    // ---- 2a. two fresh browsers pick the same goals; the next week differs --------------------------------------------------------
    const A = await mk(browser, { now: at('2026-11-18') }), B = await mk(browser, { now: at('2026-11-21', 23, 30), tz: 'Pacific/Auckland' });
    await open(A.page, 'time=40'); await open(B.page, 'time=40');
    const ga = await A.page.evaluate(() => window.__retention.goals.tpls().map((t) => t.id)), gb = await B.page.evaluate(() => window.__retention.goals.tpls().map((t) => t.id));
    check('week rollover: two fresh browsers (different device time zones, Mon-Sun of the same Riga week) get the same three goals', ga.length === 3 && JSON.stringify(ga) === JSON.stringify(gb), ga.join(','));
    check('...and Riga day / week key do not depend on the device time zone', (await B.page.evaluate(() => window.__retention.today())) === '2026-11-21');
    await setNow(A.page, at('2026-11-23', 0, 5));          // Monday 00:05 Riga
    const next = await A.page.evaluate(() => { const r = window.__retention; r.goals.ensureWeek(); return { ids: r.goals.tpls().map((t) => t.id), week: JSON.parse(localStorage.getItem('bedre.meta.global.v1')).goals.week }; });
    check('week rollover at Monday 00:00 Riga picks three different goals (and the new week id)', next.week === '2026-48' && JSON.stringify(next.ids) !== JSON.stringify(ga), next.ids.join(','));
    check('...equal to the pure pick for that week', JSON.stringify(next.ids) === JSON.stringify(pickGoals('2026-11-23').map((g) => g.id)));
    await setNow(A.page, at('2026-11-22', 23, 59, 50));
    check('Sunday 23:59 Riga is still the old week (no early roll)', await A.page.evaluate(() => { window.__retention.goals.ensureWeek(); return JSON.parse(localStorage.getItem('bedre.meta.global.v1')).goals.week; }) === '2026-48');   // clock moved back keeps the stored week
    await B.ctx.close();

    // ---- 2b. streak through real rounds, with the injected clock --------------------------------------------------------------------
    {
      const { page } = await mk(browser, { now: at(D0, 20, 0) });
      await open(page, 'time=40');
      let c0 = await chipText(page);
      check('start screen chip: streak 0, today not played, goals 0/3', c0 && c0.s === '0' && c0.st === 'open' && c0.g === '0/3', JSON.stringify(c0));
      await round(page);
      let g = await G(page);
      check('real round: streak 1, rewards unaffected', g.streak.cur === 1 && g.streak.last === D0 && Object.keys(g.rewards).length === 0);
      const line = await page.locator('#rt-streak-line').innerText();
      check('results screen line when the round started the streak (LV)', /Sērija sākta/.test(line), line);
      check('chip after the round: streak 1 + today done', JSON.stringify(await chipText(page)).includes('"st":"done"'), JSON.stringify(await chipText(page)));
      await round(page, { startNow: at(D0, 21) });
      g = await G(page);
      check('a second eligible round on the same day does not add a day', g.streak.cur === 1);
      check('...and shows no streak line (nothing was extended)', (await page.locator('#rt-streak-line').innerText()) === '');
      // next day
      await setNow(page, at(shiftDay(D0, 1), 9)); await round(page);
      g = await G(page);
      const l2 = await page.locator('#rt-streak-line').innerText();
      check('next Riga day: streak 2, line "2 dienas pēc kārtas!"', g.streak.cur === 2 && /2 dienas pēc kārtas!/.test(l2), l2);
      await setNow(page, at(shiftDay(D0, 2), 9)); await round(page);
      const l3 = await page.locator('#rt-streak-line').innerText();
      g = await G(page);
      check('day 3: line "3 dienas pēc kārtas!", milestone reward streak-3 recorded once + bus event', g.streak.cur === 3 && /3 dienas pēc kārtas!/.test(l3) && g.rewards['streak-3'] && (await page.evaluate(() => window.__rw.filter((x) => x === 'streak-3').length)) === 1, l3);
      // milestone toast arrives with the next round (the toast lane is hidden while results are up)
      await page.evaluate(() => { const g = window.__life.game; g.start(); });
      await sleep(1600);
      const toastTxt = await page.evaluate(() => [...document.querySelectorAll('.meta-toast')].map((e) => e.textContent).join('|'));
      check('milestone toast (3-day streak) shown when the next round starts', /3 dienu sērija/.test(toastTxt), toastTxt);
      await page.evaluate(() => { window.__life.game.skipIntro(); window.__life.game.end(); }); await sleep(500);
      // clock moved back: nothing granted, nothing destroyed
      await setNow(page, at(D0, 9)); await round(page, { warm: 21 });
      g = await G(page);
      check('clock moved back 2 days: round ignored (no extra day), streak untouched', g.streak.cur === 3 && g.streak.last === shiftDay(D0, 2), JSON.stringify(g.streak));
      check('...chip still shows 3 and "today done" while the clock is behind', JSON.stringify(await chipText(page)).includes('"s":"3"'));
      await setNow(page, at(shiftDay(D0, 3), 10)); await round(page);
      g = await G(page);
      check('clock jumps forward again to the next real day: streak continues to 4', g.streak.cur === 4);
      // day 7 -> freeze + milestone; then skip one day -> freeze consumed
      for (let i = 4; i <= 6; i++) { await setNow(page, at(shiftDay(D0, i), 10)); await round(page); }
      g = await G(page);
      check('day 7 reached: one freeze earned (shown in the panel), reward streak-7 once', g.streak.cur === 7 && g.streak.freezes === 1 && g.rewards['streak-7'] && (await page.evaluate(() => window.__rw.filter((x) => x === 'streak-7').length)) === 1, JSON.stringify(g.streak));
      await page.evaluate(() => window.__meta.open('week')); await sleep(200);
      const pnl = await page.locator('#rt-streak-sec').innerText();
      check('progress panel lists streak, freeze count and reward badges', /7 dienas/.test(pnl) && /1\/2/.test(pnl) && (await page.locator('#rt-rewards-sec .rt-badge').count()) >= 2, pnl.replace(/\n/g, ' '));
      await page.evaluate(() => window.__meta.close());
      await setNow(page, at(shiftDay(D0, 8), 10)); await round(page);   // day 7 was D0+6, D0+7 is missed
      g = await G(page);
      check('one missed day: the freeze is consumed automatically and the streak goes on (8)', g.streak.cur === 8 && g.streak.freezes === 0 && g.streak.frozen.includes(shiftDay(D0, 7)), JSON.stringify(g.streak));
      check('freeze message on the results screen', /atlaide/i.test(await page.locator('#rt-streak-line').innerText()));
      await setNow(page, at(shiftDay(D0, 11), 10)); await round(page);   // D0+9, D0+10 missed -> reset
      g = await G(page);
      check('two missed days: streak resets to 1 (best stays 8), no punishment beyond that', g.streak.cur === 1 && g.streak.best === 8, JSON.stringify(g.streak));
      check('rewards recorded once each over the whole run', Object.keys(g.rewards).filter((k) => k.startsWith('streak-')).sort().join() === 'streak-3,streak-7');
      // midnight crossing: starts 23:59:30 on day X, ends 00:00:20 on X+1 -> counts for X+1
      const X = shiftDay(D0, 11);
      await setNow(page, at(X, 12));
      await round(page, { startNow: at(X, 23, 59, 30), endNow: at(shiftDay(X, 1), 0, 0, 20) });
      g = await G(page);
      check('playing across midnight: the round counts for the day it ENDS on', g.streak.last === shiftDay(X, 1) && g.streak.cur === 2, JSON.stringify(g.streak));
      // persistence over reload
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForFunction(() => document.body.dataset.ready === '1' && window.__retention, null, { timeout: 180000 });
      const cr = await chipText(page); g = await G(page);
      check('streak + rewards persist across a reload', cr && cr.s === '2' && Object.keys(g.rewards).length >= 2, JSON.stringify(cr));
      await page.close();
    }

    // ---- 2c. what does not count ------------------------------------------------------------------------------------------------
    {
      const { page } = await mk(browser, { now: at(D0) });
      await open(page, 'time=40&mode=free');
      await page.evaluate(() => window.__retention.setGoals(['people300', 'trees600', 'cars100']));
      await round(page, { act: (p) => p.evaluate(() => { const g = window.__life.game, w = window.__life.world; g.player.setRadius(130); const o = w.objects.filter((o) => o.kind === 'tree' && o.state === 0).slice(0, 60); for (const x of o) { g.teleport(x.x, x.z); g.step(0.1); } }) });
      let g = await G(page);
      check('free roam: no streak day, no goal progress, no rewards', g.streak.cur === 0 && Object.values(g.goals.prog).every((p) => !p.v) && Object.keys(g.rewards).length === 0, JSON.stringify([g.streak.cur, g.goals.prog]));
      await page.close();
      const s2 = await mk(browser, { now: at(D0), strict: true });
      await open(s2.page, 'time=40&strictdebug=1');
      await s2.page.evaluate(() => window.__retention.setGoals(['people300', 'trees600', 'cars100']));
      await round(s2.page, { act: (p) => p.evaluate(() => { const a = window.__game; a.teleport(0, 0); a.step(1); }) });
      g = await G(s2.page);
      check('debug-hook rounds (strictdebug) do not extend the streak or goals either', g.streak.cur === 0 && Object.values(g.goals.prog).every((p) => !p.v));
      await s2.page.close();
      const s3 = await mk(browser, { now: at(D0) });
      await open(s3.page, 'time=40');
      await round(s3.page, { warm: 5 });                 // too short: < min(60, half of the round)
      g = await G(s3.page);
      check('a round shorter than the eligibility minimum does not count', g.streak.cur === 0);
      await s3.page.close();
    }

    // ---- 2d. map data: every swallow template is achievable on every map it counts on; then every template is DRIVEN to completion ----
    const MAPS = ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];
    const mapCounts = {};
    for (const slug of MAPS) {
      const { page } = await mk(browser, { now: at(D0) });
      await open(page, `map=${slug}&time=40`);
      mapCounts[slug] = await page.evaluate(() => {
        const R = window.__retention, w = window.__life.world, alb = window.__meta.album, res = {};
        for (const t of R.POOL) if (t.sw) { const c = { sets: {}, acc: {} }; let n = 0; for (const o of w.objects) n += t.sw(o, alb.byObj.get(o.id), c); res[t.id] = n; }
        res.areasBanks = [...new Set(window.__meta.areas.map((a) => a.bank))].join('');
        return res;
      });
      await page.close();
    }
    const unmet = [];
    for (const t of POOL.filter((g) => g.sw)) for (const slug of MAPS) { if (t.maps && !t.maps.includes(slug)) continue; if (mapCounts[slug][t.id] < t.target) unmet.push(`${t.id}@${slug}=${mapCounts[slug][t.id]}<${t.target}`); }
    check('map data: every swallow goal has at least `target` matching objects on every map it counts on (church 2, pigeons 25, bridge 3 on Centre, trees 2000 in Mežaparks ...)', unmet.length === 0, unmet.join(' ') || `churches: ${MAPS.map((m) => m + ':' + mapCounts[m].churches2).join(' ')} | bridge(centrs): ${mapCounts.centrs.bridge3} | trees(meza): ${mapCounts.mezaparks.trees2000Meza} | transit: ${MAPS.map((m) => mapCounts[m].transit30).join('/')}`);

    // drive each template to completion with the game's own test hooks
    const ctxFor = (t) => {
      const map = t.maps ? t.maps[0] : 'centrs';
      const mode = t.modes ? (t.modes[0] === 'online' ? 'classic' : t.modes[0]) : 'classic';
      return { map, mode };
    };
    const driveInPage = async (page, id) => page.evaluate(async (id) => {
      const R = window.__retention, g = window.__life.game, w = window.__life.world, alb = window.__meta.album;
      const tpl = R.POOL.find((t) => t.id === id);
      const done = () => R.goals.liveValue(tpl) >= tpl.target;
      const swallowAll = (filter, cap = 260, step = 0.1) => {
        const scratch = { sets: {}, acc: {} };
        const objs = w.objects.filter((o) => o.state === 0 && filter(o, scratch));
        const stride = Math.max(1, Math.floor(objs.length / cap));
        for (let i = 0; i < objs.length && !done(); i += stride) { g.teleport(objs[i].x, objs[i].z); g.step(step); }
        for (let i = 1; i < objs.length && !done(); i++) { if (i % stride === 0) continue; g.teleport(objs[i].x, objs[i].z); g.step(step); }
      };
      if (tpl.sw) {
        g.player.setRadius(130);
        swallowAll((o, sc) => tpl.sw(o, alb.byObj.get(o.id), sc) > 0);
      } else if (id === 'level6' || id === 'quickLevel7') {
        g.player.setRadius(id === 'level6' ? 20 : 30); g.step(0.7);
      } else if (id === 'kills5' || id === 'kills3round') {
        g.player.setRadius(40);
        for (let i = 1; i < g.holes.length && !done(); i++) { const p = g.player; g.teleportHole(i, p.x, p.z); g.setHoleRadius(i, 2); g.step(0.4); await new Promise((r) => setTimeout(r, 30)); }
      } else if (id === 'daugava4') {
        const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
        const b = w.bounds, pt = {};
        for (const a of window.__meta.areas) { if (pt[a.bank]) continue; for (let x = Math.max(a.x0, b.minX + 50); x <= Math.min(a.x1, b.maxX - 50) && !pt[a.bank]; x += 40) for (let z = Math.max(a.z0, b.minZ + 50); z <= Math.min(a.z1, b.maxZ - 50); z += 40) if (inside(a.poly, x, z)) { pt[a.bank] = [x, z]; break; } }
        const seq = ['L', 'R', 'L', 'R', 'L'];
        for (const k of seq) { g.teleport(pt[k][0], pt[k][1]); g.step(0.6); }
      } else if (id === 'score3000') {
        g.player.setRadius(130);
        swallowAll((o) => o.isBuilding && o.value >= 8, 200, 0.12);
      } else if (id === 'dist6') {
        const p = g.player; g.player.setRadius(2.2);
        const x0 = p.x, z0 = p.z; g.autopilot = true; g.player.control = { mode: 'target', x: x0 + 4000, z: z0 }; g.step(30); g.autopilot = false;
        window.__dist30 = R.goals.ctx.dist;
        return { distMeasured: R.goals.ctx.dist };
      } else if (id === 'picks3' || id === 'picks5') {
        for (let i = 0; i < 6; i++) window.__life.bus.emit('powerupPicked', { type: 'x' });
      } else if (id === 'combo70') {
        window.__life.bus.emit('comboBest', 75);
      }
      return {};
    }, id);

    const results = [];
    const only = (process.env.RT_TEMPLATES || '').split(',').filter(Boolean);
    for (const t of POOL) {
      if (only.length && !only.includes(t.id)) { results.push({ id: t.id, ok: true }); continue; }
      const { map, mode } = ctxFor(t);
      const { page } = await mk(browser, { now: at(D0), seed: { [GK]: { v: 1, seen: { comboBest: 1, powerupPicked: 1 } } } });
      await open(page, `map=${map}&mode=${mode}&time=40`);
      const wk = weekKey(D0);
      await page.evaluate((ids) => window.__retention.setGoals(ids), [t.id, ...['people300', 'trees600', 'cars100'].filter((x) => x !== t.id)].slice(0, 3));
      let info = {};
      const rounds = t.id === 'rounds3' || t.id === 'quick2' || t.id === 'online3' || t.id === 'win3' || t.id === 'daily3' ? (t.id === 'quick2' ? 2 : 3) : 1;
      const maxRounds = t.sw ? 4 : /^win/.test(t.id) ? 6 : rounds;    // a weekly total may take several rounds (traffic only exists near the hole)
      for (let r = 0; r < maxRounds; r++) {
        if (r >= (/^win/.test(t.id) ? 1 : rounds) && (await G(page)).goals.done[t.id]) break;
        if (t.id === 'daily3') await setNow(page, at(shiftDay('2026-11-16', r), 12));          // three different days of the week
        await page.evaluate(() => { const g = window.__life.game; g.start(); g.skipIntro(); g.step(21); });
        if (t.modes && t.modes[0] === 'online') await page.evaluate(() => { const g = window.__life.game; g.unranked = 'online'; g.modeUnranked = 'online'; });
        if (t.id.startsWith('win') || t.id === 'win1') {
          await page.evaluate(() => { const g = window.__life.game, w = window.__life.world; g.player.setRadius(130); const o = w.objects.filter((o) => o.isBuilding && o.state === 0 && o.value >= 8); const st = Math.max(1, Math.floor(o.length / 120)); for (let i = 0; i < o.length; i += st) { g.teleport(o[i].x, o[i].z); g.step(0.1); } });
        } else if (!['rounds3', 'quick2', 'online3', 'daily3'].includes(t.id)) info = await driveInPage(page, t.id);
        await sleep(300);
        await page.evaluate(() => window.__life.game.end());
        await sleep(700);
      }
      const g = await G(page);
      const tier = t.tier, done = !!(g.goals.done && g.goals.done[t.id]);
      const rw = await page.evaluate(() => window.__rw.slice());
      const rewardId = `week-${wk}-${tier}`;
      const oneReward = rw.filter((x) => x === rewardId).length === 1 && !!g.rewards[rewardId];
      let ok = done && oneReward;
      let note = `prog=${JSON.stringify(g.goals.prog[t.id] || {})}`;
      if (t.id === 'dist6') {
        // 10 km is a weekly total: proven from the measured speed (30 s of real movement) x round length x rounds per week
        const d30 = info.distMeasured || 0, perRound = (d30 / 30) * 300;
        ok = d30 >= 250 && perRound * 4 >= t.target;
        note = `measured ${Math.round(d30)} m in 30 s -> ${Math.round(perRound)} m per 5 min round -> ${(t.target / perRound).toFixed(1)} rounds for ${t.target / 1000} km`;
      }
      results.push({ id: t.id, ok, note });
      check(`goal template "${t.id}" (${t.tier}) completes in the real game -> toast-less reward ${t.id === 'dist6' ? '(proven from speed)' : rewardId} once`, ok, note);
      await page.close();
    }
    check(`all ${POOL.length} goal templates verified`, results.every((r) => r.ok), results.filter((r) => !r.ok).map((r) => r.id).join(','));

    // ---- 2e. gated templates: appear only after the event was seen; completing all three => bonus reward ---------------------------------
    {
      const { page } = await mk(browser, { now: at('2026-11-25') });
      await open(page, 'time=40');
      const before = await page.evaluate(() => window.__retention.pickFor('2026-12-02').concat(window.__retention.pickFor('2027-02-03')));
      let anyGated = false;
      for (let i = 0; i < 40; i++) { const ids = await page.evaluate((d) => window.__retention.pickFor(d), shiftDay('2026-11-30', i * 7)); if (ids.some((id) => POOL.find((p) => p.id === id).needs)) anyGated = true; }
      // the features ship (CFG.features): gated templates are part of the pool for everybody from the first day; the pure pool still honours `needs` when a flag is off
      check('powerup / combo goals are in the pool for everyone (features shipped); with the gate closed (pure pick) they are not', anyGated && before.length === 6 && [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((i) => pickGoals(shiftDay('2026-11-30', i * 7), { available: (g) => !g.needs }).every((g) => !g.needs)));
      await page.evaluate(() => { window.__life.bus.emit('powerupPicked', {}); window.__life.bus.emit('comboBest', 4); });
      await sleep(1900);   // saved lazily (1.5 s)
      const seen = (await G(page)).seen;
      let found = false;
      for (let i = 0; i < 40 && !found; i++) { const ids = await page.evaluate((d) => window.__retention.pickFor(d), shiftDay('2026-11-30', i * 7)); if (ids.some((id) => POOL.find((p) => p.id === id).needs)) found = true; }
      check('...and are offered once `powerupPicked` / `comboBest` were seen (event remembered on the device)', !!seen.powerupPicked && !!seen.comboBest && found, JSON.stringify(seen));
      await page.close();
    }
    {
      const { page } = await mk(browser, { now: at(D0) });
      await open(page, 'time=40');
      await page.evaluate(() => window.__retention.setGoals(['pigeons25', 'trees600', 'win1']));
      const act = (p) => p.evaluate(() => {
        const g = window.__life.game, w = window.__life.world; g.player.setRadius(130);
        const pick = (f, n) => w.objects.filter((o) => o.state === 0 && f(o)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / n)) === 0);
        for (const o of [...pick((o) => o.kind === 'pigeon', 120), ...pick((o) => o.cls === 'tree', 120), ...pick((o) => o.isBuilding && o.value >= 8, 100)]) { g.teleport(o.x, o.z); g.step(0.1); }
      });
      await round(page, { act });
      const g = await G(page);
      const wk = weekKey(D0), rw = await page.evaluate(() => window.__rw.slice());
      check('completing all three goals records the bonus reward week-YYYY-WW-all once', !!g.rewards[`week-${wk}-all`] && rw.filter((x) => x === `week-${wk}-all`).length === 1 && g.goals.all === true, rw.join());
      const roundGoals = await page.locator('#rt-round-goals').innerText().catch(() => '');
      check('results screen lists the goals this round advanced', /Norij 25 baložus/.test(roundGoals) && /Uzvari kārtu/.test(roundGoals), roundGoals.replace(/\n/g, ' '));
      // reload: progress persists, rewards stay single
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForFunction(() => document.body.dataset.ready === '1' && window.__retention, null, { timeout: 180000 });
      const g2 = await G(page);
      await page.evaluate(() => window.__meta.open('week')); await sleep(200);
      const card = await page.locator('#rt-goals-card').innerText();
      check('weekly goals persist across a reload (card shows them done, rewards unchanged)', JSON.stringify(g2.rewards) === JSON.stringify(g.rewards) && (card.match(/izpildīts/g) || []).length === 3 && /Vēl .*(d|st)/.test(card), card.replace(/\n/g, ' '));
      // share card carries the optional line
      const extra = await page.evaluate(() => window.__retention.cardExtra());
      check('share card extra line mentions goals done (no personal data)', /Mērķi 3\/3/.test(extra) && !/Tests/.test(extra), extra);
      await page.close();
    }

    // ---- 2f. the start-screen chip fits (bounding boxes), LV + EN, three viewports ----------------------------------------------------
    for (const vp of [{ n: '320x568', w: 320, h: 568, touch: true }, { n: '390x780', w: 390, h: 780, touch: true }, { n: '1280x720', w: 1280, h: 720, touch: false }]) {
      for (const lang of ['lv', 'en']) {
        const { page } = await mk(browser, { now: at(D0), lang, profile: { viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 }, seed: { [GK]: { v: 1, streak: { cur: 128, best: 128, last: shiftDay(D0, -1), freezes: 2, frozen: [] } } } });
        await open(page);
        await sleep(400);
        const m = await page.evaluate(() => {
          const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
          const chip = document.getElementById('rt-chip');
          const meas = () => ({ play: R('#play'), foot: R('.start-foot .linkrow'), card: R('.start-card'), chip: R('#rt-chip'), lang: R('.langsw'), vh: innerHeight, vw: innerWidth, sw: chip.scrollWidth, cw: chip.clientWidth, lh: parseFloat(getComputedStyle(chip).lineHeight) || 0 });
          const withChip = meas();
          chip.style.display = 'none'; const without = meas(); chip.style.display = '';
          return { withChip, without };
        });
        const a = m.withChip, b = m.without;
        const tag = `${vp.n} ${lang.toUpperCase()}`;
        const fits = a.chip && a.chip.l >= a.card.l - 0.5 && a.chip.r <= a.card.r + 0.5 && a.chip.b <= a.vh && a.chip.t >= 0 && a.sw <= a.cw + 1 && a.chip.h <= (vp.touch ? 46 : 34);
        check(`start chip fits (${tag}): inside card + viewport, one line, tap target ${vp.touch ? '>= 44' : 'small'}`, fits && (!vp.touch || a.chip.h >= 43.5), JSON.stringify({ chip: a.chip && [a.chip.l, a.chip.t, a.chip.w, a.chip.h].map(Math.round), vh: a.vh }));
        check(`start chip never pushes Play down (${tag}): Play top not lower than without the chip (a wrapped link row only re-centres the card upwards), LV/EN row and Play inside the viewport`, a.play.t <= b.play.t + 1 && a.foot.h <= b.foot.h + 46 && a.lang.b <= a.vh && a.play.b <= a.vh && (a.card.h <= a.vh), `play ${Math.round(a.play.t)}/${Math.round(b.play.t)} foot ${Math.round(a.foot.h)}/${Math.round(b.foot.h)} langBottom ${Math.round(a.lang.b)} vh ${a.vh}`);
        await page.close();
      }
    }
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Screenshots scripts/out/retention-*.png: desktop Chromium + real WebKit iPhone 13 + iPhone SE. */
export async function retentionShots(env) {
  const { chromium, webkit, devices, base, out, check, errors } = env;
  const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
  const cb = await chromium.launch({ headless: true, args: GPU });
  const wb = await webkit.launch({ headless: true });
  const profiles = [
    { name: 'desktop', b: cb, profile: { viewport: { width: 1280, height: 720 } }, lang: 'lv' },
    { name: 'iphone13', b: wb, profile: { ...devices['iPhone 13'] }, lang: 'lv' },
    { name: 'iphoneSE', b: wb, profile: { ...devices['iPhone SE'] }, lang: 'en' },
  ];
  try {
    for (const p of profiles) {
      const ctx = await p.b.newContext({ ...p.profile, timezoneId: 'Europe/Riga', locale: p.lang === 'lv' ? 'lv-LV' : 'en-GB' });
      await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      const seed = { [GK]: { v: 1, streak: { cur: 2, best: 5, last: '2026-11-17', freezes: 1, frozen: [] }, goals: { week: '2026-47', ids: ['pigeons25', 'transit30', 'daugava4'], prog: { pigeons25: { v: 20, h: 1 }, transit30: { v: 11 }, daugava4: { v: 2 } }, done: {}, all: false }, rewards: { 'streak-3': { d: '2026-11-10', s: 'streak' }, 'streak-7': { d: '2026-11-11', s: 'streak' }, 'week-2026-46-hard': { d: '2026-11-15', s: 'goal' }, 'week-2026-46-all': { d: '2026-11-15', s: 'goals' } } } };
      await ctx.addInitScript(({ now, lang, seed }) => {
        window.__metaAllowDebug = true; window.__retentionNow = now;
        try { if (!sessionStorage.getItem('rt-init')) { sessionStorage.setItem('rt-init', '1'); localStorage.setItem('bedre.lang', lang); localStorage.setItem('bedre.name', 'Tests'); localStorage.setItem('bedre.a2hs', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); } } catch { /* ignore */ }
      }, { now: at(D0, 18), lang: p.lang, seed });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`shots ${p.name} console: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`shots ${p.name} pageerror: ${e.message}`));
      await page.goto(`${base}/?quality=low&intro=0&radio=0&time=120&mode=classic`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => document.body.dataset.ready === '1' && window.__retention, null, { timeout: 180000 });
      await sleep(900);
      await page.screenshot({ path: path.join(out, `retention-start-${p.name}.png`) });
      // in play: finish the pigeons goal -> goal-complete toast
      await page.evaluate(() => { const g = window.__life.game; g.start(); g.skipIntro(); g.step(61); });
      await page.evaluate(() => {
        const g = window.__life.game, w = window.__life.world; g.player.setRadius(60);
        const pig = w.objects.filter((o) => o.kind === 'pigeon' && o.state === 0);
        for (const o of pig) { g.teleport(o.x, o.z); g.step(0.1); if (window.__retention.goals.liveValue(window.__retention.POOL.find((t) => t.id === 'pigeons25')) >= 25) break; }
        g.player.setRadius(8);
      });
      // the toast lane shows two at a time: achievements from the cheated radius go first, wait for the goal toast
      await page.waitForFunction(() => [...document.querySelectorAll('.meta-toast')].some((e) => /Nedēļas mērķis izpildīts|Weekly goal done/.test(e.textContent)), null, { timeout: 20000 }).catch(() => {});
      await sleep(500);
      await page.screenshot({ path: path.join(out, `retention-toast-${p.name}.png`) });
      const toast = await page.evaluate(() => [...document.querySelectorAll('.meta-toast')].map((e) => e.textContent).join('|'));
      check(`screenshot ${p.name}: goal-complete toast visible in play`, /Nedēļas mērķis izpildīts|Weekly goal done/.test(toast), toast);
      // swallow a few trams / buses on the way and finish -> results with streak line + goals advanced
      await page.evaluate(() => {
        const g = window.__life.game, w = window.__life.world; g.player.setRadius(40);
        const v = w.objects.filter((o) => ['tram', 'bus', 'trolleybus'].includes(o.kind) && o.state === 0).slice(0, 14);
        for (const o of v) { g.teleport(o.x, o.z); g.step(0.1); }
      });
      await sleep(300);
      await page.evaluate(() => window.__life.game.end());
      await sleep(1200);
      await page.screenshot({ path: path.join(out, `retention-results-${p.name}.png`) });
      const line = await page.locator('#rt-streak-line').innerText();
      check(`screenshot ${p.name}: results line "${line}" and goals advanced listed`, /3 (dienas|days) (pēc kārtas|in a row)/.test(line) && (await page.locator('#rt-round-goals .rc-chip').count()) >= 1, line);
      await page.click('#rtabs [data-rt=ach]'); await sleep(300);
      await page.screenshot({ path: path.join(out, `retention-results-goals-${p.name}.png`) });
      await page.evaluate(() => window.__meta.open('week')); await sleep(400);
      await page.screenshot({ path: path.join(out, `retention-panel-${p.name}.png`) });
      await ctx.close();
    }
  } finally { await cb.close().catch(() => {}); await wb.close().catch(() => {}); }
}
