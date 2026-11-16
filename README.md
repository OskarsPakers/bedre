# BEDRE — Rīga

An original 3D browser arcade game: steer a hole around a real 3D map of Riga, swallow things smaller than you, grow, and
swallow bigger things. 5-minute rounds with 7 AI opponents ("bedre" = pit in Latvian). Four maps (Centre + three districts),
five themes, four game modes, global per-map leaderboards, an online multiplayer beta, an album / achievements / recap layer and a
PWA shell. Vite + vanilla JS ES modules + three.js client; a Cloudflare Worker (static assets + D1 + Durable Objects) as backend.
Live at https://bedre.pakers.lv. No physics engine, no framework, no assets (everything is generated), no third-party scripts.

Contents: 1 Quick start · 2 Play, test, deploy · 3 Architecture map · 4 Data pipeline and credits · 5 Backend (API, modes, anti-cheat,
analytics, multiplayer) · 6 Tunables · 7 Known limits

---

## 1. Quick start

```
npm install
npm run dev          # http://localhost:5173  (Vite; /api is proxied to `npm run dev:worker` on :8791 when you run that too)
npm run build        # production build into dist/  (first checks that the multiplayer object table is fresh, see 2.3)
npm run smoke        # headless Playwright game test + screenshots in scripts/out/   (GPU=1 = real GPU through Metal/ANGLE)
```

Needs Node 20+. `npm run dev:worker` builds, applies the local D1 migrations and runs `wrangler dev` on :8791 (the full stack locally).

## 2. Play, test, deploy

### 2.1 Controls and URL parameters
Mouse, touch drag (virtual joystick) or WASD / arrows to move; wheel or two-finger pinch zooms; Esc pauses; M mutes.
`?autostart=1` skip the start screen · `?intro=0` skip the fly-in · `?introhold=S` linger on the overview · `?map=centrs|agenskalns|mezaparks|purvciems`
· `?mode=classic|quick|daily|free` · `?theme=day|evening|winter|winter-evening|nov18|ligo|auto` · `?quality=low|medium|high` (pins the tier, disables the
auto scaler) · `?lang` is remembered from the switch · `?radio=0|1` · `?sw=1|0` service worker · debug that makes a round **unranked**:
`?time=30` (local round length), `?bots=N` (N != 7), `?sample=1` (procedural city), any `window.__game` hook that changes the round.

### 2.2 Tests (all headless Chromium; `GPU=1` = real GPU, omit for SwiftShader)
| command | what it covers | port |
| --- | --- | --- |
| `PORT=5186 GPU=1 npm run smoke [-- --sample]` (`MAP=<slug>` for a district) | gameplay, bots, duels, results, intro, zoom, balance curve | PORT |
| `PORT=5187 GPU=1 npm run smoke:world [-- --sample]` | traffic, audio, particles, landmarks, labels, perf | PORT |
| `API_PORT=8796 npm run smoke:api` | worker API on a local wrangler: modes, per-map boards, migrations (fresh + upgrade from 0001), validator, rate limits, Turnstile mock, analytics | API_PORT |
| `E2E_PORT=8797 GPU=1 npm run smoke:e2e` | built game + worker: server round length, submit, boards, tamper rejected, daily, district ranking + map switch, results | E2E_PORT |
| `npm run test:mp` / `GPU=1 npm run smoke:mp` | multiplayer: pure-Node sim/validator/bots/CPU bench / full end-to-end on wrangler :8793 | 8793 |
| `npm run check:legit` | fresh autoplayer rounds on EVERY map + all modes through the validator: 0 false rejects expected; tampered control must be flagged | 5191 |
| `PORT=5188 GPU=1 node scripts/smoke-meta.mjs` | album, achievements, % meter, recap, share card, PWA, radio | PORT |
| `PORT=5187 GPU=1 node scripts/smoke-theme.mjs` | themes, clock auto-selection, fireworks, per-theme frame cost | PORT |
| `PORT=5185 GPU=1 node scripts/final-shots.mjs` | UI shots, pause / resize / touch / leak checks (geometry compared across replays after a warm-up round) | PORT |
| `MATRIX_PORT=5188 GPU=1 node scripts/smoke-matrix.mjs` | ~24 combinations of map x theme x mode x quality (+ LV/EN, phone, landscape): no errors, HUD nodes do not overlap, score rises, results render, Play again works; `scripts/out/matrix-*.png` + `matrix-contact-sheet.png` | MATRIX_PORT |
| `PERF_PORT=5189 GPU=1 node scripts/perf-matrix.mjs [--phones] [--breakdown] [--throttle]` | draw calls / triangles / cpu ms / texture MB per map x tier; emulated iPhone 13 and low-end Android; CPU-throttle test of the quality scaler | PERF_PORT |
| `node scripts/check-radio.mjs [--hlsjs]` | real playback of Latvijas Radio 2 (soft check without network) | RADIO_PORT |
| `MAP=<slug> PORT=5188 GPU=1 node scripts/balance.mjs`, `SPAWN_PORT=5190 GPU=1 node scripts/spawn-check.mjs`, `node scripts/mp-bot-bench.mjs` | per-map balance, spawn richness (>= 80 edible things within 60 m), server-bot strength | |
| `scripts/ui-shots.mjs <scenario...>` | ad-hoc UI screenshots against a running Vite server (`PORT`, default 5187) | |

Dev/test hooks (`window.__game`): `state`, `hole`, `start()`, `skipIntro()`, `teleport`, `setRadius`, `step(s)`, `autoplay(s)`, `holes`, `leaderboard()`,
`teleportHole`, `setHoleRadius`, `botCount`, `overlay`, `cam` ... Other hooks: `__life` (audio, quality, world, theme), `__theme`, `__modes`, `__meta`,
`__radio`, `__online`, `__ui`, `__trace()`. They mark a round unranked and, for the meta layer, **a round flagged unranked by a debug hook never unlocks
album entries / achievements** (set `window.__metaAllowDebug = true` in tests that need them). Generated folders (`dist`, `scripts/.dist*`,
`scripts/out`, `.wrangler`, `tools/.cache`) are git-ignored.

### 2.3 Deploy
One-time: `npx wrangler login`, `npx wrangler d1 create bedre-scores`, put the printed id into `wrangler.jsonc` -> `d1_databases[0].database_id`.
Then `npm run deploy` = `build:mp` (dump the multiplayer object table from the real world) -> `check-objects` -> `vite build` ->
`wrangler d1 migrations apply bedre-scores --remote` (0001..0004, all additive) -> `wrangler deploy`. Check without deploying: `npx wrangler deploy --dry-run`.

* **Object table guard.** `public/mp/objects.bin` must come from the same world build as the client (else online refuses everybody). `public/mp/objects.stamp.json`
  fingerprints the sources it was built from; `npm run build` runs `tools/mp/check-objects.mjs --fix` (rebuilds automatically when stale, fails loudly when it
  cannot, `SKIP_MP_CHECK=1` bypasses), `npm run deploy` and `smoke:mp` check it too. `npm run build:web` is the bare `vite build`.
* Migrations are never edited once applied; the next one is `0005_...`. `0004_maps.sql` adds `rounds.map` / `scores.map` (default `centrs`) + indexes.
* A Worker deploy restarts running multiplayer rooms (a round in progress is lost); the Durable Object migration tag `mp-v1` is never reused.
* Optional: Cloudflare Turnstile and `STATS_KEY` (5.5). Privacy: only the chosen display name + score stats + the anti-cheat trace are stored; no cookies.

## 3. Architecture map

Coordinates: metres, x = east, z = south (north = -z), y up; ONE projection for every map (origin = Freedom Monument). Buildings are `BatchedMesh` instances whose
origin is the footprint centroid at ground level so each can tilt / sink / hide individually.

**Core (src/)** — `main.js` bootstrap (loading screen, WebGL fallback, renderer, rAF loop, pause, resize, gesture guards) · `config.js` **all tunables** ·
`i18n.js` LV/EN (`t()`, `data-i18n*`, `extendStrings`) · `data.js` / `sampleCity.js` data load + procedural fallback · `world.js` ground + buildings + props, object
registry, 24 m grid, fall animation; static props are chunked into 250 m InstancedMeshes so they frustum-cull, movers keep one mesh per kind · `ground.js`
(tiles + close-up `DetailLayer`, class raster, `quality.js groundTier()`) · `holeView.js` (hole discard + rim shader) · `buildings.js`, `shapes.js`, `landmarks.js`
(measured shapes, plane-fitted roofs, hero landmarks) · `propModels.js`, `scatter.js`, `riga.js`, `traffic.js`, `water.js` (props, street flavour, movers, boats) ·
`holes.js`, `input.js`, `camera.js`, `lighting.js`, `game.js` (state machine, round timer, results) · `bots.js`, `spawn.js` · `rules.js` (growth formula, mode table;
shared with the Worker) · `maps.js` (+ `tools/maps.mjs`) map selection, per-map multipliers, picker.
**HUD / UI** — `hud.js`, `style.css` (the layout system, see 3.1), `index.html`, `ui.js` (options toggle, results tabs, focus trap), `scoresUi.js` (Top scores with mode + map
switch, About), `modes.js` + `modes.css` (mode selector, daily intro), `minimap.js`, `labels.js`.
**Life and feel** — `life.js`, `events.js` (bus), `effects.js`, `audio.js` (procedural WebAudio + mute button), `quality.js` (auto scaler).
**Themes** — `theme.js` (+ `sky.js`, `glow.js`, `snow.js`, `flags.js`, `fireworks.js`, `themeUniforms.js`).
**Meta** (`src/meta/`, passive observers of the bus) — `progress.js` (% of Riga meter, area banner, toasts, My progress panel, recap), `album.js`, `achievements.js`,
`districts-names.js`, `recap.js`, `share.js`, `radio.js` (bundled hls.js, dynamic import), `pwa.js`, `store.js`, `strings.js`.
**Multiplayer client** (`src/net/`) — `client.js`, `online.js`, `ui.js`, `table.js`, `net.css`. **Worker** (`worker/`) — `index.js` API, `lib/*` (db, validate, limits, moderation,
analytics, turnstile), `mp/*` (Durable Objects + authoritative sim).

### 3.1 UI layout system
`src/style.css` positions every HUD piece from a few variables (`--gap`, `--btn`). Two layouts: **wide** (> 900 px and > 520 px high: score card top-left, timer top-centre
with the round buttons next to it, leaderboard top-right, minimap bottom-right, size bar bottom-centre) and **compact** (phones, small tablets, short landscape windows:
score card + `% of Riga` chip + kill feed in the left column, timer centre, top-3 + you leaderboard right, minimap bottom-left, the three round buttons (radio, sound,
pause; 44 px touch targets) in a column bottom-right, full-width size bar, attribution under it; banners / labels / swallowed overlay each own a vertical lane; toasts are
capped at 2 visible with a queue and are suppressed while the results are up). Menu and results screens put sound + radio in the bottom-right corner and keep it
free. `scripts/smoke-matrix.mjs` bounding-box-tests the key nodes on desktop, 360x640, 390x780, 430x932 and 780x390. The start screen is one calm column (name, mode, Play,
Online, an "Options" row that opens district + theme, links); the results panel has Result / Map / Progress tabs with Play again always visible.

## 4. Data pipeline and credits

Centre map data: `node tools/build-data.mjs && node tools/surface/fetch-ortho.mjs && node tools/surface/build-ground.mjs` (+ `node tools/preview.mjs`).
Districts: `--map <slug>` on each tool; per-map folders `public/data/<slug>/{riga.json,riga-ground.png,thumb.png,riga-shapes.bin.gz}`; the centre keeps the legacy flat paths.
Building shapes: `cd tools/detail && npm i && node build-meshes.mjs` (measured height grids from the municipality's reality model + OSM building parts -> plane-fitted
roofs, ~25 curated heroes in `tools/detail/heroes.mjs`, `BSH1` file format in `tools/detail/README.md`). Neighbourhoods: `node tools/meta/areas.mjs`
(municipal *Apkaimes*; official Latvian names are shown in both languages, "Old Town" only as an English subtitle of Vecrīga). PWA icons / og image: `tools/meta/`.

`public/data/riga.json`: `meta{name,origin,bounds}`, `buildings[{id,p,h,t,n?}]`, `roads[{p,w,k,sw,s,l,br,ow,f}]`, `water[{p,h?}]`, `parks`, `trees`, `landmarks[{n,x,z,h}]`, optional
`areas`, `crossings`, `tramways`, `stops`, `piers`. Landmarks are matched to the building that contains them (renamed + score bonus); Z-Towers is added from its address.
Maps (`tools/maps.mjs`): `centrs` (3300 x 2700 m), `agenskalns`, `mezaparks`, `purvciems` (2600 x 2600 m each) with per-map multipliers
(`props, value, trees, people, bots, botSpeed`).

Credits and licences
- Inspired by Hole.io (plain-text mention and link to holeio.com; no assets, name, logo or code used; this is an original game).
- Building footprints, shapes, heights: © Rīgas valstspilsētas pašvaldība (https://georiga.eu); shapes/heights measured from the municipality's reality model (the model is not shipped).
- Roads, water, parks, trees, tram tracks, stops, names, building parts: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright); the derived data keeps the
  attribution (footer, About, a corner label during play).
- Ground-cover classification rasters: derived from the **LĢIA colour orthophoto 2016-2018 (cycle 6), open data, CC BY 4.0**; modified (classified, 1 m cells); no imagery is
  shipped. Details and licence text: `tools/surface/README.md`.
- Radio: Latvijas Radio 2 live stream from LSM (https://lr2.lsm.lv), played only when the player switches it on; hls.js (Apache-2.0) is bundled, three.js (MIT).
- Neighbourhood polygons: municipality open data (*Apkaimes*).

## 5. Backend

One Worker (`worker/index.js`) serves the static build and `/api/*`; D1 database `bedre-scores`; two Durable Objects for multiplayer. `src/scores.js` never throws, the game works
offline. Same-origin POSTs only.

### 5.1 API
- `POST /api/rounds {mode?, map?, day?}` -> `{roundId, roundSeconds, mode, map, day?, seed, turnstileSiteKey?}`. `mode` in classic|quick|daily; `map` a slug from the shared allow-list
  `tools/maps.mjs` (default `centrs`); the **daily challenge is centre-only** (district -> 400); free / online -> 400. 30 rounds / hour / IP-hash. The round token is bound to mode, map, day, seed.
- `POST /api/scores {roundId, map?, name, score, eaten, radius, rank, biggest, trace[, turnstile]}` -> `201 {ok,id,name,mode,map,rankAllTime,rankToday}`; 400 bad payload / map mismatch,
  403 unknown / early / expired round, 409 replay, **422 failed plausibility** (token burnt, nothing stored), 429 daily submission cap (classic 60, quick 120, daily 5 per IP-hash).
- `GET /api/scores?mode=classic|quick|daily|online&map=<slug>&period=all|week|day[&day=][&limit=20]` — one board per map x mode (daily / online exist for the centre only; other maps answer empty).
  Suspect rows are never listed. The Top-scores panel has the mode switch AND a map switch (daily / online lock it to the centre and say so).
- `POST /api/e` analytics beacon, `GET /api/stats?days=30`, `/api/mp/*` multiplayer.

### 5.2 Game modes (`src/modes.js`, `src/daily.js`, `src/rules.js`)
Classic (5:00 vs 7 bots) · Quick (2:00, growth constant k 16 -> 6) · Free roam (no timer / bots / ranking, End button) · Daily (one seeded setup per Riga calendar day, a daily twist,
**one ranked attempt per browser per day**, practice afterwards; centre map only — on a district map the button is disabled with a note) · Online (written by the multiplayer server only).
The round length always comes from the server (`ROUND_SECONDS` in `MODES`; `CFG.roundSeconds` is the offline default). Bots: 9 are built, the mode activates 0-9.
**Ranking per map:** `CFG.mapsRanked = true`; every ranked round sends `map: CFG.map.slug`. Per-map balance (growth is the same everywhere): see 6.

### 5.3 Anti-cheat (plausibility and friction, not proof — the game runs in the browser)
1. Round token (server-issued, single use, age window 0.9 x round ... round + 10 min). 2. Progress trace (`src/trace.js`, every 10 s of played time) validated by
`worker/lib/validate.js`: slots and total time, monotonic counters, final sample == submitted fields, kind counts, rank <= holes, radius vs score through the shared growth
formula, per-interval gain ceilings by radius band, eaten ceiling, score <= what the eaten kinds can be worth, per-mode cap. 3. **Empirical ceilings per MAP**
(`worker/lib/limits.js`, generated by `node tools/gen-limits.mjs [--maps ...]`: greedy + cluster autoplayers, with and without bots, every mode (daily twists on the centre), the
maxima per map): x2 = suspect (stored, hidden), x3 = reject (422). Re-run for a map after changing its balance. 4. `node tools/check-legit.mjs` plays fresh rounds on every map
through the validator (0 false rejects) plus tampered controls. 5. Rate limits per salted IP-hash, names sanitised + profanity list. Still bypassable: a fabricated consistent trace
within the ceilings, automation of the real client, VPNs, slow clocks. Optional **Turnstile** (off): needs `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY`; loads
`challenges.cloudflare.com` only at submit time and only when enabled (no CSP today). Clean-up of a cheated row: `wrangler d1 execute bedre-scores --remote --command "UPDATE scores SET suspect = 1 WHERE id = 123"` (or DELETE).

### 5.4 Analytics (cookieless, `src/analytics.js`, `worker/lib/analytics.js`, `/stats.html`)
Anonymous allow-listed daily counters (page views, new / returning, device class, language, quality, theme, rounds started / finished per mode, score buckets, PWA, share, lobby, coarse
error types); one beacon per 15 s; `DNT` / `Sec-GPC` => nothing collected; per-IP-hash beacon limit; `GET /api/stats` public unless `STATS_KEY` is set.

### 5.5 Multiplayer (beta, centre map only)
Press **Online** -> open lobby -> countdown (20 s, full room of 12 starts at once) -> synchronised whole-city fly-in and a 5:00 round -> results -> Play again. Server bots (marked
"AI") fill the room to 8 holes; **`MP.botSkill` (0.55) sets their strength** (each bot +-22 % spread; mean ~60 %, best ~73 % of the full-strength bots; tuned with `scripts/mp-bot-bench.mjs`
so a first-time human can finish mid-table; override with the test var `MP_BOT_SKILL`). Results of humans are written to the `online` board by the server (`insertScore`).
`browser (src/net) -> POST /api/mp/join -> MpMatchmaker DO -> MpRoom DO (WebSocket hibernation, 20 Hz sim, 10 Hz snapshots)`; `RoomSim` (pure JS, `worker/mp/sim.js`) is authoritative for
scores, radii, eaten set, duels and ranking; human holes move on the client and are accepted within a speed budget (rubber-band otherwise); static eat claims are validated exactly
against the object table, movers loosely (budgeted). Reconnect with a per-tab session token (15 s grace). Messages: JSON, 2 KB cap, token bucket. Free-plan cost model: lobbies
hibernate; ~190 billed requests per human per round. `MP` in `worker/mp/protocol.js` holds the limits; gameplay numbers come from `src/config.js` so solo and online cannot drift.
Test vars (never in `wrangler.jsonc`): `MP_ROUND_SECONDS`, `MP_LOBBY_SECONDS`, `MP_RESULTS_SECONDS`, `MP_MAX_HUMANS`, `MP_TEST_CLOSE_SPAWN`, `MP_BOT_SKILL`; worker test vars:
`ROUND_SECONDS_OVERRIDE`, `RATE_ROUNDS_PER_HOUR`, `CAP_<MODE>`, `TURNSTILE_VERIFY_URL`.

## 6. Tunables
- `src/config.js` (`CFG`, `LIFE`): round, growth (`radius = 2.2 (1 + score/k)^0.44`, k 16 classic / 6 quick), swallow rule (`reach`, `fitRatio`), duel (`ratio 1.15`, `reach 0.62`, `gain 0.5`), bots
  (`difficulty`, `speedMin/Max/Cap`, roam / hunt parameters), camera, props, ground (`pxPerM` per tier), quality (`LIFE.quality`), radio, `mapsRanked`.
- `tools/maps.mjs` per-map multipliers: `props` (prop and mover density), `value` (building value DIVISOR scale: smaller = more points), `trees`, `people`, `bots` (difficulty), `botSpeed`.
  Targets for a 5:00 round on any map: greedy final radius ~120-160 m, best bot 50-75 % of greedy, >= 80 edible objects within 60 m of every player spawn. Current numbers:
  | map | greedy (no bots) | greedy r | best bot / greedy | spawns < 80 edible |
  | --- | --- | --- | --- | --- |
  | centrs | ~185k | ~133 m | ~70 % | 0 |
  | agenskalns | 158-263k | 135-155 m | 57 % | 0 |
  | mezaparks | ~194k | ~143 m | ~52 % (bots 2.0, speed cap 1.1) | 0 |
  | purvciems | 224-304k | 150-165 m | 52 % | 0 |
- Quality tiers (`quality.js`): `low` / `medium` / `high` pick ground texture density (1.05 / 1.5 / 2.5 px/m), pixel ratio, shadow map, tree shadows, mover fraction, building shapes (low = flat
  boxes), glow / snow / firework detail. The auto scaler steps down after two slow windows, up after four good ones, never oscillates (an up-step that does not hold locks for 60 s).
  Budget: <= ~3.5 M triangles at `high` on every map and cpu < 5 ms / frame; total GPU texture memory <= ~90 MB on the phone tier (66-ish MB measured at `low`).
  CPU-throttle test (`perf-matrix.mjs --throttle --rates ...`, CDP `Emulation.setCPUThrottlingRate`, auto quality, Purvciems): at 4x and 6x the game still holds 60 fps at `high` (no step); at 12x it steps
  high -> medium (6 s) -> low (11 s), tries medium once at 21 s, drops again at 25 s and stays (backoff 60 s, the second failed up-step pins the tier); at 20x high -> medium (11 s) -> low (17 s) and stays.
  Measured with `scripts/perf-matrix.mjs --phones` (1280x720, real GPU, M-series Mac; worst of the hole radii 9 / 30 / 60 at gameplay zoom; triangles incl. the shadow pass):
  | map | low (tris / calls / cpu ms) | medium | high | iPhone 13 emulation (auto = low tier) | Pixel 5 profile, 4x CPU throttle, `?quality=low` | ground texture MB (low / medium / high) |
  | --- | --- | --- | --- | --- | --- | --- |
  | centrs | 1.14M / 734 / 2.7 | 1.17M / 734 / 3.0 | 1.21M / 734 / 3.4 | 0.98M / 389 / 2.2 | 0.63M / 329 / 6.9 | 66 / 132 / 329 |
  | agenskalns | 1.07M / 646 / 2.4 | 1.09M / 646 / 2.7 | 1.09M / 646 / 3.1 | 0.93M / 353 / 2.2 | 0.56M / 291 / 6.4 | 54 / 106 / 258 |
  | mezaparks | 1.54M / 523 / 1.8 | 1.55M / 524 / 2.2 | 1.78M / 524 / 2.5 | 1.46M / 346 / 1.8 | 0.71M / 255 / 5.0 | 53 / 105 / 255 |
  | purvciems | 1.66M / 594 / 2.5 | 1.86M / 689 / 3.1 | 2.02M / 647 / 3.4 | 1.73M / 395 / 2.2 | 1.11M / 280 / 6.5 | 54 / 106 / 258 |
  Purvciems used to render 5.9 M triangles at `high`: every instance of every static prop was submitted each frame (only trees were chunked for frustum culling). All static props are now
  chunked into 250 m cells, one geometry per kind is shared by the chunks, the person model went from 168 to 90 triangles and car wheels from 8 to 6 sides.
- Themes: `THEME_TUNE` and `LOOKS` in `theme.js` (fireworks, sunset offset, looks). While fireworks are in the sky the camera eases pitch / zoom (`cam.ease`), the round-end finale gets a wider shot.
- Multiplayer: `MP` (`botSkill`, `totalHoles`, lobby / round seconds, speed tolerance, claim budgets).

## 7. Known limits
- The anti-cheat is plausibility checking; a determined cheater can fabricate a consistent submission. Calibration comes from autoplayers, not humans (x2 / x3 are the margin).
- District maps have fewer leaderboard entries by nature; their limits come from ~24 autoplayer rounds each. Re-run `gen-limits` for a map after tuning it.
- The greedy autoplayer is deterministic per spawn; the real spread between players is larger than the balance table suggests.
- Online is centre-only and a beta: one matchmaker DO, no spectators, a deploy ends running rounds, mover claims are only loosely validated.
- Pasažieru osta is not in the municipal / OSM data used here, so it is not a landmark. Z-Towers' height / shape comes from the measured shapes agent's data, not from OSM.
- The radio depends on LSM's public stream; Chrome / Safari play HLS natively (checked: `scripts/check-radio.mjs`), other browsers use the bundled hls.js; no network = a quiet "stream unavailable".
- Fireworks need the evening look; at the steep gameplay camera they are only visible during the eased camera moments (a deliberate, small compromise).
- Phones are tested through emulation (iPhone 13, Pixel 5 profile with CPU throttling) and CDP, not on real devices.
