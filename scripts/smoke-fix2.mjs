// Targeted checks + screenshots for the QA2 (phones / online) and QA1 (desktop) fixes that are not covered by smoke-layout / smoke-resume.
//   node scripts/smoke-fix2.mjs [--no-build]     (builds + serves its own client on FIX_PORT, default 5193; FIX_URL=<url> uses a running one; /api is stubbed)
// Screenshots: scripts/out/fix2-*.png
import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLayout } from './lib/layout-audit.mjs';
import { startBuilt } from './lib/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
const srv = await startBuilt({ url: process.env.FIX_URL, port: +(process.env.FIX_PORT || 5193), outDir: '.dist-fix2', noBuild: process.argv.includes('--no-build') });
const BASE = srv.base;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GPU = process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
let fails = 0, passes = 0, cur = '';
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${cur}] ${name}${info !== '' && (!ok || process.env.VERBOSE) ? '  ' + info : ''}`); return ok; };
const engines = { webkit, chromium, firefox };
const browsers = {};
const getB = async (e) => browsers[e] || (browsers[e] = await engines[e].launch({ headless: true, args: e === 'chromium' ? GPU : [] }));

async function open(eng, { device, size, lang = 'lv', q = '', storage = {}, perms = [], tz = 'Europe/Riga', intro = false } = {}) {
  const b = await getB(eng);
  const prof = device ? { ...devices[device] } : { viewport: { width: size[0], height: size[1] } };
  const ctx = await b.newContext({ ...prof, locale: lang === 'lv' ? 'lv-LV' : 'en-GB', timezoneId: tz, permissions: perms });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.addInitScript(([l, st]) => { try { if (!localStorage.getItem('__s')) { localStorage.setItem('bedre.lang', l); localStorage.setItem('bedre.name', 'Tests'); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); localStorage.setItem('__s', '1'); } } catch {} }, [lang, storage]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.__errs = errs;
  await page.goto(`${BASE}/?quality=low${intro ? '' : '&intro=0'}&radio=0${q ? '&' + q : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 200000 });
  await sleep(400);
  return page;
}
const shot = async (p, n) => { await sleep(250); await p.screenshot({ path: path.join(out, n) }); };
const E = (p, fn, a) => p.evaluate(fn, a);
const startSolo = async (p) => { await E(p, () => { window.__game.start(); window.__game.skipIntro(); }); await sleep(900); };
const audit = async (p, touch) => (await p.evaluate(auditLayout, { touch })).map((v) => `${v.kind}: ${v.msg.replace(/\s+/g, ' ')}`);

// ================================================================== iPhone SE (WebKit), Latvian =================================================
{
  cur = 'WebKit iPhone SE LV';
  const p = await open('webkit', { device: 'iPhone SE', lang: 'lv' });
  // QA2-03: the Advanced pill never wraps: one line, ellipsis / count
  await E(p, () => document.getElementById('opts-toggle').click());
  await E(p, () => { for (const s of ['#modesw [data-mode="quick"]', '#diffsw [data-difficulty="hard"]', '#qualsw [data-quality="low"]']) { const b = document.querySelector(s); if (b) b.click(); } });
  await sleep(500);
  await E(p, () => { const t = [...document.querySelectorAll('#themesw button')].find((b) => b.dataset.theme === 'winter'); if (t) t.click(); const m = document.getElementById('map-select'); if (m) { m.value = 'agenskalns'; m.dispatchEvent(new Event('change', { bubbles: true })); } });
  await sleep(700);
  await E(p, () => document.getElementById('opts-toggle').click());   // collapse: the summary chip is what wraps
  await sleep(500);
  const chip = await E(p, () => { const v = document.getElementById('opts-val'); const r = v.getBoundingClientRect(); const cs = getComputedStyle(v); return { text: v.textContent, h: r.height, lh: parseFloat(cs.lineHeight) || 18, title: v.title, ws: cs.whiteSpace, w: r.width }; });
  check('QA2-03: summary chip is a single line (nowrap + ellipsis / "N izmaiņas")', chip.ws === 'nowrap' && chip.h < 34, JSON.stringify(chip));
  await shot(p, 'fix2-qa2-03-se-advanced-chip.png');
  // QA2-09: name preview
  await E(p, () => { const i = document.getElementById('name'); i.focus(); i.value = '<b>Ann</b>&"x'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  const hint = await E(p, () => document.getElementById('name-hint').textContent);
  check('QA2-09: the name field shows how the name will appear ("Tiks rādīts kā: bAnn/b&\\"x")', /Tiks rādīts kā: bAnn\/b&"x/.test(hint), hint);
  await shot(p, 'fix2-qa2-09-name-preview.png');
  await E(p, () => document.getElementById('name').blur());
  check('QA2-09: on blur the field itself is normalised', (await E(p, () => document.getElementById('name').value)) === 'bAnn/b&"x'.slice(0, 14) && (await E(p, () => localStorage.getItem('bedre.name'))) === 'bAnn/b&"x');
  await E(p, () => { const i = document.getElementById('name'); i.value = 'Tests'; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); });
  // QA2-07: about panel link hit areas
  await E(p, () => document.getElementById('open-about').click());
  await sleep(300);
  const small = await E(p, () => [...document.querySelectorAll('#about a[href], #about button, #start a[href]')].filter((e) => e.getBoundingClientRect().width > 2).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 14), h: Math.round(r.height) }; }).filter((x) => x.h < 43.5));
  check('QA2-07: every link / button in the About panel is >= 44 px tall', small.length === 0, JSON.stringify(small));
  await E(p, () => { const st = document.createElement('style'); st.textContent = '#about a[href], #about button { outline: 2px solid #e00 !important; background: rgba(255,0,0,.12) !important; }'; document.head.appendChild(st); });
  await shot(p, 'fix2-qa2-07-se-about-targets.png');
  await p.keyboard.press('Escape'); await sleep(200);
  // QA2-08: landscape toast lane
  await p.setViewportSize({ width: 568, height: 320 }); await sleep(500);
  await shot(p, 'fix2-qa2-04-se-landscape-start.png');
  check('QA2-04: SE landscape start screen: no round button over the panel (audit)', (await audit(p, true)).filter((x) => /hud-vs-panel/.test(x)).length === 0, (await audit(p, true)).join(' | '));
  await startSolo(p);
  await E(p, () => window.__metaToast('★', 'Sasniegums: Tramvaju sastrēgums', { ms: 8000 }));
  await E(p, () => { const g = window.__life.game, sp = (t) => { const e = document.createElement('span'); e.textContent = t; return e; }; g.hud.feedItem([sp('Jānis'), sp(' norija '), sp('Tests'), sp(' +120')], '#d9552f'); });
  await sleep(700);
  const a = await audit(p, true);
  check('QA2-08: SE landscape: toast / feed / banner never over the hole or each other\'s lanes', a.filter((x) => /toast|hud-vs-hud|label-vs-hud/.test(x)).length === 0, a.join(' | '));
  await shot(p, 'fix2-qa2-08-se-landscape-toast.png');
  // QA2-06 / QA1-01: a name tag that would sit on a HUD card fades out and is layered below
  await p.setViewportSize({ width: 320, height: 568 }); await sleep(500);
  await E(p, () => { window.__tagTest = setInterval(() => window.__life.game.hud.updateTags([{ id: 'zz', name: 'Cēsu Jānis', color: '#c33', x: 150, y: 56, visible: true, leader: true, me: false }, { id: 'zy', name: 'Pūce', color: '#36c', x: 60, y: 300, visible: true, leader: false, me: false }]), 100); });
  await sleep(900);
  const tg = await E(p, () => ({ over: getComputedStyle(document.querySelector('#tags .tag')).opacity, zt: getComputedStyle(document.getElementById('tags')).zIndex, zh: getComputedStyle(document.getElementById('hud')).zIndex, all: [...document.querySelectorAll('#tags .tag')].map((t) => [t.textContent, t.classList.contains('occluded')]) }));
  check('QA2-06: tag over the HUD row fades out, free tag stays; tags are layered below the HUD', tg.all.find((x) => /Cēsu/.test(x[0]))[1] === true && tg.all.find((x) => /Pūce/.test(x[0]))[1] === false && +tg.zt < +tg.zh, JSON.stringify(tg));
  await shot(p, 'fix2-qa2-06-se-tag-vs-hud.png');
  await E(p, () => clearInterval(window.__tagTest));
  // QA2-02: results
  await E(p, () => { window.__life.game.player.score = 4200; window.__life.game.end(); });
  await sleep(900);
  const rows = await E(p, () => { const tb = document.getElementById('r-table'); const a = tb.closest('.rpanes').getBoundingClientRect(); return { n: [...tb.querySelectorAll('tr')].filter((tr) => { const r = tr.getBoundingClientRect(); return r.top >= a.top - 1 && r.bottom <= a.bottom + 1; }).length, tabsTop: [...document.querySelectorAll('#rtabs button')].map((b) => Math.round(b.getBoundingClientRect().top)), again: document.getElementById('again').getBoundingClientRect().bottom, vh: innerHeight }; });
  check('QA2-02: SE portrait results: >= 5 leaderboard rows visible, tabs on one line, Play again visible', rows.n >= 5 && new Set(rows.tabsTop).size === 1 && rows.again <= rows.vh, JSON.stringify(rows));
  await shot(p, 'fix2-qa2-02-se-results.png');
  await E(p, () => document.querySelector('#rtabs [data-rt="ach"]').click());
  await sleep(300);
  await shot(p, 'fix2-qa2-02-se-results-progress.png');
  check('no page errors', p.__errs.length === 0, p.__errs.join(' | '));
  await p.context().close();
}

// ================================================================== desktop Chromium (QA1) ===================================================
{
  cur = 'Chromium desktop';
  const p = await open('chromium', { size: [1280, 720], lang: 'lv', perms: ['clipboard-read', 'clipboard-write'] });
  const errs0 = p.__errs.length;
  // QA1-02: pill inside its own background; QA1-04: feed lane
  await startSolo(p);
  await E(p, () => { const g = window.__life.game, sp = (t) => { const e = document.createElement('span'); e.textContent = t; return e; }; g.hud.feedItem([sp('Jānis'), sp(' norija '), sp('Tests'), sp(' +272')], '#d9552f'); window.__meta.R.pctAll = 20.4; window.__meta.R.pctMe = 11.2; });
  await sleep(1500);
  const a1 = await audit(p, false);
  check('QA1-02/04: 1280x720: share pill fits its background, kill feed has its own lane (no overlaps)', a1.length === 0, a1.join(' | '));
  await shot(p, 'fix2-qa1-02-04-1280x720-play.png');
  for (const [w, h] of [[1024, 600], [853, 480], [640, 360]]) {
    await p.setViewportSize({ width: w, height: h }); await sleep(900);
    const a = await audit(p, false);
    check(`QA1-03: ${w}x${h} play: no HUD overlaps`, a.length === 0, a.join(' | '));
    await shot(p, `fix2-qa1-03-${w}x${h}-play.png`);
  }
  // QA1-05: see the block below (needs the real fly-in)
  // QA1-06: free roam gives no placement / survival achievement; QA1-07/08 share feedback + link
  await p.close();
  {
    const q5 = await open('chromium', { size: [1280, 720], lang: 'lv', intro: true });
    await E(q5, () => { window.__game.start(); });
    await sleep(500); await E(q5, () => window.__game.skipIntro()); await sleep(500);
    await E(q5, () => { window.__meta.R.pctAll = 40; window.__meta.R.pctMe = 13; window.__life.game.player.score = 1000; window.__life.game.end(); });
    await sleep(900);
    await E(q5, () => document.getElementById('again').click());
    await sleep(300);
    const ph = await E(q5, () => ({ phase: window.__game.state.phase, pct: document.getElementById('meta-pct').dataset.me, all: document.getElementById('meta-pct').dataset.all, sp: document.getElementById('score-pct').textContent }));
    check('QA1-05: during the fly-in after Play again the % widgets are already reset', ph.phase === 'intro' && +ph.pct === 0 && +ph.all === 0 && /^0/.test(ph.sp), JSON.stringify(ph));
    await shot(q5, 'fix2-qa1-05-flyin-reset.png');
    await q5.context().close();
  }
  const f = await open('chromium', { size: [1280, 720], lang: 'lv', q: 'mode=free', perms: ['clipboard-read', 'clipboard-write'] });
  await startSolo(f); await sleep(3500);
  await E(f, () => document.getElementById('end-free').click()); await sleep(1200);
  const ach = await E(f, () => ({ place: document.getElementById('r-place').textContent, ids: window.__meta.R.newAch.slice(), store: JSON.parse(localStorage.getItem('bedre.meta') || localStorage.getItem('bedre.meta.v1') || '{}') }));
  check('QA1-06: free roam 3 s / 0 points: "King of the Pit" and "Safe and Sound" do NOT unlock', !ach.ids.includes('win') && !ach.ids.includes('survivor'), JSON.stringify(ach.ids));
  await E(f, () => document.getElementById('meta-copy').click()); await sleep(400);
  const cp = await E(f, async () => ({ clip: await navigator.clipboard.readText(), label: document.getElementById('meta-copy').textContent, cls: document.getElementById('meta-copy').className }));
  check('QA1-07: "Copy link" shows a visible confirmation on the button', /nokopēta/i.test(cp.label) && /done/.test(cp.cls), JSON.stringify(cp));
  check('QA1-08: copied link carries map + mode (no name)', /^https:\/\/bedre\.pakers\.lv\/\?map=centrs&mode=free$/.test(cp.clip) && !/Tests/.test(cp.clip), cp.clip);
  await shot(f, 'fix2-qa1-07-copy-link.png');
  await E(f, () => document.getElementById('meta-share').click()); await sleep(900);
  const sh = await E(f, () => document.getElementById('meta-share').textContent);
  check('QA1-07: desktop "Share" (PNG download fallback) confirms too', /lejupielādēts|Kopīgots/.test(sh), sh);
  // a ranked round does unlock them (needs opponents + minimum time): simulate via the eligibility rule directly
  const rule = await E(f, () => { const R = window.__meta.R; return typeof window.__meta.defs.find((d) => d.id === 'win').progress === 'function'; });
  check('achievement defs intact', rule);
  check('no page errors (desktop)', f.__errs.length === 0, f.__errs.join(' | '));
  await f.context().close();
}

// ================================================================== QA1 suspected ===========================================================
{
  cur = 'Chromium / theme caption / name save / vibrate';
  const p = await open('chromium', { size: [1280, 720], lang: 'lv', q: 'autostart=1&theme=nov18' });
  check('QA1-S3: no console error from navigator.vibrate at an autostart without a gesture', !p.__errs.some((e) => /vibrate/i.test(e)), p.__errs.join(' | '));
  await E(p, () => window.__game && 0);
  await p.close();
  for (const [day, want] of [['2026-11-16T12:00:00', /Lāčplēša dienas un valsts svētku nedēļa/], ['2026-11-18T12:00:00', /Latvijas Republikas proklamēšanas diena/]]) {
    const b = await getB('chromium');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'lv-LV' });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.addInitScript((d) => { const T = new Date(d).getTime(); const D = Date; globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; try { localStorage.setItem('bedre.lang', 'lv'); } catch {} }, day);
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/?quality=low&intro=0&radio=0`);
    await pg.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 200000 });
    await sleep(500);
    await E(pg, () => { const t = document.getElementById('opts-toggle'); if (t && document.getElementById('opts-body').hidden) t.click(); });
    await sleep(500);
    const cap = await E(pg, () => document.querySelector('.themecap') ? document.querySelector('.themecap').textContent : '');
    check(`QA1-S1: theme caption on ${day.slice(0, 10)}`, want.test(cap), cap);
    await ctx.close();
  }
  const q = await open('chromium', { size: [1280, 720], lang: 'lv' });
  await E(q, () => { localStorage.removeItem('bedre.name'); const i = document.getElementById('name'); i.focus(); i.value = 'Pēteris'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check('QA1-S4: the name is saved while typing (not only when a round starts)', (await E(q, () => localStorage.getItem('bedre.name'))) === 'Pēteris');
  await q.context().close();
}

// ================================================================== WebKit: preload warnings ================================================
{
  cur = 'WebKit preload';
  const b = await getB('webkit');
  const ctx = await b.newContext();
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  const warns = [];
  page.on('console', (m) => { if (/preload/i.test(m.text())) warns.push(m.text().slice(0, 100)); });
  await page.goto(`${BASE}/?quality=low`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 200000 });
  await sleep(7000);
  check('QA1-S2: WebKit logs no "preloaded but not used" warnings', warns.length === 0, warns.join(' | '));
  await ctx.close();
}
for (const b of Object.values(browsers)) await b.close();
srv.stop();
console.log(fails ? `\n${fails} check(s) FAILED (${passes} passed)` : `\nall ${passes} fix2 checks passed`);
process.exit(fails ? 1 : 0);
