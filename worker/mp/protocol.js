// Multiplayer protocol constants + input hygiene, shared by the Durable Objects and (for the constants) the browser.
// No Cloudflare / DOM imports: this file is also imported by src/net/*.
//
// Wire format: JSON text frames.
//
//  client -> server
//    {t:'hello', v, name, token, hash}            first frame (name sanitised server-side; hash = object-table hash)
//    {t:'u', q, x, z, c:[id..], m:[[id,x,z]..], p:[slot..], ct}   ~12 Hz: hole position + eat claims (static ids, mover [id, x, z] triples)
//                                                 + power-up pickup claims (slots of the pickups the hole is touching) + `ct`, the client's estimate of the SERVER
//                                                 clock (ms) when the batch was flushed: combos use it so latency / jitter cannot break a combo (clamped, see sim.js handleClaims)
//    {t:'ping', c, r}                             clock sync / RTT (r = the client's smoothed RTT in ms, only widens the combo clock allowance, capped)  ->  {t:'pong', c, s}
//    {t:'bye'}                                    leave
//   hello also carries `sk:[rim,trail,tag]` (cosmetic ids, small ints; src/skins.js). The server only range-checks them (invalid -> 0) and relays them in
//   lobby / start / resume frames: ownership cannot be verified, cosmetics are client-trusted by design and never touch scoring.
//   PRIVATE (friend) rooms, GET /api/mp/ws?priv=CODE (+ POST /api/mp/room, GET /api/mp/room?code=): same frames plus
//    {t:'cfg', len:120|300, bots:bool}  host only: round length + whether bots fill the room      {t:'go'}  host only: start the round
//    {t:'rematch'}                      at the results: everybody still connected returns to the private lobby
//    lobby frames carry priv:true, code, host (player id), cfg:{len,bots}, ranked (would this round be written to the board), wait (late arrival), running
//    {t:'wait', timeLeft, top}          a late arrival's live view of the running round     end frames carry priv:{ranked}
//
//  server -> client
//    {t:'lobby', room, you, players:[{id,name,slot}], startsAt, max, s, hash}   lobby state (startsAt = server ms or null)
//    {t:'start', ..., pu:[[slot,type,x,z]..]}   round layout: every hole's start position, startAt/playAt/endAt (server ms), `you`, the live pickups
//    {t:'s', T, h:[[id,x,z,r,score,state,fxMask]..], e:[[obj,hole]..], k:[[eater,victim,gain]..], r:[[id,x,z,score,mass]..],
//            ps:[[slot,type,x,z]..], pp:[[slot,hole,type,ms]..], px:[slot..]}   ~10 Hz snapshot. score = POINTS (ranking), r = radius (size follows the mass),
//            fxMask = bit per active effect (bit i = PU_TYPES[i]: magnet, speed, double, shield), ps = pickups spawned, pp = collected (first valid claim wins; ms = how long the effect lasts), px = expired
//    {t:'a', q, s, m, c, cm, fx:[ms x4], b:[id..], pb:[slot..]}   ack of claim batch q: authoritative points `s`, growth mass `m`, combo counter `c` + multiplier `cm`,
//                                                 remaining ms of the four effects (PU_TYPES order), rejected eat ids `b`, rejected pickup slots `pb`
//    {t:'rb', x, z}                               rubber-band: position update rejected (speed), snap back
//    {t:'sync', eaten:[id..], ...}                after a reconnect: everything eaten so far
//    {t:'end', rank:[{rank,id,name,slot,bot,score,eaten,kills,deaths,radius,bestCombo,bestMult}..], saved}   final ranking (server authoritative; score = points)
//    {t:'err', code}                              version | started | full | room | gone | ratelimit | name | left (grace period over)
//    {t:'left', you, ended}                       resume of a human that already left the arena (round over: followed by 'end')

import { cleanSkin } from '../../src/skins.js';

export const PROTOCOL_VERSION = 3;   // 2: handshake id = hash of the placement file bytes (was: hash over the client's float-built world)
                                     // 3: scoring rules 2: combos + power-ups (score = points, new `mass`; ack / snapshot / start / resume carry the new fields)

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
  removeAfterMs: 45000,      // a disconnected hole idles (edible, can be resumed with its session token: covers an iOS tab reload / app switch / short outage), then leaves the arena
                             // (it keeps its place in the final ranking with the score it had, but the result is not written to the online leaderboard)
  silentAfterMs: 10000,      // a socket that sent nothing for this long (dead network, frozen tab) counts as disconnected; the client pings every 2.5 s
  maxMsgBytes: 2048,
  msgRate: 40,               // messages per second per socket (token bucket) ...
  msgBurst: 80,              // ... with this burst
  maxClaimIds: 64,
  maxClaimMovers: 16,
  maxPickClaims: 6,
  botComboScale: 0.85,       // server bots build their combo counter a little slower (like Easy solo bots)
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
  // private (friend) rooms
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',   // 32 symbols, no I / O / 0 / 1: 6 symbols = 30 bits
  codeLen: 6,
  privMaxHumans: 12,
  privTtlMs: 15 * 60 * 1000,    // a private room lives this long after its last activity (empty lobby / end of the last round)
  privCreatePerHour: 10,        // room creations per (hashed) IP per hour
  privFailPer10Min: 12,         // failed joins / lookups per (hashed) IP per 10 minutes (codes cannot be enumerated)
  privLens: [120, 300],         // round lengths the host can choose; only the 300 s one can be ranked (the public round length)
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
    removeAfterMs: num(e.MP_REMOVE_AFTER_MS, MP.removeAfterMs, 1000, 300000),
    silentAfterMs: num(e.MP_SILENT_AFTER_MS, MP.silentAfterMs, 3000, 120000),
    privTtlMs: num(e.MP_PRIV_TTL_MS, MP.privTtlMs, 1000, 3600000),
    testDate: /^\d{4}-\d\d-\d\d$/.test(String(e.MP_TEST_DATE || '')) ? String(e.MP_TEST_DATE) : null,   // tests only: the Riga calendar day the Freedom Monument rule sees (YYYY-MM-DD)
    testCloseSpawn: e.MP_TEST_CLOSE_SPAWN === '1' || e.MP_TEST_CLOSE_SPAWN === 1,
    testPowerups: e.MP_TEST_PU === '1' || e.MP_TEST_PU === 1,                 // tests only: the first pickups appear next to the humans' starts (scripts/smoke-mp.mjs)
    testFxScale: num(e.MP_TEST_FX_SCALE, 1, 1, 10),                            // tests only: effects last this many times longer (the browser tests are slower than 6 s)
    testStartMass: num(e.MP_TEST_START_MASS, 0, 0, 100000),                    // tests only: the first human starts with this mass (a big hole for the shield test)
  };
}

// Names are sanitised server-side with worker/lib/moderation.js (the same function as the scores API).

export const validToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);
export const validRoom = (s) => typeof s === 'string' && /^[a-z0-9]{6,24}$/.test(s);
/** A private room code: 6 symbols of the unambiguous alphabet (upper case). Public room names are lower case, so the two can never be mixed up. */
export const validCode = (s) => typeof s === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(s);
export const normCode = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 6);
export function makeCode() {
  const a = new Uint8Array(MP.codeLen);
  crypto.getRandomValues(a);
  let c = '';
  for (const b of a) c += MP.codeAlphabet[b & 31];   // 32 symbols: uniform
  return c;
}

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
      return { t: 'hello', v: m.v | 0, name: m.name, token: m.token, hash: m.hash, sk: cleanSkin(m.sk) };
    case 'u': {
      const out = { t: 'u', q: Number.isInteger(m.q) ? m.q : 0, x: null, z: null, c: [], m: [], p: [], ct: isNum(m.ct) ? m.ct : null };
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
      if (m.p !== undefined) {
        if (!Array.isArray(m.p) || m.p.length > cfg.maxPickClaims) return null;
        for (const sl of m.p) { if (!Number.isInteger(sl) || sl < 0 || sl > 255) return null; out.p.push(sl); }
      }
      return out;
    }
    case 'ping': return { t: 'ping', c: isNum(m.c) ? m.c : 0, r: isNum(m.r) && m.r >= 0 ? Math.min(m.r, 5000) : 0 };
    case 'bye': return { t: 'bye' };
    case 'cfg': return { t: 'cfg', len: m.len === 120 || m.len === 300 ? m.len : 300, bots: m.bots === false || m.bots === 0 ? false : true };
    case 'go': return { t: 'go' };
    case 'rematch': return { t: 'rematch' };
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
