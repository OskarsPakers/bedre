// Top scores panel (Today / This week / All time) + About popover. Names are untrusted: textContent only.
import { fetchScores, lastSubmission } from './scores.js';
import { t, fmt, onLang } from './i18n.js';
import { getMode, twistName } from './modes.js';
import { dailyInfo, todayRiga } from './daily.js';
import { shiftDay } from './rules.js';

const $ = (id) => document.getElementById(id);

export function initScoresUi() {
  const panel = $('scores'), about = $('about'), body = $('ts-body'), msg = $('ts-msg'), table = $('ts-table');
  const tabs = [...panel.querySelectorAll('[data-period]')];
  let period = 'day', seq = 0, state = 'loading', rows = [];
  let smode = 'classic', dayPick = 0; // board mode; daily: 0 = today, -1 = yesterday

  // mode switch (+ daily day switch and the day's twist), built here so the markup stays in one place
  const tabsEl = panel.querySelector('.tabs');
  const mkRow = (cls, items, attr, onPick) => {
    const row = document.createElement('div'); row.className = 'tabs ' + cls; row.setAttribute('role', 'tablist');
    for (const [val, key] of items) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset[attr] = String(val); b.dataset.i18n = key;
      b.textContent = t(key); b.addEventListener('click', () => onPick(val)); row.append(b);
    }
    return row;
  };
  const modeRow = mkRow('ts-modes', [['classic', 'modeClassic'], ['quick', 'modeQuick'], ['daily', 'modeDaily'], ['online', 'modeOnline']], 'smode', (v) => { smode = v; load(); });
  const dayRow = mkRow('ts-days', [[0, 'tabDay'], [-1, 'tabYesterday']], 'dpick', (v) => { dayPick = +v; load(); });
  const twistEl = document.createElement('p'); twistEl.className = 'ts-twist';
  tabsEl.before(modeRow); tabsEl.after(dayRow, twistEl);
  const boardDay = () => shiftDay(todayRiga(), dayPick);

  const hasPanelOpen = () => !panel.classList.contains('hidden') || !about.classList.contains('hidden');

  function render() {
    body.replaceChildren();
    table.style.display = state === 'ok' ? '' : 'none';
    msg.style.display = state === 'ok' ? 'none' : '';
    if (state === 'loading') msg.textContent = t('loading');
    else if (state === 'offline') msg.textContent = t('offline');
    else if (state === 'empty') msg.textContent = t('empty');
    if (state !== 'ok') return;
    let mine = -1;
    if (lastSubmission && lastSubmission.mode === smode) mine = rows.findIndex((r) => r.name === lastSubmission.name && r.score === lastSubmission.score);
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (i === mine) tr.className = 'me';
      const cell = (txt) => { const td = document.createElement('td'); td.textContent = txt; return td; };
      const nameTd = cell(r.name);
      if (i === mine) nameTd.textContent = `${r.name} ◂ ${t('you')}`;
      tr.append(cell(String(i + 1)), nameTd, cell(fmt(r.score)), cell(`Ø ${(2 * (r.radius || 0)).toFixed(1)} m`));
      body.append(tr);
    });
    const me = body.querySelector('tr.me');
    if (me && me.scrollIntoView) me.scrollIntoView({ block: 'nearest' });
  }

  async function load() {
    const my = ++seq;
    state = 'loading'; rows = []; render();
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.period === period));
    for (const b of modeRow.children) b.setAttribute('aria-selected', String(b.dataset.smode === smode));
    for (const b of dayRow.children) b.setAttribute('aria-selected', String(+b.dataset.dpick === dayPick));
    const daily = smode === 'daily';
    tabsEl.style.display = daily ? 'none' : ''; dayRow.style.display = daily ? '' : 'none'; twistEl.style.display = daily ? '' : 'none';
    if (daily) twistEl.textContent = `${t('tsDaily', { day: boardDay() })} · ${t('tsTwist', { twist: twistName(dailyInfo(boardDay()).twist) })}`;
    const list = await fetchScores(period, 20, daily ? { mode: smode, day: boardDay() } : { mode: smode });
    if (my !== seq) return;
    if (list === null) state = 'offline';
    else if (!list.length) state = 'empty';
    else { state = 'ok'; rows = list; }
    render();
  }

  function openScores() {
    about.classList.add('hidden'); panel.classList.remove('hidden'); $('ts-close').focus();
    const m = lastSubmission ? lastSubmission.mode : getMode();
    smode = ['classic', 'quick', 'daily', 'online'].includes(m) ? m : 'classic';
    dayPick = 0;
    load();
  }
  function closeScores() { panel.classList.add('hidden'); seq++; }
  function openAbout() { panel.classList.add('hidden'); about.classList.remove('hidden'); $('ab-close').focus(); }
  function closeAbout() { about.classList.add('hidden'); }

  for (const id of ['open-scores', 'open-scores2']) $(id).addEventListener('click', openScores);
  $('open-about').addEventListener('click', openAbout);
  $('ts-close').addEventListener('click', closeScores);
  $('ab-close').addEventListener('click', closeAbout);
  for (const p of [panel, about]) p.addEventListener('pointerdown', (e) => { if (e.target === p) { closeScores(); closeAbout(); } });
  for (const b of tabs) b.addEventListener('click', () => { period = b.dataset.period; load(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hasPanelOpen()) { closeScores(); closeAbout(); e.stopPropagation(); }
  }, true);
  onLang(() => {
    for (const b of [...modeRow.children, ...dayRow.children]) b.textContent = t(b.dataset.i18n);
    if (!panel.classList.contains('hidden')) load();
  });
  return { hasPanelOpen, openScores, openAbout };
}
