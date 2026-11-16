# tools/surface: ground-cover class raster measured from an open orthophoto

`public/data/riga-ground.png` (palette-indexed, 1 m/px over `meta.bounds`, ~530 KB) tells `src/ground.js` what covers the ground between
roads and buildings: lawn / tree canopy / asphalt / light paving / gravel / ballast / sett / water. It is **derived data**: the orthophoto is
only used as a measuring instrument (colour rules, see below); no imagery is shipped, the game paints flat stylised colours.

## Source and licence (verified 2026-11-15)

* Source: **LĢIA (Latvijas Ģeotelpiskās informācijas aģentūra) colour orthophoto map 2016-2018, cycle 6**, 0.25 m, GeoTIFF, LKS-92 TM, open data.
  Page: <https://www.lgia.gov.lv/en/color-orthophoto-map-2016-2018-cycle-6> ("Data is available in GeoTIFF raster format.", "a resolution of 0.25 meters").
  Download index: <https://s3.storage.pub.lvdc.gov.lv/lgia-opendata/ortofoto_rgb_v6/LGIA_OpenData_Ortofoto_rgb_v6_saites.txt>
  (files `…/ortofoto_rgb_v6/4311/4311-<row><col>_<quarter>.tif`, 2.5 km x 2.5 km, uncompressed, 512 px tiled; no login).
* Licence statement on LĢIA's open-data page (<https://www.lgia.gov.lv/en/atvertie-dati>): "Open data can be freely used, modified and
  redistributed by anyone." The data are published under **Creative Commons Attribution 4.0 International Public License**; LĢIA links the
  licence text as <https://www.lgia.gov.lv/sites/lgia/files/document/Creative%20Commons%20Attribution%20CC%20BY_0.pdf>.
  Licence text (Section 2(a)(1)): "Subject to the terms and conditions of this Public License, the Licensor hereby grants You a worldwide,
  royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material to:
  A. reproduce and Share the Licensed Material, in whole or in part; and B. produce, reproduce, and Share Adapted Material."
  Section 3(a)(1)(B)-(C): "indicate if You modified the Licensed Material …; and indicate the Licensed Material is licensed under this
  Public License, and include the text of, or the URI or hyperlink to, this Public License."
  => deriving a classification raster from it and shipping that is permitted with attribution + "modified" + licence link
  (done in the About popover, `src/i18n.js`: "Zemes seguma klasifikācija: © LĢIA ortofoto 2016-2018, CC BY 4.0, pārveidota" / "Ground-cover classification: © LĢIA orthophoto 2016-2018, CC BY 4.0, modified").
* Not used on purpose: the LĢIA WMS/WMTS services (`wms.lgia.gov.lv/open/...`) need an authorised account ("autorizēta pieeja", the
  folders answer HTTP 403 without credentials) and no attempt was made to get around that; LVM GEO (lvmgeo.lvm.lv) was not queried (it only re-serves
  LĢIA imagery, and the open-data GeoTIFFs above make it unnecessary). Google / Bing / Esri imagery were never used.
* Caveat: the flight is 2016-2018, the map data is newer. Anything built or cut down since then is wrong in the raster; vectors (buildings, roads,
  water) override it where they are authoritative.

## Pipeline

```
node tools/build-data.mjs            # vectors -> public/data/riga.json (needs tools/.cache from the Overpass / cadastre downloads)
node tools/surface/fetch-ortho.mjs   # range-requests only the needed 512 px tiles (~450 MB read), caches a 0.5 m mosaic in tools/.cache/ortho (110 MB)
node tools/surface/build-ground.mjs  # classification -> public/data/riga-ground.png   (DEBUG_PNG=1 also writes /tmp/ground_dbg.rgb)
node tools/preview.mjs               # SVG/PNG preview of the vector layers (tools/.cache/preview.svg[.png])
```
All downloads are cached under `tools/.cache`, at most 3 concurrent, retries with back-off, User-Agent `riga-game-data-builder`.

### Classification (build-ground.mjs)

1. Mosaic -> local metres (exact LKS-92 TM transform, bilinear), 0.5 m.
2. Per 0.5 m pixel: vegetation if `2g - r - b >= 10`; warm bare earth / gravel if `r - b >= 13`; shadow if luminance < 74; else grey.
   Per 1 m cell: majority vote; vegetation darker than Y 86 = tree canopy, lighter = lawn.
3. Vectors decide what colour cannot (asphalt and granite look alike in this imagery): road corridors = asphalt, parking / `area:highway` = asphalt, rail
   landuse = ballast, squares / pedestrian streets / platforms / piers = paving, other grey: smoothed lit luminance (>= 122 paving, else asphalt),
   inside parks grey = path (paving) or shaded canopy. Photo wins over OSM for vegetation (a plaza mapped inside a park comes out paved; lawns inside a
   `sq` polygon stay green). Old Town ellipse paving = sett (patterned at runtime).
4. Shadows and unknown cells (building footprints dilated 1 m: roof lean) are filled from the nearest lit ground class (BFS, 30 m); building interiors stay neutral.
5. Quay apron of 2.5 m next to water, 3x3 mode filter twice, specks < 45 cells removed, tan blobs surrounded by paving relabelled (monument bases).
6. PNG: 4-bit palette (palette index * 16 in the red channel; the game reads `round(R / 16)` and maps the class to its own colours), per-row filter search, zlib 9.

Class ids: 0 other (=paving), 1 lawn, 2 canopy, 3 asphalt, 4 paving, 5 gravel, 6 water, 7 ballast, 8 sett; added by `tools/mapfix/` (from the reality-mesh height raster, not the orthophoto): 9 running track, 10 dense forest (Mežaparks; the game scatters pines on it). `tools/mapfix/trees.mjs` also raises canopy (2) to the mesh's tree-like cells (Centre 10.9 -> 20.7 % of observed cells, mesh 24.6 %).

The game works without the file (falls back to OSM land cover: `areas`, `parks` with holes, tree discs) and on the procedural sample city.
