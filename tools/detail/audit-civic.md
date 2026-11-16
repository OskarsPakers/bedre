# Civic / secular landmark audit (civic agent)

Inventory source: all four riga.json files (named non-religious buildings, hmax >= 30 m, `landmarks`, album rules in src/meta/album.js), the shapes headers and
the cached height grids. Counts (centre): 374 candidate rows (named / >= 30 m / hero / landmark, churches included in the raw count), ~140 non-religious notable.
Raw per-id table: regenerate with the one-off script logic in this file's "Method" (grid presence = detail json `grid`; path = shapes record `src`: 1 mesh notable (planar/TIN),
2 OSM parts or curated, 3 relief (1 m grid, coarse), none = flat extrusion).

| landmark | ids | footprint m2 | hmax m | path (before) | grid | verdict before | reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Central station hall | 49614666 | 2563 | 18.6 | mesh notable, one pale slab | 0.5 | GENERIC | flat slab, no glazing, wrong "palace-free" windows |
| Station east wing | 49615281 | 2521 | 18.1 | mesh notable | 0.5 | GENERIC | same |
| Station head + CLOCK TOWER | 49614810 | 1718 | 50.2 | relief (1 m grid, src 3) | 1.0 | WRONG | tower lost into a grey windowed box; not in the hero list at all |
| Platform canopies / 5 train halls | - | - | - | none (cadastre has no polygon, ground art only) | none | WRONG (missing) | no data; only rails and platform strips on the ground |
| Tan platform building | 49614921 | 2107 | 6 (22 spikes) | mesh notable TIN | 0.5 | WRONG | crumpled brown mesh from low sheds + mast spikes (not fixed) |
| Origo / Satekles 2B | 49611992, 49614964 | 3905 / 7275 | 24 / 29 | relief | 1.0/0.5 | generic | grey boxes, OSM parts rejected (not fixed) |
| Centrāltirgus 4 vault pavilions | 49614728/78/15303/15403 | ~2700-3100 | 22-25 | hero `barrel` (parametric, clean vault, flat grey ends) | 0.5 | PARTLY | no glazed gables, axis taken from jittery polygons (4 different angles), no ridge lantern |
| Centrāltirgus 5th (meat) pavilion | not a cadastre building | - | - | - | none | WRONG (missing) | only 4 small address pieces w/o grid at (100-140, 925-950) |
| Spīķeri warehouse rows | 49612972, 49615217, 49615466, 49614933 | 150-900 | 9-21 | mesh/flat, pitched roofs present | 1.0 | recognisable-ish | rows of pitched roofs exist; brick wall colour not special-cased |
| Nacionālā opera | 49616059, 49615786, 49615783 | 3517+2069+968 | 35.5 | auto/mesh, green roofs, 3 cadastre pieces | 0.5 | GENERIC | no portico/columns/pediment (decos are dropped for measured shapes) |
| Nacionālais teātris | 49614719 | 3108 | 25.7 | mesh (green blobs) | 0.5 | generic | crumpled roof planes |
| Dailes teātris | 49621082, 49612595 | 6285 + 6002 | 40 | mesh notable + relief | 0.5/1 | generic | grey boxes, fly tower not distinct |
| Splendid Palace | 49619824 | 1607 | 24.8 | mesh | 0.5 | generic | crumpled grey |
| Latvijas Universitāte | 49616039, 49616004 | 5054 | 35.7 | curated-ish mesh (ortho), green mansards | 0.5 | partly | no portal / dome |
| Kongresu nams | 49616534 | 5354 | 22.7 | mesh | 0.5 | generic | crumpled grey |
| Rātsnams | 49614687 | 2855 | 42.5 | auto | 0.5 | partly | tower present (42 m), details thin |
| Melngalvju nams | 49614347 (+49614380) | 965 | 33.5 | parametric stepGable | 0.5 | partly | plain red, both gables identical, no light trim (not changed) |
| Lielā / Mazā ģilde | 49616381, 49616364 | 1353/684 | 30/23 | mesh | 0.5 | generic | indistinct (not changed) |
| Trīs brāļi | 49614971, 49614596, 49614187/15271, 49612599/635 | 31-159 | 14-19 | mesh notable, 6 cadastre pieces | 0.5/1 | generic | cannot be told apart (not changed) |
| Kaķu nams | 49614702 (picked by pickCatHouse) | 150 | 16.5 | mesh + cats on tips | 0.5 | WRONG? | location coded in landmarks.js is (-429, 279); the real Meistaru iela 10 is near the guilds (~(-318, 225)); no turret geometry. Not changed, needs an owner decision |
| Rīgas pils | 49615051, 49614975 | 7725 | 57 | mesh | 0.5 | recognisable | towers and yellow walls read |
| Saeima | 49614901 | 1841 | 27.6 | mesh ortho | 0.5 | recognisable | |
| Brīvības piemineklis | prop | - | 42 | hand-made prop | - | recognisable | not changed |
| Laimas pulkstenis, Vanšu pylon, railway arches | props | - | - | hand-made props | - | recognisable | not changed |
| Pulvertornis | 49615275 | 173 | 40 | mesh | 0.5 | recognisable | regression: unchanged |
| Rīgas cirks, Radio, Zviedru vārti | 49615676, 49616468, 49615193 | 2384/1316/- | 26-29 | mesh | 0.5 | generic | no dome on the circus (not changed) |
| Zinātņu akadēmija, Hotel Latvija, Saules akmens, Z-Towers, Preses nams, library | heroes | | 70-132 | mesh/auto | 0.5 | recognisable | library crown tip / stepped slope not changed |
| Āgenskalna tirgus | 49634808 | 988 | 28.9 | mesh, style 2 | 0.5 | partly | no lantern (not changed) |
| Kalnciema koka nami | 49636186 | 369 | 19.7 | relief | 1.0 | generic | not changed |
| Lielā estrāde | 49673065, 49673070 | - | - | mesh | 0.5 | partly | roof wave not rebuilt (not changed) |
| Purvciems slabs / schools | heroes | | 30-34 | mesh | | clean | |

Summary: ~38 notable secular rows reviewed; 5 WRONG/missing (station head+tower, platform canopies, 5th market pavilion, tan platform building, cat-house location),
~14 generic, rest recognisable or partly. Fixed in this pass: station complex (3 objects + canopies as 4 new props), 4 market vaults, opera portico.
