# BEDRE — Rīga

An original 3D browser arcade game: steer a hole around a real 3D map of Riga, swallow things smaller than you, grow, and
swallow bigger things. 5-minute rounds with 7 AI opponents ("bedre" = pit in Latvian). Four maps (Centre + three districts),
five themes, four game modes, global per-map leaderboards, an online multiplayer beta, an album / achievements / recap layer and a
PWA shell. Vite + vanilla JS ES modules + three.js client; a Cloudflare Worker (static assets + D1 + Durable Objects) as backend.
Live at https://bedre.pakers.lv. No physics engine, no framework, no assets (everything is generated), no third-party scripts.

Contents: 1 Quick start · 2 Play, test, deploy · 3 Architecture map · 4 Data pipeline and credits · 5 Backend (API, modes, anti-cheat,
analytics, multiplayer, **5.7 combos + power-ups = scoring rules 2**) · 6 Tunables · 7 Known limits

---

## 1. Quick start

```
npm install
npm run dev          # http://localhost:5173  (Vite; /api is proxied to `npm run dev:worker` on :8791 when you run that too)
npm run build        # production build into dist/  (first checks that the placement files are fresh, see 2.3 / 4)
npm run smoke        # headless Playwright game test + screenshots in scripts/out/   (GPU=1 = real GPU through Metal/ANGLE)
```

Needs Node 20+. `npm run dev:worker` builds, applies the local D1 migrations and runs `wrangler dev` on :8791 (the full stack locally).

## 2. Play, test, deploy

### 2.1 Controls and URL parameters
Mouse or WASD / arrows to move; wheel zooms; Esc pauses; M mutes. **Phones:** touch anywhere on the play area and drag: a soft joystick base appears under the thumb and the hole steers by the thumb's offset (direction + analogue speed; past the radius the base follows; releasing keeps a little momentum). Advanced offers the old "hole follows the finger" scheme, 3 sensitivity steps, a left-handed layout (button column mirrored), vibration + ring pulse, a 30 fps battery saver and (Android) fullscreen; all remembered. A second finger pinches to zoom without a steering jump, double-tap toggles normal / wide view. `?inset=top,right,bottom,left` (px) emulates a notch / home indicator for tests.
`?autostart=1` skip the start screen · `?intro=0` skip the fly-in · `?introhold=S` linger on the overview · `?map=centrs|agenskalns|mezaparks|purvciems`
· `?mode=classic|quick|daily|free` · `?difficulty=easy|normal|hard` (bot strength, default Easy, remembered) · `?theme=day|evening|winter|winter-evening|nov18|ligo|auto` · `?quality=low|medium|high` (pins the tier, disables the
auto scaler; the start screen's Graphics choice is remembered and applied on the next load) · `?lang` is remembered from the switch · `?radio=0|1` · `?sw=1|0` service worker · debug that makes a round **unranked**:
`?time=30` (local round length), `?bots=N` (N != 7), `?sample=1` (procedural city), any `window.__game` hook that changes the round.

### 2.2 Tests (headless Chromium; `smoke:engines` also WebKit + Firefox; `GPU=1` = real GPU, omit for SwiftShader)
| command | what it covers | port |
| --- | --- | --- |
| `PORT=5186 GPU=1 npm run smoke [-- --sample]` (`MAP=<slug>` for a district) | gameplay, bots, duels, results, intro, zoom, balance curve, **combos + power-ups** (a chain multiplies points but not the radius, expiry, seeded schedule + respawn, each effect + its expiry, shield vs a bigger hole, bots collect pickups, daily = same sequence, trace v2, best combo in the results) | PORT |
| `PORT=5187 GPU=1 npm run smoke:world [-- --sample]` | traffic, audio, particles, landmarks, labels, perf | PORT |
| `API_PORT=8796 npm run smoke:api` | worker API on a local wrangler: modes, per-map boards, migrations (fresh + upgrade from EVERY earlier schema 0001..0005 -> 0006), scoring-rules boards (current / `?archive=1`, stale v1 trace -> archive), validator (trace v1 + v2: inflated multiplier, impossible pickups, combo longer than eaten ...), rate limits, Turnstile mock, analytics | API_PORT |
| `E2E_PORT=8797 GPU=1 npm run smoke:e2e` | built game + worker: server round length, submit, boards, tamper rejected, daily, district ranking + map switch, results | E2E_PORT |
| `npm run test:mp` / `GPU=1 npm run smoke:mp` | multiplayer: pure-Node sim/validator/bots/CPU bench + combos (chain, expiry, 300 ms-latency clock, forged timestamps / multipliers) + power-ups (same seed same layout, race = one winner, speed budget, magnet reach, shield vs kill, double x combo cap, bots) / full end-to-end on wrangler :8793 (`MP_PORT=<n>` for another port + own build/state dirs; `--fx-only` runs just the second phase: 3 browsers (one behind a 300 ms-each-way lag proxy, `scripts/lib/tcp-proxy.mjs delay()`) + a protocol bot on a server with `MP_TEST_PU` / `MP_TEST_START_MASS` / `MP_TEST_FX_SCALE`: same pickups for everybody, one winner, server-applied effects, forged pickup / multiplier / speed rejected, shield vs a big hole, reconnect mid-effect, a laggy player keeps combos), followed by `smoke:engines` (also compares the pickups across engines) | 8793 |
| `GPU=1 npm run smoke:resume` | online session resume + REAL network outages (TCP proxy cut / stall 3-60 s) + 12-client room + human-vs-human kill + mover double claim, on WebKit iPhone 13 / SE and Chromium Pixel 5 against a local wrangler (`RS_PORT`, default 8794; proxies on the next ports) | 8794-8800 |
| `GPU=1 npm run smoke:friends` (`FR_PORT`, default 8793; `--no-browsers`, `--skip-build`) | **friend rooms + skins end to end** on a local wrangler with short rounds: HTTP (create / lookup / bad codes / same-origin / public matchmaking never sees a private room and the other way round), protocol (host-only controls, no countdown, bots on / off, skin ids validated + relayed, late arrival waits, 12 humans max, old protocol refused with `sv`, ranked only with >= 2 humans + the standard length (leaderboard rows checked), rematch, host migration, reconnect, expired code), browsers (Chromium host, WebKit iPhone 13 guest by LINK, Firefox guest by CODE: create -> link -> lobby -> Start -> identical results -> Rematch -> host leaves; rendered rim parameters of the peers = what they equipped; reload mid-round resumes; expired link dialog; another live session prompt; stale-protocol reload offer; LV) and rate limits (second server with small limits); screenshots `scripts/out/f45-*.png` | FR_PORT |
| `node scripts/test-f45.mjs` (also part of `npm run test:mp`) / `[GPU=1] [SHOTS_PORT=5187] node scripts/f45-shots.mjs` | pure tests of the code alphabet (30 bits, unbiased), hello / frame validation, skin id ranges, the level curve + XP rules (no XP in free roam / debug rounds), unlock mapping from reward ids (past + future weeks) / screenshots of six skins (day + evening, desktop + WebKit iPhone 13), trails, wardrobe, level badge, level-up | SHOTS_PORT |
| `npm run smoke:layout` / `npm run check:spawns` | generic layout audit (HUD vs panels, tags vs HUD, tap targets, results fit) on 12 viewports x LV/EN (`LAYOUT_URL=<built client>`) / online start-point fairness of `RoomSim.pickHumanSpawns` | - |
| `GPU=1 [ENG_PORT=8798] npm run smoke:engines [-- --static-only \| --rooms-only \| --stale-only] [--fix]` | **cross-engine**: Chromium / WebKit (iPhone 13 profile) / Firefox build identical worlds on all 4 maps (full per-id dump compare, placement hash, solo Play, no console errors, missing/stale-file fallback); Chromium+WebKit and Chromium+Firefox in ONE online room (same ids, eaten objects vanish for the other engine, same ranking); stale tab after a deploy recovers (also with the service worker) | ENG_PORT 8798, vite 5185 |
| `npm run check:legit` | fresh autoplayer rounds on EVERY map + all modes through the validator (trace v2): 0 false rejects / 0 suspect expected; tampered controls must be flagged (incl. inflated multiplier, impossible power-up count / burst, combo longer than eaten, radius following the points) | 5191 |
| `[GPU=1] [SHOTS_PORT=5187] node scripts/combo-shots.mjs` | screenshots of the combo chip at every step, each token on the street, badges + toast, magnet pull, minimap dots, results with the best combo, Top scores current / Archive: desktop + real WebKit iPhone 13 -> `scripts/out/combo-*.png`, `powerup-*.png` (the online round ones come from `smoke:mp`) | SHOTS_PORT |
| `PORT=5188 GPU=1 node scripts/smoke-meta.mjs` | album, achievements, % meter, recap, share card, PWA, radio, daily streak, weekly goals, rewards (5.6) | PORT |
| `PORT=5187 GPU=1 node scripts/smoke-theme.mjs` | themes, clock auto-selection, fireworks, per-theme frame cost | PORT |
| `PORT=5185 GPU=1 node scripts/final-shots.mjs` | UI shots, pause / resize / touch / leak checks (geometry compared across replays after a warm-up round) | PORT |
| `MATRIX_PORT=5188 GPU=1 node scripts/smoke-matrix.mjs` | ~24 combinations of map x theme x mode x quality (+ LV/EN, phone, landscape): no errors, HUD nodes do not overlap, score rises, results render, Play again works; `scripts/out/matrix-*.png` + `matrix-contact-sheet.png` | MATRIX_PORT |
| `PERF_PORT=5189 GPU=1 node scripts/perf-matrix.mjs [--phones] [--breakdown] [--throttle]` | draw calls / triangles / cpu ms / texture MB per map x tier; emulated iPhone 13 and low-end Android; CPU-throttle test of the quality scaler | PERF_PORT |
| `node scripts/check-radio.mjs [--hlsjs]` | real playback of Latvijas Radio 2 (soft check without network) | RADIO_PORT |
| `MAP=<slug> PORT=5188 GPU=1 node scripts/balance.mjs`, `SPAWN_PORT=5190 GPU=1 node scripts/spawn-check.mjs`, `node scripts/mp-bot-bench.mjs` | per-map balance, spawn richness (>= 80 edible things within 60 m), server-bot strength | |
| `MOBILE_PORT=5184 [GPU=1] npm run smoke:mobile [-- --skip-round] [--only <config>] [--group <name>] [--memory [--maps ...]]` | **phones on real WebKit** (iPhone 13, iPhone SE) **and Chromium/Pixel 5**, portrait + landscape, real touch (CDP multi-touch on Chromium; real taps + synthetic pointer sequences on WebKit): joystick in 8 directions + analogue speed, finger-follow, pinch without steering jump, HUD vs steering, free thumb zones, safe-area emulation, >= 80 % HUD-free, chips, haptics (Android) / absent (iOS), wake lock, orientation flip, hidden -> resume countdown, first-visit Quick vs stored mode, Turnstile widget failure + retry, battery saver, a whole 2:00 Quick round without a reload; `--memory` plays a 2:00 round on every map on WebKit and prints low-tier texture MB; screenshots `scripts/out/mobile-*.png` | MOBILE_PORT |
| `node scripts/measure-load.mjs before=<dist> after=<dist> [--runs 3]` | first-play transfer (brotli, like Cloudflare) and time-to-playable on a throttled Fast 4G profile | MEASURE_PORT 5195 |
| `scripts/ui-shots.mjs <scenario...>` | ad-hoc UI screenshots against a running Vite server (`PORT`, default 5187) | |

Dev/test hooks (`window.__game`): `state`, `hole`, `start()`, `skipIntro()`, `teleport`, `setRadius`, `step(s)`, `autoplay(s)`, `holes`, `leaderboard()`,
`teleportHole`, `setHoleRadius`, `botCount`, `overlay`, `cam` ... Other hooks: `__life` (audio, quality, world, theme), `__theme`, `__modes`, `__meta`,
`__radio`, `__online`, `__ui`, `__trace()`. They mark a round unranked and, for the meta layer, **a round flagged unranked by a debug hook never unlocks
album entries / achievements** (set `window.__metaAllowDebug = true` in tests that need them). Generated folders (`dist`, `scripts/.dist*`,
`scripts/out`, `.wrangler`, `tools/.cache`) are git-ignored.

### 2.3 Deploy
One-time: `npx wrangler login`, `npx wrangler d1 create bedre-scores`, put the printed id into `wrangler.jsonc` -> `d1_databases[0].database_id`.
Then `npm run deploy` = `build:mp` (generate the placement files from the real world, section 4) -> `check-objects` -> `vite build` -> `check-objects --dist dist` (built client carries the same files + ids) ->
`wrangler d1 migrations apply bedre-scores --remote` (0001..0005, all additive) -> `wrangler deploy`. Check without deploying: `npx wrangler deploy --dry-run`.

* **Placement-file guard.** `public/data/**/riga-objects.bin.gz` (+ `placements.json`, `placements.stamp.json`) must come from the same world code + map data as the client
  (else props differ between browsers / online refuses everybody). The stamp fingerprints the sources per map; `npm run build` runs `tools/mp/check-objects.mjs --fix` (regenerates when
  stale, fails loudly when it cannot, `SKIP_MP_CHECK=1` bypasses) and afterwards `--dist dist` (the built client has the same files and the same content ids baked in); `npm run deploy` and
  `smoke:mp` check it too. `npm run build:web` is the bare `vite build`. **Release order: `GPU=1 npm run build:mp` -> `node tools/mp/check-objects.mjs` -> client build -> deploy** (`npm run deploy` does exactly this).
* **Release checklist (client changes):** `npm run check:sights` (every sight differs from an apartment block, 0 failures in tier A / B) · `node tools/detail/roof-report.mjs --map=<slug>` (0 violations) · `npm run build` · `npx wrangler deploy --dry-run` · `PORT=.. GPU=1 npm run smoke` (+ `-- --sample`, + `MAP=` each district) · `npm run smoke:world` · `npm run smoke:api` · `GPU=1 npm run smoke:e2e` · `npm run test:mp` + `GPU=1 npm run smoke:mp` · `npm run check:legit` · `node scripts/smoke-meta.mjs` · `node scripts/smoke-matrix.mjs` (24/24) · **`GPU=1 npm run smoke:mobile`** (phones: real WebKit iPhone 13 / SE + Chromium Pixel 5; never replace this by an "iPhone" profile on Chromium) · then the five-minute phone run in `docs/mobile-test-checklist.md` (haptics, thumb feel, Safari memory, audio interruptions cannot be automated).
* Migrations are never edited once applied; the next one is `0007_...`. `0006_rules.sql` adds the nullable `scores.rules` (scoring rules generation, 5.7). `0004_maps.sql` adds `rounds.map` / `scores.map` (default `centrs`) + indexes; `0005_difficulty.sql` adds the nullable informational `scores.difficulty` tag (easy | normal | hard; NULL for old and online rows). **Apply 0005 and 0006 before deploying this worker** (`npm run deploy` already does: migrations first, then `wrangler deploy`), the INSERT names the new columns. **Releasing combos + power-ups restarts the leaderboards** (old and new points are not comparable; old rows stay under "Arhīvs / Archive"), bumps `PROTOCOL_VERSION` to 3 (a deploy ends running rooms; stale tabs get the usual "new version - reload" message) and changes the trace to v2.
* A Worker deploy restarts running multiplayer rooms (a round in progress is lost); the Durable Object migration tag `mp-v1` is never reused.
* Optional: Cloudflare Turnstile and `STATS_KEY` (5.5). Privacy: only the chosen display name + score stats + the anti-cheat trace are stored; no cookies.

### 2.4 Prototype: Tramvaja vadītājs (`/tramvajs/`)

A small tram-driving game on the real tracks of Riga (city centre + the Mežaparks end of line 11) built on the same world (`src/proto/shared/street-world.js` boots the engine's world
without the hole game). Own second Vite entry (`tramvajs/index.html`), own code in `src/proto/tram/`, no backend. Docs: `docs/proto/tram.md` (routes, systems, tunables, what is cut);
`npm run smoke:tram` (builds into `scripts/.dist-tram`, previews on 5193; `GPU=1`, `ONLY=`, `FAST=1`); routes are generated by `node src/proto/tram/tools/build-route.mjs`. The old prototype
"Kur es esmu?" (`/kur/`) was removed: that path now serves the main game and redirects to `/` (script injected into the main `index.html` by `vite.config.js`).

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
**Phones** — `mobile.js` (device detection, remembered touch prefs, haptics, wake lock, fullscreen, Add-to-Home-Screen + battery hints, `touch` / `tui` body classes, `?inset=` emulation), `mobile.css` (the phone layout: chips, lanes, thumb zones, safe areas), `mobileUi.js` (leaderboard / minimap chips, Advanced touch options), `input.js` (floating joystick, pinch, double-tap), `camera.js` (aspect-continuous portrait / landscape tuning), `loadProgress.js` (one byte-accurate loading bar; `vite.config.js` `dataPreload` starts the map files downloading from `<head>`).
**Life and feel** — `life.js`, `events.js` (bus), `effects.js`, `audio.js` (procedural WebAudio + mute button), `quality.js` (auto scaler).
**Themes** — `theme.js` (+ `sky.js`, `glow.js`, `snow.js`, `flags.js`, `fireworks.js`, `themeUniforms.js`).
**Meta** (`src/meta/`, passive observers of the bus) — `progress.js` (% of Riga meter, area banner, toasts, My progress panel, recap), `album.js`, `achievements.js`,
`districts-names.js`, `recap.js`, `share.js`, `radio.js` (bundled hls.js, dynamic import), `pwa.js`, `store.js`, `strings.js`; retention: `streak.js`, `goalPool.js`, `goals.js`, `rewards.js`, `retention.js`, `clock.js` (see 5.6).
**Multiplayer client** (`src/net/`) — `client.js`, `online.js`, `ui.js`, `friends.js` (friend-room DOM), `net.css`; placement files: `src/placements.js` (loader + generator dump), `worker/mp/table.js` (format, shared with the Worker), `tools/mp/` (build / check / fingerprint). **Worker** (`worker/`) — `index.js` API, `lib/*` (db, validate, limits, moderation,
analytics, turnstile), `mp/*` (Durable Objects + authoritative sim).

### 3.1 UI layout system
**Phone layout (`body.tui` = coarse pointer + compact media query, `src/mobile.css`).** Top row: score card (the "% of Rīga" chip lives inside it) | timer (always visible) | leaderboard chip ("3. · 1 240 · −180": rank, points, gap to the player above or lead over the next; tap expands the top 3 + you, auto-collapses after 5 s or on a tap elsewhere). Under it, left a 52 px round minimap chip (tap expands, tap again / outside shrinks), right the round buttons (mirrored by the left-handed option). Bottom: only a slim size bar, so both bottom corners (>= 96 px) stay free for the thumbs. Kill feed, landmark label, area banner and toasts each have one lane under the top row, centred between the side columns. All insets come from `--sat/--sar/--sab/--sal` (`env(safe-area-inset-*)`). Measured HUD-free area: 86-89 % in portrait (360x640: 87.7 %). The camera puts the hole ~60 % down in portrait (centred in landscape) and widens / flattens continuously with the aspect ratio.
`src/style.css` positions every HUD piece from a few variables (`--gap`, `--btn`). Two layouts: **wide** (> 900 px and > 520 px high: score card top-left, timer top-centre
with the round buttons next to it, leaderboard top-right, minimap bottom-right, size bar bottom-centre) and **compact** (phones, small tablets, short landscape windows:
score card + `% of Riga` chip + kill feed in the left column, timer centre, top-3 + you leaderboard right, minimap bottom-left, the three round buttons (radio, sound,
pause; 44 px touch targets) in a column bottom-right, full-width size bar, attribution under it; banners / labels / swallowed overlay each own a vertical lane; toasts are
capped at 2 visible with a queue and are suppressed while the results are up). Menu and results screens put sound + radio in the bottom-right corner and keep it
free. `scripts/smoke-matrix.mjs` bounding-box-tests the key nodes on desktop, 360x640, 390x780, 430x932 and 780x390. The start screen is one calm column: logo, one line of blurb, name, Play, Online (beta, secondary), one collapsed **"Advanced"** row (a disclosure button with `aria-expanded`; open state is remembered for the session only) and a quiet footer (My progress, Top scores, About, LV/EN, credits). Advanced holds game mode (+ description), difficulty, district, theme and graphics (Auto / Low / Medium / High); a slate chip next to the label names every choice that differs from the defaults (`Quick · Hard · Purvciems · Evening`), the Play button names a non-default mode ("Play — Quick"), and a small terracotta dot on the row / the Daily button shows that today's daily challenge is still unplayed. Defaults: Classic, Easy, Centre, Auto theme, Auto graphics. Panels scroll internally when Advanced is open on small screens; the results panel has Result / Map / Progress tabs with Play again always visible.

## 4. Data pipeline and credits

Centre map data: `node tools/build-data.mjs && node tools/surface/fetch-ortho.mjs && node tools/surface/build-ground.mjs` (+ `node tools/preview.mjs`).
Districts: `--map <slug>` on each tool; per-map folders `public/data/<slug>/{riga.json,riga-ground.png,thumb.png,riga-shapes.bin.gz}`; the centre keeps the legacy flat paths.
Building shapes: `cd tools/detail && npm i && node build-meshes.mjs` (measured height grids from the municipality's reality model + OSM building parts -> plane-fitted
roofs, ~25 curated heroes in `tools/detail/heroes.mjs`, `BSH1` file format in `tools/detail/README.md`; the Art Museum and Art Academy are parametric `curated.mjs` heroes; one roof colour per building, accents only on whole spires / domes, asserted by `node tools/detail/roof-report.mjs`). Neighbourhoods: `node tools/meta/areas.mjs`
(municipal *Apkaimes*; official Latvian names are shown in both languages, "Old Town" only as an English subtitle of Vecrīga). PWA icons / og image: `tools/meta/`.

### 4.0a Map review fixes (2026-11, `tools/mapfix/`, review in `docs/qa/map-review.md`)
The reality-mesh review (full 1 m height rasters per map, `tools/qa-map/`) is turned into data by a deterministic post-process of `riga.json`, `riga-ground.png` and the shapes (re-run all of it: `tools/mapfix/run-all.sh`; it restores the pre-fix data from the local backup `tools/.cache/mapfix-before`, then runs the steps below and `GPU=1 npm run build:mp` (use `MP_TABLE_PORT=5183`: another server on 5186 silently gives stale placement files)):
* `tools/mapfix/trees.mjs` — **canopy**: ground class raster gets canopy (2) / **dense forest (10, Mežaparks)** where the mesh shows tree-like volume (>= 3 m above local ground, rough) outside buildings, carriageways, rails / trams, plazas and water; `riga.json` `trees` gains street / yard / park crowns from mesh peaks (`[x, z, crownHeightM, pine?]`, spacing 8-14 m, 17 k / 15 k extra on the Centre / Āgenskalns, budget = placement-file size); the 11 m synthetic scatter of Mežaparks is dropped. `src/scatter.js` turns class-10 cells into **dense pines** (`tree2`, ~86 % pines, spacing stretched so the 28 k budget covers the whole forest; the trace key stays `tree`). Pine = 28 triangles (16 on the phone tier), broadleaf tree 70 (30 on the phone tier). Class 9 = running track.
* `tools/mapfix/buildings.mjs` — rules from the mesh (cover >= 50 %): **phantoms** (rendered >= 6 m, mesh mean <= 2.5 m and median <= 1.5 m) become 3 m sheds (aux) or are dropped; **flat slabs** (>= 800 m^2, mesh p90 < 2 m) and **park plates** (aux >= 2000 m^2, < 35 % of its cells >= 3 m) are dropped and the freed footprint is painted with the neighbouring ground class (tennis courts: gravel); **under-rendered aux podiums** take the mesh height; the **Daugava stadium** is removed and painted as pitch (lawn) + 7 m running track; **missing buildings** (mesh volumes without footprint) are added when OSM has a footprint (ids 51e9 + OSM way id). Items the reviewer marked "date?" (Heart of Hanza, Atea, Strēlnieku 4C) and anything with OSM `start_date >= 2019` / `building=construction` keep their height. Report: `tools/.cache/mapfix/buildings-<map>.json`.
* `tools/detail/build-meshes.mjs` — **spike filter** (`despike`) in the meshing step: groups of cells above `base + max(6 m, 0.6 base)` that are thin (<= 2.5 m, not vertical-sided = mast / wedge) or rough crowns (tree / crane / noise) and small relative to the footprint are replaced by the surrounding roof; smooth vertical shafts (chimneys) and tier A / B sights keep their peaks; small / medium buildings whose footprint is mostly rough tall cells are not shaped (flat extrusion from the cadastre height); `CLIP_TOP` for known artefacts (Rīgas pils 33 m).
* `src/buildings.js` `zoneRoof` — roof mix per neighbourhood of the Centre map (Old Town: 90 % of the pitched roofs keep clay tile, 8 % grey zinc, 2 % verdigris, rendered area share red / grey / green 48.5 / 44 / 7.5 -> 47 / 45 / 8 %; surrounding centre grid 18 / 74 / 8 of the pitched roofs, rendered 37 / 48.5 / 14 -> 13 / 72 / 15 %; districts unchanged), measured with `tools/mapfix/roofshare.mjs`; landmark palettes / shapes: `tools/detail/heroes*.mjs`, `src/sights.js` `TREAT_A` (+ `dome R`, `tent` features in `src/sightFeatures.js`).
* `src/ground.js` `buildSkirt` — beyond the playable box the tan slab is replaced by a mirrored, hazed copy of the edge ground (class raster reflected, 700 m, 16 / 6 / 4 m per pixel on low / medium / high) with a pale boundary band, plus a merged non-swallowable mirrored building mass (medium / high, <= 47 k triangles, <= 6.6 MB texture on high).
* Spawns (`src/placements.js`, `src/spawn.js`): trees no longer count as spawn food and a start needs >= 450 building value within 130 m, so a start deep in the forest is impossible.
Review checks: `QA_DIR=tools/.cache/qa-map-after node scripts/qa-map/dump-game.mjs` (vite on :5188) then `node tools/qa-map/buildings.mjs <map>`, `missing.mjs <map>`, `node tools/qa-map/recheck.mjs` (before -> after table). Evidence images: `scripts/out/mapfix-*.png` (`scripts/mapfix/shot.mjs`, `tools/mapfix/sheet.mjs`; the reference imagery stays in `tools/.cache/qa-map`).

### 4.0 Sights: every important building looks different from an apartment block (`src/sights.js`, `tools/detail/sights.mjs`)
Owner rule: simplified is fine, but every important sight and building must be clearly distinguishable from ordinary apartment blocks at normal gameplay zoom, not only churches.
* **List** (`node tools/detail/sights.mjs [--map=<slug>]`, `npm run build:sights`): per map, generously and automatically from the album rules (`src/meta/album.js`), `riga.json` `landmarks`, OSM names and tags
  (cached downloads `tools/.cache/osm_buildings*.json`, `osm_misc*.json`, plus `tools/detail/fetch-osm-sights.mjs` -> `osm_sights_<slug>.json`: sight-tagged buildings whatever their name / height; polite Overpass, cached),
  cadastre type `pub` / `rel` and every non-residential building >= 30 m. Multi-piece buildings are ONE sight (all cadastre pieces listed, lead piece first; the pieces stay separate swallowable objects, no object count changes).
  Output: `tools/detail/data/sights-<map>.json` (full), `public/data/<map>/sights.json` (compact, what the game loads: `id -> [category, tier, lead, tier-A key, feature hint, piece]`), `tools/detail/audit-sights.md` (readable list + tier A verdicts).
  Residential blocks are never sights (a tall slab is housing), named shops / petrol stations / housing complexes are dropped (counted in the script output).
* **Categories** (church, theatre / culture, museum, school / university, hospital, government / embassy, station / transport, market / retail, hotel, tower / high-rise, historic house / guild / gate, castle / fortification,
  sports, industrial / chimney, monument, other public, wooden house) and **tiers** A (city icon) / B (notable) / C (minor public building).
* **Treatment** (`src/sights.js` `CATS`, `TIER_A`, `TREAT_A`, applied by `src/buildings.js`; features in `src/sightFeatures.js`): per category a facade style (window pattern: institutional ribbon windows + base band, blind monumental walls with a glazed foyer, stone slits,
  historic plaster with trim, plus the existing glass / hall / brick / timber / palace / round-arch styles), a wall + roof palette outside the housing palette, and ONE signature feature on the lead piece (portico, canopy, fly tower, roof cross, flagpole, clock tower,
  glazed ridge lantern, crown, bell-cote, gables, round towers, masts, chimney, water tower, porch ...). Tier A entries override per building (colours, features, style). A curated hero's own palette is kept unless both of its colours are ordinary housing colours
  (then the roof takes the category roof). Works for shaped (measured) and flat-extruded buildings and in the `low` quality tier (the flat variant gets the same colours, style and features). Ordinary buildings keep their looks (the rng draws of `buildBuildings` are unchanged).
* **Gate** (`npm run check:sights`, `node tools/detail/sights-report.mjs [--map=<slug>]`, exit 1 on violations): a sight FAILS when it renders with facade style 0, or its wall AND roof colour are both inside the housing palette (CIE76 dE < 13 to the nearest ordinary housing colour,
  `src/sights.js` `HOUSING`), or it is a plain flat-roofed box without a signature feature. Tier A / B must have 0 failures, tier C needs a non-apartment style and a category colour. It prints per map: total, failing before (record only) -> after (record + treatment).
* **Add a sight**: add a `TIER_A` row (ids or name regexp or a point) and a `TREAT_A` override in `src/sights.js`, run `npm run build:sights`, `npm run check:sights`, then `GPU=1 npm run build:mp` (the placement fingerprints cover `sights.json`, `src/sights.js`, `src/sightFeatures.js`). Anything else with an OSM tag from the list is picked up automatically.
* Review shots: `PORT=5185 GPU=1 node scripts/sights-shots.mjs --prefix=after-` (`MAP=`, `THEME=evening`, `QUALITY=low`, `TIERS=A`, `ONLY=<key|lead id>`, `--close` free-camera view, `--overview` N/E/S/W obliques), then `--sheet` (contact sheets `scripts/out/sights-sheet-<map>-<n>.png`, one gameplay-zoom tile per sight with its name and a marker) and `--pairs --slugs=<keys>` (before / after).

`public/data/riga.json`: `meta{name,origin,bounds}`, `buildings[{id,p,h,t,n?}]`, `roads[{p,w,k,sw,s,l,br,ow,f}]`, `water[{p,h?}]`, `parks`, `trees`, `landmarks[{n,x,z,h}]`, optional
`areas`, `crossings`, `tramways`, `stops`, `piers`. Landmarks are matched to the building that contains them (renamed + score bonus); Z-Towers is added from its address.
Maps (`tools/maps.mjs`): `centrs` (3300 x 2700 m), `agenskalns`, `mezaparks`, `purvciems` (2600 x 2600 m each) with per-map multipliers
(`props, value, trees, people, bots, botSpeed`).

### 4.1 Placement files (one source of truth for every swallowable object)
The world is NOT identical across JS engines when it is computed at runtime: **root causes found** (measured on the live site: Chromium 20,896 objects / WebKit 20,891 / Firefox 20,843) were
(1) `cand.sort(() => rng() - 0.5)` in `src/riga.js` (Old Town square seeds): an inconsistent comparator, V8 / JavaScriptCore / SpiderMonkey call it in different orders and shuffle differently, so
the café terraces, parasols, stalls, scooters, lanterns and a few pedestrians differ (with that line fixed all three engines build 20,917 objects with identical kinds); and (2) building
fit radii (`minBox` in `src/geo.js` picks the minimum-area box with `Math.hypot`, which is not correctly rounded and differs by an ulp between engines, so ~80 buildings with near-tied boxes get a
different box, up to 0.47 m of fit). Everything else (movers, scatter, trees) matched. Instead of chasing float differences, the object set is **data**:
`tools/mp/build-objects.mjs` (`npm run build:mp`, needs Chromium + WebGL: `GPU=1`) opens each map with `?placements=generate` (= the old procedural scatter / movers / building code, unchanged, in
Chromium), and writes `public/data/riga-objects.bin.gz` (centre) / `public/data/<slug>/riga-objects.bin.gz` for all four maps (format: `worker/mp/table.js`: buildings first in riga.json order, then
props / movers in id order; per object kind, position (1/16 m), fit, value, yaw, scale, tint; per mover its route (road index, segment, direction, offset, speed); spawn candidates) plus
`public/data/placements.json` (content id = FNV hash of the file bytes, object counts, sizes) and `placements.stamp.json`. **Every client in every mode builds props and movers from the file**
(`src/world.js`), takes building fit / value from it, and uses the stored spawn point; the procedural scatter is only the generator and the fallback when the file is missing / stale / does not fit the
buildings (then the game is fully playable solo, Online is off with a note). The **Worker's object table is the same file** (centre map, `loadTable` in `worker/mp/room.js` via the ASSETS binding),
and the handshake id is the content hash of its bytes (+ `PROTOCOL_VERSION`): identical bytes -> identical id on every engine, nothing float-based. Sizes (gzip): centre 196 KB, Āgenskalns 257 KB,
Mežaparks 277 KB, Purvciems 368 KB. **Cache safety:** the id is baked into the client bundle (`vite.config.js` `__PLACEMENTS__`), the file is requested as `riga-objects.bin.gz?v=<id>`, the service
worker serves that URL cache-first and never serves an unversioned one stale, `_headers` says `no-cache`; a refused client re-fetches the never-cached `/data/placements.json` and only a genuinely
new release gets "Jauna versija — pārlādēt" (the reload drops the service worker + caches first), otherwise a plain "Tiešsaiste šobrīd nav pieejama". **After changing map data, building shapes,
scatter / prop / traffic code or the maps' multipliers, regenerate: `GPU=1 npm run build:mp`** (the guard fails the build otherwise), then build and deploy the client. Mover *motion* stays per client.

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
- `POST /api/scores {roundId, map?, difficulty?, name, score, eaten, radius, rank, biggest, trace[, turnstile]}` -> `201 {ok,id,name,mode,map,rankAllTime,rankToday,rules}`; 400 bad payload / map mismatch,
  403 unknown / early / expired round, 409 replay, `difficulty` (optional, easy|normal|hard, else 400; the daily challenge is always stored as normal) is an informational tag shown next to the name in Top scores and **never splits a board**, **422 failed plausibility** (token burnt, nothing stored), 429 daily submission cap (classic 60, quick 120, daily 5 per IP-hash).
- `GET /api/scores?mode=classic|quick|daily|online&map=<slug>&period=all|week|day[&day=][&limit=20][&archive=1]` — one board per map x mode (daily / online exist for the centre only; other maps answer empty) **of the current scoring rules** (`rules >= 2`); `archive=1` lists the older generations (5.7).
  Suspect rows are never listed. The Top-scores panel has the mode switch AND a map switch (daily / online lock it to the centre and say so).
- `POST /api/e` analytics beacon, `GET /api/stats?days=30`, `/api/mp/*` multiplayer.

### 5.2 Game modes (`src/modes.js`, `src/daily.js`, `src/rules.js`)
Classic (5:00 vs 7 bots) · Quick (2:00, growth constant k 16 -> 6) · Free roam (no timer / bots / ranking, End button) · Daily (one seeded setup per Riga calendar day, a daily twist,
**one ranked attempt per browser per day**, practice afterwards, **always Normal difficulty** so everybody plays the same setup; centre map only — on a district map the button is disabled with a note) · Online (written by the multiplayer server only).
The round length always comes from the server (`ROUND_SECONDS` in `MODES`; `CFG.roundSeconds` is the offline default). Bots: 9 are built, the mode activates 0-9. **Difficulty** (`DIFFICULTY` in `src/config.js`, chosen under Advanced, `?difficulty=`, remembered): Easy (default) / Normal / Hard, see 6.1.
**Ranking per map:** `CFG.mapsRanked = true`; every ranked round sends `map: CFG.map.slug`. Per-map balance (growth is the same everywhere): see 6.

### 5.3 Anti-cheat (plausibility and friction, not proof — the game runs in the browser)
1. Round token (server-issued, single use, age window 0.9 x round ... round + 10 min). 2. Progress trace (`src/trace.js`, every 10 s of played time) validated by
`worker/lib/validate.js`: slots and total time, monotonic counters, final sample == submitted fields, kind counts, rank <= holes, radius vs score through the shared growth
formula, per-interval gain ceilings by radius band, eaten ceiling, score <= what the eaten kinds can be worth, per-mode cap. 3. **Empirical ceilings per MAP**
(`worker/lib/limits.js`, generated by `node tools/gen-limits.mjs [--maps ...] [--difficulties easy,normal,hard] [--merge-max]`: greedy + cluster autoplayers, with and without bots, every bot difficulty (weaker bots leave the player more food), every mode (daily twists on the centre, Normal), the
maxima per map; release command: `GPU=1 node tools/gen-limits.mjs --runs 8 --merge-max` then `node tools/check-legit.mjs`, which also plays a casual human at every difficulty): x2 = suspect (stored, hidden), x3 = reject (422). Re-run for a map after changing its balance. 4. `node tools/check-legit.mjs` plays fresh rounds on every map
through the validator (0 false rejects) plus tampered controls. 5. Rate limits per salted IP-hash, names sanitised + profanity list. Still bypassable: a fabricated consistent trace
within the ceilings, automation of the real client, VPNs, slow clocks. Optional **Turnstile** (off): needs `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY`; loads
`challenges.cloudflare.com` only at submit time and only when enabled (no CSP today). Clean-up of a cheated row: `wrangler d1 execute bedre-scores --remote --command "UPDATE scores SET suspect = 1 WHERE id = 123"` (or DELETE).

### 5.4 Analytics (cookieless, `src/analytics.js`, `worker/lib/analytics.js`, `/stats.html`)
Anonymous allow-listed daily counters (page views, new / returning, device class, language, quality, theme, rounds started / finished per mode, score buckets, PWA, share, lobby, coarse
error types); one beacon per 15 s; `DNT` / `Sec-GPC` => nothing collected; per-IP-hash beacon limit; `GET /api/stats` public unless `STATS_KEY` is set.

### 5.5 Multiplayer (beta, centre map only)
Press **Online** -> open lobby -> countdown (20 s, full room of 12 starts at once) -> synchronised whole-city fly-in and a 5:00 round -> results -> Play again. Server bots (marked
"AI") fill the room to 8 holes; **`MP.botSkill` (0.38) sets their strength** (each bot +-22 % spread) and **`MP.botHumanGrace` (60 s)** keeps them from hunting humans in the first minute; tuned with `scripts/mp-bot-bench.mjs`
so that a casual human alone against the bots lands in the top 3 of 8 (see 6.1; override with the test vars `MP_BOT_SKILL`, `MP_BOT_GRACE`). Results of humans are written to the `online` board by the server (`insertScore`).
`browser (src/net) -> POST /api/mp/join -> MpMatchmaker DO -> MpRoom DO (WebSocket hibernation, 20 Hz sim, 10 Hz snapshots)`; `RoomSim` (pure JS, `worker/mp/sim.js`) is authoritative for
scores, radii, eaten set, duels and ranking; human holes move on the client and are accepted within a speed budget (rubber-band otherwise); static eat claims are validated exactly
against the object table (= the placement file, section 4.1; the client's handshake id is the hash of the file bytes, so Chromium / WebKit / Firefox players share a room), movers loosely (budgeted). Session resume: the client stores `{room, token, name, placement id, round end}` in sessionStorage AND a short-lived localStorage record (`bedre.mp.session`, expires at the round end + 90 s; iOS can drop a backgrounded tab and its sessionStorage). After a reload / tab eviction the start screen shows "Atgriezties kārtā / Rejoin round" (auto-rejoin after 3 s, "Nē, paldies" dismisses and clears it; if another live tab owns the session it only offers "Pārņemt šeit / Take over here"; the newer tab wins, the older shows "open in another tab" and does not reconnect). Pressing **Online** with a live record rejoins that round instead of queueing for the next one. If the round ended while away the results are shown (the room keeps them for `resultsSeconds`); if the room is gone the player sees "round over" with the last known place. A stale token / room, a changed client version (the server answers `version`: the usual new-version flow) and a player who was away longer than the grace period (`left`) all end in a plain message, never in a silent new lobby.
Absent players: the client pings every 2.5 s and treats >5 s without ANY frame as a dead socket (half-open TCP after a network cut), shows "savienojums pārtrūka — atjauno…" and retries for 42 s; the server marks a socket silent after `MP.silentAfterMs` (10 s) and keeps a disconnected hole for **`MP.removeAfterMs` = 45 s** (it idles and stays edible; tunable, test var `MP_REMOVE_AFTER_MS`). A human still in the arena at the end is ranked normally and saved to the online board. A human who never came back inside the grace period leaves the arena but is **ranked with the score it had** (`left: true` in the final ranking, greyed in the table) and is NOT written to the online leaderboard (did not finish); coming back later only gives them the results. Start points of a room's humans are chosen equally rich (`RoomSim.pickHumanSpawns`: richest density level at which all humans fit >= 110-200 m apart, random inside a +-8 % band): richest/poorest food within 60 m <= 1.07x for <= 5 humans, 1.7x for 12 (was 2.4x / 4.7x); checked by `scripts/spawn-check-online.mjs`. Messages: JSON, 2 KB cap, token bucket. Free-plan cost model: lobbies
hibernate; ~190 billed requests per human per round. `MP` in `worker/mp/protocol.js` holds the limits; gameplay numbers come from `src/config.js` so solo and online cannot drift.
Test vars (never in `wrangler.jsonc`): `MP_ROUND_SECONDS`, `MP_LOBBY_SECONDS`, `MP_RESULTS_SECONDS`, `MP_MAX_HUMANS`, `MP_TEST_CLOSE_SPAWN`, `MP_BOT_SKILL`, `MP_BOT_GRACE`, `MP_REMOVE_AFTER_MS`, `MP_SILENT_AFTER_MS`; worker test vars:
`ROUND_SECONDS_OVERRIDE`, `RATE_ROUNDS_PER_HOUR`, `CAP_<MODE>`, `TURNSTILE_VERIFY_URL`.


### 5.6 Streak, weekly goals and rewards (`src/meta/streak.js`, `goalPool.js`, `goals.js`, `rewards.js`, `retention.js`, `clock.js`)
Device-local retention layer, no backend, no notifications. Observes the event bus only (`swallow`, `holeEaten`, `roundStart/End`, plus optional `comboBest` / `powerupPicked`).
* **Daily streak.** One day counts when an *eligible* round **ends** on it (Riga calendar day, `rigaDay`): Classic, Quick, Daily or online, not free roam, no debug hooks, at least
  `min(60 s, half the round)` played (the achievements' rule). Same day again = nothing; next day = +1; exactly one missed day is covered by a *streak freeze* (spent automatically);
  two or more missed days restart at 1. A freeze is earned at every multiple of 7 (max 2 held). A device clock moved *back* is ignored (no extra day, nothing lost), jumping forward
  again simply continues; time zones do not matter (the day is always Riga time); a round across midnight counts for the day it ends. Milestones 3/7/14/30/60/100 give a toast
  (shown when the next round starts, the lane is hidden under the results panel) and a reward. UI: one chip beside "My progress" on the start screen (flame + days + today tick | goals n/3,
  the two chips are folded into one because the 320x568 card has no spare row), a line on the results screen ("3 dienas pēc kārtas!"), the *Week* tab of the progress panel.
* **Weekly goals.** Each ISO week (Monday 00:00 Riga) three goals (easy, medium, hard) are picked from `POOL` in `goalPool.js` by a seeded permutation per tier that advances one step per week:
  same for every player, no repeats within a cycle, at most one "special" goal (a non-default map or online) per week, never the hard bot difficulty. Templates are data
  (`sw(o, albumEntry, ctx)` counts per swallowed object, `rd(ctx)` reads round numbers; `type` = `sum` | `best` | `days`; `maps` / `modes` restrict where they count). Progress is committed when an
  eligible round ends; a goal that crosses its target mid-round is completed at once (toast, at most one goal toast per 20 s, only on completion or at 50 %). In round: three slim bars under the
  % meter tick on progress. Add a goal = add a `G(...)` row to `POOL` (the smoke test then drives it to completion). Templates with `needs: 'comboBest' | 'powerupPicked'` are offered only once
  that bus event has been seen on the device (`seen` in the store) or `CFG.features.comboBest|combo` / `powerupPicked|powerups` is truthy; the week's three ids are stored when the week is
  first seen, so they never change mid-week. Payloads: `comboBest` = number or `{best|value|n|combo|count}`; each `powerupPicked` counts 1.
* **Storage.** One global (not per map) key `bedre.meta.global.v1`: `{ v:1, streak:{cur,best,last,freezes,frozen[]}, goals:{week,ids[],prog{id:{v|d[],h}},done{id:day},all}, rewards{id:{d,s}}, seen{} }`
  (all access in try/catch; a corrupt value starts empty). Tests inject the clock with `window.__retentionNow = <unix ms>`.
* **Rewards.** `grantReward(id)` (`rewards.js`) records an id once in `rewards` and emits `bus.emit('rewardUnlocked', id, { src, day })`. Ids: `streak-3|7|14|30|60|100`,
  `week-YYYY-WW-easy|medium|hard` (ISO year + week, e.g. `week-2026-47-hard`), `week-YYYY-WW-all` (bonus for all three). They are badges in the progress panel AND unlock skins (5.9, `src/meta/unlock.js`); a skin feature should
  listen to `rewardUnlocked` (new ones) and read `loadG().rewards` (everything earned) and map ids to skins; never grant or delete rewards from anywhere else.
* **Tests.** `PORT=5188 GPU=1 node scripts/smoke-meta.mjs` (checks in `scripts/lib/retention-checks.mjs`: pure rules for any dates, two fresh browsers, real rounds with the injected clock,
  every goal template driven to completion with the game's test hooks, map-data proofs, chip bounding boxes at 320x568 / 390x780 / 1280x720, LV + EN) writes `scripts/out/retention-*.png`.

### 5.7 Combos and power-ups = scoring rules 2 (`src/combo.js`, `src/powerups.js`, `src/powerupView.js`, `worker/mp/powerups.js`)
**Two numbers per hole.** `hole.mass` is the unmultiplied value swallowed (value x the bot growth handicap `gainMul`): it is the ONLY input of the growth formula
(`radius = 2.2 (1 + mass / k)^0.44`, `radiusFromScore(mass)`), of the size bar and of every bot decision (eating rate, hunt value, "leader" / "underdog", the easy rubber band).
`hole.score` is POINTS = mass x combo multiplier x Dubultpunkti (combined cap x5): what the HUD, the ranking, the results, the leaderboards and the trace's `s` show. Pacing, radius and
maps are therefore exactly what they were before combos (verified: with `?pu=0` the greedy autoplayer ends at the very same radius and mass as before, see 6.2). Where the old single number
was split: respawn keeps the same fraction of mass AND points; a duel gives the eater `victim.mass x 0.5` of mass and `victim.score x 0.5` of points (no multiplier on duel gains); the level
bar, bots' brains (`src/bots.js`, `worker/mp/sim.js` BotBrain), `setRadius`, the server's radius / pickRespawn all use the mass; ranking, the kill feed, `insertScore` and `final_mismatch` use points.

**Combo rules** (`COMBO` in `src/combo.js`, shared by the browser, the room simulation and the validator). Every swallow raises a counter by its weight (props 1, valuable monuments 2, buildings
2 / 3 / 4 by fit radius < 7 / < 14 / larger); the counter dies when no swallow lands within the window (1.6 s, +0.011 s per metre of radius beyond 8 m, max 2.6 s); the multiplier is the highest step
reached: **x1 -> x1.2 (5) -> x1.5 (12) -> x2 (25) -> x2.5 (45) -> x3 (70)**, applied to the swallow that raised the counter and every later one while the combo lives. Being swallowed drops it.
Easy bots build their counter 15 % slower (`BOT_COMBO_SCALE`), server bots too (`MP.botComboScale` 0.85); everything else is identical for bots and players.
**Power-ups** (`PU` in `src/powerups.js`): **Magnēts** 6 s: edible non-mover objects within 1.8 x radius (tapering to 1.3 x for a huge hole, `magnetFactor`: a magnet nearly doubles the area a big hole sweeps, which broke the late-game pacing) slide towards the hole (`pullObjects`; the objects it moved go back to their places at the next round, `restoreMoved`); **Ātrums** 6 s: speed x1.5; **Dubultpunkti** 12 s: points x2,
stacks with the combo, combined cap x5; **Vairogs** 8 s: bigger holes cannot swallow you (only the duel rule changes: a shielded hole still cannot swallow bigger ones). One effect per type; the same type
again refreshes the timer. Active pickups: `max(6, round(sqrt(map area) / 250))` (centre 12, districts 10) at fixed candidate points = the placement file's spawn candidates (street points with food and
buildings around them: never water, buildings or dense forest; fallback without a placement file: the picker's street points, thinned); a taken pickup's slot reappears 20-30 s later at another candidate
(>= 160 m away), an uncollected one moves on after 75 s. What a slot shows (place, type) is a pure function of `(seed, slot, how many it showed)` (`PowerupField`): solo uses a random seed per round until the round id arrives and then **the server's round seed** from `POST /api/rounds` (`Game._adoptServerSeed`: the device cannot pick a favourable schedule; `?puseed=N` pins it for tests and makes the round unranked), the **daily challenge uses the daily seed = the same sequence for everybody**, a multiplayer room a seed of its own. Pickups are NOT objects: no ids, not in the placement files
(the placement hash is not affected by them, `node tools/mp/check-objects.mjs`). Free roam has them too (no scoring). `?pu=0` (test hook, makes the round unranked) turns them off.
Pickup odds `PU_WEIGHTS` (magnet 16 %, speed 26 %, double 30 %, shield 28 %; a slot's first pickup cycles through all four). Bots notice a pickup within `BOT_PU` range (+ 4 x radius) with a per-decision chance (easy 12 %, normal 45 %, hard 85 %; server bots 12-57 % by `botSkill`) and detour for it; they collect by touching it
like the player. Visuals: low-poly coin token (own canvas icons) with a ground glow, scaled with the camera distance so it reads from the whole-city zoom, minimap dots, auras (dashed pull ring, shield bubble,
gold ring), speed streaks; HUD: one stack above the player's hole (combo chip with a draining ring, timed badges, pickup toast; below the hole on short landscape screens), "+N" popups of multiplied points in
orange (`.pop.hot`), audio (rising pitch with the counter, a pop on each step, a falling blip when it ends, one sound per pickup type). Results: best combo (count and multiplier). Achievements `combo2`,
`combo3`, `fullkit` (`comboRound` in `src/combo.js`; the usual eligibility: debug rounds never unlock).

**Online (protocol version 3, `worker/mp/protocol.js` has the frame list).** Everything is decided by the server (`worker/mp/sim.js`, `worker/mp/powerups.js`): the room creates a `PowerupField` from the room
seed; clients CLAIM a pickup (`p: [slot..]` in their update frame; the server checks that the slot is live and that the hole's server-known position is within the pickup radius + the latency allowance of the
eat claims; the first valid claim wins, everybody sees `pp` in the next snapshot and the token disappears). Effects live in server milliseconds (`fxUntil`): the speed budget of the anti-speed-hack check is
x1.5 (+0.9 s grace) while Ātrums runs, the claim reach tolerance x1.8 while Magnēts runs, the duel rule skips a shielded victim, Dubultpunkti multiplies in `eat()`. **Combos are computed on the server from the
times claims are accepted**: a claim batch carries `ct` (the client's estimate of the server clock); the server uses it clamped to [receipt - (450 ms + 1.5 x reported RTT, max 1.0 s), receipt] and never backwards, and its timeline may gain at most `COMBO.stampJitter` = 0.35 s on the receipt timeline per batch (a faked RTT with early stamps on long gaps otherwise stretched every combo window by the full allowance; `scripts/test-mp-sim.mjs`), and
grants `COMBO.netSlack` = 0.25 s extra window; a 300 ms-each-way player with +-60 ms jitter keeps every combo (test in `scripts/smoke-mp.mjs`), a client that reports timestamps closer together than it sends claims
is clamped back (`scripts/test-mp-sim.mjs`). A client-sent multiplier / score / effect is never read (the parser drops unknown fields). Acks carry points, mass, combo counter + multiplier and the four remaining
effect times; snapshots carry the effect bitmask of every hole (others draw the shield). Test-only server vars: `MP_TEST_PU`, `MP_TEST_START_MASS`, `MP_TEST_FX_SCALE` (never in `wrangler.jsonc`).

**Scoring version, leaderboards and anti-cheat.** `RULES_VERSION = 2` (`src/combo.js`). Migration `0006_rules.sql` adds the nullable `scores.rules`; every new row carries 2 (client submissions with a v2 trace,
the server-written online rows); `GET /api/scores` answers only `rules >= 2` rows by default (and ranks only among them), `?archive=1` answers the older generations (rows from before the column have NULL =
rules 1). A stale tab that still sends a v1 trace is accepted by the old validator path and stored with `rules = 1`, i.e. into the archive. **The boards effectively restart** (old and new scores are not
comparable; the old rows stay in the table and show under "Arhīvs / Archive" in the Top-scores panel). Trace v2 (`src/trace.js`) per 10 s sample: `s` points, `m` mass, `r` radius, `e`, `k`, `w` raw value swallowed,
`p` points earned by swallows, `c` best combo counter so far, `u` {magnet, speed, double, shield} cumulative pickups. `validateV2` (`worker/lib/validate.js`) adds: radius follows `m`; per interval
`p - p_prev <= (w - w_prev) x min(5, multFor(c) x (Dubultpunkti pickup in this or the two previous intervals ? 2 : 1))`; `s - s_prev <= (p - p_prev) + kills in the interval x killMax`; `c <= 4 x eaten`; pickups <= `maxPickups(slots, t)` and <= `slots + 1` per interval;
`s <= p + kills x killMax`; `m <= w + kills x killMax` and `m <= s`; raw value vs what the eaten kinds can be worth; the old gain / cap ceilings on the points. `worker/lib/limits.js` is format 2 (points ceilings,
radius bands from the mass, per mode best combo and most pickups seen); regenerate it with `GPU=1 node tools/gen-limits.mjs --runs 8 --merge-max` (the autoplayers chase pickups and keep their combos).

### 5.8 Friend rooms = private online rooms (`worker/mp/room.js` `meta.priv`, `worker/mp/index.js`, `src/net/friends.js`)
**Flow.** Start screen: one compact secondary button **"Draugiem / Friends"** on the Online row (hidden on district maps like Online) -> panel "Spēlēt ar draugiem": *Create a room* or type a code. Creating (`POST /api/mp/room {token}`) returns a **6-symbol code**
(`MP.codeAlphabet`, 32 symbols without I O 0 1 = exactly **30 bits**, drawn from `crypto.getRandomValues` with a mask, no modulo bias) and the client opens the private lobby: code + link `https://<host>/?room=CODE` with **Copy** (clipboard, fallback to execCommand,
feedback on the button itself) and the native **Share** sheet (button only when `navigator.share` exists). Opening the link (or typing the code) joins that lobby directly: `?room=` is read at boot, the code stays in the address bar so a reload of the lobby comes back to it, a
district map is switched to the centre first (online is centre-only). An unknown / expired code opens the dialog **"Šī istaba vairs nav aktīva"** with *Create a new room*. A live session record of ANOTHER room (a running round) is never silently dropped: the start screen asks
(*Rejoin round* / *Leave it and continue*).
**Lobby.** No automatic countdown. **Host** = the creator (the hello token bound at creation; a dropped socket keeps the role 8 s so a reload comes back as host, a private lobby also reconnects its socket by itself); when the host leaves (Leave / gone for good), **the oldest remaining player (lowest player id) becomes host** (toast "Tu tagad esi saimnieks"); a room made without a token elects the oldest player at once.
Only the host can `cfg {len: 120|300, bots}` and `go`; guests see the same settings read-only. Bots: default yes, fill to 8 (`totalHoles`), off = humans only. Round length 2:00 / 5:00 (`MP_ROUND_SECONDS` stands for 5:00 in tests, the short one is 0.4x). Max **12 humans**
(waiting late arrivals count). The lobby says whether the round **would be ranked** ("Šī kārta tiks ierakstīta tiešsaistes tabulā" / "Ārpus tabulas: …").
**Rules** are the public rules (same `RoomSim`, combos, power-ups, kills, 45 s grace, resume by session token; the session record carries `priv: true`). **Late arrivals** (a link opened during a running round) become *waiters*: they sit in the lobby, get `{t:'wait', timeLeft, top}` every 2 s (no snapshots) and join the lobby
when the room returns to it. **Rematch:** at the results the big button says "Atkārtot ar draugiem"; one tap sends `rematch` and the server moves **every still-connected socket** (and the waiters) back into the same lobby (settings + host kept, world reset on the clients). **Lifetime:** the room is a Durable Object named
`priv:<code>` (a name public rooms cannot have); an alarm every `privTtl` (15 min) re-arms while anybody is connected, otherwise the room deletes itself (`deleteAll`: a later lookup is a 404). After a round it stays valid 15 min; if nobody is looking at the results any more a late link opens the lobby again.
**Ranking guard:** a private round is written to the online leaderboard by the server **only when `len == 300` (standard) and >= 2 humans are still in the arena at the end**; the `end` frame carries `priv: {ranked}` and the `saved` frame `why: 'unranked'`, the results say so. A bots-only round or a 2:00 round is never written (checked on the real board by `smoke:friends`).
**Isolation.** Private rooms never report to the matchmaker (`report()` is a no-op, `/known` is not asked): public matchmaking, `/api/mp/status` and the lobby list cannot see them; `?room=` (public, lower case) and `?priv=` (codes, upper case) are separate routes and a code can never open a public room or the other way round.
**Abuse / cost guards.** Room creation: `rateHit('pc:'+ipHash, 10, 1 h)` (the existing D1 limiter, `RATE_PRIV_CREATE` test var); failed lookups / joins: `pf:`+ipHash, 12 per 10 min (`RATE_PRIV_FAIL`), a blocked IP gets 429 on lookups AND on `?priv=` sockets, so codes cannot be enumerated (and a bogus code costs one DO
wake-up with no storage write). Names go through `sanitizeName` like everywhere; no chat; nothing personal is stored (the host token is the tab's random session token). The lobby hibernates (WebSocket Hibernation: members live in the sockets' attachments, the only timer is the TTL alarm).
**Cost per private room** (free-plan model): create = 2 DO requests (worker -> DO init) + 1 D1 write; every join = 1 lookup (DO) + 1 websocket upgrade + 1 hello + a lobby broadcast per change (~2-3 billed requests); the round costs the usual ~190 requests per human; a lobby with people adds 1 alarm per 15 min; the public lobby's 2.5 s `/api/mp/status` polling is NOT done in a private lobby (saves ~24 requests / minute per player).
**Protocol.** `PROTOCOL_VERSION` stays **3** (every change is additive: hello `sk`, lobby / start / end fields, new frames `cfg go rematch wait`, a private room is reached through new routes only, so a v3 tab simply cannot use it); the stale-tab path is hardened instead: a `version` refusal now carries the server's `sv` and a client that sees another version offers the reload at once (`_versionRefused`).
Test vars: `MP_PRIV_TTL_MS`, `RATE_PRIV_CREATE`, `RATE_PRIV_FAIL`. No D1 migration.

### 5.9 Skins and player level (cosmetic only: `src/skins.js`, `src/meta/{level,unlock,wardrobe,wardrobeUi,skinArt}.js`, `src/holeView.js`)
**Never affects scoring, size, speed or hitboxes** (`Hole.skin` is read only by `holeView.js`, the name-tag CSS and the 2D previews; the simulation and the anti-cheat never see it). A skin is `[rim, trail, tag]` = three small ints, 0 = default; the catalogue (24 items + 3 defaults) is pure data in `src/skins.js`, shared with the Worker (it only needs `SKIN_COUNTS = [10, 8, 9]`).
**Rendering** (`src/holeView.js`): the ground shader takes per hole a pattern id + two colours (`uHoleSk/S1/S2`, a constant number of extra uniforms; the identity colour stays in `uHoleCol`): a skinned rim is ~2.3x wider, the pattern fills its inner ~2/3 and the player's **identity colour is always the outer edge**, so two holes with the same skin are still told apart (the tag dot, minimap dot, leaderboard
and kill feed keep the identity colour). Patterns: stripes, flag (radial carmine / white / carmine), dots, waves, checker, shimmer (animated), scallops, metal. The shaft mesh keeps its geometry (a neutral-gradient twin is used for tinted skins) with a per-view material colour as tint; spawn-protection blink lerps the whole rim to white. **Trails:** one `InstancedBufferGeometry` mesh (ONE draw call for every hole), a 384-slot ring buffer
of marks whose position / size / birth time live in per-instance attributes and are evaluated in the shader (nothing is touched per frame unless a mark is spawned), fading by age, discarded inside any hole, **off on the low tier** (`__life.quality.level == 0`). Power-up auras, the combo chip and the 18 Nov / evening / winter themes are untouched (they are separate layers; checked in screenshots).
**Online:** the hello carries `sk` (cleaned client-side from the wardrobe, **range-checked on the server only: invalid ids become 0 per slot; ownership cannot be verified, cosmetics are client-trusted by design**), the server relays it in lobby / start / resume / end frames, bots get a rim only (deterministic `botSkin(id)`, ~45 % non-classic, no trail / tag; solo bots too).
**Level.** `src/meta/level.js` (pure): XP to go from level L to L+1 = 100 + 40 (L-1) + 6 (L-1)^2 -> level 10 at 3 564 XP, **level 30 at 65 424 XP**, cap 60. XP per **eligible** finished round (exactly the streak's rule: not free roam, no debug hook, at least min(60 s, half the round) played): base by mode (classic 80, quick 50, daily 90, online 100)
+ placement (1st 40 / 2nd 25 / 3rd 15) + 14 x log2(1 + points / 1500) (cap 120: power players do not run away) + weekly goals completed in the round (easy 60 / medium 100 / hard 160 / all 200) + 15 + 5 x min(streak, 12) when the round extended the daily streak; at least 20. A typical round pays ~140 XP (level 10 in ~25 rounds = 2-3 hours with menus, level 30 in ~460). UI: a level badge with a progress ring replaces the star on the start screen's *My progress* button (a dot while
there are unseen unlocks), the Wardrobe tab, and on the results "+N XP", the level-up moment (pulsing badge, "Jauns līmenis: N!"), the newly unlocked items and a button into the wardrobe.
**Storage:** `bedre.wardrobe.v1` `{v, xp, eq:[rim,trail,tag], seen[], ach[], alb, rounds}` (device-local, versioned, try/catch, corrupt -> empty); the worn skin is cleaned against what is owned on every read (a locked id forced into storage is ignored).
**Unlocks** (`src/meta/unlock.js`, rules in the catalogue): by level (rim Karmīns 2, Dzintars 4, Daugava 6, Jūgendstils 10, Šaha 14, Ziemeļblāzma 20; trail Putekļi 3, Dzintara dzirksteles 7; tag Dzintara 5, Daugavas zilā 9, Pasteļtoņi 16), by reward ids (`streak-3` carmine tag, `streak-7` carmine-ribbon trail, `streak-14` gold tag, `streak-30` gold-shimmer rim, `streak-60` royal tag, `streak-100` aurora trail),
by weekly goals: **the n-th completed weekly goal of a tier unlocks the n-th item of that tier's list** (ids are counted from the stored rewards, so every past and every future ISO week counts; extra weeks past the list only give XP): easy [meadow tag], medium [Daugava bubbles trail], hard [Jāņu rim, night tag], all [petals trail]; by achievement `combo2` (the **Pelmenis** rim: dough with dumpling dots) and by album milestone 40 objects (the **dumpling-spill** trail).
**Wardrobe tab** in the progress panel: level card, live preview canvas (the same pattern maths in 2D, `skinArt.js`), grid per slot with worn / owned / locked + how to unlock (level, streak, "weekly goals (hard) 1/2", achievement, album 12/40), NEW marks, tap = wear (locked = preview only).

## 6. Tunables
- `src/config.js` (`CFG`, `LIFE`): round, growth (`radius = 2.2 (1 + score/k)^0.44`, k 16 classic / 6 quick), swallow rule (`reach`, `fitRatio`), duel (`ratio 1.15`, `reach 0.62`, `gain 0.5`), bots
  (`DIFFICULTY` profiles: skill, speed, think rate, reaction, aim noise, aggression, hunt range / greed / human ratio, growth handicap `gain`, `humanGrace`, `respawnGrace`, duel `keepScore` / `protect`; see 6.1), camera, props, ground (`pxPerM` per tier), quality (`LIFE.quality`), radio, `mapsRanked`.
- `tools/maps.mjs` per-map multipliers: `props` (prop and mover density), `value` (building value DIVISOR scale: smaller = more points), `trees`, `people`, `bots` (skill; damped by `mapSkill` on Easy), `botSpeed`, `botGain` (per-difficulty growth-handicap scale that keeps the best bot at the same share of a casual player on every map).
  Targets for a 5:00 round on any map: greedy final radius ~120-160 m, >= 80 edible objects within 60 m of every player spawn; bot strength is calibrated per difficulty (6.1). The table below is the old pre-difficulty (now = Hard) measurement:
  | map | greedy (no bots) | greedy r | best bot / greedy | spawns < 80 edible |
  | --- | --- | --- | --- | --- |
  | centrs | ~185k | ~133 m | ~70 % | 0 |
  | agenskalns | 158-263k | 135-155 m | 57 % | 0 |
  | mezaparks | ~194k | ~143 m | ~52 % (bots 2.0, speed cap 1.1) | 0 |
  | purvciems | 224-304k | 150-165 m | 52 % | 0 |
- Perf pass (2026-11, `docs/perf/`): measured with `scripts/perf-pass.mjs` (before / after in `docs/perf/results.md`). World build Centre: 0.44 s desktop, 1.7 s Pixel 5 4x CPU (was 0.73 / 3.0 s); time to playable Centre on Pixel 5 profile Fast 4G 5.1 s cold / 2.4 s warm; first visit transfer 3.2 MB (Centre) / 1.6-2.5 MB (districts); whole-city intro and r>=90 views 0.8k calls / 1.0-1.35 M triangles and 3-4 ms desktop / 4-9 ms Pixel 5 4x (distance LOD in `World.setViewDistance`: people, bins, benches thin out beyond ~450 m camera distance, trees use the phone crown beyond 850 m); gameplay zoom unchanged (2-4 ms, 8 holes: smoke 3.4-3.8 ms). Textures: 53-66 MB low, 111-139 MB medium, 277-352 MB high (desktop only). `?sw=1` is needed to test the service worker locally.
- Map-fix budgets (2026-11, high tier): gameplay-zoom triangles 1.4 M / 1.6 M / 1.9 M / 1.7 M (Centre / Āgenskalns / Mežaparks / Purvciems), cpu 2.4-4.0 ms, placement files 324 / 376 / 423 / 364 KB gz (Mežaparks was 277 KB), ground skirt <= 6.6 MB.
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
- Multiplayer: `MP` (`botSkill`, `botHumanGrace`, `totalHoles`, lobby / round seconds, speed tolerance, claim budgets).

### 6.0 Combos / power-ups: pacing and balance (scoring rules 2, measured 2026-11, `scripts/balance.mjs`, `scripts/balance-diff.mjs`)
**Pacing is unchanged: size follows the mass.** Greedy autoplayer, no bots, final RADIUS (mass), before -> after with `?pu=0` (combos on, no pickups): centre 138.2 -> 138.2 (mass 195.7k -> 195.7k), Mežaparks 140.3 -> 140.2: identical,
the combos only move the points (centre 195.8k -> ~585k points, x3.0: the greedy player keeps x3 almost all the time). With power-ups on (the autoplayer detours for the near ones, 3-5 pickups per round; 5 rounds per map, spawn and
pickup layout random): centre 134.1 / 138.1 / 141.5 / 141.0 / 139.9 (mean 138.9 = +0.5 %, before 138.2), Āgenskalns 151.5 mean (before 153.4, spawn-dependent 136-164), Mežaparks 137.5 (141.3-145.6, one slow-start round 118.1; before 140.3),
Purvciems 150.5 (before 141.6, 121-158): within +-5 % of the old means; single rounds scatter with the spawn (as before). Why it holds: speed is x1.5 for 6 s only, Magnēts is 6 s and its pull radius tapers from x1.8 to x1.3 for a big hole
(an untapered 8 s magnet pushed a late-game hole's final radius +10-20 %: it nearly doubles the area a big hole sweeps), pickups are ~1 per 250 m x 250 m (centre 12, districts 10) and the casual / strong autoplayers only take near ones.
Bot detours are small on purpose (`BOT_PU`: chance per decision easy 10 % / normal 30 % / hard 55 %, range 28 / 42 / 65 m + 1.5 x radius, cooldown 14 / 10 / 7 s; a first version that chased every pickup crippled the bots: worst bots ended with 0-150 points).
Difficulty with points (4 rounds per cell, bots at their level, points rank; `balance-diff`): Centre easy casual 1.5th (win 50 %, top 3 100 %, best bot 85 % of the casual player), easy greedy 1st (100 %); normal casual 2.3 (win 50 %, top 3 75 %, best bot 124 %),
normal greedy 1st; **hard casual 6.8 (0 % wins, 0 % top 3)**, hard greedy 1.8 (75 % wins, best bot 95 %). Āgenskalns: easy casual 1.8 (50 % / 100 %), normal casual 1.0 (100 %), hard casual 6.5 (0 %), hard greedy 1.3 (75 % wins).
(Before: Centre normal casual win 40 % / top 3 80 %, hard greedy 0 % wins: a perfect player now wins the hard rounds more often because bots build combos a little less steadily than the greedy player; the casual player at hard still never wins.)

**Release stabilisation (2026-11-18).** Sights now need a hole proportionate to their size: `CFG.sightFit` gives landmarks / tier A sights fit >= 0.34 x height (<= 26 m) and the Freedom Monument a fit of 14.5 m (it was swallowable from r 6.5 m; now from ~15.3 m), bots weigh landmarks at 25 % -> 100 % over the first 4 minutes (`lmW`, solo and server bots). The placement files were regenerated (`GPU=1 npm run build:mp`; centre hash now `a7c86ad07f1ce3e6`). Greedy final radius (no bots, power-ups on, 4 rounds each): centre 141.2 (was 138.2 before the features), Āgenskalns 155.3 (153.4), Mežaparks 137.3 (140.3), Purvciems 155.3 (spawn-dependent 121-162; 141.6): within the usual +-5 % of the old means except Purvciems (+9 %, one of the old rounds was a 121 outlier). Casual player vs bots, 4 rounds per cell (`balance-diff`): centre easy 1.0 (100 % top 3) / normal 3.3 (75 %) / hard 6.8 (0 %); Mežaparks easy 1.8 (75 %) / normal 2.0 (100 %) / hard 5.0 (25 %); Purvciems easy 3.0 (50 %) / normal 3.8 (75 %) / hard 8.0 (0 %).

**Limits regenerated for rules 2** (`GPU=1 node tools/gen-limits.mjs --runs 4 --merge-max --maps <slug>` per map in parallel (4 rounds per cell instead of 8: the machine was shared), every difficulty, bots on / off, daily twists on the centre; `merge-max` keeps the pre-combo ceilings as a floor, so no ceiling went down; format 2). Final-points caps (classic / quick / daily) and the best combo / most pickups an autoplayer reached:
| map | rounds in the table | classic cap | quick cap | daily cap | best combo (classic) | most pickups |
| --- | --- | --- | --- | --- | --- | --- |
| centrs | 608 | 734,088 | 463,835 | 680,691 | 13,877 | 11 |
| agenskalns | 368 | 880,463 | 497,310 | - | 14,904 | 7 |
| mezaparks | 368 | 765,260 | 434,871 | - | 13,199 | 10 |
| purvciems | 368 | 839,899 | 513,768 | - | 10,663 | 4 |
`node tools/check-legit.mjs` on fresh rounds (every map, all modes + daily twists, greedy / cluster / slowed / casual players at every difficulty, trace v2): centre 36 rounds ok 36 / suspect 0 / REJECT 0, Mežaparks 16/16, Āgenskalns + Purvciems 32/32; control: 72/72 tampered submissions flagged or rejected (new: inflated multiplier (all intervals / one interval), impossible power-up count, power-up burst, combo longer than eaten, radius following the points, a +30000 jump).

### 6.1 Difficulty and balance (`DIFFICULTY` in `src/config.js`, `scripts/balance-diff.mjs`, `scripts/mp-bot-bench.mjs`)
Three levels, chosen under Advanced (`?difficulty=easy|normal|hard`, remembered, default **Easy**). A profile rewrites `CFG.bots` + the human's `CFG.duel` numbers at every round start (`applyDifficulty`, called by
`applyMap` at boot and by `src/modes.js`; the **daily challenge always plays Normal** so everybody has the same setup; the per-map `bots` skill multiplier and `botGain` of `tools/maps.mjs` are applied on top).
| lever | Easy | Normal | Hard (= the old behaviour) |
| --- | --- | --- | --- |
| skill (speed / aim / reaction scale), think rate | 0.62, 4 Hz | 0.9, 6 Hz | 1.0, 6 Hz |
| bot speed factor, reaction (s), aim noise | 0.62-0.8, 0.5-1.4, 0.30 | 0.82-0.96, 0.2-0.7, 0.22 | 0.86-1.0, 0.15-0.6, 0.22 |
| aggression, hunt range, hunt greed, min prey size | 0.05-0.4, 1.2 r, 3.0, 45 % | 0.15-0.7, 1.8 r, 2.2, 30 % | 0.2-0.9, 2 r, 2.0, 25 % |
| growth handicap (share of points a bot earns) | 67 % (+ rubber band: a bot > 1.2x ahead of the human loses growth, floor 45 %) | 60 % | 100 % |
| humans: no hunting for the first N s / size ratio before a bot attacks a human / no spawn camping for N s | 75 s / 1.45x / 25 s | 20 s / 1.1x / 8 s | 0 / 1.0x / 0 |
| the human after being swallowed keeps / spawn protection | 65 % / 4.5 s | 50 % / 3 s | 50 % / 3 s |
Bots stay imperfect rather than stupid (they keep eating, roaming and fleeing; they only react later, aim worse, hunt less and earn less). Calibration player = the **casual** autoplayer of `tools/sim-lib.mjs`
(0.65x speed, re-targets every 0.5-1.4 s from a limited view with noisy value / distance picks, wanders now and then, flees after 0.6 s) next to the perfect greedy `Game.autoplay`.
Measured with `GPU=1 node scripts/balance-diff.mjs --runs 10` (casual and greedy, classic, 10 full rounds per cell, `--maps/--diffs/--players` to narrow; `/tmp`-style parallel runs need `--dist` + distinct `--port`s).
Casual = the imperfect human, "best / casual" = best bot score as a share of the casual player's score; place = average placement of 8 (win / top-3 = share of rounds):
| map | difficulty | player | n | score | place | win | top 3 | best bot | median bot | worst bot | best / player |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| centrs | easy | casual | 10 | 46,167 | 1.1 | 90% | 100% | 24,607 | 7,853 | 1,263 | 53% |
| centrs | easy | greedy | 10 | 140,315 | 1.0 | 100% | 100% | 23,706 | 5,670 | 1,436 | 17% |
| centrs | normal | casual | 10 | 34,892 | 2.2 | 40% | 80% | 40,253 | 10,033 | 1,227 | 115% |
| centrs | normal | greedy | 10 | 126,869 | 1.0 | 100% | 100% | 34,022 | 9,104 | 1,476 | 27% |
| centrs | hard | casual | 8 | 19,552 | 6.1 | 0% | 0% | 117,242 | 40,701 | 7,331 | 600% |
| centrs | hard | greedy | 8 | 80,565 | 2.5 | 0% | 88% | 106,269 | 29,233 | 6,415 | 132% |
| agenskalns | easy | casual | 10 | 75,061 | 2.0 | 60% | 90% | 33,147 | 11,698 | 4,353 | 44% |
| agenskalns | easy | greedy | 10 | 205,318 | 1.0 | 100% | 100% | 42,214 | 13,429 | 5,687 | 21% |
| agenskalns | normal | casual | 10 | 33,031 | 2.7 | 40% | 80% | 31,676 | 12,466 | 7,133 | 96% |
| agenskalns | normal | greedy | 10 | 180,111 | 1.0 | 100% | 100% | 27,704 | 13,362 | 6,281 | 15% |
| agenskalns | hard | casual | 8 | 12,996 | 7.9 | 0% | 0% | 135,768 | 54,613 | 25,535 | 1045% |
| agenskalns | hard | greedy | 8 | 57,165 | 4.9 | 13% | 38% | 128,298 | 52,657 | 25,070 | 224% |
| mezaparks | easy | casual | 10 | 58,460 | 1.4 | 60% | 100% | 45,199 | 9,879 | 2,035 | 77% |
| mezaparks | easy | greedy | 10 | 150,816 | 1.0 | 100% | 100% | 23,709 | 7,452 | 1,967 | 16% |
| mezaparks | normal | casual | 10 | 42,181 | 1.6 | 60% | 90% | 38,422 | 12,850 | 4,816 | 91% |
| mezaparks | normal | greedy | 10 | 97,121 | 1.0 | 100% | 100% | 34,429 | 10,525 | 2,755 | 35% |
| mezaparks | hard | casual | 8 | 24,333 | 5.5 | 0% | 25% | 84,137 | 31,151 | 12,069 | 346% |
| mezaparks | hard | greedy | 8 | 62,179 | 1.9 | 13% | 100% | 91,989 | 25,319 | 8,746 | 148% |
| purvciems | easy | casual | 10 | 47,398 | 1.8 | 70% | 90% | 28,806 | 10,114 | 1,229 | 61% |
| purvciems | easy | greedy | 10 | 216,879 | 1.0 | 100% | 100% | 27,367 | 10,729 | 2,228 | 13% |
| purvciems | normal | casual | 10 | 30,392 | 3.1 | 30% | 60% | 30,481 | 12,252 | 1,888 | 100% |
| purvciems | normal | greedy | 10 | 224,860 | 1.0 | 100% | 100% | 30,348 | 11,481 | 2,468 | 13% |
| purvciems | hard | casual | 8 | 19,136 | 7.6 | 0% | 0% | 140,353 | 68,007 | 24,627 | 733% |
| purvciems | hard | greedy | 8 | 113,447 | 2.6 | 63% | 75% | 121,511 | 64,949 | 17,456 | 107% |
Targets and how they came out: **Easy** wins / top-3 in most rounds with the best bot at roughly 45-75 % of the casual player (13-21 % of a perfect greedy player: the casual human scores only ~25-30 % of greedy,
growth is superlinear in speed) and a visible race for the first 2-3 minutes (at 100 s a casual player leads the board 982 vs 733 / 634 / 468 ... in the Centre sample, `scripts/board-shot.mjs`);
**Normal** is a fair fight (best bot ~90-115 % of the casual player, casual wins 30-60 %); **Hard** keeps the old strength (best bot 107-224 % of a *perfect* player: a perfect greedy player wins 0-63 % of the rounds, a casual player 0 % and top-3 in 0-25 %; Hard rows: n = 8). The numbers are noisy (heavy-tailed: one bot snowballing); n = 10 per cell (the Easy / Normal rows were measured just before bots were made to respawn with the classic 50 % / 3 s while only the human gets the difficulty's numbers; bot deaths are rare on Easy, so the effect is small). `botGain` per map (`tools/maps.mjs`) was calibrated per map and difficulty so that the shares are similar on all four maps.
**Online:** `MP.botSkill = 0.38` and `MP.botHumanGrace = 60` (bots do not hunt humans in the first minute). `node scripts/mp-bot-bench.mjs --runs 10 --speed 0.55 --skills 0.55,0.4,0.38,0.35` (a casual human alone against 7 bots,
objects.bin of the current table): skill 0.55 -> casual ~31k places 2nd-4th with the best bot ~75k; **0.38 -> casual ~32k, places 2nd (1st-3rd), 10/10 top-3, best bot ~48k, median bot ~10k**; 0.35 -> casual wins 4/10.
**Anti-cheat:** weaker bots leave the player more food and fewer rivals, so `tools/gen-limits.mjs` plays classic / quick at every difficulty (`--difficulties easy,normal,hard`, daily = Normal) and
`tools/check-legit.mjs` checks greedy / cluster / slowed / casual players at every level. After changing any difficulty number re-run `GPU=1 node tools/gen-limits.mjs --runs 8 --merge-max` (keeps the old maxima: ceilings never tighten) and `node tools/check-legit.mjs`.


## 7. Known limits
- The anti-cheat is plausibility checking; a determined cheater can fabricate a consistent submission. Calibration comes from autoplayers, not humans (x2 / x3 are the margin).
- District maps have fewer leaderboard entries by nature; their limits come from ~24 autoplayer rounds each. Re-run `gen-limits` for a map after tuning it.
- The greedy autoplayer is deterministic per spawn; the real spread between players is larger than the balance table suggests.
- Online is centre-only and a beta: one matchmaker DO, no spectators, a deploy ends running rounds, mover claims are only loosely validated. Friend rooms: the host is the creator's tab session (a host whose socket drops keeps the role for 8 s, `HOST_GRACE_MS`, so a reload does not hand the room over; an explicit Leave hands it over at once), a code is 30 bits behind a per-IP failed-lookup limit (not unguessable against a botnet), the leaderboard guard for private rounds is 'standard length + >= 2 humans' (two friends can still farm each other), skins are client-trusted.
- Pasažieru osta is not in the municipal / OSM data used here, so it is not a landmark. Z-Towers' height / shape comes from the measured shapes agent's data, not from OSM.
- The radio depends on LSM's public stream; Chrome / Safari play HLS natively (checked: `scripts/check-radio.mjs`), other browsers use the bundled hls.js; no network = a quiet "stream unavailable".
- Fireworks need the evening look; at the steep gameplay camera they are only visible during the eased camera moments (a deliberate, small compromise).
- Phones are tested on real WebKit and Chromium with device profiles and (synthetic on WebKit, CDP-real on Chromium) multi-touch, not on physical phones: haptic feel, thumb ergonomics, Safari's real memory limit and audio interruptions need the checklist in `docs/mobile-test-checklist.md`. iOS has no Vibration API (a ring pulse replaces it) and cannot be made fullscreen from a page (hint to Add to Home Screen instead).
