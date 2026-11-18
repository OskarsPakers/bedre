// Pure-Node tests for features 4 + 5: friend-room codes / protocol hygiene, skin id validation, player level + XP maths, unlock mapping from reward ids.
//   node scripts/test-f45.mjs      (also run by `npm run test:mp`)
import { SKINS, SLOTS, SKIN_COUNTS, ITEM_TOTAL, WEEK_ITEMS, cleanSkin, skinValid, botSkin } from '../src/skins.js';
import { levelOf, xpAt, xpToNext, roundXp, XP, MAX_LEVEL } from '../src/meta/level.js';
import { unlockedSet, weekCounts, key, sanitizeEquipped, ruleProgress } from '../src/meta/unlock.js';
import { parseClientMessage, makeCode, validCode, normCode, MP, mpConfig } from '../worker/mp/protocol.js';

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };

// ---- room codes ------------------------------------------------------------------------------------------------------------
const bits = Math.log2(MP.codeAlphabet.length) * MP.codeLen;
check('code space >= 30 bits', bits >= 30 && new Set(MP.codeAlphabet).size === MP.codeAlphabet.length, `(${bits} bits, ${MP.codeAlphabet.length} symbols)`);
check('alphabet has no ambiguous symbols (I O 0 1)', !/[IO01]/.test(MP.codeAlphabet));
const codes = new Set(); let allValid = true;
for (let i = 0; i < 5000; i++) { const c = makeCode(); codes.add(c); if (!validCode(c)) allValid = false; }
check('generated codes are valid and (practically) unique', allValid && codes.size > 4990, `${codes.size}/5000`);
const hist = {}; for (const c of codes) for (const ch of c) hist[ch] = (hist[ch] || 0) + 1;
const vals = Object.values(hist), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
check('symbols are uniformly drawn (no modulo bias)', vals.length === 32 && Math.max(...vals) < mean * 1.25 && Math.min(...vals) > mean * 0.75);
check('normCode / validCode', normCode(' ab-c d2e3 ') === 'ABCD2E' && validCode('ABCD2E') && !validCode('abcd2e') && !validCode('ABCDE') && !validCode('ABCDEI') && !validCode('ABCD0E') && !validCode('ABCD2EF'));
check('public room names can never be a private code (lower case) and vice versa', !validCode('abcdef') );

// ---- protocol: hello skins + private-room frames --------------------------------------------------------------------------------
const hello = (sk) => parseClientMessage(JSON.stringify({ t: 'hello', v: 3, name: 'x', token: 'abcdefghij', hash: 'abc', sk }));
check('hello: valid skin ids pass', JSON.stringify(hello([1, 2, 3]).sk) === '[1,2,3]');
check('hello: out-of-range / wrong type ids default to 0 per slot', JSON.stringify(hello([99, -1, 'x']).sk) === '[0,0,0]' && JSON.stringify(hello([9, 7, 8]).sk) === '[9,7,8]' && JSON.stringify(hello([10, 8, 9]).sk) === '[0,0,0]');
check('hello: missing / non-array / huge array -> default', JSON.stringify(hello(undefined).sk) === '[0,0,0]' && JSON.stringify(hello('1,2,3').sk) === '[0,0,0]' && JSON.stringify(hello({ 0: 1 }).sk) === '[0,0,0]' && JSON.stringify(hello([1, 1, 1, 1, 1, 1]).sk) === '[1,1,1]');
check('hello: floats / NaN / Infinity rejected', JSON.stringify(hello([1.5, null, 2]).sk) === '[0,0,2]');
check('cleanSkin / skinValid agree with SKIN_COUNTS', skinValid([9, 7, 8]) && !skinValid([10, 0, 0]) && !skinValid([0, 8, 0]) && !skinValid([0, 0, 9]) && !skinValid([0, 0]) && JSON.stringify(SKIN_COUNTS) === '[10,8,9]');
check('cfg frame: only 120 / 300, bots boolean', parseClientMessage('{"t":"cfg","len":120,"bots":false}').len === 120 && parseClientMessage('{"t":"cfg","len":123}').len === 300 && parseClientMessage('{"t":"cfg","len":300,"bots":false}').bots === false && parseClientMessage('{"t":"cfg","len":300}').bots === true);
check('go / rematch frames parse; unknown frames still ignored', parseClientMessage('{"t":"go"}').t === 'go' && parseClientMessage('{"t":"rematch"}').t === 'rematch' && parseClientMessage('{"t":"nope"}') === null);
check('private TTL has a test override only through env', mpConfig({}).privTtlMs === 15 * 60 * 1000 && mpConfig({ MP_PRIV_TTL_MS: '4000' }).privTtlMs === 4000);
check('bot skins: deterministic, valid, a little variety, no trails / tags', (() => { const seen = new Set(); for (let i = 0; i < 200; i++) { const a = botSkin(i, 3), b = botSkin(i, 3); if (JSON.stringify(a) !== JSON.stringify(b) || !skinValid(a) || a[1] || a[2]) return false; seen.add(a[0]); } return seen.size >= 3 && seen.has(0); })());

// ---- catalogue ----------------------------------------------------------------------------------------------------------------
check('catalogue size 18-24 non-default items across rim / trail / tag', ITEM_TOTAL >= 18 && ITEM_TOTAL <= 26, `(${ITEM_TOTAL}: ${SKIN_COUNTS.map((n, i) => SLOTS[i] + ' ' + (n - 1)).join(', ')})`);
check('every non-default item has an unlock rule, ids are dense, names LV + EN', SLOTS.every((s) => SKINS[s].every((it, i) => it.id === i && it.lv && it.en && (i === 0 ? !it.u : !!it.u))));
check('Latvian flag, amber, Daugava, gold, Art Nouveau and the Pelmenis joke exist as rims', ['flag', 'amber', 'daugava', 'gold', 'jugend', 'pelmenis'].every((k) => SKINS.rim.some((r) => r.key === k)));

// ---- level / XP -------------------------------------------------------------------------------------------------------------------
check('level curve: level 1 at 0 XP, strictly increasing, level 10 ~3.5k, level 30 ~65k', levelOf(0).level === 1 && xpAt(10) === 3564 && xpAt(30) === 65424 && [...Array(40)].every((_, i) => xpAt(i + 2) > xpAt(i + 1)));
check('levelOf is the inverse of xpAt (boundaries)', [2, 5, 10, 17, 30, 45].every((L) => levelOf(xpAt(L)).level === L && levelOf(xpAt(L) - 1).level === L - 1));
check('progress fraction inside a level', Math.abs(levelOf(xpAt(7) + xpToNext(7) / 2).frac - 0.5) < 0.01);
check('level cap and garbage input', levelOf(1e12).level === MAX_LEVEL && levelOf(1e12).frac === 1 && levelOf(-5).level === 1 && levelOf(NaN).level === 1 && levelOf('abc').level === 1);
const avg = roundXp({ eligible: true, mode: 'classic', rank: 4, total: 8, score: 30000, rewards: [], streak: 0 });
check('typical round pays ~110-170 XP -> level 10 in ~25 rounds', avg.total >= 110 && avg.total <= 170 && xpAt(10) / avg.total < 40, `(${avg.total} XP, ${(xpAt(10) / avg.total).toFixed(0)} rounds to level 10, ${(xpAt(30) / avg.total).toFixed(0)} to level 30)`);
const small = roundXp({ eligible: true, mode: 'quick', rank: 8, total: 8, score: 500, rewards: [], streak: 0 });
check('even a poor round pays at least the floor', small.total >= XP.min);
const p1 = roundXp({ eligible: true, mode: 'classic', rank: 1, total: 8, score: 100000, rewards: [], streak: 0 }), p2 = roundXp({ eligible: true, mode: 'classic', rank: 2, total: 8, score: 100000, rewards: [], streak: 0 }), p9 = roundXp({ eligible: true, mode: 'classic', rank: 9, total: 12, score: 100000, rewards: [], streak: 0 });
check('placement bonus: 1st > 2nd > no podium', p1.place === 40 && p2.place === 25 && p9.place === 0 && p1.total > p2.total && p2.total > p9.total);
const s1 = roundXp({ eligible: true, mode: 'classic', rank: 5, total: 8, score: 50000, rewards: [], streak: 0 }).score, s2 = roundXp({ eligible: true, mode: 'classic', rank: 5, total: 8, score: 5e6, rewards: [], streak: 0 }).score;
check('score part is log-scaled and capped (power players do not run away)', s2 <= XP.scoreCap && s2 < s1 * 3 && s1 > 0, `(50k -> ${s1}, 5M -> ${s2})`);
const wk = roundXp({ eligible: true, mode: 'classic', rank: 5, total: 8, score: 20000, rewards: ['week-2026-47-hard', 'week-2026-47-all', 'streak-7'], streak: 5 });
check('weekly goal + streak bonuses', wk.goals === XP.goal.hard + XP.goal.all && wk.streak === XP.streakBase + 5 * XP.streakPer && wk.total === wk.base + wk.place + wk.score + wk.goals + wk.streak);
check('NO XP in free roam, debug rounds, unknown modes', roundXp({ eligible: true, mode: 'free', rank: 1, total: 1, score: 9e5 }).total === 0 && roundXp({ eligible: false, mode: 'classic', rank: 1, total: 8, score: 9e5, rewards: ['week-2026-47-all'], streak: 9 }).total === 0 && roundXp({ eligible: true, mode: 'bogus', score: 9 }).total === 0 && roundXp(null).total === 0);
check('online and daily rounds pay XP', roundXp({ eligible: true, mode: 'online', rank: 2, total: 8, score: 40000 }).total > 0 && roundXp({ eligible: true, mode: 'daily', rank: 3, total: 8, score: 40000 }).total > 0);

// ---- unlocks ----------------------------------------------------------------------------------------------------------------------------
const ctx0 = { level: 1, rewards: [], ach: [], album: 0 };
const u0 = unlockedSet(ctx0);
check('level 1 owns only the defaults', u0.size === 3 && u0.has('0:0') && u0.has('1:0') && u0.has('2:0'));
check('level unlocks: flag at 2, amber at 4, aurora at 20, pastel tag at 16', !unlockedSet({ ...ctx0, level: 1 }).has('0:1') && unlockedSet({ ...ctx0, level: 2 }).has('0:1') && unlockedSet({ ...ctx0, level: 4 }).has('0:2') && !unlockedSet({ ...ctx0, level: 19 }).has('0:9') && unlockedSet({ ...ctx0, level: 20 }).has('0:9') && unlockedSet({ ...ctx0, level: 16 }).has('2:5'));
const streakMap = { 'streak-3': '2:2', 'streak-7': '1:2', 'streak-14': '2:4', 'streak-30': '0:4', 'streak-60': '2:7', 'streak-100': '1:7' };
check('every streak reward id unlocks its item', Object.entries(streakMap).every(([id, k]) => unlockedSet({ ...ctx0, rewards: [id] }).has(k) && !unlockedSet(ctx0).has(k)));
const hardIds = ['week-2025-50-hard', 'week-2026-03-hard', 'week-2026-47-hard'];
check('n-th weekly-hard completion unlocks the n-th item (past weeks count, extra weeks only XP)', (() => {
  const a = unlockedSet({ ...ctx0, rewards: hardIds.slice(0, 1) }), b = unlockedSet({ ...ctx0, rewards: hardIds.slice(0, 2) }), c = unlockedSet({ ...ctx0, rewards: hardIds });
  const [i1, i2] = WEEK_ITEMS.hard.map(([s, id]) => key(s, id));
  return a.has(i1) && !a.has(i2) && b.has(i1) && b.has(i2) && c.size === b.size;
})(), JSON.stringify(WEEK_ITEMS));
check('every weekly tier maps to at least one item; ids are counted once per week', ['easy', 'medium', 'hard', 'all'].every((tier) => WEEK_ITEMS[tier].length >= 1) && weekCounts(['week-2026-47-hard', 'week-2026-47-hard', 'week-2026-46-all', 'streak-3', 'bogus']).hard === 1 && weekCounts(['week-2026-46-all']).all === 1);
check('a FUTURE week id (e.g. 2031) is counted exactly like a past one', unlockedSet({ ...ctx0, rewards: ['week-2031-09-easy'] }).has(key(...WEEK_ITEMS.easy[0])));
check('achievement + album milestones unlock their items', unlockedSet({ ...ctx0, ach: ['combo2'] }).has('0:6') && !unlockedSet({ ...ctx0, album: 39 }).has('1:6') && unlockedSet({ ...ctx0, album: 40 }).has('1:6'));
check('everything is unlockable (each rule satisfiable) and a maxed device owns every item', unlockedSet({ level: 60, rewards: ['streak-3', 'streak-7', 'streak-14', 'streak-30', 'streak-60', 'streak-100', 'week-2026-01-easy', 'week-2026-01-medium', 'week-2026-01-hard', 'week-2026-02-hard', 'week-2026-01-all'], ach: ['combo2'], album: 100 }).size === SKIN_COUNTS.reduce((a, b) => a + b, 0));
check('sanitizeEquipped drops locked / unknown / garbage', (() => { const o = unlockedSet({ ...ctx0, level: 2 }); const e = sanitizeEquipped([1, 5, 99], o); return JSON.stringify(e) === '[1,0,0]' && JSON.stringify(sanitizeEquipped('x', o)) === '[0,0,0]' && JSON.stringify(sanitizeEquipped([1.5, null, -1], o)) === '[0,0,0]'; })());
check('ruleProgress for hints', ruleProgress({ t: 'lv', n: 10 }, { ...ctx0, level: 4 }).have === 4 && ruleProgress({ t: 'wk', tier: 'hard', n: 2 }, { ...ctx0, rewards: hardIds.slice(0, 1) }).have === 1 && ruleProgress({ t: 'alb', n: 40 }, { ...ctx0, album: 12 }).have === 12 && ruleProgress({ t: 'rw', id: 'x' }, ctx0) === null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
