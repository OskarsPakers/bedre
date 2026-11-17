# Tramvaja vadītājs — tram-driver prototype

Live path: `/tramvajs/` (second HTML entry `tramvajs/index.html` of the Vite build). Original game on the BEDRE — Rīga map: drive a real Riga tram route on its
real tracks, stop with the front door on the yellow line at the real stops and keep to the timetable. No operator logos; the engine's blue-and-white
low-floor tram model and plain route-number boards only.

## Which route, and what the data really supports

Checked with `node src/proto/tram/tools/build-route.mjs --report` (graph of `tramways`, stop names from the read-only OSM cache `tools/.cache/osm_transit*.json`;
`riga.json` has no names, the cache has no route relations, so "line 11" comes from the brief, not from the data).

| map | tram ways | track | components | tram stops |
|---|---|---|---|---|
| centrs | 130 | 21.0 km of track (raw 98 km of overlapping OSM geometry) | **one** connected 20.4 km component (+2 stubs) | 47, 45 with names (Stacijas laukums, Nacionālā opera, Aspazijas bulvāris, 13. janvāra iela, Grēcinieku iela, Centrāltirgus, Autoosta, Spīķeri, Jēzusbaznīcas iela, Merķeļa iela, Nacionālais teātris, Ausekļa iela, Ģertrūdes iela, Dzirnavu iela, Brīvības iela, Bērnu pasaule, Vašingtona laukums, ...) |
| mezaparks | 5 | 4.0 km, **one** component | 1 | 10, all 10 named |

**Chosen primary route: the Mežaparks end of line 11 on the mezaparks map** (the data is complete for it, and it is the forest-and-loop stretch the brief preferred).
The five OSM ways are two parallel single tracks (outbound along Kokneses prospekts ~1.9 km, inbound ~1.8 km, 3-6 m apart) joined by the terminus loop
(R ~ 20 m) and a link; the generator chains whole ways (`ways: [3, 1, 2, 4]`) because way points would snap to the wrong one of the two close tracks.
Stops on the circuit (m along the track): Mirdzas Ķempes iela 28, Hamburgas iela 480, Visbijas prospekts 793, Mežaparks / ZOO 1318, **Ezermalas iela 2210 (terminus
loop)**, Mežaparks / ZOO 2555, Visbijas prospekts 3149, Hamburgas iela 3517, Mirdzas Ķempes iela 3972. Per name cluster the platform node closest to the track
(the stop_position of this direction) is used.

Two runs on it (start card switch):
* **Short (default): 4 scored stops** — from Mežaparks / ZOO (outbound) round the loop to Ezermalas iela, back via ZOO, Visbijas prospekts, Hamburgas iela. 2.2 km,
  timetable 5 min 42 s (avg 23 km/h incl. 11 s standing per stop); a perfect run takes ~6 min with door cycles. **This is longer than the 3-5 min target and has fewer
  than the 6-10 stops asked for**: with real spacings (300-900 m) the two can not both be met on this stretch.
* **Full circuit: 8 scored stops**, 4.0 km, ~10 min.

Not done: a second route. The centre map is one 20 km connected graph with 45 named stops, so a centre line is possible (`route()` in the generator does shortest
paths over the graph), but picking and verifying a real line (and stops/directions) is a separate piece of work; a quick Dijkstra draft (Vašingtona laukums -
Ausekļa iela - Nacionālais teātris - Opera ... ~2 km) U-turned at the Opera platforms, so it was dropped rather than shipped half-checked.
The full Rīga line 11 can not be driven on one map: the middle of the route lies outside both the centrs and the mezaparks rectangle.

## How to run

* `npm run dev` then http://localhost:5173/tramvajs/ (the map is always mezaparks; `?lang=lv|en`, `?quality=low|medium|high`, `?autostart=1`).
* Build: `npm run build:web` (or the smoke script's own `--outDir scripts/.dist-tram`), `npm run preview`, open `/tramvajs/`.
* Controls: W/↑ power, S/↓ brake, space emergency brake, E/Enter doors, B bell, C cab view, Esc pause, M mute. Phones: drag the lever (up = power, down = brake,
  springs back to neutral), Durvis / Zvans / Kabīne buttons, a red emergency button.
* Test: `npm run smoke:tram` (builds, previews on 5193; `GPU=1` for the real GPU, `ONLY=chromium-desktop`, `SKIP_BUILD=1`).
* Route files are generated: `node src/proto/tram/tools/build-route.mjs` (writes `src/proto/tram/routes/mezaparks.json`, 3 KB).

## How it plays

* Locked to the track (1-D `s` along a Catmull-Rom smoothed centre line, 1 m samples). Lever -> traction / service brake (1.0 / 1.2 m/s², emergency 2.5, max 50 km/h,
  first-order lag, small drag); doors open = traction locked and brakes held. Speed limits: curve limit from curvature (a_lat 1.15 m/s²; the R 20 m loop is 15-19 km/h),
  40 km/h on a stop approach, 25 km/h in the platform area, made brakeable (a limit never drops faster than 0.9 m/s²). Exceeding a curve limit = comfort penalty
  and camera shake, never derailment.
* Per stop (100 points): accuracy 40 (front-door error <= 0.5 m perfect, <= 2 m good, <= 5, <= 10, else), timekeeping 30 (±8 s free, late -0.5/s, early -0.75/s versus a
  timetable built from the ideal limit-following profile ×1.12 + 3 s per leg and 11 s dwell), smoothness 20 (jerk, hard braking, emergency brake, curve overspeed, the
  jolt when the brake is still applied at standstill; all weighted by passengers aboard), speed 10 (time over the limit). Stars: >= 85 % of the maximum 3, >= 60 % 2, else 1;
  a missed stop caps at 2 stars. Missing a stop (first door 10 m past the marker without having stopped) = 0 points for it, no game over.
* Doors: standing in the zone (-26..+10 m) opens them (automatic after 0.8 s, or the Durvis button at once); passengers (the engine's capsule people) walk to the doors /
  step out; boarding ~6 s; doors close by themselves (or Durvis once boarding is done). Bell button.
* Chase camera (default) above/behind with the platform side visible, cab view toggle. Approach aids: yellow 100 / 50 / 20 m boards with 3 / 2 / 1 bars on the left, yellow
  stop line + green "perfect" mark at the first-door position, pole with T sign and name board, bobbing arrow + beam on the next stop only, HUD strip "next stop · 240 m · due
  in 0:35" with a progress bar, a ±m readout inside the last 40 m.

## What was reused / added

Reused through existing exports only: `World` / ground (+ `DetailLayer`, kept under the tram) / buildings with shapes / trees / props, `Lighting`, `SkyDome`, `Quality`
(via the shared `src/proto/shared/street-world.js` written by the kur prototype agent, used unchanged), `PROP_DEFS` (tram, shelter, 6 person models), map data from `/data/mezaparks/*`
(no copies). No holes, bots, theme manager, audio engine, backend or score calls. New: `src/proto/tram/` (`sim.js` pure physics + scoring + autopilots, `track.js`, `scene.js`,
`main.js`, `audio.js` ~40 lines of WebAudio, `strings.js`, `tram.css`, `tools/build-route.mjs`, `routes/mezaparks.json`), `tramvajs/index.html`, `scripts/smoke-tram.mjs`.

Scenery handling (`clearRoute`): trees / lamps / benches / kiosks / shelters / static vehicles within 3-12 m of the track are hidden (169 on this route); **all** moving
road vehicles (cars, buses, trolleybuses, other trams: 788 at high tier) are switched off — they are not routed around the player's tram. Pedestrians, birds, parked cars stay.
The tracks are drawn in 3-D (gravel bed, sleepers, rails) because the ground texture only paints them.

## Shared files edited (additive)

* `vite.config.js`: `tramvajs: 'tramvajs/index.html'` added to `build.rolldownOptions.input` (next to `main` and the other prototype's entry), and a one-line guard in the
  `bedre-data-preload` plugin: `transformIndexHtml(html, ctx)` returns the page untouched for `/tramvajs/…` — otherwise the plugin injects a `<link rel=preload>` for the *centre* map's
  4 data files (~4.5 MB) and a `window.__DATA` that skews the progress bar.
* `package.json`: `"smoke:tram"`.
* `public/sw.js`, `public/_headers`, `wrangler.jsonc`: **not changed**, nothing needed — verified with the service worker active (`?sw=1`): `/tramvajs/` loads its own page, `/`
  loads the main game (Chromium and WebKit).

## Verification (scripts/smoke-tram.mjs, 3 devices)

Chromium desktop (keyboard, lv), Chromium Pixel 5 (touch via CDP, en), WebKit iPhone 13 (touch taps real; the lever drag is synthetic `PointerEvent`s with `pointerType: touch`
because WebKit has no CDP): boots without console/page errors; Play; real input accelerates, brakes to a stop inside the first stop's zone, doors open, traction locked while open,
boarding, stop score shown; first door deviates 0.000 m from the route (section middles 0.06 m on straights, 1.0 m inside the R 20 m loop = chord sag of a rigid 12 m section),
heading step <= 0.042 rad per 0.15 s; perfect driver 367-387 / 400, 3 stars (whole short route), reckless 88 / 400, 1 star; missed stop handled; result card + Play again; main
game still loads at `/`; service worker active. All pass.

## Screenshots (scripts/out/)

`tram-start-desktop.png`, `tram-start-phone.png`, `tram-start-iphone.png` (start card); `tram-chase-desktop-accel.png` (chase on a straight), `tram-curve.png` (terminus loop, tram bending),
`tram-approach.png` + `-pixel5` / `-iphone13` (100 / 50 / 20 boards, arrow, ±m readout), `tram-stopped-*.png` (platform, passengers, score card), `tram-cab.png` (cab view),
`tram-hud-portrait-*.png`, `tram-hud-landscape-*.png` (phone HUD), `tram-result*.png`, `tram-edge-full-end.png` (full circuit, last stops).

## Known weaknesses (frank)

* The city at street level is acceptable but plainly low-poly: flat-shaded boxes with blurry window textures, uniform grass, big pine silhouettes; buildings are lit from the top-down game's
  light and look flat from the side; no overhead wires; far horizon is fog + the sky colour. Building walls sometimes stand as odd slabs (measured shapes seen from the side).
  It reads as a toy-town, which suits the game, but it is not pretty.
* No moving traffic at all (see above) and parked cars are the engine's static props (some render black — not investigated); the forest has no animals / wind.
* Tram model: the engine prop has no wheels, doors or interior; doors are added by this prototype and are barely visible from the chase camera (the platform side is the right side of travel).
  Two rigid sections cut curves (up to 1 m sag in the R 20 m loop).
* Performance on a real GPU: 60 fps on desktop; with the DetailLayer repainting every 22 m there is an occasional 33-50 ms frame. 1.3-1.4 M triangles even at the low tier (trees);
  real phones were not available, only emulation (WebKit iPhone 13 profile, low tier). The quality scaler is the engine's.
* Timing: the perfect autopilot arrives 3-35 s late as it cannot recover (it paces itself too carefully); a human can beat the timetable. The run is ~6 min, not 3-5, and has 4 stops, not 6-10.
* Offline: the service worker's navigation fallback would serve the main game's shell for `/tramvajs/`, and the tram's assets are not precached (the SW only follows `/`).
* The map ends 135 m behind Mirdzas Ķempes iela (start of the full circuit's far end) — the flat frame ground beyond is visible if you drive on (the track ends there anyway).
* Audio is a minimal procedural hum / bell / chime; untested on iOS hardware (starts on the first gesture).

## Recommendations for the engine (not done here — engine modules were not touched)

1. `Traffic`: a way to switch whole classes off (and keep them off) — `Quality._rung` calls `traffic.setFraction`, which re-enables movers, so the prototype wraps that method on the instance.
2. `DetailLayer.update(x, z, dist)`: gate `dist < 85` and a fixed 110 m window repainted at 22 m steps; a street-level game wants a configurable window / look-ahead offset and ideally an
   incremental repaint to avoid the spikes.
3. `Lighting.update` ties fog to the camera distance (`near = dist*1.9`): expose fog near/far (the prototype overwrites them each frame).
4. `World`: a constructor option for "no hole game" (spawn, placements file checks, mover registration) and a public `hide(obj)` instead of the private `_hide`.
5. `PROP_DEFS.tram`: ship an articulated model (separate sections + doors + wheels), and a few person variants with animation hooks.
6. `vite.config.js` `dataPreload`: apply only to the entries that want it (a per-page flag instead of the path guard added for `/tramvajs/`).
7. `maps`: an `applyMap(slug)` that does not read the URL / localStorage.
8. Low tier on phones still draws ~1.3 M triangles: a street-level tree budget (or LOD) would help most.

## If this prototype is chosen — next steps (rough effort)

| step | effort |
|---|---|
| Full line 11: add the missing corridor (a map rectangle along Brīvības gatve / Sarkandaugava, ~4 km at the 6 km middle) to `tools/maps.mjs` + data build, or a streamed "corridor map"; then one route across 3 worlds | 3-5 days (data build, loading hand-over, stop names) |
| Signals, switches (route choice at junctions), speed boards from real data | 2-3 days |
| Other traffic: cars/pedestrians that react to the tram, priority at crossings, level-crossing barriers | 3-4 days |
| Passengers and fares (door sides, crowding affecting braking comfort, a fare / ticket mini-mechanic) | 2-3 days |
| More lines (centre graph is ready: pick real lines by stop sequence, direction handling, timetable data) | 1 day per line + 2 days for the picker |
| Weather / night / winter (reuse the theme manager; headlights, interior light, wet rails) | 2-3 days (theme manager needs a Game-free mode) |
| Real timetable data (GTFS from Rīgas satiksme, if licensing allows) instead of the generated one | 1-2 days |
| Visual polish: wheels, overhead wires + poles, better tram model, stop furniture from OSM, ground-level LOD | 4-6 days |
| Audio (real bells / motor samples, announcements in LV/EN), haptics, leaderboard / daily run | 2-3 days |
