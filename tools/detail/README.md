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
| `build-meshes.mjs` | grid / OSM parts -> simplified indexed roof meshes + outline loops + measured heights -> `public/data/riga-shapes.bin.gz` (~6 s, offline) |
| `render.mjs` | tiny software rasteriser + PNG writer used by the previews |

Re-run: `cd tools/detail && npm i && node build-detail.mjs analyze --set=all && node build-detail.mjs assemble && node preview-protos.mjs --osm`.
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
