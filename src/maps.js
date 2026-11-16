// Multi-map support: which district is loaded (?map=<slug> > localStorage bedre.map > centrs), its file URLs + balance multipliers,
// and the district picker on the start screen. Definitions live in tools/maps.mjs (shared with the build tools). One shared projection
// for every map, so a district is just another bounds rectangle in the same local frame.
import { CFG, LIFE, applyDifficulty, activeDifficulty } from './config.js';
import { MAPS, mapBySlug, mapPaths } from '../tools/maps.mjs';
import { getLang, onLang, t } from './i18n.js';

export { MAPS, mapPaths };
const KEY = 'bedre.map';

export function activeSlug() {
  let s = null;
  try { s = new URLSearchParams(location.search).get('map'); } catch { /* ignore */ }
  if (!s) { try { s = localStorage.getItem(KEY); } catch { /* storage blocked */ } }
  return MAPS.some((m) => m.slug === s) ? s : 'centrs';
}
export const isCentre = () => (CFG.map ? CFG.map.slug : activeSlug()) === 'centrs';

/** Point CFG at the selected map's files and apply its balance multipliers. Call once, before loading data / building the world. */
export function applyMap() {
  const m = mapBySlug(activeSlug());
  const p = mapPaths(m.slug);
  CFG.map = { slug: m.slug, lv: m.lv, en: m.en, mult: m.mult, focus: m.focus };
  CFG.dataUrl = p.data; CFG.shapesUrl = p.shapes; CFG.groundUrl = p.ground;
  if (m.slug !== 'centrs') {
    const k = m.mult || {};
    for (const key of ['people', 'lamps', 'benches', 'bins', 'cars', 'vans', 'buses', 'trams', 'kiosks']) CFG.props[key] = Math.round(CFG.props[key] * (k.props ?? 1));
    CFG.props.maxTrees = Math.round(CFG.props.maxTrees * (k.trees ?? 1));
    CFG.props.people = Math.round(CFG.props.people * (k.people ?? 1)); // extra small food around the player spawn (people are what a start hole eats first)
    CFG.value.buildingDiv *= k.value ?? 1;
    if (k.botSpeed) CFG.bots.speedCap = k.botSpeed;
    for (const key of ['cars', 'buses', 'trolleys', 'walkers', 'wanderers']) LIFE.movers[key] = Math.round(LIFE.movers[key] * (k.props ?? 1));
  }
  applyDifficulty(activeDifficulty());   // bot profile of the chosen level (+ this map's bot multiplier)
  document.body.dataset.map = m.slug;
  return m;
}

const $ = (id) => document.getElementById(id);
const nameOf = (m) => (getLang() === 'lv' ? m.lv : m.en);

/** District picker row on the start screen: thumbnail + labelled <select>. Switching = clean reload with ?map=. */
export function initMapPicker() {
  const anchor = $('opts-body');
  if (!anchor || $('mapsw')) return;
  const cur = activeSlug();
  const row = document.createElement('div');
  row.id = 'mapsw'; row.className = 'mapsw';
  row.innerHTML = '<img id="map-thumb" alt="" width="52" height="42" /><label><span id="map-label"></span><select id="map-select" aria-label="District"></select></label>';
  const after = $('adv-diff');
  if (after) after.after(row); else anchor.prepend(row);
  const sel = $('map-select'), img = $('map-thumb');
  const fill = () => {
    $('map-label').textContent = t('mapLabel');
    sel.innerHTML = '';
    for (const m of MAPS) { const o = document.createElement('option'); o.value = m.slug; o.textContent = nameOf(m); if (m.slug === cur) o.selected = true; sel.appendChild(o); }
  };
  fill(); onLang(fill);
  const setThumb = (slug) => { img.src = mapPaths(slug).thumb; img.hidden = false; img.onerror = () => { img.hidden = true; }; img.onload = () => { img.hidden = false; }; };
  setThumb(cur);
  sel.addEventListener('change', () => {
    const slug = sel.value;
    try { localStorage.setItem(KEY, slug); } catch { /* ignore */ }
    const u = new URL(location.href);
    u.searchParams.set('map', slug);
    location.href = u.toString();
  });
}

/** After the game exists: non-centre maps are unranked until the worker supports per-map boards; Online is centre-only. */
export function applyMapRules(game) {
  const slug = CFG.map && CFG.map.slug;
  if (!slug || slug === 'centrs') return;
  if (!CFG.mapsRanked) { game.urlUnranked = game.urlUnranked || 'map'; game.unranked = game.unranked || 'map'; }
  const hide = () => {
    const b = $('play-online'); if (b) b.style.display = 'none';
    const s = $('mp-status'); if (s) { s.textContent = t('mapOnlineNote'); s.classList.remove('ok'); }
  };
  hide(); setTimeout(hide, 600);
}
