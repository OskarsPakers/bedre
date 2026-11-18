// LV / EN strings for the meta features (kept out of i18n.js so other agents' edits there cannot collide).
import { getLang } from '../i18n.js';

const S = {
  lv: {
    myProgress: 'Mans progress', progTitle: 'Mans progress', tabAlbum: 'Rīgas objekti', tabAch: 'Sasniegumi', close: 'Aizvērt',
    albumCount: '{n} / {total} objekti', collectedOn: '✓ {d}', notYet: 'Vēl nenorīts', newAlbum: 'Jauns objekts albumā: {name} ({n}/{total})',
    achUnlocked: 'Sasniegums: {name}', achProgress: '{n} / {total}', achDone: 'Gatavs', achCount: '{n} / {total} sasniegumi',
    pctRiga: 'Rīga norīta', pctYou: 'tu', pctRigaShort: 'Rīga', pctYouShort: 'Tu', areaIn: '{n}% norīts',
    recapTitle: 'Kārtas pārskats', recapMap: 'Tava taka, norītās ēkas un pretinieki', recapGrowth: 'Izaugsme (rādiuss pret laiku)', recapYou: 'Tu', recapRival: 'Labākais pretinieks',
    recapRiga: 'Rīga norīta: {all}% (tu {me}%)', recapAreas: 'Apkaimes', recapNewAlbum: 'Jauni objekti albumā', recapNewAch: 'Jauni sasniegumi', recapNone: '—',
    share: 'Dalīties', shareDownload: 'Lejupielādēt attēlu', copyLink: 'Kopēt saiti', copied: 'Saite nokopēta', shared: 'Kopīgots', downloaded: 'Attēls lejupielādēts', copyFail: 'Neizdevās nokopēt', shareText: 'Es norīju {pct}% Rīgas spēlē BEDRE! Rezultāts: {score}.',
    shareTitle: 'BEDRE — Rīga', cardRank: '{n}. vieta no {total}', cardScore: 'punkti', cardBiggest: 'Lielākais norītais', cardSize: 'Izmērs', cardEaten: 'Rīgas norīts',
    cardTag: 'Norij Rīgu. Spēlē bez maksas.',
    newVersion: 'Jauna versija — pārlādēt', reload: 'Pārlādēt',
    radioBtn: 'Radio', radioOn: 'Radio ieslēgts', radioVol: 'Skaļums', radioErr: 'Straume nav pieejama', radioStop: 'Izslēgt radio', radioLoading: 'Savienojas…',
    radioBy: 'Tiešraide', radioStopLbl: 'Izslēgt',
    // ---- streak, weekly goals, rewards ----
    tabWeek: 'Nedēļa', streakTitle: 'Dienu sērija', streakNow: 'Sērija: {n} {days}', streakNone: 'Sērija vēl nav sākta — nospēlē kārtu.', streakBest: 'Labākā: {n}',
    streakDone: 'Šodien nospēlēts', streakOpen: 'Šodien vēl nav nospēlēts', streakAria: 'Sērija {n}. {today}',
    freezes: 'Sērijas atlaides: {n}/2', freezeHint: 'Atlaide automātiski nosedz vienu izlaistu dienu; jaunu iegūsti ik pēc 7 dienu sērijas.',
    streakRule: 'Dienu skaita kārta, kas beidzas tajā dienā (Rīgas laiks): Klasika, Ātrā, Dienas vai tiešsaiste, vismaz minūti.',
    streakExt: '{n} {days} pēc kārtas!', streakStart: 'Sērija sākta!', streakReset: 'Jauna sērija sākta.',
    freezeUsed: 'Atlaide nosedza izlaisto dienu.', freezeEarned: 'Jauna sērijas atlaide!', streakMile: '{n} dienu sērija!',
    goalsTitle: 'Nedēļas mērķi', goalsLbl: 'Mērķi', goalsChip: 'Mērķi {n}/3', goalsAria: 'Nedēļas mērķi: {n} no 3 izpildīti', timeLeft: 'Vēl {t}', timeD: '{d} d {h} st.', timeH: '{h} st. {m} min',
    tier_easy: 'Viegls', tier_medium: 'Vidējs', tier_hard: 'Grūts', goalDone: 'Nedēļas mērķis izpildīts: {name}', goalHalf: 'Pusceļā: {name}', goalAll: 'Visi nedēļas mērķi izpildīti!',
    goalsRound: 'Nedēļas mērķi šajā kārtā', goalsNone: 'Šī kārta mērķus nevirzīja.', goalDoneTag: 'izpildīts',
    rwTitle: 'Balvas', rwNone: 'Vēl nav balvu — tās atver sērija un nedēļas mērķi.', rwStreak: '{n} dienu sērija', rwWeek: 'Nedēļas mērķis ({tier}) · {w}. ned.', rwAll: 'Visi nedēļas mērķi · {w}. ned.',
    cardStreak: 'Sērija {n} d.', cardGoals: 'Mērķi {n}/3',
  },
  en: {
    myProgress: 'My progress', progTitle: 'My progress', tabAlbum: 'Rīga objects', tabAch: 'Achievements', close: 'Close',
    albumCount: '{n} / {total} objects', collectedOn: '✓ {d}', notYet: 'Not swallowed yet', newAlbum: 'New in album: {name} ({n}/{total})',
    achUnlocked: 'Achievement: {name}', achProgress: '{n} / {total}', achDone: 'Done', achCount: '{n} / {total} achievements',
    pctRiga: 'Rīga swallowed', pctYou: 'you', pctRigaShort: 'Rīga', pctYouShort: 'You', areaIn: '{n}% swallowed',
    recapTitle: 'Round recap', recapMap: 'Your trail, swallowed buildings and rivals', recapGrowth: 'Growth (radius over time)', recapYou: 'You', recapRival: 'Best rival',
    recapRiga: 'Rīga swallowed: {all}% (you {me}%)', recapAreas: 'Neighbourhoods', recapNewAlbum: 'New in the album', recapNewAch: 'New achievements', recapNone: '—',
    share: 'Share', shareDownload: 'Download image', copyLink: 'Copy link', copied: 'Link copied', shared: 'Shared', downloaded: 'Image downloaded', copyFail: 'Could not copy', shareText: 'I swallowed {pct}% of Rīga in BEDRE! Score: {score}.',
    shareTitle: 'BEDRE — Rīga', cardRank: '{n} of {total}', cardScore: 'points', cardBiggest: 'Biggest thing', cardSize: 'Size', cardEaten: 'of Rīga swallowed',
    cardTag: 'Swallow Rīga. Free to play.',
    newVersion: 'New version — reload', reload: 'Reload',
    radioBtn: 'Radio', radioOn: 'Radio on', radioVol: 'Volume', radioErr: 'Stream unavailable', radioStop: 'Turn radio off', radioLoading: 'Connecting…',
    radioBy: 'Live', radioStopLbl: 'Stop',
    // ---- streak, weekly goals, rewards ----
    tabWeek: 'Week', streakTitle: 'Daily streak', streakNow: 'Streak: {n} {days}', streakNone: 'No streak yet — finish a round.', streakBest: 'Best: {n}',
    streakDone: 'Played today', streakOpen: 'Not played today yet', streakAria: 'Streak {n}. {today}',
    freezes: 'Streak freezes: {n}/2', freezeHint: 'A freeze automatically covers one missed day; you earn a new one every 7-day streak.',
    streakRule: 'A round that ENDS on a day counts for it (Riga time): Classic, Quick, Daily or online, at least a minute.',
    streakExt: '{n} days in a row!', streakStart: 'Streak started!', streakReset: 'A new streak begins.',
    freezeUsed: 'A freeze covered your missed day.', freezeEarned: 'New streak freeze!', streakMile: '{n}-day streak!',
    goalsTitle: 'Weekly goals', goalsLbl: 'Goals', goalsChip: 'Goals {n}/3', goalsAria: 'Weekly goals: {n} of 3 done', timeLeft: 'Left: {t}', timeD: '{d}d {h}h', timeH: '{h}h {m}m',
    tier_easy: 'Easy', tier_medium: 'Medium', tier_hard: 'Hard', goalDone: 'Weekly goal done: {name}', goalHalf: 'Halfway: {name}', goalAll: 'All weekly goals done!',
    goalsRound: 'Weekly goals this round', goalsNone: 'This round did not move any goal.', goalDoneTag: 'done',
    rwTitle: 'Rewards', rwNone: 'No rewards yet — streaks and weekly goals unlock them.', rwStreak: '{n}-day streak', rwWeek: 'Weekly goal ({tier}) · week {w}', rwAll: 'All weekly goals · week {w}',
    cardStreak: 'Streak {n} d.', cardGoals: 'Goals {n}/3',
  },
};

export function mt(key, vars) {
  const l = getLang();
  let s = (S[l] && S[l][key]) ?? S.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
  return s;
}
export const lname = (o) => (getLang() === 'lv' ? o.lv : o.en) || o.lv || o.en;

/** Official Latvian name of a neighbourhood in BOTH languages ("Maskavas forštate", not "Moscow Suburb"); Vecrīga keeps "Old Town" as an English subtitle only. */
export const aname = (a) => a.lv || a.en;
export const asub = (a) => (getLang() === 'en' && /^(vecpilseta|vecriga)$/.test(a.id || '') ? 'Old Town' : '');
