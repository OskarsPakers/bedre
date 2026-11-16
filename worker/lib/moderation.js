// Display-name moderation: no free-form HTML, a tiny LV/EN/RU profanity filter. The client renders names with
// textContent only; this is defence in depth, not the only line.
export const ANON = 'Anonīms';

// control chars, zero-width and bidi-override characters
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g');

// Deliberately small. `sub` entries match as substrings of the normalised name, `word` entries only as whole words.
const SUB = [
  // EN
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bitch', 'asshole', 'cocksuck', 'retard',
  // LV (diacritics stripped)
  'pizd', 'pidar', 'pidor', 'dirsa', 'dirsu', 'jebt', 'jebal', 'suds', 'suuds', 'kuce', 'bladj',
  // RU (cyrillic)
  'хуи', 'хуе', 'хуя', 'пизд', 'бляд', 'блят', 'ебан', 'ебат', 'ебла', 'пидор', 'пидар', 'мудак', 'гондон', 'залуп', 'сучка',
];
const WORD = ['ass', 'cock', 'dick', 'cum', 'sex', 'nazi', 'suka', 'сука', 'хер', 'жопа', 'гандон'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '€': 'e' };

function normalise(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[0134577@$!€]/g, (c) => LEET[c] || c);
}

export function isProfane(name) {
  const n = normalise(name);
  const letters = n.replace(/[^\p{L}]/gu, '');           // "f u c k", "f.u.c.k"
  const squeezed = letters.replace(/(\p{L})\1+/gu, '$1'); // "fuuuck"
  for (const w of SUB) if (n.includes(w) || letters.includes(w) || squeezed.includes(w)) return true;
  const words = n.split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => WORD.includes(w));
}

/**
 * Name policy (client preview + scores API + multiplayer all use this one function): names are only ever rendered with textContent, so
 * ordinary punctuation (& " ' ` \\ ...) is allowed. Removed: control / zero-width / bidi characters (-> space), and ANGLE BRACKETS only
 * (names also end up in logs, CSV / e-mail exports and admin tools where "<b>" could be interpreted as markup; nobody needs them in a nick).
 * Whitespace is collapsed, 1-16 characters, a small profanity filter replaces the name by "Anonīms".
 */
export function cleanName(raw) {
  return String(raw).normalize('NFC').replace(INVISIBLE, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** Clean + validate a display name. Returns the (possibly replaced by "Anonīms") name, or null if unusable. */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const s = cleanName(raw);
  const chars = [...s];
  if (chars.length < 1 || chars.length > 16) return null;
  return isProfane(s) ? ANON : s;
}

/** Free text like "biggest thing": strip, collapse, cap; profanity -> null. */
export function sanitizeLabel(raw, max = 40) {
  if (typeof raw !== 'string') return null;
  const s = [...cleanName(raw)].slice(0, max).join('');
  return s && !isProfane(s) ? s : null;
}
