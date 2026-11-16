// Multiplayer protocol constants + input hygiene, shared by the Durable Objects and (for the constants) the browser.
// No Cloudflare / DOM imports: this file is also imported by src/net/*.
//
// Wire format: JSON text frames.
//
//  client -> server
//    {t:'hello', v, name, token, hash}            first frame (name sanitised server-side; hash = object-table hash)
//    {t:'u', q, x, z, c:[id..], m:[[id,x,z]..]}   ~12 Hz: hole position + eat claims (static ids, mover [id, x, z] triples)
//    {t:'ping', c}                                clock sync / RTT   ->  {t:'pong', c, s}
//    {t:'bye'}                                    leave
//
//  server -> client
//    {t:'lobby', room, you, players:[{id,name,slot}], startsAt, max, s, hash}   lobby state (startsAt = server ms or null)
//    {t:'start', ...}      round layout: every hole's start position, startAt/playAt/endAt (server ms), `you`
//    {t:'s', T, h:[[id,x,z,r,score,state]..], e:[[obj,hole]..], k:[[eater,victim,gain]..], r:[[id,x,z,score]..]}   ~10 Hz snapshot
//    {t:'a', q, s, b:[id..]}                      ack of claim batch q: authoritative score + rejected ids
//    {t:'rb', x, z}                               rubber-band: position update rejected (speed), snap back
//    {t:'sync', eaten:[id..], ...}                after a reconnect: everything eaten so far
//    {t:'end', rank:[...], saved}                 final ranking (server authoritative)
//    {t:'err', code}                              version | started | full | room | gone | ratelimit | name

export const PROTOCOL_VERSION = 2;   // 2: handshake id = hash of the placement file bytes (was: hash over the client's float-built world)

export const MP = {
  maxHumans: 12,
  totalHoles: 8,             // humans + bots (bots fill up to this)
  botSkill: 0.38,            // server-bot difficulty: 1 = the full solo-bot strength, lower = slower / clumsier (each bot gets +-22 % spread). Tuned with scripts/mp-bot-bench.mjs
                             // so that a casual human (~25-30k points on their own) finishes in the top 3 of 8 (see README 6.2 for the bench numbers)
  botHumanGrace: 60,         // seconds from the round start in which server bots do not hunt humans (they still eat and flee)
  lobbySeconds: 20,          // countdown starts when the first player arrives
  roundSeconds: 300,
  introMs: 3700,             // whole-city fly-in (CFG.intro.hold + glide), the round clock starts after it
  resultsSeconds: 60,        // room lives this long after the round ends, then closes
  simHz: 20,
  snapEvery: 2,              // snapshot every N sim ticks  => 10 Hz
  removeAfterMs: 15000,      // a disconnected hole idles (and can be resumed with its session token), then is removed
  maxMsgBytes: 2048,
  msgRate: 40,               // messages per second per socket (token bucket) ...
  msgBurst: 80,              // ... with this burst
  maxClaimIds: 64,
  maxClaimMovers: 16,
  // validation tolerances
  speedTol: 1.3,             // allowed speed = formula * this
  burstSeconds: 1.5,         // distance budget may accumulate this many seconds of speed
  posSlack: 3,               // metres of slack on top
  reachSlackSeconds: 0.4,    // claim reach slack = vmax * this + 1.5 m  (client is ahead of the server by ~RTT)
  claimRate: 150,            // claims per second per hole (refill) ...
  claimBurst: 300,
  moverPointsRate: 80,       // value of mover claims per second per hole
  moverPointsBurst: 200,
  names: 'abcdefghjkmnpqrstuvwxyz23456789',
};

/** Test overrides come from wrangler `--var` values only (never from wrangler.jsonc). */
export function mpConfig(env) {
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const e = env || {};
  return {
    ...MP,
    roundSeconds: num(e.MP_ROUND_SECONDS, MP.roundSeconds, 5, 3600),
    lobbySeconds: num(e.MP_LOBBY_SECONDS, MP.lobbySeconds, 0, 300),
    resultsSeconds: num(e.MP_RESULTS_SECONDS, MP.resultsSeconds, 2, 600),
    maxHumans: num(e.MP_MAX_HUMANS, MP.maxHumans, 1, 12),
    botSkill: num(e.MP_BOT_SKILL, MP.botSkill, 0.2, 1),
    botHumanGrace: num(e.MP_BOT_GRACE, MP.botHumanGrace, 0, 300),
    testCloseSpawn: e.MP_TEST_CLOSE_SPAWN === '1' || e.MP_TEST_CLOSE_SPAWN === 1,
  };
}

// Names are sanitised server-side with worker/lib/moderation.js (the same function as the scores API).

export const validToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
export const validRoom = (s) => typeof s === 'string' && /^[a-z0-9]{6,24}$/.test(s);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Parse + shape-check one client frame. Returns null for anything malformed (silently ignored by the caller). */
export function parseClientMessage(text, cfg = MP) {
  if (typeof text !== 'string' || text.length > cfg.maxMsgBytes) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hello':
      if (typeof m.hash !== 'string' || m.hash.length > 16) return null;
      return { t: 'hello', v: m.v | 0, name: m.name, token: m.token, hash: m.hash };
    case 'u': {
      const out = { t: 'u', q: Number.isInteger(m.q) ? m.q : 0, x: null, z: null, c: [], m: [] };
      if (m.x !== undefined || m.z !== undefined) {
        if (!isNum(m.x) || !isNum(m.z) || Math.abs(m.x) > 1e5 || Math.abs(m.z) > 1e5) return null;
        out.x = m.x; out.z = m.z;
      }
      if (m.c !== undefined) {
        if (!Array.isArray(m.c) || m.c.length > cfg.maxClaimIds) return null;
        for (const id of m.c) { if (!Number.isInteger(id) || id < 0) return null; out.c.push(id); }
      }
      if (m.m !== undefined) {
        if (!Array.isArray(m.m) || m.m.length > cfg.maxClaimMovers) return null;
        for (const e of m.m) {
          if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || e[0] < 0 || !isNum(e[1]) || !isNum(e[2])) return null;
          out.m.push(e);
        }
      }
      return out;
    }
    case 'ping': return { t: 'ping', c: isNum(m.c) ? m.c : 0 };
    case 'bye': return { t: 'bye' };
    default: return null;
  }
}

/** Token bucket (per socket). allow() = true if the message may be processed. */
export class RateLimiter {
  constructor(rate, burst, now = Date.now()) { this.rate = rate; this.burst = burst; this.tokens = burst; this.last = now; this.over = 0; }
  allow(now = Date.now()) {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    this.over++;
    return false;
  }
}
