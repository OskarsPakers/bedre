# tools/onebuilding: ONE Riga building as a game asset, three ways (experiment)

Building: **Latvian National Opera, Aspazijas bulvaris 3** (game cadastre id 49616059, OSM way 87180030, centrs-3 stop "Nacionala opera" at s = 1388 m).
Why: it is the most recognisable building on a tram route (Ionic portico, pediment relief, giant cornices, tower, dentils, balustrades) and has the best source data of the whole route
(the finest reality-mesh tiles, ~60 open photos on Commons). It is a fair, hard test: not a box (three massing levels, a 6-column portico with deep undercuts, 150+ windows in 5 tiers,
sculpture), and the photogrammetry is *wrong* exactly where the portico matters (loggia melted, banners, trees, ground floor smeared).

Everything here is NEW files only. Nothing in `src/`, `public/`, the games or other agents' folders was touched. Server: `node tools/onebuilding/server.mjs` -> http://localhost:5196/viewer.html (port 5196 only).

## 1. Sources and licences

| source | what we took | licence / status | in shipped output? |
| --- | --- | --- | --- |
| City of Riga photogrammetric reality mesh (I3S layers `region_3_wgs`, `vecriga_lod_rebuilt_wgs`, `centraltirgus_wgs`, `region_4_11122023_WGS`), 649 finest-LOD nodes in a 100x140 m box; 50.2 MB fetched this session (1 167 requests, <= 4 concurrent, generic UA, backoff) + 131 files from the existing cache; 4.44 M source vertices, 1.48 M triangles in the box, 141 Mpx of JPEG (12.7 MB) | Riga valstspilsetas pasvaldiba / GeoRiga. **Redistribution licence NOT settled** | geometry numbers (measurements) feed the parametric model; **pixels feed the hybrid / bake atlas -> need written permission** |
| Cadastre footprint + measured roof (`public/data/riga.json`, id 49616059; frame origin) | placement frame, context blocks in the viewer | project data (see main README credit) | no |
| OpenStreetMap way 87180030 (`building=retail`, `building:levels=6`, `architect=Ludvigs Bonstets`, `heritage=2`, no roof/part tags) | placement, name, architect | ODbL, (c) OpenStreetMap contributors | attribution if footprint used |
| Wikipedia "Latvian National Opera and Ballet" | built 1860-63 (Ludwig Bohnstedt), burnt 14 Jun 1882, rebuilt 1882-87 (Reinhold Schmaeling), Classicism | CC BY-SA | facts only |
| Wikimedia Commons: 18 photos/historic prints (list + author + licence per file in `sources.json`, files in `tools/.cache/onebuilding/ref/`): CAPTAIN RAJU "in 2019.01-.13" (CC BY-SA 4.0), Diego Delso "DD 04/09/16/26" (CC BY-SA 3.0), Evita wiki, Riggwelter, Andrey Romanenko, Nenea hartia (CC BY-SA 4.0), Bohnstedt print and "Theatre and promenade 1890s" (public domain) | **visual reference only: read by me to write the grammar (column count, frieze, balustrades, key mouldings)** | CC BY-SA 3.0/4.0, PD | **no pixel of them is in any output** |
| Panoramax (open API, no token): 8 pictures within 130 m | none usable: all are POI close-ups of sculptures (mapcomplete) | CC BY-SA 4.0 | no |
| KartaView (open API, no token): 3 pictures within 120 m | none usable: wide streets, tram, nothing of the facade | CC BY-SA (terms to re-verify) | no |
| Mapillary | **not used**: the Graph API needs an access token (HTTP 500 without), and I did not create an account | CC BY-SA 4.0 | no |
| Google Street View / Apple / Bing / Yandex | **not used, not downloadable for derivation.** A human may look at Street View as a reference; it can never be a data source for the model or textures | forbidden | no |

Street-level finding (the owner's "maybe street maps?"): open street-level coverage of this facade is almost nil (Panoramax 8 / KartaView 3 pictures, none showing the Opera). The useful
"street-level" material is Commons photos taken from the park: `scripts/out/onebuilding/street-level-compare.jpg` puts the reality-mesh orthophoto, such a photo and our model side by side
for the ground floor of the portico end. The photo shows what the mesh melts (tall rectangular doorways with steps, Greek-key band below the balcony, rustication joints), and I used it to
set the podium openings. To use street-level imagery as a *data source* the owner would need to provide a Mapillary client token (unlocks CC BY-SA 4.0 sequences, we would rectify them to the
facade plane with the known frame) or contribute own photos. Consequence of CC BY-SA textures in the game: attribution per image **and share-alike on the derived textures** (the atlas would have to be CC BY-SA-compatible; code and geometry stay separate). That is a reason to prefer the photo-free parametric route for ground floors and to use photos only as "reading material".

## 2. Survey of methods (short)

| method | gives | cost | risk | verdict here |
| --- | --- | --- | --- | --- |
| (a) retopo + bake | clean proxy + albedo/normal/AO from the dense mesh | one clean proxy per building (hand or fitted planes), ortho depth/colour renders, de-light | municipal pixels in the asset; flat at grazing angles; photogrammetry holes | tried: `opera-a-bake-proxy` (274 tris + atlas) |
| (b) inverse procedural | clean geometry from a facade grammar, tiny, restylable (day/evening/winter), no photo pixels | read the facade, write grammar; window detector helps | flat look without photo colour; needs the ornament library | tried: `opera-b-parametric-*` (12 k tris, 24 KB gz) |
| (c) hybrid | grammar geometry for silhouette/depth + baked detail atlas where reliable | (a)+(b) | municipal pixels | **chosen**: `opera-c-hybrid-*` |
| (d) learned: Gaussian splats / NeRF | photoreal novel views | needs CUDA for sane speed; splats are not relightable, heavy on phones, not collidable | high | **not usable here** (no CUDA, source mesh is already a better "reconstruction"; splats cannot do day/evening/winter) |
| (d) neural surface / image-to-3D generative | a mesh from 1-few images | hallucinates ornament; cannot match a real footprint/scale; licensing of weights | high | not tried; wrong tool when a measured mesh exists |
| (d) AI de-lighting / super-res of the atlas | removes baked shadows (ours is partly baked) | a model + GPU | medium | not tried; my de-light is a blurred-luminance divide (cheap, partial) |
| (d-VLM) a vision-language model reads the facade -> grammar | the parametric model with no hand measuring | one prompt per elevation + verify | needs verification | **demonstrated**, see below |

## 3. What was built and how each turned out

Pipeline (all scripts in this folder):

1. `fetch.mjs` selects/downloads the finest I3S nodes (leaf or spacing <= 0.12 m) around the Opera into `tools/.cache/onebuilding/i3s`.
2. `meshload.js` / `dense.html`: reads the nodes in the game's local frame (y ground 0.8 m in mesh height). `frame.js` defines the Opera's own frame (U along the 61.9 deg axis, V across).
3. `ortho.mjs`: orthographic **rectified elevations** of the dense mesh (40 px/m) for the SW wall, NE wall, portico (north) end and the loggia, each with a 16-bit **depth pass**. A depth-band clip (camera near plane 1.4 m in front of the wall) deletes trees, lamp posts and cars standing in front of the wall: the SW elevation came out clean, the first version without the clip had two blobs of canopy.
4. `detect.mjs`: window detector (luminance vs 1.5 m local mean, connected components, size/fill filters): 149 openings on the SW wall, 76 on the portico end. Recall is mediocre (by eye roughly two thirds on the sun-lit bays, not measured; it misses the shaded left third and glazed bars, finds false positives at banners), so it was used to *calibrate* the grammar (bay pitch 3.15 m, tiers 5.7-10.3 / 12.3-14.3 / 19.65-21.95 / 1.8-3.7 m), not to emit geometry directly. See `scripts/out/onebuilding/detect-sw.jpg`.
5. **"AI reads facade -> grammar"** (method d-VLM), done by me looking at the rectified elevations and Commons photos: the numbers in `gen.js` (`G = {...}`, 17 bays per long wall, hooded end-pavilion windows, 6 columns at 3.41 m, entablature 14.2-16.7 m, pediment to 19.0 m, three massing levels, cornices at 17.2 / 25.2 / 31.9 m...). It took a few look-measure-render iterations. It scales only if made a loop: prompt a VLM with the rectified elevation + the cadastre footprint, ask for the grammar JSON (tiers, bay pitch, opening sizes, cornice heights, ornament list), render it, and verify automatically by re-projecting the model's elevation and comparing it to the orthophoto (edge/contour IoU, window mask IoU: the measuring code already exists in `detect.mjs`, a diff image costs ten lines). I would trust it for heights/pitch (measurable), not for ornament, which needs a human glance.
6. `gen.js`: the grammar -> geometry. A tiny library of generic pieces: **wall with openings** (grid-cut wall, reveals, glass at depth, mullion/transom), stacked-box cornice rings, dentil/corbel rows, balusters, fluted column shaft (14 flutes as alternating radius facets), capital (abacus + volutes), entablature, pediment with a recessed tympanum, hip roofs, skylights. 3 LODs by switches (reveals/bars/dentils/balusters/flutes dropped).
7. `atlas.mjs`: the **bake**. Elevation colour -> **de-lit albedo** (divide by a 3 m luminance estimate, gain clamp 0.75-1.9, power 0.85, then white balance to warm plaster); advertising banners painted out; **normal map** from the high-passed depth (relief finer than 0.6 m; the coarse depth is real geometry now) and **ORM** (AO from recessed depth, rough 0.88); one 2048x1536 atlas: SW wall (shared with the mirrored NE wall: the building is symmetric), portico end, loggia, flat swatches. Roof, glass (with emissive window mask) and palette textures are synthetic.
8. `export.mjs`: GLB via gltf-transform: weld, meshopt (EXT_meshopt + KHR_mesh_quantization), WebP textures (q82), COLOR_0 = cheap cavity shade in reveals.
9. `viewer.html/.js`: three.js with the tram game's three looks (`env.js` hemisphere/sun/exposure/fog values copied), LOD / variant / wireframe / day-evening-winter switch, tram cab and chase cameras from `track.js` + the game's camera rules (read-only import), four orbits. Winter = a shader patch (`vWN.y` smoothstep -> white) on up-facing surfaces of every material, evening = `emissiveIntensity` on the glass material (the emissive texture *is* the lit-window mask, 4 of 8 glass variants lit).
10. `renders.mjs`, `clips.mjs`, `sheet.mjs`, `grun.mjs`/`ghero.mjs` (current game, live site, read-only), `gcount.mjs` (triangles of the live game inside the Opera's box).

Results (images in `scripts/out/onebuilding/`, owner's eyes only):

| | triangles | file (GLB) | gz | verdict |
| --- | --- | --- | --- | --- |
| raw reality mesh in the 100x140 m box | 1 479 139 (non-indexed, 4.44 M vertices, ~520-620 draw calls, 649 textures) | 142 MB geometry raw + 12.7 MB JPEG (141 Mpx) | ~50 MB wire | the truth, but unusable: 755 MB of texture memory (RGBA+mips), melted loggia, trees, cars |
| current game (live, day, same camera) | 12 586 in 2 meshes, ~1.24 MB vertex data | built at runtime from the footprint (no per-building download) | | right rough massing, generic grey-cream blocks with a generic window grid; the Opera-specific features are only partly there (the live version already has a portico of pilasters, but no entablature lettering, relief, dentils, balustrades, real window rhythm) |
| (a) `opera-a-bake-proxy` | **274** | 578 KB | 561 KB | surprisingly good at 100 m+, flat from the cab at 20 m (columns are a photo on a box); fine as **LOD2** |
| (b) `opera-b-parametric` LOD0 | 12 118 | 162 KB | **23.7 KB** | crisp and correct silhouette/depth, but flat cream and lacks the colour of the real building; zero photo pixels |
| (c) `opera-c-hybrid` LOD0 | 12 118 | 726 KB | 579 KB | **best**: geometry reads as the Opera from every angle, photo colour on the facade |
| (c) LOD1 | 4 842 | 631 KB | 574 KB | no reveals/bars/dentils/flutes, still convincing from 40 m+ |
| (c) LOD2 (= (a)) | 274 | 579 KB | 561 KB | skyline |

Per-LOD numbers of the final hybrid: LOD0 12.1 k tris, **3 draw calls** (wall, roof, glass), LOD1 4.8 k, 3 calls, LOD2 274 tris, 2 calls. Textures: one atlas set shared by all LODs: albedo + normal + ORM, each
2048x1536, WebP ~560 KB total on the wire (the GLBs above each embed it; deployed once it is ~0.58 MB + ~60 KB geometry for all three LODs). GPU memory: uncompressed RGBA + mips would be 3 x 16.8 MB = 50 MB
(too much for a phone); the same atlas as BC7/ASTC 4x4 is 12.6 MB, as ASTC 6x6 (albedo only 2048x1536, normal/ORM dropped at LOD1+) about 2-5 MB. KTX2/Basis was not produced (no `toktx` here and I installed nothing globally): these GPU figures are
calculated, the WebP and triangle figures are measured. Vertex data (meshopt-quantised, ~24 B/vertex): LOD0 ~0.6 MB, LOD1 ~0.23 MB.

Efficiency, plainly: **100 hybrid buildings at this level would cost** ~58 MB download and (12.6 MB x 100) 1.2 GB GPU: no. **20 signature buildings** at ASTC 6x6 albedo-only + LOD swap: ~12 MB download,
~60-100 MB GPU, ~80 k triangles per frame if all were at LOD0 (they never are). **100 parametric (b) buildings**: ~2.4 MB download, no texture memory, but 1.2 M triangles if all LOD0: the parametric style needs a *lighter* grammar for ordinary buildings (1-3 k triangles, instanced bays), which is exactly what a library of generic pieces allows.

## 4. What looks good / what is wrong (frank)

Good: portico (fluted columns, entablature with the real lettering from the atlas, pediment relief), the three-level massing and cornice stack, 17 bays with real window rhythm and reveals, tower and hip roofs, the three looks (lit windows in the evening, snow on every up-facing ledge and roof in winter, same asset), 12 k triangles in 3 draw calls, 24 KB gz for the geometry-only version.
Wrong / unfinished: (1) baked sun shadows survive partly (the diagonal shadow on the SW wall, the same shadow mirrored onto the NE wall: de-lighting is a blur-divide, a learned de-lighter would be better); (2) the albedo is the *municipal* pixels, ground floor still blurry (the reality mesh smears it), doors are flat brown quads; (3) loggia back wall is plain plaster + openings (the photogrammetry is melted there), so it looks emptier than reality; (4) no sculpture except blocky proxies (acroteria, lyre group, pediment figures are a photo on a box); (5) rear/annex are rough boxes with a few windows; (6) the NE wall reuses the SW texture; (7) a trace of the red/blue banner edges remains at the portico piers; (8) the window detector alone is not enough; (9) the tram-view context (grey ground, extruded cadastre blocks) in my viewer is poorer than the game's streets: compare the building, not the street; (10) the normal map adds little at this scale (kept at 0.5); (11) no collision/occlusion proxy exported, but LOD2 doubles as one; (12) the game's Opera is being reworked by another agent right now, the "current game" images are the live site at the time of the test.

## 5. Reproduce (one building)

```
node tools/onebuilding/fetch.mjs                 # finest nodes -> tools/.cache/onebuilding/i3s  (SP=0.12, --dry first)
node tools/onebuilding/server.mjs &              # :5196
node tools/onebuilding/ortho.mjs                 # rectified elevations + depth -> .cache/onebuilding/work
node tools/onebuilding/detect.mjs                # openings (calibration) + overlays
node tools/onebuilding/atlas.mjs                 # de-lit albedo / normal / ORM atlas + synthetic textures
node tools/onebuilding/export.mjs                # GLBs: .cache/onebuilding/out (municipal pixels) and tools/onebuilding/out (b-parametric, none)
node tools/onebuilding/renders.mjs; node tools/onebuilding/clips.mjs all     # stills, hero, turntable.mp4, drive-past.mp4
```
Viewer: http://localhost:5196/viewer.html?model=hybrid&lod=0&theme=evening&view=chase&s=1300 (models: hybrid, param, bake, ref, none; views: orbit0-3, cab, chase; `noui=1`, `ctx=0`).

Time: this first building, including building the tools, was one long session (I cannot time it honestly in wall-clock; the heavy parts were the grammar reading and fixing the facade texture seams). With the tools in place a comparable signature building should be **~1 working day** (a human supervising a VLM-written grammar: 2-3 h; fixing sculpture/portico pieces: 2-3 h; checking: 1 h); a second building of the same style is half of that because the library is reused.

## 6. Scaling

* ~20 signature buildings: hybrid (c) with a shared ornament library, atlas at ASTC 6x6, LOD0/1/2. Estimate 20 days of one person, falling to ~10 with the library. The municipal-pixel question must be settled first, otherwise ship (b).
* ~650 corridor buildings: **not** the Opera pipeline. A generic grammar with 8-10 archetypes (Art Nouveau corner, 19th-century tenement, Khrushchev block...), window rhythm from the existing sampled facade (`tools/sampling`, rectified 10 cm/px images already exist for the whole centre), VLM or detector fills the parameters, palette textures only (no photos), 1-3 k triangles, instanced bays. Pixel baking per building is too expensive in time (hours per building) and memory.
* Automatable: fetch, rectification, de-light, atlas, export, window detection, verification diff. Hand work: reading ornament, portico/sculpture pieces, the decision where photos are trustworthy.

## 7. Licensing per artefact

| artefact | municipal imagery? | may ship? |
| --- | --- | --- |
| `tools/onebuilding/*.mjs|js|html`, README | no | yes |
| `tools/onebuilding/out/opera-b-parametric-lod{0,1,2}.glb` (palette texture, synthetic glass/roof) | **no pixels**. Dimensions were *measured* from the mesh and OSM footprint (c) OpenStreetMap contributors (ODbL) | yes; keep OSM attribution; I consider measurements facts, but the owner may want the municipality's view |
| `tools/.cache/onebuilding/out/opera-c-hybrid-*.glb`, `opera-a-bake-proxy.glb`, `tex/atlas-*.png` | **yes** (albedo/normal/ORM baked from the reality-mesh textures) | **only with the municipality's written permission** |
| `tools/.cache/onebuilding/work/*` (ortho, depth, openings, i3s) | yes | no |
| `scripts/out/onebuilding/*` (renders, sheets, mp4) | yes (reality mesh and hybrid) | owner's eyes only, git-ignored |
| Commons images in `.cache/.../ref/` | not municipal; CC BY-SA 3.0/4.0, public domain | not shipped; none used as pixels. If ever used: per-image attribution (author + licence + link as in `sources.json`) and share-alike on derived textures |
| OSM-derived facts | no | ODbL attribution |

## 8. Recommendation

1. **Signature buildings (the ~20):** hybrid, but make the *geometry* the star: grammar + ornament library (this folder's `gen.js` is the seed: wall-with-openings, cornice rings, dentils, columns, pediment, balustrade). Ship it first in the photo-free (b) form with a hand-picked palette and per-building vertex colours; add the baked atlas only if the municipality agrees in writing, and then only the facade bands where the photogrammetry is reliable (upper floors), never ground floors or loggias. Keep (a) as LOD2.
2. **Ordinary buildings:** generic grammar + palette (b-lite), no per-building bake; VLM/detector fills parameters from the existing rectified facade images; budget 1-3 k triangles.
3. **First steps:** (i) ask the municipality for a written redistribution licence (or at least derivative-texture use); (ii) port `gen.js` pieces into the tram city renderer as reusable generators and swap the Opera's grammar numbers in; (iii) provide a Mapillary token if street-level ground floors are wanted; (iv) get a KTX2 tool (toktx or a basis wasm) for the atlas; (v) automate the grammar-verification diff before attempting a second building.
4. Not recommended: Gaussian splats / NeRF (not relightable, not collidable, heavy on phones), generative image-to-3D (cannot respect the footprint).

Attribution to carry if anything from this work ships: (c) OpenStreetMap contributors (ODbL); Riga municipality reality mesh only with permission; Commons photos only if their pixels are ever used (list in `sources.json`).
