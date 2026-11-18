# tools/realistic: the city's photogrammetric reality mesh from a tram's point of view (INTERNAL, LOCAL ONLY)

Everything here is a private local experiment. The mesh tiles / textures are Rigas valstspilsetas pasvaldiba's (GeoRiga) data, licensing for redistribution is not settled:
tiles live only in `tools/.cache/realistic/` (git-ignored), screenshots in `scripts/out/realistic/` (git-ignored). Nothing is wired into `src/`, `public/` or the build; no existing file was edited.

## 1. Playable drive (start here)

```
node tools/realistic/serve.mjs            # then open http://localhost:5197   (port 5197 only; Chrome or Safari)
```
Start page: route picker (with download size and "% cached"), quality (Balanced / High), key list, the licence line. "Drive" opens the game page.
Both routes `centrs-3` (Ausekla iela -> Opera -> Centraltirgus, 3.0 km) and `centrs-1` (Pardaugava -> Akmens tilts -> Berenu pasaule, 4.1 km) were prefetched on this machine
(Balanced); `centrs-2` is listed too (prepare it first). A route that is not cached streams from the city's public service on first drive (tiles are cached as they arrive,
the second drive is instant) but will show soft patches while tiles are still arriving, so prepare first:

```
node tools/realistic/serve.mjs --prefetch centrs-3                  # prints node / vertex counts, "cached x/y files" and the estimated download BEFORE downloading
node tools/realistic/serve.mjs --prefetch centrs-1 --quality high   # more than ~1.5 GB asks for --yes
node tools/realistic/serve.mjs --prefetch centrs-1 --yes
```
(the start page's "Prepare" button does the same in the background with a progress bar.) Downloads are polite: <= 4 concurrent requests, retry with backoff, generic User-Agent, everything cached.

Sizes (Balanced, whole route): centrs-3 ~1.7 GB estimated wire (113 M vertices, 5.6 k nodes), centrs-1 ~2.0 GB (134 M vertices, 5.8 k nodes); High ~3 GB each. Measured here: centrs-3 4 159 + the earlier 5 315
files = 1.2 GB + 1.8 GB decompressed bytes, centrs-1 9 603 files = 3.4 GB decompressed (geometry is stored uncompressed: ~32 B per vertex incl. normals; JPEG textures are small);
the download ran at ~6-14 MB/s, i.e. 3-7 minutes per route on this connection. Disk cache after both routes: ~8 GB (`du -sh tools/.cache/realistic`).

### Controls
`W`/`Up` power (also rings the departure bell when the doors are closed), `S`/`Down` brake, `Space` emergency, `E` doors (in the stop zone), `B` bell,
`C` camera chase / cab / orbit, mouse drag + wheel = orbit around the tram (free look; the orbit camera can go through walls), `T` autopilot (the game's `perfectDriver`),
`F` haze on/off, `[` `]` nudge the track 10 cm sideways (saved per route in localStorage), `G` hide HUD. HUD: speed, limit, next stop + distance + due time, doors, lever; bottom right: fps, tiles, texture MB, triangles.
The stops, timetable, door/dwell logic and scoring come from the game's own `Run` (a full `centrs-3` autopilot run serves all five stops "perfect").
No M (low-poly overlay) key: not done. No time of day / weather: the light is baked into the photos.

### How it works
* `serve.mjs`: static server + caching proxy. `/i3s/<layer>/...` serves node pages, `geometries/0` and `textures/0` from `tools/.cache/realistic/i3s/` and fetches missing ones politely; `/api/index/<route>`, `/api/routes`, `/api/prefetch/<route>`, `/api/offsets/<route>`.
* `index.mjs`: **route index**: the I3S node tree of every layer around the route (<= 600 m), nodes down to ~3 cm + 1 cm/m estimated vertex spacing, compact JSON (`index-<route>.json`, 3.8 MB for centrs-3).
* `select.mjs` (shared by browser and node): LOD cut. Nodes are chosen by distance to the **camera** (ahead counts 0.7x, behind 2.2x) against a target vertex spacing `F0 + F1 * d` (Balanced 0.12 + 0.03 d, High 0.07 + 0.018 d); node-switching LOD, a cut never contains a node and its ancestor. Loading uses a finer, earlier cut (distance x 0.6), so a node is normally resident before it is drawn.
* `play/drive.js`: displays ready nodes; a not-ready node falls back to its nearest loaded ancestor (or loaded descendants), an ancestor in the set hides its descendants (no double geometry, no hole unless nothing near is loaded); loading in 3 workers (`tile.worker.js`: fetch, decode, mercator -> game frame, `createImageBitmap` with resize, all off the main thread); textures are uploaded (`renderer.initTexture`) with a 2.5 ms budget per frame; memory budget with LRU eviction (Balanced 900 MB, High 1300 MB of decoded textures); texture size capped by distance at load time (Balanced 512 k / 128 k / 32 k texels within 45 m / 110 m / beyond).
* Ground height under the track: ray casts into the loaded mesh (median smoothed), tram modules and bogies follow it (pitch per module, so bridges and ramps work); camera heights follow the ground.
* Tram: the game's `TramModel` (articulated, imported read-only from `src/proto/tram/`), hemisphere + sun light, soft contact shadow blob per module.
* Imported unmodified from `/tram/`: `track.js` (buildTrack), `sim.js` (Run, makeRun, perfectDriver, TRAM), `tramModel.js`. Nothing was copied.
* Rail snap: an automatic detector exists (`calibrate-run.mjs`: top-down ortho strip of the mesh, brightness profile averaged along the track, two-rail template) but is NOT enabled: on the test stretch it locked onto the middle of a double track (1.3 m off). The finding there: the OSM line was within ~0.2 m of the real rail pair, so the default offset is 0; use `[` `]` where it is off.

### Measured (Chromium + Metal GPU on this MacBook, 1440x900 at devicePixelRatio 2, autopilot, whole `centrs-3` 3 009 m in 465 s, `scripts/out/realistic/drive-trace-*.json`)
frame time p50 16.7 / p95 16.7 / p99 16.8 ms (vsync-locked 60 fps), max 33 ms, **0 frames > 50 ms** over 27 887 frames; peak decoded texture memory 821 MB (budget 900 MB), peak triangles per frame 1.83 M (about 0.7-2.6 M shown),
6 041 tiles created / 5 218 evicted in the run, 0 tile errors, texture uploads kept to 2.5 ms/frame. See section 3 for the centrs-1 numbers, LOD swap checks and what looks bad.


## 3. Verification of the playable drive (Chromium + Metal GPU, autopilot, whole routes; WebKit smoke)

| run | distance / time | frames | p50 / p95 / p99 frame | max | > 50 ms | peak tex memory | peak triangles | LOD swaps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| centrs-3 Balanced, 1440x900 @2x | 3 009 m, 465 s, all 5 stops "perfect" | 27 874 | 16.7 / 16.7 / 16.8 ms | 33.4 ms | 0 | 831 MB | 1.89 M | 1 500 cut updates, 374 with a coarser stand-in node, 0 with nothing to draw |
| centrs-1 Balanced, 1280x720 (screenshots every 9 s) | 4 040 m, 600 s, all 7 stops "perfect" | 36 010 | 16.7 / 16.7 / 16.8 ms | 33.3 ms | 0 | 875 MB | 2.05 M | 2 192 updates, 464 stand-in, 15 with a hole for a moment (51 nodes) |
| centrs-3 WebKit (Playwright) | smoke only: loads, streams, renders, 729 tiles, 0 errors | | 60 fps | | | 410 MB | | |

The frame times are vsync-locked 60 fps (the only > 16.8 ms frames are single missed vsyncs: 33 ms; 0 frames above 50 ms) and no hitch was caused by tile work: decode / resize run in workers, texture uploads are capped at 2.5 ms per frame,
the cut selection costs well under 1 ms. (A hitch table is written to `drive-trace-*.json`; it is empty.) Not measured: a slower machine, a phone, a cold start streaming from the internet (tiles arrive slower than at 46 km/h: expect soft patches; that is why `--prefetch` exists).
Traces: `scripts/out/realistic/drive-trace-centrs-{1,3}-balanced-chromium-*.json`; frames I looked at: 51 (centrs-3) + 66 (centrs-1) screenshots from the continuous runs (`drive-frames/`, centrs-1 set kept) as contact sheets.

Files: `demo-drive.mp4` (27 s continuous recording of a real drive, Opera stretch, chase camera, autopilot), `demo-c3-*.png` (frames from it), `demo-c1-*.png` (centrs-1: riverside, Akmens tilts approach, left-bank junction), `demo-bridge-synthetic-deck.png`, `demo-webkit-*.png`.

### What looks or behaves badly (frank)
* **The Akmens tilts bridge and the Daugava are not in the mesh tree**: no layer has nodes under the bridge (the spike's SDK picture of the bridge could not be reproduced from the I3S node trees I walked; the only layer there, `Pazeme_10_07_2024_upd_wgs`, is a coarse terrain at that point). The game therefore draws a plain grey deck ribbon and a flat green water plane under the track wherever ray casts into the mesh miss, with the Old Town skyline (real mesh) ahead. It is NOT spectacular. The Old Town riverside itself (11. novembra krastmala) is on the far bank of the route and shows only as a coarse skyline.
* Trees: blobs with black holes under the crowns and floating slabs; the first ~500 m of `centrs-3` (Ausekla iela, Kronvalda parks, a construction site in the mesh) are dense leaf cover, a poor start; the track runs through crowns.
* Mid-distance (30-100 m) buildings are visibly simplified in Balanced (stretched / "melted" facades, e.g. the left-bank blocks of centrs-1); High is better but costs ~1.7x the download and ~1.2 GB texture memory.
* Frozen photo light and shadows, ghost cars and people, lamp posts and signs bent or detached ("flying" lamp heads), no overhead wires.
* A not-yet-loaded node is replaced by its parent (coarser) for a moment: visible as a soft pop when a refined tile arrives; there were no double surfaces, but 15 momentary holes on centrs-1 (a few nodes for a few frames) when fast driving outran loading.
* Switching camera view (C) right after a long pause shows coarse tiles for ~1 s until the finer ones arrive; the orbit camera clips into walls.
* The OSM line was within ~0.2 m of the rails where I checked (an automatic rail snap that I tried was wrong on double tracks and is disabled); other places may be off, use `[` `]`.
* `centrs-2` was not prepared or tested; there is no M key (low-poly ghost overlay).

## 4. Plan for baking real facade textures onto the game's building shapes (next step)

Facts from this work: the mesh textures have a ground sample of ~4.6 cm per texel at the finest nodes (facade crops like the Opera are crisp at 10 cm); the finest geometry (triangle edge ~0.3 m) smears ground floors, shop glass and anything thin; trees, cars, lamp posts and awnings are baked into the photos; the light is the capture day's sun.
The game side: footprints + measured heights / planar roof planes in `public/data/<map>/riga-shapes.bin.gz` (built by `tools/detail/build-meshes.mjs`), i.e. every building already has walls (footprint edge x ground..eave) and roof polygons.

1. **Capture per wall by orthographic depth-band render** (offline, new `tools/bake/`): for each wall quad make an orthographic camera normal to it and render the loaded mesh nodes (finest LOD from the same I3S cache, same code as `drive.js`) with a near/far slab of [-0.4 m behind, +1.5 m in front of] the wall plane: tree blobs, cars, lamp posts and neighbouring walls farther than 1.5 m in front are clipped away, balconies and cornices (< 1.5 m) are kept. Alpha = covered. Roofs: top-down ortho render per roof plane with a slab of +-1 m around the plane. Do it in Playwright Chromium on the GPU (the proven stack here).
2. **Fill holes** (tree occlusion, glass): multi-scale push-pull inpainting from valid neighbours, fall back to the facade's median colour; mark the fraction filled so a facade that is > 60 % guessed keeps the game's own procedural windows over a flat colour.
3. **Ground floor** (below ~3.5 m): smeared by photogrammetry and full of parked cars / people: either keep at half resolution and darkened, or replace with a procedural shopfront strip using the sampled wall colour; keep upper floors real.
4. **De-light**: divide by a large-radius luminance estimate (~3 m) clamped to 50 %, so the baked shadow edges soften and the game's own sun / night modulation still works; accept that cast shadows of neighbours remain partly baked.
5. **Resolution and size** (rough, per building ~80 m perimeter x 18 m + 400 m2 roof = ~1 850 m2): at 25 cm/px about 30 k px, at 10 cm/px about 185 k px. KTX2/ETC1S (~1 bpp) is 4 KB / 23 KB per building; transcoded on the GPU as BC7 / ASTC 4x4 (8 bpp) it is 30 KB / 185 KB of GPU memory. The centre map (~5 300 buildings): 25 cm/px = ~160 M px = ~20 MB download, ~160 MB GPU if everything is resident; 50 cm/px = ~5 MB / ~40 MB. Recommendation: 10-15 cm/px on the facades visible from the tram corridors and the hero buildings (a few hundred buildings, ~30-50 MB download, ~150 MB GPU), 25-50 cm/px for the rest, roofs 20-25 cm/px.
6. **Runtime in the game**: one atlas page set (2048^2 KTX2) per map chunk, a second UV set on the building mesh, one extra texture sample in the building shader (the game currently uses vertex colours and a procedural window shader), LOD by distance (drop the second UV / texture beyond ~150 m). Phones: budget <= 150 MB GPU: 25 cm/px far ring + 12 cm/px near ring only, ASTC 6x6. The extra download is the atlas set; the game's current shapes file is ~9 MB, so expect +30-60 MB for a "good" map. All of it hinges on a written permission from the municipality (derived small textures are still redistribution).
7. **First proof (1.5-2 days)**: 20 buildings around the Opera (Aspazijas bulvaris / Elijas iela): take their cadastre ids from `riga-shapes`, render each wall and roof at 12 cm/px with the depth-band method from the cached `centrs-3` tiles (they are already local), fill holes, pack, and show in a three.js page next to (a) the current game building and (b) the mesh, from the tram chase / cab cameras (reuse `play/drive.js` camera rules and `tools/realistic/sheet.mjs`). Success criterion: the Opera and the Neo-classical block opposite read as the real buildings from the cab at 20-40 m, with no trees stuck on facades and no baked car on the pavement; report atlas KB per building.

## 2. Earlier spike (A / B / C), kept for reference

Internal only. The mesh tiles / textures are municipal data with an unsettled redistribution licence: everything downloaded lives in
`tools/.cache/realistic/` (git-ignored), screenshots in `scripts/out/realistic/` (git-ignored). Nothing here is wired into `src/`, `public/` or the build.
Nothing existing was edited; the page is served by `server.mjs` on port 5197 only.

## Stretch chosen

Route `centrs-3`, arc length **s = 1100 .. 1550 m** (about 450 m; the C corridor covers 1150..1550): from the Raina bulvaris / Aspazijas bulvaris crossing past the
**National Opera** (stop "Nacionala opera" is at s = 1388) towards the Centraltirgus side. Why: Opera + Neo-classical street walls on both sides, a tram track in an
open street (few overhanging trees), crossings, parked cars, a tree-lined park edge: the full range of good and bad. Also tried: s=900 (Kalpaka bulvaris: the
camera sits inside chestnut crowns, bad), s=1650 (Centraltirgus end: open tracks, hedges, floating lamp posts, less recognisable).

Camera poses mirror `src/proto/tram/main.js updateCamera` (chase: 33.4 m behind the first door, 1.3 m right, 7.0 m up, looks 48 m ahead; cab: 2.9 m ahead of the
door, **2.4 m above the rail** as requested (the game uses 3.15), looks 60 m ahead). Vertical FOV 48 deg (chase) / 70 deg (cab; the game's 78 is very wide),
16:9. `poses.mjs` computes them from `track.js buildTrack` (route polyline -> same smoothed track as the game).

## What is here

| file | what |
| --- | --- |
| `server.mjs` | static server, port 5197 (serves tools/realistic, the cache as `/cache/`, `node_modules/three`, `src/proto/tram` read-only as `/tram/`) |
| `poses.mjs` | route + arc length -> chase / cab / tram poses (local metres, lon/lat) |
| `a.html`, `lib.mjs`, `a-run.mjs`, `probe.mjs` | **A**: ArcGIS Maps SDK 4.30 SceneView on web scene `0f550060...`, `qualityProfile: "high"`, sun lighting + atmosphere, no UI; waits for `view.updating === false` three times in a row (cap 30 s) + 3.5 s settle; Playwright Chromium with `--use-angle=metal`, 1600x900 at deviceScaleFactor 2 |
| `export-tram.html/.mjs`, `b-test.mjs`, `b-run.mjs` | **B**: the game's `TramModel` exported to glTF with three's `GLTFExporter` (233 KB, in the cache), shown as a `point-3d` / `object` symbol layer (`resource.href`) on a `GraphicsLayer` (absolute-height) at the track centre with the track heading (`hOff` 180 deg: glTF forward axis) |
| `c-fetch.mjs`, `c.html`, `c-run.mjs`, `c-seq.mjs` | **C**: corridor selection + download from the I3S services and a plain three.js renderer with the game's own `track.js`, `TramModel`, camera rules |
| `g-run.mjs` | screenshots of the current low-poly game from the **live site** at the same poses (uses `__tram.setCamera` + `run.s`) |
| `sheet.mjs` | contact / comparison sheet maker (Playwright, no ImageMagick on this machine) |
| `layers.mjs`, `c-stats.mjs` | probes (which layers cover a box, node statistics) |

### Reproduce

```
node tools/realistic/server.mjs &                                   # :5197
node tools/realistic/a-run.mjs                                      # A: a-chase-*/a-cab-* (10 positions, ~25 min incl. tile streaming)
node tools/realistic/export-tram.mjs                                # tram.glb -> tools/.cache/realistic/
SS=1130,1200,1250,1300,1380,1480 node tools/realistic/b-run.mjs     # B stills + 100 frame sequence (b-frames/)
LEAF_D=0 node tools/realistic/c-fetch.mjs centrs-3 1150 1550 100 0.08 0.02   # C download (cached, 4 concurrent, generic UA, retry/backoff)
node tools/realistic/c-run.mjs 0 ; node tools/realistic/c-seq.mjs   # C stills (c-*), c-frames/, fps
node tools/realistic/g-run.mjs                                      # current game, live site
ffmpeg -framerate 10 -i scripts/out/realistic/b-frames/f%03d.png -c:v libx264 -pix_fmt yuv420p b-sequence.mp4   # same for c-frames
```
`c-fetch.mjs` arguments: route, s0, s1, corridor radius (m), F0, F1: a node is taken when its estimated vertex spacing <= (F0 + F1 * distance to track) m, else
its children are walked; all layers overlapping the box are used (no de-duplication: the layers are essentially disjoint; an earlier per-cell de-duplication
dropped the Old Town layer on the east side of the street and left holes).

## Results

### A (ArcGIS SceneView): succeeded, this is the ceiling of the data

Files: `a-chase-{1100..1550 step 50}.png`, `a-cab-*.png` (3200x1800), `contact-a.png`. The finest LOD really is reached at street level (building ornament, tram
rails, road markings, manholes, number plates are readable); the SDK refines per screen error, so the near facade is the sharpest of the three methods.
Settle: ~35 s per position pair the first time (tile download), faster when the browser cache is warm. I could not read the SDK's node LOD directly (the tile
requests come from workers); "finest LOD" is judged visually and by the fact that A is sharper than C's selection near the camera.
Ground / camera height comes from `scene.ground.queryElevation` (world elevation, ~4-5.6 m on this stretch) and matches the mesh within ~0.3 m (the cab camera sits
at about the right height above the rail by eye).

### B (tram in the SceneView): succeeded

`b-chase-{1130,1200,1250,1300,1380,1400,1480,1500}.png`, `b-sequence.mp4` (100 fixed positions at 0.9 m spacing = 9 s at 10 m/s, replayed at 10 fps, 1280x720).
The tram is the game's model as a **rigid straight glb** (no articulated bending in curves; fine on this near-straight stretch), flat game shading (no mesh
lighting/shadows), so it looks pasted-in next to the baked-light photo texture. Frames are NOT real-time streaming: each is rendered after the view stopped
updating (about 2.7 s per frame); the sequence shows that the tile set is stable (no popping between frames once loaded), not the live behaviour of the SDK
while driving. `RenderNode` + three.js was not needed (glTF symbol is enough for a proof).
Hero: `hero.png` = `b-chase-1250.png` (chase camera behind the tram, Opera on the left, Neo-classical block right, parked cars, rails).

### C (three.js, the game's own renderer): succeeded

`c-chase-*.png`, `c-cab-*.png` (1150..1550; 1100 lies before the corridor start so the ground is missing: ignore `c-*-1100`), `c-sequence.mp4`.
Fetch: node pages -> select nodes -> `geometries/0` (uncompressed: header 8 B, `position f32x3`, `normal f32x3`, `uv0 f32x2`, then featureId/faceRange tail that is
ignored) + `textures/<material.resource>/0` **JPEG** (every layer has jpg; ktx2/dds only in some). Vertices are relative to the node OBB centre in web-mercator;
local x = (mx - mx0)/1.834, z = -(my - my0)/1.834, y = mesh z. No uvRegion/atlas, UVs are 0..1 per node texture. **Gotcha:** the image must NOT be flipped
(`createImageBitmap(..., {imageOrientation:'none'})`, `texture.flipY=false`); flipped, the textures look scrambled. Unlit `MeshBasicMaterial` (light is baked in the photos), mipmaps + anisotropy 8.
The game's tram uses `MeshStandard` so two lights were added; ground height under the track is found by ray-casting the loaded mesh (median-smoothed).

Numbers for the corridor s 1150..1550, +-100 m, F0 = 0.08 m, F1 = 0.02:

| | |
| --- | --- |
| nodes | 648 (461 region_3_wgs, 181 vecriga_lod_rebuilt_wgs (Old Town side of the street), 3 + 3 others), tree depths 3..11 |
| download (this session, new) | 1 372 requests, **~108 MB on the wire** (geometry gzip; 60 geometry files came from the existing `tools/.cache/detail` cache) |
| on disk | geometry **258 MB** (uncompressed `geometries/0`), textures **33.5 MB JPEG** (650 files) |
| vertices / triangles | 9.4 M vertices, 3.1 M triangles loaded (non-indexed); about 2.0 M triangles and 446 draw calls rendered per frame (frustum culled) |
| texture memory | 650 textures, **~2.4 GB** decoded RGBA incl. mips (up to 2048x1024 per node): far too much for a phone, OK on this GPU |
| detail at the track | mean triangle edge ~0.3 m (median of 60 nearby region_3 nodes, p10 0.22 m), texture ground sample ~4.6 cm per texel |
| load time | 0.8 s from local disk cache into GPU (this is the parse/upload part only; over the network the ~108 MB + 33 MB takes whatever your link does) |
| frame time | locked to vsync: 60 fps, p50 16.7 ms, p95 18.1 ms over 2 280 frames driving 380 m at 10 m/s; one 181 ms hiccup at the first frame (Apple GPU via Metal, Chromium) |
| streaming | none needed for 400 m, the whole corridor is resident. A 3 km route would need ~7x geometry+textures (~0.8 GB wire, ~17 GB raw texture memory if kept) so it must stream in/out |

Quality of C vs A: the same data, but C is a fixed LOD cut: the near-track facades are slightly softer (mesh edge ~0.3 m, visible smearing in the right-hand
block in `c-chase-1250`) while A uses the finest nodes where the camera is close. Lighting is identical (baked). No tone mapping, so colours are a little flatter
than the SDK (which applies its sun/atmosphere shading to the photo textures).

### Current game (G)

`g-chase-*.png`, `g-cab-*.png` from the live game (high quality, day theme), same poses. Note how few of the Opera/Neo-classical features survive:
beige boxes with regular dark windows, tile-orange blocks, low-poly round trees, the Opera without its portico, pillars, statues.

### Comparison sheets

`compare-chase.png` (rows s = 1200, 1250, 1300, 1400, 1500; columns: current game | ArcGIS + tram (B) | three.js (C)),
`compare-cab.png` (same, cab view, no tram: game | A | C), `contact-a.png` (all A views).

## What looks good / bad at tram level (frank)

Good: building facades above the first floor (cornices, balconies, windows, the Opera: unmistakably Riga), road surfaces with tram rails, cobbles, crossings and
markings, shadows already baked in, parked cars at a recognisable level, distant skyline. The sense of "being on a real street" is far beyond the low-poly game.

Bad: (1) **trees** are solid blobs with black/dark under-sides and holes, and some are "floating" slabs detached from the ground (see the cab views at s=1250, 1400,
1500: dark canopy walls and floating tree fragments); (2) ground floors are smeared: shop windows are mush, glass is a blue-grey texture, awnings melt into the
facade; (3) cars are fused to the road ("melted", wheels missing, white ghost cars); (4) **no overhead wires, thin poles or lamp posts in clean form**, lamp posts are bent/
half-transparent, thin things (street signs, traffic lights) are blobs or missing; (5) the photos have the **baked sun of the capture day**: shadows are frozen, no
night, no weather, a single light direction (the game's day/night/theme system cannot work on it); (6) holes under canopies and balconies show black or sky;
(7) moving things (pedestrians, vehicles) are baked in as frozen ghosts, sometimes cut off; (8) the OSM/game track line is within ~1 m of the real rails but not
exact (the game's tram can sit slightly off the real rail pair; in C and B I did not snap it to the photographed rails); (9) the mesh is a single frozen surface: you cannot
open a tram door onto a platform, there are no stop objects, nothing to interact with, no collision.

## Verdicts

Licence: nothing in the item/layer metadata grants redistribution (`licenseInfo` empty, `accessInformation: Rigas valstspilsetas pasvaldiba`, copyright "Generated with
Agisoft Metashape"; see `tools/detail/README.md`). Every option below that ships mesh-derived imagery depends on a written permission from the municipality (GeoRiga).

1. **Ship the tram game on the real mesh (streamed I3S in three.js).** Technically feasible: C proves a 400 m corridor renders at 60 fps on a desktop GPU with
   a 160 MB download. But: a 3-4 km route is ~1 GB over the wire and needs a proper LOD/streaming loader (I3S node selection by screen error, texture eviction,
   KTX2/Basis re-encoding to cut 2.4 GB to ~0.4 GB), a 500 KB-per-node request storm to a third-party server that is not a CDN for a game (and may rate-limit or change),
   no night/weather, no gameplay objects (stops, signals, wires, pedestrians have to be added on top anyway), and phones will not hold it. Effort: 4-8 weeks for a
   desktop-only version, much more for phones; risks: licensing (blocker), hosting cost, service stability, visual flaws above at the very distance the player looks.
   **Not recommended as the main game.**
2. **Hybrid.** (a) Real mesh as distant/skyline backdrop, low-poly near the track: the near-track part is exactly what the game needs and exactly where the mesh is worst
   (trees, wires, cars) and the seam between two renderings would be ugly; low value. (b) **Facade/roof textures from the mesh baked onto the game's building shapes**
   (per-building atlas, projected from the mesh): the game already has footprints and measured roof shapes, the mesh textures are the sharpest part of the data (C shows
   the Opera facade at ~5 cm/texel), and baked per-building atlas pieces would give real colours, windows and ornament at ~1-3 MB per block of buildings at 512 px per facade.
   Effort: 3-5 weeks (UV projection per wall, de-lighting of the baked shadows, atlas packing, KTX2 output, tooling in `tools/`), risk: texture licensing (same blocker, but the
   shipped artefact is a derived small image, still arguably redistribution), shadows baked in, occlusion by trees/cars in the source photos.
   Visual gain: large; this is the best value per byte.
3. **Keep low-poly, improve it using the mesh (no mesh pixels shipped).** Sample the mesh texture colour per building (wall colour, roof colour, ground floor vs upper
   floor, window rhythm detected from the mesh), more roof detail (already partly done in `tools/detail`), add street furniture where the mesh has it. Effort: 1-2 weeks,
   no licence issue (only measurements are used, like the existing height measurements), moderate visual gain: it removes the worst mismatches seen in the comparison
   (beige boxes where the real buildings are pink/grey/yellow, no ornament) but it will never look like the hero shot.

**Recommendation: do (3) now (cheap, safe) and prepare (2b) as the "looks real" upgrade, gated on a written permission from the municipality; do not build (1).**
Ask GeoRiga first, with `hero.png` and `compare-chase.png` as the pitch: if they permit derived facade textures, (2b) gives most of the look at game-sized data.

## 5. Streaming round 2: look-ahead along the route (after the owner saw detail arrive late)

What changed (`play/drive.js`, `select.mjs`, `serve.mjs`, `play/tile.worker.js`, `prefetch.mjs`, start page; the old behaviour is kept as `?legacy=1` for before/after runs):
* **Predictive loading**: every 8 m of the next H metres of track (H = look-ahead seconds x speed, clamped: Balanced 25 s, 400-650 m; High 30 s, 500-800 m; Ultra 35 s, 650-1000 m; +300 m while standing at a stop) gets its FINAL detail cut (distance scale 0.8, i.e. slightly finer than needed) for the chase camera, the cab camera and the tram itself (orbit). The union is the load queue, ordered by arrival then distance; the cut for the current camera goes first. Cut selection costs ~0.02 ms, so the full look-ahead is recomputed continuously, time-sliced (1.6 ms/frame).
* **Texture size by future distance**: a node's texture cap comes from the smallest distance the tram will have to it (Balanced: full resolution within 35 m, 1 M texels to 80 m, 256 k to 150 m; High 50/110/200 m; Ultra full resolution to 130 m), not the distance when it was requested.
* **Memory**: eviction is "behind first" (anything the display cut or look-ahead still needs is protected); the look-ahead is truncated when its estimated texture bytes reach 60 % of the budget; requests pause when the budget is full.
* **Throughput**: 6 workers (was 3), 16 requests in flight (was 8), ONE request per tile (`/tile/<layer>/<geometry>/<texture>` returns both: browsers allow ~6 connections per host, two requests per tile halved the effective concurrency), keep-alive 120 s, texture upload budget 6 ms per frame when the frame has headroom (2.5 ms otherwise), warm start: the first ~400 m ahead must be resident before the drive starts.
* **Camera switch**: chase and cab cut are both in the look-ahead set, so C is instant when the tram is moving through prepared tiles; orbit refines around the tram.
* **Indicator** (key I, off by default): sharp ahead (m), loaded ahead (m), pending tiles, texture MB / budget. Key X = wait-for-sharp (brakes when sharp-ahead < 80 m).
* **Presets** (start page): Balanced (texture budget 1.1 GB, was 0.9), High (1.5 GB), Ultra (3.2 GB, full-resolution textures to 130 m, needs 16 GB+ unified memory). Expected download of the whole route (estimate, JPEG textures + geometry): centrs-3 Balanced 1.8 GB / High 2.9 GB / Ultra 4.0 GB; centrs-1 Balanced 2.0 GB / High 2.9 GB / Ultra 3.8 GB. On this machine Balanced is fully cached for both routes; High needs ~1.2 GB more per route, Ultra ~2.2-2.5 GB more.
* **Start page**: each route shows "Prepare route (X GB)" prominently when it is not fully cached, a note that driving before preparation will look soft, and the download runs in travel order (the start of the route is ready first).

Measured, autopilot, whole routes, Balanced, Chromium + Metal (before = `?legacy=1`, after = new; `scripts/out/realistic/preload-trace-*.json`). "Sharp ahead" = metres of track ahead whose flanking nodes (within 120 m, final cut) are resident; it is capped by the look-ahead horizon (400 m at walking pace of the tram, up to 650 m).

| | centrs-3 before | centrs-3 after | centrs-1 before | centrs-1 after |
| --- | --- | --- | --- | --- |
| sharp ahead min / p10 / median (m) | 0 / 0 / 0 | 0 / 16 / 400 | 0 / 0 / 0 | 0 / 120 / 400 |
| frames with any node within 100 m ahead coarser than final | 19.5 % | 2.4 % | 17.5 % | 2.3 % |
| coarse stand-in nodes drawn (sum over cut updates) | 1 163 | 85 | 1 820 | 114 |
| camera switch to cab, median (ms; measurement floor ~120) | 450 (max 2 073) | 128 (max 456) | 243 (max 442) | 127 (max 342) |
| frame time p50 / p95 / p99 | 16.7 / 16.7 / 16.8 | 16.7 / 16.8 / 16.8 | 16.7 / 16.7 / 16.8 | 16.7 / 16.7 / 16.8 |
| worst frame / frames > 50 ms | 33 ms / 0 | 50 ms / 0 | 33 ms / 0 | 50 ms / 0 |
| peak decoded texture memory | 850 MB | 1 195 MB | 846 MB | 1 204 MB |
| peak triangles per frame | 2.0 M | 2.2 M | 2.0 M | 2.0 M |

Hitch-free: 0 frames over 50 ms in all runs (1-2 frames at 33 ms in the new runs; about 20-50 main-thread slices of 30 ms CPU time inside a frame that still made vsync, they coincide with batches of texture uploads: the table in the JSON lists them).
Frames: `scripts/out/realistic/preload/preload-{before,after}-<route>-<s>.png` at the same track positions every 60 m (51 pairs on centrs-3, 68 pairs on centrs-1, looked at as 4x6 contact sheets), `preload/preload-presets-centrs-1-2520-*.png` (Balanced | High | Ultra at the same spot), `preload-clip.mp4` (24 s drive with the new loader).

Frank: in stills, before vs after look nearly the same, because the coarse tiles were only on screen in ~1 frame in 5 and for fractions of a second; the change is that they no longer appear (19 % -> 2 % of frames), camera switches are instant, and the loader does not fall behind at 46 km/h. What still looks soft is the data and the preset, not the loader: buildings 30-100 m ahead in Balanced are drawn from nodes with ~1-3 m vertex spacing (F = 0.12 + 0.03 d) and the source facade geometry itself is simplified (leaf nodes of some buildings have few vertices); High and Ultra are visibly crisper there (see the preset sheet) for 1.5x / 2.2x the download and 1.3x / 2.4x the texture memory. Remaining late arrivals (2 % of frames, p10 sharp-ahead 16 m on centrs-3): the first metres after a stop or a sharp turn (new view directions need nodes that were outside the look-ahead cone), eviction churn when the 1.1 GB budget is full (the look-ahead is then truncated rather than exceeding it), and a cold network (tiles not prepared).
