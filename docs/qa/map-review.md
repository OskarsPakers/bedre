# BEDRE — Rīga: map review against the GeoRīga 3D reality mesh

Reviewer run, 2026-11-16. Nothing in `src/`, `worker/`, `public/` or existing tools/scripts was changed. New code: `tools/qa-map/*`, `scripts/qa-map/*`. Game-side evidence: `scripts/out/qa-map-*.png`. Reference imagery (real mesh renders, mesh hillshades, orthophoto crops) is internal only and lives in `tools/.cache/qa-map/` (git-ignored): `ref/`, `game/`, `sheets/` (reference | game side-by-sides), `evidence/`.

## 1. Bottom line

* **Heights are mostly right.** 96 % of the 4 448 centre buildings that have usable mesh data (84 % of 5 276) are within max(4 m, 25 %) of the measured mean height; only 14 are under-rendered by that margin. The tier-A sights have the measured tops (Z-Towers 128 vs 132 m, Saules akmens 120 vs 121, St Peter 121 vs 123, Hotel Latvija 94 vs 97, Zinātņu akadēmija 107 vs 107).
* **No systematic misregistration** (median footprint-to-mesh shift 0,0 m on every map, median |shift| 1.0 m at the 1 m raster resolution).
* **Water, shorelines, the three bridges, Ķīpsala, Zaķusala: match** (see section 5).
* The real errors are of five kinds: (1) things the mesh shows as *not a building* but the game extrudes (stadium, courts, vacant lots, courtyard "aux" pieces, tree/crane spikes baked into shapes, one 60 m wedge on Rīgas pils); (2) the opposite, a few big "aux" polygons rendered as 3 m slabs over plazas/parks; (3) **tree cover**, above all Mežaparks (dense pine forest in reality, open lawn in the game); (4) roof / wall colour families in the Old Town and several sights; (5) a few dozen buildings missing from the cadastre-derived set (mostly Āgenskalns, Mežaparks, map edges).

## 2. Method and coverage

**Reference mesh (numeric).** Full-map 1 m max-elevation rasters (DSM) rasterised from the I3S nodes of the public GeoRīga layers (same tooling as `tools/detail`: `tools/qa-map/dsm-full.mjs`, spacing 1.0 m, `Pazeme*`/`LGIA_LOD2` excluded). Cache first, polite fetch for the missing nodes (≤ 4 concurrent, generic UA). **Fetched: centrs 27.4 MB wire (544 requests, 77 MB raw), Āgenskalns 6.9 MB, Mežaparks 44.4 MB, Purvciems 0.9 MB: 79.6 MB wire in total** (the rest was already cached). So the **whole centre box (3.3 x 2.7 km) was covered**, not only a sample, and all three districts. Mesh holes: 17 % of centre cells are NaN (water, outside the layers).
Coverage of buildings with usable mesh stats (cover >= 60 %, >= 20 cells): centrs 4 448/5 276 (84 %), Āgenskalns 3 914/7 165 (55 %), Mežaparks 1 326/1 870 (71 %), **Purvciems 508/3 379 (15 %)**.

**Game side (numeric).** Final rendered values dumped from the running game (`window.__life.world.buildingItems`, vite on :5188; `scripts/qa-map/dump-game.mjs`) plus the shapes records parsed from `public/data/**/riga-shapes.bin.gz` (the game nulls `item.rec` after building, so `rec.hmax/eave/vol` come from the file; `tools/qa-map/lib.mjs loadRecs`). Rendered "body" height = `rec.vol/area` for shaped buildings, else `hBox` (flat extrusion height); rendered top = final `item.h` (includes sight decorations such as flagpoles/spires).
Mesh measures per footprint: ground from the 1–4.5 m outside ring (as in `tools/detail`), mean/p50/p90/p98 and a *smooth-cell* mean/top (cells with roughness > 1.3 m on a 5x5 window and >= 3 m high are treated as tree canopy; calibrated: canopy median roughness 2.07, roofs 0.65).

**Checks run** (`tools/qa-map/`): heights (`buildings.mjs`, `heights.mjs`), missing buildings (`missing.mjs`: >= 4 m above a 44 m-window local minimum, smooth, no footprint within 3 m, not water/ballast/bridge/rail, wall test, >= 60 m² after opening), extra buildings/phantoms, alignment (best 1 m shift of footprint vs mesh edge, +-7 m), roof form, ground (`ground.mjs`, `shore.mjs`, `streets.mjs`, `canopy.mjs`), bridges/islands (visual).

**Reference imagery.** Method (1) worked: a local HTML page with the ArcGIS Maps SDK for JavaScript 4.30 (`tools/qa-map/ref.html`) loads web scene `0f550060…` in a SceneView, camera computed from game-local coordinates, Chromium via Playwright with Metal GPU, wait for `view.updating === false` (30 s cap), one request stream, one view at a time (≈ 10–20 s each). 96 views rendered. The browser's tile traffic was not metered (the SDK loads node/texture tiles itself; order of a few hundred MB for ~100 views is plausible, unmeasured). Game images use the same cameras (game free camera, `?theme=day&quality=high`, fog off, vertical fov 30.8° to match the SDK's 55° diagonal at 800x500).
Views: 62 sights/places (15 Old Town, 10 ring, 13 centre, 7 left bank, 3 bridges, 14 district sights) + 19 street views (8 centre, 4 Āgenskalns, 3 Mežaparks, 4 Purvciems) + 14 defect close-ups. Every centre/Āgenskalns/Mežaparks pair was looked at, except the Mežaparks/Purvciems street sheets (Mežaparks seen through the villa views; Purvciems has no reference, see gaps). Verdicts below are **visual impressions** unless a number is given; numbers are **measured**.

**Limits of the numbers.** 1 m raster at spacing 1.0 m: thin spires are shaved (fine 0.5 m grids from the earlier analysis are used for the notable buildings). The mesh date (about 2023–24) is not the cadastre date: where the mesh shows a vacant plot but the cadastre has a building, the building may have been built (or demolished) since; those cases are labelled "date?".

## 3. Findings (ranked by importance to a player who knows Riga)

Severity: M1 = a Riga resident calls it wrong at a glance, M2 = noticeable on inspection, M3 = minor. "Cause / fix" is one line each.

| ID | cat | where (name, id, local x,z) | game vs real | evidence | sev | cause / fix | status (2026-11 fix pass) |
|---|---|---|---|---|---|---|---|
| M-01 | ground / trees | whole Mežaparks map | Game: open bright lawn, ~12 000 scattered round trees; the ground raster itself says canopy = 63.7 % of the map and the mesh shows crowns on 53 % of observed cells. Real: unbroken pine forest hiding the villas (villa views show nothing but forest). Villas stand on lawn in the game. | `qa-map-game-mezaparks-forest.png`; `canopy-mezaparks.json`; ref `tools/.cache/qa-map/sheets/districts-2.png` | M1 | Canopy class is painted as lawn colour under a sparse tree budget: draw canopy cells as dense dark conifer cover (instanced pines at ~1 per 40 m²) | **fixed**: ground class 10 (dense forest, 34 % -> 57 % of the map incl. the unobserved east part) + ~24 k scattered Scots pines (28-tri model) + 4.7 k broadleaf; whole map covered; budget 423 KB gz |
| M-02 | wrong shape | Rīgas pils 49615051 (-771,58), spike at (-761,23) | A 60 m high triangular wall with windows rises from the castle's river corner (game hmax 60 m; real castle ≤ ~32 m, Svina tornis). The mesh has a narrow 57 m spike there (17 cells >= 45 m: mast/crane, not in the orthophoto). | `qa-map-game-wedges.png` (top-left); `evidence/castle.png` | M1 | plane fitter built a wall out of a 1–2 m wide spike: clip hmax to the 98th percentile of smooth cells / reject spikes < 15 m² | **fixed**: `CLIP_TOP` 33 m + generic spike filter (hmax 60 -> 33 m, no wedge) |
| M-03 | extra building | Daugava football stadium, 49612275 + 49614046 + 49612274 (-1527,2023), Āgenskalns | Pitch + track + stands (30 365 m²) rendered as three 17–19 m boxes; mesh p90 = 0.1 m (grass). | `scripts/out/qa-map-findings-agenskalns.png`; `evidence/slabs.png` | M1 | cadastre type `oth` for sports grounds: force flat/skip when mesh p90 < 1 m | **partly**: the 3 boxes are gone, pitch (lawn) + running track painted; no stand volumes found in the mesh as smooth cells >= 2.5 m (none added) |
| M-04 | colour-material | Old Town + centre roofs | Game: orange-red tile on most roofs. Real: majority grey/blue zinc and slate, green copper on many monuments, red tile on a minority (street sheets 1–8, Old Town sheets). Also walls: brick-red churches/Powder Tower rendered tan or near black. | `qa-map-game-roof-colours.png`; `sheets/streets-0/1.png` | M2 | add grey zinc / green copper to the roof palette per era; hero roof colours from mesh texture | **fixed** (owner decision): Old Town: 90 % of the pitched roofs keep clay tile (rendered area share red / grey / green 48.5 / 44 / 7.5 -> 47 / 45 / 8, section 10), centre grid 18 / 74 / 8 of the pitched roofs (measured ortho: Old Town 17-25 % red, 70-78 % grey, 5 % green; centre 3-6 % / 93-96 % / 1.5 %); heroes: brick / copper walls and roofs |
| M-05 | extra building (slab) | Kongresu nams forecourt, aux 49616050 "Krišjāņa Valdemāra iela 5A" (-339,-450) 7 934 m² | Plaza rendered as a 3.2 m high orange slab in front of the Congress House; mesh mean 0.7 m (open plaza). Siblings: 49612413 (-28,-1026) 8 942 m² parking; 49613247 (-1956,202) 3 788 m²; 49612900 (1185,382) 3 560 m²; 49614275 (-514,-889) 1 616 m²; 49716839 (-661,-750) 11 188 m² (brown plate in the park around the Stradiņš hospital; mesh top 33 m = hospital, rest park). 16 such slabs >= 800 m² in the centre (44 150 m²). | `qa-map-game-defects.png` (congress, aux-bigA), `sheets/ring-centre-1.png` | M1 (Kongresu nams) / M2 | `flatHeight` keeps `aux` at 3 m regardless of mesh: skip aux with mesh p90 < 2 m and area > 800 m² | **fixed**: Kongresu nams forecourt and the siblings dropped (open paving / lawn); flat slabs >= 800 m^2: centre 16 -> 4, Āgenskalns 7 -> 0, Mežaparks 3 -> 1, Purvciems 3 -> 0; park plate 49716839 / 49715074 removed (rule: aux >= 2000 m^2 with < 35 % cells >= 3 m) |
| M-06 | extra building | Heart of Hanza 49618404 (340,-1019) 3 017 m², Strēlnieku iela 4C 49618771 (-134,-1018), Atea 49618762 (-25,-925), Lidl 49622400 (1194,422), Ģertrūdes 65/65A, tennis courts 49612645 (-556,-322) 2 704 m², courts 49612201/2 (899,355) | Rendered 6–21 m; mesh p90 0.1–0.9 m: vacant lots, building pits, clay courts. Heart of Hanza = 21 m box on an empty lot. Date?: some may have been built after the mesh (Hanza, Atea); courts/Lidl lot are real phantoms. | `evidence/` crops, `qa-map-game-defects.png` (tennis), `tools/.cache/qa-map/phantoms-centrs.json` | M2 | use mesh as veto where flat and the cadastre object is a court/construction | **partly**: tennis courts 49612645 / 49612201 / 49612202 -> gravel ground; Lidl lot, vacant lots dropped; **kept (reviewer "date?")**: Heart of Hanza 49618404, Atea 49618762, Strēlnieku 4C 49618771 (no OSM start_date / construction tag found either way) |
| M-07 | extra building | Courtyard `aux` pieces, centre ring + Centre (map `qa-map-findings-centrs.png`) | **124 buildings** (84 rendered >= 15 m, 96 are `aux`, 100–250 m² typical) rendered 6–21 m over mesh-flat courtyards (mesh mean <= 2.5 m, median <= 1.5 m). The earlier flattening pass only caught p90 < 0.5 m; courtyards whose p90 is pushed up by a neighbour's wall (p90 up to 20 m, mean 0.3) still stand as 18–21 m towers. Āgenskalns 37 (7 >= 15 m), Mežaparks 19 (9 >= 15 m), Purvciems 7. | `scripts/out/qa-map-findings-*.png`; `phantoms-<map>.json`; `sheets/defects-1.png` | M2 (M3 each) | decide aux height from p50, not p90 | **fixed**: phantoms (rendered >= 6 m over mesh mean <= 2.5 m): centre 90 -> 5 (3 kept as "date?"), Āgenskalns 30 -> 0, Mežaparks 16 -> 0, Purvciems 6 -> 0 (my count; the review counted 124 / 37 / 19 / 7 with a looser definition); sheds 3 m: 74 / 24 / 16 / 6, dropped: 35 / 5 / 3 / 4 |
| M-08 | trees | all maps, centre/Āgenskalns worst | Mesh shows tree crowns on 24.6 % (centre) / 34.6 % (Āgenskalns) of observed cells; ground raster canopy class 11 % / 21 %; ~40–46 % of "lawn" cells are crowns in the mesh. Game streets look bare next to the real tree-lined streets (street sheets 1, 7 centre; 1, 2 Āgenskalns). | `qa-map-game-trees-street.png`; `canopy-<map>.json` | M2 | classify shaded canopy as canopy; raise street-tree budget | **fixed / partly**: canopy class share of observed cells (mesh in brackets): centre 10.9 -> 20.7 % (24.6), Āgenskalns 21.3 -> 39.6 (34.6), Mežaparks 63 -> 73 (52.7), Purvciems 26.5 -> 40.6 (31.5; only 15 % mesh coverage); crowns +15.3 k / +14.4 k (centre / Āgenskalns), spacing 9 / 12 m; Purvciems trees unchanged (no mesh) |
| M-09 | height | Radisson Blu Daugava 49629591 (-1178,850) | Game body 28 m + roof lantern, top 51.9 m; mesh mean 16 m, top 38.5 m, a long 8–10 floor slab. Looks like a monolithic tower block from the river. | `sheets/leftbank-bridges-1.png` | M2 | hotel "ridge lantern" decoration is +13 m: scale by footprint | **fixed**: measured mesh shape (hero source mesh), crown lantern removed (top = measured 38.5 m) |
| M-10 | wrong shape | Sv. Aleksandra Ņevska church 49619857 (494,-503) | Real: yellow round church with a large green dome and a separate green bell tower. Game: beige boxes with flat green roofs and no big dome. | `sheets/ring-centre-2.png` | M2 | kit config for central-plan church (dome 14 m dia) | **partly**: yellow walls, green roofs and a drum + green dome (R 7.4 m, runtime feature) on the centre; the dome is smaller than the real 14 m one because the footprint is small |
| M-11 | wrong shape | Rīgas cirks 49615676 (376,219) | Two domes (green + grey) side by side; real has one. | `qa-map-game-roof-colours.png` | M2 | drop the duplicate dome decoration | **fixed**: one dome (the measured one, grey-green) |
| M-12 | wrong shape | Rīgas Rātsnams 49614687 (-437,392) | A steep dark-red pyramid plane stands on the roof; real roof is a curved grey vault, no tall red roof. | `sheets/oldtown-1.png`; `qa-map-game-defects.png` | M2 | plane-fit artefact; hero source `mesh` with barrel option | **partly**: the red pyramid plane is gone: grey barrel vault over the footprint (hero `barrel`); it now reads as a long vaulted hall, the small tower feature is not obvious from the review camera |
| M-13 | colour | Pulvertornis 49615275 (-281,31) | Tower walls near black, roof orange; real red brick, green copper cone. Also Rīgas Doms nave roof orange (real dark grey slate) 49614755; Mazā ģilde yellow + green turret (real grey neo-gothic, slate); Lielā ģilde orange roof (real dark grey). | `qa-map-game-roof-colours.png` | M2 | hero palette overrides | **fixed**: Pulvertornis red brick + green cone, Doms nave dark grey, Lielā / Mazā ģilde grey slate, Kaķu nams green, St Peter brick walls + dark spire, St James green nave roof |
| M-14 | roof form / dome | Tropu māja 49672040 (3149,-6313), Mežaparks | Green hemispherical dome on a grey ring; real: low red conical tent roof. | `sheets/districts-1.png` | M2 | church-kit dome used for a non-dome | **fixed**: low red conical tent roof (new `tent` feature) |
| M-15 | spikes | Zemaišu iela 15 49634679 (-2417,2466), Āgenskalns; Auces iela 7 49635425 (-1882,911) | 22–24 m dark towers/blades standing in a construction site / forest; mesh smooth top 0–3 m (cranes, tree crowns). Candidates by map: **centre 100, Āgenskalns 179, Mežaparks 68, Purvciems 9** shaped buildings with hmax >= 12 m and smooth mesh top <= half of it (spot check of 4: 1 real chimney (Ojāra Vācieša 43), 2 tree/crane spikes, 1 ok). | `qa-map-game-defects.png`; `spikes.json`; `sheets/defects-0.png` | M2 | cap hmax by smooth-cell p98; keep chimneys only when planar-narrow | **partly**: generic spike filter (`despike`, ~470 peaks removed in the centre) + tree-covered buildings get flat extrusions; candidates (hmax >= 12 m, smooth top <= half): centre 115 -> 93, Āgenskalns 188 -> 140, Mežaparks 72 -> 43, Purvciems 11 -> 10; what remains are real spires / tall rough roofs (tier A / B kept on purpose) and the Zemaišu iela 15 construction blades (cranes over a 2 454 m^2 site) |
| M-16 | missing building | Āgenskalns, ~10 real: (-2567,2430) 700 m² grey roof; (-1418,2232) three barrel-roof sheds 3 x ~330 m²; (-3038,2177) new building ~1 200 m², 27 m (construction in 2016 ortho); (-3632,1445) workshop part; west edge (-3772,464),(-3866,521),(-3562,461) 17–21 m slabs; east edge (-1273,2560) 2 746 m², (-1270,2980) | Mesh volume, no footprint. 16 of 28 candidates viewed: ~10 real. | `tools/.cache/qa-map/missing-agenskalns.json`; `sheets` via `missing-sheet.mjs` | M2 | cadastre drops ("small" 727 + "outside" 70): add footprints from OSM | **partly**: 5 added from OSM footprints (3 slabs at the west edge, warehouse (-1273,2560), kindergarten (-1270,2980)); the other candidates have no OSM footprint (list: `tools/.cache/mapfix/buildings-agenskalns.json` skipped, 23) |
| M-17 | missing building | Mežaparks (3404,-5921) 277 m² hangar; (2799,-5138), (3500,-5086) houses; (2106,-4689) | 4 of 4 viewed real | `missing-mezaparks.json` | M3 | as above | **partly**: 1 of 4 added (house (3500,-5086)); the hangar (3404,-5921), (2799,-5138), (2106,-4689) have no OSM footprint |
| M-18 | missing building | Centre: (1151,1487) 3 181 m² 18 m warehouse and (122,-1184) 1 999 m² big roof, both at the map edge (cadastre "outside"); (-1814,-428) 285 m² 11 m house; (-1867,-1040) 247 m² shed | 24 candidates, 24 viewed: 4 real + edge cases, the rest trees / street trees / roof-edge slivers | `missing-centrs.json`, `qa-map-findings-centrs.png` | M3 | as above; **the centre has essentially no missing building >= 80 m²** | **left**: none of the 24 candidates has an OSM footprint (the two real edge buildings are outside the cadastre and OSM) |
| M-19 | extra building (date?) | Trijādības iela 1 49614312 (-1312,718) 4 135 m² (Ķīpsala); Lidl Mežaparks 49665580 (3266,-4603) 2 985 m²; Lidl Purvciems/Āgenskalns 49639014 (-2818,988) | Rendered 3–24 m on vacant/forest lots (orthophoto and mesh); store likely built after the mesh. | `evidence/slabs.png` | M3 | verify against OSM; hide if mesh flat | **partly**: Trijādības iela 1 (49614312) dropped (no OSM evidence of construction); the Lidl stores kept where the mesh is not flat / date unknown |
| M-20 | height (aux low) | Balasta dambis 2 k-1 49640060 (-1709,395) 10 911 m² | 6.4 m podium vs mesh mean 17 m (Saules akmens / Preses nams complex; orange slab in `sheets/leftbank-bridges-0.png`). Others: 49612434 (-350,509) 883 m² 3 vs 21 m (hidden among neighbours), 49614181 (-95,-186), 49629598 Akmeņu 17. 10 in the centre, 1 in Āgenskalns. | `under.json` | M2 | aux height from mesh | **fixed**: aux podiums take the mesh height: Balasta dambis 2 k-1 6.4 -> 17.1 m, 49612434 3 -> 21.1 m, 49614181 3 -> 13.1 m |
| M-21 | colour | Latvijas Banka 49615814 (-636,-76) | Grey roofs; real green copper. Art Academy 49615853 roofs red-brown (real dark grey). Radio, Saeima grey/blue. | `sheets/centre-1.png`, `ring-centre-1.png` | M3 | | **fixed**: Latvijas Banka green copper, Mākslas akadēmija dark grey roofs (Radio / Saeima: Saeima roof still tile-orange, left) |
| M-22 | invented feature | Saeima 49614901 (-522,32), University 49616039 (175,82) | Saeima gets a green-capped clock tower (real roof: grey flat/zinc, no tower); University gets a large blue dome (real has none at that size). | `sheets/oldtown-2.png`, `ring-centre-0.png` | M3 | tier-A "feature" rules should check the mesh | **fixed**: Saeima clock tower and the University dome removed |
| M-23 | height / decoration | Spīķeri warehouses 49615294, 49614852, 49614681, 49614744, 49614657, 49614792 | Final h 30–35 m vs mesh top 12–19 m (decorations: chimney/lantern); visual looks acceptable. Also Latvijas Banka 32.8 vs 23 m, Rīgas pilsētas tiesa 32.4 vs 21.6, Radio 38 vs 29 (flags). | `sightH` table in section 7 | M3 | cap decoration height | **left**: decoration heights not capped (visual acceptable) |
| M-24 | position | 134 centre buildings > 3 m off (strict: s improves >= 0.15, A >= 150 m²), Āgenskalns 114, Mežaparks 54, Purvciems 9. Notable: Galerija Centrs 49614512 (-4 E, +1 S), Islande Hotel 49639852 (-2,+4), Skārņu iela 10 49614492 (-5,-4), Marijas iela 2 49614656 (-5,+3), Aleksandra Ņevska church (-4,-2), Lāčplēša 106 k-2 49627535 (-7,0), Kronvalda bulv. 5 49616023 (-7,-4) | median 0,0; p50 1.0 m; p90 5.7–6.3 m is inflated by ambiguous fits. No district-level offset (no 500 m cell with median shift >= 1 m except two Mežaparks cells of 1 m). | `align.json` | M3 | mesh/cadastre register; per-building shift only for heroes | **left**: no clear cause (median shift 0, no district offset); notable ones listed in this review, not moved |
| M-25 | roof form | Centre: 21 shaped buildings flat in game but mesh relief >= 5 m (e.g. Uzvaras bulvāris 3A 15.8 m, Elizabetes iela 14 14.5 m, Raiņa bulvāris 6 16.3 m); 20 pitched/tower in game but mesh flat; only **4** unshaped flat boxes with measured relief >= 4.5 m. Āgenskalns 20/9, Mežaparks 10/2, Purvciems 1/0. | `bld-<map>.json` | M3 | | **left** |
| M-26 | data gap | Purvciems: 85 % of buildings have no mesh (heights from cadastre/levels, 746 heuristic); the four Purvciems sight views have no reference (basemap tiles only) | cannot be judged | `sheets/districts-2/3.png` | M2 | extend mesh or compare with OSM levels | **left**: no mesh for Purvciems (85 % of buildings); only the canopy / phantom rules that need cover apply |
| M-27 | ground | Mežaparks Lielā estrāde field (2397,-6997) | Game: pale paved field with lawn blobs and a saw-tooth grey shell roof; real: terraced seating bowl, lawn grid. Not comparable at this view. | `sheets/districts-1.png` | M3 | | **left** |
| M-28 | position (uncertain) | Uzvaras parks | Game places an obelisk standing in the pond; mesh view shows none there. | `sheets/leftbank-bridges-1.png` | M3 | check monument coordinates | **left** |
| M-29 | ground / label (uncertain) | Āgenskalna tirgus 49634808, Kalnciema koka nami 49636186 | Reference view shows a viaduct and trees where the game has a ground-level road and a 5-storey yellow block; likely camera/target mismatch, not verified. | `sheets/districts-0.png` | M3 | | **left**: uncertain, not verified |
| M-30 | street | all maps | Streets: no road corridor missing was found (asphalt cells > 3 m from any OSM road/parking/rail polygon are yards, lots; checked the 6 biggest clusters). Mežaparks highway is present as two carriageways. | `streets-<map>.json` | – | negative result | negative result, nothing to do |

Not errors (checked and dismissed): moored ships in the mesh (6 400 m² at (-1027,-338)), water under bridges, Zaķusala (sandy with trees, game also tan), marina piers, Ķīpsala layout, the three bridges (Akmens, cable-stayed, railway arches), shorelines.

## 4. Counts per category and map (automatic flags, not all verified; see section 3 for verified numbers)

| flag | centrs | Āgenskalns | Mežaparks | Purvciems |
|---|---|---|---|---|
| buildings / usable mesh | 5 276 / 4 448 | 7 165 / 3 914 | 1 870 / 1 326 | 3 379 / 508 |
| body height off (> max(4 m, 25 %)) | 192 (14 under, 178 over) | 134 (19/115) | 32 (2/30) | 17 (1/16) |
| rendered tall over mesh-flat ground (phantoms) | 124 | 37 | 19 | 7 |
| slabs >= 800 m² rendered >= 2.5 m on flat mesh | 16 | 7 | 3 | 3 |
| tall spikes over low/treed footprints (shaped) | 100 | 179 | 68 | 9 |
| mesh volumes without footprint (>= 80 m², filtered) | 24 (≈ 6 real) | 28 (≈ 10 real of 16 viewed) | 4 (4 real) | 3 (not viewed) |
| footprint > 3 m off the mesh (strict) | 134 | 114 | 54 | 9 |
| shaped flat in game / mesh relief >= 5 m | 21 | 20 | 10 | 1 |
| notable buildings without mesh data | 16 | 51 | 9 | 390 |

By category (verified or strongly indicated): extra/phantom 5 findings (M-03, 05, 06, 07, 19), missing 3 (M-16–18), wrong shape/roof 6 (M-02, 10, 11, 12, 14, 22), height 3 (M-09, 20, 23), colour 3 (M-04, 13, 21), trees/ground 3 (M-01, 08, 27), position 2 (M-24, 28), spikes 1 (M-15), data gap 1 (M-26).

## 5. Ground, water, bridges, islands, rail yard

* **Water**: polygons vs the orthophoto-derived raster 96.3 % (centre) / 95.1 % (Mežaparks); the 3.7 % that is not blue are bridge decks over water and an upland pond. Mesh over water is 74–91 % holes, so "land in water" only found ships and bridges. Nothing to fix.
* **Bridges**: Akmens tilts, the cable-stayed bridge and the railway arch bridge line up with the mesh in position, length and width (visual, `sheets/leftbank-bridges-1/2.png`); Zaķusala and Ķīpsala shorelines match.
* **Ground classes**: derived from the orthophoto, so agreement is by construction; the one measurable gap is canopy (M-08). Rail yard: ballast class present; the mesh shows the yard as terraces with wagons (not buildings).
* **Streets**: M-30.

## 6. Per-sight verdicts (visual; OK / minor / WRONG)

| sight (id) | verdict | one line |
|---|---|---|
| Sv. Pētera (49614351) | minor | massing, spire OK; walls tan (real red brick), spire green (real dark) |
| Rīgas Doms (49614755) | minor | tower OK; nave roof orange (real dark grey), walls tan |
| Sv. Jēkaba (49614946) | minor | spire OK; nave roof grey-blue (real green copper) |
| Sv. Jāņa (49614438) | OK | brick gable, small spire |
| Rātsnams (49614687) | WRONG | big dark-red pyramid roof plane; real curved grey vault (M-12) |
| Melngalvju nams (49614347) | minor | stepped gable present but front much plainer/larger than the ornate real facade |
| Trīs brāļi (49614971) | minor | three narrow houses OK, colours differ (real white/grey/ochre) |
| Lielā ģilde (49616381) | minor | orange roof (real dark grey) |
| Mazā ģilde (49616364) | minor | yellow + green turret under orange (real grey neo-gothic, slate) |
| Kaķu nams (49616370) | minor | yellow corner turrets right, roof orange (real green) |
| Pulvertornis (49615275) | minor | right place and size; walls near black, roof orange (real brick / green copper) |
| Zviedru vārti (49614979) | OK | small gate in a yellow row, dark tower nearby |
| Rīgas pils (49615051) | WRONG | massing and colours OK but a 60 m wedge (M-02) |
| Saeima (49614901) | minor | invented green-capped tower, orange roof vs grey (M-22) |
| Okupācijas muzejs (49614381) | OK | black box, right size |
| Brīvības piemineklis | OK | monument and plaza read correctly |
| Nacionālā opera (49616059) | OK | portico, roofs green vs grey, minor |
| Universitāte (49616039) | minor | massing OK, invented blue dome (M-22) |
| Nacionālais teātris (49614719) | OK | green roofs, fly tower |
| Mākslas muzejs (49615452) | OK | mansard, lantern |
| Mākslas akadēmija (49615853) | minor | gables and spire right, roof red-brown (real dark grey) |
| Kristus Piedzimšanas (49615771) | minor | gold domes right, central drum too tall and round |
| Kongresu nams (49616534) | minor | volume OK, forecourt is an orange slab (M-05) |
| Laimas pulkstenis | OK | column, right place |
| Bastejkalns | minor | park OK, hill not assessable from the view |
| Vecā Ģertrūdes (506,-720) | OK | brick gothic, grey roof |
| Sv. Aleksandra Ņevska (49619857) | WRONG | no large dome (M-10) |
| Hotel Latvija (49619752) | OK | slab tower, 94 vs 97 m |
| Origo / Centrālā stacija (49614964 / 49614666) | minor | volumes and clock tower OK, plain grey (real glazed lanterns, solar roof) |
| Centrāltirgus (49614728 + 4) | OK | five barrel pavilions, fifth crosswise |
| Zinātņu akadēmija (49628422) | OK | tower with setbacks, 107 m |
| Spīķeri (49614933 …) | OK | brick blocks right; decorations over-tall in data (M-23) |
| Rīgas cirks (49615676) | WRONG | two domes (M-11) |
| Dailes teātris (49621082) | minor | boxy mass right, pale grey (real brown) |
| Splendid Palace (49619824) | OK | drum + low dome |
| Latvijas Banka (49615814) | minor | roofs grey (real green) |
| Latviešu biedrības nams (49615638) | OK | (reference mesh blurry there) |
| Nacionālā bibliotēka (49629679) | OK | glass mountain and crown |
| Saules akmens (49639844) | OK | cut-top glass tower, 120 vs 121 m |
| Z-Towers (49637749) | OK | two cylinders, podium |
| Preses nams (49639106) | OK | tower on podium (podium aux too low, M-20) |
| Radisson Blu Daugava (49629591) | WRONG | monolithic 52 m block (M-09) |
| Ķīpsala | OK | island layout, cylinder building, slab |
| Uzvaras parks | minor | park/pond OK, obelisk in pond (M-28) |
| Akmens tilts / cable-stayed / railway bridge | OK | position, deck, pylon, arches |
| Āgenskalna tirgus | uncertain | camera/target mismatch (M-29) |
| Kalnciema koka nami | uncertain | M-29 |
| Valsts vēstures arhīvs (49637896) | OK | long block, tram street |
| Da Vinci site (49639148) | OK | flat low slab, mesh shows a ruin/structure |
| B3 korpuss (49634685) | OK | slab with annex |
| Lielā estrāde (49673065) | minor | M-27 |
| Tropu māja (49672040) | WRONG | dome vs tent roof (M-14) |
| Ķeizarmežs (49665346) | OK | big grey shed |
| Purvciems x5 (49648478, 49646439, 49645026, 49646321, 49645032) | not assessed | no mesh reference |
| Streets: centre 8 | OK / minor | densities, heights, widths plausible; roofs M-04, trees M-08, one ragged roof with holes (street 3) |
| Streets: Āgenskalns 4 | minor | wooded in reality, lawns in game (M-08) |
| Streets: Mežaparks (villa views) | WRONG | M-01 |

## 7. Data gaps and caveats

* **No mesh coverage**: Purvciems 85 % of buildings (heights are cadastre/levels guesses, 746 heuristic); Āgenskalns 45 % of buildings lacking usable stats (south/west fringe), 51 notable ones; centre 16 notable ones incl. Rāmera tornis 49611828 (22.9 m rendered, landmark 18.4 m).
* **Sights without footprint / ID problems**: none missing (`tierAMissing: []`); Ministru kabinets was already known not to exist as a cadastre piece.
* **Not covered by the missing-building test**: buildings under tree crowns (rough cells rejected), buildings closer than 3 m to an existing footprint, buildings < 60 m².
* **Not compared**: interior courtyards' trees, tram tracks, kerbs, street furniture, wall textures; Purvciems visually.
* The sight-height table (rendered body/top vs mesh): `node tools/qa-map/` outputs `bld-<map>.json`; every tier-A sight is within 15 % of the measured body mean except the ones listed in M-09/M-23.

## 8. Reproduce

```
node tools/qa-map/dsm-full.mjs <map> 1.0 1        # full DSM (cache + polite fetch)
node scripts/qa-map/dump-game.mjs                  # needs vite on :5188
node tools/qa-map/buildings.mjs <map>; node tools/qa-map/heights.mjs; node tools/qa-map/missing.mjs <map>
node tools/qa-map/ground.mjs; node tools/qa-map/shore.mjs <map>; node tools/qa-map/canopy.mjs; node tools/qa-map/align.mjs
node tools/qa-map/views.mjs; node tools/qa-map/ref-all.mjs; node scripts/qa-map/game-shots.mjs; node tools/qa-map/pairs.mjs 4 <keys> <name>
node tools/qa-map/diagrams.mjs                     # scripts/out/qa-map-findings-*.png, qa-map-heights-scatter.png
```


## 9. Top 40 overall (by importance)

1 M-01 Mežaparks forest missing · 2 M-02 Rīgas pils 60 m wedge · 3 M-03 Daugava stadium 49612275 · 4 M-03 stadium 49614046 · 5 M-03 stadium 49612274 · 6 M-05 Kongresu nams forecourt slab 49616050 · 7 M-04 Old Town roof colours · 8 M-06 Heart of Hanza 21 m box 49618404 · 9 M-07 124 courtyard phantoms (centre) · 10 M-08 tree density centre/Āgenskalns · 11 M-09 Radisson Blu Daugava 52 m · 12 M-10 Ņevska church dome · 13 M-11 circus second dome · 14 M-12 Rātsnams red wedge roof · 15 M-14 Tropu māja dome · 16 M-13 Pulvertornis colours · 17 M-13 Doms roof colour · 18 M-15 Zemaišu iela 15 towers 49634679 · 19 M-15 Mežaparks tree spikes (68) · 20 M-05 slab 49612413 (-28,-1026) · 21 M-05 park plate 49716839 · 22 M-06 tennis courts 49612645 · 23 M-19 Trijādības iela 1 49614312 · 24 M-16 Āgenskalns new building (-3038,2177) · 25 M-16 sheds (-1418,2232) · 26 M-16 west-edge slabs (-3772,464) · 27 M-20 Balasta dambis 2 k-1 podium · 28 M-18 SE warehouse (1151,1487) · 29 M-17 Mežaparks hangar (3404,-5921) · 30 M-06 Strēlnieku 4C 49618771 · 31 M-06 Atea 49618762 · 32 M-13 Mazā/Lielā ģilde colours · 33 M-21 Latvijas Banka roof · 34 M-22 Saeima tower · 35 M-22 University dome · 36 M-26 Purvciems unmeasured heights · 37 M-23 Spīķeri decoration heights · 38 M-24 positions > 3 m (Galerija Centrs, Islande Hotel) · 39 M-25 roof-form mismatches (Uzvaras bulvāris 3A) · 40 M-28 Uzvaras parks obelisk.


## 10. Fix pass (2026-11-16): numbers before -> after
Re-run with `QA_DIR=tools/.cache/qa-map-after` (dump-game, buildings, missing) and `node tools/qa-map/recheck.mjs`. Pipeline and rules: README section 4.0a, `tools/mapfix/`.

| check | centrs | Āgenskalns | Mežaparks | Purvciems |
|---|---|---|---|---|
| buildings | 5 276 -> 5 241 | 7 165 -> 7 162 | 1 870 -> 1 868 | 3 379 -> 3 375 |
| phantoms (rendered >= 6 m over flat mesh) | 90 -> 5 | 30 -> 0 | 16 -> 0 | 6 -> 0 |
| flat slabs >= 800 m^2 | 16 -> 4 | 7 -> 0 | 3 -> 1 | 3 -> 0 |
| spike candidates | 115 -> 93 | 188 -> 140 | 72 -> 43 | 11 -> 10 |
| mesh volumes without footprint (reviewer filter) | 24 -> 13 | 28 -> 12 | 4 -> 5 | 3 -> 3 |
| canopy class share of observed cells (mesh) | 10.9 -> 20.7 % (24.6) | 21.3 -> 39.6 % (34.6) | 63 -> 73 % (52.7) | 26.5 -> 40.6 % (31.5) |
| bodies within max(4 m, 25 %) of the mesh | 94.0 -> 95.1 % | 92.9 -> 93.2 % | 94.0 -> 95.4 % | 94.7 -> 95.2 % |

Roof mix (area-weighted share of buildings, orthophoto roof pixels): measured Old Town red / grey / green 17-25 / 70-78 / 5 %, centre grid 3-6 / 93-96 / 1.5 %, Āgenskalns 8 / 89 / 4 %, Mežaparks 12 / 81 / 8 %, Purvciems 4 / 93 / 3 % (`tools/mapfix/roofshare.mjs`). Game as rendered (area-weighted over all non-industrial buildings >= 60 m^2, flat roofs and heroes included, `scripts/mapfix/roofmix.mjs`), red / grey / green: Old Town 48.5 / 44 / 7.5 % before -> 47 / 45 / 8 % after; centre grid 37 / 48.5 / 14 % before -> 13 / 72 / 15 % after; rest of the centre map 39 / 48 / 13 -> 13 / 74 / 13; districts unchanged.

Kept at their cadastre height ("date?"): Heart of Hanza 49618404 (21.2 m, 3 017 m^2), Atea Global Services 49618762 (16 m), Strēlnieku iela 4C 49618771 (16 m): the mesh shows an empty lot, the reviewer suspected they were built after the flight; OSM had no start_date / construction tag for them. Skipped missing buildings (no OSM footprint): centre 24, Āgenskalns 23, Mežaparks 3, Purvciems 3 (`tools/.cache/mapfix/buildings-<map>.json`, `skipped`).
