// Shared UI glue for the panels: the collapsible start-screen "Options" section (district + theme), the results tabs,
// focus handling inside modal panels. Pure DOM; no gameplay code.
import { onLang, t } from './i18n.js';
import { bus } from './events.js';

const $ = (id) => document.getElementById(id);
const MODALS = ['meta-panel', 'scores', 'about', 'mp-lobby', 'pause', 'results', 'start'];
const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initUi() {
  // ---- start screen: options toggle + one-line summary (district · theme) -----------------------------------------
  const toggle = $('opts-toggle'), body = $('opts-body'), val = $('opts-val');
  const summary = () => {
    if (!val) return;
    const sel = $('map-select');
    const district = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    const th = document.querySelector('#themesw button[aria-pressed="true"]');
    val.textContent = [district, th ? th.textContent : ''].filter(Boolean).join(' · ');
  };
  const setOpen = (v) => {
    if (!toggle || !body) return;
    body.hidden = !v; toggle.setAttribute('aria-expanded', String(v));
    try { sessionStorage.setItem('bedre.opts', v ? '1' : '0'); } catch { /* ignore */ }
  };
  if (toggle && body) {
    toggle.addEventListener('click', () => setOpen(body.hidden));
    body.addEventListener('click', () => setTimeout(summary, 0));
    body.addEventListener('change', () => setTimeout(summary, 0));
    onLang(() => setTimeout(summary, 0));
    summary(); setTimeout(summary, 400); setTimeout(summary, 1500);
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
