# BEDRE — Rīga

An original 3D browser arcade game: steer a hole around a real 3D map of central Riga, swallow things smaller
than you, grow, and swallow bigger things. 5-minute rounds with 7 AI opponents. ("bedre" = pit in Latvian.)

Vite + vanilla JS ES modules + three.js. No physics engine, no framework.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run smoke      # headless Playwright test + screenshots in scripts/out/ (GPU=1 npm run smoke for real GPU)
```

All tests (GPU=1 uses the real GPU through Metal/ANGLE; omit for SwiftShader):
```
PORT=5181 GPU=1 npm run smoke [-- --sample]     # gameplay, bots, results, balance
PORT=5182 GPU=1 npm run smoke:world [-- --sample]  # traffic, audio, particles, landmarks, perf
npm run smoke:api                                # worker API only (local wrangler dev, :8791)
GPU=1 npm run smoke:e2e                          # built game served by the worker (:8792): round length from server, submit, Top scores, replay, unranked rules
GPU=1 node scripts/smoke-mp.mjs                  # multiplayer end-to-end (own wrangler dev :8793, build dir scripts/.dist-mp); `npm run test:mp` = plain-Node validator/CPU tests
PORT=5185 GPU=1 node scripts/final-shots.mjs     # UI screenshots (scripts/out/final-*.png), pause/resize/touch/leak checks
```
Ports 5173 (dev), 5199 (play server), 8791 (`dev:worker`) are left alone by the tests.

URL params: `?autostart=1` skip start screen, `?time=30` round length in seconds (local only: the round becomes *unranked*; with the worker the server's `roundSeconds` is the round length), `?sample=1` force the procedural city, `?bots=0` (or `?bots=N`, max 15) number of opponents, `?intro=0` skip the round-start fly-in, `?introhold=S` linger S seconds on the overview (testing).
Map data is fetched from `/data/riga.json` (see schema below); on failure the procedural `src/sampleCity.js` is used. `/data/riga-shapes.bin.gz` (measured heights + simplified building shapes, see "Building shapes") is fetched in parallel and is optional: without it every building is a flat extrusion of its `riga.json` height.
`?quality=low|medium|high` pins the quality tier (`low`: non-notable shaped buildings fall back to flat boxes, fewer movers, no shadows).

## Architecture (src/)

| file | role |
| --- | --- |
| `main.js` | bootstrap: loading screen with progress, WebGL check/fallback message, renderer, load data, build world + game, rAF loop, pause (Esc / button / hidden tab), resize/orientation, mobile gesture guards |
| `i18n.js` | tiny LV/EN i18n (`t()`, `kindName()`, `data-i18n*` attributes in `index.html`); LV default when `navigator.language` starts with `lv`, toggle on the start screen, remembered in `localStorage bedre.lang`. Every swallowable kind has an LV + EN name there |
| `scores.js` / `scoresUi.js` | API client (never throws) / Top scores panel (Today, This week, All time; names via `textContent`) + About popover |
| `config.js` | **all tunables** (round length, growth curve, speeds, camera, prop counts, colours) |
| `data.js` / `sampleCity.js` | load `riga.json` with fallback; procedural city in the same schema |
| `world.js` | assembles ground + buildings + props; registry of swallowable objects (`world.objects`), uniform spatial grid (`query`), fall/wobble animation, `reset()`, `findSpawn()` |
| `ground.js` | paints the map into rectangular canvas tiles (`groundLayout`: <= 4096 px, `CFG.ground.pxPerM` = 2.8 px/m, 3 x 2 tiles for the 3300 x 2700 m map): class raster base (or OSM land cover without it), water with islands, pavements + kerb + carriageways, paths / rail / tram, bridge decks, footprints; + a repainted close-up `DetailLayer` (sharp texture around the player, adds lane markings and zebra crossings). See "Ground surfaces and the bigger map (iteration 5)" |
| `holeView.js` | ground-shader patch (`discard` inside holes, owner-coloured rim, AO), shaft meshes, `holeUniforms` (up to 16 holes) |
| `buildings.js` | footprint -> walls + mansard/flat roof geometry **or** measured shape (`shapes.js`) -> roof triangles coloured by slope/type + walls extruded from outline loops (vertex colours, procedural window shader), one `THREE.BatchedMesh` with a flat-box variant per relief building for `low` quality, fit radius / value |
| `shapes.js` | loads `riga-shapes.bin.gz` (gzip via `DecompressionStream`, byte-plane decoding); resolves `null` on any failure |
| `propModels.js`, `scatter.js` | tiny procedural prop models; deterministic placement along roads / parks / open space (never in buildings or water) |
| `holes.js` | `Hole` entity (owner name/colour, control, radius smoothing, score) and `updateSwallow()` |
| `input.js`, `camera.js`, `lighting.js` | pointer/touch-joystick/WASD; follow camera (pulls back with radius); sky/fog/sun + shadow frustum that follows the camera |
| `game.js` | state machine (menu/playing/ended), round timer, HUD sync, popups, dev hooks |
| `hud.js`, `style.css`, `index.html` | HTML/CSS overlay: timer, score, size bar, leaderboard, name tags, kill feed, swallowed overlay, overview markers, popups, start (name field) + results (ranking table) panels |
| `bots.js` | 7 AI holes: `Brain` per bot (target scoring by value/distance + cluster bonus, flee from bigger holes after a reaction delay, hunt clearly smaller ones, roam to richer districts when the local area is poor, stuck detection, per-bot speed/aggression/reaction/aim-noise). Brains tick at `bots.thinkHz` (6 Hz), staggered. They only set `hole.control`, so movement + swallowing are identical to the player |
| `spawn.js` | `SpawnPicker`: candidate points on vehicle streets (free of buildings/water). Player: near the centre, many small props nearby, away from bots. Bots / respawns: best-of-sample maximising distance to other holes |
| `minimap.js` | canvas minimap: city pre-rendered once (water, parks, building mass, roads), live dots sized by radius, player ringed, leader crowned, camera-frustum footprint |

Coordinates: metres, x = east, z = south (north = -z), y up. Buildings are `BatchedMesh` instances whose origin is the
footprint centroid at ground level, so each can tilt/sink/hide individually.

### Swallow rule
Each object has a centre `(x,z)`, a fit radius and a point value. It falls when
`dist(centre, hole) < radius * swallow.reach` **and** `fit < radius * swallow.fitRatio`.
Building fit = `0.5 * (longer side of min-area box / 2) + 0.5 * sqrt(area/pi)`; building value = `area * mean height / value.buildingDiv` (mean height = measured volume / footprint area for shaped buildings, else the flat-extrusion height).
Prop fits/values live in `propModels.js` / `config.value`. Lookup is a 24 m grid; only falling/wobbling objects are updated per frame.

### Growth
`radius = startRadius * (1 + score / growth.k) ^ growth.exp` (smoothed), currently k=16, exp=0.44. `levels` are radius thresholds for the HUD size bar.
Tune with `GPU=1 node scripts/smoke.mjs --curve` (greedy autoplayer, no bots, prints radius every 30 s). Pace for the 300 s round: ~r 7 at 30 s (props), ~r 10-16 at 60-90 s (small buildings), ~r 40 at 150 s, ~r 60-75 at 180-210 s (big blocks), ~120 m at 300 s for the *perfect* greedy player. `--botsim` prints a 300 s bots-only round (3 runs).

### Round flow
`start()` -> phase `intro`: camera is zoomed out so the whole 2.4 km map is visible, every hole is marked (player ring pulses in his colour + name tags), hold `intro.hold` (1.2 s), ease down `intro.glide` (2.5 s) onto the player, then phase `playing` ("Aiziet!"): only now do the timer and the bots start. Any click/key after 0.35 s skips it. Last `roundWarn` (10) seconds the timer pulses.

### Camera
Follow camera (`camera.js`) is north-up, distance `(distBase + distPerRadius * r) * zoom` (7 + 17r: roughly 2x the visible ground of the first MVP, widening more as the hole grows), with a smoothed look-ahead along the movement direction. Mouse wheel / two-finger pinch change `zoom` (clamped `zoomMin..zoomMax` = 0.6..2.6, remembered in `sessionStorage`). Fog, far plane and the shadow frustum scale with camera distance (`lighting.js` shadow half-extent capped at 1700 m).

### Opponents (`CFG.bots`, `CFG.duel`)
- `bots`: `count`, `difficulty` (global skill, scales speed + decision quality), `thinkHz`, `speedMin/Max`, `reactMin/Max`, `aimNoise`, `aggressionMin/Max`, `spawnMinDist`.
- `duel`: a hole swallows another when `radius >= victim * ratio (1.15)` and the victim's centre is within `eater.radius * reach (0.62)`. Eater gets `gain` (50%) of the victim's score. Victim spirals/shrinks for `dyingTime`, respawns after `respawnDelay` (3 s) at a safe spot with `keepScore` (40%) of its score and `protect` (3 s, blinking rim, cannot eat or be eaten as a hole). When the human is swallowed the camera follows the eater and a "Swallowed by X" overlay counts down.
- Everything is set per owner in the ground shader (`uHoles` / `uHoleCol`, max 16 holes), so rim colours are per hole; protection blinks the rim white.
- Game events are emitted on `events.js` bus: `holeEaten`, `playerEaten`, `respawn`, `introStart`, `roundGo`.

### Multiple holes
`game.holes` is `[player, ...bots]`; shader/shaft views and `updateSwallow` iterate over all of them.

## Dev/test hooks (`window.__game`)
`state {phase, score, timeLeft, eaten}` (phase: `menu|intro|playing|ended`), `hole {x,z,radius,targetRadius}` (player), `counts`, `start()`, `skipIntro()`, `intro` (null or `{t,dist,overviewDist}`), `teleport(x,z)`, `setRadius(r)`, `step(seconds)` (deterministic, runs bots + duels, no render), `render()`, `autoplay(seconds)` (greedy player-bot that flees bigger holes; full game update incl. bots), `nearest(kindOrClass, minFit)`, `setTarget(x,z)`, `spawn`, `isSample`,
`holes` (list of `{index,name,x,z,radius,score,isBot,alive,dying,protectT,kills,deaths,eaten,mode}`), `leaderboard()` (`[{rank,name,score,isPlayer,alive}]`), `teleportHole(i,x,z)`, `setHoleRadius(i,r)` (force encounters for any hole index; also clears spawn protection), `botCount`, `overlay` (swallowed overlay DOM state), `cam {focus,dist}`.
`npm run smoke` builds and serves a static copy (`scripts/.dist`, so concurrent source edits cannot reload the page mid-run).

## Map data schema (`public/data/riga.json`, produced by `tools/`)
```
meta{name,origin,bounds{minX,maxX,minZ,maxZ}}, buildings[{id,p[[x,z]],h,t,n?}], roads[{p,w,k}], water[{p}], parks[{p}],
trees[[x,z]], landmarks[{n,x,z,h}]
(iteration 5, all optional) water/parks/areas rings may carry holes `h:[[[x,z]..],..]` (islands, plazas, ponds; opposite winding; NB a *building's* `h` is its height),
areas[{c,p,h?,s?}] ground cover in paint order, crossings[[x,z,angleDeg,length,marked]], roads[].{sw,s,l,br,ow,f}  (see below)
```
Landmarks are matched to the building containing them (or the nearest close one) which gets renamed + a score bonus;
unmatched landmarks become a standalone monument prop.


## World life & feel (iteration 2)

Extra modules (all tunables in `LIFE` at the end of `config.js`):

| file | role |
| --- | --- |
| `events.js` | tiny shared emitter `bus`. Emitted: `swallow(obj, hole)` (world.beginFall), `landed`, `levelUp({hole, level})`, `roundStart`, `roundEnd`, `countdown(n)`. Audio also listens for `holeEaten`, `playerEaten`, `respawn` (emit them from gameplay code any time) |
| `traffic.js` | `RoadNet` (vertex-snapped node graph per vehicle class) + `Traffic`: cars/buses/trams drive the real road polylines on the right-hand lane, turn at junctions, U-turn at dead ends; pedestrians walk footways/pavements, park strollers wander inside park polygons. Movers are normal swallowable objects (`o.m` = mover state); `world.moveObject` updates the 24 m grid cell only on cell change. They flee holes that could eat them (`panic*`) |
| `effects.js` | pooled particles (one `Points` draw call): dust, debris, sparkles, leaves; growth dust ring; camera shake (`camShake`, read by `camera.js`) |
| `audio.js` | procedural WebAudio (no assets): size-scaled pops / building whomp + debris, level-up chime, countdown ticks, round-end sting, UI click, ambient bed (noise wash, pad, distant bells), hole hum that deepens with size; voice + rate limits, compressor, mute button (`#mute-btn`, `M` key, `localStorage bedre.muted`). Unlocks on first gesture |
| `labels.js` | wraps `hud.label`: landmarks always; OSM-named buildings only if meaningful at the hole size; plain addresses only for buildings large relative to the hole; min gap + queue of 2 |
| `quality.js` | auto scaler (frame-time window, steps pixel ratio / shadow map / shadow on-off / tree shadows / mover count). `?quality=low\|medium\|high` pins a level |
| `life.js` | `initLife()` called from `main.js`; wires audio, labels, quality, level-up/countdown/round events; exposes `window.__life` for tests |

Other changes: building fall = lean towards the hole (anticipation), accelerating slide, tip, random spin, bigger buildings fall slower; too-big buildings lean toward the hole and shed dust.
`buildings.js`: spires on churches (`t:'rel'` or church-like names; verdigris/dark), conical tower roofs for `*torns`, church body kept proportional when OSM height includes the spire; neighbourhood palettes (Old Town warm/saturated, Art Nouveau centre pastel); landmarks named `*piemineklis` stay standalone props. Freedom Monument = `freedom` prop (42 m, fit 6.2, value 450). `ground.js`: bridge decks (dark outline + parapet) painted where roads/rail cross large water polygons, after all roads. Trees are chunked into 250 m InstancedMeshes so they frustum-cull.

Key tunables (`LIFE`): `movers.{cars,buses,trams,walkers,wanderers,carSpeed,turnChance,panic*}`, `fx.{maxParticles,shakeBuilding,shakeMax}`, `fall.{buildingLean,buildingSlide,spin,bigBuildingSlower}`, `audio.{master,ambient,hum,maxVoices}`, `labels.{minGap,addressFitFrac,namedFitFrac}`, `quality.{pixelRatio,shadowMap,moverFrac,downFps,upFps,window}`, `palettes`.

Test: `PORT=5182 GPU=1 npm run smoke:world [-- --sample]` (movers, audio, particles, monument, labels, perf, screenshots `scripts/out/world-*.png`).

## Backend / deploy
One Cloudflare Worker (`worker/index.js`) serves the static build (`dist/`) and a tiny high-score API under `/api/*`, backed by a D1 database (`bedre-scores`, schema in `migrations/`). Client module: `src/scores.js` (never throws; the game works without a backend).

API (same-origin only): see **Modes, anti-cheat and analytics** below (`POST /api/rounds`, `POST/GET /api/scores`, `POST /api/e`, `GET /api/stats`). Round lengths live in `MODES` (`src/rules.js`, shared with the Worker); `CFG.roundSeconds` is only the offline default.

Local: `npm run dev:worker` (build, apply local migrations, `wrangler dev` on :8791) next to `npm run dev` (Vite proxies `/api`). Test: `npm run smoke:api`.

First deploy (needs `npx wrangler login`):
```
npx wrangler d1 create bedre-scores        # copy the database_id it prints
# put that id into wrangler.jsonc -> d1_databases[0].database_id
npm run deploy                              # build + remote migrations + wrangler deploy
```

Privacy: the only user-supplied data stored is the chosen display name (plus score stats and the anti-cheat trace of the round). No cookies or accounts; analytics are anonymous daily counters (see below). For rate limiting the Worker stores a salted SHA-256 of IP + UTC date with each round row (not the IP itself; the hash is nulled after 2 days); unused round rows are purged after a day.


## Modes, anti-cheat and analytics (iteration 6)

### Game modes (`src/modes.js`, `src/daily.js`, shared rules in `src/rules.js`)
Start-screen segmented control (LV + EN), remembered in `localStorage` (`bedre.mode`, or `?mode=quick`). `Game.start()` emits `modeSetup`; `modes.js` applies the mode (round length, bot count, growth constant, daily seeds) every round.

| Mode | Rules | Board |
|---|---|---|
| **Klasika / Classic** | 5:00 vs 7 bots (default) | `classic` |
| **Ātrā / Quick** | 2:00, growth constant `k` 16 -> 6 (`MODES.quick.growthK`) so the radius arc still reaches the big buildings; tuned with the greedy autoplayer: classic 5:00 reaches r ~98 (greedy) / ~58 (0.6x-speed "human-ish"), quick 2:00 reaches ~103 / ~59 | `quick` |
| **Brīvā pastaiga / Free roam** | no timer, no bots, nothing submitted, an **End** button; for sightseeing | none |
| **Dienas izaicinājums / Daily** | one fixed setup per **Riga calendar day** (UTC+2/+3, `Intl` `Europe/Riga`): seeded player spawn, bot names + personalities, plus a daily twist from `TWISTS` in `src/daily.js` (Old Town start, Freedom Monument start, 9 bots, only 3 bots, smarter bots, 9 bots + Old Town start). Same date -> same setup on every machine; the server returns the same `seed` (`dailySeed(day)`). **One ranked attempt per browser per day** (soft: `localStorage`), later attempts are *practice* (same setup, nothing submitted); the hard limit is the server's per-IP-hash cap (5 ranked daily submissions/day) | `daily` (+ `day`) |
| online | written only by the multiplayer server (`insertScore`), clients can never submit it | `online` |

The round length always comes from the server: `POST /api/rounds {mode, day?}` -> `{roundId, roundSeconds, mode, day?, seed, turnstileSiteKey?}`. `Game.start()` sets the local default; the server's number replaces it when the timer starts. Free roam and daily practice never create a server round. Bots: `main.js` builds 9 (`BOT_CAPACITY`) and the mode activates 0-9 of them (`Bots.setActive`); `Bots.reseed(seed)` gives deterministic names/personalities. `?bots=N` (N != 7), `?time=`, `?sample=1` and debug hooks still make a round unranked.

### API (same-origin only)
- `POST /api/rounds {mode?, day?}` -> see above. `mode` in `classic|quick|daily`; `daily` needs today's Riga day (yesterday only within 2 min after Riga midnight, else `409 {today}`); `free`/`online`/anything else -> 400. 30 rounds / hour / IP-hash.
- `POST /api/scores {roundId, name, score, eaten, radius, rank, biggest, trace[, turnstile]}` -> `201 {ok, id, name, mode, day?, rankAllTime, rankToday}`. For daily both ranks are the rank on that day's board. Errors: 400 bad payload, 403 unknown/early/expired round or Turnstile failure, 409 replay, **422 failed plausibility checks** (`{reasons:[...]}`; the round token is burnt, nothing stored), 429 daily submission cap (classic 60, quick 120, daily 5 per IP-hash).
- `GET /api/scores?mode=classic|quick|daily|online&period=all|week|day[&day=YYYY-MM-DD][&limit=20]` (default mode classic; suspect rows are never listed). The Top-scores panel has the mode switch; Daily shows Today/Yesterday plus the day's twist.
- `POST /api/e` (analytics beacon), `GET /api/stats?days=30` -- see Analytics.

### Anti-cheat model (and its limits)
**This is plausibility checking and friction, not proof: the game runs in the browser, so a determined cheater can always fabricate a consistent submission or simply play with a bot.** What it stops: casual curl/console score spam, absurd scores, replays, mass submissions.
1. **Round token**: server-issued, bound to `mode`/`day`/`seed`, single use (atomic claim; also burnt by a 422), age window `0.9 x roundSeconds ... roundSeconds + 10 min`.
2. **Progress trace** (`src/trace.js`): every 10 s of *played* time (pauses excluded) the client samples score, radius, eaten and kills (<= 31 samples for 5:00) plus eaten counts by kind. `worker/lib/validate.js` checks: samples on 10 s slots and total play time = round length, monotonic eaten/kills, the final sample equals the submitted fields, kind counts sum to `eaten`, rank <= holes in the mode, radius vs score through the shared growth formula (`src/rules.js radiusAt`, the same function `src/config.js` uses), **per-interval gain ceilings by radius band**, eaten-per-interval ceiling, score <= what the eaten kinds can be worth, and a per-mode score cap.
3. **Empirical ceilings** (`worker/lib/limits.js`, generated by `node tools/gen-limits.mjs`): the greedy autoplayer and a stronger cluster-aware autoplayer play hundreds of rounds in every mode and daily twist, with and without bots (no bots = upper bound); the maxima are stored. The Worker then applies **x2 = suspect** (stored with `suspect=1` + reason codes, hidden from public boards, looks like a normal success to the client) and **x3 = reject** (HTTP 422, nothing stored). Re-run `npm run gen:limits` and commit after changing growth/values/map/buildings. Reason codes are logged (`score_check` lines in Workers observability), never personal data.
4. **False rejects**: `node tools/check-legit.mjs` plays fresh simulated rounds (all modes + twists, several strengths incl. the strongest autoplayer, with/without bots) through the validator: last run **36 fresh rounds -> 36 ok, 0 suspect, 0 rejected** (classic/quick 4 player strengths x 2 bot settings, all 6 daily twists); a control of 36 tampered submissions (consistent x4 score, lone x10 final, 1e6 score, +30000 jump, inflated eaten count, dropped samples) was 36/36 flagged or rejected. Caveat: the simulated players are autoplayers (same family as the calibration set), not humans; the x2/x3 factors are the safety margin for human play. The limits table currently comes from 56 calibration rounds (`tools/out/sim-runs-train.json`); run `node tools/gen-limits.mjs --runs 16` for a wider set.
5. **Rate limits** per salted IP-hash (hash of IP + UTC date; `rounds.ip_hash` is nulled after 2 days): rounds/hour, ranked submissions/day per mode. **Names**: trimmed, control/bidi characters stripped, `<>&"'` removed, whitespace collapsed, 1-16 chars, a small LV/EN/RU profanity list -> "Anonīms" (also for server-written online rows). The UI renders names with `textContent` only.

Still bypassable: a fabricated but consistent trace within the ceilings (score up to ~2x the best autoplayer inside a round), automation of the real client (an aimbot is indistinguishable from a good player), several IPs / VPN, slow-running the game clock (sim speed is not observable server-side), multiple browsers for extra daily attempts. Cheap extra friction is Turnstile, below.

**Cloudflare Turnstile (built, OFF).** Active only when *both* `TURNSTILE_SECRET` (secret) and `TURNSTILE_SITE_KEY` (public var) are set; then `POST /api/scores` needs a valid token (server-side `siteverify`, fails closed) and the client renders the widget (`appearance: interaction-only`) only at submit time, loading `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` lazily. To enable:
1. Cloudflare dashboard -> Turnstile -> *Add widget*: hostname `bedre.pakers.lv`, mode *Managed* (or Invisible); copy the site key and the secret.
2. `npx wrangler secret put TURNSTILE_SECRET` (paste the secret).
3. In `wrangler.jsonc` add `"vars": { "TURNSTILE_SITE_KEY": "<site key>" }`, then `npm run deploy`.
4. There is no CSP today (`public/_headers` has none). If you add one later allow `script-src` and `frame-src https://challenges.cloudflare.com`.
To disable: delete the secret (`npx wrangler secret delete TURNSTILE_SECRET`).

**Cleaning up a cheated row** (no admin UI; look at `SELECT id, name, mode, score, flags, suspect FROM scores ORDER BY score DESC LIMIT 20`):
```
npx wrangler d1 execute bedre-scores --remote --command "UPDATE scores SET suspect = 1 WHERE id = 123"   # hide from boards (reversible: = 0)
npx wrangler d1 execute bedre-scores --remote --command "DELETE FROM scores WHERE id = 123"             # delete for good
npx wrangler d1 execute bedre-scores --remote --command "SELECT id, name, score, flags FROM scores WHERE suspect = 1"   # review auto-flagged rows
```

### Multiplayer hand-off: writing 'online' scores
`worker/lib/db.js` exports `insertScore(env, row)` (the one writer of the scores table):
```js
import { insertScore } from '../lib/db.js';
await insertScore(env, { mode: 'online', name, score, eaten, radius, rank, biggest, kills, deaths });   // -> { id, name }
```
`name` is cleaned + profanity-filtered inside (unusable -> "Anonīms"), `score` must be an integer; optional `suspect`, `flags`, `trace`, `roundId`, `createdAt`. `rankOf(env, {mode, score, since?})` and `listScores(...)` are there too. Online rows are listed by `GET /api/scores?mode=online`. Report analytics from the client with `bus.emit('track', 'lobby')` (lobby join) / `'share'` (or `data-track="lobby"` on a button).

### Analytics (cookieless, `src/analytics.js`, `worker/lib/analytics.js`, `/stats.html`)
Nothing personal: no cookies, no third-party scripts, no identifiers, no IP storage. The page batches allow-listed counters and sends at most one `navigator.sendBeacon('/api/e')` per 15 s (plus one final flush on `pagehide`); the Worker only adds them to `stats(day, key, n)` (Riga day, upsert). Counted: page views, first-time vs returning browser (a `localStorage` flag that is never sent), device class (touch / viewport), language, quality tier, theme, WebGL unavailable, rounds started/finished per mode, final-score bucket per mode (log scale), PWA installs/standalone launches, share clicks, online lobby joins, errors by coarse type (`err:js|promise|ctxlost|load`). Unknown keys are ignored server-side (keys are an allow-list + a few patterns, max 160 distinct keys/day). **`DNT: 1` / `Sec-GPC: 1` (and `navigator.doNotTrack` / `globalPrivacyControl`): nothing is collected or sent.** Per-IP-hash beacon limit 40 / 10 min (rate-limit rows expire; the hash holds IP + UTC date, not the IP). The About popover says so (LV + EN).
- `GET /api/stats?days=30` -> `{from, to, days:[{day, keys:{...}}]}`. **Public by default** (aggregates only); set a secret `STATS_KEY` (`npx wrangler secret put STATS_KEY`) to require `Authorization: Bearer <key>` (the page then asks for the key once per tab).
- `/stats.html`: plain SVG charts (players, rounds by mode, device, language, quality, score buckets, errors); `?sample=1` shows made-up data, `?days=90` changes the window.

### Migrations and deploy
`0002_modes_anticheat.sql` (mode/day/seed on rounds; mode/day/suspect/flags/trace/round_id/kills/deaths on scores + indexes; existing rows become classic) and `0003_stats.sql` (`stats`, `rate_limits`) are applied by **`npm run deploy`** (`wrangler d1 migrations apply bedre-scores --remote`). Exact owner steps: `npm run deploy` -- nothing else is required. Optional: Turnstile (above) and `STATS_KEY`. Never edit an applied migration; add `0004_...`.

### Tests and tools
- `npm run smoke:api` (`API_PORT`, default 8794; builds into `scripts/.dist-api`, own wrangler config/state): modes, per-mode boards, daily day/timezone handling, migrations on a fresh DB and on a DB that only had 0001, trace accept/suspect/reject, suspect rows hidden, rate limits, profanity, Turnstile with a mock siteverify (`TURNSTILE_VERIFY_URL`, test only), analytics allow-list + DNT, stats.
- `npm run smoke:e2e` (`E2E_PORT`, default 8795; builds into `scripts/.dist-e2e` with a hook exposing `window.__G`, writes `scripts/out/modes-*.png`): a short server-timed round in every mode in the real game, daily setup identical in two fresh browsers, second daily attempt = practice, free roam submits nothing, a legit autopilot round accepted, a tampered submission rejected.
- Browser hooks: `window.__modes` (`state`, `setMode`, `setDay` for testing other days, `daily()`), `window.__trace()` (the trace the next submission would carry).
- `npm run gen:limits` / `npm run check:legit` (`tools/gen-limits.mjs`, `tools/check-legit.mjs`, `tools/sim-lib.mjs`; port 5191).
- Test-only worker vars (never in `wrangler.jsonc`): `ROUND_SECONDS_OVERRIDE`, `RATE_ROUNDS_PER_HOUR`, `CAP_<MODE>`, `TURNSTILE_VERIFY_URL`.


## Rīga flavour (iteration 3)

- **Data** (`tools/build-data.mjs`, additive, cached in `tools/.cache/osm_transit.json`): `tramways [{p}]`, `stops [[x,z,isTram]]`, `piers [{p}]`. Cadastre footprints mostly over water (piers/berths) go to `piers` (painted as deck); un-addressed engineering works (cadastre codes 21xx/22xx/24xx: streets, ports, bridges, ...) are flattened to a 1.2 m `aux` slab or moved to `piers`, tunnels dropped; un-typed/un-addressed/unmatched elongated or quay-hugging structures flattened, other heuristic heights capped at 4 m; the placeholder "Bez adreses" is never stored as `n`. All new arrays are optional (sample city runs without them).
- **Transit**: blue/white buses, trolleybuses (two roof poles), articulated trams (amber route board). Trams run only on `tramways` (graph of tracks, big components only; falls back to primary roads if absent), tracks drawn as two thin rails on the ground. Stops: shelters + blue sign pole + waiting pedestrians; vehicles dwell 4-8 s; simple car-following (`LIFE.movers.followGap`).
- **Landmarks** (`landmarks.js`, rules by name/position; decorations are part of the building geometry so they fall with it): Central Market pavilion barrel vaults, Nativity Cathedral gold domes + bell tower, National Opera (matched as Aspazijas bulvāris 3: steps, six columns, entablature, pediment, north-facing), Powder Tower, St Peter stepped green spire, Dome tower cupola, Riga Castle (corner towers + flag), House of the Blackheads (stepped brick gable), Cat House (black cat on turret, +bonus), Laima clock, Vanšu cable-stayed pylon on the median of the twin primary carriageways (`LIFE.riga.pylonAt`, ~(-1118, 49); verified against the road data), café terraces on Old Town squares, railway-bridge steel arches, Stone Bridge lanterns, flags on public buildings. Cat House position is matched by address / nearest footprint (approximate). Shadows fade out smoothly when zoomed far (`lighting.js`, based on shadow-texel size). `scripts/shots.mjs` takes landmark close-ups.
- **Street flavour** (`riga.js`): flags, parasol terraces, flower/souvenir stalls, bikes, scooters, taxis, old-style lanterns in canal parks, cobblestone paving in the Old Town ellipse, bridge decks joined into one. Boats/ferries/swans follow water centre-lines (`water.js`), pigeons/gulls scatter near holes (`LIFE.movers.birdScare`).
- Tunables: `LIFE.movers.{trolleys,trams,taxiFrac,boats,ferries,swans,pigeons,gulls,stopDwell,followGap,birdScare}`, `LIFE.riga.*`, `CFG.value.*` (new kinds).


## Iteration 4: scores UI, i18n, credits, robustness

- **Global scores**: `Game._beginRound()` calls `startRound()` when the fly-in ends (timer start) and re-creates the round id on every Play again; the response's `roundSeconds` becomes the round length (server = source of truth; `ROUND_SECONDS` in `worker/index.js` is the only place to change it, `CFG.roundSeconds` is just the offline default). At round end the player's result is submitted once; results show "Global rank: #N all-time · #M today" or a quiet "score not saved (offline)". A round is **unranked** (never submitted, "Debug mode" note) if `?time=`, `?sample=1`, `?bots=N` (N != 7) was used or any `__game` hook (`setRadius`, `teleport`, `teleportHole`, `setHoleRadius`, `setTarget`, `step`, `autoplay`) was called during the round. This is honesty-level protection only: the client is trusted.
- **Pause**: Esc / pause button / tab hidden. The simulation clock does not advance while paused; the first frame after returning has `dt` clamped (50 ms). Audio is suspended while paused. Note the server expires a round `ROUND_SECONDS + 600 s` after it started, so a pause longer than 10 minutes makes the score "not saved".
- **Mobile**: drag = virtual joystick, two-finger pinch = zoom, page scroll / browser pinch-zoom / context menu blocked during play (`touch-action: none`, `touchmove` and `gesture*` guards); panels scroll normally.
- **Production build**: `vite build` puts three.js in its own chunk (`vite.config.js` `codeSplitting`), `public/_headers` (Cloudflare static-assets syntax) sets immutable caching for `/assets/*`, 1 h + revalidate for `/data/riga.json`, always-revalidate for `/` and `/index.html`. `window.__game` / `__life` test hooks are intentionally kept in the build because the smoke tests drive the production bundle; they mark a round unranked. Generated folders (`dist`, `scripts/.dist*`, `scripts/out`, `.wrangler`, `tools/.cache`) are git-ignored.
- **Meta**: `<title>`, description, theme-color, Open Graph/Twitter tags (`og:image` -> `https://bedre.pakers.lv/og.png`, shipped as `public/og.png`), SVG favicon `public/favicon.svg` (dark hole, terracotta rim).


## Building shapes (iteration 5)

Notable buildings no longer are flat boxes. `public/data/riga-shapes.bin.gz` (~1.5 MB gzip) is produced offline by `tools/detail/build-meshes.mjs`
from the data spike `tools/detail/data/riga-detail.json` (height grids measured from the municipality's reality model + OSM `building:part`s; the
mesh itself is never shipped; the spike JSON is an input only and not deployed) and `public/data/riga.json` (footprints):

```
cd tools/detail && npm i && node build-meshes.mjs           # ~6 s, writes public/data/riga-shapes.bin.gz   (--only=<id,id> to test single buildings)
```

Per building the tool (see `tools/detail/README.md`, "Plane-fitted mesher"): picks the source (OSM parts, tessellated directly into exact prisms, planar roofs and smooth lathe domes, only for the Nativity
cathedral and where they agree with the mesh; otherwise the measured mesh grid) -> open ground / courtyards, street-level skirts trimmed, light denoise -> outline = the cadastre polygon (simplified
at 0.4 m so facades are straight) or a simplified contour where there are courtyards -> **plane-fitted roof**: round / square lathe detection (domes, cones, onion domes, spires), RANSAC planes, shared
simplified region borders, ridges straightened onto plane intersections, constrained Delaunay triangulation, welded heights and vertical step walls where levels differ (fallback for tiny or hopeless
footprints: the old error-bounded TIN). ~25 landmark buildings are curated in `tools/detail/heroes.mjs` (source, palette, facade style).
File layout (`BSH1` v2): header JSON (`hs` = `[id, p90*10, p50*10]` for every building, `b` = per-building records with `stride` 14: vertex/triangle/loop counts, source 1 mesh-notable / 2 OSM /
3 mesh-relief, volume, hmax, eave, roof / wall / dome / accent colours (0 = default), facade style 0-3) followed by Int16 positions (1/16 m, building-local, origin = footprint centroid), Uint16 triangle indices
(delta-coded against the first-use counter, BFS triangle order), Uint8 materials, Int16 outline loops; 16-bit sections are byte-plane split; everything gzip'd.

In the game (`buildings.js`): every building gets the measured height (`flatHeight()`: p50-based eave height for pitched roofs, p90 for flat ones, `riga.json`
value kept for tree-inflated small buildings and `aux` slabs). Shaped buildings: roofs are flat-shaded triangles (flat = mid grey tar; pitched = tile / tin / some green tin by neighbourhood, one roof material per building and never near-black;
domes / spires = verdigris, hero dome colour or gold for Orthodox churches), wall-class triangles (step walls, drums, towers) use the wall colour with horizontal normals smoothed across faces within ~35 degrees,
heroes carry their own wall / roof / dome colours and a facade style (apartment windows, church, palace, plain stone) that sets the window pattern, walls are extruded from the outline loops with the usual window shader. The old procedural decorations (spires, domes,
opera portico, castle towers, market vaults, ...) are dropped for shaped buildings; the Cat House keeps its cats (placed on the two highest points). Non-shaped
buildings keep the old generators (mansards, church spires) at the measured height. `world.setDetail(level)` swaps relief buildings to a flat box (a second geometry id in
the same `BatchedMesh`) at `low` quality. Debug counts: `__life.world.shapeStats` and `window.__timing {loadMs, buildMs}`.
The Freedom Monument prop is placed at the surveyed position (-1.7, 4.3) instead of the OSM point (3.4, -1.5), which is ~7 m off.

Review shots of the shaped buildings: `PORT=5181 GPU=1 node scripts/detail-shots.mjs [slug ...] [--prefix=before-] [--quality=low] [--only=heroes|blocks|overview|sheet]` writes, for every hero in `tools/detail/heroes.mjs`, `scripts/out/hero-<slug>-{a,b,play}.png` (two opposite 3/4 close-ups + gameplay zoom), the contact sheet `hero-sheet.png`, 6 fixed ordinary blocks `block-1..6.png` and `detail-overview*.png` (forced `?theme=day`); `node tools/detail/preview-shapes.mjs <slug|id|blocks|heroes>` renders the shipped shapes in software without a browser; `scripts/measure.mjs` prints
build time / draw calls / triangles / cpu ms per frame.

## Themes (day / evening / winter / 18 November / Līgo)

`src/theme.js` (+ `sky.js`, `glow.js`, `snow.js`, `flags.js`, `fireworks.js`, `themeUniforms.js`). A theme = sky + fog + hemisphere/sun colours, sun direction, exposure, a `night` factor (0..1), window-light fraction, glow, snow, festive flags, fireworks.

**Choosing a theme.** Priority: `?theme=` in the URL > the picker on the start screen (Auto / Day / Evening / Winter / 18 Nov, remembered in `localStorage bedre.theme`) > automatic by the player's clock:
11-18 Nov = `nov18` (Lāčplēša diena), 23-24 Jun = `ligo`, Dec-Feb = `winter` (day) / `winterEve` (after sunset), otherwise `day`, or `evening` from 20 minutes before the local sunset (computed for Riga for that date, NOAA formula) until sunrise.
Force one for testing: `?theme=day|evening|winter|winter-evening|nov18|ligo` (`auto` = the clock). It is re-evaluated at every Play / Play again when set to Auto. Everything is reachable through `window.__theme` (`info()`, `apply(id)`, `setPick(p)`, `volley(n)`, `playFinale()`).

**What each theme does.**
- *Evening / night*: sky dome (deep blue-violet gradient, warm horizon, stars, moon), moon-coloured directional light, brighter exposure so the city stays readable, softer shadows, lit windows (35-55 % of the windows, per-building variation, a few cool TV-blue ones: shader hook in `buildings.js`, uniforms in `themeUniforms.js`), additive glow sprites (one draw call, no real lights) for street lamps / lanterns, vehicle headlights, floodlit landmarks; water tints towards the sky.
- *Winter*: snow on roofs, ground and up-facing prop surfaces (shader hook; roads stay greyer, canals turn pale ice-blue), GPU snowfall around the camera focus. `winter-evening` combines it with the night look.
- *18 November*: the evening look plus ~150 rooftop flags, ~150 flags hung on facades (proportions 2:1:2, carmine `#9E3039`, white stripe = 1/5 of the height, waving in the vertex shader), flag poles along the riverside and around the Freedom Monument, red-white-red floodlight on landmarks, candles along 11. novembra krastmala (the Daugava promenade next to the Old Town), and **fireworks**: a short volley behind the start screen, during the intro, then every 40-60 s in the round and a big finale (24 rockets over ~9 s) when the round ends. Fireworks are GPU-simulated (see below), flash the city lighting briefly, and play a launch whistle + boom + crackle through `audio.js` (voice-limited, respects mute).
  Volleys are placed over the Daugava point nearest to the camera focus, pulled into the camera's view when the river is far (the follow camera looks steeply down, so bursts are kept low enough to be visible).
- *Līgo* (23-24 Jun): golden-violet midsummer dusk, half-lit windows.

**Fireworks internals.** One `THREE.Points` draw call, additive. A pool of burst slots (8 / 12 / 16 by quality) each holds a rising rocket and up to 46 / 84 / 120 sparks drawn as 1 / 3 / 6 trail points that sample the same analytic trajectory (drag + gravity) at earlier times in the vertex shader. Spawning writes one slot; nothing is written per frame except two uniforms. Explosion events (flash + sound) are queued on the CPU.

**Quality tiers** (`quality.js` level): `low` = no snow, no firework trails, fewer sparks, every second lamp / headlight, fewer flags, no halos; `medium` = 1500 flakes, 3-point trails; `high` = 3000 flakes, 6-point trails.

**Tunables**: `THEME_TUNE` (firework cadence, volley sizes, flash, sunset offset, Riga lat/lon) and `LOOKS` in `theme.js`; `LIFE.fx` is untouched. Extra hooks in other files (all additive): `buildings.js` (window / roof-snow shader snippet), `lighting.js` (`applyTheme`, firework flash, shadow strength), `audio.js` (`fwLaunch`, `fwBoom`, bus events `fireworkLaunch` / `fireworkBoom`), `life.js` (`initTheme`), `i18n.js` (theme strings). Ground and prop materials are patched at runtime by `chainShader()` (no `ground.js` edit).

Test + screenshots: `PORT=5187 GPU=1 node scripts/smoke-theme.mjs [--no-shots | --shots-only [name ...]]` (writes `scripts/out/theme-*.png`; mocked-clock auto-selection, per-theme frame cost, pooled fireworks, memory across theme switches).

## Multiplayer ("Tiešsaiste" / "Online", beta)

A second mode next to solo (solo is untouched). Time-boxed, synchronised rooms: press **Online** -> you are put into the open lobby ->
the countdown starts when the first player arrives (20 s, `MP.lobbySeconds`; a full room of 12 starts at once) -> everybody gets the same
whole-city fly-in and the same 5:00 round at the same server instant, all holes at start size -> results -> *Play again* rejoins a lobby.
Nobody can join a running round: late arrivals wait in the next lobby ("Next round starts in N s") and can watch the running round's
top 5. Bots (server-simulated, marked "AI") fill the room up to 8 holes. The result of every human is written to the global leaderboard
by the **server** (D1 `scores`, `mode = 'online'`, see `worker/lib/db.js insertScore`); clients never submit online results.

### Architecture
```
browser (src/net/*)  --POST /api/mp/join-->  Worker (worker/index.js -> worker/mp/index.js)  --> MpMatchmaker DO ("mm", one instance)
        |                                                                                         assigns the open lobby, keeps a summary of running rounds
        +--WebSocket /api/mp/ws?room=X-->  Worker --> MpRoom DO (one per room): lobby -> intro -> playing -> results
                                                       RoomSim (worker/mp/sim.js): authoritative scores / radii / eaten objects / kills / bots / ranking
```
| file | role |
| --- | --- |
| `worker/mp/protocol.js` | constants (`MP`), test overrides (`mpConfig`), input hygiene (`parseClientMessage`, `RateLimiter`), message catalogue in the header comment |
| `worker/mp/table.js` | object-table format (encode in the browser, parse in the DO) + the content hash |
| `worker/mp/sim.js` | `RoomSim`: pure JS (no Cloudflare APIs), used by the DO and by `scripts/test-mp-sim.mjs`; validator, duels, respawns, server bots |
| `worker/mp/room.js` | `MpRoom` Durable Object: WebSocket Hibernation API, lobby/alarm, 20 Hz sim + 10 Hz snapshots while a round runs, D1 write |
| `worker/mp/matchmaker.js`, `index.js` | `MpMatchmaker` DO + the `/api/mp/*` routes |
| `src/net/client.js` | socket, session token (sessionStorage), ping/clock sync, traffic counters |
| `src/net/online.js` | `OnlineMode`: replaces `Game.update()` while online (see below), remote holes, prediction + reconciliation, lobby/results glue |
| `src/net/ui.js`, `net.css`, `table.js`, `index.js` | Online button + lobby panel + connection badge (LV/EN), table dump/hash, `initOnline()` |
| `tools/mp/build-objects.mjs` | build step: dumps the object table from the real client world into `public/mp/objects.bin` |

**Authority.** The server owns the clock, every hole's score + radius (`radius = 2.2 (1 + score/16)^0.44`, classic curve), the eaten set,
hole-vs-hole kills (>= 1.15x radius, victim centre inside `0.62 r`, 50% of the victim's score to the eater, victim respawns after 0.7 s
fall + 3 s at 50% score with 3 s protection) and the final ranking. Human holes **move on the client** (responsive) and report their
position ~12 Hz; the server accepts it only within a distance budget: `speed(r) * 1.3` per second (+ a 1.5 s burst), otherwise it keeps
the old position and sends `rb` (rubber-band) so the client snaps back. Eat claims (`c` = static ids, `m` = movers) are checked against
the object table: id exists, not eaten in this room, `fit < r * 0.95 (x1.03)`, centre within `r * 0.92 + slack` of the *server-known*
hole position (slack = 0.4 s of travel + 1.5 m for latency), claim budget 150/s. Accepted claims are acknowledged (`a` with the
authoritative score and the rejected ids, which the client puts back on the map). The catch-up rule: a respawn point is the best of 64
street points scoring food nearby for the new size, distance from the top-3 holes and from every other hole.

**Movers (cars, trams, pedestrians, boats, birds).** Their motion is random-seeded per client (`Math.random` turns, dwell times,
panic) and cannot be reproduced by the server. Chosen option (simplest robust): the server accepts mover claims with a **loose** check:
the claim carries the mover's position as the claimer sees it; the server checks kind/fit, reach to *that* position, and a cap of 80
mover-points per second per hole (burst 200). It then broadcasts the eaten id; other clients play the fall (the mover is moved next to
the eater first so it does not slide across the map). Residual risk: a cheater can lie about a mover's position to eat movers near
itself, worth at most 80 points/s of cars/people (a bus is 14, a tram 22); statics (all buildings, trees, props, 18-21k objects) are
validated exactly. Bots only eat statics.

**Object table + ids.** Object id = index in `world.objects` of the client (deterministic build: footprints + shapes, seeded scatter,
seeded mover plan). `npm run build:mp` (`tools/mp/build-objects.mjs`) opens the real build in headless Chromium and dumps
`public/mp/objects.bin` (x, z, fit, value, flags per object + ~1.2k spawn candidates; ~368 KB raw / 232 KB gzip for 20 896 objects),
with a hash over fit/value/flags/positions. `hello` carries the client's own hash; a different hash gets `err: version` ("Your game
version is out of date, reload"). **Re-run `npm run build:mp` whenever map data, building shapes, scatter, props or traffic planning change**
(`npm run deploy` does it first). A stale table does not break solo; online refuses everybody until the table is rebuilt.

**Snapshots / interpolation.** `{t:'s', T, h:[[id,x,z,r,score,state]..], e:[[obj,hole]..], k:[[eater,victim,gain]..], r:[[id,x,z,score]..]}`
at 10 Hz, one JSON string broadcast to all. Clients draw remote holes `130 ms` in the past (interpolation between snapshots, 150 ms
extrapolation cap), play the normal fall animation for objects eaten by others, and run the normal kill feed / swallowed overlay /
leaderboard / name tags / minimap on them. `Game.update()` hands over to `OnlineMode.update()` while `game.online` is set (4 small
guarded hooks in `game.js`: `start`, `skipIntro`, `pause`, `update`; plus `isBot` in `_rank`).

**Robustness.** Reconnect: the browser keeps a per-tab session token (`sessionStorage`); a dropped socket reconnects (retries for 14 s)
and the server answers `resume` (full eaten list, current score) for the same hole; a disconnected hole idles, is removed after 15 s
(no result row for those who left), and a room with no humans is closed. No pause in online mode (hidden tab = the hole just sits there).
Messages: JSON only, 2 KB cap, shape-checked (malformed = ignored), token bucket 40 msg/s (burst 80, closed after a sustained flood),
names sanitised server-side with `worker/lib/moderation.js` (same as the scores API), rooms are single-use and cleaned up
(`deleteAll()`) 60 s after the round. If the object table, WebSocket or Durable Objects are unavailable the Online button shows
"Online play is not available right now. Single-player still works." No personal data is stored: room names, counters, names +
scores of finished rounds only; IPs are never read by the multiplayer code.

### Limits / tunables
`MP` in `worker/mp/protocol.js`: 12 humans per room, 8 holes in total, 20 s lobby, 300 s round, 20 Hz sim, 10 Hz snapshots, speed tolerance
1.3, claim/mover budgets. Gameplay numbers (growth, reach, duel ratio, bot tuning) are imported from `src/config.js`, so solo and online
cannot drift. Cost model (free plan): lobbies hibernate (nothing runs between messages, one alarm); a running round holds one DO active
(`setInterval`) for ~5 min; incoming WebSocket messages are billed at 20:1, outgoing are free: one human is ~13 messages/s up
-> ~190 billed requests per round, plus ~150 matchmaker reports per running room. Measured, one client: ~2.4 KB/s down + 0.4 KB/s up in
an 8-hole room (6 KB/s down worst case with 12 humans + 8 AI). Server CPU (plain Node, `scripts/test-mp-sim.mjs`): 0.02 ms average and
< 1 ms worst per 20 Hz sim tick with 12 humans + 8 bots, snapshot JSON 0.004 ms, one client message ~1 us. Check
https://developers.cloudflare.com/durable-objects/platform/pricing/ for the current free-plan allowances before launching.

### Test locally
```
npm run test:mp                 # validator / duel / bot unit tests + CPU & bandwidth bench (plain Node, no browser)
GPU=1 node scripts/smoke-mp.mjs # full end-to-end: builds the table + client, `wrangler dev` on :8793 with --var MP_ROUND_SECONDS=70 MP_LOBBY_SECONDS=4 ...,
                                # 3-4 Chromium contexts; screenshots scripts/out/mp-*.png (own build dir scripts/.dist-mp, own local D1 scripts/.mp-state)
```
By hand: `npm run build:mp && npm run build && wrangler d1 migrations apply bedre-scores --local && wrangler dev --port 8793 --var MP_ROUND_SECONDS:60 --var MP_LOBBY_SECONDS:3`,
open two browser windows, press Online in both. Test-only `--var`s (never in wrangler.jsonc): `MP_ROUND_SECONDS`, `MP_LOBBY_SECONDS`,
`MP_RESULTS_SECONDS`, `MP_MAX_HUMANS`, `MP_TEST_CLOSE_SPAWN=1` (humans start next to each other). `window.__online` exposes the state for tests.

### Before deploying (read this)
1. `npm run deploy` now runs `build:mp` first. The Worker needs `public/mp/objects.bin` in the assets (it is, via `dist/mp/objects.bin`).
2. `wrangler.jsonc` gained `durable_objects.bindings` (`MP_ROOM`, `MP_MATCHMAKER`) and a migration `mp-v1` with `new_sqlite_classes`
   (the free plan only supports SQLite-backed Durable Objects). The migration is applied by the next `wrangler deploy`; never reuse or edit
   the tag, add a new migration for later class changes. `npx wrangler deploy --dry-run` lists the two DO bindings.
3. D1: online rows use the `mode`/`kills`/`deaths`/`round_id` columns from `migrations/0002_modes_anticheat.sql` (apply remote migrations
   before the Worker goes live; `npm run deploy` does).
4. A Worker deploy restarts running rooms: a round in progress at that moment is lost (clients get `gone` and return to the menu).
5. The game version and `objects.bin` must come from the same build. If a stale tab connects after a deploy it is told to reload.

## Credits and licences

- Inspired by Hole.io (plain-text mention and link to holeio.com; no assets, name, logo or code used; this is an original game).
- Building footprints, shapes and heights: © Rīgas valstspilsētas pašvaldība (https://georiga.eu): cadastre footprints plus shapes/heights measured from the municipality's reality model (the model itself is not shipped). Building parts: © OpenStreetMap contributors (ODbL).
- Building parts (OSM `building:part`, where accepted) and roads, water, parks, trees, tram tracks, stops, names: (c) OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright. The derived `public/data/riga.json` is a database derived from OSM and must keep the attribution (shown in the footer, About popover and a corner label during play).
- Ground-cover classification raster `public/data/riga-ground.png`: derived from the **LĢIA colour orthophoto 2016-2018 (cycle 6), open data, Creative Commons Attribution 4.0** (https://www.lgia.gov.lv/en/color-orthophoto-map-2016-2018-cycle-6, licence https://www.lgia.gov.lv/sites/lgia/files/document/Creative%20Commons%20Attribution%20CC%20BY_0.pdf); modified (classified, vectorised constraints, 1 m class cells); no imagery is shipped. Credit line in the About popover (`i18n.js` `aboutGround`, LV + EN). Details and verbatim licence text: `tools/surface/README.md`.
- Built with three.js (MIT). No audio or image assets.

## Bot balance (iteration 4)
Bot brains (`bots.js`) use an 80 m density map of edible value to roam toward rich areas (edges and water score ~0), re-pick targets every ~0.5-1.1 s, flee only from close/closing bigger holes, hunt only worthwhile nearby prey, and hold back when clearly leading. `SpawnPicker` places the human first (plenty of edible things within 55 m), then spreads bots/respawns by live food. Tunables: `CFG.bots.{difficulty,roamEatTime,roamGain,huntRange,huntGreed,preyMinFrac,leaderRestraint,underdogCare}`, `CFG.duel.keepScore` (0.5). Measure with `PORT=5183 GPU=1 node scripts/balance.mjs --runs 3 --greedy 3` (also `--spawn-only`, `--set bots.difficulty=0.9`). Typical result: top bot ~55-65% of the perfect greedy autoplayer (~155k), worst bot usually 15-30% of the best; a runaway leader in a rich district is still possible.


## Meta features (src/meta/) — album, achievements, % of Rīga, recap, share, PWA, radio

Everything lives in `src/meta/` and is a *passive observer*: it reads the event bus (`swallow`, `holeEaten`, `roundStart`, `roundEnd`, `levelUp`, `pause`, `resume`) and `world.onUpdate`, never changes gameplay, and never makes a round unranked (rounds that used debug hooks / URL overrides stay unranked exactly as before). `main.js` calls `initMeta({game, world})`, `initRadio()`, `initPwa()` after `initScoresUi()`.

| file | role |
| --- | --- |
| `progress.js` | `initMeta`: round state `R`, HUD meter + area banner + toasts, "My progress" panel (one link on the start and results screens), results recap, `window.__meta` (test hook). CSS is injected at runtime |
| `album.js` | "Rīgas objekti": ~25–40 collectible entries auto-built from the loaded world (curated rules with LV/EN facts for the hero objects: Freedom Monument, St Peter's, Dome, Nativity Cathedral, Opera, Castle, Powder Tower, Blackheads, Cat House, Central Market, Academy of Sciences + National Library when present, Laima clock, bridge pylon/arch, …; then OSM-named churches/towers/museums/theatres, biggest first). Entries without matching objects simply do not appear, so it adapts to the map extension. Generated canvas silhouettes as icons |
| `achievements.js` | 26 achievements (LV + EN, progress bars): first building, quick start, 10 trams, 50 cars, 100 pigeons (lifetime), big bot, two bots, all Old Town churches, Freedom Monument / Cat House / Laima / market / pylon, cross the Daugava (visit both banks), 5 neighbourhoods, Old Town ≥ 50 %, 2 % of the map, size levels 5 / 8 / max, 20 000 points, win, safe and sound, album 10 / 75 %, 10 rounds |
| `districts-names.js` | neighbourhood polygons (`public/data/riga-areas.json`, fallback = hand-drawn rectangles), `areaAt(x,z)` |
| `recap.js`, `share.js` | recap map (own aspect-correct pre-render from the map data, trail sampled every 0.5 s, eaten footprints, stars for notable things, rivals' end positions) + growth sparkline; 1200×630 share card, Web Share API with the image file, else PNG download (+ copy-link button) |
| `radio.js`, `pwa.js`, `store.js`, `strings.js` | radio, service-worker registration + update toast, versioned localStorage (`bedre.meta.v1`, all access try/catch), LV/EN strings |

- **% of Rīga swallowed**: share of the map's total swallowable *value* (sum of `o.value` of all objects) eaten by all holes and by the player; per-area totals are computed at start. HUD chip under the timer, banner `Vecrīga · 12% swallowed` when the player's hole enters a new area, per-area % in the recap.
- **Areas**: `node tools/meta/areas.mjs` downloads the municipality's public *Apkaimes* layer (cached in `tools/.cache/meta`), projects it with the pipeline's projection, simplifies it and carves the Quiet Centre out of Centrs (north of Elizabetes iela). Re-run after the map bounds change.
- **PWA**: `public/manifest.webmanifest`, `public/icons/*` (`node tools/meta/icons.mjs`), `public/sw.js`. `vite.config.js` stamps `__BUILD_ID__` into the built `sw.js` so every build installs a new worker (toast "Jauna versija — pārlādēt"); old caches are deleted on activate. The worker precaches `/` + hashed assets (parsed from `index.html` and chunk imports), serves navigations network-first (offline fallback to the cached shell), `/assets/*` cache-first, `/data/*` stale-while-revalidate, and never touches `/api/*`, non-GET or cross-origin requests (radio stream). Registered only off-localhost and outside automation; `?sw=1` forces it, `?sw=0` disables it. `sw.js` is served `Cache-Control: no-cache` (`public/_headers`).
- **Radio** (📻 next to the mute button; `CFG.radio` in `config.js`): `<audio>` element, starts only from the player's click, ducks the ambient bed, pauses on game pause / hidden tab, quiet failure, remembers station + volume. Station: Latvijas Radio 2, the official HLS stream of LSM's player (`replay.lsm.lv/lv/klausies/tiesraide/lr2`, CORS-enabled, redirects to the redCDN edge). Chrome/Firefox have no native HLS, so `hls.js` (jsDelivr, pinned 1.5.17) is loaded **only on the first click**; Safari plays it natively. Attribution (station name + link to lr2.lsm.lv) is shown while playing. `?radio=0` hides the button.
- **og.png**: `PORT=5188 GPU=1 node tools/meta/og.mjs` renders it from an in-game screenshot.
- **Test**: `PORT=5188 GPU=1 node scripts/smoke-meta.mjs` (builds into `scripts/.dist-5188`; screenshots `scripts/out/meta-*.png`).


## Ground surfaces and the bigger map (iteration 5)

**Ground (`ground.js`, data from `tools/build-data.mjs`, raster from `tools/surface/`)**
- OSM now supplies: `areas` (landuse residential/commercial/industrial/railway/construction, wood/scrub/sand, playground/pitch/stadium, parking, `area:highway`, `highway=pedestrian|footway + area=yes`, `place=square`, platforms, `man_made=pier|bridge`) with holes, `parks` (lawns incl. grassland/cemetery/meadow) with holes, water with islands (Ķīpsala / Lucavsala were previously covered by water), road `sw` (sidewalk 0 none / 1 both / 2 left / 3 right; unmapped -> both sides unless a separately mapped `footway=sidewalk` runs along that side), `s` (surface a/c/p/s/g/d/r/n/w/t), `l` lanes, `br` bridge, `ow` oneway, `f` (s sidewalk, t steps, y cycleway, p path), `crossings` (OSM `footway=crossing` ways + `highway=crossing` nodes).
- Paint order: base (class raster, else landuse -> parks -> hard areas **above** parks, so a square inside a park is paved) -> water (even-odd holes) -> piers -> **all pavements first** (offset strips for one-sided sidewalks) -> kerb line -> carriageways (surface-specific: asphalt, sett pattern, paving, gravel) -> pedestrian streets / paths / cycleways -> rail ballast + tram -> bridge decks -> footprints. Lane markings and zebra crossings only in the close-up `DetailLayer`.
- Class raster (1 m/px, ~530 KB): lawn, tree canopy, asphalt, paving, gravel, ballast, sett, water. Measured from the open LĢIA orthophoto; vectors keep authority for roads / water / buildings; the photo decides what the vectors do not know (the Freedom Monument plaza is mapped as park in OSM and comes out as paved). In the close-up layer class edges are re-smoothed (weighted vote at 4 px/m). Without the file the game paints OSM land cover only; the sample city has no raster or areas.
- Reproduce: `node tools/build-data.mjs && node tools/surface/fetch-ortho.mjs && node tools/surface/build-ground.mjs` (+ `node tools/preview.mjs`). Screenshots: `PORT=5183 GPU=1 node scripts/ground-shots.mjs [prefix] [name ...]` -> `scripts/out/ground-*.png`.

**Map extent**: x in [-2100, 1200], z in [-1200, 1500] (3300 x 2700 m = 8.9 km^2, was 2400 x 2400). Existing cadastre footprints/ids are byte-identical (the old cache is reused; only cells outside the old extent were fetched, `tools/.cache/cadastre_v2.json`). Everything reads `meta.bounds` (ground tile layout, minimap aspect, intro framing, clamps, spawn, density map, traffic). Added: more props/movers (+40 %), river boats + 4 ferries + 40 gulls, ~28 % of the bots start on the left bank (`SpawnPicker.leftPts`), merged bridge pieces (`findBridges`), hole-aware water tests (`Blockers`, `water.js`), camera far plane 14000. Bots stay 7 in ranked modes: `rules.js` / `worker/lib/validate.js` cap the reported rank at `holes` (8), so 9 bots would need a coordinated worker deploy (daily twists `bots9` / `crowd` already run 9).


## Districts / multiple maps (iteration 6)

- **Definitions**: `tools/maps.mjs` (slug, LV/EN name, focus landmark, bounds, per-map balance `mult`), imported by the build tools and by the browser (`src/maps.js`). All maps share ONE projection (origin = Freedom Monument), so centre-specific code keyed to local coordinates (Old Town zone, theme anchors, landmark rules) stays geographically right; a district is just another bounds rectangle. Maps: `centrs` (legacy paths `public/data/riga*.{json,png,bin.gz}`, unchanged), `agenskalns`, `mezaparks`, `purvciems` (`public/data/<slug>/{riga.json,riga-ground.png,thumb.png}`; optional `riga-shapes.bin.gz`). `public/data/riga-areas.json` (neighbourhood polygons) covers the union of all maps.
- **Build**: `node tools/build-data.mjs --map <slug>` (cadastre + Overpass, cached as `*_<slug>.json`), `node tools/surface/fetch-ortho.mjs --map <slug>`, `node tools/surface/build-ground.mjs --map <slug>` (writes the class raster and a 120 px picker thumbnail). Districts also get scattered, swallowable trees in forest (`natural=wood`, `landuse=forest`, 1 per ~120 m^2) and big parks (1 per ~360 m^2), off roads / buildings / water. Landmarks are topped up with OSM-named buildings (>= 8 per map for the album).
- **Client**: `?map=<slug>` > `localStorage bedre.map` > centrs. The picker (thumbnail + select under the name field) does a clean reload with `?map=`. `applyMap()` points `CFG.dataUrl / shapesUrl / groundUrl` at the map and scales `CFG.props`, `maxTrees`, `buildingDiv` and mover counts by the map's `mult`; only the selected map's files are fetched; the service worker caches `/data/*` lazily (stale-while-revalidate) and never precaches other maps. Album / achievements progress is stored per map (`bedre.meta.v1.<slug>`). Trams only run on real tracks (no fallback outside the sample city).
- **Ranking**: non-centre maps are UNRANKED (`CFG.mapsRanked = false`, game.urlUnranked = 'map') and the Online button is hidden there. To rank them the worker must accept `map` (slug, default `centrs`) in `POST /api/rounds` and `POST /api/scores`, store it, and filter `GET /api/scores?map=`; the client then sets `CFG.mapsRanked = true` and adds `map: CFG.map.slug` to those three calls (`src/scores.js`, `src/modes.js roundRequest()`).
- Tests: `MAP=<slug> PORT=5183 GPU=1 node scripts/smoke.mjs`, `MAP=<slug> node scripts/balance.mjs`, `PORT=5183 GPU=1 node scripts/district-shots.mjs [slug ...]`.

### Ground texture memory by quality tier (iteration 6)
`groundTier()` (`quality.js`, chosen before the world is built; `?quality=` pins it; phones = coarse pointer + small screen or <= 2 GB -> low; tablets / <= 4 GB / <= 4 cores -> medium) picks `CFG.ground.pxPerM[tier]` = 1.05 / 1.5 / 2.5 px/m, tiles of ~300 m (99 textures for the centre map), detail layer 1536 / 2048 / 2048 px. Measured for the centre map (RGBA + mipmaps): low 54 + 12 MB, medium 111 + 21 MB, high 308 + 21 MB (was 387 + 22). Canvases are shrunk to 1 px after upload (no CPU copy, no live 2D context). Gameplay-zoom sharpness at low comes from the DetailLayer.
