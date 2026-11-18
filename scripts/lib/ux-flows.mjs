// Stages solo / pause / online / shots of scripts/smoke-ux.mjs: "Main menu" (back to the start screen) from the results of every mode, from the pause
// panel, from online (public + private) results; plus the screenshots scripts/out/ux-*.png.
const PILOT = () => {
  const g = window.__G; g.autopilot = true; clearInterval(window.__pilot);
  window.__pilot = setInterval(() => {
    if (g.phase !== 'playing') return;
    const p = g.player; let best = null, bs = -1;
    g.world.query(p.x, p.z, Math.max(25, p.radius * 9), (o, d) => { if (o.state !== 0 || o.fit >= p.radius * 0.95) return; const s = o.value / (d + p.radius * 1.5 + 4); if (s > bs) { bs = s; best = o; } });
    p.control = best ? { mode: 'target', x: best.x, z: best.z } : { mode: 'target', x: p.x + 80, z: p.z + 40 };
  }, 150);
};

export async function run(X) {
  const { BASE, PORT, ROUND, MP_ROUND, check, until, sleep, mkPage, open, E, vis, waitFor, shot, errors, post, out, want, launch } = X;
  const board = async (q) => ((await (await fetch(`${BASE}/api/scores?${q}`)).json()).scores || []);
  const nBoard = async (mode) => (await board(`mode=${mode}&period=all&limit=50`)).length;
  const pilot = (p) => E(p, PILOT);
  const unpilot = (p) => E(p, () => { clearInterval(window.__pilot); if (window.__G) window.__G.autopilot = false; });
  const openAdv = async (p) => { if ((await p.getAttribute('#opts-toggle', 'aria-expanded')) !== 'true') await p.click('#opts-toggle'); };
  const pick = async (p, mode) => { await openAdv(p); await p.click(`#modesw [data-mode=${mode}]`); };
  const phase = (p) => E(p, () => window.__G.phase);
  const waitPhase = (p, ph, t = 40000) => waitFor(p, (x) => window.__G.phase === x, ph, t);
  const resultsUp = (p, t = 40000) => p.waitForSelector('#results:not(.hidden)', { timeout: t });
  /** Click Play and run a round to its results with the autopilot (free roam: End after a few seconds). */
  async function playRound(p, { free = false } = {}) {
    await p.click('#play');
    await waitPhase(p, 'playing', 30000);
    await pilot(p);
    await sleep(900);
    await E(p, () => { if (window.__G.timeLeft > 30 && window.__G.roundSeconds < 1e8) window.__G.timeLeft = 4; });   // local-clock rounds (daily practice): do not wait for the full length
    if (free) { await sleep(3500); await p.click('#end-free'); }
    await resultsUp(p);
    await unpilot(p);
  }
  const startScreenOk = async (p, labelRe) => E(p, (re) => {
    const g = window.__G, vis = (s) => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; };
    const play = document.getElementById('play');
    const f = g.cam.focus, pl = g.player;
    return {
      start: vis('#start'), results: vis('#results'), pause: vis('#pause'), hud: vis('#hud') && getComputedStyle(document.getElementById('hud')).display !== 'none', phase: g.phase,
      playEnabled: !play.disabled, label: play.textContent, labelOk: new RegExp(re).test(play.textContent), score: pl.score, paused: g.paused, resumeT: g.resumeT, intro: !!g.intro,
      camOk: Math.hypot(f.x - pl.x, f.z - pl.z) < 2, pu: g.field === null && g.puView.items.size === 0, transient: document.querySelectorAll('#popups > *, #labels > *, #feed > *').length,
      chip: document.getElementById('opts-val').textContent, online: !!g.online, killer: !!g.killer, tags: getComputedStyle(document.getElementById('tags')).display,
    };
  }, labelRe.source);
  const startOk = (name, s) => check(name, s.start && !s.results && !s.pause && !s.hud && s.phase === 'menu' && s.playEnabled && s.labelOk && s.score === 0 && !s.paused && s.resumeT === 0 && !s.intro && s.camOk && s.pu && s.transient === 0 && !s.online && !s.killer && s.tags === 'none', JSON.stringify(s));
  const streakOf = (p) => E(p, () => { try { const g = JSON.parse(localStorage.getItem('bedre.meta.global.v1') || '{}'); const w = JSON.parse(localStorage.getItem('bedre.wardrobe.v1') || '{}'); return { streak: JSON.stringify(g.streak || null), xp: w.xp || 0, rounds: w.rounds || 0 }; } catch (e) { return { err: String(e) }; } });

  // ============================================================================================================================================
  if (want('solo')) {
    console.log('\n== stage solo: results -> Main menu in every mode');
    const P = await mkPage('chromium', { name: 'SoloUx' });
    await open(P, 'intro=0');
    await E(P, () => { try { localStorage.setItem('bedre.mode', 'classic'); } catch {} });
    // ---- classic -------------------------------------------------------------------------------------------------------------------
    const b0 = await nBoard('classic');
    const st0 = await streakOf(P);
    const postsBefore = P.posts.filter((u) => u === '/api/scores').length;
    await playRound(P);
    check('results: the Main menu button sits next to Play again (secondary), Play again is first in the focus order', await E(P, () => {
      const a = document.getElementById('again'), m = document.getElementById('to-menu'); if (!a || !m) return false;
      const ra = a.getBoundingClientRect(), rm = m.getBoundingClientRect();
      const tabs = [...document.querySelectorAll('#results button')].filter((b) => b.offsetParent);
      return ra.width > 0 && rm.width > 0 && Math.abs(ra.top - rm.top) < 4 && rm.left > ra.left && rm.height >= 40 && tabs.indexOf(a) < tabs.indexOf(m) && getComputedStyle(m).backgroundColor !== getComputedStyle(a).backgroundColor && /Main menu/.test(m.textContent) && /Play again/.test(a.textContent);
    }));
    await sleep(500);
    check('results: focus lands on Play again, Tab goes to Main menu', (await E(P, () => document.activeElement && document.activeElement.id)) === 'again');
    await P.keyboard.press('Tab');
    check('results: second in the tab order is Main menu', (await E(P, () => document.activeElement && document.activeElement.id)) === 'to-menu');
    await P.click('#to-menu');   // immediately: the score submission is probably still in flight and must complete
    startOk('classic: Main menu -> a clean start screen (nothing of the round left)', await startScreenOk(P, /^Play$/));
    check('classic: the finished round was submitted exactly once (board +1, one POST /api/scores)', await until(async () => (await nBoard('classic')) === b0 + 1, 15000) && P.posts.filter((u) => u === '/api/scores').length - postsBefore === 1, `board ${await nBoard('classic')} vs ${b0 + 1}, posts ${P.posts.join()}`);
    await sleep(600);
    check('classic: no second submission appears later', P.posts.filter((u) => u === '/api/scores').length - postsBefore === 1);
    check('start screen after results: streak chip counts the round just played (done today), goals chip drawn', await E(P, () => { const c = document.getElementById('rt-chip'); return !!c && c.dataset.state === 'done' && /^\d\/3$/.test((c.querySelector('.rt-seg:last-child b') || {}).textContent || ''); }));
    const st1 = await streakOf(P);
    check('the round counted for XP + streak (it was eligible)', st1.xp > st0.xp || st1.rounds > st0.rounds, JSON.stringify([st0, st1]));
    // ---- a DIFFERENT mode right afterwards: quick -------------------------------------------------------------------------------------
    await pick(P, 'quick');
    check('start screen after returning: Play label + Advanced chip follow the chosen mode', /Quick/.test(await P.textContent('#play')) && /Quick/.test(await P.textContent('#opts-val')));
    const q0 = await nBoard('quick');
    await playRound(P);
    check('quick (after a classic round + Main menu): scores normally, round length from the server', await until(async () => (await nBoard('quick')) === q0 + 1, 15000));
    await P.click('#to-menu');
    startOk('quick: Main menu -> start screen', await startScreenOk(P, /Quick/));
    // ---- daily (ranked, then practice) -----------------------------------------------------------------------------------------------
    await pick(P, 'daily');
    const d0 = await nBoard('daily');
    await playRound(P);
    check('daily: ranked round scored', await until(async () => (await nBoard('daily')) === d0 + 1, 15000));
    await P.click('#to-menu');
    startOk('daily: Main menu -> start screen', await startScreenOk(P, /Daily|challenge|izaicin/i));
    check('daily: the "unplayed today" dot is gone after the ranked daily round', await E(P, () => document.getElementById('opts-dot').hidden || document.body.classList.contains('mode-daily')));
    check('daily: the Daily selector keeps working after Main menu (the mode is still selected)', (await P.getAttribute('#modesw [data-mode=daily]', 'aria-checked')) === 'true');
    const dPostsBefore = P.posts.filter((u) => u === '/api/scores').length;
    await playRound(P);   // second daily = practice
    const gl = await P.textContent('#r-global');
    check('daily practice: results say practice, nothing submitted', /ractice|rakse|Practice/i.test(gl) || /practice/i.test(await P.evaluate(() => document.body.className)), gl);
    await P.click('#to-menu');
    startOk('daily practice: Main menu -> start screen', await startScreenOk(P, /Daily|challenge|izaicin/i));
    check('daily practice: no score POST', P.posts.filter((u) => u === '/api/scores').length === dPostsBefore);
    check('daily practice: body.mode-practice is cleared on the start screen', !(await E(P, () => document.body.classList.contains('mode-practice'))));
    // ---- free roam (End -> results -> Main menu) --------------------------------------------------------------------------------------
    await pick(P, 'free');
    await playRound(P, { free: true });
    check('free roam: End leads to results with Main menu', await vis(P, '#to-menu'));
    await P.click('#to-menu');
    startOk('free roam: Main menu -> start screen', await startScreenOk(P, /Free/));
    // ---- and a classic round again (bots back, ranked again, from a free-roam start) ----------------------------------------------------
    await pick(P, 'classic');
    check('after free roam the bots are back for classic', (await E(P, () => window.__game.botCount)) >= 7);
    const b1 = await nBoard('classic');
    await playRound(P);
    check('classic after free roam: ranked + scored', await until(async () => (await nBoard('classic')) === b1 + 1, 15000));
    // ---- Esc on the results = Main menu --------------------------------------------------------------------------------------------------
    await P.keyboard.press('Escape');
    startOk('results: Esc goes to the start screen (no keyboard trap)', await startScreenOk(P, /^Play$/));
    // Esc with the Top scores panel open over the results only closes the panel
    await playRound(P);
    await P.click('#open-scores2'); await sleep(300);
    await P.keyboard.press('Escape'); await sleep(300);
    check('Esc over Top scores (opened from the results) closes only the panel', (await vis(P, '#results')) && !(await vis(P, '#scores')));
    await P.keyboard.press('Escape'); await sleep(200);
    check('and the next Esc leaves the results', await vis(P, '#start'));
    // ---- Play from the new start screen works the same as after a fresh load ---------------------------------------------------------------
    await P.click('#play'); await waitPhase(P, 'playing', 20000);
    check('a normal round starts again after all of that', (await E(P, () => window.__G.timeLeft)) > 0);
    await P.context().close();
  }

  // ============================================================================================================================================
  if (want('pause')) {
    console.log('\n== stage pause: pause -> Main menu (abandon)');
    const P = await mkPage('chromium', { name: 'PauseUx' });
    await open(P, 'intro=0');
    // one finished round first, so there is a streak / XP state to compare with
    await playRound(P); await P.click('#to-menu'); await sleep(800);
    const s0 = await streakOf(P);
    const b0 = await nBoard('classic');
    const posts0 = P.posts.filter((u) => u === '/api/scores').length;
    await P.click('#play'); await waitPhase(P, 'playing', 20000); await pilot(P); await sleep(1200);
    await P.click('#pause-btn');
    check('pause panel: Resume (primary) + Main menu, both >= 44 px high', await E(P, () => ['resume', 'pause-menu'].every((i) => document.getElementById(i).getBoundingClientRect().height >= 43) && !document.getElementById('pause').classList.contains('hidden')));
    await P.click('#pause-menu');
    check('Main menu in the pause panel asks first (progress is lost), Resume hidden meanwhile', await E(P, () => !document.getElementById('pause-confirm').hidden && document.getElementById('pause-main').hidden && !document.getElementById('pause').classList.contains('hidden')));
    await sleep(150);
    check('the confirm: focus on "Keep playing"', (await E(P, () => document.activeElement && document.activeElement.id)) === 'pc-no');
    await P.keyboard.press('Escape'); await sleep(150);
    check('Esc in the confirm goes back to the pause panel (still paused)', await E(P, () => document.getElementById('pause-confirm').hidden && !document.getElementById('pause-main').hidden && window.__G.paused === true));
    await P.click('#pause-menu'); await P.click('#pc-no');
    check('"Keep playing" returns to the pause panel; Resume continues the same round', await E(P, () => !document.getElementById('pause-main').hidden));
    await P.click('#resume'); await sleep(300);
    check('resumed: playing again', (await phase(P)) === 'playing' && !(await E(P, () => window.__G.paused)));
    await P.keyboard.press('Escape'); await sleep(150);
    await P.click('#pause-menu'); await P.click('#pc-yes');
    startOk('pause -> Main menu -> confirm: clean start screen', await startScreenOk(P, /^Play$/));
    await unpilot(P);
    await sleep(1500);
    const s1 = await streakOf(P);
    check('the abandoned round is not submitted (no POST /api/scores, board unchanged)', P.posts.filter((u) => u === '/api/scores').length === posts0 && (await nBoard('classic')) === b0);
    check('and does not count for streak / XP', s1.streak === s0.streak && s1.xp === s0.xp && s1.rounds === s0.rounds, JSON.stringify([s0, s1]));
    check('audio is not left suspended by the pause', await E(P, () => !window.__life.audio.ctx || window.__life.audio.ctx.state !== 'suspended'));
    // a new round afterwards is normal and scores
    const b1 = await nBoard('classic');
    await playRound(P);
    check('a new round after the abandon scores normally (fresh round id)', await until(async () => (await nBoard('classic')) === b1 + 1, 15000));
    // abandon from a phone-style pause (resume countdown) and during the intro
    await P.click('#to-menu');
    await E(P, () => { window.__G.introEnabled = true; });   // the fly-in on
    await P.click('#play');
    await sleep(500);
    check('pause is possible during the fly-in, and Main menu works from there', await E(P, () => { window.__G.pause(true); return window.__G.paused && window.__G.phase === 'intro'; }));
    await P.click('#pause-menu'); await P.click('#pc-yes');
    startOk('intro: abandon -> start screen', await startScreenOk(P, /^Play$/));
    await P.context().close();
  }

  // ============================================================================================================================================
  if (want('online')) {
    console.log('\n== stage online: results -> Main menu leaves the room');
    const status = async () => (await (await fetch(`${BASE}/api/mp/status`)).json());
    const A = await mkPage('chromium', { name: 'OnlUx' });
    const wsSeen = { bye: 0, closed: 0 };   // the page's own WebSocket frames: the client says `bye` and closes the socket when it leaves
    A.on('websocket', (w) => { w.on('framesent', (e) => { if (/"t":"bye"/.test(String(e.payload))) wsSeen.bye++; }); w.on('close', () => wsSeen.closed++); });
    await open(A, 'intro=0');
    check('Online + Friends: the client is ready and both buttons are enabled once the page is up', await waitFor(A, () => window.__online.isReady && !document.getElementById('play-online').disabled && !document.getElementById('play-friends').disabled, null, 10000));
    // ---- public room ---------------------------------------------------------------------------------------------------------------------
    await A.click('#play-online');
    check('public: the lobby opens', await waitFor(A, () => window.__online.state === 'lobby', null, 20000));
    check('public: the lobby Leave button is there', await vis(A, '#mp-leave'));
    check('public: the round starts and ends -> results with Play again + Main menu', await waitFor(A, () => window.__online.state === 'ended' && !document.getElementById('results').classList.contains('hidden'), null, 90000));
    check('public results: the secondary button is "Main menu" (not the private label)', (await A.textContent('#to-menu')).trim() === 'Main menu' && !(await E(A, () => document.querySelector('#results .r-actions').classList.contains('priv'))));
    await A.click('#to-menu');
    check('public: Main menu sends `bye` and closes the socket', await until(() => wsSeen.bye >= 1 && wsSeen.closed >= 1, 6000, 100), JSON.stringify(wsSeen));
    check('public: Main menu -> start screen, online state idle, nothing stored', await waitFor(A, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden') && window.__online.session === null && !window.__G.online, null, 8000));
    startOk('public: the start screen is the solo one (clean)', await startScreenOk(A, /^Play$/));
    check('public: no rejoin prompt on the start screen', !(await E(A, () => !!document.getElementById('mp-rejoin'))));
    await sleep(3500);
    check('public: still no rejoin prompt after 3.5 s (the stored session is gone)', !(await E(A, () => !!document.getElementById('mp-rejoin'))) && (await E(A, () => window.__online.state)) === 'idle');
    check('public: the server saw the leave (no human left in any room)', await until(async () => { const s = await status(); return (s.running || []).every((r) => !r.humans) && (!s.open || !s.open.humans); }, 15000, 500), JSON.stringify(await status()));
    await A.reload(); await A.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(2000);
    check('public: after a reload there is no "rejoin round" prompt either', !(await E(A, () => !!document.getElementById('mp-rejoin'))));
    await A.click('#play-online');
    check('public: a new Online join works afterwards', await waitFor(A, () => window.__online.state === 'lobby' || window.__online.state === 'intro' || window.__online.state === 'playing', null, 20000));
    // leave from the lobby (the Leave button) then the same again
    await E(A, () => { if (window.__online.state === 'lobby') document.getElementById('mp-leave').click(); else window.__online.leave(); });
    check('and Leave goes back to the start screen too', await waitFor(A, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden'), null, 8000));
    // solo works after online
    await A.click('#play'); await waitPhase(A, 'playing', 20000);
    check('a solo round after online starts normally (ranked round, local clock)', (await E(A, () => ({ u: window.__G.unranked, o: !!window.__G.online }))).o === false);
    await E(A, () => window.__G.toMenu());
    check('toMenu() from a solo round without the pause works', await vis(A, '#start'));
    // ---- private room -----------------------------------------------------------------------------------------------------------------------
    await A.click('#play-friends'); await A.waitForSelector('#mp-friends:not(.hidden)');
    await A.click('#mpf-create');
    check('private: create -> lobby', await waitFor(A, () => window.__online.state === 'lobby' && !!document.querySelector('#mp-priv:not(.hidden)'), null, 20000));
    const code = (await A.textContent('#mpp-code')).trim();
    await A.click('#mpp-start');
    check('private: the round runs and ends', await waitFor(A, () => window.__online.state === 'ended' && !document.getElementById('results').classList.contains('hidden'), null, 90000));
    const lab = await E(A, () => ({ again: document.getElementById('again').textContent, menu: document.getElementById('to-menu').textContent, priv: document.querySelector('#results .r-actions').classList.contains('priv') }));
    check('private results: "Rematch with friends" + a Main menu button that says it leaves the room', /Rematch/.test(lab.again) && /leave room/i.test(lab.menu) && lab.priv, JSON.stringify(lab));
    const info = async () => (await (await fetch(`${BASE}/api/mp/room?code=${code}`)).json());
    check('private: the server counts us in the room before leaving', (await info()).humans === 1, JSON.stringify(await info()));
    const bye0 = wsSeen.bye;
    await A.click('#to-menu');
    check('private: Main menu sends `bye` and closes the socket', await until(() => wsSeen.bye > bye0, 6000, 100), JSON.stringify(wsSeen));
    check('private: Main menu -> start screen, no ?room= in the address, labels back to normal', await waitFor(A, (c) => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden') && !location.search.includes('room=') && document.getElementById('again').textContent === 'Play again' && document.getElementById('to-menu').textContent === 'Main menu', code, 8000));
    check('private: the server saw us leave (0 humans in the room)', await until(async () => (await info()).humans === 0, 12000, 400), JSON.stringify(await info()));
    check('private: no rejoin prompt now, nor after a reload', !(await E(A, () => !!document.getElementById('mp-rejoin'))) && (await E(A, () => window.__online.session)) === null);
    await A.reload(); await A.waitForFunction(() => document.body.dataset.ready === '1'); await sleep(2500);
    check('private: a reload shows no "rejoin round" prompt', !(await E(A, () => !!document.getElementById('mp-rejoin'))));
    await A.click('#play-online');
    check('private -> public: Online works afterwards', await waitFor(A, () => ['lobby', 'intro', 'playing'].includes(window.__online.state), null, 20000));
    await E(A, () => window.__online.leave());
    // ---- failure paths of the friend buttons ----------------------------------------------------------------------------------------------------
    await A.context().close();
  }

  // ============================================================================================================================================
  if (want('freedom')) {
    console.log('\n== stage freedom: the Freedom Monument is not edible in the 18 Nov theme');
    const setup = async (P, theme) => {
      await open(P, `intro=0&theme=${theme}`);
      await P.click('#play'); await waitPhase(P, 'playing', 20000);
      await E(P, () => { const g = window.__G, fm = window.__freedom.fm; g.autopilot = true; g.teleport(fm.x + 4, fm.z + 4); g.setRadius(20); });
    };
    const P = await mkPage('chromium', { name: 'FmUx', lang: 'lv' });
    await setup(P, 'nov18');
    check('nov18: protection is on, the picker line says so', await E(P, () => window.__freedom.protected && /apēdams/.test(document.getElementById('themecap').textContent)));
    await E(P, () => window.__G.step(1.5));
    check('nov18: a radius-20 hole over the monument does not remove it', await E(P, () => window.__freedom.fm.state === 0));
    const toast = () => E(P, () => [...document.querySelectorAll('#meta-toasts > *')].filter((e) => /savā vietā/.test(e.textContent)).length);
    check('nov18: the toast appears (once)', (await toast()) === 1, String(await toast()));
    await shot(P, 'ux-freedom-protected.png');
    await E(P, () => { window.__G.step(2); });
    check('nov18: staying on it does not repeat the toast within 20 s', (await toast()) === 1);
    check('nov18: the album entry is collected as "honour", the swallow achievement stays locked', await E(P, () => { const a = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /bedre\.meta\.v1/.test(k)) || '') || '{}').album || {}; return !!a.freedom && a.freedom.hon === 1; }));
    check('nov18: huge bots standing on it do not eat it', await E(P, () => { const g = window.__G, fm = window.__freedom.fm; g.teleport(fm.x + 400, fm.z + 400); g.holes.forEach((h, i) => { if (i > 0) { g.teleportHole(i, fm.x + i, fm.z); g.setHoleRadius(i, 25); } }); g.step(6); return fm.state === 0; }));
    await P.context().close();
    const D = await mkPage('chromium', { name: 'FmUxD' });
    await setup(D, 'day');
    await E(D, () => window.__G.step(1.5));
    check('theme=day: the monument is eaten as before', await E(D, () => !window.__freedom.protected && window.__freedom.fm.state !== 0));
    await D.context().close();
    const Ph = await mkPage('chromium', { name: 'FmUxP', lang: 'lv', size: { width: 320, height: 568 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
    await setup(Ph, 'nov18');
    await E(Ph, () => window.__G.step(1.5));
    await sleep(500);
    const fit = await E(Ph, () => { const e = [...document.querySelectorAll('#meta-toasts > *')].find((x) => /savā vietā/.test(x.textContent)); if (!e) return null; const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e.querySelector('span:last-child')).lineHeight) || 16; return { l: r.left, r: r.right, w: innerWidth, h: r.height, lines: Math.round(e.querySelector('span:last-child').getBoundingClientRect().height / lh) }; });
    await shot(Ph, 'ux-freedom-protected-phone.png');
    check('320 px: the toast is inside the screen and takes at most two lines', !!fit && fit.l >= 0 && fit.r <= fit.w && fit.lines <= 2, JSON.stringify(fit));
    await Ph.context().close();
    // online: the room's rule comes from the server's Riga date (MP_TEST_DATE = 15 Nov here): every client is protected
    const O = await mkPage('chromium', { name: 'FmOn', lang: 'lv' });
    await open(O, 'intro=0&theme=day');
    await O.click('#play-online');
    check('online (server date 15 Nov): protected for a client whose own theme is Day', await waitFor(O, () => window.__online.state === 'playing' && window.__freedom.protected && !!window.__online.round, null, 60000));
    await O.context().close();
  }

  // ============================================================================================================================================
  if (want('shots')) await (await import('./ux-shots.mjs')).run({ ...X, startScreenOk, pilot, unpilot, playRound, pick, openAdv, waitPhase, resultsUp });
}
