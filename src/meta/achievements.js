// ~24 achievements (LV + EN). Each has a goal and a progress() reading either the live round state (ctx.R) or lifetime counters.
import { load, save } from './store.js';
import { lname, mt } from './strings.js';
import { getLang } from '../i18n.js';
import { comboRound } from '../combo.js';

/** ctx = { R: round state, album, st(): store, churchIds: Set(entry id), oldTown: area id|null, levelMax } */
export function makeDefs(ctx) {
  const { R } = ctx;
  const st = () => load();
  const alb = (id) => (st().album[id] ? 1 : 0);
  const total = ctx.album.entries.length;
  const D = (id, lv, en, dlv, den, goal, progress, hide) => ({ id, lv, en, dlv, den, goal, progress, hide });
  const list = [
    D('first', 'Pirmais kumoss', 'First Gulp', 'Norij savu pirmo ēku.', 'Swallow your first building.', 1, () => st().ctr.buildings || 0),
    D('quick', 'Ātrais starts', 'Quick Start', 'Norij ēku pirmajās 25 sekundēs.', 'Swallow a building within the first 25 seconds.', 1, () => (R.firstBuildingT != null && R.firstBuildingT <= 25 ? 1 : 0)),
    D('trams10', 'Tramvaju sastrēgums', 'Tram Jam', 'Norij 10 tramvajus vienā kārtā.', 'Swallow 10 trams in one round.', 10, () => R.kinds.tram || 0),
    D('cars50', 'Stāvvietu nav', 'No Parking', 'Norij 50 automašīnas vienā kārtā.', 'Swallow 50 cars in one round.', 50, () => R.kinds.car || 0),
    D('pigeons', 'Balodu problēma — atrisināta', 'Pigeon Problem, Solved', 'Norij 100 baložus (kopā).', 'Swallow 100 pigeons (lifetime).', 100, () => st().ctr.pigeons || 0),
    D('bigbot', 'Lielā zivs', 'Big Fish', 'Norij pretinieku, kura rādiuss ≥ 8 m.', 'Swallow a rival hole with a radius of 8 m or more.', 1, () => (R.bigBot ? 1 : 0)),
    D('twobots', 'Divi vienā', 'Two for One', 'Norij divus pretiniekus vienā kārtā.', 'Swallow two rival holes in one round.', 2, () => R.kills),
    D('churches', 'Zvanu klusums', 'Silent Bells', 'Norij visas Vecrīgas baznīcas vienā kārtā.', 'Swallow every Old Town church in one round.', Math.max(1, ctx.churchIds.size), () => R.churches.size, () => ctx.churchIds.size === 0),
    D('freedom', 'Brīvība — brokastīs', 'Freedom for Breakfast', 'Norij Brīvības pieminekli.', 'Swallow the Freedom Monument.', 1, () => (st().album.freedom && !st().album.freedom.hon ? 1 : 0), () => !ctx.album.entries.some((e) => e.id === 'freedom')),
    D('cat', 'Kaķis maisā', 'Cat in the Bag', 'Norij Kaķu namu.', 'Swallow the Cat House.', 1, () => alb('cat'), () => !ctx.album.entries.some((e) => e.id === 'cat')),
    D('laima', 'Laiks ir šokolāde', 'Time Is Chocolate', 'Norij Laimas pulksteni.', 'Swallow the Laima Clock.', 1, () => alb('laima'), () => !ctx.album.entries.some((e) => e.id === 'laima')),
    D('market', 'Tirgus diena', 'Market Day', 'Norij Centrāltirgus paviljonu.', 'Swallow a Central Market pavilion.', 1, () => alb('market'), () => !ctx.album.entries.some((e) => e.id === 'market')),
    D('pylon', 'Tilts bez pilona', 'Bridge Over Troubled Pylon', 'Norij Vanšu tilta pilonu.', 'Swallow a cable-bridge pylon.', 1, () => alb('pylon'), () => !ctx.album.entries.some((e) => e.id === 'pylon')),
    D('daugava', 'Pāri Daugavai', 'Across the Daugava', 'Apmeklē abus Daugavas krastus vienā kārtā.', 'Visit both banks of the Daugava in one round.', 2, () => R.banks.size),
    D('tourist', 'Apkaimju tūrists', 'Neighbourhood Tourist', 'Apmeklē 5 dažādas apkaimes vienā kārtā.', 'Visit 5 different neighbourhoods in one round.', 5, () => R.areas.size),
    D('oldtown', 'Vecrīga uz šķīvja', 'Old Town on a Plate', 'Norij vismaz 50% Vecrīgas vienā kārtā.', 'Swallow at least 50% of the Old Town in one round.', 50, () => Math.round(R.oldTownPct), () => !ctx.oldTown),
    D('slice', 'Rīgas šķēle', 'A Slice of Rīga', 'Norij 2% no visas kartes vienā kārtā.', 'Swallow 2% of the whole map in one round.', 2, () => Math.floor(R.pctMe * 10) / 10),
    D('lvl5', 'Izaugu', 'Growing Up', 'Sasniedz izmēru 5.', 'Reach size level 5.', 5, () => R.level),
    D('lvl8', 'Liela bedre', 'Big Pit', 'Sasniedz izmēru 8.', 'Reach size level 8.', 8, () => R.level),
    D('lvlmax', 'Bedre bez dibena', 'Bottomless', 'Sasniedz augstāko izmēru.', 'Reach the top size level.', ctx.levelMax, () => R.level),
    D('thousand', 'Divdesmit tūkstoši', 'Twenty Grand', 'Sasniedz 20 000 punktus vienā kārtā.', 'Score 20,000 points in one round.', 20000, () => Math.floor(R.score)),
    D('win', 'Bedru karalis', 'King of the Pit', 'Pabeidz kārtu 1. vietā.', 'Finish a round in 1st place.', 1, () => (R.won ? 1 : 0)),
    D('survivor', 'Sveiks un vesels', 'Safe and Sound', 'Pabeidz kārtu, ne reizi netiekot norītam.', 'Finish a round without being swallowed.', 1, () => (R.survived ? 1 : 0)),
    D('collector', 'Kolekcionārs', 'Collector', 'Savāc 10 objektus Rīgas albumā.', 'Collect 10 album objects.', 10, () => Object.keys(st().album).length),
    D('guide', 'Rīgas gids', 'Riga Guide', 'Savāc trīs ceturtdaļas albuma.', 'Collect three quarters of the album.', Math.max(1, Math.ceil(total * 0.75)), () => Object.keys(st().album).length),
    D('regular', 'Pastāvīgais klients', 'Regular', 'Nospēlē 10 kārtas.', 'Play 10 rounds.', 10, () => st().ctr.rounds || 0),
    // combos + power-ups (src/combo.js comboRound, kept up to date by the game; evaluated by the same eligibility rules as everything above: debug rounds never count)
    D('combo2', 'Ķēdes reakcija', 'Chain Reaction', 'Sasniedz ×2 kombo reizinātāju (25 objekti pēc kārtas).', 'Reach a ×2 combo multiplier (25 swallows in a row).', 2, () => comboRound.bestMult),
    D('combo3', 'Nepārtrauktā ķēde', 'Unbroken Chain', 'Sasniedz ×3 kombo reizinātāju (70 objekti pēc kārtas).', 'Reach the ×3 combo multiplier (70 swallows in a row).', 3, () => comboRound.bestMult),
    D('fullkit', 'Pilns komplekts', 'Full Kit', 'Savāc visus četrus pastiprinājumus vienā kārtā.', 'Collect all four power-ups in one round.', 4, () => comboRound.picked.size),
  ];
  return list;
}

export const achName = (d) => lname(d);
export const achDesc = (d) => (getLang() === 'lv' ? d.dlv : d.den);

/** Evaluate all defs; calls onUnlock(def) for each newly unlocked. */
export function evaluate(defs, onUnlock) {
  const s = load();
  let any = false;
  for (const d of defs) {
    if (s.ach[d.id]) continue;
    if (d.progress() >= d.goal && !(d.hide && d.hide())) {
      s.ach[d.id] = new Date().toISOString().slice(0, 10);
      any = true;
      onUnlock(d);
    }
  }
  if (any) save();
}

export function renderAchievements(root, defs) {
  root.replaceChildren();
  const s = load();
  const vis = defs.filter((d) => !(d.hide && d.hide()));
  const done = vis.filter((d) => s.ach[d.id]).length;
  const head = document.createElement('div'); head.className = 'mp-count'; head.textContent = mt('achCount', { n: done, total: vis.length });
  const bar = document.createElement('div'); bar.className = 'mp-bar'; const f = document.createElement('i'); f.style.width = `${(100 * done) / Math.max(1, vis.length)}%`; bar.append(f);
  const list = document.createElement('div'); list.className = 'mp-ach'; list.setAttribute('data-ach-list', '');
  for (const d of vis) {
    const got = !!s.ach[d.id];
    const row = document.createElement('div'); row.className = 'mp-arow' + (got ? ' got' : ''); row.dataset.id = d.id;
    const ic = document.createElement('span'); ic.className = 'mp-aic'; ic.textContent = got ? '★' : '☆';
    const body = document.createElement('div'); body.className = 'mp-abody';
    const n = document.createElement('div'); n.className = 'mp-aname'; n.textContent = achName(d);
    const ds = document.createElement('div'); ds.className = 'mp-adesc'; ds.textContent = achDesc(d);
    const pr = document.createElement('div'); pr.className = 'mp-aprog';
    const pb = document.createElement('div'); pb.className = 'mp-bar thin'; const pf = document.createElement('i');
    const val = got ? d.goal : Math.min(d.goal, d.progress());
    pf.style.width = `${(100 * val) / d.goal}%`; pb.append(pf);
    const pt = document.createElement('span'); pt.textContent = got ? mt('achDone') + ' · ' + s.ach[d.id] : mt('achProgress', { n: Math.floor(val), total: d.goal });
    pr.append(pb, pt);
    body.append(n, ds, pr);
    row.append(ic, body);
    list.append(row);
  }
  root.append(head, bar, list);
}
