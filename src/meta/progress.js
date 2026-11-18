// Meta layer entry point: initMeta({ game, world }). Passive observer of the game through the event bus and world.onUpdate:
// album collection, achievements, % of Rīga swallowed, neighbourhood banner, round recap + share. Never touches gameplay.
import { CFG } from '../config.js';
import { bus } from '../events.js';
import { t, kindName, onLang, getLang } from '../i18n.js';
import { placeText } from '../hud.js';
import { mt, lname, aname, asub } from './strings.js';
import { load, save, saveSoon } from './store.js';
import { loadAreas, getAreas, areaAt } from './districts-names.js';
import { buildAlbum, collect, collectedCount, renderAlbum } from './album.js';
import { makeDefs, evaluate, renderAchievements, achName } from './achievements.js';
import { drawRecapMap, drawSpark, areaRows } from './recap.js';
import { renderCard, shareCard, copyLink, SITE } from './share.js';
import { getMode } from '../modes.js';
import { initRetention } from './retention.js';
import { noteMeta, awardRound } from './wardrobe.js';
import { initWardrobeUi } from './wardrobeUi.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const CSS = `
.meta-toast{pointer-events:auto;background:var(--slate);color:var(--cream);padding:9px 16px 9px 12px;border-radius:14px;font-weight:700;font-size:14px;box-shadow:var(--shadow);display:flex;gap:10px;align-items:center;animation:metat .35s ease-out;border-bottom:3px solid var(--terra);max-width:100%}
.meta-toast span{min-width:0;overflow-wrap:anywhere}
.meta-toast.out{opacity:0;transition:opacity .4s}.meta-toast i{font-style:normal;font-size:20px;line-height:1}.meta-toast button{font:inherit;font-weight:800;background:var(--terra);color:#fff;border:0;border-radius:8px;padding:6px 12px;min-height:32px;cursor:pointer}
@keyframes metat{from{opacity:0;transform:translateY(10px)}}
.mp-body{max-height:min(54vh,470px);overflow-y:auto;margin-bottom:14px;touch-action:pan-y;-webkit-overflow-scrolling:touch;padding-right:2px}
.mp-count{font-weight:800;font-size:15px;margin-bottom:5px}
.mp-bar{height:10px;border-radius:6px;background:var(--cream2);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.15);margin-bottom:10px}.mp-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--terra),#f08a3c);border-radius:6px}
.mp-bar.thin{height:6px;margin:0;flex:1}
.mp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mp-card{background:#fff;border-radius:12px;padding:6px 6px 8px;text-align:center;box-shadow:0 1px 0 var(--cream2),inset 0 0 0 2px var(--cream2);min-width:0}
.mp-card.got{box-shadow:inset 0 0 0 2px var(--terra)}.mp-card canvas{width:100%;max-width:96px;height:auto;display:block;margin:0 auto}
.mp-name{font-weight:800;font-size:12.5px;line-height:1.15;margin-top:2px;overflow-wrap:anywhere}.mp-card:not(.got) .mp-name{color:var(--ink2)}
.mp-sub{font-size:10.5px;color:var(--ink2);line-height:1.25;margin-top:2px;font-weight:600}.mp-card.got .mp-sub{color:var(--verd)}
.mp-ach{display:flex;flex-direction:column;gap:6px}
.mp-arow{display:flex;gap:10px;background:#fff;border-radius:12px;padding:8px 10px;box-shadow:inset 0 0 0 2px var(--cream2)}.mp-arow.got{box-shadow:inset 0 0 0 2px #d9a52f}
.mp-aic{font-size:22px;color:#b7ad9a;line-height:1.1}.mp-arow.got .mp-aic{color:#d9a52f}.mp-abody{flex:1;min-width:0}
.mp-aname{font-weight:800;font-size:14px}.mp-adesc{font-size:12px;color:var(--ink2);font-weight:600;margin-bottom:4px}
.mp-aprog{display:flex;gap:8px;align-items:center;font-size:11px;font-weight:700;color:var(--ink2)}
@media (max-width:560px){.mp-grid{grid-template-columns:repeat(2,1fr)}}
`;

export async function initMeta({ game, world }) {
  const style = document.createElement('style'); style.id = 'meta-style'; style.textContent = CSS; document.head.appendChild(style);
  await loadAreas();
  const album = buildAlbum(world);
  const areas = getAreas();
  const areaIdx = new Map(areas.map((a, i) => [a.id, i]));
  const oldTown = areas.find((a) => a.lv === 'Vecrīga') || null;

  // ---- totals: share of the map's swallowable value, overall + per area -------------------------------------
  let total = 0;
  const areaTotal = new Float64Array(areas.length);
  const objArea = new Int16Array(world.objects.length).fill(-1);
  for (const o of world.objects) {
    total += o.value;
    const a = areaAt(o.x, o.z);
    if (a) { const i = areaIdx.get(a.id); objArea[o.id] = i; areaTotal[i] += o.value; }
  }
  total = Math.max(1, total);

  const churchIds = new Set(album.entries.filter((e) => e.type === 'church' && oldTown && (areaAt(e.x, e.z) || {}).id === oldTown.id).map((e) => e.id));
  const R = {};
  let ret = null;   // streak / weekly goals / rewards (src/meta/retention.js), created once the panel + start-screen button exist
  const resetRound = () => {
    Object.assign(R, {
      kinds: {}, buildings: 0, kills: 0, deaths: 0, bigBot: false, firstBuildingT: null, areas: new Set(), banks: new Set(), churches: new Set(),
      all: 0, me: 0, pctAll: 0, pctMe: 0, oldTownPct: 0, areaMe: new Float64Array(areas.length), areaAll: new Float64Array(areas.length),
      level: 1, score: 0, won: false, survived: false, samples: [], footprints: [], marks: [], newAlbum: [], newAch: [], curArea: null, curAt: -99,
    });
  };
  resetRound();
  // rounds that used debug hooks / URL overrides never unlock anything (free roam and daily practice still count)
  const debugRound = () => !!game.unranked && game.unranked !== 'free' && game.unranked !== 'practice' && game.unranked !== 'online' && !window.__metaAllowDebug;
  // Eligibility rule (docs/qa/playtest-desktop.md QA1-06): collection / swallow / size achievements count in every mode (free roam, daily practice and
  // online included - they only depend on what you swallowed). Placement ('win'), survival ('survivor') and the rounds counter need a REAL round:
  // opponents on the map, not free roam, and at least min(60 s, half the round) played.
  const realRound = () => {
    if (document.body.classList.contains('mode-free') || game.unranked === 'free') return false;
    const opp = game.holes.filter((h) => !h.isPlayer).length;
    return opp > 0 && (game.playT || 0) >= Math.min(60, (game.roundSeconds || 300) * 0.5);
  };
  const defs = makeDefs({ R, album, churchIds, oldTown: oldTown && oldTown.id, levelMax: CFG.levels.length });

  // ---- DOM: HUD meter, area banner, toasts -------------------------------------------------------------------
  const pct = el('div'); pct.id = 'meta-pct';
  const pctTxt = el('div', 'pl'); const barBox = el('div', 'bar2'); const bAll = el('i'); const bMe = el('i', 'me'); barBox.append(bAll, bMe); pct.append(pctTxt, barBox);
  ($('hud') || document.body).appendChild(pct);
  const banner = el('div'); banner.id = 'meta-area'; const bn = el('div', 'an'); const bs = el('div', 'as'); banner.append(bn, bs); document.body.appendChild(banner);
  const toasts = el('div'); toasts.id = 'meta-toasts'; toasts.setAttribute('aria-live', 'polite'); document.body.appendChild(toasts);

  const fmtPct = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const drawPct = () => {
    pctTxt.replaceChildren();
    const a = el('span'); a.append(el('span', 'l-full', mt('pctRiga') + ' '), el('span', 'l-short', mt('pctRigaShort') + ' '), el('b', '', fmtPct(R.pctAll) + '%'));
    const c = el('span'); c.append(el('span', 'l-full', mt('pctYou') + ' '), el('span', 'l-short', mt('pctYouShort') + ' '), el('b', 'me', fmtPct(R.pctMe) + '%'));
    pctTxt.append(a, c);
    bAll.style.width = Math.min(100, R.pctAll * 4) + '%'; bMe.style.width = Math.min(100, R.pctMe * 4) + '%';
    pct.dataset.all = R.pctAll.toFixed(3); pct.dataset.me = R.pctMe.toFixed(3);
    const sp = $('score-pct'); if (sp) sp.textContent = `${fmtPct(R.pctMe)}% ${mt('pctRigaShort')}`;   // phones: the % chip lives in the score card
  };
  drawPct();

  // at most 2 toasts visible; the rest wait in a queue. Nothing is queued while the results panel is up (the panel lists the items instead).
  const MAXT = 2, queue = []; let shown = 0;
  const resultsUp = () => { const r = $('results'); return !!r && !r.classList.contains('hidden'); };
  function pump() {
    while (shown < MAXT && queue.length) {
      const q = queue.shift(); if (q.cancelled) continue;
      shown++; toasts.append(q.d);
      const done = () => { q.d.classList.add('out'); setTimeout(() => { q.d.remove(); shown = Math.max(0, shown - 1); pump(); }, 450); };
      q.close = done;
      if (!q.opts.sticky) setTimeout(done, q.opts.ms || 3200);
    }
  }
  function toast(icon, text, opts = {}) {
    if (resultsUp() && !opts.sticky) return null;
    const d = el('div', 'meta-toast'); const i = el('i', '', icon); const s2 = el('span', '', text); d.append(i, s2);
    if (opts.action) { const b = el('button', '', opts.action.label); b.type = 'button'; b.addEventListener('click', opts.action.fn); d.append(b); }
    if (queue.length > 6) queue.shift();
    queue.push({ d, opts }); pump();
    return d;
  }
  const clearToasts = () => { for (const q of queue) q.cancelled = true; queue.length = 0; for (const c of [...toasts.children]) c.remove(); shown = 0; };
  window.__metaToast = toast;

  function showArea(a) {
    bn.textContent = aname(a);
    const i = areaIdx.get(a.id);
    const p = (100 * R.areaMe[i]) / Math.max(1, areaTotal[i]);
    bs.textContent = (asub(a) ? asub(a) + ' · ' : '') + mt('areaIn', { n: fmtPct(p) });
    banner.dataset.area = a.id;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  }

  const unlockToast = (d) => { R.newAch.push(d.id); noteMeta({ ach: [d.id] }); toast('★', mt('achUnlocked', { name: achName(d) }), { ms: 4600 }); };
  const evalAch = () => { if (!debugRound()) evaluate(defs, unlockToast); };

  // ---- events --------------------------------------------------------------------------------------------------------
  const normKind = (k) => String(k || '').replace(/^person\d+$/, 'person');
  bus.on('roundStart', () => { resetRound(); drawPct(); });
  bus.on('introStart', () => { resetRound(); drawPct(); });   // the fly-in after "Play again" must not show the last round's % / share bar
  bus.on('swallow', (o, hole) => {
    R.all += o.value;
    const ai = objArea[o.id];
    if (ai >= 0) R.areaAll[ai] += o.value;
    if (!hole.isPlayer || debugRound()) return;
    R.me += o.value;
    if (ai >= 0) R.areaMe[ai] += o.value;
    const k = normKind(o.kind); R.kinds[k] = (R.kinds[k] || 0) + 1;
    if (k === 'taxi') R.kinds.car = (R.kinds.car || 0) + 1;
    const ctr = load().ctr;
    if (k === 'pigeon') { ctr.pigeons++; saveSoon(); }
    if (o.isBuilding) {
      R.buildings++; ctr.buildings = (ctr.buildings || 0) + 1; saveSoon();
      if (R.firstBuildingT == null) R.firstBuildingT = game.playT || 0;
      const it = world.buildingItems[o.id];
      if (it && it.ring && it.x === o.x) R.footprints.push(it.ring);
    }
    if (o.landmark || o.value >= 60) R.marks.push({ x: o.x, z: o.z });
    const e = album.byObj.get(o.id);
    if (e) {
      if (e.type === 'church' && churchIds.has(e.id)) R.churches.add(e.id);
      if (collect(album, e, load().ctr.rounds + 1)) {
        R.newAlbum.push(e.id);
        noteMeta({ album: collectedCount(album) });
        toast('📖', mt('newAlbum', { name: lname(e), n: collectedCount(album), total: album.entries.length }));
        evalAch();
      }
    }
  });
  bus.on('freedomPass', (o) => {   // 18 Nov: the monument cannot be swallowed; passing over it with a big enough hole collects its album entry ("honour": no swallow achievement)
    const e = album.byObj.get(o.id);
    if (e && collect(album, e, load().ctr.rounds + 1, true)) { R.newAlbum.push(e.id); noteMeta({ album: collectedCount(album) }); toast('📖', mt('newAlbum', { name: lname(e), n: collectedCount(album), total: album.entries.length })); }
  });
  bus.on('holeEaten', ({ eater, victim }) => {
    if (eater && eater.isPlayer) { R.kills++; if (victim.radius >= 8 || (victim.targetRadius || 0) >= 8) R.bigBot = true; }
    if (victim && victim.isPlayer) { R.deaths++; R.survived = false; }
  });

  const L = CFG.levels;
  let tAcc = 0, aAcc = 0, sAcc = 0;
  world.onUpdate.push((dt) => {
    if (game.phase !== 'playing') return;
    const p = game.player;
    tAcc += dt; aAcc += dt; sAcc += dt;
    if (aAcc >= 0.25) {
      aAcc = 0;
      if (p.alive) {
        const a = areaAt(p.x, p.z);
        if (a) {
          R.areas.add(a.id); R.banks.add(a.bank);
          if (R.curArea !== a.id) {
            const now = game.playT;
            R.curArea = a.id;
            if (now - R.curAt > 1.5 || banner.dataset.area !== a.id) { R.curAt = now; showArea(a); }
          }
        }
      }
    }
    if (sAcc >= 0.5) {
      sAcc = 0;
      if (p.alive) {
        let rr = null, bs = -1;
        for (const h of game.holes) if (!h.isPlayer && h.score > bs) { bs = h.score; rr = h.radius; }
        R.samples.push({ t: Math.round(game.playT * 10) / 10, x: p.x, z: p.z, r: p.radius, rr });
      }
    }
    if (tAcc >= 0.4) {
      tAcc = 0;
      R.pctAll = (100 * R.all) / total; R.pctMe = (100 * R.me) / total;
      R.score = p.score;
      const r = p.targetRadius; let lv = 1; while (lv < L.length && r >= L[lv]) lv++; R.level = lv;
      const oi = oldTown ? areaIdx.get(oldTown.id) : -1;
      R.oldTownPct = oi >= 0 ? (100 * R.areaMe[oi]) / Math.max(1, areaTotal[oi]) : 0;
      drawPct();
      evalAch();
    }
  });
  onLang(() => { drawPct(); if (!panel.classList.contains('hidden')) renderTab(); if (recapInfo) buildRecap(); });

  // ---- recap on the results screen --------------------------------------------------------------------------------
  let recapInfo = null, cardCanvas = null;
  const pHex = () => '#' + game.player.color.getHexString();
  function recapData() {
    return {
      data: world.data, bounds: world.bounds, color: pHex(), samples: R.samples, footprints: R.footprints, marks: R.marks,
      bots: game.holes.filter((h) => !h.isPlayer).map((h) => ({ x: h.x, z: h.z, r: h.radius, color: '#' + h.color.getHexString() })),
    };
  }
  function areaPctMap() {
    const m = {};
    areas.forEach((a, i) => { if (areaTotal[i] > 0 && R.areaMe[i] > 0) m[a.id] = { a, pct: (100 * R.areaMe[i]) / areaTotal[i] }; });
    return m;
  }
  function buildRecap() {
    const res = game._res; if (!res) return;
    const mapPane = $('rt-map'), achPane = $('rt-ach'), shareBox = $('r-share');
    if (!mapPane || !achPane || !shareBox) return;
    mapPane.replaceChildren(); achPane.replaceChildren(); shareBox.replaceChildren();
    const sec = el('section'); sec.id = 'meta-recap';
    const rec = recapData();
    const map = el('canvas'); map.id = 'meta-recap-map'; drawRecapMap(map, rec, 560);
    sec.append(el('h3', '', mt('recapTitle')), map, el('div', 'rc-cap', mt('recapMap')));
    const spark = el('canvas'); spark.id = 'meta-recap-spark'; drawSpark(spark, rec);
    sec.append(spark);
    const leg = el('div', 'rc-leg'); const l1 = el('span'); const i1 = el('i'); i1.style.background = rec.color; l1.append(i1, mt('recapYou'));
    const l2 = el('span'); const i2 = el('i'); i2.style.background = '#2b3a4a'; l2.append(i2, mt('recapRival')); leg.append(l1, l2);
    sec.append(el('div', 'rc-cap', mt('recapGrowth')), leg);
    sec.append(el('div', 'rc-big', mt('recapRiga', { all: fmtPct(R.pctAll), me: fmtPct(R.pctMe) })));
    const rows = areaRows(areaPctMap());
    if (rows.length) {
      sec.append(el('div', 'rc-sec', mt('recapAreas')));
      const ch = el('div', 'rc-chips'); ch.id = 'meta-recap-areas';
      for (const r of rows) { const c = el('span', 'rc-chip', aname(r.a) + (asub(r.a) ? ' (' + asub(r.a) + ')' : '') + ' '); c.append(el('b', '', fmtPct(r.pct) + '%')); ch.append(c); }
      sec.append(ch);
    }
    mapPane.append(sec);
    // progress tab: new album objects + new achievements (instead of in-round toasts)
    const ach = el('section'); ach.id = 'meta-recap-new';
    const list = (title, items) => {
      if (!items.length) return;
      const w = el('div'); w.append(el('div', 'rc-sec', title));
      const ch = el('div', 'rc-chips');
      for (const x of items) ch.append(el('span', 'rc-chip', x));
      w.append(ch); ach.append(w);
    };
    list(mt('recapNewAlbum'), R.newAlbum.map((id) => lname(album.entries.find((e) => e.id === id))));
    list(mt('recapNewAch'), R.newAch.map((id) => achName(defs.find((d) => d.id === id))));
    if (ret) ret.recapExtra(ach);
    if (!ach.children.length) ach.append(el('p', 'rc-empty', t('rtNone')));
    const open2 = el('div', 'linkrow'); const pb = el('button', 'link', '★ ' + mt('myProgress')); pb.type = 'button'; pb.addEventListener('click', () => open());
    open2.append(pb); ach.append(open2);
    achPane.append(ach);
    const n = R.newAlbum.length + R.newAch.length + (ret ? ret.recapCount() : 0);
    const badge = $('rt-badge'); if (badge) { badge.textContent = String(n); badge.hidden = !n; }
    const sb = el('button', 'btn alt', '⤴ ' + mt('share')); sb.type = 'button'; sb.id = 'meta-share';
    const cb = el('button', 'btn alt', mt('copyLink')); cb.type = 'button'; cb.id = 'meta-copy';
    sb.addEventListener('click', async () => {
      sb.disabled = true;
      try {
        const r = await shareCard(makeCard(), mt('shareText', { pct: fmtPct(R.pctMe), score: Math.floor(res.score) }));
        sb.dataset.result = r;
        if (r === 'shared') flash(sb, '✓ ' + mt('shared')); else if (r === 'downloaded') flash(sb, '✓ ' + mt('downloaded'));
      } finally { sb.disabled = false; }
    });
    cb.addEventListener('click', async () => { const ok = await copyLink(shareUrl()); flash(cb, ok ? '✓ ' + mt('copied') : mt('copyFail')); });
    shareBox.append(sb, cb);
    recapInfo = true;
  }
  /** Visible confirmation on the button itself (the toast lane is hidden while the results panel is up). */
  function flash(btn, text) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = text; btn.classList.add('done'); btn.setAttribute('role', 'status');
    clearTimeout(btn._ft); btn._ft = setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('done'); btn.removeAttribute('role'); }, 2200);
  }
  /** Link for a friend: same map + game mode (never the name or anything personal). */
  function shareUrl() {
    const u = new URL(SITE + '/');
    u.searchParams.set('map', (CFG.map && CFG.map.slug) || 'centrs');
    u.searchParams.set('mode', getMode());
    return u.toString();
  }
  function makeCard() {
    const res = game._res;
    cardCanvas = cardCanvas || document.createElement('canvas');
    return renderCard(cardCanvas, recapData(), {
      name: game.player.name, score: Math.floor(res.score), rankText: placeText(res.rank, res.total),
      sizeText: `Ø ${(res.radius * 2).toFixed(1)} m`, biggest: res.biggest ? (res.biggest.name || kindName(res.biggest.kind)) : '—', pctMe: fmtPct(R.pctMe), extra: ret ? ret.cardExtra() : '',
    });
  }

  bus.on('roundEnd', () => {
    banner.classList.remove('show');
    const res = game._res;
    clearToasts();
    const st = load();
    R.pctAll = (100 * R.all) / total; R.pctMe = (100 * R.me) / total;
    const real = realRound();
    R.won = !!res && res.rank === 1 && real;
    R.survived = R.deaths === 0 && real;
    if (!debugRound()) {
      if (real) { st.ctr.rounds++; if (R.won) st.ctr.wins++; }
      const best = st.best; if (R.pctMe > (best.pct || 0)) best.pct = R.pctMe;
      if (res && res.score > (best.score || 0)) best.score = res.score;
    }
    drawPct(); evalAch(); save();
    if (ret) ret.onRoundEnd(res);   // streak + weekly goals commit (eligible rounds only), before the recap lists them
    giveXp(res);
    buildRecap();
    { const nw = wd.extras($('rt-ach')); const bd = $('rt-badge'); if (nw && bd) { bd.textContent = String((+bd.textContent || 0) + nw); bd.hidden = false; } }   // unlocked skins count as new progress
  });
  // XP: every eligible finished round (the streak's rule: not free roam, no debug hook, min(60 s, half the round) played)
  let roundRewards = [], xpFor = null;
  bus.on('rewardUnlocked', (id) => roundRewards.push(id));
  function giveXp(res) {
    if (!res || xpFor === res) return;
    xpFor = res;
    const free = document.body.classList.contains('mode-free') || game.unranked === 'free';
    const lastS = ret && ret.lastStreak();
    const a = awardRound({ eligible: eligibleNow(), mode: free ? 'free' : game.online || res.online ? 'online' : getMode(), rank: res.rank, total: res.total, score: res.score, rewards: roundRewards, streak: lastS ? lastS.cur : 0 });
    roundRewards = [];
    if (!free) wd.showAward(a);
    wd.refreshAll();
    window.__lastXp = a;
  }
  bus.on('introStart', () => { roundRewards = []; xpFor = null; wd.clearAward(); });
  bus.on('introStart', () => { clearToasts(); for (const id of ['rt-map', 'rt-ach', 'r-share']) { const e = $(id); if (e) e.replaceChildren(); } const bd = $('rt-badge'); if (bd) bd.hidden = true; recapInfo = null; });

  // ---- "My progress" panel + entry buttons ---------------------------------------------------------------------------
  const panel = el('div', 'panel hidden'); panel.id = 'meta-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  const inner = el('div', 'panel-inner'); const h2 = el('h2', '', mt('progTitle')); h2.id = 'mp-title';
  const tabs = el('div', 'mp-tabs'); tabs.setAttribute('role', 'tablist');
  const tbA = el('button', '', ''); tbA.type = 'button'; tbA.dataset.tab = 'album'; tbA.setAttribute('role', 'tab');
  const tbB = el('button', '', ''); tbB.type = 'button'; tbB.dataset.tab = 'ach'; tbB.setAttribute('role', 'tab');
  const tbC = el('button', '', ''); tbC.type = 'button'; tbC.dataset.tab = 'week'; tbC.setAttribute('role', 'tab');
  const tbD = el('button', '', ''); tbD.type = 'button'; tbD.dataset.tab = 'wardrobe'; tbD.setAttribute('role', 'tab');
  tabs.append(tbA, tbB, tbC, tbD);
  const body = el('div', 'mp-body'); body.id = 'mp-body';
  const close = el('button', 'btn small', ''); close.type = 'button'; close.id = 'mp-close';
  inner.append(h2, tabs, body, close); panel.append(inner); document.body.appendChild(panel);
  let tab = 'album';
  function renderTab() {
    h2.textContent = mt('progTitle'); close.textContent = mt('close');
    tbA.textContent = mt('tabAlbum'); tbB.textContent = mt('tabAch'); tbC.textContent = mt('tabWeek'); tbD.textContent = mt('tabWardrobe');
    tbD.setAttribute('aria-selected', String(tab === 'wardrobe'));
    tbA.setAttribute('aria-selected', String(tab === 'album')); tbB.setAttribute('aria-selected', String(tab === 'ach')); tbC.setAttribute('aria-selected', String(tab === 'week'));
    const top = body.scrollTop;
    if (tab === 'album') renderAlbum(body, album); else if (tab === 'week' && ret) ret.renderWeek(body); else if (tab === 'wardrobe') wd.renderTab(body); else renderAchievements(body, defs);
    body.scrollTop = top;
  }
  const open = (which) => { if (which) tab = which; renderTab(); panel.classList.remove('hidden'); close.focus(); };
  const shut = () => panel.classList.add('hidden');
  tbA.addEventListener('click', () => { tab = 'album'; renderTab(); });
  tbB.addEventListener('click', () => { tab = 'ach'; renderTab(); });
  tbC.addEventListener('click', () => { tab = 'week'; renderTab(); });
  tbD.addEventListener('click', () => { tab = 'wardrobe'; renderTab(); });
  close.addEventListener('click', shut);
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) shut(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) { shut(); e.stopPropagation(); } }, true);

  const mkBtn = (id) => { const b = el('button', 'link', ''); b.type = 'button'; b.id = id; b.dataset.metaOpen = '1'; b.addEventListener('click', () => open()); return b; };
  const btns = [];
  for (const [sel, id] of [['#start', 'open-progress']]) {
    const host = document.querySelector(sel); if (!host) continue;
    const row = host.querySelector('.linkrow') || (() => { const r = el('div', 'linkrow'); host.querySelector('.panel-inner').append(r); return r; })();
    const b = mkBtn(id); btns.push(b);
    row.prepend(b); // start screen: CSS turns it into a corner pill on desktop (always visible, adds no height); mobile keeps it in the link row
  }
  const wd = initWardrobeUi({ game, openPanel: (w) => open(w) });
  const lab = () => { for (const b of btns) wd.decorate(b); };
  noteMeta({ ach: Object.keys(load().ach || {}), album: Object.keys(load().album || {}).length });
  lab(); onLang(lab);
  const eligibleNow = () => realRound() && !debugRound();
  ret = initRetention({ game, world, album, areaAt, toast, openPanel: open, eligibleNow, eligibleEnd: eligibleNow });

  const api = {
    wd, ret, album, defs, R, areas, total, areaTotal, open, close: shut, store: load, toast, buildRecap, makeCard, evalAch,
    get pct() { return { all: R.pctAll, me: R.pctMe }; },
    collectedCount: () => collectedCount(album),
    areaOfPlayer: () => (areaAt(game.player.x, game.player.z) || {}).id || null,
  };
  window.__meta = api;
  window.__retention = ret;
  return api;
}
