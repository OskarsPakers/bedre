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
| `PORT=5186 GPU=1 npm run smoke [-- --sample]` (`MAP=<slug>` for a district) | gameplay, bots, duels, results, intro, zoom, balance curve | PORT |
| `PORT=5187 GPU=1 npm run smoke:world [-- --sample]` | traffic, audio, particles, landmarks, labels, perf | PORT |
| `API_PORT=8796 npm run smoke:api` | worker API on a local wrangler: modes, per-map boards, migrations (fresh + upgrade from 0001), validator, rate limits, Turnstile mock, analytics | API_PORT |
| `E2E_PORT=8797 GPU=1 npm run smoke:e2e` | built game + worker: server round length, submit, boards, tamper rejected, daily, district ranking + map switch, results | E2E_PORT |
| `npm run test:mp` / `GPU=1 npm run smoke:mp` | multiplayer: pure-Node sim/validator/bots/CPU bench / full end-to-end on wrangler :8793 (`MP_PORT=<n>` for another port + own build/state dirs), followed by `smoke:engines` | 8793 |
| `GPU=1 [ENG_PORT=8798] npm run smoke:engines [-- --static-only \| --rooms-only \| --stale-only] [--fix]` | **cross-engine**: Chromium / WebKit (iPhone 13 profile) / Firefox build identical worlds on all 4 maps (full per-id dump compare, placement hash, solo Play, no console errors, missing/stale-file fallback); Chromium+WebKit and Chromium+Firefox in ONE online room (same ids, eaten objects vanish for the other engine, same ranking); stale tab after a deploy recovers (also with the service worker) | ENG_PORT 8798, vite 5185 |
| `npm run check:legit` | fresh autoplayer rounds on EVERY map + all modes through the validator: 0 false rejects expected; tampered control must be flagged | 5191 |
| `PORT=5188 GPU=1 node scripts/smoke-meta.mjs` | album, achievements, % meter, recap, share card, PWA, radio | PORT |
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
* **Release checklist (client changes):** `npm run build` · `npx wrangler deploy --dry-run` · `PORT=.. GPU=1 npm run smoke` (+ `-- --sample`, + `MAP=` each district) · `npm run smoke:world` · `npm run smoke:api` · `GPU=1 npm run smoke:e2e` · `npm run test:mp` + `GPU=1 npm run smoke:mp` · `npm run check:legit` · `node scripts/smoke-meta.mjs` · `node scripts/smoke-matrix.mjs` (24/24) · **`GPU=1 npm run smoke:mobile`** (phones: real WebKit iPhone 13 / SE + Chromium Pixel 5; never replace this by an "iPhone" profile on Chromium) · then the five-minute phone run in `docs/mobile-test-checklist.md` (haptics, thumb feel, Safari memory, audio interruptions cannot be automated).
* Migrations are never edited once applied; the next one is `0006_...`. `0004_maps.sql` adds `rounds.map` / `scores.map` (default `centrs`) + indexes; `0005_difficulty.sql` adds the nullable informational `scores.difficulty` tag (easy | normal | hard; NULL for old and online rows). **Apply 0005 before deploying this worker** (`npm run deploy` already does: migrations first, then `wrangler deploy`), the INSERT names the new column.
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
**Phones** — `mobile.js` (device detection, remembered touch prefs, haptics, wake lock, fullscreen, Add-to-Home-Screen + battery hints, `touch` / `tui` body classes, `?inset=` emulation), `mobile.css` (the phone layout: chips, lanes, thumb zones, safe areas), `mobileUi.js` (leaderboard / minimap chips, Advanced touch options), `input.js` (floating joystick, pinch, double-tap), `camera.js` (aspect-continuous portrait / landscape tuning), `loadProgress.js` (one byte-accurate loading bar; `vite.config.js` `dataPreload` starts the map files downloading from `<head>`).
**Life and feel** — `life.js`, `events.js` (bus), `effects.js`, `audio.js` (procedural WebAudio + mute button), `quality.js` (auto scaler).
**Themes** — `theme.js` (+ `sky.js`, `glow.js`, `snow.js`, `flags.js`, `fireworks.js`, `themeUniforms.js`).
**Meta** (`src/meta/`, passive observers of the bus) — `progress.js` (% of Riga meter, area banner, toasts, My progress panel, recap), `album.js`, `achievements.js`,
`districts-names.js`, `recap.js`, `share.js`, `radio.js` (bundled hls.js, dynamic import), `pwa.js`, `store.js`, `strings.js`.
**Multiplayer client** (`src/net/`) — `client.js`, `online.js`, `ui.js`, `net.css`; placement files: `src/placements.js` (loader + generator dump), `worker/mp/table.js` (format, shared with the Worker), `tools/mp/` (build / check / fingerprint). **Worker** (`worker/`) — `index.js` API, `lib/*` (db, validate, limits, moderation,
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
- `POST /api/scores {roundId, map?, difficulty?, name, score, eaten, radius, rank, biggest, trace[, turnstile]}` -> `201 {ok,id,name,mode,map,rankAllTime,rankToday}`; 400 bad payload / map mismatch,
  403 unknown / early / expired round, 409 replay, `difficulty` (optional, easy|normal|hard, else 400; the daily challenge is always stored as normal) is an informational tag shown next to the name in Top scores and **never splits a board**, **422 failed plausibility** (token burnt, nothing stored), 429 daily submission cap (classic 60, quick 120, daily 5 per IP-hash).
- `GET /api/scores?mode=classic|quick|daily|online&map=<slug>&period=all|week|day[&day=][&limit=20]` — one board per map x mode (daily / online exist for the centre only; other maps answer empty).
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
against the object table (= the placement file, section 4.1; the client's handshake id is the hash of the file bytes, so Chromium / WebKit / Firefox players share a room), movers loosely (budgeted). Reconnect with a per-tab session token (15 s grace). Messages: JSON, 2 KB cap, token bucket. Free-plan cost model: lobbies
hibernate; ~190 billed requests per human per round. `MP` in `worker/mp/protocol.js` holds the limits; gameplay numbers come from `src/config.js` so solo and online cannot drift.
Test vars (never in `wrangler.jsonc`): `MP_ROUND_SECONDS`, `MP_LOBBY_SECONDS`, `MP_RESULTS_SECONDS`, `MP_MAX_HUMANS`, `MP_TEST_CLOSE_SPAWN`, `MP_BOT_SKILL`, `MP_BOT_GRACE`; worker test vars:
`ROUND_SECONDS_OVERRIDE`, `RATE_ROUNDS_PER_HOUR`, `CAP_<MODE>`, `TURNSTILE_VERIFY_URL`.

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
- Online is centre-only and a beta: one matchmaker DO, no spectators, a deploy ends running rounds, mover claims are only loosely validated.
- Pasažieru osta is not in the municipal / OSM data used here, so it is not a landmark. Z-Towers' height / shape comes from the measured shapes agent's data, not from OSM.
- The radio depends on LSM's public stream; Chrome / Safari play HLS natively (checked: `scripts/check-radio.mjs`), other browsers use the bundled hls.js; no network = a quiet "stream unavailable".
- Fireworks need the evening look; at the steep gameplay camera they are only visible during the eased camera moments (a deliberate, small compromise).
- Phones are tested on real WebKit and Chromium with device profiles and (synthetic on WebKit, CDP-real on Chromium) multi-touch, not on physical phones: haptic feel, thumb ergonomics, Safari's real memory limit and audio interruptions need the checklist in `docs/mobile-test-checklist.md`. iOS has no Vibration API (a ring pulse replaces it) and cannot be made fullscreen from a page (hint to Add to Home Screen instead).
