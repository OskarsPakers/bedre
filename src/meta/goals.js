// Weekly goals tracker: three goals per ISO week (Monday 00:00 Riga time), picked deterministically from src/meta/goalPool.js.
// Progress is staged per round (live, for the HUD tick) and committed when an ELIGIBLE round ends (the same rule as the achievements:
// not free roam, opponents on the map, at least min(60 s, half the round) played, no debug hooks). A goal that reaches its target in
// the middle of an eligible round is completed at once (toast + reward); the rest of the round's numbers are committed at the end.
// Stored per device in the global store (src/meta/store.js `goals`), never per map. Unfinished goals simply expire with the week.
import { CFG } from '../config.js';
import { bus } from '../events.js';
import { getLang } from '../i18n.js';
import { getMode } from '../modes.js';
import { loadG, saveG, saveGSoon } from './store.js';
import { today, now, rigaMidnight } from './clock.js';
import { grantReward } from './rewards.js';
import { mt } from './strings.js';
import { POOL, byId, roundValue, goalText, fmtNum, weekKey, weekStart, pickGoals } from './goalPool.js';
import { shiftDay } from '../rules.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const TOAST_GAP_MS = 20000;

/** Gated templates are offered once the event was seen on this device or a CFG.features flag says the feature ships. */
const FEATURE_FLAGS = { comboBest: ['comboBest', 'combo', 'combos'], powerupPicked: ['powerupPicked', 'powerups', 'powerup'] };
const featureOn = (ev) => { const f = CFG.features; return !!f && (FEATURE_FLAGS[ev] || [ev]).some((k) => f[k]); };

export function initGoals({ game, world, album, areaAt, toast, eligibleNow, eligibleEnd }) {
  let c = null, adv = [], advAll = false, lastToastAt = -1e9, pending = [], lastLive = {}, indTimer = 0;
  const L = CFG.levels;
  const fresh = () => ({
    map: (CFG.map && CFG.map.slug) || 'centrs', mode: 'classic', kills: 0, level: 1, score: 0, banks: 0, bank: null, dist: 0, combo: 0, picks: 0,
    won: false, ended: false, rank: 0, acc: {}, sets: {},
  });
  c = fresh();
  const modeNow = () => (game.online || game.unranked === 'online' ? 'online' : getMode());

  // ---- the week ------------------------------------------------------------------------------------------------------
  const available = (tpl) => !tpl.needs || !!loadG().seen[tpl.needs] || featureOn(tpl.needs);
  /** Make sure the stored goals are those of the current ISO week (a clock that moved BACK keeps the stored week: no re-roll, no re-earning). */
  function ensureWeek(saltDay) {
    const g = loadG().goals, day = saltDay || today(), wk = weekKey(day);
    if (g.week && wk < g.week && !saltDay) return g;
    if (g.week !== wk || g.ids.length !== 3 || g.ids.some((id) => !byId(id))) {
      g.week = wk; g.ids = pickGoals(day, { available }).map((t) => t.id); g.prog = {}; g.done = {}; g.all = false;
      saveG();
    }
    return g;
  }
  const tpls = () => ensureWeek().ids.map(byId).filter(Boolean);
  const doneCount = () => { const g = ensureWeek(); return g.ids.filter((id) => g.done[id]).length; };

  /** Committed + live staged progress of a template (display units = raw units; `scale` only matters when printing). */
  function committed(tpl) {
    const p = ensureWeek().prog[tpl.id] || {};
    return tpl.type === 'days' ? (p.d || []).length : p.v || 0;
  }
  function liveValue(tpl) {
    const g = ensureWeek(), p = g.prog[tpl.id] || {};
    const staged = game.phase === 'playing' && eligibleNow() ? roundValue(tpl, { ...c, mode: modeNow() }) : 0;
    if (tpl.type === 'sum') return (p.v || 0) + staged;
    if (tpl.type === 'best') return Math.max(p.v || 0, staged);
    const d = p.d || [];
    return d.length + (staged > 0 && !d.includes(today()) ? 1 : 0);
  }
  const shown = (tpl, v) => (tpl.scale ? Math.round((v / tpl.scale) * 10) / 10 : Math.floor(v));
  const pct = (tpl, v) => Math.max(0, Math.min(1, v / tpl.target));
  const name = (tpl) => goalText(tpl, getLang());

  // ---- completion + toasts -------------------------------------------------------------------------------------------
  function goalToast(text, kind) {
    const t = performance.now();
    if (t - lastToastAt < TOAST_GAP_MS) return false;
    lastToastAt = t;
    toast(kind === 'done' ? '🎯' : '◔', text, { ms: kind === 'done' ? 4200 : 3000 });
    return true;
  }
  function complete(tpl, quiet) {
    const g = ensureWeek();
    if (g.done[tpl.id]) return;
    g.done[tpl.id] = today();
    grantReward(`week-${g.week}-${tpl.tier}`, 'goal');
    bus.emit('track', 'goal:done');
    if (g.ids.every((id) => g.done[id]) && !g.all) { g.all = true; grantReward(`week-${g.week}-all`, 'goals'); }
    saveG();
    if (!quiet) pending.push({ kind: 'done', tpl }); else pending.push({ kind: 'done', tpl, results: true });
    if (g.all && !pending.some((p) => p.kind === 'all')) pending.push({ kind: 'all' });
    flush();
  }
  /** Deferred toasts (rate limited to one per 20 s); while the results panel is up they wait for the next round. */
  function flush() {
    if (!pending.length) return;
    if (game.phase !== 'playing') return;
    const first = pending[0];
    const text = first.kind === 'all' ? mt('goalAll') : mt('goalDone', { name: name(first.tpl) });
    if (goalToast(text, 'done')) pending.shift();
  }

  /** Re-evaluate the live numbers: ticks the HUD indicator, completes goals that crossed their target, 50 % toasts. */
  function refresh() {
    if (game.phase !== 'playing') return;
    const g = ensureWeek(), list = tpls();
    const ok = eligibleNow();
    for (const tpl of list) {
      const v = liveValue(tpl), prev = lastLive[tpl.id] ?? committed(tpl);
      lastLive[tpl.id] = v;
      if (v > prev) tickIndicator(tpl.id);
      if (!ok || g.done[tpl.id]) continue;
      if (v >= tpl.target) { complete(tpl); continue; }
      const p = (g.prog[tpl.id] ||= {});
      if (tpl.type !== 'best' && tpl.target >= 3 && v >= tpl.target / 2 && !p.h && game.phase === 'playing') {
        if (goalToast(mt('goalHalf', { name: name(tpl) }), 'half')) { p.h = 1; saveGSoon(); }
      }
    }
    flush();
    drawIndicator();
  }

  let soon = 0;
  const refreshSoon = () => { if (!soon) soon = setTimeout(() => { soon = 0; refresh(); }, 100); };   // hundreds of swallows per frame: coalesce

  // ---- in-round indicator (three slim bars next to the % meter) ----------------------------------------------------
  const ind = el('div'); ind.id = 'rt-goalind'; ind.setAttribute('role', 'img');
  const pips = [0, 1, 2].map(() => { const p = el('span', 'pip'); p.append(el('i')); ind.append(p); return p; });
  ($('hud') || document.body).appendChild(ind);
  function $(id) { return document.getElementById(id); }
  function drawIndicator() {
    const g = ensureWeek(), list = tpls();
    pips.forEach((p, i) => {
      const tpl = list[i]; p.hidden = !tpl; if (!tpl) return;
      const done = !!g.done[tpl.id], v = liveValue(tpl);
      p.firstChild.style.width = `${Math.round(100 * (done ? 1 : pct(tpl, v)))}%`;
      p.classList.toggle('done', done); p.dataset.id = tpl.id; p.dataset.v = String(Math.round(v));
    });
    ind.setAttribute('aria-label', `${mt('goalsTitle')}: ${doneCount()}/3`);
    ind.title = list.map((t) => `${name(t)}: ${shown(t, liveValue(t))}/${shown(t, t.target)}`).join('\n');
  }
  function tickIndicator(id) {
    const p = pips.find((x) => x.dataset.id === id); if (!p) return;
    p.classList.remove('tick'); void p.offsetWidth; p.classList.add('tick');
    clearTimeout(indTimer); indTimer = setTimeout(() => pips.forEach((q) => q.classList.remove('tick')), 700);
  }

  // ---- events ----------------------------------------------------------------------------------------------------------
  const reset = () => { c = fresh(); lastLive = {}; ensureWeek(); drawIndicator(); };
  bus.on('roundStart', reset);
  bus.on('introStart', () => { reset(); adv = []; advAll = false; });
  bus.on('menu', () => { reset(); adv = []; advAll = false; });
  bus.on('swallow', (o, hole) => {
    if (!hole.isPlayer || game.phase !== 'playing') return;
    const e = album.byObj.get(o.id);
    const cc = { ...c, mode: modeNow() };
    for (const tpl of tpls()) {
      if (!tpl.sw) continue;
      // swallow counters only run for templates that apply to this map / mode; the counter lives in c.acc
      if ((tpl.maps && !tpl.maps.includes(c.map)) || (tpl.modes && !tpl.modes.includes(cc.mode))) continue;
      const n = tpl.sw(o, e, c);
      if (n) c.acc[tpl.id] = (c.acc[tpl.id] || 0) + n;
    }
    refreshSoon();
  });
  bus.on('holeEaten', ({ eater, victim } = {}) => { if (eater && eater.isPlayer && victim && !victim.isPlayer) { c.kills++; refreshSoon(); } });
  const num = (v) => (typeof v === 'number' ? v : v && typeof v === 'object' ? +(v.best ?? v.value ?? v.n ?? v.combo ?? v.count ?? 0) : 0);
  // gated events: remember on this device that the game emits them (offers the matching templates from the next week / first view)
  const seen = (ev) => { const g = loadG(); if (!g.seen[ev]) { g.seen[ev] = 1; saveGSoon(); } };
  bus.on('comboBest', (v) => { seen('comboBest'); c.combo = Math.max(c.combo, num(v) || 0); refreshSoon(); });
  bus.on('powerupPicked', () => { seen('powerupPicked'); c.picks++; refreshSoon(); });

  let tAcc = 0, lastPos = null;
  world.onUpdate.push((dt) => {
    if (game.phase !== 'playing') { lastPos = null; return; }
    const p = game.player;
    if (!p.alive) { lastPos = null; return; }
    if (lastPos) { const d = Math.hypot(p.x - lastPos.x, p.z - lastPos.z); if (d <= 90 * dt + 3) c.dist += d; }   // teleports are not distance
    lastPos = { x: p.x, z: p.z };
    tAcc += dt;
    if (tAcc < 0.25) return;
    tAcc = 0;
    const a = areaAt(p.x, p.z);
    if (a && a.bank) { if (c.bank && c.bank !== a.bank) c.banks++; c.bank = a.bank; }
    const r = p.targetRadius; let lv = 1; while (lv < L.length && r >= L[lv]) lv++; c.level = lv;
    c.score = p.score;
    refresh();
  });

  // ---- round end: commit ---------------------------------------------------------------------------------------------------
  /** Called from progress.js on roundEnd (before the recap is built). res = game._res. Returns the goals this round advanced. */
  function commit(res) {
    adv = []; advAll = false;
    const g = ensureWeek();
    c.mode = modeNow(); c.ended = true; c.rank = res ? res.rank : 0; c.won = !!res && res.rank === 1;
    if (eligibleEnd()) {
      const day = today();
      for (const tpl of tpls()) {
        const val = roundValue(tpl, c);
        if (val <= 0) continue;
        const before = committed(tpl), p = (g.prog[tpl.id] ||= {});
        if (tpl.type === 'sum') p.v = (p.v || 0) + val;
        else if (tpl.type === 'best') p.v = Math.max(p.v || 0, val);
        else { p.d = p.d || []; if (!p.d.includes(day)) p.d.push(day); }
        const after = committed(tpl);
        if (after > before) adv.push({ id: tpl.id, from: before, to: after });
        if (!g.done[tpl.id] && after >= tpl.target) { complete(tpl, true); }
      }
      saveG();
      advAll = g.all;
    }
    pending = pending.filter((q) => q.kind === 'all' || q.results);   // finished-late goals toast on the next round's start
    c.committed = true;
    drawIndicator();
    return adv;
  }
  // toasts that could not show while the results panel was up come out in the next round
  bus.on('roundGo', () => setTimeout(flush, 1500));

  // ---- rendering ----------------------------------------------------------------------------------------------------------
  function timeLeft() {
    const day = today(), end = rigaMidnight(shiftDay(weekStart(day), 7));
    const ms = Math.max(0, end - now()), h = Math.floor(ms / 3600e3), d = Math.floor(h / 24);
    return mt('timeLeft', { t: d >= 1 ? mt('timeD', { d, h: h % 24 }) : mt('timeH', { h, m: Math.floor((ms % 3600e3) / 60e3) }) });
  }
  const valText = (tpl, v) => `${fmtNum(shown(tpl, Math.min(v, tpl.target)), getLang())} / ${fmtNum(shown(tpl, tpl.target), getLang())}${tpl.unit ? ' ' + tpl.unit : ''}`;
  /** The "Weekly goals" card for the progress panel. */
  function renderCard(root) {
    const g = ensureWeek(), list = tpls();
    const card = el('section', 'rt-card'); card.id = 'rt-goals-card';
    const head = el('div', 'rt-head'); head.append(el('h3', '', mt('goalsTitle')), el('span', 'rt-left', timeLeft()));
    card.append(head);
    for (const tpl of list) {
      const done = !!g.done[tpl.id], v = done ? tpl.target : committed(tpl);
      const row = el('div', 'rt-goal' + (done ? ' done' : '')); row.dataset.id = tpl.id; row.dataset.tier = tpl.tier;
      const top = el('div', 'rt-gtop'); top.append(el('span', 'rt-tier t-' + tpl.tier, mt('tier_' + tpl.tier)), el('span', 'rt-gname', name(tpl)));
      const bar = el('div', 'mp-bar thin'); const f = el('i'); f.style.width = `${Math.round(100 * pct(tpl, v))}%`; bar.append(f);
      const val = el('span', 'rt-gval', done ? '✓ ' + mt('goalDoneTag') : valText(tpl, v));
      const pr = el('div', 'rt-gprog'); pr.append(bar, val);
      row.append(top, pr); card.append(row);
    }
    root.append(card);
  }
  /** "Goals advanced this round" list for the results screen. */
  function renderRound(root) {
    if (!adv.length) return false;
    const sec = el('div'); sec.id = 'rt-round-goals'; sec.append(el('div', 'rc-sec', mt('goalsRound')));
    const ch = el('div', 'rc-chips');
    const g = ensureWeek();
    for (const a of adv) {
      const tpl = byId(a.id); if (!tpl) continue;
      const done = !!g.done[tpl.id];
      const chip = el('span', 'rc-chip' + (done ? ' rt-done' : ''), (done ? '✓ ' : '') + name(tpl) + ' '); chip.dataset.id = tpl.id;
      if (!done) chip.append(el('b', '', valText(tpl, a.to)));
      ch.append(chip);
    }
    sec.append(ch); root.append(sec);
    return true;
  }

  return {
    ensureWeek, tpls, committed, liveValue, commit, renderCard, renderRound, doneCount, refresh, drawIndicator, timeLeft, available, flush,
    advancedCount: () => adv.length, advanced: () => adv.slice(),
    get ctx() { return c; },
  };
}
