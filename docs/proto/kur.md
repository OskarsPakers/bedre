# Kur es esmu? ("Where am I?") - prototype

A location-guessing game on the BEDRE map, live at `/kur/` (second Vite HTML entry `kur/index.html` -> `dist/kur/index.html`).
Drop at a random street point at eye level, look around, optionally walk up to 150 m along the street, open a 2D map, pin, confirm.
5 rounds, score `5000*exp(-d/250 m)` (<= 15 m = 5000), reveal with line + distance + nearest address + neighbourhood, summary with
mini-maps, best guess, share text (clipboard: score + `https://bedre.pakers.lv/kur/?seed=..&d=..`), Play again.

## Run
- Dev: `npm run dev` then http://localhost:5173/kur/ . Params: `?seed=abc` (same five spots for everyone), `d=easy|normal|hard`,
  `timer=1` (60 s/round), `map=agenskalns|mezaparks|purvciems` (centre by default), `eye=1.75` (camera height, m).
- Test: `GPU=1 node scripts/smoke-kur.mjs` (`npm run smoke:kur`; `--quick` skips WebKit + landscape). Builds into `scripts/.dist-kur`, serves on :5192.
  Covers Chromium desktop, Pixel 5 (portrait + landscape), WebKit iPhone 13, seeds, 200-spawn audit per difficulty, main game at `/`, service worker.
- Screenshots: `scripts/out/kur-*.png` (start, street-1..8, eye175/eye300, map-pin, reveal, summary, `pixel5-*`, `pixel5-landscape-*`, `iphone13-*`).

## Files
`kur/index.html`, `src/proto/kur/{main,map,spawn,strings}.js + kur.css`, `src/proto/shared/street-world.js` (world without the hole game: renderer,
World, Lighting, SkyDome gradient, Quality tiers; day look = Lighting defaults), `scripts/smoke-kur.mjs`.
Shared-file edits: `vite.config.js` (`build.rolldownOptions.input` lists main + prototypes), `package.json` (`smoke:kur`). No SW / _headers change needed.

## Reused
`loadCity`, `World` (ground, buildings with shapes + sights, trees, props, static movers: never `world.update`d, so parked cars / frozen pedestrians),
`Lighting`, `SkyDome`, `Quality`, ground `DetailLayer` (window set to 80 m around the camera, repainted every ~8 m walked: 19-25 px/m),
`Blockers` (building/water test), `districts-names` (neighbourhoods), `/data/*` unchanged. Map drawn by own `map.js` from the same data.

## Street-level findings (honest)
- Better than expected: the stylised city reads as a place. Old Town lanes, the riverside with the Vanšu bridge, tram streets, boulevards are
  recognisable (street-1/2/7). Plain residential and panel streets are generic: guessing there is mostly "which district-type".
- Eye height 1.75 m chosen: 3 m (kur-eye300-*) only lifts the horizon slightly and loses the "standing there" feel.
- Fixed in own code: near plane 0.15, far 5000, fog 140-1000 m, gradient sky, 84 deg horizontal FOV (vertical clamped 58-100 for portrait),
  tighter shadow window (shadowDist 120 -> ~0.07 m texel), detail-layer window, spawn rules (>= 3.2 m from walls, 10 m and 24 m of open ground along the street
  ahead, no tree/car/kiosk/person within lens range, no dense forest, >= 3 buildings in 60 m, 55 m from the map edge, no bridges, no tunnels).
- Rough (engine-side, not changed): facade windows are a blurry shader mask with no ground-floor detail (shopfronts, doors, signs); sett/cobble
  ground texture is soft up close (low tier especially); frozen "pawn" pedestrians and block cars look odd within 5 m; huge lollipop trees can fill the
  frame; no sidewalks on streets with `sw=0`; a wall can still dominate when the player turns sideways; WebKit and Chromium look identical.
- Recommendations for the engine: a street-level facade pass (ground-floor band, doors, shop windows, signage colour), anisotropic/sharper sett
  texture in the detail layer, per-object LOD for trees, and a `?theme=` that works without the Game (ThemeManager needs `game.light/phase/render`).
- Note: `vite.config.js` `dataPreload` injects the preload of the main game's remembered district (`bedre.map`) into /kur/ too; harmless when
  centre is used, wasted preloads if the player chose a district in the main game and then opens /kur/ without `?map=`.

## If chosen: next steps (rough effort)
- Street-level facade detail + signs (engine shader/geometry): 3-5 days. Biggest recognisability win.
- Real street names (OSM road `name` is stripped from riga.json; add to the data pipeline): 1-2 days; then a street label on the reveal instead of nearest address.
- Daily challenge (fixed seed per date + local best, `?seed=` already works): 0.5 day; shared leaderboard needs the Worker: +2 days.
- Evening / winter themes at street level (needs a Game-free ThemeManager): 1-2 days.
- Walking graph polish (junction choice UI, bridge/tunnel spawns): 1-2 days.
- Duels / multiplayer (same seed, simultaneous, Durable Object room): 5-8 days.
- Photo-style "panorama" mode (6 fixed headings, 360 drag only): 0.5 day if exploration proves too easy.
