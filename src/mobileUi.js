// Phone UI glue: the expandable leaderboard chip + minimap chip, and the touch / haptics / battery options in the start screen's
// "Advanced" section. Pure DOM; gameplay code is untouched.
import { t, extendStrings, onLang } from './i18n.js';
import { prefs, isTouch, isIos, isStandalone } from './mobile.js';

extendStrings({
  tsFail: 'Neizdevās pārbaudīt — mēģināt vēlreiz', saveFail: 'Nav saglabāts — mēģināt vēlreiz',
  ctlLbl: 'Vadība', ctlStick: 'Kursorsvira', ctlFinger: 'Pirksts',
  sensLbl: 'Jutīgums', sens1: 'Zema', sens2: 'Vidēja', sens3: 'Augsta',
  leftyLbl: 'Kreisās rokas izkārtojums', hapticsLbl: 'Vibrācija un pulsējošs gredzens', saveLbl: 'Taupīšanas režīms (30 kadri/s)', fsLbl: 'Pilnekrāns spēlējot',
  on: 'Ieslēgts', off: 'Izslēgts', minimapBtn: 'Karte', ctlHintStick: 'Pieskaries jebkur un velc: bedre seko īkšķa virzienam.', ctlHintFinger: 'Bedre dodas uz vietu, kur turi pirkstu.',
}, {
  tsFail: 'Could not verify — try again', saveFail: 'Not saved — try again',
  ctlLbl: 'Controls', ctlStick: 'Joystick', ctlFinger: 'Finger',
  sensLbl: 'Sensitivity', sens1: 'Low', sens2: 'Medium', sens3: 'High',
  leftyLbl: 'Left-handed layout', hapticsLbl: 'Vibration and ring pulse', saveLbl: 'Battery saver (30 fps)', fsLbl: 'Fullscreen while playing',
  on: 'On', off: 'Off', minimapBtn: 'Map', ctlHintStick: 'Touch anywhere and drag: the hole follows your thumb.', ctlHintFinger: 'The hole heads for where you hold your finger.',
});

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

/** Segmented control (same look as the other Advanced rows). */
function segmented(id, items, current, onPick) {
  const sw = mk('div', 'modesw'); sw.id = id; sw.setAttribute('role', 'radiogroup');
  for (const [val, key] of items) {
    const b = mk('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.val = String(val); b.dataset.k = key;
    b.addEventListener('click', () => { onPick(val); sync(); });
    sw.appendChild(b);
  }
  const sync = () => { for (const b of sw.children) { b.textContent = t(b.dataset.k); b.setAttribute('aria-checked', String(String(current()) === b.dataset.val)); } };
  sw.sync = sync; sync();
  return sw;
}
function toggle(id, labelKey, get, set, cls = '') {
  const row = mk('div', 'adv-block adv-sw ' + cls); row.id = id;
  const lab = mk('span', 'adv-lbl'), b = mk('button'); b.type = 'button';
  const sync = () => { lab.textContent = t(labelKey); const on = !!get(); b.textContent = on ? t('on') : t('off'); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', `${t(labelKey)}: ${on ? t('on') : t('off')}`); };
  b.addEventListener('click', () => { set(!get()); sync(); });
  row.append(lab, b); row.sync = sync; sync();
  return row;
}

export function initMobileUi() {
  // ---- Advanced: controls, sensitivity, left-handed, haptics, battery saver, fullscreen -------------------------------------
  const body = $('opts-body');
  if (body) {
    const blk = mk('div', 'adv-block'); blk.id = 'adv-touch';
    const style = document.createElement('style');
    style.textContent = 'body:not(.touch) .touch-only{display:none !important}';
    document.head.appendChild(style);
    const lblCtl = mk('span', 'adv-lbl touch-only'), lblSens = mk('span', 'adv-lbl touch-only'), hint = mk('p', 'mode-desc touch-only');
    const ctl = segmented('ctlsw', [['stick', 'ctlStick'], ['finger', 'ctlFinger']], () => prefs.control, (v) => prefs.set('control', v));
    const sens = segmented('senssw', [[1, 'sens1'], [2, 'sens2'], [3, 'sens3']], () => prefs.sens, (v) => prefs.set('sens', v));
    ctl.classList.add('touch-only'); sens.classList.add('touch-only');
    const lefty = toggle('leftysw', 'leftyLbl', () => prefs.lefty, (v) => prefs.set('lefty', v), 'touch-only');
    const hap = toggle('hapticssw', 'hapticsLbl', () => prefs.haptics, (v) => prefs.set('haptics', v), 'touch-only');
    const save = toggle('savesw', 'saveLbl', () => prefs.save30, (v) => prefs.set('save30', v));
    const fs = toggle('fssw', 'fsLbl', () => prefs.fullscreen, (v) => prefs.set('fs', v), 'touch-only');
    if (!(document.fullscreenEnabled && isTouch() && !isIos() && !isStandalone())) fs.hidden = true;
    const labels = () => { lblCtl.textContent = t('ctlLbl'); lblSens.textContent = t('sensLbl'); hint.textContent = t(prefs.control === 'stick' ? 'ctlHintStick' : 'ctlHintFinger'); };
    labels();
    blk.append(lblCtl, ctl, hint, lblSens, sens, lefty, hap, save, fs);
    blk.style.gap = '8px';
    const q = $('adv-quality');
    if (q && q.parentNode === body) q.after(blk); else body.appendChild(blk);
    const all = () => { labels(); ctl.sync(); sens.sync(); lefty.sync(); hap.sync(); save.sync(); fs.sync(); };
    onLang(all);
  }

  // ---- leaderboard chip: tap to expand, collapses by itself or on a tap elsewhere ------------------------------------------
  const board = $('board'), chip = $('board-chip');
  let boardTimer = 0;
  const closeBoard = () => { clearTimeout(boardTimer); board.classList.remove('open'); chip.setAttribute('aria-expanded', 'false'); };
  if (board && chip) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !board.classList.contains('open');
      board.classList.toggle('open', open); chip.setAttribute('aria-expanded', String(open));
      clearTimeout(boardTimer);
      if (open) boardTimer = setTimeout(closeBoard, 5000);
    });
  }

  // ---- minimap chip: round chip, tap to expand, tap again / tap outside to shrink -------------------------------------------
  const mm = $('minimap-box');
  const shrink = () => { if (mm) { mm.classList.remove('open'); mm.setAttribute('aria-expanded', 'false'); } };
  if (mm) {
    mm.setAttribute('role', 'button'); mm.setAttribute('aria-expanded', 'false');
    const lab = () => mm.setAttribute('aria-label', t('minimapBtn')); lab(); onLang(lab);
    const flip = () => { if (!document.body.classList.contains('tui')) return; const o = !mm.classList.contains('open'); mm.classList.toggle('open', o); mm.setAttribute('aria-expanded', String(o)); };
    mm.addEventListener('click', (e) => { e.stopPropagation(); flip(); });
    mm.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  }
  // a touch anywhere else (the play area included: it still steers) closes whichever chip is open
  document.addEventListener('pointerdown', (e) => {
    if (board && !board.contains(e.target)) closeBoard();
    if (mm && !mm.contains(e.target)) shrink();
  }, true);
  window.addEventListener('resize', () => { if (!document.body.classList.contains('tui')) { closeBoard(); shrink(); } });
}
