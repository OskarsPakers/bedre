// Meta layer entry point: initMeta({ game, world }). Passive observer of the game through the event bus and world.onUpdate:
// album collection, achievements, % of Rīga swallowed, neighbourhood banner, round recap + share. Never touches gameplay.
import { CFG } from '../config.js';
import { bus } from '../events.js';
import { t, kindName, onLang, getLang } from '../i18n.js';
import { placeText } from '../hud.js';
import { mt, lname } from './strings.js';
import { load, save, saveSoon } from './store.js';
import { loadAreas, getAreas, areaAt } from './districts-names.js';
import { buildAlbum, collect, collectedCount, renderAlbum } from './album.js';
import { makeDefs, evaluate, renderAchievements, achName } from './achievements.js';
import { drawRecapMap, drawSpark, areaRows } from './recap.js';
import { renderCard, shareCard, copyLink, SITE } from './share.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const CSS = `
#meta-pct{position:absolute;top:84px;left:50%;transform:translateX(-50%);min-width:150px;background:rgba(246,239,223,.93);border-radius:10px;padding:4px 10px 6px;box-shadow:0 3px 10px rgba(43,34,24,.2);font-size:11px;font-weight:700;color:var(--ink2);text-align:center;pointer-events:none;white-space:nowrap}
#meta-pct b{color:var(--ink);font-variant-numeric:tabular-nums}#meta-pct b.me{color:var(--terra2)}
#meta-pct .bar2{height:5px;border-radius:4px;background:var(--cream2);margin-top:3px;position:relative;overflow:hidden}
#meta-pct .bar2 i{position:absolute;left:0;top:0;bottom:0;background:#8aa0b4;display:block}#meta-pct .bar2 i.me{background:var(--terra)}
#open-progress{position:absolute;top:6px;left:10px;padding:3px 9px;border-radius:999px;border:2px solid var(--cream2);font-size:11px;font-weight:800;letter-spacing:.04em;text-decoration:none;color:var(--ink2);background:transparent}#open-progress:hover{background:#fff;color:var(--terra2)}
@media (max-width:560px){#open-progress{position:static;border:0;font-size:14px;padding:6px 4px;color:var(--terra2);text-decoration:underline;text-underline-offset:3px}}
#meta-area{position:fixed;left:50%;top:116px;transform:translateX(-50%);z-index:20;pointer-events:none;text-align:center;color:#fff;text-shadow:0 2px 0 rgba(43,34,24,.5),0 0 14px rgba(0,0,0,.45);opacity:0}
#meta-area.show{animation:metaarea 2.8s ease-out forwards}#meta-area .an{display:inline;font-size:22px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}#meta-area .as{display:inline;margin-left:10px;font-size:12px;font-weight:700;letter-spacing:.1em;opacity:.92}
@keyframes metaarea{0%{opacity:0;transform:translate(-50%,-8px)}12%{opacity:1;transform:translate(-50%,0)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-4px)}}
#meta-toasts{position:fixed;left:50%;bottom:98px;transform:translateX(-50%);z-index:60;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;width:min(440px,calc(100vw - 24px))}
.meta-toast{pointer-events:auto;background:var(--slate);color:var(--cream);padding:9px 16px 9px 12px;border-radius:14px;font-weight:700;font-size:14px;box-shadow:var(--shadow);display:flex;gap:10px;align-items:center;animation:metat .35s ease-out;border-bottom:3px solid var(--terra)}
.meta-toast.out{opacity:0;transition:opacity .4s}.meta-toast i{font-style:normal;font-size:20px;line-height:1}.meta-toast button{font:inherit;font-weight:800;background:var(--terra);color:#fff;border:0;border-radius:8px;padding:4px 10px;cursor:pointer}
@keyframes metat{from{opacity:0;transform:translateY(10px)}}
#meta-panel{z-index:35;background:radial-gradient(ellipse at center,rgba(43,58,74,.55),rgba(30,38,48,.85))}
#meta-panel .panel-inner{max-width:580px;text-align:left}#meta-panel h2{text-align:center}
.mp-tabs{display:flex;gap:6px;justify-content:center;margin-bottom:10px}
.mp-tabs button{font:inherit;font-size:14px;font-weight:800;padding:6px 14px;border-radius:999px;border:2px solid var(--cream2);background:transparent;color:var(--ink2);cursor:pointer}
.mp-tabs button[aria-selected=true]{background:var(--slate);border-color:var(--slate);color:var(--cream)}
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
@media (max-width:560px){#meta-pct{min-width:0;width:98px;padding:3px 6px 5px;font-size:9.5px;top:82px}#meta-area{top:112px;white-space:nowrap}#meta-area .an{font-size:17px}#meta-area .as{display:none}.mp-grid{grid-template-columns:repeat(2,1fr)}#meta-toasts{bottom:84px}}
#meta-recap{margin:12px 0 14px;text-align:left}#meta-recap h3{margin:0 0 6px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
#meta-recap canvas{display:block;width:100%;height:auto;border-radius:10px;box-shadow:inset 0 0 0 2px var(--cream2)}
#meta-recap .rc-cap{font-size:11px;color:var(--ink2);font-weight:600;margin:3px 0 8px}
#meta-recap .rc-leg{display:flex;gap:12px;font-size:11px;font-weight:700;color:var(--ink2);margin-top:3px}.rc-leg i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:4px;vertical-align:middle}
#meta-recap .rc-big{font-size:15px;font-weight:800;margin:8px 0 4px;color:var(--slate)}
#meta-recap .rc-chips{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 8px}.rc-chip{background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;box-shadow:inset 0 0 0 2px var(--cream2)}.rc-chip b{color:var(--terra2)}
#meta-recap .rc-sec{font-size:12px;font-weight:800;color:var(--ink2);margin-top:6px}
#meta-recap .rc-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.btn.alt{background:var(--slate);box-shadow:0 4px 0 #1d2833;font-size:16px;padding:9px 22px}.btn.alt:hover:not(:disabled){box-shadow:0 3px 0 #1d2833}
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
  const resetRound = () => {
    Object.assign(R, {
      kinds: {}, buildings: 0, kills: 0, deaths: 0, bigBot: false, firstBuildingT: null, areas: new Set(), banks: new Set(), churches: new Set(),
      all: 0, me: 0, pctAll: 0, pctMe: 0, oldTownPct: 0, areaMe: new Float64Array(areas.length), areaAll: new Float64Array(areas.length),
      level: 1, score: 0, won: false, survived: false, samples: [], footprints: [], marks: [], newAlbum: [], newAch: [], curArea: null, curAt: -99,
    });
  };
  resetRound();
  const defs = makeDefs({ R, album, churchIds, oldTown: oldTown && oldTown.id, levelMax: CFG.levels.length });

  // ---- DOM: HUD meter, area banner, toasts -------------------------------------------------------------------
  const pct = el('div'); pct.id = 'meta-pct';
  const pctTxt = el('div'); const barBox = el('div', 'bar2'); const bAll = el('i'); const bMe = el('i', 'me'); barBox.append(bAll, bMe); pct.append(pctTxt, barBox);
  ($('hud') || document.body).appendChild(pct);
  const banner = el('div'); banner.id = 'meta-area'; const bn = el('div', 'an'); const bs = el('div', 'as'); banner.append(bn, bs); document.body.appendChild(banner);
  const toasts = el('div'); toasts.id = 'meta-toasts'; toasts.setAttribute('aria-live', 'polite'); document.body.appendChild(toasts);

  const fmtPct = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const drawPct = () => {
    pctTxt.replaceChildren();
    const a = el('span', '', mt('pctRiga') + ' '); const b1 = el('b', '', fmtPct(R.pctAll) + '%');
    const sep = el('span', '', ' · ' + mt('pctYou') + ' '); const b2 = el('b', 'me', fmtPct(R.pctMe) + '%');
    pctTxt.append(a, b1, sep, b2);
    bAll.style.width = Math.min(100, R.pctAll * 4) + '%'; bMe.style.width = Math.min(100, R.pctMe * 4) + '%';
    pct.dataset.all = R.pctAll.toFixed(3); pct.dataset.me = R.pctMe.toFixed(3);
  };
  drawPct();

  function toast(icon, text, opts = {}) {
    const d = el('div', 'meta-toast'); const i = el('i', '', icon); const s = el('span', '', text); d.append(i, s);
    if (opts.action) { const b = el('button', '', opts.action.label); b.type = 'button'; b.addEventListener('click', opts.action.fn); d.append(b); }
    toasts.append(d);
    while (toasts.children.length > 5) toasts.firstChild.remove();
    if (!opts.sticky) setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, opts.ms || 3800);
    return d;
  }
  window.__metaToast = toast;

  function showArea(a) {
    bn.textContent = lname(a);
    const i = areaIdx.get(a.id);
    const p = (100 * R.areaMe[i]) / Math.max(1, areaTotal[i]);
    bs.textContent = mt('areaIn', { n: fmtPct(p) });
    banner.dataset.area = a.id;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  }

  const unlockToast = (d) => { R.newAch.push(d.id); toast('★', mt('achUnlocked', { name: achName(d) }), { ms: 4600 }); };
  const evalAch = () => evaluate(defs, unlockToast);

  // ---- events --------------------------------------------------------------------------------------------------------
  const normKind = (k) => String(k || '').replace(/^person\d+$/, 'person');
  bus.on('roundStart', () => { resetRound(); drawPct(); });
  bus.on('swallow', (o, hole) => {
    R.all += o.value;
    const ai = objArea[o.id];
    if (ai >= 0) R.areaAll[ai] += o.value;
    if (!hole.isPlayer) return;
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
        toast('📖', mt('newAlbum', { name: lname(e), n: collectedCount(album), total: album.entries.length }));
        evalAch();
      }
    }
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
    const old = $('meta-recap'); if (old) old.remove();
    const sec = el('section'); sec.id = 'meta-recap';
    sec.append(el('h3', '', mt('recapTitle')));
    const rec = recapData();
    const map = el('canvas'); map.id = 'meta-recap-map'; drawRecapMap(map, rec, 560);
    sec.append(map, el('div', 'rc-cap', mt('recapMap')));
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
      for (const r of rows) { const c = el('span', 'rc-chip', lname(r.a) + ' '); c.append(el('b', '', fmtPct(r.pct) + '%')); ch.append(c); }
      sec.append(ch);
    }
    const list = (title, items) => {
      if (!items.length) return;
      sec.append(el('div', 'rc-sec', title));
      const ch = el('div', 'rc-chips');
      for (const s of items) ch.append(el('span', 'rc-chip', s));
      sec.append(ch);
    };
    const nAlb = el('div'); nAlb.id = 'meta-recap-new';
    list(mt('recapNewAlbum'), R.newAlbum.map((id) => lname(album.entries.find((e) => e.id === id))));
    list(mt('recapNewAch'), R.newAch.map((id) => achName(defs.find((d) => d.id === id))));
    const btns = el('div', 'rc-btns');
    const sb = el('button', 'btn alt', '⤴ ' + mt('share')); sb.type = 'button'; sb.id = 'meta-share';
    const cb = el('button', 'btn alt', mt('copyLink')); cb.type = 'button'; cb.id = 'meta-copy';
    sb.addEventListener('click', async () => {
      sb.disabled = true;
      try { const r = await shareCard(makeCard(), mt('shareText', { pct: fmtPct(R.pctMe), score: Math.floor(res.score) })); sb.dataset.result = r; } finally { sb.disabled = false; }
    });
    cb.addEventListener('click', async () => { const ok = await copyLink(); if (ok) toast('🔗', mt('copied'), { ms: 1800 }); });
    btns.append(sb, cb); sec.append(btns);
    const again = $('again'); if (again) again.before(sec); else $('results').firstElementChild.append(sec);
    recapInfo = true;
  }
  function makeCard() {
    const res = game._res;
    cardCanvas = cardCanvas || document.createElement('canvas');
    return renderCard(cardCanvas, recapData(), {
      name: game.player.name, score: Math.floor(res.score), rankText: placeText(res.rank, res.total),
      sizeText: `Ø ${(res.radius * 2).toFixed(1)} m`, biggest: res.biggest ? (res.biggest.name || kindName(res.biggest.kind)) : '—', pctMe: fmtPct(R.pctMe),
    });
  }

  bus.on('roundEnd', () => {
    banner.classList.remove('show');
    const res = game._res;
    const st = load();
    R.pctAll = (100 * R.all) / total; R.pctMe = (100 * R.me) / total;
    R.won = !!res && res.rank === 1;
    R.survived = R.deaths === 0;
    st.ctr.rounds++; if (R.won) st.ctr.wins++;
    const best = st.best; if (R.pctMe > (best.pct || 0)) best.pct = R.pctMe;
    if (res && res.score > (best.score || 0)) best.score = res.score;
    drawPct(); evalAch(); save();
    buildRecap();
  });
  bus.on('introStart', () => { const old = $('meta-recap'); if (old) old.remove(); recapInfo = null; });

  // ---- "My progress" panel + entry buttons ---------------------------------------------------------------------------
  const panel = el('div', 'panel hidden'); panel.id = 'meta-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  const inner = el('div', 'panel-inner'); const h2 = el('h2', '', mt('progTitle')); h2.id = 'mp-title';
  const tabs = el('div', 'mp-tabs'); tabs.setAttribute('role', 'tablist');
  const tbA = el('button', '', ''); tbA.type = 'button'; tbA.dataset.tab = 'album'; tbA.setAttribute('role', 'tab');
  const tbB = el('button', '', ''); tbB.type = 'button'; tbB.dataset.tab = 'ach'; tbB.setAttribute('role', 'tab');
  tabs.append(tbA, tbB);
  const body = el('div', 'mp-body'); body.id = 'mp-body';
  const close = el('button', 'btn small', ''); close.type = 'button'; close.id = 'mp-close';
  inner.append(h2, tabs, body, close); panel.append(inner); document.body.appendChild(panel);
  let tab = 'album';
  function renderTab() {
    h2.textContent = mt('progTitle'); close.textContent = mt('close');
    tbA.textContent = mt('tabAlbum'); tbB.textContent = mt('tabAch');
    tbA.setAttribute('aria-selected', String(tab === 'album')); tbB.setAttribute('aria-selected', String(tab === 'ach'));
    const top = body.scrollTop;
    if (tab === 'album') renderAlbum(body, album); else renderAchievements(body, defs);
    body.scrollTop = top;
  }
  const open = (which) => { if (which) tab = which; renderTab(); panel.classList.remove('hidden'); close.focus(); };
  const shut = () => panel.classList.add('hidden');
  tbA.addEventListener('click', () => { tab = 'album'; renderTab(); });
  tbB.addEventListener('click', () => { tab = 'ach'; renderTab(); });
  close.addEventListener('click', shut);
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) shut(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) { shut(); e.stopPropagation(); } }, true);

  const mkBtn = (id) => { const b = el('button', 'link', ''); b.type = 'button'; b.id = id; b.dataset.metaOpen = '1'; b.addEventListener('click', () => open()); return b; };
  const btns = [];
  for (const [sel, id] of [['#start', 'open-progress'], ['#results', 'open-progress2']]) {
    const host = document.querySelector(sel); if (!host) continue;
    const row = host.querySelector('.linkrow') || (() => { const r = el('div', 'linkrow'); host.querySelector('.panel-inner').append(r); return r; })();
    const b = mkBtn(id); btns.push(b);
    row.prepend(b); // start screen: CSS turns it into a corner pill on desktop (always visible, adds no height); mobile keeps it in the link row
  }
  const lab = () => { for (const b of btns) b.textContent = '★ ' + mt('myProgress'); };
  lab(); onLang(lab);

  const api = {
    album, defs, R, areas, total, areaTotal, open, close: shut, store: load, toast, buildRecap, makeCard, evalAch,
    get pct() { return { all: R.pctAll, me: R.pctMe }; },
    collectedCount: () => collectedCount(album),
    areaOfPlayer: () => (areaAt(game.player.x, game.player.z) || {}).id || null,
  };
  window.__meta = api;
  return api;
}
