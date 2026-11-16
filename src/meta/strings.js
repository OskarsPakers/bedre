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
    share: 'Dalīties', shareDownload: 'Lejupielādēt attēlu', copyLink: 'Kopēt saiti', copied: 'Saite nokopēta', shareText: 'Es norīju {pct}% Rīgas spēlē BEDRE! Rezultāts: {score}.',
    shareTitle: 'BEDRE — Rīga', cardRank: '{n}. vieta no {total}', cardScore: 'punkti', cardBiggest: 'Lielākais norītais', cardSize: 'Izmērs', cardEaten: 'Rīgas norīts',
    cardTag: 'Norij Rīgu. Spēlē bez maksas.',
    newVersion: 'Jauna versija — pārlādēt', reload: 'Pārlādēt',
    radioBtn: 'Radio', radioOn: 'Radio ieslēgts', radioVol: 'Skaļums', radioErr: 'Straume nav pieejama', radioStop: 'Izslēgt radio', radioLoading: 'Savienojas…',
    radioBy: 'Tiešraide', radioStopLbl: 'Izslēgt',
  },
  en: {
    myProgress: 'My progress', progTitle: 'My progress', tabAlbum: 'Rīga objects', tabAch: 'Achievements', close: 'Close',
    albumCount: '{n} / {total} objects', collectedOn: '✓ {d}', notYet: 'Not swallowed yet', newAlbum: 'New in album: {name} ({n}/{total})',
    achUnlocked: 'Achievement: {name}', achProgress: '{n} / {total}', achDone: 'Done', achCount: '{n} / {total} achievements',
    pctRiga: 'Rīga swallowed', pctYou: 'you', pctRigaShort: 'Rīga', pctYouShort: 'You', areaIn: '{n}% swallowed',
    recapTitle: 'Round recap', recapMap: 'Your trail, swallowed buildings and rivals', recapGrowth: 'Growth (radius over time)', recapYou: 'You', recapRival: 'Best rival',
    recapRiga: 'Rīga swallowed: {all}% (you {me}%)', recapAreas: 'Neighbourhoods', recapNewAlbum: 'New in the album', recapNewAch: 'New achievements', recapNone: '—',
    share: 'Share', shareDownload: 'Download image', copyLink: 'Copy link', copied: 'Link copied', shareText: 'I swallowed {pct}% of Rīga in BEDRE! Score: {score}.',
    shareTitle: 'BEDRE — Rīga', cardRank: '{n} of {total}', cardScore: 'points', cardBiggest: 'Biggest thing', cardSize: 'Size', cardEaten: 'of Rīga swallowed',
    cardTag: 'Swallow Rīga. Free to play.',
    newVersion: 'New version — reload', reload: 'Reload',
    radioBtn: 'Radio', radioOn: 'Radio on', radioVol: 'Volume', radioErr: 'Stream unavailable', radioStop: 'Turn radio off', radioLoading: 'Connecting…',
    radioBy: 'Live', radioStopLbl: 'Stop',
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
