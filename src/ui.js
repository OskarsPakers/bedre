// Shared UI glue for the panels: the collapsible start-screen "Options" section (district + theme), the results tabs,
// focus handling inside modal panels. Pure DOM; no gameplay code.
import { onLang, t, extendStrings } from './i18n.js';
import { bus } from './events.js';
import { CFG, DEFAULT_DIFFICULTY } from './config.js';
import { getMode, getDifficulty } from './modes.js';
import { isCentre } from './maps.js';
import { dailyUsed, dailyInfo, todayRiga } from './daily.js';
import { qualityChoice, rememberQuality } from './quality.js';

const $ = (id) => document.getElementById(id);
const MODALS = ['meta-panel', 'scores', 'about', 'mp-lobby', 'pause', 'results', 'start'];
const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

extendStrings({
  modeLbl: 'Spēles režīms', qualLbl: 'Grafika', qualAuto: 'Auto', qualLow: 'Zema', qualMedium: 'Vidēja', qualHigh: 'Augsta',
  dailyDot: 'Šodienas izaicinājums vēl nav spēlēts',
}, {
  modeLbl: 'Game mode', qualLbl: 'Graphics', qualAuto: 'Auto', qualLow: 'Low', qualMedium: 'Medium', qualHigh: 'High',
  dailyDot: "Today's daily challenge is not played yet",
});
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function initUi() {
  // ---- start screen: "Advanced" disclosure + a chip that names every choice that differs from the defaults ------------------
  const toggle = $('opts-toggle'), body = $('opts-body'), val = $('opts-val'), dot = $('opts-dot');
  const summary = () => {
    if (!val) return;
    const parts = [];
    if (getMode() !== 'classic') parts.push(t('mode' + cap(getMode())));
    if (getDifficulty() !== DEFAULT_DIFFICULTY) parts.push(t('diff' + cap(getDifficulty())));
    if (CFG.map && CFG.map.slug !== 'centrs') { const sel = $('map-select'); parts.push(sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : CFG.map.slug); }
    const th = document.querySelector('#themesw button[aria-pressed="true"]');
    if (th && th.dataset.theme !== 'auto') parts.push(th.textContent);
    const q = qualityChoice();
    if (q) parts.push(t('qual' + cap(q)));
    val.textContent = parts.join(' · ');
    val.classList.toggle('on', parts.length > 0);
    // a quiet dot while today's daily challenge is still unplayed (centre map only)
    const open = isCentre() && getMode() !== 'daily' && !dailyUsed(dailyInfo(todayRiga()).day);
    if (dot) { dot.hidden = !open; dot.title = open ? t('dailyDot') : ''; }
    const db = document.querySelector('#modesw [data-mode="daily"]'); if (db) db.classList.toggle('fresh', open);
    const qs = qualityChoice() || 'auto';
    for (const b of document.querySelectorAll('#qualsw [data-quality]')) b.setAttribute('aria-checked', String(b.dataset.quality === qs));
  };
  const setOpen = (v) => {
    if (!toggle || !body) return;
    body.hidden = !v; toggle.setAttribute('aria-expanded', String(v));
    body.closest('.start-card')?.classList.toggle('adv-open', v);
    try { sessionStorage.setItem('bedre.opts', v ? '1' : '0'); } catch { /* ignore */ }
  };
  if (toggle && body) {
    try { if (sessionStorage.getItem('bedre.opts') === '1') setOpen(true); } catch { /* ignore */ }   // remembered for this session only
    toggle.addEventListener('click', () => setOpen(body.hidden));
    body.addEventListener('click', () => setTimeout(summary, 0));
    body.addEventListener('change', () => setTimeout(summary, 0));
    onLang(() => setTimeout(summary, 0));
    bus.on('modeChange', summary); bus.on('difficultyChange', summary);
    summary(); setTimeout(summary, 400); setTimeout(summary, 1500);
    // graphics: remembered, applied on the next load (the ground textures are built before the first frame)
    for (const b of document.querySelectorAll('#qualsw [data-quality]')) b.addEventListener('click', () => {
      const v = b.dataset.quality;
      if (v === (qualityChoice() || 'auto')) return;
      rememberQuality(v);
      const u = new URL(location.href);
      u.searchParams.delete('quality');
      if (v !== 'auto' && new URLSearchParams(location.search).has('quality')) u.searchParams.set('quality', v);
      u.searchParams.set('mode', getMode()); u.searchParams.set('difficulty', getDifficulty());
      location.href = u.toString();
    });
  }

  // ---- results tabs: Result / Map / Progress --------------------------------------------------------------------------
  const tabs = [...document.querySelectorAll('#rtabs [data-rt]')];
  const showTab = (name) => {
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.rt === name));
    for (const p of document.querySelectorAll('#results .rpane')) p.hidden = p.dataset.pane !== name;
  };
  for (const b of tabs) b.addEventListener('click', () => showTab(b.dataset.rt));
  bus.on('roundEnd', () => showTab('score'));
  bus.on('introStart', () => showTab('score'));

  // ---- focus: Tab stays inside the visible panel ------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const id = MODALS.find((m) => { const el = $(m); return el && !el.classList.contains('hidden'); });
    if (!id) return;
    const items = [...$(id).querySelectorAll(TABBABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    if (!$(id).contains(a)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  });
  window.__ui = { openOptions: () => setOpen(true), closeOptions: () => setOpen(false), showTab, summary };
  return window.__ui;
}
