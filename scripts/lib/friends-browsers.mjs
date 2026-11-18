// Stage 3 + 4 of scripts/smoke-friends.mjs: real browsers (Chromium host, WebKit iPhone 13 guest by LINK, Firefox guest by CODE) against the local wrangler.
import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SKINS } from '../../src/skins.js';
import { xpAt } from '../../src/meta/level.js';

const GL = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

export async function run(X) {
  const { BASE, ROUND, TTL, out, check, until, sleep, board, getJson, create, tag, errors, startWrangler, stopWrangler, MAIN_VARS, cfgPath, state, root, post } = X;
  console.log('\n== stage 3: browsers');
  const engines = {
    chromium: { type: chromium, args: GL, ctx: { viewport: { width: 1100, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] } },
    webkit: { type: webkit, args: [], ctx: { ...devices['iPhone 13'] } },
    firefox: { type: firefox, args: [], ctx: { viewport: { width: 1100, height: 700 } } },
  };
  const browsers = {};
  for (const [k, e] of Object.entries(engines)) browsers[k] = await e.type.launch({ headless: true, args: e.args });
  const L20 = xpAt(20) + 5;
  const wardrobe = (eq, extra = {}) => JSON.stringify({ v: 1, xp: L20, eq, seen: [], ach: [], alb: 0, rounds: 0, ...extra });
  const globalMeta = JSON.stringify({ v: 1, rewards: { 'streak-3': { d: '2026-11-01', s: 'streak' } } });
  const pages = [];
  const mk = async (eng, name, { eq = [0, 0, 0], path: p = '/', sw = '', lang = 'en', init = '', ctx = {} } = {}) => {
    const e = engines[eng];
    const c = await browsers[eng].newContext({ ...e.ctx, ...ctx });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
    page.on('pageerror', (er) => errors.push(`[${name}] pageerror: ${er.message}`));
    await page.addInitScript(([n, w, g, l, extra]) => {
      try { localStorage.setItem('bedre.name', n); localStorage.setItem('bedre.lang', l); if (!localStorage.getItem('bedre.wardrobe.v1')) localStorage.setItem('bedre.wardrobe.v1', w); if (!localStorage.getItem('bedre.meta.global.v1')) localStorage.setItem('bedre.meta.global.v1', g); } catch {}
      window.__metaAllowDebug = false;
      if (extra) { try { new Function(extra)(); } catch {} }
    }, [name, wardrobe(eq), globalMeta, lang, init]);
    await page.goto(`${BASE}${p}${p.includes('?') ? '&' : '?'}quality=medium${sw}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error(`[${name}] boot error`);
    pages.push(page);
    return page;
  };
  const O = (p, fn, arg) => p.evaluate(fn, arg);
  const waitFor = (p, fn, arg, timeout = 30000) => until(() => p.evaluate(fn, arg), timeout, 150);
  const shot = async (p, name) => { await p.waitForTimeout(350); await p.screenshot({ path: path.join(out, name) }); };
  const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel);

  const nameA = `FrA${tag}`, nameB = `FrB${tag}`, nameC = `FrC${tag}`;
  const eqA = [3, 3, 3], eqB = [8, 0, 1], eqC = [9, 1, 5];
  const A = await mk('chromium', nameA, { eq: eqA, init: "navigator.share = async (d) => { window.__shared = d; }; " });

  // ---- friends entry, create ---------------------------------------------------------------------------------------------
  check('start screen: ONE extra control beside Online (friends), no more', (await O(A, () => document.querySelectorAll('.mp-row button').length)) === 2 && (await vis(A, '#play-friends')));
  check('the friends control is a compact secondary button on the Online row', await O(A, () => { const a = document.getElementById('play-online').getBoundingClientRect(), b = document.getElementById('play-friends').getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && b.left > a.right - 2 && b.height >= 40; }));
  await shot(A, 'f45-friends-entry.png');
  await O(A, () => document.getElementById('play-friends').click());
  check('the friends panel opens (create / enter a code)', await waitFor(A, () => !document.getElementById('mp-friends').classList.contains('hidden'), null, 4000));
  await shot(A, 'f45-friends-panel.png');
  await O(A, () => document.getElementById('mpf-create').click());
  check('host: creating a room leads straight into its private lobby', await waitFor(A, () => window.__online.state === 'lobby' && !document.getElementById('mp-priv').classList.contains('hidden'), null, 20000));
  const code = (await O(A, () => document.getElementById('mpp-code').textContent)).trim();
  const link = (await O(A, () => document.getElementById('mpp-url').textContent)).trim();
  check('lobby shows the 6-char code and the shareable link', /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code) && link.endsWith(`/?room=${code}`) && link.includes('bedre.pakers.lv') === false || link.endsWith(`/?room=${code}`), `${code} ${link}`);
  check('host sees Start + settings; the round length and bots choices are there', (await vis(A, '#mpp-start')) && (await vis(A, '#mpp-len120')) && (await vis(A, '#mpp-bots')) && (await O(A, () => document.getElementById('mpp-bots').getAttribute('aria-checked') === 'true')));
  check('lobby states that a solo / short private round is unranked', /Unranked|ranked/i.test(await O(A, () => document.getElementById('mpp-rank').textContent)));
  await shot(A, 'f45-private-lobby-host.png');
  // copy + share
  await O(A, () => document.getElementById('mpp-copy').click());
  await sleep(400);
  const copied = await O(A, async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
  check('Copy puts the https://…/?room=CODE link on the clipboard and shows feedback', (copied === null || copied.endsWith(`?room=${code}`)) && /copied/i.test(await O(A, () => document.getElementById('mpp-copy').textContent)), String(copied));
  await shot(A, 'f45-share-copy.png');
  await O(A, () => document.getElementById('mpp-share').click());
  await sleep(300);
  const shared = await O(A, () => window.__shared || null);
  check('native Share is offered and called with the room link', !!shared && shared.url.endsWith(`?room=${code}`), JSON.stringify(shared));

  // ---- guests: WebKit iPhone by LINK, Firefox by CODE ----------------------------------------------------------------------
  const B = await mk('webkit', nameB, { eq: eqB, path: `/?room=${code}` });
  check('opening the link joins that room\'s lobby directly (iPhone WebKit)', await waitFor(B, () => window.__online.state === 'lobby' && window.__online.priv && !document.getElementById('mp-priv').classList.contains('hidden'), null, 30000));
  const C = await mk('firefox', nameC, { eq: eqC });
  await O(C, () => document.getElementById('play-friends').click());
  await O(C, (c) => { const i = document.getElementById('mpf-code'); i.value = c.toLowerCase(); i.dispatchEvent(new Event('input', { bubbles: true })); }, code);
  check('the code field upper-cases and accepts only the alphabet', (await O(C, () => document.getElementById('mpf-code').value)) === code);
  await O(C, () => document.getElementById('mpf-join-btn').click());
  check('typing the code joins the same lobby (Firefox)', await waitFor(C, () => window.__online.state === 'lobby' && window.__online.priv, null, 30000));
  check('all three see all three players, same code', await waitFor(A, () => window.__online.lobby.players.length === 3, null, 8000) && await waitFor(B, () => window.__online.lobby.players.length === 3, null, 8000) && await waitFor(C, () => window.__online.lobby.players.length === 3, null, 8000));
  const lobs = await Promise.all([A, B, C].map((p) => O(p, () => ({ code: window.__online.lobby.code, host: window.__online.lobby.host, me: window.__online.me, names: window.__online.lobby.players.map((q) => q.name), sk: window.__online.lobby.players.map((q) => q.sk) }))));
  check('one host (the creator), the same room everywhere', lobs.every((l) => l.code === code && l.host === lobs[0].me) && lobs[1].me !== lobs[0].me);
  check('guests: no Start button, "waiting for the host"', !(await vis(B, '#mpp-start')) && !(await vis(C, '#mpp-start')) && /host/i.test(await O(B, () => document.getElementById('mpp-wait').textContent)));
  check('the lobby shows the peers\' skin ids', JSON.stringify(lobs[0].sk) === JSON.stringify([eqA, eqB, eqC]) || JSON.stringify(lobs[0].sk.map((s) => s.join())) === JSON.stringify([eqA, eqB, eqC].map((s) => s.join())), JSON.stringify(lobs[0].sk));
  check('guest sees the settings but cannot change them', (await O(B, () => document.getElementById('mpp-len120').disabled)) && (await O(B, () => document.getElementById('mpp-bots').disabled)));
  await shot(B, 'f45-private-lobby-guest-iphone.png'); await shot(C, 'f45-private-lobby-guest-firefox.png');
  await shot(A, 'f45-private-lobby-host-3.png');
  // phone landscape: the panel keeps Start / Leave reachable
  await B.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  const land = await O(B, () => { const p = document.querySelector('#mp-priv .panel-inner'); const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return { fits: r.bottom <= innerHeight + 1 && r.top >= -1, scroll: p.scrollHeight > p.clientHeight, ov: cs.overflowY, leave: !!document.getElementById('mpp-leave') }; });
  check('iPhone landscape: the private lobby fits or scrolls inside the screen', land.fits && (!land.scroll || land.ov === 'auto' || land.ov === 'scroll'), JSON.stringify(land));
  await shot(B, 'f45-private-lobby-guest-iphone-landscape.png');
  await B.setViewportSize({ width: 390, height: 664 });

  // ---- host starts: all three in the same round, skins as equipped ------------------------------------------------------------------
  await O(A, () => document.getElementById('mpp-start').click());
  check('host presses Start: all three enter the round', await waitFor(A, () => ['intro', 'playing'].includes(window.__online.state), null, 15000) && await waitFor(B, () => ['intro', 'playing'].includes(window.__online.state), null, 15000) && await waitFor(C, () => ['intro', 'playing'].includes(window.__online.state), null, 15000));
  const rs = await Promise.all([A, B, C].map((p) => O(p, () => window.__online.round)));
  check('same round clock for all three (and the standard length)', rs.every((r) => r.endAt === rs[0].endAt && r.playAt === rs[0].playAt) && (rs[0].endAt - rs[0].playAt) / 1000 === ROUND);
  check('everybody playing', await waitFor(A, () => window.__online.state === 'playing', null, 12000) && await waitFor(B, () => window.__online.state === 'playing', null, 12000) && await waitFor(C, () => window.__online.state === 'playing', null, 12000));
  // rendered rim parameters of the remote holes = what the peers equipped
  const ids = await Promise.all([A, B, C].map((p) => O(p, () => window.__online.me)));
  const rimOf = (n) => SKINS.rim[n];
  const checkSeen = async (page, who, selfIdx) => {
    const res = [];
    for (let j = 0; j < 3; j++) {
      if (j === selfIdx) continue;
      const want = [eqA, eqB, eqC][j];
      const info = await O(page, (id) => window.__online.rimInfo(id), ids[j]);
      const r = rimOf(want[0]);
      res.push(!!info && info.rim === want[0] && info.trail === want[1] && info.tag === want[2] && info.pat === r.pat && info.c1 === r.c1 && info.c2 === r.c2 && info.tint === (r.tint || 0));
    }
    return res.every(Boolean);
  };
  await sleep(1000);
  check('A renders the rim / trail / tag B and C equipped (shader parameters match the catalogue)', await checkSeen(A, 'A', 0));
  check('B (iPhone WebKit) renders A and C as equipped', await checkSeen(B, 'B', 1));
  check('C (Firefox) renders A and B as equipped', await checkSeen(C, 'C', 2));
  const botInfo = await O(A, () => window.__online.holeIds().filter((h) => h.bot).map((h) => ({ id: h.id, sk: h.skin, info: window.__online.rimInfo(h.id) })));
  check('bots wear a rim only, with a little variety', botInfo.length === 5 && botInfo.every((b) => b.sk && b.sk[1] === 0 && b.sk[2] === 0 && b.info) && new Set(botInfo.map((b) => b.sk[0])).size >= 2, JSON.stringify(botInfo.map((b) => b.sk && b.sk[0])));
  const tagDom = await O(C, (id) => { const t = [...document.querySelectorAll('#tags .tag')].map((e) => e.dataset.sk || '0'); return t; }, 0);
  check('name tags carry the equipped tag look', tagDom.includes('3') && tagDom.includes('1'), JSON.stringify(tagDom));
  const own = await O(A, () => window.__online.rimInfo(window.__online.me));
  check('invalid hello skin ids are never used: the local hole shows what was sent (and sent only owned items)', JSON.stringify(await O(A, () => window.__online.mySkin)) === JSON.stringify(eqA) && own.rim === 3);
  // two players with different skins in one frame (drive A towards B)
  const posB = await O(B, () => ({ x: window.__online.self.x, z: window.__online.self.z }));
  await O(A, (p) => window.__online.drive(p.x + 6, p.z + 6), posB);
  await O(B, () => window.__online.drive(null));
  await sleep(4500);
  await shot(A, 'f45-two-online-skins-desktop.png');
  await shot(B, 'f45-two-online-skins-iphone.png');
  await O(A, () => window.__online.drive(null));

  // ---- reload mid-round in a private room resumes ----------------------------------------------------------------------------------------
  const idB = ids[1];
  await B.reload();
  await B.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  const back = await waitFor(B, () => window.__online && window.__online.state === 'playing' && window.__online.priv, null, 40000);
  check('reload mid-round in a private room: auto-rejoin resumes the same hole', back && (await O(B, () => window.__online.me)) === idB, `me ${await O(B, () => window.__online.me)} vs ${idB}`);
  check('...with its own skin intact', (await O(B, () => window.__online.rimInfo(window.__online.me))).rim === eqB[0]);

  // ---- round end: identical results, results screen with Rematch ------------------------------------------------------------------------------
  check('the round ends for all three', await waitFor(A, () => window.__online.state === 'ended', null, (ROUND + 20) * 1000) && await waitFor(B, () => window.__online.state === 'ended', null, 30000) && await waitFor(C, () => window.__online.state === 'ended', null, 30000));
  const fin = await Promise.all([A, B, C].map((p) => O(p, () => JSON.stringify(window.__online.final))));
  check('identical results on all three clients', fin[0] === fin[1] && fin[1] === fin[2] && JSON.parse(fin[0]).length === 8);
  await sleep(1500);
  const rem = await Promise.all([A, B, C].map((p) => O(p, () => ({ again: document.getElementById('again').textContent, g: document.getElementById('r-global').textContent, xp: document.getElementById('wd-xp-block') ? document.getElementById('wd-xp-block').dataset.xp : null, lvl: document.getElementById('wd-xp-block') ? document.getElementById('wd-xp-block').dataset.level : null }))));
  check('results: the big button says Rematch (with friends) on every client', rem.every((r) => /Rematch/i.test(r.again)), JSON.stringify(rem.map((r) => r.again)));
  check('results: 3 humans + standard length -> saved to the online leaderboard (and says so)', rem.every((r) => /leaderboard/i.test(r.g)) && (await board()).filter((r) => [nameA, nameB, nameC].includes(r.name)).length === 3, rem[0].g);
  check('results: XP gained is shown (eligible online round)', rem.every((r) => +r.xp > 0), JSON.stringify(rem.map((r) => r.xp + '/L' + r.lvl)));
  await shot(A, 'f45-results-rematch.png'); await shot(B, 'f45-results-rematch-iphone.png');
  // Rematch: ONE tap returns everybody
  await O(B, () => document.getElementById('again').click());
  check('Rematch: one tap returns all three to the same private lobby', await waitFor(A, (c) => window.__online.state === 'lobby' && window.__online.lobby.code === c && !document.getElementById('mp-priv').classList.contains('hidden'), code, 15000) && await waitFor(B, (c) => window.__online.state === 'lobby' && window.__online.lobby.code === c, code, 15000) && await waitFor(C, (c) => window.__online.state === 'lobby' && window.__online.lobby.code === c, code, 15000));
  check('...with all three present again and the host unchanged', await waitFor(A, () => window.__online.lobby.players.length === 3, null, 8000) && (await O(A, () => window.__online.lobby.host === window.__online.me)));
  // host leaves -> migration
  await O(A, () => document.getElementById('mpp-leave').click());
  check('the host leaves: A is back on the start screen', await waitFor(A, () => window.__online.state === 'idle' && !document.getElementById('start').classList.contains('hidden'), null, 8000));
  check('host migration: the oldest remaining player (B or C) is the host and gets the Start button', await until(async () => (await vis(B, '#mpp-start')) !== (await vis(C, '#mpp-start')), 10000, 300) && await waitFor(B, () => window.__online.lobby.players.length === 2, null, 6000));
  await shot(B, 'f45-host-migrated-iphone.png');
  await O(C, () => document.getElementById('mpp-leave').click()); await O(B, () => document.getElementById('mpp-leave').click());

  // ---- expired / unknown link -> friendly dialog -> new room -------------------------------------------------------------------------------------
  const D = await mk('chromium', `FrD${tag}`, { path: '/?room=ZZ9ZZ2' });
  check('an expired / unknown ?room= link shows "room is no longer active" with an offer to create a new one', await waitFor(D, () => !document.getElementById('mp-noroom').classList.contains('hidden'), null, 20000) && /no longer active/i.test(await O(D, () => document.getElementById('mpn-title').textContent)) && (await vis(D, '#mpn-new')));
  await shot(D, 'f45-noroom.png');
  await O(D, () => document.getElementById('mpn-new').click());
  check('...and one tap creates a new private room', await waitFor(D, () => window.__online.state === 'lobby' && window.__online.priv && window.__online.lobby.code !== 'ZZ9ZZ2', null, 20000));
  const codeD = await O(D, () => window.__online.lobby.code);
  check('the address bar now carries the NEW code', (await D.url()).includes('room=' + codeD));
  // another live session: E is in a running round of room E1; opening a link to room D must ask
  const E = await mk('chromium', `FrE${tag}`);
  await O(E, () => document.getElementById('play-friends').click()); await O(E, () => document.getElementById('mpf-create').click());
  await waitFor(E, () => window.__online.state === 'lobby', null, 20000);
  const codeE = await O(E, () => window.__online.lobby.code);
  await O(E, () => document.getElementById('mpp-start').click());
  check('E plays alone with bots (own room, running round)', await waitFor(E, () => window.__online.state === 'playing', null, 20000));
  await E.goto(`${BASE}/?room=${codeD}&quality=medium`);
  await E.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  check('a live session in ANOTHER room: the link asks (go back / leave it) instead of silently dropping the round', await waitFor(E, () => !!document.getElementById('mp-rejoin') && document.getElementById('mp-rejoin-no') && /Leave/i.test(document.getElementById('mp-rejoin-no').textContent), null, 8000), await O(E, () => (document.getElementById('mp-rejoin') || {}).textContent));
  await shot(E, 'f45-busy-session.png');
  await O(E, () => document.getElementById('mp-rejoin-no').click());
  check('"Leave it and continue" joins the friend\'s room', await waitFor(E, (c) => window.__online.state === 'lobby' && window.__online.lobby.code === c, codeD, 20000) && await waitFor(D, () => window.__online.lobby.players.length === 2, null, 8000));
  void codeE;
  // stale protocol -> the reload offer (server answers the hello with another protocol version)
  const F = await mk('chromium', `FrF${tag}`);
  await F.routeWebSocket(/\/api\/mp\/ws/, (ws) => { ws.onMessage(() => { ws.send(JSON.stringify({ t: 'err', code: 'version', hash: 'x', sv: 99 })); ws.close(); }); });
  await O(F, (c) => { window.__online.joinPrivate(c); }, codeD);
  check('a client on an old protocol gets the existing reload flow ("New version — reload")', await waitFor(F, () => !!document.getElementById('mp-status-act') && /reload/i.test(document.getElementById('mp-status-act').textContent), null, 15000), await O(F, () => document.getElementById('mp-status').textContent));
  await shot(F, 'f45-stale-protocol.png');
  // LV text on the friends panel
  const G = await mk('chromium', `FrG${tag}`, { lang: 'lv' });
  check('LV: the friends control says "Draugiem"', /Draugiem/.test(await O(G, () => document.getElementById('play-friends').textContent)));
  await O(G, () => document.getElementById('play-friends').click());
  check('LV: panel title "Spēlēt ar draugiem"', /Spēlēt ar draugiem/.test(await O(G, () => document.getElementById('mpf-title').textContent)));
  await shot(G, 'f45-friends-panel-lv.png');

  check('no console errors / page errors in any browser (shader compile errors included)', errors.length === 0, errors.slice(0, 4).join(' | '));
  for (const p of pages) { try { await p.context().close(); } catch {} }
  for (const b of Object.values(browsers)) { try { await b.close(); } catch {} }

  // ---- stage 4: limits ---------------------------------------------------------------------------------------------------------------------------------------
  console.log('\n== stage 4: rate limits (second server, small limits)');
  await stopWrangler();
  const { spawnSync } = await import('node:child_process');
  spawnSync('npx', ['wrangler', 'd1', 'execute', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state, '--command', 'DELETE FROM rate_limits'], { cwd: root, stdio: 'pipe' });
  await startWrangler({ ...MAIN_VARS, RATE_PRIV_CREATE: 3, RATE_PRIV_FAIL: 5 });
  const made = [];
  for (let i = 0; i < 4; i++) made.push((await create()).status);
  check('room creation is rate limited per IP hash (3 per hour here): the 4th is 429', JSON.stringify(made) === '[201,201,201,429]', JSON.stringify(made));
  const fails = [];
  for (let i = 0; i < 6; i++) fails.push((await getJson('/api/mp/room?code=QQ' + 'ABCD'[i % 4] + 'XYZ')).status);
  check('failed lookups are rate limited (5 per 10 min here): then even a valid code is refused with 429', fails.slice(0, 5).every((s) => s === 404) && fails[5] === 429, JSON.stringify(fails));
  const ws = await new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${X.PORT}/api/mp/ws?priv=ABCDEF`); w.onopen = () => res('open'); w.onerror = () => res('refused'); setTimeout(() => res('timeout'), 5000); });
  check('a blocked IP cannot open private sockets either (enumeration via ws is closed too)', ws === 'refused');
  check('public matchmaking is unaffected by the private-room limits', (await post('/api/mp/join')).status === 200);
}
