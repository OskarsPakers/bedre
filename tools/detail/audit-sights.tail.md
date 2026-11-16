# Sights audit (tools/detail/sights.mjs + hand-written verdicts)

Gate: `npm run check:sights` (tools/detail/sights-report.mjs). Counts (total | failing before -> after; A / B / C):
* centrs: 427 sights | 421 -> 0 | A 60: 54 -> 0 | B 154: 154 -> 0 | C 213: 213 -> 0
* agenskalns: 372 | 371 -> 0 | A 2 | B 95 | C 275 (about 180 of them the "wooden quarter" heuristic, see below)
* mezaparks: 41 | 41 -> 0 | purvciems: 89 | 89 -> 0
"Before" = what the shapes record alone gave (heroes / churches), "after" = record + category treatment. The gate is a palette / style / feature rule, so it can pass while a sight is still hard to spot; the verdicts below are from the contact sheets (`scripts/out/sights-sheet-<map>-<n>.png`, gameplay zoom, day / high; `-low-`, `-evening-` for tier A) and are the honest part.

Notes: OSM carries almost no `building:material=wood` (1 in Āgenskalns), so wooden houses = small detached residential houses within 450 m of the Kalnciema quarter (heuristic). Mežaparks / Purvciems sights come from the base OSM cache only (the extra Overpass query hit 502s; rerun `node tools/detail/fetch-osm-sights.mjs` + `npm run build:sights`).
Kaķu nams: the cadastre piece addressed "Meistaru iela 10" (id 49616370, ~(-275, 148), 1077 m2, 24 m, 70 m from the Great Guild) is the Cat House; the old pick (Tirgoņu iela 5/7, 49614702) was wrong. The brief's (-318, 225) is the Small Guild. Album / achievement "cat" match by name, which now sits on the right building.
Centrāltirgus 5th pavilion: id 49615202 IS a cadastre building (5491 m2, 87-vertex polygon, 20 m vault, ridge ~151 deg, crosswise to the other four): built as a vault (`marketmeat`). Ministru kabinets (Brīvības bulvāris 36): no cadastre piece with that address in the centre map, not treated. Station 49614921: now a clean low platform building (`platformshed`).
Object counts unchanged (20900 / 27514 / 29093 / 37933). Only the centre placement hash changed (4fa488758265f362): Cat House moved (value 170 -> 20 on the old, 301 -> 873 on the new piece, landmark flag moved), station shed 89 -> 276, two others < 4 %.

## Tier A verdicts (centre unless noted)
| sight | what makes it distinguishable now | verdict |
| --- | --- | --- |
| Rīgas pils | yellow walls, deep wine-red roofs, round corner towers + flag | yes |
| Melngalvju nams | dark red brick, two different stepped gables (7 / 5 steps) with light trim | partly (small among red roofs) |
| Rātsnams | green roof, cream clock tower with copper cap, flag | yes |
| Trīs brāļi | three narrow gabled pieces in yellow / rose / green, pointed gables | partly (tiny, hidden by neighbours) |
| Lielā ģilde / Mazā ģilde | ochre / cream walls, wine roofs, stepped / pointed gable + turret | partly |
| Kaķu nams | yellow corners, teal roof, two turrets with black cats | partly at gameplay zoom, yes close up |
| Zviedru vārti | ochre block with dark arch front, wine roof | partly |
| Pulvertornis | dark round tower, conical wine roof (hero kept) | partly |
| Latvijas Universitāte | blue roofs, portico block + copper dome | yes |
| Nacionālais teātris | pale yellow, green roof, fly tower + portico | yes |
| Dailes teātris | huge navy roof, grey walls, big fly tower, canopy | yes |
| Mākslas muzejs / Mākslas akadēmija | hero shapes kept; roofs darkened out of the housing palette (dark green / blue) | partly (regression only) |
| Rīgas cirks | blue roof + copper dome | partly |
| Splendid Palace | cream, green roof, portico, cornice | partly |
| Kongresu nams | navy roof, grey walls, canopy + flag | yes |
| Saeima | cream, green roof, clock tower, flag | partly |
| Latvijas Banka | grey stone, green roof, portico, flag | partly |
| Okupācijas muzejs | near-black windowless box with dark cornice | yes |
| Latvijas Radio | blue-grey, navy roof, radio mast + canopy | partly |
| Nacionālā bibliotēka | glass mountain (hero) + crown tip | yes |
| Zinātņu akadēmija, Hotel Latvija, Saules akmens, Z-Towers, Preses nams | tall measured towers (regression), glass / navy palette | yes |
| Origo, Stockmann, Galerija Centrs | large blue glazed boxes with ridge lanterns + canopies | yes |
| Centrāltirgus (4 + 5th) | grey-green vaults, fifth crosswise | yes |
| Centrālā stacija (4 pieces) | teal-blue halls, clock tower, glazed fronts | yes |
| Spīķeri | brick walls, dark navy roofs, gables | yes |
| Rīgas pasažieru osta | teal block with clock tower + canopy | partly |
| Churches (tier A) | spires / domes of the church kit, roof darkened out of housing palette | yes (shape) |
| Āgenskalna tirgus (agenskalns) | warm stone, green roof, glazed ridge lantern | yes |
| Kalnciema koka nami (agenskalns) | timber style + porch, wooden quarter in brown / green / ochre | partly |
| Lielā estrāde (mezaparks) | pale shell with wave roof | partly |

Could not make distinct: tiny Old Town houses (Trīs brāļi, guilds, Zviedru vārti) are 10-20 m wide; at gameplay zoom they are recoloured but stay small. Bridges' pylons / arches are props, unchanged. Dailes / Kongresu nams pieces keep the measured (crumpled) roofs under the new colour.
