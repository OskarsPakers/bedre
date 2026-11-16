import { readFileSync } from 'node:fs';
for (const f of ['src/i18n.js', 'src/meta/strings.js']) {
  const src = readFileSync(f, 'utf8');
  const m = /const S = (\{[\s\S]*?\n\});/.exec(src) || /(\{[\s\S]*\n\})/.exec(src);
  let S; try { S = new Function('return ' + m[1])(); } catch (e) { console.log(f, 'parse fail', e.message); continue; }
  const langs = Object.keys(S); console.log(f, langs, langs.map(l => Object.keys(S[l]).length));
  const [a, b] = langs;
  const ka = new Set(Object.keys(S[a])), kb = new Set(Object.keys(S[b]));
  console.log(' only', a, [...ka].filter(k => !kb.has(k)));
  console.log(' only', b, [...kb].filter(k => !ka.has(k)));
  const same = [...ka].filter(k => kb.has(k) && S[a][k] === S[b][k] && typeof S[a][k] === 'string' && S[a][k].length > 3);
  console.log(' identical lv/en (len>3)', same.map(k => k + '=' + S.lv[k]).slice(0, 40));
  // placeholders mismatch
  for (const k of ka) if (kb.has(k) && typeof S[a][k] === 'string') { const pa = (S[a][k].match(/\{\w+\}/g) || []).sort().join(), pb = (S[b][k].match(/\{\w+\}/g) || []).sort().join(); if (pa !== pb) console.log(' placeholder mismatch', k, pa, pb); }
}
