# tools/detail — better 3D shapes for notable buildings

Produces `tools/detail/data/riga-detail.json` (spike output, input only, not shipped) and, from it, `public/data/riga-shapes.bin.gz` with `build-meshes.mjs` (the file the game loads, see the main README "Building shapes"; needs `riga.json` for footprints). Two sources:

* **Track A** — OpenStreetMap "Simple 3D Buildings" (`building:part`, `roof:*`, `height`, ...).
* **Track B** — the city's photorealistic reality mesh (ArcGIS I3S "integrated mesh" scene layers), used **only as a measuring
  instrument**: triangles are rasterised into height grids; neither mesh nor textures are shipped.

All downloads are cached under `tools/.cache/detail/` (User-Agent `riga-game-data-builder`, <= 4 concurrent requests, retry with backoff).
Node >= 20, no build step. Only optional dependency: `draco3d` (see "Draco" below; not needed).

## Scripts

| script | what |
| --- | --- |
| `fetch-osm-parts.mjs` | Overpass: all `building:part` + `building` ways/relations (tags + geometry) -> cache; prints coverage (`osm-coverage.json`, `osm-by-game.json`) |
| `osm-notables.mjs` | table of ~30 notable buildings: OSM element, 3D tags, number/shape of parts (`osm-notables.json`) |
| `osm3d.mjs` | library: OSM element -> `parts` schema (heights per OSM wiki, roof shapes mapped, roof:direction -> `dir`) |
| `i3s.mjs` | I3S client: layer discovery (web scene `0f550060…`), layer JSON, node pages, tree walk to a target vertex spacing, geometry fetch + parse (uncompressed buffer; Draco optional), Mercator <-> game-local projection. `node i3s.mjs layers\|stats <spacing>` |
| `dsm.mjs` | triangles -> max-elevation raster (game-local x/z, any cell size); footprint grid; ground estimate; stats |
| `shape.mjs` | grid encoder/decoder (Uint8 + RLE + base64), grid mesher and parts tessellator (reference for the renderer) |
| `fit.mjs` | V2: fit stacked prisms + roof primitives to a height grid |
| `build-detail.mjs` | `analyze --set=proto\|notable\|all` (mesh -> per-building analysis cache), `assemble [--variant=grid\|parts\|both] [--relief=3.5] [--no-coarse] [--no-osm] [--out=…]` |
| `check-alignment.mjs` | footprint vs mesh alignment (best shift of 300 sample buildings) |
| `validate-heights.mjs` | mesh heights vs known landmark heights |
| `preview-protos.mjs` | writes `tools/.cache/detail/preview-<slug>.png` (hillshade \| V1 grid mesh \| V2 parts \| OSM parts) |
| `build-meshes.mjs` | grid / OSM parts -> clean low-poly shapes + outline loops + measured heights -> `public/data/riga-shapes.bin.gz` (~9 s, offline). `--only=<id,id> [--verbose] [--why] [--report]`; env `PLANAR_DEBUG=<id,id>` writes `tools/.cache/detail/labels-<id>.png` (height grid + plane labels), `PLANAR_WHY=1` prints fit diagnostics |
| `planar.mjs` | plane-fitted roofs (RANSAC planes, lathe domes / pyramid spires, shared-chain boundaries, straightened ridges, CDT, welded heights + vertical step walls), see "Plane-fitted mesher" |
| `parts.mjs` | OSM `building:part` list -> exact prisms + planar gable/hip/skillion roofs + smooth lathe domes / onion domes / cones (+ optional gilded crosses) |
| `heroes.mjs` | curated config of the ~25 landmark buildings: ids, source (`parts` / `mesh` / `auto`), facade style, palette, camera notes; `BLOCK_IDS` = 6 fixed ordinary blocks for before/after shots |
| `preview-shapes.mjs` | software-rendered preview of what is in `riga-shapes.bin.gz` (no browser): `node preview-shapes.mjs nativity blocks heroes <id>` -> `tools/.cache/detail/shape-<name>.png` (env `PITCH=25`, `SHAPES=<file>`) |
| `render.mjs` | tiny software rasteriser + PNG writer used by the previews |

Re-run: `cd tools/detail && npm i && node build-detail.mjs analyze --set=all && node build-detail.mjs assemble --variant=grid && node build-meshes.mjs`.
`analyze` takes its area from `riga.json` `meta.bounds` (+100 m) and skips cached buildings, so after a map extension only the added buildings are downloaded
(the 2026-11 extension to x in [-2100, 1200], z in [-1200, 1500] cost 243 MB over the wire / 728 requests, 441 more buildings with grids; named / >= 12 m buildings outside the old box are measured at 0.5 m).
(`analyze` skips buildings already in `tools/.cache/detail/analysis/`; delete that folder to redo them.)

## Track B facts (I3S)

* Web scene item `0f550060386a435da391357ccf89d269` lists 45 `IntegratedMeshLayer`s at
  `https://tiles-eu1.arcgis.com/JzVauvrMa89dBJ9D/arcgis/rest/services/<name>/SceneServer/layers/0`. 14 overlap our +-1200 m box
  (we skip `Pazeme_*` = underground/terrain-ish layer): `vecriga_lod_rebuilt_wgs` (Old Town), `region_3_wgs`, `region_4_11122023_WGS`,
  `Region_1_11122023_wgs`, `Region_8_WGS`, `Region_19_wgs`, `Region_17_labots_WGS`, `region_7_VDD_clipped_WGS`, `centraltirgus_wgs`,
  `skanste_region_2_wgs_izgriezts`, `augstceltnes_R1_WGS`, `pils_pagalms_50cm_wgs`, `region_3_AM_25cm_wgs`, `region_4_ZA_11122023_WGS`.
* Store version 1.8-1.10, profile `meshpyramids`, `lodType: MeshPyramid`, `lodModel: node-switching` (a selected node replaces its parent).
  `spatialReference`/`indexCRS`/`vertexCRS` = EPSG:3857 (web Mercator, **x/y stretched by 1/cos(lat) = 1.834 at Riga**, z in true metres,
  orthometric-looking: Riga ground = 3..10 m, St Peter spire top = 129 m). `nodePages.nodesPerPage = 64`, metric `maxScreenThresholdSQ`.
* Node page `n` = `/nodepages/n`; node `id` lives in page `floor(id/64)`, index `id%64`. Each node has `obb {center, halfSize, quaternion[x,y,z,w]}`,
  `lodThreshold`, `children`, and `mesh.geometry {definition, resource, vertexCount}`; the **resource** number (not the node index) is used in
  `/nodes/<resource>/geometries/<k>`.
* Geometry buffers: `geometries/0` = uncompressed, 8-byte header (`vertexCount`, `featureCount` UInt32) then `position Float32x3`
  [`normal Float32x3` in some layers] `uv0 Float32x2` [`color UInt8x4`], non-indexed triangles, positions **relative to the node OBB centre** (mercator metres).
  `geometries/1` = Draco (same frame, indexed). Textures `/nodes/<resource>/textures/0` (jpg) / ktx2 / dds — not fetched.
  Vertex colours are all white, so colours would need texture sampling (skipped in this spike).
* Tree walk (`Layer.select`): descend while the estimated vertex spacing `sqrt(0.6*areaXY/(vertexCount/2))` of the node is > target. We use target 0.55 m
  (tree depth 4 in the Old Town layer, 6 in the others; observed mean triangle edge ~1.0-1.5 m, much finer on ornate roofs, flat areas use large
  triangles) for the 412 notable buildings and 1.0 m (depth 3 / 5, mean edge ~2-3 m) for everything else.
* Draco: `draco3d` decodes the same geometry in the same frame, but with the 1.5.9 node build the wasm heap runs out (`memory access out of bounds`)
  on larger batches; `i3s.mjs` has the code path (`{draco:true}`) but the build uses the uncompressed buffer (2x the wire bytes).

## Licensing metadata found (verbatim; no legal conclusion)

* Web scene item `0f550060386a435da391357ccf89d269` ("Vecpilsetas_un_apbuves_aizsardzibas_teritoriju_REALITATES_MODELIS", owner `GeoRiga`):
  `accessInformation: "Rīgas valstspilsētas pašvaldība"`, `licenseInfo: ""`, `description: ""`, snippet "Rīgas realitātes modelis apbūves aizsardzības teritorijām (pilsētbūvnieciskajiem ansambļiem)".
* Scene service items: `region_4_11122023_WGS`, `BOLDEREJA_WGS_WEB_MERC`: `accessInformation: "Rīgas valstspilsētas pašvaldība"`, `licenseInfo: ""`;
  `vecriga_lod_rebuilt_wgs` (owner `janis.akmentins_RPP`): `accessInformation: "Generated with Agisoft Metashape"`, `licenseInfo: null`, `description: ""`.
* Layer JSON `copyrightText`: `"Generated with Agisoft Metashape"` (all Metashape layers); `description` of `centraltirgus_wgs`: "This layer contains a reality mesh created with Bentley ContextCapture." (no copyrightText).
* Same org's LGIA items (not used): `accessInformation: "© Latvijas Ģeotelpiskās informācijas aģentūra, 2021"`.
* OSM: "Contains data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0" (https://www.openstreetmap.org/copyright).
* No explicit terms-of-use text exists in the item/layer metadata. Raw copies: `tools/.cache/detail/meta/`, `webscene-item.json`, `layers/*.json`.

## Method (Track B)

1. `buildDsm`: for a local-metre box, per overlapping layer select nodes, fetch geometry (4 concurrent), project vertices exactly
   (Mercator -> lon/lat -> the same equirectangular projection as `tools/build-data.mjs`), rasterise each triangle (barycentric fill + edge
   sampling so walls register) keeping max z per cell; layers are combined with max.
2. `footprintGrid`: cells whose centre is inside the cadastre polygon; **ground** = 20th percentile of mesh cells 1.0-4.5 m outside the
   polygon (ignoring cells > 2.5 m above the ring median = neighbours/trees); heights above ground = cell - ground (mesh holes filled from neighbours).
3. Fine pass (412 notable: OSM name, `t` rel/pub, riga.json h >= 25, landmark-matched): per building DSM, 0.5 m cells. Coarse pass (all others):
   per 250 m tile, 1 m cells.
4. V1 stores the grid; V2 (`fit.mjs`) fits stacked prisms + roof primitives.

## `tools/detail/data/riga-detail.json` schema (as written)

```
{
  meta: { name, version, generated, coords, origin, sources[], license{…verbatim metadata…}, schema{…}, stats{…}, heightVsRigaH{…}, variantSizesBytes{…} },
  heights:    { "<riga.json building id>": metres },   // p90 of mesh height above ground inside the footprint (roof top of main body), 4232 buildings
  heightsP50: { "<id>": metres },                       // median (volume-like height; for flat extrusions of pitched-roof buildings)
  buildings: { "<id>": {
      src: "mesh" | "osm",
      ground?: metres a.s.l. (mesh datum, informational),  h?: = heights[id],  hmax?: absolute maximum (spire tips),
      grid?:  { x0, z0, cell, w, h, scale, data },   // V1
      parts?: [ { p:[[x,z]…], y0, y1, roof:{ shape, h, dir? } } ],  // V2 (only with --variant=parts|both)
      osm?:   [ same part schema ]                    // from OSM building:part (>= 2 parts); preferred when present
  } }
}
```
* Coordinates = riga.json local metres (x east, z south); y = metres above local ground.
* `grid`: cell (i,j) covers x in [x0+i*cell, x0+(i+1)*cell), z in [z0+j*cell, …). `data` = base64 of byte pairs `[runLength(1..255), value]`;
  expanded array has `w*h` bytes row-major (`j*w+i`); `0` = outside footprint, else height above ground = `(value-1)*scale` m. Notable: cell 0.5 m,
  scale 0.5 (max 127 m). Others: cell 1.0 m, scale 1.0; only written when roof relief (p90-p10) > 3.5 m (pitched roofs, towers); flat ones need only `heights`.
  Renderer: clip to riga.json `p`, mesh the surface, vertical walls at the footprint (reference mesher: `gridToTris` in `shape.mjs`: corners = mean of
  neighbouring cells within 1.2 m so plateaus stay flat and drums/walls stay vertical, skirts where neighbours disagree). Cells < ~0.4 m high are open courtyards.
* `parts`: prism `p` from `y0` to `y1`, then roof of rise `h` above `y1`. `shape` in flat|gabled|hipped|skillion|pyramid|cone|dome|onion.
  `dir` = ridge direction in degrees from +x (east) towards +z (south); skillion rises toward the left-hand side (dir+90). pyramid/cone/dome/onion scale the
  ring about its centroid to the apex. Reference tessellator: `partsToTris` in `shape.mjs`.
* Default file = heights + heightsP50 + fine grids (412) + coarse grids (1810) + OSM parts (44). Other variants: `assemble --variant=parts --no-coarse`
  (V2 + heights + OSM only), `--variant=both`.


## Plane-fitted mesher (`planar.mjs`)

Replaces the error-bounded TIN as the default roof mesher (the TIN stays as fallback: footprints with < 20 m^2 of valid cells and fits whose residual is too high).
Input: the denoised height field (cells < 0.7 m are open ground; no rim lifting any more), the outline loops (cadastre ring simplified at 0.4 m, or the traced contour when
there are real courtyards), per-class options (notable: 0.5 m cells, plane tolerance 0.35 m, >= 9 m^2 per region, <= 26 planes, lathes on; relief: 1 m cells, 0.8 m, >= 18 m^2, <= 10 planes).

1. **Lathe detection**: local maxima >= 3.5 m are probed on 16 rays (round) or on square perimeters (pyramids, rotated to the outline's longest edge, 6 angles);
   the apex centre is refined (0.2 m grid) and a base radius is found where the profile hits the footprint edge, a cliff (drum rim / tower top, relative to the local slope), or loses
   symmetry. Accepted when the symmetry error beyond 13 % of the height drop is small (this rejects ridges and hips, accepts domes, cones, onion domes, round tower roofs
   and square or round spires). The measured radial profile (monotone, resampled by arc length, <= 10 rings; 2-10 vertices for pyramids) becomes a surface of revolution on a 12-24 gon (or square) base polygon.
2. **Planes**: RANSAC on the remaining cells (120 trials, 3-point planes, slope <= 62 deg), refit on the largest connected inlier set, residual cells join the plane within 1.6 tol or grow in from neighbours;
   mode filter + merge of regions smaller than the minimum area (chimneys, dormers, tree overhang, noise).
3. **Boundaries**: label-map borders become chains between junctions (shared by both neighbours, simplified once with Douglas-Peucker); a chain between two pitched planes whose
   heights meet is moved onto their intersection line (straight ridge / hip / valley), junctions go to the common point of their planes, chain ends snap onto the outline or lathe base.
4. **Triangulation**: constrained Delaunay of outline + chains + lathe base polygons (no interior points, planar faces stay planar); components between constraints get their plane.
5. **Heights**: every triangle vertex takes its plane's height; vertices where neighbouring planes differ by < `weld` (0.8 / 1.1 m) are welded (mean), elsewhere a vertical step wall
   (class 2) joins the two levels (tower / drum / parapet walls are exactly vertical, their top and bottom follow the planes). Outline walls are still extruded by the game from the loops; a loop may contain zero-length edges where two roof levels meet the wall.

File format `BSH1` v2: header `stride: 14`, record = `id, nv, nt, nl, src, vol, hmax10, eave10, roofRGB, wallRGB, domeRGB, accentRGB, style, flags` (colours 0 = default palette).
Triangle classes (`mats`): 0 flat roof, 1 pitched roof, 2 wall (windows; step walls, drums, towers), 3 dome / spire (hero `dome` colour or verdigris), 5 accent (gold crosses). `style`: 0 apartment windows,
1 church (tall narrow windows, floors 8.5 m), 2 palace (large windows, floors 5.4 m), 3 plain stone (no windows).

## Heroes (`heroes.mjs`)

Per hero: `source` = `parts` (OSM parts, forced; used for the Nativity cathedral whose OSM model is clean) / `mesh` (plane-fitted mesh, OSM never used) / `auto` (parts when they agree with the mesh, else mesh).
The OSM models of the Dome, the Opera and St Peter were checked and are worse than the measured mesh (bulb tower, plain boxes), so those use the mesh. Old / New St Gertrude: `49619142` is the Old
(Ģertrūdes iela) church; `49622206` (Lāčplēša iela 37) is the Baptist Union chapel (9.6 m), not New St Gertrude, which stands at Brīvības iela 119 outside the map, so it was dropped.
Review shots: `PORT=5181 GPU=1 node scripts/detail-shots.mjs [slug ...] [--prefix=before-]` -> `scripts/out/hero-<slug>-{a,b,play}.png`, `hero-sheet.png`, `block-1..6.png`, `detail-overview*.png`.

Hero flags added later: `ortho` (outline edges within 14 degrees of the dominant axes are squared), `ringTol` (eave-line simplification, m), `fit` / `opts` (planar / mesher option overrides), `barrel` (parametric half-elliptic vault over the footprint's oriented box, the Central Market pavilions),
`stepGable` (gabled body + stepped brick gables, the House of the Blackheads); facade style `4` = glass curtain wall (cool tint, fine horizontal bands). Heroes are always measured at 0.5 m (`notableSet`).
Library (Mūkusalas iela 3, id 49629679, 12.5k m^2, one cadastre piece, hmax 70.8 m) and Saules akmens (tall tower is `49639844`, Balasta dambis 15, 120.6 m; the earlier id `49639106`, 78 m, is Preses nams) are curated that way.

## Districts (maps)
All scripts take `--map=<slug>` (`agenskalns`, `mezaparks`, `purvciems`; default `centrs`): `node build-detail.mjs analyze --set=all --map=<slug>`, `assemble --variant=grid --map=<slug>` (-> `data/riga-detail-<slug>.json`),
`node build-meshes.mjs --map=<slug>` (-> `public/data/<slug>/riga-shapes.bin.gz`, resolved by the client through `CFG.shapesUrl`). The analysis cache is shared by cadastre id. Heroes carry `map: '<slug>'`;
review shots: `MAP=<slug> PORT=5181 GPU=1 node scripts/detail-shots.mjs` -> `scripts/out/district-<slug>-shapes-*.png`.
Measured 2026-11: reality-mesh coverage Āgenskalns 82 % of buildings (5876/7166), Mežaparks 98 % (1843/1871), Purvciems 18 % (617/3379: the rest keeps pipeline heights). Download 700 + 423 + 120 MB.
Purvciems (`data.meta.slug === 'purvciems'` in `src/buildings.js`): res/com/pub boxes >= 8 m and > 200 m^2 get pale panel colours + a regular 2.8 m x 2.7 m window grid, big boxes (> 350 m^2) get flat grey roofs, no mansards.
