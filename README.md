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
| `ground.js` | paints map (parks, water, roads, footprints) into 2x2 canvas tiles (4096 px) + a repainted close-up `DetailLayer` (sharp texture around player) |
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

API (same-origin only): `POST /api/rounds` -> `{roundId, roundSeconds}`; `POST /api/scores {roundId,name,score,eaten,radius,rank,biggest}` -> `{ok,id,rankAllTime,rankToday}` (round must be unused and ~round-length old); `GET /api/scores?period=all|week|day&limit=20`. `ROUND_SECONDS` in `worker/index.js` must match `roundSeconds` in `src/config.js`.

Local: `npm run dev:worker` (build, apply local migrations, `wrangler dev` on :8791) next to `npm run dev` (Vite proxies `/api`). Test: `npm run smoke:api`.

First deploy (needs `npx wrangler login`):
```
npx wrangler d1 create bedre-scores        # copy the database_id it prints
# put that id into wrangler.jsonc -> d1_databases[0].database_id
npm run deploy                              # build + remote migrations + wrangler deploy
```

Privacy: the only user-supplied data stored is the chosen display name (plus score stats). No cookies, accounts or analytics. For rate limiting the Worker stores a salted SHA-256 of IP + UTC date with each round row (not the IP itself); unused round rows are purged after a day.


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

Per building the tool: picks the height field (mesh grid, or OSM parts rasterised and accepted only if they agree with the mesh: coverage > 80 %, rms < 4.2 m,
mesh top not above the OSM top; otherwise the mesh wins, e.g. St Peter's whose OSM tower is a bulb) -> cells < 0.7 m are open ground (courtyards, the art museum's
terrace) and street-level skirts next to tall walls are trimmed -> grey opening (relief buildings), rim lifting and bilateral denoise -> outline = the cadastre
polygon itself (straight vertical walls) or a simplified contour where there are courtyards -> boundary points from a Douglas-Peucker pass over the edge height
profile + greedy worst-error Delaunay refinement (Bowyer-Watson, slope-aware tolerance, per-building vertex budget by footprint area/notability) -> roof triangles
with a material each (1 roof, 2 facade-like steep component, 3 spire/dome/tower roof) -> volume, max height, eave height.
File layout (`BSH1`): header JSON (`hs` = `[id, p90*10, p50*10]` for every building, `b` = per-building records: vertex/triangle/loop counts, source 1 mesh-notable / 2 OSM /
3 mesh-relief, volume, hmax, eave, OSM roof colour) followed by Int16 positions (1/16 m, building-local, origin = footprint centroid), Uint16 triangle indices
(delta-coded against the first-use counter, BFS triangle order), Uint8 materials, Int16 outline loops; 16-bit sections are byte-plane split; everything gzip'd.

In the game (`buildings.js`): every building gets the measured height (`flatHeight()`: p50-based eave height for pitched roofs, p90 for flat ones, `riga.json`
value kept for tree-inflated small buildings and `aux` slabs). Shaped buildings: roofs are flat-shaded triangles coloured by slope (flat = tar greys; pitched = tile /
dark tin / some green tin by neighbourhood; special = verdigris / dark / gold for Orthodox churches / OSM `roof:colour`), facade-like steep components use the
wall colour with smoothed horizontal normals, walls are extruded from the outline loops with the usual window shader. The old procedural decorations (spires, domes,
opera portico, castle towers, market vaults, ...) are dropped for shaped buildings; the Cat House keeps its cats (placed on the two highest points). Non-shaped
buildings keep the old generators (mansards, church spires) at the measured height. `world.setDetail(level)` swaps relief buildings to a flat box (a second geometry id in
the same `BatchedMesh`) at `low` quality. Debug counts: `__life.world.shapeStats` and `window.__timing {loadMs, buildMs}`.
The Freedom Monument prop is placed at the surveyed position (-1.7, 4.3) instead of the OSM point (3.4, -1.5), which is ~7 m off.

Screenshots of the shaped buildings: `PORT=5187 GPU=1 node scripts/detail-shots.mjs [name ...] [--quality=low]` writes `scripts/out/detail-*.png` (free camera); `scripts/measure.mjs` prints
build time / draw calls / triangles / cpu ms per frame.

## Credits and licences

- Inspired by Hole.io (plain-text mention and link to holeio.com; no assets, name, logo or code used; this is an original game).
- Building footprints, shapes and heights: © Rīgas valstspilsētas pašvaldība (https://georiga.eu): cadastre footprints plus shapes/heights measured from the municipality's reality model (the model itself is not shipped). Building parts: © OpenStreetMap contributors (ODbL).
- Building parts (OSM `building:part`, where accepted) and roads, water, parks, trees, tram tracks, stops, names: (c) OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright. The derived `public/data/riga.json` is a database derived from OSM and must keep the attribution (shown in the footer, About popover and a corner label during play).
- Built with three.js (MIT). No audio or image assets.

## Bot balance (iteration 4)
Bot brains (`bots.js`) use an 80 m density map of edible value to roam toward rich areas (edges and water score ~0), re-pick targets every ~0.5-1.1 s, flee only from close/closing bigger holes, hunt only worthwhile nearby prey, and hold back when clearly leading. `SpawnPicker` places the human first (plenty of edible things within 55 m), then spreads bots/respawns by live food. Tunables: `CFG.bots.{difficulty,roamEatTime,roamGain,huntRange,huntGreed,preyMinFrac,leaderRestraint,underdogCare}`, `CFG.duel.keepScore` (0.5). Measure with `PORT=5183 GPU=1 node scripts/balance.mjs --runs 3 --greedy 3` (also `--spawn-only`, `--set bots.difficulty=0.9`). Typical result: top bot ~55-65% of the perfect greedy autoplayer (~155k), worst bot usually 15-30% of the best; a runaway leader in a rich district is still possible.
