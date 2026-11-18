var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/combo.js
var RULES_VERSION = 2;
var COMBO = {
  window: 1.6,
  // s: a combo survives this long without a swallow ...
  windowGrow: 0.011,
  // ... plus this much per metre of hole radius beyond `windowFrom` (targets are further apart for a big hole) ...
  windowFrom: 8,
  windowMax: 2.6,
  // ... up to this
  // [counter, multiplier]: the multiplier of the highest step reached
  steps: [[0, 1], [5, 1.2], [12, 1.5], [25, 2], [45, 2.5], [70, 3]],
  cap: 5,
  // combo x power-up (Dubultpunkti) never exceeds this
  maxWeight: 4,
  // most a single swallow adds to the counter
  stampJitter: 0.35,
  // s: most a client's claim timeline may gain on the server's receipt timeline between two claim batches (delivery jitter; bounds what a faked RTT can buy)
  netSlack: 0.25
  // s: extra window the SERVER grants for clock-sync error between client timestamps and its own clock (online)
};
var COMBO_MAX_MULT = COMBO.steps[COMBO.steps.length - 1][1];
var comboWindow = /* @__PURE__ */ __name((radius) => Math.min(COMBO.windowMax, COMBO.window + Math.max(0, radius - COMBO.windowFrom) * COMBO.windowGrow), "comboWindow");
function multFor(count) {
  let m = 1;
  for (const [n, v] of COMBO.steps) if (count >= n) m = v;
  else break;
  return m;
}
__name(multFor, "multFor");
function comboWeight(isBuilding, fit, value) {
  if (isBuilding) return fit < 7 ? 2 : fit < 14 ? 3 : 4;
  return value >= 40 ? 2 : 1;
}
__name(comboWeight, "comboWeight");
var totalMult = /* @__PURE__ */ __name((comboMult, doubleMul2 = 1) => Math.min(COMBO.cap, comboMult * doubleMul2), "totalMult");
var Combo = class {
  static {
    __name(this, "Combo");
  }
  constructor() {
    this.reset();
  }
  reset() {
    this.count = 0;
    this.mult = 1;
    this.until = 0;
    this.best = 0;
    this.bestMult = 1;
  }
  /** Drop the running combo (death / respawn); round records stay. */
  drop() {
    this.count = 0;
    this.mult = 1;
    this.until = 0;
  }
  /** Per-frame: true when the running combo has just run out (returns the lost count, else 0). */
  tick(now2) {
    if (this.count > 0 && now2 > this.until) {
      const lost = this.count;
      this.drop();
      return lost;
    }
    return 0;
  }
  /**
   * A swallow happened at `now`. Returns { mult, step } (step: the multiplier just stepped up). `slack` = extra window seconds (server).
   * Order matters: the counter rises first, the multiplier of the NEW counter applies to this swallow.
   */
  hit(now2, weight, radius, slack = 0) {
    if (this.count > 0 && now2 > this.until) this.drop();
    this.count += weight;
    const prev = this.mult;
    this.mult = multFor(this.count);
    this.until = now2 + comboWindow(radius) + slack;
    if (this.count > this.best) this.best = this.count;
    if (this.mult > this.bestMult) this.bestMult = this.mult;
    return { mult: this.mult, step: this.mult > prev };
  }
  /** 0..1 of the running window left (UI ring); 0 when idle. */
  left(now2, radius) {
    return this.count > 0 ? Math.max(0, Math.min(1, (this.until - now2) / comboWindow(radius))) : 0;
  }
};

// ../src/rules.js
var START_RADIUS = 2.2;
var GROWTH_EXP = 0.44;
var MODES = {
  classic: { seconds: 300, growthK: 16, bots: 7, holes: 8, client: true, ranked: true },
  quick: { seconds: 120, growthK: 6, bots: 7, holes: 8, client: true, ranked: true },
  daily: { seconds: 300, growthK: 16, bots: 7, holes: 11, client: true, ranked: true },
  free: { seconds: 0, growthK: 16, bots: 0, holes: 1, client: false, ranked: false },
  online: { seconds: 0, growthK: 16, bots: 0, holes: 16, client: false, ranked: true }
};
var DIFFICULTIES = ["easy", "normal", "hard"];
var CLIENT_MODES = ["classic", "quick", "daily"];
var BOARD_MODES = ["classic", "quick", "daily", "online"];
var TRACE_STEP = 10;
var TRACE_MAX = 40;
function radiusAt(score, k = 16, r0 = START_RADIUS, exp = GROWTH_EXP) {
  return r0 * Math.pow(1 + score / k, exp);
}
__name(radiusAt, "radiusAt");
var growthK = /* @__PURE__ */ __name((mode) => (MODES[mode] || MODES.classic).growthK, "growthK");
var radiusForMode = /* @__PURE__ */ __name((score, mode) => radiusAt(score, growthK(mode)), "radiusForMode");
function rigaDay(tsSec) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Riga", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(tsSec * 1e3));
  const g = /* @__PURE__ */ __name((t) => parts.find((p) => p.type === t).value, "g");
  return `${g("year")}-${g("month")}-${g("day")}`;
}
__name(rigaDay, "rigaDay");
var isDayString = /* @__PURE__ */ __name((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")), "isDayString");
function shiftDay(day, delta) {
  const d = /* @__PURE__ */ new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
__name(shiftDay, "shiftDay");
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
__name(hashSeed, "hashSeed");
var dailySeed = /* @__PURE__ */ __name((day) => hashSeed(`bedre-daily|${day}`), "dailySeed");

// ../tools/maps.mjs
var ORIGIN = { lat: 56.9515, lon: 24.1133 };
var M_LAT = 111320;
var M_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
var toLocal = /* @__PURE__ */ __name((lat, lon) => [Math.round((lon - ORIGIN.lon) * M_LON), Math.round(-(lat - ORIGIN.lat) * M_LAT)], "toLocal");
var around = /* @__PURE__ */ __name(([lat, lon], hx, hz) => {
  const [x, z] = toLocal(lat, lon);
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}, "around");
var MAPS = [
  {
    slug: "centrs",
    lv: "Centrs",
    en: "Centre",
    focus: [56.9515, 24.1133, "Br\u012Bv\u012Bbas piemineklis"],
    bounds: { minX: -2100, maxX: 1200, minZ: -1200, maxZ: 1500 },
    mult: { props: 1, value: 1, trees: 1 },
    notes: "Old Town, boulevard ring, Central Market, Daugava with its three bridges and the left bank (Library, \u0136\u012Bpsala)."
  },
  {
    slug: "agenskalns",
    lv: "\u0100genskalns",
    en: "\u0100genskalns",
    focus: [56.9357, 24.071, "\u0100genskalna tirgus"],
    bounds: around([56.9357, 24.071], 1300, 1300),
    mult: { props: 1.3, value: 0.34, trees: 1, people: 1.25, botGain: { easy: 0.93, normal: 0.89 } },
    notes: "Wooden-house quarter west of the Daugava: \u0100genskalna tirgus, Kalnciema kvart\u0101ls, M\u0101ras d\u012B\u0137is, Tor\u0146akalns edge, Uzvaras parks."
  },
  {
    slug: "mezaparks",
    lv: "Me\u017Eaparks",
    en: "Me\u017Eaparks",
    focus: [57.004, 24.154, "Me\u017Eaparks"],
    bounds: around([57.004, 24.154], 1300, 1300),
    mult: { props: 1.7, value: 0.15, trees: 2, bots: 2, botSpeed: 1.1, people: 1.25, botGain: { easy: 0.9, normal: 0.95 } },
    notes: "Garden city of villas in pine forest, Liel\u0101 estr\u0101de, R\u012Bgas zoo edge, \u0136\u012B\u0161ezers shore."
  },
  {
    slug: "purvciems",
    lv: "Purvciems",
    en: "Purvciems",
    focus: [56.9579, 24.1872, "Arcada Purvciems"],
    bounds: around([56.9579, 24.1872], 1300, 1300),
    mult: { props: 2.6, value: 0.36, trees: 1, people: 1.3, botGain: { easy: 0.92, normal: 0.9 } },
    notes: "Soviet-era panel-block estate (5/9/12/16 floors): big slabs, courtyards, wide streets."
  }
];
var MAP_SLUGS = MAPS.map((m) => m.slug);
var DEFAULT_MAP = "centrs";
var isMapSlug = /* @__PURE__ */ __name((s) => typeof s === "string" && MAP_SLUGS.includes(s), "isMapSlug");
var mapBySlug = /* @__PURE__ */ __name((s) => MAPS.find((m) => m.slug === s) || MAPS[0], "mapBySlug");

// ../worker/lib/util.js
var json = /* @__PURE__ */ __name((data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
}), "json");
var err = /* @__PURE__ */ __name((status, message, extra = {}) => json({ error: message, ...extra }, status), "err");
var now = /* @__PURE__ */ __name(() => Math.floor(Date.now() / 1e3), "now");
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
var IP_SALT = "bedre-riga-v1";
async function ipHashOf(request, t = now()) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date(t * 1e3).toISOString().slice(0, 10);
  return sha256Hex(`${IP_SALT}|${ip}|${day}`);
}
__name(ipHashOf, "ipHashOf");
async function readJson(request, { maxBytes = 8192, anyType = false } = {}) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json") && !(anyType && ct.toLowerCase().includes("text/plain"))) {
    return { error: err(415, "content-type must be application/json") };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: err(413, "body too large") };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return { error: err(413, "body too large") };
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: err(400, "expected JSON object") };
    return { body: v };
  } catch {
    return { error: err(400, "invalid JSON") };
  }
}
__name(readJson, "readJson");
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
__name(sameOrigin, "sameOrigin");
var intIn = /* @__PURE__ */ __name((v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null, "intIn");
async function rateHit(env, key, limit, ttlSec) {
  const t = now();
  await env.DB.prepare(
    "INSERT INTO rate_limits (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN exp <= ?3 THEN 1 ELSE n + 1 END, exp = CASE WHEN exp <= ?3 THEN excluded.exp ELSE exp END"
  ).bind(key, t + ttlSec, t).run();
  const row = await env.DB.prepare("SELECT n FROM rate_limits WHERE k = ?").bind(key).first();
  return !row || row.n <= limit;
}
__name(rateHit, "rateHit");

// ../worker/lib/moderation.js
var ANON = "Anon\u012Bms";
var INVISIBLE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");
var SUB = [
  // EN
  "fuck",
  "shit",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "slut",
  "bitch",
  "asshole",
  "cocksuck",
  "retard",
  // LV (diacritics stripped)
  "pizd",
  "pidar",
  "pidor",
  "dirsa",
  "dirsu",
  "jebt",
  "jebal",
  "suds",
  "suuds",
  "kuce",
  "bladj",
  // RU (cyrillic)
  "\u0445\u0443\u0438",
  "\u0445\u0443\u0435",
  "\u0445\u0443\u044F",
  "\u043F\u0438\u0437\u0434",
  "\u0431\u043B\u044F\u0434",
  "\u0431\u043B\u044F\u0442",
  "\u0435\u0431\u0430\u043D",
  "\u0435\u0431\u0430\u0442",
  "\u0435\u0431\u043B\u0430",
  "\u043F\u0438\u0434\u043E\u0440",
  "\u043F\u0438\u0434\u0430\u0440",
  "\u043C\u0443\u0434\u0430\u043A",
  "\u0433\u043E\u043D\u0434\u043E\u043D",
  "\u0437\u0430\u043B\u0443\u043F",
  "\u0441\u0443\u0447\u043A\u0430"
];
var WORD = ["ass", "cock", "dick", "cum", "sex", "nazi", "suka", "\u0441\u0443\u043A\u0430", "\u0445\u0435\u0440", "\u0436\u043E\u043F\u0430", "\u0433\u0430\u043D\u0434\u043E\u043D"];
var LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i", "\u20AC": "e" };
function normalise(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[0134577@$!€]/g, (c) => LEET[c] || c);
}
__name(normalise, "normalise");
function isProfane(name) {
  const n = normalise(name);
  const letters = n.replace(/[^\p{L}]/gu, "");
  const squeezed = letters.replace(/(\p{L})\1+/gu, "$1");
  for (const w of SUB) if (n.includes(w) || letters.includes(w) || squeezed.includes(w)) return true;
  const words = n.split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => WORD.includes(w));
}
__name(isProfane, "isProfane");
function cleanName(raw) {
  return String(raw).normalize("NFC").replace(INVISIBLE, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}
__name(cleanName, "cleanName");
function sanitizeName(raw) {
  if (typeof raw !== "string") return null;
  const s = cleanName(raw);
  const chars = [...s];
  if (chars.length < 1 || chars.length > 16) return null;
  return isProfane(s) ? ANON : s;
}
__name(sanitizeName, "sanitizeName");
function sanitizeLabel(raw, max = 40) {
  if (typeof raw !== "string") return null;
  const s = [...cleanName(raw)].slice(0, max).join("");
  return s && !isProfane(s) ? s : null;
}
__name(sanitizeLabel, "sanitizeLabel");

// ../worker/lib/db.js
async function insertScore(env, row) {
  if (!BOARD_MODES.includes(row.mode)) throw new Error(`insertScore: bad mode ${row.mode}`);
  const map = row.map ?? DEFAULT_MAP;
  if (!isMapSlug(map)) throw new Error(`insertScore: bad map ${map}`);
  if (!Number.isInteger(row.score) || row.score < 0 || row.score > 1e8) throw new Error("insertScore: bad score");
  const name = sanitizeName(row.name) || ANON;
  const biggest = row.biggest == null ? null : sanitizeLabel(row.biggest);
  const res = await env.DB.prepare(
    "INSERT INTO scores (name, score, eaten, radius, rank, biggest, created_at, mode, day, suspect, flags, trace, round_id, kills, deaths, map, difficulty, rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    name,
    row.score,
    row.eaten ?? 0,
    row.radius ?? 0,
    row.rank ?? null,
    biggest,
    row.createdAt ?? now(),
    row.mode,
    row.mode === "daily" ? row.day ?? null : null,
    row.suspect ? 1 : 0,
    row.flags ?? null,
    row.trace ?? null,
    row.roundId ?? null,
    row.kills ?? null,
    row.deaths ?? null,
    map,
    DIFFICULTIES.includes(row.difficulty) ? row.difficulty : null,
    Number.isInteger(row.rules) && row.rules > 0 ? row.rules : RULES_VERSION
  ).run();
  return { id: res.meta.last_row_id, name };
}
__name(insertScore, "insertScore");
var rulesClause = /* @__PURE__ */ __name((archive) => archive ? "(rules IS NULL OR rules < ?)" : "rules >= ?", "rulesClause");
async function rankOf(env, { mode, day = null, score, since = 0, map = DEFAULT_MAP, archive = false }) {
  const rc = rulesClause(archive);
  const row = mode === "daily" ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE map = ? AND mode = ? AND day = ? AND suspect = 0 AND ${rc} AND score > ?`).bind(map, mode, day, RULES_VERSION, score).first() : await env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE map = ? AND mode = ? AND suspect = 0 AND ${rc} AND score > ? AND created_at >= ?`).bind(map, mode, RULES_VERSION, score, since).first();
  return row.n + 1;
}
__name(rankOf, "rankOf");
async function listScores(env, { mode, day = null, since = 0, limit = 20, map = DEFAULT_MAP, archive = false }) {
  const cols = "name, score, radius, eaten, rank, biggest, difficulty, created_at AS at";
  const rc = rulesClause(archive);
  const q = mode === "daily" ? env.DB.prepare(`SELECT ${cols} FROM scores WHERE map = ? AND mode = ? AND day = ? AND suspect = 0 AND ${rc} ORDER BY score DESC, created_at ASC LIMIT ?`).bind(map, mode, day, RULES_VERSION, limit) : env.DB.prepare(`SELECT ${cols} FROM scores WHERE map = ? AND mode = ? AND suspect = 0 AND ${rc} AND created_at >= ? ORDER BY score DESC, created_at ASC LIMIT ?`).bind(map, mode, RULES_VERSION, since, limit);
  return (await q.all()).results;
}
__name(listScores, "listScores");
async function purgeStale(env, t = now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rounds WHERE used = 0 AND created_at < ?").bind(t - 86400),
    env.DB.prepare("UPDATE rounds SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?").bind(t - 2 * 86400),
    env.DB.prepare("DELETE FROM rate_limits WHERE exp < ?").bind(t)
  ]);
}
__name(purgeStale, "purgeStale");

// ../src/rng.js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(mulberry32, "mulberry32");

// ../src/powerups.js
var PU_TYPES = ["magnet", "speed", "double", "shield"];
var PU = {
  magnet: { dur: 6, radius: 1.8, far: 1.3, from: 10, to: 90 },
  // Magnēts: edible objects within radius x hole radius slide towards the hole (x1.8 for a small hole, tapering to x1.3 for a huge one: a magnet near-doubles the swept area of a big hole, which would break the late-game pacing)
  speed: { dur: 6, mul: 1.5 },
  // Ātrums
  double: { dur: 12, mul: 2 },
  // Dubultpunkti (stacks with the combo, combined cap in src/combo.js)
  shield: { dur: 8 },
  // Vairogs: bigger holes cannot swallow you
  respawn: [20, 30],
  // s after a pickup before its slot shows up somewhere else
  life: 75,
  // s an uncollected pickup stays before it moves on
  regrow: 6,
  // s between an expiry and the next spawn of the slot
  perAxis: 250,
  // active pickups ~ sqrt(map area) / this ...
  min: 6,
  // ... but at least this many
  minMove: 160
  // a slot reappears at least this far from where it last was
};
var magnetFactor = /* @__PURE__ */ __name((r) => PU.magnet.radius + (PU.magnet.far - PU.magnet.radius) * Math.min(1, Math.max(0, (r - PU.magnet.from) / (PU.magnet.to - PU.magnet.from))), "magnetFactor");
var PU_WEIGHTS = { magnet: 0.16, speed: 0.26, double: 0.3, shield: 0.28 };
var PU_ORDER = Object.fromEntries(PU_TYPES.map((t, i) => [t, i]));
function puCountFor(b) {
  return Math.max(PU.min, Math.round(Math.sqrt((b.maxX - b.minX) * (b.maxZ - b.minZ)) / PU.perAxis));
}
__name(puCountFor, "puCountFor");
var pickRadius = /* @__PURE__ */ __name((holeRadius) => 1.4 + 0.8 * holeRadius, "pickRadius");
function candidatesFromSpawn(sp) {
  const x = new Float64Array(sp.n), z = new Float64Array(sp.n);
  for (let i = 0; i < sp.n; i++) {
    x[i] = sp.x[i];
    z[i] = sp.z[i];
  }
  return { n: sp.n, x, z };
}
__name(candidatesFromSpawn, "candidatesFromSpawn");
var PowerupField = class {
  static {
    __name(this, "PowerupField");
  }
  constructor({ seed, cand, count }) {
    this.seed = seed >>> 0;
    this.cand = cand;
    this.count = count;
    this.slots = [];
    for (let s = 0; s < count; s++) {
      const slot = { id: s, rng: mulberry32(hashSeed(`pu|${this.seed}|${s}`)), n: 0, state: "wait", at: 0, type: null, x: 0, z: 0, until: 0, px: NaN, pz: NaN, delay: 0 };
      this._roll(slot);
      this.slots.push(slot);
    }
    this.picked = 0;
  }
  /** Draw the content of slot's next pickup (fixed number of draws order: place, type, respawn delay). */
  _roll(slot) {
    const c = this.cand, s = slot.id, N = this.count || 1;
    let idx = -1;
    if (c.n > 0) {
      const part = c.n >= N ? Math.ceil((c.n - s) / N) : c.n;
      for (let tries = 0; tries < 8; tries++) {
        const k = Math.floor(slot.rng() * part);
        const i = c.n >= N ? s + k * N : k;
        idx = i;
        if (!(Math.hypot(c.x[i] - slot.px, c.z[i] - slot.pz) < PU.minMove)) break;
      }
    }
    const r = slot.rng();
    let acc = 0, pick = PU_TYPES[PU_TYPES.length - 1];
    for (const ty of PU_TYPES) {
      acc += PU_WEIGHTS[ty];
      if (r < acc) {
        pick = ty;
        break;
      }
    }
    slot.nextType = slot.n === 0 ? PU_TYPES[s % PU_TYPES.length] : pick;
    if (slot.n > 0 && slot.nextType === slot.type) slot.nextType = PU_TYPES[(PU_ORDER[slot.nextType] + 1) % PU_TYPES.length];
    slot.nextDelay = PU.respawn[0] + slot.rng() * (PU.respawn[1] - PU.respawn[0]);
    slot.nextIdx = idx;
  }
  _spawn(slot, now2, out) {
    const i = slot.nextIdx;
    slot.type = slot.nextType;
    slot.delay = slot.nextDelay;
    slot.x = i >= 0 ? this.cand.x[i] : 0;
    slot.z = i >= 0 ? this.cand.z[i] : 0;
    slot.px = slot.x;
    slot.pz = slot.z;
    slot.state = "on";
    slot.until = now2 + PU.life;
    slot.n++;
    if (i < 0) {
      slot.state = "wait";
      slot.at = now2 + 1e9;
      return;
    }
    this._roll(slot);
    if (out) out.push({ k: "spawn", slot: slot.id, type: slot.type, x: slot.x, z: slot.z, until: slot.until });
  }
  /** Advance to `now` (round seconds). Returns the events since the last call: { k: 'spawn'|'expire', slot, ... }. */
  tick(now2) {
    const out = [];
    for (const s of this.slots) {
      if (s.state === "on" && now2 >= s.until) {
        s.state = "wait";
        s.at = now2 + PU.regrow;
        out.push({ k: "expire", slot: s.id });
      }
      if (s.state === "wait" && now2 >= s.at) this._spawn(s, now2, out);
    }
    return out;
  }
  /** The pickup of `slot` is collected at `now`. Returns its type, or null if it was not there (already taken / expired). */
  take(slot, now2) {
    const s = this.slots[slot];
    if (!s || s.state !== "on") return null;
    s.state = "wait";
    s.at = now2 + s.delay;
    this.picked++;
    return s.type;
  }
  /** Active pickups as plain rows [slot, type, x, z, untilRound] (what the server sends). */
  list() {
    const o = [];
    for (const s of this.slots) if (s.state === "on") o.push([s.id, s.type, s.x, s.z, s.until]);
    return o;
  }
  /** Slot whose pickup this hole (x, z, r) touches, or -1. `slack` widens the reach (server: latency allowance). */
  touching(x, z, r, slack = 0) {
    const R = pickRadius(r) + slack;
    let best = -1, bd = Infinity;
    for (const s of this.slots) {
      if (s.state !== "on") continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= R && d < bd) {
        bd = d;
        best = s.id;
      }
    }
    return best;
  }
  /** Nearest active pickup within `range` of a point: { slot, x, z, type, d } or null (bots, autoplayers). */
  nearest(x, z, range, skip = null) {
    let best = null, bd = range;
    for (const s of this.slots) {
      if (s.state !== "on" || skip && skip(s)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = { slot: s.id, x: s.x, z: s.z, type: s.type, d };
      }
    }
    return best;
  }
};
var maxPickups = /* @__PURE__ */ __name((count, seconds) => count * (1 + Math.floor(Math.max(0, seconds) / PU.respawn[0])), "maxPickups");

// ../worker/lib/limits.js
var LIMITS = {
  "format": 2,
  "rules": 2,
  "generated": "2026-11-18",
  "runs": 2272,
  "bands": [2.2, 3.5, 5.5, 8, 12, 18, 28, 42, 62, 90, 130],
  "maps": {
    "centrs": {
      "runs": 784,
      "generated": "2026-11-18",
      "modes": {
        "classic": {
          "gain": [299, 413, 991, 2816, 6741, 16865, 28703, 59301, 73220, 86970, 87076],
          "eaten10": 1436,
          "cap": 734088,
          "maxKills": 40,
          "killMax": 170239,
          "combo": 13877,
          "picks": 11
        },
        "quick": {
          "gain": [1129, 2337, 10157, 10157, 11510, 24495, 57884, 62502, 65690, 119143, 119143],
          "eaten10": 1692,
          "cap": 463835,
          "maxKills": 40,
          "killMax": 170239,
          "combo": 8917,
          "picks": 9
        },
        "daily": {
          "gain": [156, 313, 1641, 2594, 5657, 11328, 25470, 47850, 47850, 80687, 80687],
          "eaten10": 1475,
          "cap": 707567,
          "maxKills": 40,
          "killMax": 170239,
          "combo": 13429,
          "picks": 12
        }
      },
      "value": {
        "building": [4, 5063],
        "landmark": [10, 12656],
        "person": [1, 1],
        "lamp": [2, 2],
        "bench": [2, 2],
        "bin": [1, 1],
        "car": [4, 4],
        "van": [6, 6],
        "kiosk": [6, 6],
        "tree": [2, 8],
        "monument": [72, 318],
        "laima": [45, 45],
        "freedom": [450, 450],
        "shelter": [4, 4],
        "flag": [2, 2],
        "cafeset": [2, 2],
        "parasol": [3, 3],
        "stall": [6, 6],
        "bike": [1, 1],
        "scooter": [1, 1],
        "lantern": [3, 3],
        "pylon": [160, 160],
        "railarch": [90, 90],
        "taxi": [6, 6],
        "pigeon": [1, 1],
        "swan": [3, 3],
        "trolleybus": [16, 16],
        "bus": [14, 14],
        "tram": [22, 22],
        "boat": [12, 12],
        "ferry": [45, 45],
        "platformroof": [70, 70]
      },
      "valueOther": 12656
    },
    "agenskalns": {
      "runs": 496,
      "generated": "2026-11-18",
      "modes": {
        "classic": {
          "gain": [263, 563, 2089, 5937, 8436, 16023, 23376, 118050, 134385, 171859, 171859],
          "eaten10": 1518,
          "cap": 949515,
          "maxKills": 40,
          "killMax": 243622,
          "combo": 16295,
          "picks": 9
        },
        "quick": {
          "gain": [1147, 1721, 2375, 5209, 11827, 13746, 22068, 57285, 99417, 162667, 162667],
          "eaten10": 1544,
          "cap": 543970,
          "maxKills": 40,
          "killMax": 243622,
          "combo": 10157,
          "picks": 6
        }
      },
      "value": {
        "building": [4, 12791],
        "landmark": [10, 37219],
        "person": [1, 1],
        "lamp": [2, 2],
        "bench": [2, 2],
        "bin": [1, 1],
        "car": [4, 4],
        "van": [6, 6],
        "kiosk": [6, 6],
        "tree": [2, 8],
        "monument": [72, 120],
        "shelter": [4, 4],
        "flag": [2, 2],
        "stall": [6, 6],
        "lantern": [3, 3],
        "swan": [3, 3],
        "pigeon": [1, 1],
        "boat": [12, 12],
        "bus": [14, 14],
        "trolleybus": [16, 16],
        "taxi": [6, 6],
        "tram": [22, 22],
        "ferry": [45, 45]
      },
      "valueOther": 37219
    },
    "mezaparks": {
      "runs": 496,
      "generated": "2026-11-18",
      "modes": {
        "classic": {
          "gain": [459, 756, 1439, 4384, 6737, 30963, 55740, 78394, 81700, 81700, 81700],
          "eaten10": 1260,
          "cap": 765260,
          "maxKills": 40,
          "killMax": 152787,
          "combo": 15541,
          "picks": 10
        },
        "quick": {
          "gain": [773, 1160, 4898, 4898, 6575, 25263, 25263, 58477, 84938, 178262, 178262],
          "eaten10": 2005,
          "cap": 466740,
          "maxKills": 40,
          "killMax": 152787,
          "combo": 8213,
          "picks": 6
        }
      },
      "value": {
        "building": [4, 12755],
        "landmark": [195, 10261],
        "person": [1, 1],
        "lamp": [2, 2],
        "bench": [2, 2],
        "bin": [1, 1],
        "car": [4, 4],
        "van": [6, 6],
        "kiosk": [6, 6],
        "tree": [2, 8],
        "monument": [120, 120],
        "shelter": [4, 4],
        "flag": [2, 2],
        "stall": [6, 6],
        "parasol": [3, 3],
        "cafeset": [2, 2],
        "taxi": [6, 6],
        "pigeon": [1, 1],
        "swan": [3, 3],
        "trolleybus": [16, 16],
        "bus": [14, 14],
        "boat": [12, 12],
        "tram": [22, 22],
        "ferry": [45, 45]
      },
      "valueOther": 12755
    },
    "purvciems": {
      "runs": 496,
      "generated": "2026-11-18",
      "modes": {
        "classic": {
          "gain": [125, 319, 1107, 5697, 9393, 17772, 54438, 75438, 97275, 115102, 115102],
          "eaten10": 1085,
          "cap": 891592,
          "maxKills": 40,
          "killMax": 234291,
          "combo": 11688,
          "picks": 7
        },
        "quick": {
          "gain": [201, 302, 1367, 8108, 17277, 28926, 46167, 73167, 108297, 108297, 177570],
          "eaten10": 1506,
          "cap": 757670,
          "maxKills": 40,
          "killMax": 234291,
          "combo": 8257,
          "picks": 9
        }
      },
      "value": {
        "building": [4, 6842],
        "landmark": [85, 14203],
        "person": [1, 1],
        "lamp": [2, 2],
        "bench": [2, 2],
        "bin": [1, 1],
        "car": [4, 4],
        "van": [6, 6],
        "kiosk": [6, 6],
        "tree": [2, 4],
        "shelter": [4, 4],
        "flag": [2, 2],
        "stall": [6, 6],
        "taxi": [6, 6],
        "bus": [14, 14],
        "trolleybus": [16, 16],
        "pigeon": [1, 1]
      },
      "valueOther": 14203
    }
  }
};
var limitsFor = /* @__PURE__ */ __name((map) => LIMITS.maps[map] || LIMITS.maps.centrs, "limitsFor");

// ../worker/lib/validate.js
var SOFT = 2;
var HARD = 3;
var KIND_RE = /^[a-z][a-z0-9_]{1,23}$/;
var isNum = /* @__PURE__ */ __name((v) => typeof v === "number" && Number.isFinite(v), "isNum");
function bandOf(radius) {
  const b = LIMITS.bands;
  let i = 0;
  while (i < b.length - 1 && radius >= b[i + 1]) i++;
  return i;
}
__name(bandOf, "bandOf");
var expectedSamples = /* @__PURE__ */ __name((tf) => Math.floor((tf - 0.3) / TRACE_STEP) + 1, "expectedSamples");
function validateSubmission(p) {
  const hard = [], soft = [];
  const out = /* @__PURE__ */ __name(() => ({ verdict: hard.length ? "reject" : soft.length ? "suspect" : "ok", reasons: [...hard, ...soft] }), "out");
  const m = MODES[p.mode];
  const ML = limitsFor(p.map || "centrs");
  const L = ML.modes[p.mode];
  if (!m || !L) return { verdict: "reject", reasons: ["mode"] };
  const tr = p.trace;
  if (!tr || typeof tr !== "object") return { verdict: "reject", reasons: ["trace_missing"] };
  if (tr.v === 2) return validateV2(p, m, ML, L, hard, soft, out);
  const arrs = ["t", "s", "r", "e", "k"];
  if (tr.v !== 1 || !arrs.every((a) => Array.isArray(tr[a]) && tr[a].every(isNum))) return { verdict: "reject", reasons: ["trace_format"] };
  const n = tr.t.length;
  if (n < 1 || n > TRACE_MAX || !arrs.every((a) => tr[a].length === n)) return { verdict: "reject", reasons: ["trace_format"] };
  const kinds = tr.kinds && typeof tr.kinds === "object" && !Array.isArray(tr.kinds) ? tr.kinds : null;
  if (!kinds || Object.keys(kinds).length > 48) return { verdict: "reject", reasons: ["trace_format"] };
  let kindTotal = 0;
  for (const [k, v] of Object.entries(kinds)) {
    if (!KIND_RE.test(k) || !Number.isInteger(v) || v < 0 || v > 1e6) return { verdict: "reject", reasons: ["trace_format"] };
    kindTotal += v;
  }
  const tf = tr.t[n - 1];
  const sF = tr.s[n - 1], eF = tr.e[n - 1], kF = tr.k[n - 1];
  if (n !== expectedSamples(tf)) hard.push("time_slots");
  for (let i = 0; i < n; i++) {
    if (!(tr.s[i] >= 0) || !(tr.e[i] >= 0) || !(tr.k[i] >= 0) || !(tr.r[i] >= 0)) hard.push("negative");
    if (i > 0 && (tr.t[i] <= tr.t[i - 1] || tr.e[i] < tr.e[i - 1] || tr.k[i] < tr.k[i - 1])) hard.push("monotonic");
    if (i < n - 1 && !(tr.t[i] >= TRACE_STEP * (i + 1) - 0.01 && tr.t[i] <= TRACE_STEP * (i + 1) + 1)) hard.push("time_slots");
  }
  if (n > 1 && tf - tr.t[n - 2] > TRACE_STEP + 1.5) hard.push("time_slots");
  if (m.seconds > 0) {
    if (tf < p.seconds - 2.5 || tf > p.seconds + 3) hard.push("time_total");
  }
  if (tf > p.age + 15) hard.push("time_vs_age");
  if (hard.length) return out();
  if (Math.abs(sF - p.score) > 1.01 || Math.abs(eF - p.eaten) > 0) hard.push("final_mismatch");
  if (kindTotal !== eF) hard.push("kinds_sum");
  if (!Number.isInteger(tr.kills) || tr.kills !== kF || !Number.isInteger(tr.deaths) || tr.deaths < 0) hard.push("kills_format");
  if (kF > L.maxKills * 2 + 5) hard.push("kills_range");
  if (p.rank !== null && p.rank !== void 0 && (p.rank < 1 || p.rank > m.holes)) hard.push("rank_range");
  if (hard.length) return out();
  if (sF > L.cap * HARD) hard.push("cap_hard");
  else if (sF > L.cap * SOFT) soft.push("cap_soft");
  let prevS = 0, prevE = 0, prevK = 0, prevT = 0;
  for (let i = 0; i < n; i++) {
    const dt = tr.t[i] - prevT;
    const stretch = Math.max(1, dt / TRACE_STEP);
    const band = bandOf(radiusForMode(prevS, p.mode));
    const dK = tr.k[i] - prevK;
    const base = L.gain[band] * stretch + dK * L.killMax;
    const gain = tr.s[i] - prevS;
    if (gain > base * HARD) {
      hard.push("gain_hard");
      break;
    }
    if (gain > base * SOFT && !soft.includes("gain_soft")) soft.push("gain_soft");
    const dE = tr.e[i] - prevE;
    if (dE > L.eaten10 * stretch * HARD + 25) {
      hard.push("eaten_rate");
      break;
    }
    if (dE > L.eaten10 * stretch * SOFT + 25 && !soft.includes("eaten_soft")) soft.push("eaten_soft");
    const want = radiusForMode(tr.s[i], p.mode);
    if (Math.abs(tr.r[i] - want) > want * 0.03 + 0.05 && !soft.includes("radius_formula")) soft.push("radius_formula");
    prevS = tr.s[i];
    prevE = tr.e[i];
    prevK = tr.k[i];
    prevT = tr.t[i];
  }
  if (hard.length) return out();
  let maxSum = 0;
  for (const [k, v] of Object.entries(kinds)) maxSum += v * (Object.hasOwn(ML.value, k) ? ML.value[k][1] : ML.valueOther);
  maxSum += kF * L.killMax;
  if (sF > maxSum * 3 + 100) hard.push("kind_values_hard");
  else if (sF > maxSum * 1.25 + 25) soft.push("kind_values");
  if (isNum(p.radius) && p.radius > radiusForMode(sF, p.mode) * 1.5 + 1) hard.push("radius_hard");
  else if (isNum(p.radius) && p.radius > radiusForMode(sF, p.mode) * 1.1 + 0.3) soft.push("radius_final");
  return out();
}
__name(validateSubmission, "validateSubmission");
var U_KEYS = PU_TYPES;
var allInts = /* @__PURE__ */ __name((a) => Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0 && v < 1e6), "allInts");
function validateV2(p, m, ML, L, hard, soft, out) {
  const tr = p.trace;
  const arrs = ["t", "s", "m", "r", "e", "k", "w", "p", "c"];
  if (!arrs.every((a) => Array.isArray(tr[a]) && tr[a].every(isNum))) return { verdict: "reject", reasons: ["trace_format"] };
  const n = tr.t.length;
  if (n < 1 || n > TRACE_MAX || !arrs.every((a) => tr[a].length === n)) return { verdict: "reject", reasons: ["trace_format"] };
  const u = tr.u;
  if (!u || typeof u !== "object" || !U_KEYS.every((k) => allInts(u[k]) && u[k].length === n)) return { verdict: "reject", reasons: ["trace_format"] };
  const kinds = tr.kinds && typeof tr.kinds === "object" && !Array.isArray(tr.kinds) ? tr.kinds : null;
  if (!kinds || Object.keys(kinds).length > 48) return { verdict: "reject", reasons: ["trace_format"] };
  let kindTotal = 0;
  for (const [k, v] of Object.entries(kinds)) {
    if (!KIND_RE.test(k) || !Number.isInteger(v) || v < 0 || v > 1e6) return { verdict: "reject", reasons: ["trace_format"] };
    kindTotal += v;
  }
  const tf = tr.t[n - 1];
  const sF = tr.s[n - 1], eF = tr.e[n - 1], kF = tr.k[n - 1], mF = tr.m[n - 1], wF = tr.w[n - 1], pF = tr.p[n - 1];
  if (n !== expectedSamples(tf)) hard.push("time_slots");
  for (let i = 0; i < n; i++) {
    if (!arrs.every((a) => tr[a][i] >= 0)) hard.push("negative");
    if (i > 0 && (tr.t[i] <= tr.t[i - 1] || tr.e[i] < tr.e[i - 1] || tr.k[i] < tr.k[i - 1] || tr.w[i] < tr.w[i - 1] - 1 || tr.p[i] < tr.p[i - 1] - 1 || tr.c[i] < tr.c[i - 1] || U_KEYS.some((k) => u[k][i] < u[k][i - 1]))) hard.push("monotonic");
    if (i < n - 1 && !(tr.t[i] >= TRACE_STEP * (i + 1) - 0.01 && tr.t[i] <= TRACE_STEP * (i + 1) + 1)) hard.push("time_slots");
  }
  if (n > 1 && tf - tr.t[n - 2] > TRACE_STEP + 1.5) hard.push("time_slots");
  if (m.seconds > 0 && (tf < p.seconds - 2.5 || tf > p.seconds + 3)) hard.push("time_total");
  if (tf > p.age + 15) hard.push("time_vs_age");
  if (hard.length) return out();
  if (Math.abs(sF - p.score) > 1.01 || Math.abs(eF - p.eaten) > 0) hard.push("final_mismatch");
  if (kindTotal !== eF) hard.push("kinds_sum");
  if (!Number.isInteger(tr.kills) || tr.kills !== kF || !Number.isInteger(tr.deaths) || tr.deaths < 0) hard.push("kills_format");
  if (kF > L.maxKills * 2 + 5) hard.push("kills_range");
  if (p.rank !== null && p.rank !== void 0 && (p.rank < 1 || p.rank > m.holes)) hard.push("rank_range");
  if (hard.length) return out();
  if (sF > L.cap * HARD) hard.push("cap_hard");
  else if (sF > L.cap * SOFT) soft.push("cap_soft");
  const bounds = mapBySlug(p.map || "centrs").bounds;
  const slots = puCountFor(bounds);
  let maxMultSeen = 1;
  let prev = { s: 0, m: 0, e: 0, k: 0, t: 0, w: 0, p: 0, pick: 0 };
  for (let i = 0; i < n; i++) {
    const dt = tr.t[i] - prev.t, stretch = Math.max(1, dt / TRACE_STEP);
    const band = bandOf(radiusForMode(prev.m, p.mode));
    const dK = tr.k[i] - prev.k;
    const base = L.gain[band] * stretch + dK * L.killMax;
    const gain = tr.s[i] - prev.s;
    if (gain > base * HARD) {
      hard.push("gain_hard");
      break;
    }
    if (gain > base * SOFT && !soft.includes("gain_soft")) soft.push("gain_soft");
    const dE = tr.e[i] - prev.e;
    if (dE > L.eaten10 * stretch * HARD + 25) {
      hard.push("eaten_rate");
      break;
    }
    if (dE > L.eaten10 * stretch * SOFT + 25 && !soft.includes("eaten_soft")) soft.push("eaten_soft");
    const want = radiusForMode(tr.m[i], p.mode);
    if (Math.abs(tr.r[i] - want) > want * 0.03 + 0.05 && !soft.includes("radius_formula")) soft.push("radius_formula");
    if (tr.c[i] > COMBO.maxWeight * tr.e[i] + 1) {
      hard.push("combo_eaten");
      break;
    }
    const dbl = u.double[i] > (i >= 3 ? u.double[i - 3] : 0);
    const mult = totalMult(multFor(tr.c[i]), dbl ? PU.double.mul : 1);
    maxMultSeen = Math.max(maxMultSeen, mult);
    const dW = tr.w[i] - prev.w, dP = tr.p[i] - prev.p;
    if (dP > dW * mult * 1.02 + 3) {
      hard.push("points_mult");
      break;
    }
    if (gain > dP + dK * L.killMax + 5) {
      hard.push("points_jump");
      break;
    }
    const pick = U_KEYS.reduce((a, k) => a + u[k][i], 0);
    const lim = maxPickups(slots, tr.t[i]);
    if (pick > lim) {
      hard.push("powerups_count");
      break;
    }
    if (pick > lim * 0.75 && !soft.includes("powerups_many")) soft.push("powerups_many");
    if (pick - prev.pick > slots + 1) {
      hard.push("powerups_burst");
      break;
    }
    prev = { s: tr.s[i], m: tr.m[i], e: tr.e[i], k: tr.k[i], t: tr.t[i], w: tr.w[i], p: tr.p[i], pick };
  }
  if (hard.length) return out();
  if (sF > pF + kF * L.killMax + 5) hard.push("points_mismatch");
  if (mF > wF + kF * L.killMax + 5) hard.push("mass_mismatch");
  if (mF > sF + 5) hard.push("mass_gt_points");
  let maxSum = 0;
  for (const [k, v] of Object.entries(kinds)) maxSum += v * (Object.hasOwn(ML.value, k) ? ML.value[k][1] : ML.valueOther);
  if (wF > maxSum * 3 + 100) hard.push("kind_values_hard");
  else if (wF > maxSum * 1.25 + 25) soft.push("kind_values");
  if (hard.length) return out();
  if (isNum(p.radius) && p.radius > radiusForMode(mF, p.mode) * 1.5 + 1) hard.push("radius_hard");
  else if (isNum(p.radius) && p.radius > radiusForMode(mF, p.mode) * 1.1 + 0.3) soft.push("radius_final");
  return out();
}
__name(validateV2, "validateV2");

// ../worker/lib/turnstile.js
var SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
var turnstileEnabled = /* @__PURE__ */ __name((env) => !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY), "turnstileEnabled");
var turnstileSiteKey = /* @__PURE__ */ __name((env) => turnstileEnabled(env) ? String(env.TURNSTILE_SITE_KEY) : null, "turnstileSiteKey");
async function verifyTurnstile(env, token, ip) {
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, codes: ["missing-input-response"] };
  const body = new URLSearchParams({ secret: String(env.TURNSTILE_SECRET), response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  body.set("idempotency_key", crypto.randomUUID());
  try {
    const res = await fetch(env.TURNSTILE_VERIFY_URL || SITEVERIFY, { method: "POST", body });
    const j = await res.json();
    return { ok: !!j.success, codes: Array.isArray(j["error-codes"]) ? j["error-codes"].slice(0, 5).map(String) : [] };
  } catch {
    return { ok: false, codes: ["verify-unreachable"] };
  }
}
__name(verifyTurnstile, "verifyTurnstile");

// ../worker/lib/analytics.js
var STATIC = /* @__PURE__ */ new Set([
  "pv",
  // page views
  "vis:new",
  "vis:ret",
  // first-ever / returning browser (decided in the browser, nothing is sent to identify it)
  "dev:mobile",
  "dev:desktop",
  // device class from viewport
  "lang:lv",
  "lang:en",
  "q:low",
  "q:medium",
  "q:high",
  // quality tier at round start
  "nogl",
  // WebGL unavailable
  "pwa:install",
  "pwa:standalone",
  "share",
  "lobby",
  // share clicks, online lobby joins
  "err:js",
  "err:promise",
  "err:ctxlost",
  "err:load"
]);
var FAMILIES = [
  /^rs:(classic|quick|daily|free|online)$/,
  // rounds started
  /^rf:(classic|quick|daily|free|online)$/,
  // rounds finished
  /^sb:(classic|quick|daily|online):[0-7]$/,
  // final-score bucket (log scale, see client)
  /^theme:[a-z0-9-]{1,16}$/
];
var MAX_KEYS_PER_BEACON = 24;
var MAX_N = 50;
var MAX_KEYS_PER_DAY = 160;
var BEACONS_PER_10MIN = 40;
var isAllowedKey = /* @__PURE__ */ __name((k) => typeof k === "string" && k.length <= 40 && (STATIC.has(k) || FAMILIES.some((re) => re.test(k))), "isAllowedKey");
var optedOut = /* @__PURE__ */ __name((request) => request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1", "optedOut");
async function handleEvents(request, env) {
  if (optedOut(request)) return new Response(null, { status: 204 });
  const { body, error } = await readJson(request, { maxBytes: 2048, anyType: true });
  if (error) return error;
  const d = body.d;
  if (!d || typeof d !== "object" || Array.isArray(d)) return err(400, "expected {d:{key:n}}");
  const t = now();
  const ih = await ipHashOf(request, t);
  if (!await rateHit(env, `ev:${ih}:${Math.floor(t / 600)}`, BEACONS_PER_10MIN, 700)) return new Response(null, { status: 204 });
  const day = rigaDay(t);
  const entries = [];
  for (const [k, v] of Object.entries(d)) {
    if (entries.length >= MAX_KEYS_PER_BEACON) break;
    if (!isAllowedKey(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    const n = Math.min(MAX_N, Math.max(1, Math.floor(v)));
    entries.push([k, n]);
  }
  if (!entries.length) return new Response(null, { status: 204 });
  const known = new Set((await env.DB.prepare("SELECT key FROM stats WHERE day = ?").bind(day).all()).results.map((r) => r.key));
  let room = MAX_KEYS_PER_DAY - known.size;
  const stmts = [];
  for (const [k, n] of entries) {
    if (!known.has(k)) {
      if (room <= 0) continue;
      room--;
    }
    stmts.push(env.DB.prepare("INSERT INTO stats (day, key, n) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n").bind(day, k, n));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return new Response(null, { status: 204 });
}
__name(handleEvents, "handleEvents");
async function handleStats(request, env, url) {
  if (env.STATS_KEY) {
    const auth = request.headers.get("authorization") || "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("key") || "";
    if (!given || given !== String(env.STATS_KEY)) return err(401, "stats key required");
  }
  let days = parseInt(url.searchParams.get("days") || "30", 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.min(366, Math.max(1, days));
  const t = now();
  const to = rigaDay(t), from = rigaDay(t - (days - 1) * 86400);
  const { results } = await env.DB.prepare("SELECT day, key, n FROM stats WHERE day >= ? AND day <= ? ORDER BY day").bind(from, to).all();
  const byDay = /* @__PURE__ */ new Map();
  for (const r of results) {
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    byDay.get(r.day)[r.key] = r.n;
  }
  return json(
    { from, to, days: [...byDay].map(([day, keys]) => ({ day, keys })) },
    200,
    { "cache-control": env.STATS_KEY ? "no-store" : "public, max-age=60" }
  );
}
__name(handleStats, "handleStats");

// ../worker/mp/protocol.js
var PROTOCOL_VERSION = 3;
var MP = {
  maxHumans: 12,
  totalHoles: 8,
  // humans + bots (bots fill up to this)
  botSkill: 0.38,
  // server-bot difficulty: 1 = the full solo-bot strength, lower = slower / clumsier (each bot gets +-22 % spread). Tuned with scripts/mp-bot-bench.mjs
  // so that a casual human (~25-30k points on their own) finishes in the top 3 of 8 (see README 6.2 for the bench numbers)
  botHumanGrace: 60,
  // seconds from the round start in which server bots do not hunt humans (they still eat and flee)
  lobbySeconds: 20,
  // countdown starts when the first player arrives
  roundSeconds: 300,
  introMs: 3700,
  // whole-city fly-in (CFG.intro.hold + glide), the round clock starts after it
  resultsSeconds: 60,
  // room lives this long after the round ends, then closes
  simHz: 20,
  snapEvery: 2,
  // snapshot every N sim ticks  => 10 Hz
  removeAfterMs: 45e3,
  // a disconnected hole idles (edible, can be resumed with its session token: covers an iOS tab reload / app switch / short outage), then leaves the arena
  // (it keeps its place in the final ranking with the score it had, but the result is not written to the online leaderboard)
  silentAfterMs: 1e4,
  // a socket that sent nothing for this long (dead network, frozen tab) counts as disconnected; the client pings every 2.5 s
  maxMsgBytes: 2048,
  msgRate: 40,
  // messages per second per socket (token bucket) ...
  msgBurst: 80,
  // ... with this burst
  maxClaimIds: 64,
  maxClaimMovers: 16,
  maxPickClaims: 6,
  botComboScale: 0.85,
  // server bots build their combo counter a little slower (like Easy solo bots)
  // validation tolerances
  speedTol: 1.3,
  // allowed speed = formula * this
  burstSeconds: 1.5,
  // distance budget may accumulate this many seconds of speed
  posSlack: 3,
  // metres of slack on top
  reachSlackSeconds: 0.4,
  // claim reach slack = vmax * this + 1.5 m  (client is ahead of the server by ~RTT)
  claimRate: 150,
  // claims per second per hole (refill) ...
  claimBurst: 300,
  moverPointsRate: 80,
  // value of mover claims per second per hole
  moverPointsBurst: 200,
  names: "abcdefghjkmnpqrstuvwxyz23456789"
};
function mpConfig(env) {
  const num = /* @__PURE__ */ __name((v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  }, "num");
  const e = env || {};
  return {
    ...MP,
    roundSeconds: num(e.MP_ROUND_SECONDS, MP.roundSeconds, 5, 3600),
    lobbySeconds: num(e.MP_LOBBY_SECONDS, MP.lobbySeconds, 0, 300),
    resultsSeconds: num(e.MP_RESULTS_SECONDS, MP.resultsSeconds, 2, 600),
    maxHumans: num(e.MP_MAX_HUMANS, MP.maxHumans, 1, 12),
    botSkill: num(e.MP_BOT_SKILL, MP.botSkill, 0.2, 1),
    botHumanGrace: num(e.MP_BOT_GRACE, MP.botHumanGrace, 0, 300),
    removeAfterMs: num(e.MP_REMOVE_AFTER_MS, MP.removeAfterMs, 1e3, 3e5),
    silentAfterMs: num(e.MP_SILENT_AFTER_MS, MP.silentAfterMs, 3e3, 12e4),
    testCloseSpawn: e.MP_TEST_CLOSE_SPAWN === "1" || e.MP_TEST_CLOSE_SPAWN === 1,
    testPowerups: e.MP_TEST_PU === "1" || e.MP_TEST_PU === 1,
    // tests only: the first pickups appear next to the humans' starts (scripts/smoke-mp.mjs)
    testFxScale: num(e.MP_TEST_FX_SCALE, 1, 1, 10),
    // tests only: effects last this many times longer (the browser tests are slower than 6 s)
    testStartMass: num(e.MP_TEST_START_MASS, 0, 0, 1e5)
    // tests only: the first human starts with this mass (a big hole for the shield test)
  };
}
__name(mpConfig, "mpConfig");
var validToken = /* @__PURE__ */ __name((s) => typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s), "validToken");
var validRoom = /* @__PURE__ */ __name((s) => typeof s === "string" && /^[a-z0-9]{6,24}$/.test(s), "validRoom");
var isNum2 = /* @__PURE__ */ __name((v) => typeof v === "number" && Number.isFinite(v), "isNum");
function parseClientMessage(text, cfg = MP) {
  if (typeof text !== "string" || text.length > cfg.maxMsgBytes) return null;
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  switch (m.t) {
    case "hello":
      if (typeof m.hash !== "string" || m.hash.length > 16) return null;
      return { t: "hello", v: m.v | 0, name: m.name, token: m.token, hash: m.hash };
    case "u": {
      const out = { t: "u", q: Number.isInteger(m.q) ? m.q : 0, x: null, z: null, c: [], m: [], p: [], ct: isNum2(m.ct) ? m.ct : null };
      if (m.x !== void 0 || m.z !== void 0) {
        if (!isNum2(m.x) || !isNum2(m.z) || Math.abs(m.x) > 1e5 || Math.abs(m.z) > 1e5) return null;
        out.x = m.x;
        out.z = m.z;
      }
      if (m.c !== void 0) {
        if (!Array.isArray(m.c) || m.c.length > cfg.maxClaimIds) return null;
        for (const id of m.c) {
          if (!Number.isInteger(id) || id < 0) return null;
          out.c.push(id);
        }
      }
      if (m.m !== void 0) {
        if (!Array.isArray(m.m) || m.m.length > cfg.maxClaimMovers) return null;
        for (const e of m.m) {
          if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || e[0] < 0 || !isNum2(e[1]) || !isNum2(e[2])) return null;
          out.m.push(e);
        }
      }
      if (m.p !== void 0) {
        if (!Array.isArray(m.p) || m.p.length > cfg.maxPickClaims) return null;
        for (const sl of m.p) {
          if (!Number.isInteger(sl) || sl < 0 || sl > 255) return null;
          out.p.push(sl);
        }
      }
      return out;
    }
    case "ping":
      return { t: "ping", c: isNum2(m.c) ? m.c : 0, r: isNum2(m.r) && m.r >= 0 ? Math.min(m.r, 5e3) : 0 };
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
}
__name(parseClientMessage, "parseClientMessage");
var RateLimiter = class {
  static {
    __name(this, "RateLimiter");
  }
  constructor(rate, burst, now2 = Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = now2;
    this.over = 0;
  }
  allow(now2 = Date.now()) {
    this.tokens = Math.min(this.burst, this.tokens + (now2 - this.last) / 1e3 * this.rate);
    this.last = now2;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.over++;
    return false;
  }
};

// ../worker/mp/table.js
var TABLE_MAGIC = 844123970;
var F_MOVER = 1;
var F_BUILDING = 2;
var F_LANDMARK = 4;
var MOVER_STRIDE = 12;
var pad4 = /* @__PURE__ */ __name((n) => n + 3 & ~3, "pad4");
function hashBytes(u8) {
  let a = 2166136261, b = 2538058380;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b + c + 1, 2246822507);
    b ^= b >>> 15;
  }
  const h = /* @__PURE__ */ __name((v) => (v >>> 0).toString(16).padStart(8, "0"), "h");
  return h(a) + h(b);
}
__name(hashBytes, "hashBytes");
function parseTable(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 32) throw new Error("object table: bad buffer");
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== TABLE_MAGIC) throw new Error("object table: bad magic (missing or old-format objects file?)");
  const n = dv.getUint32(4, true), nB = dv.getUint32(8, true), s = dv.getUint32(12, true), nMov = dv.getUint32(16, true), ml = dv.getUint32(20, true);
  const hash = hashBytes(new Uint8Array(buf));
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 32, ml)));
  let o = 32 + pad4(ml);
  const xd = new Uint16Array(buf, o, n);
  o += n * 2;
  const zd = new Uint16Array(buf, o, n);
  o += n * 2;
  const fq = new Uint16Array(buf, o, n);
  o += n * 2;
  const value = new Uint16Array(buf, o, n);
  o += n * 2;
  const yq = new Uint16Array(buf, o, n);
  o += n * 2;
  const sq = new Uint16Array(buf, o, n);
  o += n * 2;
  const tint = new Uint16Array(buf, o, n);
  o += n * 2;
  o = pad4(o);
  const kind = new Uint8Array(buf, o, n);
  o += pad4(n);
  const flags = new Uint8Array(buf, o, n);
  o += pad4(n);
  const xh = new Int8Array(buf, o, n);
  o += pad4(n);
  const zh = new Int8Array(buf, o, n);
  o += pad4(n);
  const movers = new Float32Array(buf, o, nMov * MOVER_STRIDE);
  o += nMov * MOVER_STRIDE * 4;
  const sx = new Float32Array(buf, o, s);
  o += s * 4;
  const sz = new Float32Array(buf, o, s);
  o += s * 4;
  const dens = new Uint16Array(buf, o, s);
  const x = new Float64Array(n), z = new Float64Array(n), fit = new Float64Array(n), yaw = new Float64Array(n), sc = new Float64Array(n);
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    px += xh[i] << 16 | xd[i];
    pz += zh[i] << 16 | zd[i];
    x[i] = px / 16;
    z[i] = pz / 16;
    fit[i] = fq[i] / 200;
    yaw[i] = yq[i] / 1024 * (Math.PI * 2);
    sc[i] = sq[i] / 64;
  }
  return { n, nB, nMov, hash, meta, bounds: meta.bounds, kinds: meta.kinds, x, z, fit, value, yaw, s: sc, tint, kind, flags, movers, spawn: { n: s, x: sx, z: sz, dens } };
}
__name(parseTable, "parseTable");
async function inflateIfGzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 31 && u8[1] === 139) {
    if (typeof DecompressionStream === "undefined") throw new Error("no DecompressionStream");
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  return buf;
}
__name(inflateIfGzip, "inflateIfGzip");

// ../src/config.js
var CFG = {
  roundSeconds: 300,
  dataUrl: "/data/riga.json",
  shapesUrl: "/data/riga-shapes.bin.gz",
  // optional: measured heights + simplified roof meshes (src/shapes.js)
  seed: 1337,
  mapsRanked: true,
  // the worker stores/serves one board per map (migrations/0004_maps.sql); the client sends map: <slug> (src/modes.js roundRequest, src/scores.js)
  hole: {
    startRadius: START_RADIUS,
    baseSpeed: 12,
    // m/s at start radius
    speedExp: 0.38,
    // speed ~ (r/r0)^exp
    accel: 7,
    // velocity smoothing (1/s)
    radiusSmooth: 5,
    // radius smoothing (1/s)
    maxHoles: 16
  },
  // radius = r0 * (1 + score / k) ^ exp
  growth: { k: 16, exp: GROWTH_EXP },
  // k is set per game mode at runtime (src/modes.js, MODES in src/rules.js)
  // radius thresholds used for the "size level" HUD bar
  levels: [2.2, 3.5, 5.5, 8, 12, 18, 28, 42, 62, 90, 130],
  swallow: {
    reach: 0.92,
    // object centre must be within radius*reach
    fitRatio: 0.95,
    // object fit radius must be < radius*fitRatio
    durMin: 0.6,
    durMax: 1,
    wobbleRatio: 2.6
    // too-big objects up to this multiple of radius wobble
  },
  value: {
    person: 1,
    bin: 1,
    lamp: 2,
    bench: 2,
    tree: 2,
    car: 4,
    van: 6,
    kiosk: 6,
    bus: 14,
    tram: 22,
    monument: 120,
    freedom: 450,
    trolley: 16,
    shelter: 4,
    flag: 2,
    parasol: 3,
    stall: 6,
    bike: 1,
    boat: 12,
    ferry: 45,
    swan: 3,
    bird: 1,
    laima: 45,
    pylon: 160,
    railarch: 90,
    platformroof: 70,
    landmarkBonus: 2,
    catHouse: 120,
    buildingDiv: 71,
    // building points = area*mean height / div (70 before the measured heights/shapes; measured volumes are ~20% bigger)
    buildingMin: 4,
    landmarkMul: 2.5
  },
  sightFit: { heightFrac: 0.34, max: 26 },
  // landmarks / tier A sights: fit >= 0.34 x height (<= 26 m): the Freedom Monument (42 m) needs a hole of ~15 m
  buildingFit: { boxWeight: 0.5, areaWeight: 0.5 },
  // blend of half-long-side and sqrt(A/pi)
  camera: {
    fov: 42,
    elevationDeg: 57,
    distBase: 7,
    distPerRadius: 17,
    // ~2x visible ground area vs. the MVP (5 + 11.5r); widens more as the hole grows
    zoomMin: 0.6,
    zoomMax: 2.6,
    // wheel / pinch multiplier limits
    smooth: 3.5,
    zoomSmooth: 2.2,
    lookAhead: 0.16,
    // max look-ahead as a fraction of camera distance
    leadTime: 0.9,
    // seconds of travel to lead by
    leadSmooth: 1.4
    // look-ahead smoothing (1/s)
  },
  props: {
    // iteration 5: the map grew from 5.8 to ~8.9 km^2 (left bank) -> ~+40 % props
    people: 3300,
    lamps: 980,
    benches: 360,
    bins: 450,
    cars: 1550,
    vans: 240,
    buses: 62,
    trams: 39,
    kiosks: 62,
    maxTrees: 4e4,
    parkExtraTrees: 0,
    forestSpacing: 8,
    forestMax: 28e3
    // dense pine forest on ground class 10 (src/scatter.js); 0 = off
  },
  groundUrl: "/data/riga-ground.png",
  // optional: class raster measured from an open orthophoto (tools/surface); stylised flat colours
  // ground texture density per quality tier [low, medium, high] (tier = quality.js groundTier(): mobile / low-memory -> 0). Tiles are ~300 m;
  // tiles that are plain river water get an 8 px texture. Close-up sharpness comes from the DetailLayer (px per 110 m window).
  ground: { tileM: 300, pxPerM: [1.05, 1.5, 2.5], detailPx: [1536, 2048, 2048], margin: 60 },
  shadowMapSize: 2048,
  pixelRatioCap: 2,
  colors: {
    sky: 13623532,
    paving: "#d9d4c7",
    park: "#a6c87f",
    parkDark: "#8aae67",
    water: "#5f86a3",
    waterEdge: "#86a8bf",
    road: "#8d8c88",
    roadMajor: "#84837f",
    walk: "#dcd5c5",
    footprint: "#c6bca8",
    rail: "#6d6862",
    wall: {
      res: [15326396, 14862223, 14066298, 15258544, 13606008, 14469540, 13220250, 15055258],
      com: [14209732, 13091510, 11975872, 14340282],
      pub: [14930862, 14270604, 13481882],
      rel: [14274495, 13219996],
      ind: [11701364, 11045495, 10129286],
      aux: [13483942, 12298382],
      oth: [14470576, 13482138]
    },
    roof: [11885116, 11030586, 12608831, 10242613, 12083516, 6984836, 7905424, 9136988]
  },
  holeColors: [15226671, 3117032, 15251503, 8146896, 3126668, 13648010, 9225791, 9067067],
  // ---- opponents -------------------------------------------------------
  bots: {
    // the values below are the NORMAL profile; DIFFICULTY (further down) overrides them per level via applyDifficulty()
    count: 7,
    difficulty: 1,
    // global skill multiplier (0.6 easy .. 1.3 hard); scales speed + decision quality
    thinkHz: 6,
    // brain ticks per second per bot (staggered)
    speedMin: 0.86,
    speedMax: 1,
    // per-bot speed factor (x difficulty, capped at 1.04)
    reactMin: 0.15,
    reactMax: 0.6,
    // seconds before a bot reacts to a threat
    aimNoise: 0.22,
    // radians of steering jitter at difficulty 1
    aggressionMin: 0.2,
    aggressionMax: 0.9,
    // chance/range of hunting smaller holes
    spawnMinDist: 260,
    // min distance between spawn points (m)
    roamEatTime: 22,
    // s: roam scoring = area value / (this + travel time); bigger = roams further
    huntRange: 2,
    // hunt smaller holes only within ~this x own radius (x aggression)
    huntGreed: 2,
    // hunt when victim score*gain / catch time > own eat rate x (this - aggression)
    preyMinFrac: 0.25,
    // ignore prey whose score is below this fraction of ours
    leaderRestraint: 1,
    // a bot clearly leading the board adds this to huntGreed against other bots (less snowballing)
    underdogCare: 0.35,
    // bots below 35% of the leader's score flee earlier (zone x1.3) and react faster
    roamGain: 1.4,
    // roam only when another area scores this many times better than here (+ less for skilled bots)
    gain: 1,
    // growth handicap: bots receive this fraction of an object's points (easy: fewer, so the player can out-grow them)
    humanGrace: 0,
    // s from the round start in which bots do not hunt human players (they still eat and flee)
    humanRatio: 1,
    // bots hunt a human only when they are this many times bigger than the minimum duel ratio
    respawnGrace: 0,
    // s after a human respawn in which bots do not hunt it (no spawn camping)
    catchUp: 0
    // easy: a bot more than 1.2x ahead of the human loses growth (gain x (1 - catchUp * (lead - 1.2)), floor 0.45): a runaway bot cannot end the race early
  },
  // ---- hole vs hole ------------------------------------------------------
  duel: {
    ratio: 1.15,
    // eater radius must be >= victim radius * ratio
    reach: 0.62,
    // victim centre must be within eater.radius * reach
    gain: 0.5,
    // fraction of victim score the eater receives
    dyingTime: 0.7,
    // victim shrink/spiral animation (s)
    respawnDelay: 3,
    // s until victim reappears
    keepScore: 0.5,
    // fraction of score kept after respawn (the HUMAN's value: set by the difficulty, easy 0.65)
    protect: 3,
    // spawn protection (s) (the human's value, easy 4.5)
    botKeepScore: 0.5,
    botProtect: 3,
    // bots always respawn with the classic numbers
    minRespawnDist: 140
    // preferred distance from other holes when respawning
  },
  intro: { hold: 1.2, glide: 2.5 },
  // round-start fly-in: hold on the overview, then ease down to the player (s)
  roundWarn: 10,
  // timer pulses in the last N seconds
  playerName: "Tu"
};
var DIFFICULTY = {
  easy: {
    bots: {
      difficulty: 0.62,
      speedMin: 0.62,
      speedMax: 0.8,
      thinkHz: 4,
      reactMin: 0.5,
      reactMax: 1.4,
      aimNoise: 0.3,
      aggressionMin: 0.05,
      aggressionMax: 0.4,
      huntRange: 1.2,
      huntGreed: 3,
      preyMinFrac: 0.45,
      gain: 0.67,
      humanGrace: 75,
      humanRatio: 1.45,
      respawnGrace: 25,
      catchUp: 0.6
    },
    duel: { keepScore: 0.65, protect: 4.5 },
    mapSkill: 0.4
    // exponent of the per-map bot skill multiplier (tools/maps.mjs mult.bots): damped on easy
  },
  normal: {
    bots: {
      difficulty: 0.9,
      speedMin: 0.82,
      speedMax: 0.96,
      thinkHz: 6,
      reactMin: 0.2,
      reactMax: 0.7,
      aimNoise: 0.22,
      aggressionMin: 0.15,
      aggressionMax: 0.7,
      huntRange: 1.8,
      huntGreed: 2.2,
      preyMinFrac: 0.3,
      gain: 0.6,
      humanGrace: 20,
      humanRatio: 1.1,
      respawnGrace: 8,
      catchUp: 0
    },
    duel: { keepScore: 0.5, protect: 3 }
  },
  hard: {
    bots: {
      difficulty: 1,
      speedMin: 0.86,
      speedMax: 1,
      thinkHz: 6,
      reactMin: 0.15,
      reactMax: 0.6,
      aimNoise: 0.22,
      aggressionMin: 0.2,
      aggressionMax: 0.9,
      huntRange: 2,
      huntGreed: 2,
      preyMinFrac: 0.25,
      gain: 1,
      humanGrace: 0,
      humanRatio: 1,
      respawnGrace: 0,
      catchUp: 0
    },
    duel: { keepScore: 0.5, protect: 3 }
  }
};
CFG.profiles = DIFFICULTY;
CFG.radio = {
  enabled: true,
  stations: [
    { id: "lr2", name: "Latvijas Radio 2", url: "https://lsm.eu.cdns-redge.media/livehls/o2/lsm-live/live/audio/lr2_radio/live.livx/playlist.m3u8?renditions", type: "hls", link: "https://lr2.lsm.lv", linkLabel: "lr2.lsm.lv" }
  ]
};
CFG.features = { combo: true, powerups: true };

// ../worker/mp/powerups.js
var FX_GRACE_MS = { speed: 900, magnet: 700, double: 400, shield: 0 };
var makeFx = /* @__PURE__ */ __name(() => ({ magnet: 0, speed: 0, double: 0, shield: 0 }), "makeFx");
function makeField(table, seed) {
  return new PowerupField({ seed, cand: candidatesFromSpawn(table.spawn), count: puCountFor(table.bounds) });
}
__name(makeField, "makeField");
var fxOn = /* @__PURE__ */ __name((h, type, ms) => h.fxUntil[type] + FX_GRACE_MS[type] > ms, "fxOn");
function fxMask(h, ms) {
  let m = 0;
  for (const t of PU_TYPES) if (h.fxUntil[t] > ms) m |= 1 << PU_ORDER[t];
  return m;
}
__name(fxMask, "fxMask");
var fxRemain = /* @__PURE__ */ __name((h, ms) => PU_TYPES.map((t) => Math.max(0, Math.round(h.fxUntil[t] - ms))), "fxRemain");
var speedFactor = /* @__PURE__ */ __name((h, ms) => fxOn(h, "speed", ms) ? PU.speed.mul : 1, "speedFactor");
var reachFactor = /* @__PURE__ */ __name((h, ms) => fxOn(h, "magnet", ms) ? magnetFactor(h.r) : 1, "reachFactor");
var doubleMul = /* @__PURE__ */ __name((h, ms) => h.fxUntil.double + FX_GRACE_MS.double > ms ? PU.double.mul : 1, "doubleMul");
function grant(h, type, ms, scale = 1) {
  h.fxUntil[type] = ms + PU[type].dur * 1e3 * scale;
  h.picks[type]++;
}
__name(grant, "grant");

// ../worker/mp/sim.js
var GROWTH_K = 16;
var D = CFG.duel;
var S = CFG.swallow;
var H = CFG.hole;
var TAU = Math.PI * 2;
var CELL = 24;
var COARSE = 80;
var FIT_BUCKETS = [3, 6, 12, 25, 50, 1e9];
var radiusOf = /* @__PURE__ */ __name((score) => radiusAt(score, GROWTH_K), "radiusOf");
var speedOf = /* @__PURE__ */ __name((r) => H.baseSpeed * Math.pow(r / H.startRadius, H.speedExp), "speedOf");
var BOT_NAMES = [
  "J\u0101nis",
  "L\u012Bga",
  "Ka\u0137is",
  "R\u016B\u0137is",
  "Laima",
  "Bebrs",
  "\u016Adris",
  "Za\u0137is",
  "L\u0101cis",
  "Vilks",
  "P\u016Bce",
  "Dzintars",
  "Zane",
  "Ieva",
  "M\u0101ris",
  "Baiba",
  "Uldis",
  "K\u0101rlis",
  "Ilze",
  "Gundega",
  "Kurmis",
  "Ezis",
  "V\u0101vere",
  "Spr\u012Bd\u012Btis"
];
var StaticIndex = class {
  static {
    __name(this, "StaticIndex");
  }
  constructor(table) {
    const b = table.bounds;
    this.t = table;
    this.x0 = b.minX;
    this.z0 = b.minZ;
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL) + 1);
    this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL) + 1);
    const cells = this.nx * this.nz;
    const cnt = new Int32Array(cells + 1);
    const cellOf = new Int32Array(table.n).fill(-1);
    for (let i = 0; i < table.n; i++) {
      if (table.flags[i] & F_MOVER) continue;
      const c = this._cell(table.x[i], table.z[i]);
      if (c < 0) continue;
      cellOf[i] = c;
      cnt[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cnt[c + 1] += cnt[c];
    this.start = cnt;
    this.items = new Int32Array(cnt[cells]);
    const fill = cnt.slice(0, cells);
    for (let i = 0; i < table.n; i++) if (cellOf[i] >= 0) this.items[fill[cellOf[i]]++] = i;
    this.cx = Math.max(1, Math.ceil((b.maxX - b.minX) / COARSE));
    this.cz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / COARSE));
    this.coarse0 = new Float32Array(FIT_BUCKETS.length * this.cx * this.cz);
    for (let i = 0; i < table.n; i++) {
      if (cellOf[i] < 0) continue;
      const ci = this._coarse(table.x[i], table.z[i]);
      if (ci < 0) continue;
      for (let k = 0; k < FIT_BUCKETS.length; k++) if (table.fit[i] < FIT_BUCKETS[k]) this.coarse0[k * this.cx * this.cz + ci] += table.value[i];
    }
  }
  _cell(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  _coarse(x, z) {
    const i = Math.floor((x - this.x0) / COARSE), j = Math.floor((z - this.z0) / COARSE);
    return i < 0 || j < 0 || i >= this.cx || j >= this.cz ? -1 : j * this.cx + i;
  }
  /** fn(id, dist) for every non-mover object within r (eaten ones are skipped by the caller via `eaten`). */
  query(cx, cz, r, eaten, fn) {
    const t = this.t;
    const i0 = Math.max(0, Math.floor((cx - r - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((cx + r - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((cz - r - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((cz + r - this.z0) / CELL));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nx + i;
      for (let n = this.start[c], e = this.start[c + 1]; n < e; n++) {
        const id = this.items[n];
        if (eaten[id]) continue;
        const dx = t.x[id] - cx, dz = t.z[id] - cz, d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(id, Math.sqrt(d2));
      }
    }
  }
};
function makeHole({ id, slot, name, bot, token }) {
  return {
    id,
    slot,
    name,
    bot: !!bot,
    token: token || null,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    score: 0,
    mass: 0,
    r: H.startRadius,
    eaten: 0,
    kills: 0,
    deaths: 0,
    biggest: 0,
    combo: new Combo(),
    comboScale: 1,
    fxUntil: makeFx(),
    picks: { magnet: 0, speed: 0, double: 0, shield: 0 },
    rtt: 0,
    lastClaimMs: 0,
    lastClaimNow: 0,
    puBudget: 0,
    state: 0,
    dyingEnd: 0,
    respawnAt: 0,
    protectUntil: 0,
    by: -1,
    connected: !bot,
    discAt: 0,
    lastPosAt: 0,
    budget: 0,
    claimBudget: 0,
    moverBudget: 0,
    claimT: 0,
    violations: 0,
    rejected: 0,
    tx: 0,
    tz: 0,
    speedMul: 1,
    brain: null,
    dead: false
  };
}
__name(makeHole, "makeHole");
var RoomSim = class {
  static {
    __name(this, "RoomSim");
  }
  /** table: parsed object table (worker/mp/table.js); cfg: mpConfig(env); seed: any int. */
  constructor(table, cfg, seed = 1) {
    this.table = table;
    this.cfg = cfg;
    this.rng = mulberry32(seed);
    this.index = table.index || (table.index = new StaticIndex(table));
    this.eaten = new Uint8Array(table.n);
    this.coarse = Float32Array.from(this.index.coarse0);
    this.holes = [];
    this.byId = /* @__PURE__ */ new Map();
    this.nextId = 0;
    this.phase = "lobby";
    this.startAt = this.playAt = this.endAt = 0;
    this.lastTick = 0;
    this.ev = { e: [], k: [], r: [], d: [], ps: [], pp: [], px: [] };
    this.field = null;
    this.maxSpawnDens = 0;
    this.eatenList = [];
    this.left = [];
  }
  // ---- membership ----------------------------------------------------------------------------------------------
  freeSlot() {
    const used = new Set(this.holes.map((h) => h.slot));
    for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
    return this.holes.length;
  }
  humans() {
    return this.holes.filter((h) => !h.bot);
  }
  /** id/slot may be given by the lobby (so ids and colours stay what the players already saw). */
  addHuman(name, token, id = this.nextId, slot = this.freeSlot()) {
    this.nextId = Math.max(this.nextId, id + 1);
    const h = makeHole({ id, slot, name, token });
    this.holes.push(h);
    this.byId.set(h.id, h);
    return h;
  }
  removeHole(id) {
    const h = this.byId.get(id);
    if (!h) return;
    this.holes.splice(this.holes.indexOf(h), 1);
    this.byId.delete(id);
    h.dead = true;
    this.ev.d.push(id);
  }
  /** A human that never came back inside the grace period: the hole leaves the arena but stays in the final ranking with what it had. */
  leaveHuman(id) {
    const h = this.byId.get(id);
    if (!h || h.bot) return;
    this.removeHole(id);
    this.left.push({ id: h.id, name: h.name, slot: h.slot, token: h.token, bot: false, left: true, score: h.score, eaten: h.eaten, kills: h.kills, deaths: h.deaths, r: h.r, combo: h.combo });
  }
  // ---- round start ----------------------------------------------------------------------------------------------
  start(now2, introMs, roundMs) {
    this.phase = "intro";
    this.startAt = now2;
    this.playAt = now2 + introMs;
    this.endAt = this.playAt + roundMs;
    const humans = this.humans();
    const nBots = Math.max(0, this.cfg.totalHoles - humans.length);
    const pool = BOT_NAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < nBots; i++) {
      const h = makeHole({ id: this.nextId++, slot: this.freeSlot(), name: pool[i % pool.length], bot: true });
      h.speedMul = Math.min(1.04, CFG.bots.speedMin + (CFG.bots.speedMax - CFG.bots.speedMin) * this.rng());
      h.brain = new BotBrain(h, this.rng, i, nBots, this.cfg.botSkill ?? 1);
      h.comboScale = this.cfg.botComboScale ?? 1;
      h.speedMul *= h.brain.speedScale;
      this.holes.push(h);
      this.byId.set(h.id, h);
    }
    const sp = this.table.spawn;
    const placed = [];
    if (this.cfg.testCloseSpawn && sp.n > 3) {
      const first = this.pickSpawns(1, [])[0];
      placed.push(first);
      const near = [];
      for (let i = 0; i < sp.n; i++) {
        const d = Math.hypot(sp.x[i] - first.x, sp.z[i] - first.z);
        if (d >= 30) near.push([d, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < humans.length && near.length; k++) {
        const i = near[(k - 1) * 3 % near.length][1];
        placed.push({ x: sp.x[i], z: sp.z[i] });
      }
      for (const p of this.pickSpawns(this.holes.length - placed.length, placed)) placed.push(p);
    } else {
      for (const p of this.pickHumanSpawns(humans.length)) placed.push(p);
      for (const p of this.pickSpawns(this.holes.length - placed.length, placed)) placed.push(p);
    }
    const shuffle = /* @__PURE__ */ __name((a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }, "shuffle");
    const order = [...shuffle(this.holes.filter((h) => !h.bot)), ...shuffle(this.holes.filter((h) => h.bot))];
    order.forEach((h, i) => {
      const p = placed[i % placed.length];
      h.x = p.x;
      h.z = p.z;
      h.tx = p.x;
      h.tz = p.z;
    });
    for (const h of this.holes) {
      h.lastMsgAt = now2;
      h.lastPosAt = this.playAt;
      h.budget = 0;
      h.claimBudget = this.cfg.claimBurst;
      h.moverBudget = this.cfg.moverPointsBurst;
    }
    this.puSeed = this.rng() * 4294967296 >>> 0;
    this.field = makeField(this.table, this.puSeed);
    this.puAt = this.playAt;
    for (const e of this.field.tick(0)) this._puEvent(e);
    this.ev.ps.length = 0;
    if (this.cfg.testPowerups && humans.length) this._testPowerups(humans);
    if (this.cfg.testStartMass && humans.length) {
      const q = humans.find((h) => h.name.startsWith("Big")) || humans[0];
      q.mass = q.score = this.cfg.testStartMass;
      q.r = radiusOf(q.mass);
    }
  }
  /** TEST ONLY (MP_TEST_PU=1): the humans are found by name (scripts/smoke-mp.mjs: 'PuA', 'PuB', 'Big...'). Slot 0 (speed) halfway between A and B (a race); slots 1 (shield) / 2 (magnet) / 3 (double) 8-9 m from A, on the side away from B (so the race never crosses them). */
  _testPowerups(humans) {
    const by = /* @__PURE__ */ __name((p, i) => humans.find((h) => h.name.startsWith(p)) || humans[Math.min(i, humans.length - 1)], "by");
    const h1 = by("PuA", 1), h2 = by("PuB", 2), sl = this.field.slots;
    let dx = h1.x - h2.x, dz = h1.z - h2.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const put = /* @__PURE__ */ __name((i, type, x, z) => {
      Object.assign(sl[i], { type, x, z, state: "on", until: 1e9 });
    }, "put");
    put(0, "speed", (h1.x + h2.x) / 2, (h1.z + h2.z) / 2);
    put(1, "shield", h1.x + dx * 8, h1.z + dz * 8);
    put(2, "magnet", h1.x - dz * 9, h1.z + dx * 9);
    put(3, "double", h1.x + dz * 9, h1.z - dx * 9);
  }
  _puEvent(e) {
    if (e.k === "spawn") this.ev.ps.push([e.slot, PU_ORDER[e.type], round1(e.x), round1(e.z)]);
    else this.ev.px.push(e.slot);
  }
  /** Active pickups [slot, typeIdx, x, z] (start / resume frames). */
  puList() {
    return this.field ? this.field.list().map(([s, t, x, z]) => [s, PU_ORDER[t], round1(x), round1(z)]) : [];
  }
  /**
   * Start points for the humans of one room, EQUALLY rich: find the richest density level T at which n points >= sep apart still exist,
   * then pick them (random, seeded) from the band [T, T * 1.08] - nobody gets the best spot while another starts in a poor one
   * (the old "densest first" greedy gave a 2.4x (2 humans) to 4.7x (12 humans) spread of food within 60 m).
   */
  pickHumanSpawns(n) {
    const sp = this.table.spawn;
    if (n <= 0 || sp.n < n) return this.pickSpawns(Math.max(0, n), []);
    if (!this.table._spawnFood) {
      const f = new Float32Array(sp.n), lim = H.startRadius * S.fitRatio;
      for (let i = 0; i < sp.n; i++) {
        let v = 0;
        this.index.query(sp.x[i], sp.z[i], 60, this.eaten, (id) => {
          if (this.table.fit[id] < lim) v += this.table.value[id];
        });
        f[i] = v;
      }
      this.table._spawnFood = f;
    }
    const dens = this.table._spawnFood;
    const idx = Array.from({ length: sp.n }, (_, i) => i).sort((a, b) => dens[b] - dens[a] || a - b);
    let sep = 0;
    const ok = /* @__PURE__ */ __name((out, i) => out.every((a) => Math.hypot(a.x - sp.x[i], a.z - sp.z[i]) >= sep), "ok");
    const greedy = /* @__PURE__ */ __name((list) => {
      const out = [];
      for (const i of list) {
        if (out.length >= n) break;
        if (ok(out, i)) out.push({ x: sp.x[i], z: sp.z[i], i });
      }
      return out;
    }, "greedy");
    let pick = null;
    for (const sp0 of [200, 150, 110, 80, 60]) {
      sep = sp0;
      let found = -1;
      for (let k = n - 1; k < Math.min(idx.length, 1500); k++) {
        if (greedy(idx.slice(0, k + 1)).length >= n) {
          found = k;
          break;
        }
      }
      if (found < 0) continue;
      const T = dens[idx[found]], score = T * (1 + 15e-4 * (sp0 - 60));
      if (!pick || score > pick.score) pick = { sep: sp0, found, T, score };
    }
    if (pick) {
      sep = pick.sep;
      const { found, T } = pick;
      const band = idx.slice(0, found + 1).filter((i) => dens[i] <= T * 1.08 + 1);
      for (let a = band.length - 1; a > 0; a--) {
        const j = Math.floor(this.rng() * (a + 1));
        [band[a], band[j]] = [band[j], band[a]];
      }
      const out = greedy(band);
      let res = out;
      if (res.length < n) res = greedy([...out.map((q) => q.i), ...idx.slice(0, found + 1).reverse()]);
      if (res.length < n) res = greedy(idx.slice(0, found + 1));
      return res.slice(0, n).map(({ x, z }) => ({ x, z }));
    }
    return this.pickSpawns(n, []);
  }
  /** Greedy spread of n start points over dense street points near the centre, `avoid` = already taken [{x,z}]. */
  pickSpawns(n, avoid) {
    const sp = this.table.spawn;
    const cand = [];
    for (let i = 0; i < sp.n; i++) cand.push([sp.dens[i] - Math.hypot(sp.x[i], sp.z[i]) * 0.03 + this.rng() * 25, i]);
    cand.sort((a, b) => b[0] - a[0]);
    const out = [];
    for (const minSep of [260, 150, 80, 30, 0]) {
      for (const [, i] of cand) {
        if (out.length >= n) break;
        const x = sp.x[i], z = sp.z[i];
        if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < minSep) || out.some((a) => Math.hypot(a.x - x, a.z - z) < minSep)) continue;
        out.push({ x, z });
      }
      if (out.length >= n) break;
    }
    while (out.length < n) out.push({ x: (this.table.bounds.minX + this.table.bounds.maxX) / 2, z: (this.table.bounds.minZ + this.table.bounds.maxZ) / 2 });
    return out;
  }
  /** Respawn point: plenty of food for the new (smaller) size, far from the leaders and from every other hole. */
  pickRespawn(h) {
    const sp = this.table.spawn;
    const r = Math.max(H.startRadius, radiusOf(h.mass));
    const others = this.holes.filter((o) => o !== h && o.state === 0);
    const leaders = others.slice().sort((a, b) => b.score - a.score).slice(0, 3);
    let best = null, bs = -Infinity;
    for (let k = 0; k < 64; k++) {
      const i = Math.floor(this.rng() * sp.n);
      const x = sp.x[i], z = sp.z[i];
      let md = 1e4, ld = 1e4;
      for (const o of others) md = Math.min(md, Math.hypot(o.x - x, o.z - z) - Math.max(0, o.r - r) * 3);
      for (const o of leaders) ld = Math.min(ld, Math.hypot(o.x - x, o.z - z));
      let food = 0;
      this.index.query(x, z, Math.max(45, r * 5), this.eaten, (id) => {
        if (this.table.fit[id] < r * S.fitRatio) food += this.table.value[id];
      });
      let s = Math.min(food, 400) * 1.2 + Math.min(md, D.minRespawnDist * 1.3) * 0.15 + Math.min(ld, 400) * 0.25 + this.rng() * 10;
      if (md < D.minRespawnDist) s -= (D.minRespawnDist - md) * 3;
      if (s > bs) {
        bs = s;
        best = { x, z };
      }
    }
    return best || { x: h.x, z: h.z };
  }
  // ---- client input (validated) -----------------------------------------------------------------------------------
  /** Returns null if accepted, or {x,z} = rubber-band target. */
  handlePos(h, x, z, now2) {
    if (this.phase !== "playing" || h.state !== 0 || h.bot) return null;
    const c = this.cfg, b = this.table.bounds;
    const dt = Math.min(2, Math.max(0, (now2 - h.lastPosAt) / 1e3));
    h.lastPosAt = now2;
    const vmax = speedOf(h.r) * c.speedTol * speedFactor(h, now2);
    h.budget = Math.min(h.budget + vmax * dt, vmax * c.burstSeconds + c.posSlack);
    x = Math.min(b.maxX, Math.max(b.minX, x));
    z = Math.min(b.maxZ, Math.max(b.minZ, z));
    const d = Math.hypot(x - h.x, z - h.z);
    if (d <= h.budget + 0.5) {
      h.budget = Math.max(0, h.budget - d);
      if (dt > 0.01) {
        h.vx = (x - h.x) / dt;
        h.vz = (z - h.z) / dt;
      }
      h.x = x;
      h.z = z;
      return null;
    }
    h.violations++;
    return { x: h.x, z: h.z };
  }
  /**
   * Validate eat claims. statics: [id], movers: [[id,x,z]]. Returns {bad:[ids], ok:n}.
   * `ct` = the client's own timestamp (its estimate of server ms) of the batch: combos use it so network jitter / latency does not break a combo
   * (a 300 ms player keeps theirs), clamped to [now - allowance, now] where the allowance grows with the RTT the client reports (never trusted beyond 1.0 s)
   * and never goes backwards. Without `ct` the server's receipt time is used.
   */
  handleClaims(h, statics, movers, now2, ct) {
    const bad = [];
    const t = this.table, c = this.cfg;
    if (this.phase !== "playing" || h.state !== 0) {
      for (const id of statics) bad.push(id);
      for (const m of movers) bad.push(m[0]);
      return { bad, ok: 0 };
    }
    const dtc = Math.min(2, Math.max(0, (now2 - h.claimT) / 1e3));
    h.claimT = now2;
    h.claimBudget = Math.min(c.claimBurst, h.claimBudget + c.claimRate * dtc);
    h.moverBudget = Math.min(c.moverPointsBurst, h.moverBudget + c.moverPointsRate * dtc);
    const vmax = speedOf(h.r) * c.speedTol * speedFactor(h, now2);
    const reach = h.r * S.reach * reachFactor(h, now2) + vmax * c.reachSlackSeconds + 1.5;
    const maxFit = h.r * S.fitRatio * 1.03;
    const lag = 450 + Math.min(550, 1.5 * (h.rtt || 0));
    let tMs = Math.max(h.lastClaimMs, Math.min(now2, Math.max(now2 - lag, Number.isFinite(ct) ? ct : now2)));
    if (h.lastClaimNow > 0) tMs = Math.max(tMs, Math.min(now2, h.lastClaimMs + (now2 - h.lastClaimNow) - COMBO.stampJitter * 1e3));
    h.lastClaimMs = tMs;
    h.lastClaimNow = now2;
    let ok = 0;
    const take = /* @__PURE__ */ __name((id, isMover, mx, mz) => {
      if (!Number.isInteger(id) || id < 0 || id >= t.n || this.eaten[id]) return false;
      const mv = (t.flags[id] & F_MOVER) !== 0;
      if (mv !== isMover) return false;
      if (h.claimBudget < 1) return false;
      h.claimBudget -= 1;
      if (t.fit[id] >= maxFit) return false;
      const px = isMover ? mx : t.x[id], pz = isMover ? mz : t.z[id];
      if (Math.hypot(px - h.x, pz - h.z) > reach) return false;
      if (isMover) {
        if (h.moverBudget < t.value[id]) return false;
        h.moverBudget -= t.value[id];
      }
      this.eat(h, id, tMs);
      return true;
    }, "take");
    for (const id of statics) {
      if (take(id, false)) ok++;
      else bad.push(id);
    }
    for (const m of movers) {
      if (take(m[0], true, m[1], m[2])) ok++;
      else bad.push(m[0]);
    }
    h.rejected += bad.length;
    return { bad, ok };
  }
  /** `ms` = the time the swallow counts at (claim time for humans, server time for bots). */
  eat(h, id, ms) {
    const t = this.table;
    this.eaten[id] = 1;
    this.eatenList.push(id);
    h.eaten++;
    const mass = t.value[id];
    const c = h.combo.hit(ms / 1e3, comboWeight((t.flags[id] & F_BUILDING) !== 0, t.fit[id], mass) * h.comboScale, h.r, h.bot ? 0 : COMBO.netSlack);
    const pts = mass * totalMult(c.mult, doubleMul(h, ms));
    h.mass += mass;
    h.score += pts;
    h.rawEaten = (h.rawEaten || 0) + mass;
    h.swPts = (h.swPts || 0) + pts;
    h.r = radiusOf(h.mass);
    if (t.fit[id] > h.biggest) h.biggest = t.fit[id];
    this.ev.e.push([id, h.id]);
    if (!(t.flags[id] & F_MOVER)) {
      const ci = this.index._coarse(t.x[id], t.z[id]);
      if (ci >= 0) {
        const n = this.index.cx * this.index.cz;
        for (let k = 0; k < FIT_BUCKETS.length; k++) if (t.fit[id] < FIT_BUCKETS[k]) this.coarse[k * n + ci] = Math.max(0, this.coarse[k * n + ci] - t.value[id]);
      }
    }
  }
  // ---- simulation step ----------------------------------------------------------------------------------------------
  /** Advance to wall-clock `now` (ms). Returns true while the round is running. */
  tick(now2) {
    if (this.phase === "intro" && now2 >= this.playAt) {
      this.phase = "playing";
      this.lastTick = now2;
      for (const h of this.holes) h.lastPosAt = now2;
    }
    if (this.phase !== "playing") return false;
    const dt = Math.min(0.12, Math.max(1e-3, (now2 - this.lastTick) / 1e3));
    this.lastTick = now2;
    this._now = now2;
    const sec = now2 / 1e3;
    for (const h of this.holes.slice()) {
      if (!h.bot && h.connected && h.lastMsgAt && now2 - h.lastMsgAt > this.cfg.silentAfterMs) {
        h.connected = false;
        h.discAt = now2;
      }
      if (!h.bot && !h.connected && now2 - h.discAt > this.cfg.removeAfterMs) {
        this.leaveHuman(h.id);
        continue;
      }
      if (h.state === 1) {
        if (now2 >= h.dyingEnd) h.state = 2;
        continue;
      }
      if (h.state === 2) {
        if (now2 >= h.respawnAt) this.respawn(h, now2);
        continue;
      }
      if (h.bot) {
        if (now2 < this.playAt + 600) continue;
        h.brain.maybeThink(this, sec);
        this.moveBot(h, dt);
        this.botEat(h);
      }
    }
    if (this.field) {
      for (const e of this.field.tick((now2 - this.playAt) / 1e3)) this._puEvent(e);
      for (const h of this.holes) if (h.bot && h.state === 0) this.botPickup(h, now2);
    }
    this.duels(now2);
    if (now2 >= this.endAt) {
      this.phase = "ended";
      return false;
    }
    return true;
  }
  // ---- power-ups ------------------------------------------------------------------------------------------------------------
  grantPickup(h, slot, now2) {
    const type = this.field.take(slot, (now2 - this.playAt) / 1e3);
    if (!type) return null;
    grant(h, type, now2, this.cfg.testFxScale || 1);
    this.ev.pp.push([slot, h.id, PU_ORDER[type], Math.round(PU[type].dur * 1e3 * (this.cfg.testFxScale || 1))]);
    return type;
  }
  /** A human CLAIMS pickups ([slot..]). Accepted when the slot is live and the hole (server-known position) is within the pickup radius + latency allowance. Returns rejected slots. */
  handlePickups(h, slots, now2) {
    const bad = [];
    if (!this.field || this.phase !== "playing" || h.state !== 0) return slots.slice();
    const vmax = speedOf(h.r) * this.cfg.speedTol * speedFactor(h, now2);
    const slack = vmax * this.cfg.reachSlackSeconds + 1.5;
    for (const slot of slots) {
      const s = Number.isInteger(slot) ? this.field.slots[slot] : null;
      if (!s || s.state !== "on" || Math.hypot(s.x - h.x, s.z - h.z) > pickRadius(h.r) + slack) {
        bad.push(slot);
        continue;
      }
      this.grantPickup(h, slot, now2);
    }
    return bad;
  }
  botPickup(h, now2) {
    const slot = this.field.touching(h.x, h.z, h.r);
    if (slot >= 0) this.grantPickup(h, slot, now2);
  }
  moveBot(h, dt) {
    const dx0 = h.tx - h.x, dz0 = h.tz - h.z, l = Math.hypot(dx0, dz0);
    let dx = 0, dz = 0, mag = 0;
    const slow = Math.max(h.r * 0.5, 1);
    if (l > 0.05) {
      dx = dx0 / l;
      dz = dz0 / l;
      mag = Math.min(1, l / slow);
    }
    const k = 1 - Math.exp(-H.accel * dt);
    const sp = speedOf(h.r) * h.speedMul;
    h.vx += (dx * mag * sp - h.vx) * k;
    h.vz += (dz * mag * sp - h.vz) * k;
    const b = this.table.bounds;
    h.x = Math.min(b.maxX, Math.max(b.minX, h.x + h.vx * dt));
    h.z = Math.min(b.maxZ, Math.max(b.minZ, h.z + h.vz * dt));
  }
  botEat(h) {
    const t = this.table, maxFit = h.r * S.fitRatio, reach = h.r * S.reach * (h.fxUntil.magnet > this._now ? magnetFactor(h.r) : 1);
    const hit = this._hit || (this._hit = []);
    hit.length = 0;
    this.index.query(h.x, h.z, reach, this.eaten, (id) => {
      if (t.fit[id] < maxFit) hit.push(id);
    });
    for (let i = 0; i < hit.length; i++) this.eat(h, hit[i], this._now);
  }
  duels(now2) {
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      if (a.state !== 0 || now2 < a.protectUntil) continue;
      for (let j = 0; j < hs.length; j++) {
        const b = hs[j];
        if (i === j || b.state !== 0 || now2 < b.protectUntil) continue;
        if (b.fxUntil.shield > now2) continue;
        if (a.r < b.r * D.ratio) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.r * D.reach) this.kill(a, b, now2);
      }
    }
  }
  kill(eater, victim, now2) {
    const gain = victim.score * D.gain, massGain = victim.mass * D.gain;
    victim.state = 1;
    victim.by = eater.id;
    victim.dyingEnd = now2 + D.dyingTime * 1e3;
    victim.respawnAt = victim.dyingEnd + D.respawnDelay * 1e3;
    victim.vx = victim.vz = 0;
    victim.deaths++;
    eater.kills++;
    eater.score += gain;
    eater.mass += massGain;
    eater.r = radiusOf(eater.mass);
    this.ev.k.push([eater.id, victim.id, Math.round(gain)]);
  }
  respawn(h, now2) {
    const p = this.pickRespawn(h);
    h.score *= D.keepScore;
    h.mass *= D.keepScore;
    h.r = radiusOf(h.mass);
    h.combo.drop();
    h.fxUntil = makeFx();
    h.x = p.x;
    h.z = p.z;
    h.tx = p.x;
    h.tz = p.z;
    h.vx = h.vz = 0;
    h.state = 0;
    h.by = -1;
    h.protectUntil = now2 + D.protect * 1e3;
    h.lastPosAt = now2;
    h.budget = 0;
    if (h.brain) h.brain.reset(now2 / 1e3);
    this.ev.r.push([h.id, round1(h.x), round1(h.z), Math.round(h.score), Math.round(h.mass)]);
  }
  // ---- outgoing ---------------------------------------------------------------------------------------------------------
  snapshot(now2) {
    const m = {
      t: "s",
      T: now2,
      h: this.holes.map((h) => [h.id, round1(h.x), round1(h.z), Math.round(h.r * 100) / 100, Math.round(h.score), h.state, fxMask(h, now2)])
    };
    const ev = this.ev;
    if (ev.e.length) m.e = ev.e;
    if (ev.k.length) m.k = ev.k;
    if (ev.r.length) m.r = ev.r;
    if (ev.d.length) m.d = ev.d;
    if (ev.ps.length) m.ps = ev.ps;
    if (ev.pp.length) m.pp = ev.pp;
    if (ev.px.length) m.px = ev.px;
    this.ev = { e: [], k: [], r: [], d: [], ps: [], pp: [], px: [] };
    return m;
  }
  ranking() {
    return [...this.holes, ...this.left].sort((a, b) => b.score - a.score || a.id - b.id).map((h, i) => ({
      rank: i + 1,
      id: h.id,
      name: h.name,
      slot: h.slot,
      bot: h.bot,
      score: Math.round(h.score),
      eaten: h.eaten,
      kills: h.kills,
      deaths: h.deaths,
      radius: Math.round(h.r * 100) / 100,
      bestCombo: Math.round(h.combo.best),
      bestMult: h.combo.bestMult,
      ...h.left ? { left: true } : null
    }));
  }
};
var round1 = /* @__PURE__ */ __name((v) => Math.round(v * 10) / 10, "round1");
var BotBrain = class {
  static {
    __name(this, "BotBrain");
  }
  constructor(h, rng, idx, count, botSkill = 1) {
    this.h = h;
    this.rng = rng;
    this.idx = idx;
    const B = CFG.bots;
    this.skill = 0.85 + rng() * 0.3;
    this.react = B.reactMin + (B.reactMax - B.reactMin) * rng();
    this.aggr = B.aggressionMin + (B.aggressionMax - B.aggressionMin) * rng();
    this.noise = B.aimNoise * (0.6 + rng() * 0.8) * 0.4;
    this.hz = 4;
    this.speedScale = 1;
    this.puChance = 0.45;
    if (botSkill < 1) {
      const lvl = Math.min(1, botSkill * (0.78 + 0.44 * rng()));
      this.puChance = 0.08 + 0.3 * lvl;
      this.speedScale = 0.2 + 0.8 * lvl;
      this.noise *= 1.9 - lvl;
      this.react += (1 - lvl) * 0.5;
      this.skill *= Math.sqrt(lvl);
      this.hz = 4 * (0.55 + 0.45 * lvl);
    }
    this.cands = [];
    this.reset(0);
    this.nextThink = idx / Math.max(1, count) / this.hz + rng() * 0.1;
  }
  reset(now2) {
    this.nextThink = now2 + 0.1 + this.rng() * 0.2;
    this.goal = -1;
    this.goalUntil = 0;
    this.banId = -1;
    this.banUntil = 0;
    this.threatSince = -1;
    this.roam = null;
    this.nextRoam = now2 + 0.5 + this.rng() * 1.5;
    this.lastX = this.h.x;
    this.lastZ = this.h.z;
    this.lastCheck = now2;
    this.prey = null;
    this.huntSince = 0;
    this.preyBan = -1;
    this.preyBanUntil = 0;
    this.rate = 1;
    this.rateScore = this.h.mass;
    this.rateT = now2;
    this.puGoal = -1;
    this.puUntil = 0;
    this.puCool = now2 + 15;
    this.heading = this.rng() * TAU;
  }
  maybeThink(sim, now2) {
    if (now2 < this.nextThink) return;
    this.nextThink = now2 + 1 / this.hz * (0.85 + this.rng() * 0.3);
    this.think(sim, now2);
  }
  think(sim, now2) {
    const h = this.h, r = h.r, t = sim.table, b = t.bounds, B = CFG.bots;
    if (now2 - this.rateT >= 2) {
      this.rate = this.rate * 0.5 + 0.5 * Math.max(0, h.mass - this.rateScore) / (now2 - this.rateT);
      this.rateScore = h.mass;
      this.rateT = now2;
    }
    if (now2 - this.lastCheck > 1.5) {
      if (this.goal >= 0 && Math.hypot(h.x - this.lastX, h.z - this.lastZ) < Math.max(0.4, r * 0.3) * 0.5) {
        this.banId = this.goal;
        this.banUntil = now2 + 5;
        this.goal = -1;
        this.roam = null;
      }
      this.lastX = h.x;
      this.lastZ = h.z;
      this.lastCheck = now2;
    }
    const nowMs = now2 * 1e3;
    const safe = nowMs < h.protectUntil - 400;
    let threat = null, tw = 0, fx = 0, fz = 0, prey = null, pv = 0;
    for (const o of sim.holes) {
      if (o === h || o.state !== 0) continue;
      const dx2 = h.x - o.x, dz2 = h.z - o.z, d = Math.hypot(dx2, dz2) || 0.01;
      if (o.r >= r * D.ratio * 0.97) {
        if (safe || nowMs < o.protectUntil - 1e3) continue;
        const gap = d - o.r * D.reach;
        const closing = Math.max(0, (o.vx * dx2 + o.vz * dz2) / d);
        const zone = 8 + o.r * (0.7 + 0.5 * this.skill) + closing * (1 + this.skill);
        if (gap < zone) {
          const w = 1 - gap / zone + 0.2;
          fx += dx2 / d * w;
          fz += dz2 / d * w;
          if (w > tw) {
            tw = w;
            threat = o;
          }
        }
      } else if (r >= o.r * D.ratio * 1.02 && !safe && nowMs >= h.protectUntil && nowMs >= o.protectUntil - 500) {
        if (o.id === this.preyBan && now2 < this.preyBanUntil) continue;
        if (!o.bot && now2 < sim.playAt / 1e3 + (sim.cfg.botHumanGrace || 0)) continue;
        if (nowMs < o.fxUntil.shield) continue;
        if (o.mass < h.mass * B.preyMinFrac) continue;
        const gap = d - r * D.reach;
        if (gap > Math.max(18, r * B.huntRange) * (0.5 + this.aggr * 0.7)) continue;
        const catchT = Math.max(0, gap) / Math.max(1.5, speedOf(r) * h.speedMul - 0.75 * speedOf(o.r)) + 0.5;
        const v = (o.mass * D.gain + 3) / catchT;
        if (v > this.rate * (B.huntGreed - this.aggr) && v > pv) {
          pv = v;
          prey = o;
        }
      }
    }
    if (threat) {
      if (this.threatSince < 0) this.threatSince = now2;
    } else this.threatSince = -1;
    let tx, tz;
    if (threat && now2 - this.threatSince >= this.react) {
      const m = 160;
      if (h.x - b.minX < m) fx += (1 - (h.x - b.minX) / m) * 1.2;
      if (b.maxX - h.x < m) fx -= (1 - (b.maxX - h.x) / m) * 1.2;
      if (h.z - b.minZ < m) fz += (1 - (h.z - b.minZ) / m) * 1.2;
      if (b.maxZ - h.z < m) fz -= (1 - (b.maxZ - h.z) / m) * 1.2;
      const l = Math.hypot(fx, fz) || 1;
      fx /= l;
      fz /= l;
      const food = this.pickFood(sim, now2, { dx: fx, dz: fz, minDot: 0.55, range: Math.max(20, r * 4) });
      if (food >= 0) {
        tx = t.x[food];
        tz = t.z[food];
      } else {
        tx = h.x + fx * (60 + r * 2);
        tz = h.z + fz * (60 + r * 2);
      }
      this.goal = -1;
      this.roam = null;
    } else if (prey) {
      if (this.prey !== prey) {
        this.prey = prey;
        this.huntSince = now2;
      }
      if (now2 - this.huntSince > 4 + this.aggr * 5) {
        this.preyBan = prey.id;
        this.preyBanUntil = now2 + 12;
        this.prey = null;
      } else {
        tx = prey.x + prey.vx * 0.4;
        tz = prey.z + prey.vz * 0.4;
      }
    } else this.prey = null;
    if (tx === void 0 && sim.field) {
      const f = sim.field;
      let pu = null;
      if (this.puGoal >= 0 && now2 < this.puUntil) {
        const q = f.slots[this.puGoal];
        if (q && q.state === "on") pu = q;
        else {
          this.puGoal = -1;
          this.puCool = now2 + 10;
        }
      } else if (this.puGoal >= 0) {
        this.puGoal = -1;
        this.puCool = now2 + 10;
      }
      if (!pu && now2 >= this.puCool) {
        const cand = f.nearest(h.x, h.z, 40 + r * 1.5);
        if (cand && this.rng() < this.puChance) {
          this.puGoal = cand.slot;
          this.puUntil = now2 + 4 + cand.d / Math.max(4, speedOf(r) * h.speedMul) * 1.3;
          pu = cand;
        }
      }
      if (pu) {
        tx = pu.x;
        tz = pu.z;
      }
    }
    if (tx === void 0) {
      this.roamCheck(sim, now2);
      if (this.roam) {
        const rd = Math.hypot(this.roam.x - h.x, this.roam.z - h.z);
        if (rd < Math.max(45, r * 1.5) || now2 > this.roam.until) this.roam = null;
        else {
          const food = this.pickFood(sim, now2, { dx: (this.roam.x - h.x) / rd, dz: (this.roam.z - h.z) / rd, minDot: 0.6, range: Math.max(18, r * 3) });
          if (food >= 0) {
            tx = t.x[food];
            tz = t.z[food];
          } else {
            tx = this.roam.x;
            tz = this.roam.z;
          }
        }
      }
    }
    if (tx === void 0) {
      const g = this.goal;
      if (g >= 0 && now2 < this.goalUntil && !sim.eaten[g] && t.fit[g] < r * S.fitRatio && g !== this.banId) {
        tx = t.x[g];
        tz = t.z[g];
      } else {
        const f = this.pickFood(sim, now2, null);
        if (f >= 0) {
          this.goal = f;
          this.goalUntil = now2 + 0.5 + this.rng() * 0.6;
          tx = t.x[f];
          tz = t.z[f];
        } else {
          this.nextRoam = Math.min(this.nextRoam, now2 + 0.5);
          this.heading += (this.rng() - 0.5) * 0.6;
          const toC = Math.atan2((b.minZ + b.maxZ) / 2 - h.z, (b.minX + b.maxX) / 2 - h.x);
          if (Math.min(h.x - b.minX, b.maxX - h.x, h.z - b.minZ, b.maxZ - h.z) < 200) this.heading = toC + (this.rng() - 0.5) * 0.8;
          tx = h.x + Math.cos(this.heading) * (70 + r * 3);
          tz = h.z + Math.sin(this.heading) * (70 + r * 3);
        }
      }
    }
    const a = (this.rng() - 0.5) * 2 * this.noise, dx = tx - h.x, dz = tz - h.z, c = Math.cos(a), s = Math.sin(a);
    h.tx = Math.min(b.maxX, Math.max(b.minX, h.x + dx * c - dz * s));
    h.tz = Math.min(b.maxZ, Math.max(b.minZ, h.z + dx * s + dz * c));
  }
  roamCheck(sim, now2) {
    if (now2 < this.nextRoam) return;
    this.nextRoam = now2 + 2.5 + this.rng() * 1.5;
    const h = this.h, ix = sim.index, n = ix.cx * ix.cz, B = CFG.bots;
    const maxFit = h.r * S.fitRatio * 1.3;
    let bk = FIT_BUCKETS.findIndex((v) => v >= maxFit);
    if (bk < 0) bk = FIT_BUCKETS.length - 1;
    const base = bk * n;
    const block = /* @__PURE__ */ __name((ci2, cj2) => {
      let v = 0;
      for (let j = cj2 - 1; j <= cj2 + 1; j++) for (let i = ci2 - 1; i <= ci2 + 1; i++) if (i >= 0 && j >= 0 && i < ix.cx && j < ix.cz) v += sim.coarse[base + j * ix.cx + i];
      return v;
    }, "block");
    const ci = Math.floor((h.x - ix.x0) / COARSE), cj = Math.floor((h.z - ix.z0) / COARSE);
    const T0 = B.roamEatTime, speed = Math.max(4, speedOf(h.r));
    const here = block(ci, cj) / T0;
    const reach = Math.min(1400, 300 + speed * 45), cr = Math.ceil(reach / COARSE);
    let best = null, bv = here * (B.roamGain + 0.6 * (1.2 - Math.min(1.2, this.skill)));
    if (this.roam) bv = Math.max(bv, this.roam.v * 1.15);
    for (let j = cj - cr; j <= cj + cr; j++) for (let i = ci - cr; i <= ci + cr; i++) {
      if (i < 1 || j < 1 || i >= ix.cx - 1 || j >= ix.cz - 1 || i + j + this.idx & 1) continue;
      const x = ix.x0 + (i + 0.5) * COARSE, z = ix.z0 + (j + 0.5) * COARSE, d = Math.hypot(x - h.x, z - h.z);
      if (d < COARSE * 1.5 || d > reach) continue;
      const v = block(i, j) / (T0 + d / speed) * (0.85 + this.rng() * 0.3);
      if (v > bv) {
        bv = v;
        best = { x, z };
      }
    }
    if (best) this.roam = { x: best.x, z: best.z, v: bv, until: now2 + 12 + Math.hypot(best.x - h.x, best.z - h.z) / speed * 1.5 };
  }
  /** Best edible object nearby (value / distance with a cluster bonus), keeping out of the mouths of bigger holes. */
  pickFood(sim, now2, dir) {
    const h = this.h, r = h.r, t = sim.table, maxFit = r * S.fitRatio, nowMs = now2 * 1e3;
    const bigs = [];
    if (nowMs >= h.protectUntil - 400) {
      for (const o of sim.holes) if (o !== h && o.state === 0 && o.r >= r * D.ratio * 0.97) bigs.push(o);
    }
    const c = this.cands;
    c.length = 0;
    const R = dir ? dir.range : Math.max(26, r * 7) * (0.75 + 0.25 * Math.min(1.2, this.skill));
    const k = r * 1.5 + 4;
    const lmW = Math.min(1, 0.25 + Math.max(0, nowMs - sim.playAt) / 1e3 / 240);
    const val = /* @__PURE__ */ __name((id) => t.flags[id] & F_LANDMARK ? t.value[id] * lmW : t.value[id], "val");
    let n = 0;
    sim.index.query(h.x, h.z, R, sim.eaten, (id, d) => {
      if (n >= 800 || t.fit[id] >= maxFit || id === this.banId && now2 < this.banUntil) return;
      if (dir && d > 1 && ((t.x[id] - h.x) * dir.dx + (t.z[id] - h.z) * dir.dz) / d < dir.minDot) return;
      for (const o of bigs) if (Math.hypot(t.x[id] - o.x, t.z[id] - o.z) < o.r * (D.reach + 0.6) + 6) return;
      c.push(id, d, val(id) / (d + k));
      n++;
    });
    if (!n) return -1;
    const top = [];
    for (let i = 0; i < n; i++) {
      const s = c[3 * i + 2];
      if (top.length < 5) {
        top.push(i);
        top.sort((a, b) => c[3 * b + 2] - c[3 * a + 2]);
      } else if (s > c[3 * top[4] + 2]) {
        top[4] = i;
        top.sort((a, b) => c[3 * b + 2] - c[3 * a + 2]);
      }
    }
    const cr = Math.max(6, r * 2.2), cr2 = cr * cr;
    let best = -1, bs = -1;
    for (const i of top) {
      const id = c[3 * i], d = c[3 * i + 1];
      let cl = 0;
      for (let j = 0; j < n; j++) {
        const p = c[3 * j], dx = t.x[p] - t.x[id], dz = t.z[p] - t.z[id];
        if (dx * dx + dz * dz < cr2) cl += val(p);
      }
      const sc = (val(id) * 0.5 + cl * 0.5) / (d + k) * (0.92 + this.rng() * 0.16);
      if (sc > bs) {
        bs = sc;
        best = id;
      }
    }
    return best;
  }
};

// ../worker/mp/room.js
var MAX_SOCKETS = 40;
var MAX_SCORE = 1e7;
var tablePromise = null;
async function loadTable(env) {
  if (!tablePromise) {
    tablePromise = (async () => {
      const res = await env.ASSETS.fetch(new Request("https://assets.invalid/data/riga-objects.bin.gz"));
      if (!res.ok) throw new Error("riga-objects.bin.gz " + res.status);
      return parseTable(await inflateIfGzip(await res.arrayBuffer()));
    })().catch((e) => {
      tablePromise = null;
      throw e;
    });
  }
  return tablePromise;
}
__name(loadTable, "loadTable");
var send = /* @__PURE__ */ __name((ws, msg) => {
  try {
    ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  } catch {
  }
}, "send");
var MpRoom = class {
  static {
    __name(this, "MpRoom");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cfg = mpConfig(env);
    this.meta = { name: null, known: false, phase: "lobby", startsAt: null, nextPid: 0 };
    this.sim = null;
    this.timer = null;
    this.ticks = 0;
    this.lastReport = 0;
    this.limiters = /* @__PURE__ */ new WeakMap();
    this.lastRb = /* @__PURE__ */ new Map();
    ctx.blockConcurrencyWhile(async () => {
      const m = await ctx.storage.get("meta");
      if (m) this.meta = m;
    });
  }
  saveMeta() {
    return this.ctx.storage.put("meta", this.meta);
  }
  // ---- connection -----------------------------------------------------------------------------------------------
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const name = request.headers.get("x-mp-room");
    if (!validRoom(name)) return new Response("bad room", { status: 400 });
    if (this.meta.phase === "closed") return new Response("room closed", { status: 410 });
    if (!this.meta.name) {
      this.meta.name = name;
      await this.saveMeta();
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("busy", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: -1 });
    return new Response(null, { status: 101, webSocket: client });
  }
  att(ws) {
    try {
      return ws.deserializeAttachment() || { pid: -1 };
    } catch {
      return { pid: -1 };
    }
  }
  lobbyPlayers() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.pid >= 0) out.push({ ws, id: a.pid, name: a.name, slot: a.slot, token: a.token });
    }
    return out;
  }
  async webSocketMessage(ws, data) {
    if (typeof data !== "string") return;
    const now2 = Date.now();
    let lim = this.limiters.get(ws);
    if (!lim) this.limiters.set(ws, lim = new RateLimiter(this.cfg.msgRate, this.cfg.msgBurst, now2));
    if (!lim.allow(now2)) {
      if (lim.over > 300) {
        send(ws, { t: "err", code: "ratelimit" });
        try {
          ws.close(1008, "rate");
        } catch {
        }
      }
      return;
    }
    const m = parseClientMessage(data, this.cfg);
    if (!m) return;
    if (this.sim && this.meta.phase !== "lobby") {
      const pid = this.att(ws).pid;
      const hh = pid >= 0 && this.sim.byId.get(pid);
      if (hh) hh.lastMsgAt = now2;
    }
    try {
      if (m.t === "ping") {
        const hh = this.sim && this.meta.phase !== "lobby" && this.sim.byId.get(this.att(ws).pid);
        if (hh && m.r > 0) hh.rtt = hh.rtt ? hh.rtt * 0.6 + m.r * 0.4 : m.r;
        return send(ws, { t: "pong", c: m.c, s: now2 });
      }
      if (m.t === "hello") return await this.onHello(ws, m, now2);
      const a = this.att(ws);
      if (a.pid < 0) return;
      if (m.t === "bye") return this.onLeave(ws, a, true);
      if (m.t === "u") return this.onUpdate(ws, a, m, now2);
    } catch (e) {
      console.error("mp message error", e && e.message);
    }
  }
  async webSocketClose(ws, code) {
    try {
      ws.close(code >= 1e3 && code < 5e3 && ![1005, 1006, 1015].includes(code) ? code : 1e3, "closing");
    } catch {
    }
    this.onLeave(ws, this.att(ws), false);
  }
  async webSocketError(ws) {
    this.onLeave(ws, this.att(ws), false);
  }
  // ---- join -------------------------------------------------------------------------------------------------------
  async onHello(ws, m, now2) {
    const a = this.att(ws);
    if (a.pid >= 0) return;
    const name = sanitizeName(m.name);
    if (!name) return this.refuse(ws, "name");
    if (!validToken(m.token)) return this.refuse(ws, "room");
    let table;
    try {
      table = await loadTable(this.env);
    } catch (e) {
      console.error("table", e && e.message);
      return this.refuse(ws, "room");
    }
    if (m.hash !== table.hash || m.v !== PROTOCOL_VERSION) return this.refuse(ws, "version", { hash: table.hash });
    if (!await this.checkKnown()) return this.refuse(ws, "room");
    const phase = this.meta.phase;
    if (phase === "lobby" && !this.sim) {
      const players = this.lobbyPlayers();
      const dup = players.find((p) => p.token === m.token);
      if (dup) {
        ws.serializeAttachment({ pid: dup.id, name, slot: dup.slot, token: m.token });
        try {
          dup.ws.serializeAttachment({ pid: -1 });
          dup.ws.close(4001, "replaced");
        } catch {
        }
      } else {
        if (players.length >= this.cfg.maxHumans) return this.refuse(ws, "full");
        const used = new Set(players.map((p) => p.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        ws.serializeAttachment({ pid: this.meta.nextPid++, name, slot, token: m.token });
      }
      await this.lobbyChanged(now2);
      return;
    }
    if (this.sim && (phase === "intro" || phase === "playing" || phase === "ended")) {
      const h = this.sim.holes.find((x) => !x.bot && x.token === m.token);
      if (!h) {
        const gone = this.sim.left.find((x) => x.token === m.token);
        if (gone && phase === "ended") {
          ws.serializeAttachment({ pid: -1 });
          send(ws, { t: "left", you: gone.id, ended: true });
          send(ws, this.endMsg(this.savedOk === true));
          return;
        }
        if (gone) return this.refuse(ws, "left");
        return this.refuse(ws, phase === "ended" ? "room" : "started");
      }
      for (const o of this.ctx.getWebSockets()) {
        const oa = this.att(o);
        if (oa.pid === h.id && o !== ws) {
          try {
            o.serializeAttachment({ pid: -1 });
            o.close(4001, "replaced");
          } catch {
          }
        }
      }
      ws.serializeAttachment({ pid: h.id, name: h.name, slot: h.slot, token: m.token });
      h.connected = true;
      h.discAt = 0;
      h.lastMsgAt = now2;
      send(ws, this.resumeMsg(h, now2));
      if (phase === "ended") send(ws, this.endMsg(this.savedOk === true));
      return;
    }
    return this.refuse(ws, phase === "lobby" ? "gone" : "room");
  }
  refuse(ws, code, extra) {
    send(ws, { t: "err", code, ...extra });
    try {
      ws.close(4e3, code);
    } catch {
    }
  }
  async checkKnown() {
    if (this.meta.known) return true;
    try {
      const r = await this.mm("/known?room=" + this.meta.name);
      const j = await r.json();
      if (!j.known) return false;
    } catch {
      return false;
    }
    this.meta.known = true;
    await this.saveMeta();
    return true;
  }
  mm(path, body) {
    const stub = this.env.MP_MATCHMAKER.get(this.env.MP_MATCHMAKER.idFromName("mm"));
    return stub.fetch("https://mm.invalid" + path, body ? { method: "POST", body: JSON.stringify(body) } : void 0);
  }
  report(now2, phase = this.meta.phase) {
    const sim = this.sim;
    const body = { room: this.meta.name, phase, humans: sim ? sim.humans().length : this.lobbyPlayers().length, startsAt: this.meta.startsAt, endAt: sim ? sim.endAt : null };
    if (sim && (phase === "playing" || phase === "intro")) body.top = sim.ranking().slice(0, 5).map((r) => ({ n: r.name, s: r.score, b: r.bot }));
    this.ctx.waitUntil(this.mm("/report", body).catch(() => {
    }));
  }
  // ---- lobby ------------------------------------------------------------------------------------------------------------
  lobbyMsg(now2, ws) {
    const players = this.lobbyPlayers();
    const me = ws ? this.att(ws).pid : -1;
    return { t: "lobby", room: this.meta.name, you: me, players: players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })), startsAt: this.meta.startsAt, max: this.cfg.maxHumans, s: now2 };
  }
  async lobbyChanged(now2) {
    const players = this.lobbyPlayers();
    const n = players.length;
    if (n === 0) {
      this.meta.startsAt = null;
      await this.ctx.storage.deleteAlarm();
    } else if (n >= this.cfg.maxHumans) {
      this.meta.startsAt = now2 + 300;
      await this.ctx.storage.setAlarm(this.meta.startsAt);
    } else if (this.meta.startsAt == null) {
      this.meta.startsAt = now2 + this.cfg.lobbySeconds * 1e3;
      await this.ctx.storage.setAlarm(this.meta.startsAt);
    }
    await this.saveMeta();
    for (const p of players) send(p.ws, this.lobbyMsg(now2, p.ws));
    this.report(now2);
  }
  onLeave(ws, a, explicit) {
    try {
      if (explicit) ws.close(1e3, "bye");
    } catch {
    }
    if (a.pid < 0) return;
    ws.serializeAttachment({ pid: -1 });
    const now2 = Date.now();
    if (this.sim && this.meta.phase !== "lobby") {
      const h = this.sim.byId.get(a.pid);
      if (h && !h.bot) {
        h.connected = false;
        h.discAt = now2;
      }
      if (this.meta.phase === "ended" && this.ctx.getWebSockets().filter((w) => this.att(w).pid >= 0).length === 0) this.ctx.storage.setAlarm(now2 + (explicit ? 2e3 : 2e4));
      return;
    }
    this.ctx.waitUntil(this.lobbyChanged(now2));
  }
  // ---- round ------------------------------------------------------------------------------------------------------------
  async alarm() {
    const now2 = Date.now();
    try {
      if (this.meta.phase === "lobby" && !this.sim) {
        if (this.lobbyPlayers().length > 0) await this.startRound(now2);
      } else if (this.meta.phase === "intro" || this.meta.phase === "playing") {
        if (this.sim) this.tick();
        if (this.sim && this.sim.phase === "ended") return;
        if (this.sim) await this.ctx.storage.setAlarm(this.sim.endAt + 1e3);
      } else if (this.meta.phase === "ended") {
        await this.cleanup();
      }
    } catch (e) {
      console.error("alarm error", e && e.message);
    }
  }
  async startRound(now2) {
    const table = await loadTable(this.env);
    const players = this.lobbyPlayers();
    const sim = new RoomSim(table, this.cfg, Math.random() * 2 ** 31 | 0);
    for (const p of players) sim.addHuman(p.name, p.token, p.id, p.slot);
    sim.start(now2, this.cfg.introMs, this.cfg.roundSeconds * 1e3);
    this.sim = sim;
    this.meta.phase = "intro";
    await this.saveMeta();
    await this.ctx.storage.setAlarm(sim.endAt + 1e3);
    for (const p of players) send(p.ws, this.startMsg(sim.byId.get(p.id), now2));
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1e3 / this.cfg.simHz);
    this.report(now2, "intro");
    this.lastReport = now2;
  }
  startMsg(h, now2, type = "start") {
    const s = this.sim;
    return {
      t: type,
      room: this.meta.name,
      you: h.id,
      serverTime: now2,
      startAt: s.startAt,
      playAt: s.playAt,
      endAt: s.endAt,
      hash: s.table.hash,
      holes: s.holes.map((o) => ({ id: o.id, name: o.name, slot: o.slot, bot: o.bot, x: round12(o.x), z: round12(o.z) })),
      pu: s.puList()
    };
  }
  resumeMsg(h, now2) {
    const m = this.startMsg(h, now2, "resume");
    m.eaten = this.sim.eatenList;
    m.me = { x: round12(h.x), z: round12(h.z), score: Math.round(h.score), mass: Math.round(h.mass * 10) / 10, state: h.state, fx: fxRemain(h, now2), combo: Math.round(h.combo.count), best: Math.round(h.combo.best) };
    m.snap = this.sim.snapshot(now2);
    return m;
  }
  tick() {
    const sim = this.sim;
    if (!sim) return;
    const now2 = Date.now();
    if (sim.phase === "intro" || sim.phase === "playing") {
      if (this.meta.phase === "intro" && sim.phase === "playing") {
        this.meta.phase = "playing";
        this.saveMeta();
        this.report(now2, "playing");
      }
      sim.tick(now2);
    }
    if (sim.phase === "playing") {
      this.ticks++;
      if (this.ticks % this.cfg.snapEvery === 0) {
        const text = JSON.stringify(sim.snapshot(now2));
        for (const ws of this.ctx.getWebSockets()) send(ws, text);
      }
      if (now2 - this.lastReport > 2e3) {
        this.lastReport = now2;
        this.report(now2);
      }
      if (sim.humans().length === 0) this.cleanup().catch(() => {
      });
    } else if (sim.phase === "ended" && this.meta.phase !== "ended") {
      this.endRound(now2).catch((e) => console.error("endRound", e && e.message));
    }
  }
  endMsg(saved = false) {
    return { t: "end", saved, rank: this.finalRank };
  }
  async endRound(now2) {
    const sim = this.sim;
    this.meta.phase = "ended";
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const text = JSON.stringify(sim.snapshot(now2));
    this.finalRank = sim.ranking();
    const endText = JSON.stringify(this.endMsg(false));
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, text);
      send(ws, endText);
    }
    await this.saveMeta();
    await this.ctx.storage.setAlarm(now2 + this.cfg.resultsSeconds * 1e3);
    this.report(now2, "ended");
    const ok = await this.saveScores(now2).catch((e) => {
      console.error("scores", e && e.message);
      return false;
    });
    this.savedOk = ok;
    const saved = JSON.stringify({ t: "saved", ok });
    for (const ws of this.ctx.getWebSockets()) send(ws, saved);
  }
  /** The SERVER writes the result of every human that finished the round (mode 'online'); clients never submit these. */
  async saveScores(now2) {
    const db = this.env.DB;
    if (!db) return false;
    const t = Math.floor(now2 / 1e3);
    const humans = new Set(this.sim.humans().map((h) => h.id));
    let ok = true;
    for (const r of this.finalRank) {
      if (!humans.has(r.id)) continue;
      const score = Math.min(MAX_SCORE, Math.max(0, r.score));
      try {
        await insertScore(this.env, { mode: "online", name: r.name, score, eaten: r.eaten, radius: r.radius, rank: r.rank, kills: r.kills, deaths: r.deaths, roundId: this.meta.name, createdAt: t, rules: RULES_VERSION });
      } catch (e) {
        ok = false;
        console.error("score insert", e && e.message);
      }
    }
    return ok;
  }
  onUpdate(ws, a, m, now2) {
    const sim = this.sim;
    if (!sim && this.meta.phase !== "lobby") {
      send(ws, { t: "err", code: "gone" });
      try {
        ws.close(4e3, "gone");
      } catch {
      }
      return;
    }
    if (!sim || sim.phase !== "playing") return;
    const h = sim.byId.get(a.pid);
    if (!h || h.bot) return;
    if (m.x !== null) {
      const rb = sim.handlePos(h, m.x, m.z, now2);
      if (rb && now2 - (this.lastRb.get(h.id) || 0) > 250) {
        this.lastRb.set(h.id, now2);
        send(ws, { t: "rb", x: rb.x, z: rb.z });
      }
    }
    if (m.c.length || m.m.length || m.p.length) {
      const pb = m.p.length ? sim.handlePickups(h, m.p, now2) : [];
      const res = m.c.length || m.m.length ? sim.handleClaims(h, m.c, m.m, now2, m.ct) : { bad: [] };
      const c = h.combo;
      send(ws, { t: "a", q: m.q, s: Math.round(h.score), m: Math.round(h.mass * 10) / 10, c: Math.round(c.count), cm: c.mult, fx: fxRemain(h, now2), b: res.bad, pb });
    }
  }
  async cleanup() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const now2 = Date.now();
    if (this.meta.name) await this.mm("/report", { room: this.meta.name, phase: "closed", humans: 0 }).catch(() => {
    });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.serializeAttachment({ pid: -1 });
        ws.close(1e3, "room closed");
      } catch {
      }
    }
    this.sim = null;
    this.meta = { name: this.meta.name, known: false, phase: "closed", startsAt: null, nextPid: 0 };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
};
var round12 = /* @__PURE__ */ __name((v) => Math.round(v * 10) / 10, "round1");

// ../worker/mp/matchmaker.js
var json2 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }), "json");
var LOBBY_STALE_MS = 12e4;
var RUN_STALE_MS = 2e4;
function randomName() {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += MP.names[b % MP.names.length];
  return s;
}
__name(randomName, "randomName");
var MpMatchmaker = class {
  static {
    __name(this, "MpMatchmaker");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cfg = mpConfig(env);
    this.rooms = /* @__PURE__ */ new Map();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get("rooms");
      if (saved) for (const [k, v] of Object.entries(saved)) this.rooms.set(k, v);
    });
  }
  persist() {
    return this.ctx.storage.put("rooms", Object.fromEntries(this.rooms));
  }
  prune(now2) {
    for (const [k, r] of this.rooms) {
      const age = now2 - r.upd;
      if (r.phase === "closed" || r.phase === "lobby" && age > LOBBY_STALE_MS || r.phase !== "lobby" && age > RUN_STALE_MS + (r.phase === "ended" ? 9e4 : 0)) this.rooms.delete(k);
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const now2 = Date.now();
    this.prune(now2);
    if (url.pathname === "/assign") {
      const bad = url.searchParams.get("bad");
      if (bad && validRoom(bad)) this.rooms.delete(bad);
      return this.assign(now2);
    }
    if (url.pathname === "/report" && request.method === "POST") return this.report(await request.json().catch(() => null), now2);
    if (url.pathname === "/known") return json2({ known: this.rooms.has(url.searchParams.get("room") || "") });
    if (url.pathname === "/status") return this.status(now2);
    return json2({ error: "not found" }, 404);
  }
  assign(now2) {
    let pick = null;
    for (const [name, r] of this.rooms) {
      if (r.phase === "lobby" && r.humans < this.cfg.maxHumans && (!pick || r.created < pick[1].created)) pick = [name, r];
    }
    let created = false;
    if (!pick) {
      const name = randomName();
      const r = { phase: "lobby", humans: 0, startsAt: null, endAt: null, top: null, upd: now2, created: now2 };
      this.rooms.set(name, r);
      pick = [name, r];
      created = true;
    }
    pick[1].humans++;
    pick[1].upd = Math.max(pick[1].upd, now2);
    if (created) this.ctx.waitUntil(this.persist());
    return json2({ room: pick[0], max: this.cfg.maxHumans });
  }
  report(b, now2) {
    if (!b || !validRoom(b.room)) return json2({ error: "bad report" }, 400);
    const phase = ["lobby", "intro", "playing", "ended", "closed"].includes(b.phase) ? b.phase : "lobby";
    const prev = this.rooms.get(b.room);
    const r = prev || { created: now2 };
    r.phase = phase;
    r.humans = Math.max(0, Math.min(16, b.humans | 0));
    r.startsAt = Number.isFinite(b.startsAt) ? b.startsAt : null;
    r.endAt = Number.isFinite(b.endAt) ? b.endAt : null;
    r.top = Array.isArray(b.top) ? b.top.slice(0, 5).map((x) => ({ n: String(x.n).slice(0, 16), s: x.s | 0, b: x.b ? 1 : 0 })) : null;
    r.upd = now2;
    this.rooms.set(b.room, r);
    if (!prev || prev.phase !== phase) this.ctx.waitUntil(this.persist());
    return json2({ ok: true });
  }
  status(now2) {
    let open = null;
    const running = [];
    for (const [, r] of this.rooms) {
      if (r.phase === "lobby" && r.humans < this.cfg.maxHumans && (!open || r.created < open.created)) open = r;
      else if (r.phase === "intro" || r.phase === "playing") running.push({ timeLeft: r.endAt ? Math.max(0, Math.round((r.endAt - now2) / 1e3)) : null, top: r.top || [], humans: r.humans });
    }
    return json2({
      v: 1,
      serverTime: now2,
      max: this.cfg.maxHumans,
      open: open ? { humans: open.humans, startsIn: open.startsAt ? Math.max(0, Math.round((open.startsAt - now2) / 1e3)) : null } : null,
      running
    });
  }
};

// ../worker/mp/index.js
var json3 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }), "json");
function sameOrigin2(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
__name(sameOrigin2, "sameOrigin");
var mmStub = /* @__PURE__ */ __name((env) => env.MP_MATCHMAKER.get(env.MP_MATCHMAKER.idFromName("mm")), "mmStub");
async function handleMp(request, env, url) {
  if (!env.MP_ROOM || !env.MP_MATCHMAKER) return json3({ error: "multiplayer not configured" }, 503);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path === "/api/mp/join" && request.method === "POST") {
      if (!sameOrigin2(request)) return json3({ error: "cross-origin" }, 403);
      const bad = url.searchParams.get("bad") || "";
      const r = await mmStub(env).fetch("https://mm.invalid/assign" + (validRoom(bad) ? "?bad=" + bad : ""));
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (path === "/api/mp/status" && request.method === "GET") {
      const r = await mmStub(env).fetch("https://mm.invalid/status");
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (path === "/api/mp/info" && request.method === "GET") {
      const t = await loadTable(env);
      return json3({ v: PROTOCOL_VERSION, hash: t.hash, objects: t.n });
    }
    if (path === "/api/mp/ws" && request.method === "GET") {
      if (request.headers.get("Upgrade") !== "websocket") return json3({ error: "expected websocket" }, 426);
      if (!sameOrigin2(request)) return json3({ error: "cross-origin" }, 403);
      const room = url.searchParams.get("room");
      if (!validRoom(room)) return json3({ error: "bad room" }, 400);
      const stub = env.MP_ROOM.get(env.MP_ROOM.idFromName(room));
      const headers = new Headers(request.headers);
      headers.set("x-mp-room", room);
      return stub.fetch(new Request(request, { headers }));
    }
  } catch (e) {
    console.error("mp route error", e && e.message);
    return json3({ error: "multiplayer unavailable" }, 503);
  }
  return json3({ error: "not found" }, 404);
}
__name(handleMp, "handleMp");

// ../worker/index.js
var MIN_AGE_FRACTION = 0.9;
var MAX_EXTRA_AGE_S = 600;
var MAX_SCORE2 = 1e7;
var MAX_RADIUS = 5e3;
var MAX_EATEN = 1e6;
var MAX_BODY_BYTES = 12288;
var MAX_ROUNDS_PER_HOUR = 30;
var SUBMIT_CAP_PER_DAY = { classic: 60, quick: 120, daily: 5 };
var DAILY_GRACE_S = 120;
function roundSeconds(env, mode) {
  const o = Number(env.ROUND_SECONDS_OVERRIDE);
  return Number.isFinite(o) && o > 0 ? o : MODES[mode].seconds;
}
__name(roundSeconds, "roundSeconds");
var envInt = /* @__PURE__ */ __name((env, key, dflt) => {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}, "envInt");
async function createRound(request, env) {
  let body = {};
  if ((request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    const r = await readJson(request, { maxBytes: 1024 });
    if (r.error) return r.error;
    body = r.body;
  }
  const mode = body.mode === void 0 ? "classic" : body.mode;
  if (typeof mode !== "string" || !CLIENT_MODES.includes(mode)) return err(400, "mode must be classic, quick or daily");
  const map = body.map === void 0 ? DEFAULT_MAP : body.map;
  if (!isMapSlug(map)) return err(400, `map must be one of ${MAP_SLUGS.join(", ")}`);
  if (mode === "daily" && map !== DEFAULT_MAP) return err(400, "the daily challenge is only played on the centre map");
  const t = now();
  let day = null, seed;
  if (mode === "daily") {
    const today = rigaDay(t);
    day = body.day === void 0 ? today : body.day;
    if (!isDayString(day)) return err(400, "invalid day");
    const ok = day === today || day === shiftDay(today, -1) && rigaDay(t - DAILY_GRACE_S) === day;
    if (!ok) return err(409, "day mismatch", { today });
    seed = dailySeed(day);
  } else {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
  }
  const ipHash = await ipHashOf(request, t);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE ip_hash = ? AND created_at > ?").bind(ipHash, t - 3600).first();
  if (row.n >= envInt(env, "RATE_ROUNDS_PER_HOUR", MAX_ROUNDS_PER_HOUR)) return err(429, "too many rounds, try again later");
  const roundId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO rounds (id, created_at, ip_hash, used, mode, day, seed, map) VALUES (?, ?, ?, 0, ?, ?, ?, ?)").bind(roundId, t, ipHash, mode, day, seed, map).run();
  await purgeStale(env, t);
  const out = { roundId, roundSeconds: roundSeconds(env, mode), mode, map, seed };
  if (day) out.day = day;
  const site = turnstileSiteKey(env);
  if (site) out.turnstileSiteKey = site;
  return json(out, 201);
}
__name(createRound, "createRound");
async function submitScore(request, env) {
  const { body, error } = await readJson(request, { maxBytes: MAX_BODY_BYTES });
  if (error) return error;
  const name = sanitizeName(body.name);
  if (!name) return err(400, "name must be 1-16 characters");
  const score = intIn(body.score, 0, MAX_SCORE2);
  if (score === null) return err(400, "invalid score");
  const eaten = body.eaten === void 0 ? 0 : intIn(body.eaten, 0, MAX_EATEN);
  if (eaten === null) return err(400, "invalid eaten");
  const radius = body.radius === void 0 ? 0 : body.radius;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0 || radius > MAX_RADIUS) return err(400, "invalid radius");
  const rank = body.rank === void 0 || body.rank === null ? null : intIn(body.rank, 0, 1e3);
  if (body.rank !== void 0 && body.rank !== null && rank === null) return err(400, "invalid rank");
  let biggest = null;
  if (body.biggest !== void 0 && body.biggest !== null) {
    if (typeof body.biggest !== "string") return err(400, "invalid biggest");
    biggest = sanitizeLabel(body.biggest);
  }
  if (typeof body.roundId !== "string" || body.roundId.length > 64) return err(400, "invalid roundId");
  if (body.mode !== void 0 && (typeof body.mode !== "string" || !CLIENT_MODES.includes(body.mode))) return err(400, "mode not accepted from clients");
  if (body.map !== void 0 && !isMapSlug(body.map)) return err(400, "invalid map");
  if (body.difficulty !== void 0 && body.difficulty !== null && !DIFFICULTIES.includes(body.difficulty)) return err(400, "invalid difficulty");
  const t = now();
  const round = await env.DB.prepare("SELECT created_at, used, mode, day, seed, ip_hash, map FROM rounds WHERE id = ?").bind(body.roundId).first();
  if (!round) return err(403, "unknown round");
  if (round.used) return err(409, "round already submitted");
  if (body.mode !== void 0 && body.mode !== round.mode) return err(400, "mode does not match the round");
  if (body.map !== void 0 && body.map !== round.map) return err(400, "map does not match the round");
  if (!CLIENT_MODES.includes(round.mode)) return err(403, "round mode not submittable");
  const len = roundSeconds(env, round.mode);
  const age = t - round.created_at;
  if (age < len * MIN_AGE_FRACTION) return err(403, "round not finished yet");
  if (age > len + MAX_EXTRA_AGE_S) return err(403, "round expired");
  const ipHash = await ipHashOf(request, t);
  const cap = envInt(env, `CAP_${round.mode.toUpperCase()}`, SUBMIT_CAP_PER_DAY[round.mode]);
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE ip_hash = ? AND used = 1 AND mode = ? AND created_at > ?").bind(ipHash, round.mode, t - 86400).first();
  if (used.n >= cap) return err(429, "daily limit of ranked submissions reached");
  if (turnstileEnabled(env)) {
    const v = await verifyTurnstile(env, body.turnstile, request.headers.get("cf-connecting-ip"));
    if (!v.ok) {
      console.log(JSON.stringify({ ev: "turnstile_fail", codes: v.codes }));
      return err(403, "turnstile verification failed");
    }
  }
  const claim = await env.DB.prepare("UPDATE rounds SET used = 1 WHERE id = ? AND used = 0").bind(body.roundId).run();
  if (!claim.meta.changes) return err(409, "round already submitted");
  const check = validateSubmission({ mode: round.mode, map: round.map, seconds: len, age, score, eaten, radius, rank, trace: body.trace });
  console.log(JSON.stringify({ ev: "score_check", mode: round.mode, map: round.map, verdict: check.verdict, reasons: check.reasons }));
  if (check.verdict === "reject") return err(422, "score failed plausibility checks", { reasons: check.reasons });
  const tr = body.trace;
  const rules = tr && tr.v === 2 ? RULES_VERSION : 1;
  const { id, name: stored } = await insertScore(env, {
    mode: round.mode,
    map: round.map,
    day: round.day,
    name,
    score,
    eaten,
    radius,
    rank,
    biggest,
    difficulty: round.mode === "daily" ? "normal" : typeof body.difficulty === "string" ? body.difficulty : null,
    suspect: check.verdict === "suspect" ? 1 : 0,
    flags: check.reasons.join(",") || null,
    trace: JSON.stringify(tr),
    roundId: body.roundId,
    kills: tr.kills,
    deaths: tr.deaths,
    createdAt: t,
    rules
  });
  const dayStart = t - t % 86400;
  let rAll, rToday;
  const archive = rules < RULES_VERSION;
  if (round.mode === "daily") rAll = rToday = await rankOf(env, { mode: "daily", map: round.map, day: round.day, score, archive });
  else [rAll, rToday] = await Promise.all([rankOf(env, { mode: round.mode, map: round.map, score, archive }), rankOf(env, { mode: round.mode, map: round.map, score, since: dayStart, archive })]);
  await purgeStale(env, t);
  const out = { ok: true, id, name: stored, mode: round.mode, map: round.map, rankAllTime: rAll, rankToday: rToday, rules };
  if (round.day) out.day = round.day;
  return json(out, 201);
}
__name(submitScore, "submitScore");
async function getScores(url, env) {
  const mode = url.searchParams.get("mode") || "classic";
  if (!BOARD_MODES.includes(mode)) return err(400, "mode must be classic, quick, daily or online");
  const map = url.searchParams.get("map") || DEFAULT_MAP;
  if (!isMapSlug(map)) return err(400, `map must be one of ${MAP_SLUGS.join(", ")}`);
  if ((mode === "daily" || mode === "online") && map !== DEFAULT_MAP) return json({ mode, map, period: url.searchParams.get("period") || "all", scores: [] }, 200, { "cache-control": "public, max-age=15" });
  const period = url.searchParams.get("period") || "all";
  if (!["all", "week", "day"].includes(period)) return err(400, "period must be all, week or day");
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));
  const t = now();
  let day = null;
  if (mode === "daily") {
    day = url.searchParams.get("day") || rigaDay(t);
    if (!isDayString(day)) return err(400, "invalid day");
  }
  const since = period === "day" ? t - t % 86400 : period === "week" ? t - 7 * 86400 : 0;
  const archive = ["1", "true"].includes(url.searchParams.get("archive") || "");
  const scores = await listScores(env, { mode, map, day, since, limit, archive });
  const out = { mode, map, period, scores, rules: archive ? "archive" : RULES_VERSION };
  if (day) out.day = day;
  return json(out, 200, { "cache-control": "public, max-age=15" });
}
__name(getScores, "getScores");
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  if (path.startsWith("/api/mp/")) return handleMp(request, env, url);
  if (path === "/api/scores") {
    if (method === "GET") return getScores(url, env);
    if (method === "POST") return submitScore(request, env);
    return err(405, "method not allowed");
  }
  if (path === "/api/rounds") {
    if (method !== "POST") return err(405, "method not allowed");
    return createRound(request, env);
  }
  if (path === "/api/e") {
    if (method !== "POST") return err(405, "method not allowed");
    return handleEvents(request, env);
  }
  if (path === "/api/stats") {
    if (method !== "GET") return err(405, "method not allowed");
    return handleStats(request, env, url);
  }
  return err(404, "not found");
}
__name(handleApi, "handleApi");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "POST" && !sameOrigin(request)) return err(403, "cross-origin request rejected");
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      console.error("api error", e && e.message);
      return err(500, "internal error");
    }
  }
};
export {
  MpMatchmaker,
  MpRoom,
  index_default as default
};
//# sourceMappingURL=index.js.map
