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


---

# Sights audit (generated by tools/detail/sights.mjs — do not edit this part)

Every important sight / building per map: found from the album, riga.json `landmarks`, OSM names / tags, cadastre type pub / rel and every building >= 30 m. Multi-piece buildings are one sight (ids listed, lead first). Tier A = city icon, B = notable, C = minor public building.

## centrs — 426 sights (A 61 / B 153 / C 212)

| tier | category | name | lead id | pieces | area m2 | h m | why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | theatre | Nacionālā bibliotēka [library] | 49629679 | 1 | 12466 | 38.5 | tierA |
| A | theatre | Dailes teātris [daile] | 49621082 | 49621082 49612595 | 12288 | 9.6 | tierA |
| A | market | Centrāltirgus [market] | 49614728 | 49614728 49614778 49615303 49615403 | 11415 | 20.5 | tierA |
| A | market | Origo [origo] | 49614964 | 49614964 49611992 | 11179 | 14.8 | tierA |
| A | station | Centrālā stacija [station] | 49614666 | 49614666 49615281 49614810 49614921 | 8909 | 14.8 | tierA |
| A | hotel | Radisson Blu Daugava [radisson-daugava] | 49629591 | 1 | 8190 | 32.3 | tierA |
| A | castle | Rīgas pils [castle] | 49615051 | 49615051 49614975 | 8075 | 29 | tierA |
| A | theatre | Nacionālā opera [opera] | 49616059 | 49616059 49615786 49615783 | 6555 | 34 | tierA |
| A | market | Galerija Centrs [galerija] | 49614491 | 49614491 49614512 | 5852 | 18 | tierA |
| A | market | Centrāltirgus (Gaļas paviljons) [market-meat] | 49615202 | 1 | 5491 | 18 | tierA |
| A | school | Latvijas Universitāte [university] | 49616039 | 49616039 49616004 | 5427 | 18 | tierA |
| A | theatre | Rīgas Kongresu nams [congress] | 49616534 | 1 | 5354 | 19.5 | tierA |
| A | museum | Latvijas Nacionālais mākslas muzejs [artmuseum] | 49615452 | 1 | 4699 | 6.4 | tierA |
| A | market | Stockmann [stockmann] | 49615917 | 1 | 4562 | 16 | tierA |
| A | tower | Z-Towers [ztowers] | 49637749 | 1 | 4064 | 11.6 | tierA |
| A | tower | Preses nams [presesnams] | 49639106 | 1 | 3566 | 72.4 | tierA |
| A | tower | Zinātņu akadēmija [academy] | 49628422 | 1 | 3446 | 11.6 | tierA |
| A | hotel | Radisson Blu Latvija [hotel-latvija] | 49619752 | 1 | 3440 | 86 | tierA |
| A | church | Rīgas Doms [dome] | 49614755 | 1 | 3216 | 35 | tierA |
| A | tower | Republikas laukums 2 | 49616136 | 1 | 3121 | 85.2 | tall |
| A | theatre | Nacionālais teātris [theatre] | 49614719 | 1 | 3108 | 8.4 | tierA |
| A | station | Rīgas pasažieru osta [ferry] | 49615997 | 1 | 3097 | 3.2 | tierA |
| A | gov | Latvijas Banka [bank] | 49615814 | 1 | 3033 | 11.6 | tierA |
| A | gov | Rīgas Rātsnams [townhall] | 49614687 | 1 | 2855 | 11.6 | tierA |
| A | school | Latvijas Mākslas akadēmija [artacademy] | 49615853 | 49615853 49615877 | 2676 | 11.6 | tierA |
| A | church | Svētā Pētera baznīca [peter] | 49614351 | 1 | 2654 | 40 | tierA |
| A | theatre | Rīgas cirks [circus] | 49615676 | 1 | 2384 | 8.4 | tierA |
| A | castle | Rīgas pilsētas tiesa | 49627581 | 1 | 2275 | 12.8 | tag:amenity=courthouse, osm-name, album:castle |
| A | school | Latvijas Mākslas akadēmija | 49616604 | 1 | 2132 | 14.8 | tag:building=university, osm-name, t:pub |
| A | theatre | Latviešu biedrības nams [lbn] | 49615638 | 1 | 1997 | 13.1 | tierA |
| A | theatre | Latvijas Universitātes Akadēmiskā bibliotēka | 49615146 | 1 | 1871 | 12.8 | tag:amenity=library, osm-name, t:pub |
| A | gov | Saeima [saeima] | 49614901 | 1 | 1841 | 9.6 | tierA |
| A | theatre | Splendid Palace [splendid] | 49619824 | 1 | 1607 | 11.6 | tierA |
| A | church | Kristus Piedzimšanas katedrāle [nativity] | 49615771 | 1 | 1588 | 40 | tierA |
| A | industrial | Spīķeri [spikeri] | 49614933 | 49614933 49612972 49615217 49615466 | 1374 | 18.5 | tierA |
| A | historic | Lielā Ģilde [guild-great] | 49616381 | 1 | 1353 | 18 | tierA |
| A | tower | Saules akmens [saulesakmens] | 49639844 | 1 | 1338 | 88.4 | tierA |
| A | gov | Latvijas Radio [radio] | 49616468 | 1 | 1316 | 11.6 | tierA |
| A | church | Svētā Jēkaba katedrāle [jekab] | 49614946 | 1 | 1218 | 35 | tierA |
| A | historic | Kaķu nams [cathouse] | 49616370 | 49616370 49616429 | 1154 | 12.8 | tierA |
| A | church | Svētā Jāņa baznīca [jani] | 49614438 | 1 | 1154 | 32 | tierA |
| A | museum | Okupācijas muzejs [occupation] | 49614381 | 1 | 1103 | 11.6 | tierA |
| A | historic | Melngalvju nams [blackheads] | 49614347 | 1 | 965 | 21.5 | tierA |
| A | school | LU bibliotēka | 49615553 | 1 | 910 | 11.6 | tag:building=university, osm-name, t:pub |
| A | historic | Mazā Ģilde [guild-small] | 49616364 | 1 | 684 | 11.6 | tierA |
| A | industrial | Spīķeri | 49615294 | 1 | 661 | 11.6 | album:spikeri |
| A | historic | Trīs brāļi [brothers] | 49614971 | 49614971 49614596 49615271 49614187 49612599 49612635 49612661 | 627 | 18 | tierA |
| A | industrial | Spīķeri | 49614852 | 1 | 625 | 11.6 | album:spikeri |
| A | industrial | Spīķeri | 49614681 | 1 | 577 | 11.6 | t:pub, album:spikeri |
| A | industrial | Spīķeri | 49614744 | 1 | 577 | 11.6 | album:spikeri |
| A | industrial | Spīķeri | 49614657 | 1 | 576 | 8.4 | album:spikeri |
| A | industrial | Spiķeru Koncertzāle | 49615082 | 1 | 558 | 11.6 | t:pub, osm-name, album:spikeri |
| A | industrial | Spīķeri | 49614792 | 1 | 555 | 11.6 | album:spikeri |
| A | church | Sv. Aleksandra Ņevska baznīca [nevsky] | 49619857 | 49619857 49619931 | 516 | 21.2 | tierA |
| A | castle | Zviedru vārti [swedish] | 49614979 | 49614979 49615193 | 398 | 11.4 | tierA |
| A | theatre | Rīgas Latviešu biedrības nams | 49615662 | 1 | 250 | 13.1 | tag:amenity=community_centre, osm-name, t:pub |
| A | castle | Pulvertornis [powder] | 49615275 | 1 | 173 | 37 | tierA |
| A | school | Mākslas akadēmija | 49616561 | 1 | 45 | 14.8 | album:art |
| A | industrial | Spīķeri | 49614972 | 1 | 17 | 3.7 | album:spikeri |
| A | industrial | Spīķeri | 49615011 | 1 | 16 | 4.9 | album:spikeri |
| A | industrial | Spīķeri | 49614668 | 1 | 9 | 4.3 | album:spikeri |
| B | theatre | Starptautiskais izstāžu centrs | 49639725 | 49639725 49638617 | 19937 | 5.2 | tag:amenity=exhibition_centre, osm-name, t:pub |
| B | market | Olimpia | 49639880 | 1 | 18165 | 8.4 | tag:shop=mall, osm-name |
| B | sports | Olimpiskā Skonto halle | 49618461 | 1 | 8566 | 3.2 | tag:leisure=stadium, osm-name, t:pub |
| B | market | Galerija Rīga | 49619976 | 1 | 4594 | 24.4 | tag:shop=mall, osm-name |
| B | gov | Ķīpsalas peldbaseins | 49639684 | 1 | 4149 | 8.4 | tag:building=civic, osm-name, t:pub |
| B | museum | Izstāžu zāle Arsenāls | 49614934 | 1 | 3535 | 8.4 | tag:tourism=museum, osm-name, t:pub |
| B | school | RTU Elektronikas un telekomunikāciju fakultāte | 49640031 | 1 | 3475 | 5.2 | tag:amenity=university, osm-name, t:pub |
| B | school | RTU Materiālzinātnes un lietišķās ķīmijas fakultāte | 49640061 | 1 | 3290 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | tower | Preses nams | 49613231 | 1 | 3101 | 37.2 | tall, landmark |
| B | market | Lidl | 49622400 | 1 | 2722 | 8.4 | osm-name |
| B | market | Latvenergo | 49617011 | 1 | 2612 | 24.4 | tag:office=government, osm-name |
| B | school | RTU Enerģētikas un elektrotehnikas fakultāte | 49639996 | 1 | 2560 | 21.2 | tag:amenity=university, osm-name, t:pub |
| B | school | RTU Arhitektūras un pilsētplānošanas fakultāte | 49639728 | 1 | 2486 | 18 | tag:amenity=university, osm-name, t:pub |
| B | theatre | Spelet Concert Hall | 49621964 | 1 | 2471 | 18 | tag:amenity=events_venue, osm-name, t:pub |
| B | market | Tallink Hotel Rīga | 49614740 | 1 | 2254 | 24.4 | tag:tourism=hotel, osm-name |
| B | school | Jāzepa Vītola Latvijas mūzikas akadēmija | 49616126 | 1 | 2251 | 8.4 | tag:building=university, osm-name, t:pub |
| B | museum | Latvijas dzelzceļa vēstures muzejs | 49629670 | 1 | 2238 | 5 | tag:tourism=museum, osm-name, t:pub |
| B | hotel | Islande Hotel | 49639852 | 1 | 2207 | 30.8 | tag:tourism=hotel, osm-name, tall |
| B | station | Rīgas Starptautiskā autoosta | 49614762 | 1 | 2201 | 8.4 | tag:amenity=bus_station, osm-name |
| B | station | JRT Black box | 49620168 | 1 | 2193 | 12.8 | tag:amenity=theatre, osm-name, tag:building=bridge |
| B | school | Rīgas Celtniecības Koledža | 49615009 | 1 | 2182 | 16.3 | tag:amenity=college, osm-name, t:pub |
| B | tower | Brīvības iela 49/53 | 49618861 | 1 | 2155 | 34 | tall |
| B | market | Pullman Riga Old Town | 49615316 | 1 | 2112 | 12.8 | tag:building=hotel, osm-name |
| B | theatre | Petroleja | 49629795 | 1 | 2056 | 8.4 | tag:amenity=events_venue, osm-name |
| B | station | RTU Faculty of Computer Science and Information Technology | 49639962 | 1 | 1943 | 8.4 | tag:amenity=university, osm-name, tag:building=bridge |
| B | market | Valdemāra centrs | 49618512 | 1 | 1925 | 24.4 | osm-name |
| B | market | Finanšu ministrija | 49616392 | 1 | 1893 | 18 | tag:office=government, osm-name |
| B | market | Piena paviljons | 49621798 | 1 | 1890 | 3.2 | osm-name |
| B | market | Mercure Riga Centre | 49622496 | 1 | 1871 | 22.7 | tag:tourism=hotel, osm-name |
| B | school | Grēcinieku iela 10 | 49614377 | 1 | 1861 | 14.8 | tag:building=school, t:pub |
| B | market | Gaļas paviljons | 49621849 | 1 | 1829 | 8.4 | osm-name |
| B | market | Barona centrs | 49623487 | 1 | 1821 | 11.6 | tag:shop=mall, osm-name |
| B | school | Mašīnzinību, transporta un aeronautikas fakultātes Laboratoriju māja | 49639897 | 1 | 1812 | 9.6 | tag:amenity=university, osm-name, t:pub |
| B | school | Latvijas Universitātes Humanitāro zinātņu fakultāte | 49622505 | 1 | 1800 | 9.6 | tag:amenity=university, osm-name, t:pub |
| B | hotel | Avalon | 49614551 | 49614551 49614558 49614556 | 1748 | 14.8 | tag:tourism=hotel, osm-name |
| B | market | VAS Pasažieru vilciens | 49628163 | 1 | 1608 | 16 | osm-name |
| B | market | Latvijas Republikas Ģenerālprokuratūra | 49615883 | 49615883 49615899 | 1577 | 14.8 | tag:office=government, osm-name |
| B | gov | VUGD RRP 1. daļa | 49615321 | 49615321 49614929 | 1550 | 11.6 | tag:amenity=fire_station, osm-name |
| B | school | Kronvalda bulvāris 1 | 49616490 | 1 | 1533 | 13.1 | tag:building=school, t:pub |
| B | school | Skrindu iela 1 | 49627580 | 1 | 1512 | 9.6 | tag:building=school, t:pub |
| B | school | Natālijas Draudziņas vidusskolas peldbaseins | 49620857 | 1 | 1509 | 14.8 | tag:building=school, tag:leisure=sports_centre, osm-name |
| B | school | Krišjāņa Valdemāra iela 65 | 49618307 | 1 | 1481 | 12.8 | tag:building=school, t:pub |
| B | station | Bruņinieku iela 24 | 49620086 | 1 | 1480 | 14.8 | tag:building=school, tag:building=bridge, t:pub |
| B | school | Zvejnieku iela 12 | 49639796 | 1 | 1476 | 6.4 | tag:building=school, t:pub |
| B | hospital | 8. korpuss | 49621174 | 1 | 1472 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | school | Rīgas Tehniskā universitāte | 49638698 | 1 | 1429 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | market | tet | 49622280 | 1 | 1399 | 14.8 | osm-name |
| B | church | Latvijas Baptistu Draudžu savienība | 49622206 | 1 | 1375 | 9.6 | tag:amenity=place_of_worship, osm-name, tag:building=church |
| B | school | Lāčplēša iela 98 | 49627602 | 1 | 1362 | 9.6 | tag:building=school |
| B | church | Vecā Ģertrūdes baznīca | 49619142 | 1 | 1353 | 27.6 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | market | Riverside Offices | 49627190 | 1 | 1336 | 27.6 | osm-name |
| B | school | RTU Inženierekonomikas un vadības fakultāte | 49637680 | 1 | 1328 | 21.2 | tag:amenity=university, osm-name, t:pub |
| B | hotel | AC Hotel by Marriott Riga | 49618756 | 1 | 1314 | 37.2 | tag:tourism=hotel, osm-name, tall |
| B | school | Kalpaka bulvāris 8 | 49615808 | 1 | 1297 | 11.6 | tag:building=school, t:pub |
| B | museum | Latvijas kara muzejs | 49615127 | 1 | 1290 | 16.3 | tag:tourism=museum, osm-name, t:pub |
| B | school | RTU Faculty of Computer Science and Information Technology | 49639998 | 1 | 1278 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | market | Abava | 49615015 | 1 | 1272 | 8.4 | tag:shop=mall, osm-name |
| B | school | Latvijas Universitātes Matemātikas un Informātikas institūts | 49616064 | 1 | 1265 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | hospital | Lāčplēša iela 38 | 49623467 | 1 | 1255 | 12.8 | tag:amenity=clinic, t:pub |
| B | school | Raņķa dambis 3 | 49629619 | 1 | 1254 | 8.4 | tag:building=kindergarten, t:pub |
| B | school | Bruņinieku iela 24B | 49620199 | 1 | 1231 | 14.8 | tag:building=school, t:pub |
| B | market | Benjamiņu nams | 49615636 | 1 | 1208 | 11.6 | tag:building=hotel, osm-name |
| B | theatre | Latvijas Mākslinieku savienība | 49614566 | 1 | 1201 | 18 | tag:amenity=arts_centre, osm-name, t:pub |
| B | school | Daugavgrīvas iela 2 | 49638521 | 1 | 1194 | 18 | tag:building=university, t:pub |
| B | school | RISEBA | 49638135 | 49638135 49637799 | 1173 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | gov | Francijas vēstniecība | 49615622 | 49615622 49615865 | 1146 | 11.6 | tag:office=diplomatic, osm-name |
| B | theatre | Mihaila Čehova Rīgas Krievu teātris | 49614510 | 1 | 1133 | 16 | tag:amenity=theatre, osm-name, t:pub |
| B | school | Krišjāņa Valdemāra iela 2 | 49615557 | 1 | 1132 | 13.1 | tag:building=school, t:pub |
| B | school | Sētas iela 1 | 49638105 | 1 | 1124 | 18 | tag:building=university, t:pub |
| B | gov | VUGD RRP 3. daļa | 49621910 | 1 | 1102 | 11.6 | tag:amenity=fire_station, osm-name |
| B | school | RTU sporta centrs | 49637824 | 1 | 1060 | 12 | tag:building=university, osm-name, t:pub |
| B | school | Kronvalda bulvāris 1A | 49616307 | 1 | 1060 | 18 | tag:building=school, t:pub |
| B | church | Jēzus baznīca | 49628050 | 1 | 1033 | 18 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | school | Visvalža iela 4 | 49622645 | 1 | 1002 | 11.6 | tag:building=school, t:pub |
| B | church | Pēdējo dienu svēto Jēzus Kristus baznīca | 49618920 | 1 | 985 | 18 | tag:amenity=place_of_worship, osm-name, t:pub |
| B | school | RTU studentu dienesta viesnīca | 49639899 | 1 | 977 | 37.2 | tag:building=dormitory, osm-name, tall |
| B | hospital | 7. korpuss | 49620921 | 1 | 977 | 3.2 | tag:building=hospital, osm-name, t:pub |
| B | church | Rīgas Sāpju Dievmātes baznīca | 49615077 | 1 | 951 | 15.5 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | church | Septītās dienas adventistu baznīca | 49619726 | 1 | 941 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | hotel | Slokas iela 1 k-2 | 49629643 | 1 | 916 | 34 | tag:building=hotel, tall |
| B | hospital | Bruņinieku iela 5 k-2 | 49621007 | 1 | 894 | 9.6 | tag:building=hospital, t:pub |
| B | school | RTU studentu dienesta viesnīca | 49639927 | 1 | 840 | 30.8 | tag:building=dormitory, osm-name, tall |
| B | school | Skolas iela 11 | 49618859 | 1 | 835 | 14.8 | tag:building=university |
| B | market | M4a | 49617114 | 1 | 833 | 24.4 | osm-name |
| B | historic | Dannenšterna nams | 49614545 | 1 | 829 | 17.6 | tag:historic=building, osm-name, t:pub |
| B | gov | Saeimas deputātu frakcijas un komisijas | 49614930 | 1 | 828 | 9.6 | tag:office=government, osm-name |
| B | school | Bruņinieku iela 10 | 49620131 | 1 | 827 | 14.8 | tag:building=school, t:pub |
| B | market | Wellton Hotel Riga & SPA | 49614633 | 1 | 818 | 25.9 | tag:tourism=hotel, osm-name |
| B | church | Pēdējo Dienu Svēto Jēzus Kristus baznīca | 49622396 | 1 | 805 | 9.9 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | church | Pestīšanas Armija | 49620030 | 49620030 49620133 | 800 | 21.2 | osm-name, t:rel |
| B | school | Lattelecom Technology, LTT | 49618602 | 1 | 799 | 11.6 | tag:building=school, osm-name, t:pub |
| B | market | Wellton Riverside SPA Hotel | 49614594 | 1 | 765 | 24.4 | tag:tourism=hotel, osm-name |
| B | school | RTU studentu viesnīca | 49637887 | 1 | 764 | 11.6 | tag:building=dormitory, osm-name |
| B | school | Ebreju draudze "Habad Ļubavič" | 49627789 | 1 | 751 | 11.6 | tag:building=school, osm-name, t:pub |
| B | school | Skolas iela 11 | 49618857 | 1 | 743 | 22.7 | tag:building=university |
| B | hospital | 10. korpuss | 49620917 | 1 | 738 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | school | Akas iela 10 | 49620083 | 1 | 708 | 14.8 | tag:building=school, t:pub |
| B | hotel | Hotel Neiburgs | 49616644 | 1 | 707 | 18 | tag:tourism=hotel, osm-name |
| B | hospital | 13. korpuss | 49621277 | 1 | 698 | 18.3 | tag:building=hospital, osm-name, t:pub |
| B | hospital | 6. korpuss | 49621080 | 1 | 689 | 13.1 | tag:building=hospital, osm-name, t:pub |
| B | hospital | Poliklīnika "Bruņinieku" | 49620915 | 1 | 665 | 9.6 | tag:building=hospital, osm-name, t:pub |
| B | school | LKA Zirgu pasts | 49618938 | 1 | 654 | 8.4 | tag:building=university, osm-name, t:pub |
| B | school | Aspazijas bulvāris 34 | 49616092 | 49616092 49615750 | 646 | 14.8 | tag:building=school, t:pub |
| B | gov | Latvijas Republikas Satversmes tiesa | 49613737 | 1 | 645 | 9.6 | tag:amenity=courthouse, osm-name |
| B | school | Rīgas 40. vidusskola | 49619906 | 1 | 641 | 18 | tag:amenity=school, osm-name, t:pub |
| B | gov | Valsts sociālās apdrošināšanas aģentūra | 49622291 | 1 | 637 | 21.2 | tag:office=government, osm-name |
| B | hospital | 25. korpuss | 49620956 | 1 | 633 | 3.2 | tag:building=hospital, osm-name, t:pub |
| B | church | Vissvētās Dievmātes pasludināšanas baznīca | 49627799 | 1 | 629 | 11.6 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | church | Peitav-šul Sinagoga | 49614645 | 1 | 629 | 11.6 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | hospital | 3. korpuss | 49621178 | 1 | 625 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | hospital | 12. korpuss | 49621418 | 1 | 622 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | school | Akas iela 1 | 49620065 | 1 | 620 | 8.4 | tag:building=school, t:pub |
| B | hospital | 4. korpuss | 49621139 | 1 | 618 | 11.6 | tag:building=hospital, osm-name, t:pub |
| B | church | Rīgas baptistu Vīlandes draudze | 49614999 | 1 | 606 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | hospital | 5. korpuss | 49620994 | 1 | 606 | 13.1 | tag:building=hospital, osm-name, t:pub |
| B | church | Rīgas Svētās Marijas Magdalēnas baznīca | 49615201 | 1 | 594 | 11.6 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | gov | Saeimas komisijas | 49615149 | 1 | 593 | 12.8 | tag:office=government, osm-name |
| B | hospital | 11. korpuss | 49621034 | 1 | 588 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | school | Raiņa bulvāris 23 | 49615848 | 1 | 588 | 16.3 | tag:building=university, t:pub |
| B | station | Stacijas laukums 2 | 49615446 | 49615446 49615333 | 569 | 5.2 | tag:building=transportation |
| B | school | Rīgas metālapstrādes profesionālā vidusskola | 49622274 | 49622274 49622250 | 565 | 14.8 | tag:amenity=college, osm-name, t:pub |
| B | hospital | 22. korpuss | 49621378 | 1 | 558 | 3.2 | tag:building=hospital, osm-name, t:pub |
| B | gov | Saeimas deputātu komisijas | 49615176 | 1 | 554 | 12.8 | tag:office=government, osm-name |
| B | gov | Polijas Republikas vēstniecība | 49617142 | 1 | 547 | 18 | tag:office=diplomatic, osm-name |
| B | school | Lāčplēša iela 55 | 49622331 | 1 | 545 | 8.2 | tag:building=school, t:pub |
| B | school | Rīgas Reinholda Šmēlinga vidusskola | 49615520 | 1 | 531 | 11.6 | tag:building=school, osm-name, t:pub |
| B | school | Futurimo Rīga | 49638434 | 1 | 529 | 5.2 | tag:amenity=education_centre, osm-name, t:pub |
| B | church | Svētā Pētera un Pāvila baznīca | 49614698 | 1 | 525 | 21.2 | tag:amenity=place_of_worship, osm-name, tag:man_made=tower |
| B | church | Svētās Trijādības Pārdaugavas pareizticīgo baznīca | 49636436 | 1 | 517 | 3.2 | tag:amenity=place_of_worship, osm-name, tag:man_made=tower |
| B | gov | Lietuvas vēstniecība | 49611845 | 1 | 496 | 20.4 | tag:office=diplomatic, osm-name |
| B | school | Paula Stradiņa Medicīnas vēstures muzeja izglītības centrs | 49616585 | 1 | 491 | 3.2 | tag:building=yes, osm-name, t:pub |
| B | market | The Icon | 49615688 | 1 | 488 | 24.4 | osm-name |
| B | church | Atklāsme | 49628191 | 1 | 483 | 9.6 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | church | Latvijas Apvienotā metodistu baznīca | 49620098 | 1 | 458 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | church | Anglikāņu baznīca | 49614911 | 1 | 454 | 3.2 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | church | Reformātu baznīca | 49614561 | 1 | 453 | 6.4 | tag:amenity=place_of_worship, osm-name, tag:heritage |
| B | hotel | Radisson Old Town Riga | 49615478 | 1 | 452 | 18 | tag:tourism=hotel, osm-name |
| B | historic | Popova muižiņa | 49622424 | 1 | 438 | 6.4 | tag:historic=manor, osm-name |
| B | gov | Saeimas komisijas un deputāti | 49615251 | 1 | 411 | 9.6 | tag:office=government, osm-name |
| B | gov | Igaunijas vēstniecība | 49615322 | 1 | 395 | 16 | tag:office=diplomatic, osm-name |
| B | gov | Latvijas Republikas Kultūras ministrija | 49616582 | 1 | 389 | 11.6 | tag:office=government, osm-name |
| B | church | Ganden | 49621133 | 1 | 387 | 21.2 | tag:amenity=place_of_worship, osm-name |
| B | museum | Latvijas Nacionālais rakstniecības un mūzikas muzejs | 49614546 | 1 | 375 | 11.6 | tag:tourism=museum, osm-name, t:pub |
| B | church | Hare Krišnas centrs | 49622020 | 1 | 362 | 11.6 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | school | Rīgas 1. pamatskola-attīstības centrs | 49620076 | 1 | 354 | 8.4 | tag:amenity=school, osm-name, t:pub |
| B | hotel | Mosaic | 49618363 | 1 | 286 | 8.4 | tag:tourism=hotel, osm-name |
| B | gov | Čehijas Republikas vēstniecība | 49618285 | 1 | 266 | 11.6 | tag:office=diplomatic, osm-name |
| B | historic | Gustava Šķiltera muzejs | 49638599 | 1 | 252 | 5.2 | tag:historic=building, osm-name |
| B | museum | Žaņa Lipkes memoriāls | 49640026 | 1 | 235 | 8.4 | tag:tourism=museum, osm-name, t:pub |
| B | theatre | Saksofons | 49623376 | 1 | 191 | 8.4 | tag:amenity=arts_centre, osm-name |
| B | museum | Raiņa un Aspazijas muzejs | 49618952 | 1 | 184 | 8.4 | tag:tourism=museum, osm-name, t:pub |
| B | museum | Mencendorfa nams | 49614372 | 1 | 153 | 11.6 | tag:tourism=museum, osm-name, t:pub |
| B | castle | Rāmera tornis | 49611828 | 1 | 93 | 18.4 | tag:man_made=tower, osm-name, landmark |
| C | public | Emiļa Melngaiļa iela 1A | 49618793 | 1 | 5103 | 3.2 | t:pub |
| C | public | Vernisāža | 49615659 | 1 | 4386 | 8.4 | osm-name, t:pub |
| C | public | Ķīpsalas iela 6A | 49639790 | 1 | 4017 | 18 | t:pub |
| C | public | Uzvaras bulvāris 10 | 49629776 | 1 | 3738 | 8.4 | t:pub |
| C | public | 20. korpuss | 49621422 | 1 | 3429 | 3.2 | osm-name, t:pub |
| C | public | Latvijas Universitātes Ekonomikas un sociālo zinātņu fakultāte | 49615764 | 1 | 3295 | 18 | t:pub, osm-name |
| C | public | Kaļķu iela 1 | 49616622 | 1 | 3053 | 14.8 | t:pub |
| C | public | Raiņa bulvāris 8 | 49615973 | 1 | 2800 | 6.4 | t:pub |
| C | sports | Krišjāņa Valdemāra iela 65 | 49618720 | 1 | 2727 | 3.2 | tag:leisure=sports_centre, t:pub |
| C | public | Ķīpsalas iela 6B | 49639842 | 1 | 2375 | 18 | t:pub |
| C | public | Eksporta iela 1A | 49616607 | 1 | 2338 | 6.4 | t:pub |
| C | public | Krišjāņa Valdemāra iela 1 | 49614690 | 1 | 2332 | 9.6 | t:pub |
| C | hotel | Slokas iela 1 k-1 | 49629684 | 1 | 2067 | 8.4 | tag:building=hotel |
| C | public | Rātslaukums 9 | 49614380 | 1 | 1925 | 3.2 | t:pub |
| C | hotel | Grēcinieku iela 25 | 49614353 | 49614353 49612434 | 1868 | 21.2 | tag:building=hotel |
| C | public | Skrindu iela 1 | 49627413 | 1 | 1810 | 3.2 | t:pub |
| C | public | Palasta iela 4 | 49616566 | 1 | 1790 | 11.6 | t:pub |
| C | public | Krišjāņa Valdemāra iela 1C | 49614713 | 1 | 1686 | 11.6 | t:pub |
| C | public | Visvalža iela 9 | 49622590 | 1 | 1619 | 8.4 | t:pub |
| C | public | Krišjāņa Barona iela 31 | 49619935 | 1 | 1606 | 8.4 | t:pub |
| C | public | Marijas iela 21 | 49622255 | 1 | 1571 | 6.4 | t:pub |
| C | public | Kronvalda bulvāris 9 | 49616499 | 1 | 1565 | 6.4 | t:pub |
| C | public | Pulkveža Brieža iela 25 | 49615169 | 1 | 1456 | 14.8 | t:pub |
| C | public | Riharda Vāgnera iela 4 | 49614409 | 1 | 1452 | 9.6 | t:pub |
| C | public | Uzvaras bulvāris 12 | 49629595 | 1 | 1421 | 8.4 | t:pub |
| C | public | Lenču iela 1 | 49617035 | 1 | 1318 | 14.8 | t:pub |
| C | hotel | Kaļķu iela 28 | 49615861 | 1 | 1317 | 21.2 | tag:building=hotel |
| C | public | Bruņinieku iela 5 k-23 | 49621384 | 1 | 1297 | 6.4 | t:pub |
| C | public | Brīvības bulvāris 32 | 49615705 | 1 | 1204 | 18 | t:pub |
| C | hotel | Pulkveža Brieža iela 11A | 49615020 | 49615020 49615374 | 1168 | 19.2 | tag:building=hotel |
| C | public | BluOr Banka | 49615219 | 1 | 1164 | 16 | tag:amenity=bank, osm-name |
| C | public | Skārņu iela 10 | 49614492 | 1 | 1142 | 16.3 | t:pub |
| C | public | Krišjāņa Barona iela 16/18 | 49623491 | 1 | 1124 | 6.4 | t:pub |
| C | public | Kaļķu iela 24 | 49614484 | 1 | 1105 | 12.8 | t:pub |
| C | public | Sporta iela 2 | 49618797 | 1 | 1102 | 5.2 | t:pub |
| C | hotel | Raiņa bulvāris 33 | 49615702 | 1 | 1099 | 19.5 | tag:building=hotel |
| C | public | Andrejostas iela 5 k-3 | 49615189 | 1 | 1092 | 3.2 | t:pub |
| C | public | Ernesta Birznieka-Upīša iela 21E | 49622362 | 1 | 1085 | 14.8 | t:pub |
| C | hotel | Elizabetes iela 83/85 | 49622359 | 1 | 1073 | 14.8 | tag:building=hotel |
| C | public | Skolas iela 2 | 49618941 | 1 | 1057 | 8.4 | t:pub |
| C | hotel | Kalēju iela 33 | 49614563 | 1 | 1035 | 17.8 | tag:building=hotel |
| C | public | Palasta iela 3 | 49616536 | 1 | 1023 | 12.8 | t:pub |
| C | public | Skolas iela 6 | 49618960 | 1 | 1009 | 14.8 | t:pub |
| C | tower | Lastādijas iela 5 | 49614956 | 1 | 999 | 3.2 | tag:man_made=tower |
| C | public | Marijas iela 7 | 49615715 | 1 | 961 | 18 | t:pub |
| C | public | Citadeles iela 3 | 49616058 | 1 | 955 | 8.4 | t:pub |
| C | public | Lāčplēša iela 106 k-1 | 49627478 | 1 | 939 | 18 | t:pub |
| C | public | Visvalža iela 9 | 49622384 | 1 | 930 | 14.8 | t:pub |
| C | public | Pils laukums 2 | 49614907 | 1 | 928 | 11.6 | t:pub |
| C | public | Skolas iela 32 | 49619128 | 1 | 907 | 18 | t:pub |
| C | public | Ausekļa iela 9 | 49615360 | 1 | 899 | 18 | t:pub |
| C | public | Alberta iela 13 | 49618813 | 1 | 899 | 21.2 | t:pub |
| C | public | Kronvalda bulvāris 6 | 49616531 | 1 | 890 | 18 | t:pub |
| C | public | Krišjāņa Barona iela 4 | 49615980 | 1 | 889 | 16 | t:pub |
| C | public | Baznīcas iela 19/23 | 49619001 | 1 | 854 | 17.8 | t:pub |
| C | public | Lāčplēša iela 106 | 49627540 | 1 | 851 | 18 | t:pub |
| C | public | Elijas iela 17A | 49629078 | 1 | 844 | 6.4 | t:pub |
| C | public | Lāčplēša iela 106 k-2 | 49627535 | 1 | 841 | 18 | t:pub |
| C | public | Tērbatas iela 30 | 49619967 | 1 | 841 | 18 | t:pub |
| C | public | Kronvalda bulvāris 8 | 49615811 | 1 | 840 | 18 | t:pub |
| C | public | Marijas iela 2 | 49614656 | 1 | 820 | 18 | t:pub |
| C | public | Abrenes iela 15 | 49627571 | 1 | 801 | 16.9 | t:pub |
| C | public | Alberta iela 10 | 49618295 | 1 | 800 | 14.8 | t:pub |
| C | public | Raņķa dambis 14 | 49638473 | 1 | 787 | 18 | t:pub |
| C | public | Bruņinieku iela 8 | 49619792 | 1 | 783 | 21.2 | t:pub |
| C | public | Elizabetes iela 61 | 49620006 | 1 | 774 | 8.4 | t:pub |
| C | public | Skolas iela 5 | 49619780 | 1 | 764 | 18 | t:pub |
| C | public | Blaumaņa iela 32 | 49622239 | 1 | 738 | 21.2 | t:pub |
| C | public | Strēlnieku iela 4A | 49618371 | 1 | 737 | 5.2 | t:pub |
| C | public | Aspazijas bulvāris 32 | 49616143 | 1 | 734 | 12.8 | t:pub |
| C | public | Zirgu iela 8 | 49616435 | 1 | 731 | 9.6 | t:pub |
| C | public | Grēcinieku iela 34 | 49614387 | 1 | 718 | 18 | t:pub |
| C | gov | Ukrainas neatkarības iela 2 | 49614201 | 1 | 713 | 12.8 | tag:building=government |
| C | gov | Ukrainas neatkarības iela 1 | 49616363 | 1 | 705 | 12.8 | tag:building=government, t:pub |
| C | public | Baznīcas iela 4A | 49619148 | 1 | 698 | 18 | t:pub |
| C | public | Noliktavas iela 2 | 49616567 | 1 | 691 | 11.6 | t:pub |
| C | public | Antonijas iela 9 | 49616208 | 1 | 687 | 16.3 | t:pub |
| C | public | 13. janvāra iela 3 | 49616104 | 1 | 679 | 21.2 | t:pub |
| C | public | Noliktavas iela 2 | 49616200 | 1 | 675 | 8.4 | t:pub |
| C | public | Kungu iela 8 | 49614527 | 1 | 671 | 8.4 | t:pub |
| C | public | Vingrotāju iela 1 | 49616484 | 1 | 669 | 18 | t:pub |
| C | public | Abrenes iela 15 | 49627422 | 1 | 668 | 18 | t:pub |
| C | public | Šķūņu iela 17 | 49613495 | 1 | 656 | 9.6 | t:pub |
| C | public | Baznīcas iela 18 | 49618958 | 1 | 644 | 9.6 | t:pub |
| C | public | Lāčplēša iela 43 | 49623453 | 1 | 639 | 21.2 | t:pub |
| C | public | Gaiziņa iela 3 | 49614663 | 1 | 629 | 6.4 | t:pub |
| C | public | Stabu iela 10 k-4 | 49619735 | 1 | 627 | 22.4 | t:pub |
| C | public | Ģertrūdes iela 48A | 49623651 | 1 | 611 | 16.3 | t:pub |
| C | public | Krišjāņa Valdemāra iela 26 | 49619746 | 1 | 598 | 16 | t:pub |
| C | public | Dzirnavu iela 147 k-3 | 49627469 | 1 | 596 | 6.4 | t:pub |
| C | historic | Mārstaļu iela 19 | 49614607 | 1 | 594 | 11.6 | tag:historic=building |
| C | public | Skrindu iela 1 | 49627429 | 1 | 588 | 3.2 | t:pub |
| C | hotel | Minsterejas iela 1 | 49614638 | 1 | 577 | 19.2 | tag:building=hotel |
| C | gov | Maiznīcas iela 5 | 49621150 | 1 | 576 | 6.4 | tag:building=government |
| C | public | Elizabetes iela 65 | 49619877 | 1 | 571 | 21.2 | t:pub |
| C | public | Brīvības iela 96 | 49621749 | 1 | 560 | 8.4 | t:pub |
| C | public | Krišjāņa Barona iela 20 | 49623653 | 1 | 527 | 18 | t:pub |
| C | public | Anglikāņu iela 5 | 49615165 | 1 | 526 | 9.6 | t:pub |
| C | public | Uzvaras bulvāris 9 | 49629597 | 1 | 518 | 11.6 | t:pub |
| C | public | Krišjāņa Barona iela 5 | 49619889 | 1 | 516 | 18 | t:pub |
| C | public | Paula Valdena iela 3 k-1 | 49639926 | 1 | 513 | 9.6 | t:pub |
| C | public | Dzirnavu iela 117 | 49622273 | 1 | 507 | 6.4 | t:pub |
| C | historic | Kalēju iela 49 | 49614582 | 1 | 482 | 16.3 | tag:historic=yes, t:pub |
| C | public | Miesnieku iela 11 | 49615186 | 1 | 480 | 14.8 | t:pub |
| C | hotel | Jauniela 24 | 49616638 | 1 | 477 | 14.8 | tag:building=hotel |
| C | public | Dzirnavu iela 23 | 49618699 | 1 | 471 | 9.9 | t:pub |
| C | historic | Audēju iela 7 | 49614540 | 1 | 469 | 11.6 | tag:historic=yes, tag:heritage |
| C | school | Āzenes iela 12 k-4 | 49639103 | 1 | 458 | 8.4 | tag:building=university |
| C | public | Skolas iela 3A | 49619695 | 1 | 455 | 6.4 | t:pub |
| C | public | Ernesta Birznieka-Upīša iela 12 | 49622391 | 1 | 450 | 12.8 | t:pub |
| C | public | Kronvalda bulvāris 3A | 49616570 | 1 | 448 | 5.2 | t:pub |
| C | public | Lāčplēša iela 125 | 49627542 | 1 | 446 | 9.6 | t:pub |
| C | hotel | Ernesta Birznieka-Upīša iela 20 | 49622617 | 1 | 442 | 11.6 | tag:building=hotel |
| C | public | Lāčplēša iela 60 | 49622281 | 1 | 429 | 9.6 | t:pub |
| C | public | Jauniela 26 | 49616516 | 1 | 425 | 18 | t:pub |
| C | public | Ģertrūdes iela 18 | 49620059 | 1 | 419 | 5.2 | t:pub |
| C | historic | Vecpilsētas iela 3 | 49614579 | 1 | 418 | 19.2 | tag:historic=yes |
| C | public | Herdera laukums 4 | 49613383 | 1 | 414 | 8.4 | t:pub |
| C | gov | Jēzusbaznīcas iela 6 | 49627865 | 1 | 412 | 19.2 | tag:amenity=courthouse |
| C | school | Visvalža iela 2 | 49622429 | 1 | 411 | 8.4 | tag:building=school, t:pub |
| C | public | Lāčplēša iela 41 | 49623563 | 1 | 411 | 16 | t:pub |
| C | public | Elizabetes iela 83 | 49623692 | 1 | 410 | 8.4 | t:pub |
| C | public | Ģertrūdes iela 32 | 49620778 | 1 | 404 | 18 | t:pub |
| C | public | Avotu iela 23A | 49623603 | 1 | 395 | 8.4 | t:pub |
| C | public | Ģertrūdes iela 28 | 49620093 | 1 | 392 | 9.6 | t:pub |
| C | public | Lastādijas iela 40 | 49628400 | 1 | 380 | 18 | t:pub |
| C | theatre | Kalpaka bulvāris 13 | 49615805 | 1 | 375 | 6.4 | tag:amenity=arts_centre, t:pub |
| C | church | Klostera iela 4 | 49615014 | 1 | 375 | 11.6 | t:rel |
| C | tower | Pils iela 5 | 49615139 | 1 | 373 | 8.4 | tag:man_made=tower |
| C | public | Lāčplēša iela 27 | 49620123 | 1 | 368 | 12.8 | t:pub |
| C | public | Riharda Vāgnera iela 13 | 49614407 | 1 | 367 | 8.4 | t:pub |
| C | public | Lastādijas iela 58 | 49628456 | 1 | 367 | 6.4 | t:pub |
| C | hotel | Aspazijas bulvāris 36 | 49615680 | 1 | 362 | 12.8 | tag:building=hotel |
| C | historic | Kronvalda bulvāris 9 | 49616528 | 1 | 360 | 5.2 | tag:historic=building, t:pub |
| C | public | Ogļu iela 12A | 49639857 | 1 | 360 | 8.4 | t:pub |
| C | gov | Maiznīcas iela 5 | 49621285 | 1 | 358 | 18 | tag:building=civic |
| C | public | Strūgu iela 4 | 49628696 | 1 | 352 | 9.6 | t:pub |
| C | public | Tērbatas iela 36 | 49620102 | 1 | 348 | 8.4 | t:pub |
| C | public | Kārļa Mīlenbaha iela 3 | 49627614 | 1 | 345 | 18 | t:pub |
| C | hotel | Mārstaļu iela 32 | 49614560 | 1 | 338 | 16 | tag:building=hotel |
| C | public | Skolas iela 22 | 49619081 | 1 | 337 | 18 | t:pub |
| C | public | Amatu iela 3 | 49616376 | 1 | 334 | 14.8 | t:pub |
| C | public | Emīlijas Benjamiņas iela 11 | 49627968 | 1 | 333 | 6.4 | t:pub |
| C | public | Krišjāņa Valdemāra iela 41 | 49618338 | 1 | 329 | 3.2 | t:pub |
| C | hotel | Doma laukums 1 | 49616504 | 1 | 326 | 12.8 | tag:building=hotel |
| C | church | Enkura iela 9 | 49639713 | 1 | 325 | 9.6 | t:rel |
| C | historic | Kronvalda bulvāris 9 | 49616496 | 1 | 323 | 6.4 | tag:historic=building, t:pub |
| C | public | Dzirnavu iela 29 | 49618380 | 1 | 317 | 12.8 | t:pub |
| C | historic | Daugavgrīvas iela 11 | 49637752 | 1 | 316 | 8.4 | tag:historic=building |
| C | school | Strēlnieku iela 4 k-2 | 49618783 | 1 | 315 | 18 | tag:building=university, t:pub |
| C | public | Blaumaņa iela 19 | 49623575 | 1 | 314 | 8.4 | t:pub |
| C | public | Matīsa iela 16 | 49621949 | 1 | 313 | 18 | t:pub |
| C | public | Kronvalda bulvāris 5 | 49616023 | 1 | 310 | 6.4 | t:pub |
| C | public | Kaņepes kultūras centrs | 49619778 | 1 | 309 | 11.6 | t:pub, osm-name |
| C | church | Mazā Pils iela 4 | 49615243 | 1 | 305 | 6.4 | t:rel |
| C | public | 24. korpuss | 49621406 | 1 | 302 | 17.6 | osm-name, t:pub |
| C | public | Tērbatas iela 2D | 49616213 | 1 | 296 | 8.4 | t:pub |
| C | public | Vaļņu iela 23 | 49614481 | 1 | 281 | 11.6 | t:pub |
| C | public | Kārļa Mīlenbaha iela 18 | 49627796 | 1 | 279 | 8.4 | t:pub |
| C | public | Bruņinieku iela 16 k-1 | 49620807 | 1 | 276 | 5.2 | t:pub |
| C | public | Bārddziņu iela 2 | 49628915 | 1 | 273 | 3.2 | t:pub |
| C | public | Krāmu iela 3 | 49616661 | 1 | 272 | 16.3 | t:pub |
| C | industrial | Matīsa iela 8 | 49621914 | 1 | 269 | 3.2 | tag:man_made=chimney |
| C | public | Bruņinieku iela 35A | 49621986 | 1 | 255 | 3.2 | t:pub |
| C | public | Kalēju iela 4 | 49614412 | 1 | 253 | 8.4 | t:pub |
| C | public | Šķūņu iela 4 | 49614679 | 1 | 248 | 12.8 | t:pub |
| C | historic | Vecpilsētas iela 8A | 49614598 | 1 | 246 | 16.1 | tag:historic=yes |
| C | hotel | Elizabetes nams | 49618811 | 1 | 241 | 8.4 | tag:tourism=hotel, osm-name |
| C | hotel | Elizabete | 49617130 | 1 | 238 | 16 | tag:tourism=hotel, osm-name |
| C | public | Marijas iela 13 | 49623530 | 1 | 235 | 9.6 | t:pub |
| C | hotel | Skārņu iela 25 | 49614392 | 1 | 231 | 14.8 | tag:building=hotel |
| C | historic | Šķūņu iela 9 | 49616341 | 1 | 229 | 11.6 | tag:historic=building |
| C | church | Alksnāja iela 3 | 49614623 | 1 | 228 | 9.6 | t:rel |
| C | historic | Vecpilsētas iela 7 | 49614557 | 1 | 225 | 9.6 | tag:historic=building |
| C | public | Zvejnieku iela 1 k-14 | 49639714 | 1 | 224 | 6.4 | t:pub |
| C | hotel | Forums | 49614562 | 1 | 222 | 18 | tag:tourism=hotel, osm-name |
| C | public | Ģertrūdes iela 27 | 49620788 | 1 | 220 | 21.2 | t:pub |
| C | public | Mārstaļu iela 8 | 49614619 | 1 | 215 | 11.6 | t:pub |
| C | historic | Vecpilsētas iela 5 | 49614517 | 1 | 214 | 16 | tag:historic=building |
| C | public | Avotu iela 19 | 49623654 | 1 | 214 | 8.4 | t:pub |
| C | public | Elizabetes iela 31 | 49618781 | 1 | 212 | 11.6 | t:pub |
| C | public | Ola rezidence | 49693937 | 1 | 212 | 8.4 | osm-name |
| C | public | Balasta dambis 56 | 49639952 | 1 | 208 | 5.2 | t:pub |
| C | public | Vecpilsētas iela 13/15 | 49614532 | 1 | 200 | 9.6 | t:pub |
| C | public | Ukrainas neatkarības iela 4A | 49616150 | 1 | 199 | 9.6 | t:pub |
| C | public | Alksnāja iela 9 | 49614504 | 1 | 195 | 9.6 | t:pub |
| C | hotel | Riverside Hotel | 49627740 | 1 | 193 | 14.8 | tag:tourism=hotel, osm-name |
| C | historic | Aldaru iela 7 | 49614157 | 1 | 189 | 14.8 | tag:historic=yes |
| C | church | Klostera iela 4 | 49616572 | 1 | 189 | 8.4 | t:rel |
| C | hotel | Mārstaļu iela 5 | 49614635 | 1 | 184 | 16 | tag:building=hotel |
| C | hotel | Rixwell Terrace Design Hotel | 49617040 | 1 | 183 | 18 | tag:tourism=hotel, osm-name |
| C | public | Simtgades aleja 3 | 49616555 | 1 | 183 | 5.2 | t:pub |
| C | historic | Daugavgrīvas iela 7 | 49637927 | 1 | 182 | 8.4 | tag:historic=building |
| C | public | Ola rezidence | 49639734 | 1 | 182 | 8.4 | osm-name, t:pub |
| C | hotel | Man-Tess | 49614420 | 1 | 177 | 14.8 | tag:tourism=hotel, osm-name |
| C | public | Bruņinieku iela 21 | 49621913 | 1 | 176 | 9.6 | t:pub |
| C | gov | Nacionālais Kino centrs | 49614601 | 1 | 174 | 9.6 | tag:office=government, osm-name |
| C | hotel | Mārstaļu iela 3 | 49614591 | 1 | 174 | 16 | tag:building=hotel |
| C | public | Lāčplēša iela 55A | 49622170 | 1 | 174 | 6.4 | t:pub |
| C | public | Stabu iela 22 | 49620738 | 1 | 169 | 8.4 | t:pub |
| C | school | Stabu iela 22 | 49620162 | 1 | 163 | 8.4 | tag:building=school, t:pub |
| C | public | Dzirnavu iela 16 | 49618516 | 1 | 159 | 5.2 | t:pub |
| C | public | Jauniela 29A | 49616524 | 1 | 154 | 8.4 | t:pub |
| C | public | Muitas iela 3 | 49616460 | 1 | 151 | 5.2 | t:pub |
| C | historic | Elijas iela 1 | 49627790 | 1 | 146 | 6.4 | tag:historic=house |
| C | historic | Daugavgrīvas iela 9B | 49637990 | 1 | 112 | 6.4 | tag:historic=building |
| C | church | Jāņa sēta 7 | 49614454 | 1 | 106 | 8.4 | t:rel |
| C | church | Bruņinieku iela 43 | 49623839 | 1 | 106 | 8.4 | t:rel |
| C | historic | Kaļķu iela 9 | 49616304 | 1 | 99 | 9.6 | tag:historic=yes |
| C | historic | Daugavgrīvas iela 11A | 49638194 | 1 | 63 | 3.2 | tag:historic=building |
| C | historic | Aldaru iela 9 | 49615042 | 1 | 54 | 14.8 | tag:historic=yes |
| C | church | Meža iela 2B | 49636360 | 1 | 46 | 8.4 | tag:building=chapel |

## agenskalns — 373 sights (A 2 / B 96 / C 275)

| tier | category | name | lead id | pieces | area m2 | h m | why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | market | Āgenskalna tirgus [ag-market] | 49634808 | 1 | 988 | 12.8 | tierA |
| A | wooden | Kalnciema kvartāls (koka nami) [ag-wooden] | 49636186 | 1 | 369 | 8.4 | tierA |
| B | public | Da Vinci | 49639148 | 1 | 8765 | 5.2 | landmark |
| B | hospital | A korpuss | 49636166 | 1 | 7641 | 12.8 | tag:building=hospital, osm-name, t:pub |
| B | industrial | Van Genechten Packaging | 49632216 | 1 | 6524 | 14.8 | osm-name, landmark |
| B | industrial | LIDL Arena | 49653998 | 1 | 5782 | 3.2 | osm-name, landmark |
| B | public | Zunda Towers | 49637749 | 1 | 4064 | 11.6 | landmark |
| B | hospital | B3 korpuss | 49634685 | 1 | 3898 | 16 | tag:building=hospital, osm-name, t:pub |
| B | hospital | B1 korpuss | 49635765 | 1 | 2943 | 9.6 | tag:building=hospital, osm-name, t:pub |
| B | market | Lidl | 49639014 | 1 | 2821 | 8.4 | osm-name, landmark |
| B | hospital | Pilsoņu iela 13 k-21 | 49635720 | 1 | 2766 | 6.4 | tag:building=hospital, t:pub |
| B | hospital | B1 korpuss | 49635486 | 1 | 2374 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | hospital | Pilsoņu iela 13 k-25 | 49634824 | 1 | 2285 | 9.9 | tag:building=hospital, t:pub |
| B | market | Land Rover | 49651719 | 1 | 2239 | 3.2 | osm-name, landmark |
| B | hospital | PSKUS Moduļu korpuss | 49635304 | 49635304 49634869 49633035 | 2163 | 3.2 | tag:building=hospital, osm-name, t:pub |
| B | school | Zvārdes iela 1 | 49632084 | 1 | 2147 | 9.6 | tag:building=school, t:pub |
| B | school | Sporta skola "Arkādija" | 49635670 | 1 | 1976 | 11.6 | tag:amenity=school, osm-name, t:pub |
| B | school | Meža iela 15 | 49637856 | 1 | 1945 | 21.2 | tag:building=dormitory, tag:building=school, t:pub |
| B | gov | Latvijas Valsts vēstures arhīvs | 49637896 | 1 | 1756 | 21.2 | tag:amenity=archive, osm-name, t:pub |
| B | school | Kalnciema iela 10 k-3 | 49638779 | 1 | 1663 | 8.4 | tag:building=school, t:pub |
| B | school | Jelgavas iela 86A | 51181765523 | 1 | 1529 | 8.9 | tag:building=kindergarten |
| B | church | Svētā Alberta baznīca | 49635756 | 1 | 1521 | 3.2 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | school | Kalnciema iela 10 k-1 | 49638191 | 1 | 1519 | 8.4 | tag:building=school, t:pub |
| B | school | Zeļļu iela 4 | 49634649 | 1 | 1496 | 14.8 | tag:building=school, t:pub |
| B | market | Park Inn by Radisson | 49637726 | 1 | 1479 | 16 | tag:tourism=hotel, osm-name |
| B | hospital | Pilsoņu iela 13 k-38 | 49633107 | 1 | 1475 | 8.4 | tag:building=hospital, t:pub |
| B | church | Āgenskalna baptistu baznīca | 49635717 | 49635717 49635719 | 1454 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | market | Vaivaru tehnisko palīglīdzekļu centrs | 49651732 | 1 | 1440 | 11.6 | osm-name |
| B | school | Rīgas Tehniskā universitāte | 49638698 | 1 | 1429 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | market | RSU dienesta viesnīca | 49633158 | 1 | 1358 | 18 | tag:building=dormitory, osm-name |
| B | school | Lavīzes iela 2 | 49638825 | 1 | 1342 | 5.2 | tag:building=school, t:pub |
| B | school | RTU Inženierekonomikas un vadības fakultāte | 49637680 | 1 | 1328 | 21.2 | tag:amenity=university, osm-name, t:pub |
| B | market | Arcada | 49635335 | 1 | 1320 | 6.4 | tag:shop=mall, osm-name |
| B | gov | Latvijas valsts arhīvs | 49638608 | 1 | 1301 | 19.2 | tag:amenity=archive, osm-name, t:pub |
| B | school | Raņķa dambis 3 | 49629619 | 1 | 1254 | 8.4 | tag:building=kindergarten, t:pub |
| B | school | Daugavgrīvas iela 2 | 49638521 | 1 | 1194 | 18 | tag:building=university, t:pub |
| B | hospital | Pilsoņu iela 13 k-24 | 49635887 | 1 | 1192 | 9.6 | tag:building=hospital, t:pub |
| B | school | RISEBA | 49638135 | 49638135 49637799 | 1173 | 14.8 | tag:amenity=university, osm-name, t:pub |
| B | hospital | Pilsoņu iela 13 k-23 | 49634901 | 1 | 1171 | 5.2 | tag:building=hospital, t:pub |
| B | hospital | B4 korpuss | 49635259 | 1 | 1145 | 14.8 | tag:building=hospital, osm-name |
| B | school | Sētas iela 1 | 49638105 | 1 | 1124 | 18 | tag:building=university, t:pub |
| B | school | RSU Dienesta Viesnīca (Jaunais korpuss) | 49636301 | 1 | 1122 | 18 | tag:building=dormitory, osm-name |
| B | school | RTU sporta centrs | 49637824 | 1 | 1060 | 12 | tag:building=university, osm-name, t:pub |
| B | historic | Mindeļa villa | 49634339 | 1 | 1050 | 6.4 | tag:historic=building, osm-name |
| B | hospital | RSU Nukleārās medicīnas klīnika | 49634713 | 1 | 1041 | 9.6 | tag:building=hospital, osm-name, t:pub |
| B | school | Gregora iela 13A | 49640916 | 1 | 1039 | 11.6 | tag:building=school, t:pub |
| B | hospital | Pilsoņu iela 13 k-9 | 49634803 | 1 | 1038 | 9.9 | tag:building=hospital, t:pub |
| B | station | Zasulauks | 49638172 | 1 | 1003 | 8.4 | tag:building=train_station, osm-name |
| B | church | Torņakalna baznīca | 49632471 | 1 | 958 | 15.5 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | hospital | Pilsoņu iela 13 k-18 | 49636320 | 1 | 933 | 5.2 | tag:building=hospital |
| B | hotel | Slokas iela 1 k-2 | 49629643 | 1 | 916 | 34 | tag:building=hotel, tall |
| B | school | Ojāra Vācieša iela 6 k-1 | 49631674 | 1 | 872 | 11.6 | tag:building=school, t:pub |
| B | church | Lutera Draudzes nams | 49632390 | 1 | 846 | 5.2 | osm-name, t:rel |
| B | school | Āgenskalna iela 21A | 49637293 | 1 | 818 | 11.6 | tag:building=school, t:pub |
| B | market | Kalnciema kvartāls | 49638374 | 49638374 49612403 49637428 | 816 | 9.9 | tag:amenity=marketplace, osm-name, t:pub |
| B | school | Altonavas iela 6 | 49632407 | 1 | 777 | 13.1 | tag:building=school, t:pub |
| B | school | RTU studentu viesnīca | 49637887 | 1 | 764 | 11.6 | tag:building=dormitory, osm-name |
| B | school | Pārslas iela 16 | 49634836 | 1 | 743 | 16.5 | tag:building=kindergarten, t:pub |
| B | school | Meža iela 7 | 49638343 | 1 | 741 | 21.2 | tag:building=education, t:pub |
| B | school | Valsts sociālās aprūpes centrs, Filiāle Rīga , Zīdaiņu nodaļa | 49636657 | 1 | 736 | 11.6 | tag:building=kindergarten, osm-name |
| B | school | Bišu iela 5 | 49636224 | 1 | 695 | 3.2 | tag:building=kindergarten, t:pub |
| B | school | Lavīzes iela 2A | 49638570 | 1 | 686 | 14.8 | tag:building=school, t:pub |
| B | school | Kristapa iela 39 | 49639026 | 1 | 684 | 8.4 | tag:building=school, t:pub |
| B | school | Margrietas iela 4 | 49638507 | 1 | 667 | 8.4 | tag:building=school, t:pub |
| B | school | Ernestīnes iela 8A | 49636736 | 49636736 49638604 49637116 49636885 | 658 | 8.4 | tag:building=school |
| B | hospital | Viļa Plūdoņa iela 1 | 49636905 | 1 | 651 | 6.4 | tag:building=hospital, t:pub |
| B | gov | Latvijas Ģeotelpiskās informācijas aģentūra | 49632576 | 1 | 638 | 8.4 | tag:office=government, osm-name |
| B | school | Zvārdes iela 1B | 49631676 | 1 | 634 | 5.2 | tag:building=school, t:pub |
| B | school | Latvijas Universitātes dienesta viesnīca | 49634674 | 1 | 630 | 18 | tag:building=dormitory, osm-name |
| B | school | Kapseļu iela 18 | 49636591 | 1 | 605 | 8.4 | tag:building=kindergarten |
| B | school | Rīgas Stradiņa universitāte | 49637531 | 49637531 49638846 49613597 | 600 | 11.6 | tag:building=yes, osm-name |
| B | hospital | Rīgas Stradiņa universitātes Psihosomatiskās medicīnas un psihoterapijas klīnika un katedra | 49637577 | 1 | 594 | 14.8 | tag:amenity=clinic, osm-name, t:pub |
| B | church | Nometņu iela 31 | 49638180 | 1 | 566 | 3.2 | t:rel |
| B | school | Latvijas Universitātes Bioloģijas institūts | 49631694 | 1 | 555 | 14.8 | tag:amenity=research_institute, osm-name, t:pub |
| B | gov | Rīgas pašvaldības policijas Zemgales pārvalde | 49634538 | 1 | 534 | 11.6 | tag:amenity=police, osm-name |
| B | school | Futurimo Rīga | 49638434 | 1 | 529 | 5.2 | tag:amenity=education_centre, osm-name, t:pub |
| B | church | Rīgas Vasarsvētku draudze „Dzīvā ūdens avots” | 49636198 | 1 | 529 | 3.2 | tag:amenity=place_of_worship, osm-name, t:pub |
| B | church | Svētās Trijādības Pārdaugavas pareizticīgo baznīca | 49636436 | 1 | 517 | 3.2 | tag:amenity=place_of_worship, osm-name, tag:man_made=tower |
| B | hospital | K11 | 49635340 | 1 | 492 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | station | Torņakalns | 49631865 | 1 | 488 | 5.2 | tag:building=train_station, osm-name |
| B | hospital | K10 | 49635511 | 1 | 483 | 6.4 | tag:building=hospital, osm-name, t:pub |
| B | museum | Ojāra Vācieša memoriālais muzejs | 49632648 | 1 | 473 | 8.4 | tag:tourism=museum, osm-name, t:pub |
| B | industrial | Kristus uzvara | 49634318 | 1 | 433 | 5.2 | landmark |
| B | theatre | SUNSstudio | 49635741 | 1 | 385 | 3.2 | tag:amenity=events_venue, osm-name |
| B | school | Rīgas Stradiņa universitāte | 49637973 | 1 | 362 | 6.4 | tag:amenity=university, osm-name |
| B | theatre | Rīgas Centrālās bibliotēkas Torņakalna filiālbibliotēka | 49632951 | 1 | 354 | 5.2 | tag:amenity=library, osm-name, t:pub |
| B | historic | Bloka muiža | 49632264 | 1 | 339 | 5.2 | tag:historic=manor, osm-name |
| B | museum | Eduarda Smiļģa Teātra muzejs | 49635519 | 1 | 322 | 11.6 | tag:tourism=museum, osm-name, t:pub |
| B | hotel | OK Hotel | 49638054 | 1 | 312 | 18 | tag:tourism=hotel, osm-name |
| B | school | Studija Bambino | 49636507 | 1 | 306 | 9.9 | tag:amenity=kindergarten, osm-name, t:pub |
| B | sports | Sporta un aktīvās atpūtas centrs Uzvaras parkā | 49612885 | 1 | 294 | 5.2 | tag:leisure=sports_centre, osm-name, t:pub |
| B | historic | Borherta muiža | 49631920 | 1 | 291 | 5.2 | tag:historic=manor, osm-name, t:pub |
| B | church | Svētās Terēzes draudzes nams | 49632133 | 1 | 262 | 3.2 | osm-name, t:rel |
| B | historic | Gustava Šķiltera muzejs | 49638599 | 1 | 252 | 5.2 | tag:historic=building, osm-name |
| B | castle | Hartmaņa muiža | 49636900 | 1 | 215 | 8.4 | tag:historic=manor, osm-name, landmark |
| B | church | Rīgas Svētās Terēzes no Bērna Jēzus Romas katoļu baznīca | 49631730 | 1 | 198 | 5.2 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | church | Latvijas Apvienotā metodistu baznīca | 49637556 | 1 | 193 | 11.6 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | castle | Āgenskalna televīzijas tornis | 49635713 | 1 | 145 | 3.2 | landmark |
| C | public | Uzvaras bulvāris 10 | 49629776 | 1 | 3738 | 8.4 | t:pub |
| C | industrial | RSU sporta komplekss | 49631912 | 1 | 2891 | 3.2 | osm-name, tag:man_made=chimney, t:pub |
| C | public | Baldones iela 7 | 49638699 | 1 | 2424 | 3.2 | t:pub |
| C | public | Pārslas iela 14 | 49633182 | 1 | 2258 | 6.4 | t:pub |
| C | public | Melnsila iela 6 | 49638336 | 1 | 2090 | 14.8 | t:pub |
| C | hotel | Slokas iela 1 k-1 | 49629684 | 1 | 2067 | 8.4 | tag:building=hotel |
| C | public | Uzvaras bulvāris 18 | 49629640 | 1 | 2002 | 11.6 | t:pub |
| C | public | Alīses iela 19 | 49637730 | 1 | 1887 | 21.4 | t:pub |
| C | public | Zeļļu iela 25 | 49634342 | 1 | 1597 | 8.4 | t:pub |
| C | public | Kuldīgas iela 45 | 49640613 | 1 | 1568 | 13.3 | t:pub |
| C | public | LNS Rehabilitācijas centrs | 49640809 | 1 | 1442 | 8.4 | osm-name, t:pub |
| C | public | Uzvaras bulvāris 12 | 49629595 | 1 | 1421 | 8.4 | t:pub |
| C | public | Mazā Nometņu iela 47 | 49634646 | 1 | 1372 | 3.2 | tag:building=public |
| C | public | Talsu iela 7A | 49635218 | 1 | 1099 | 9.6 | t:pub |
| C | public | Mazā Nometņu iela 39 | 49634507 | 1 | 1087 | 11.6 | tag:building=public |
| C | public | Ojāra Vācieša iela 6 | 49631968 | 1 | 1064 | 9.6 | t:pub |
| C | public | Indriķa iela 8A | 49632221 | 1 | 935 | 18 | t:pub |
| C | public | Altonavas iela 1 | 49634136 | 1 | 926 | 8.4 | t:pub |
| C | public | Kalnciema iela 40D | 49637783 | 1 | 892 | 14.8 | t:pub |
| C | hotel | Spāres iela 3 | 49654073 | 49654073 49650220 | 885 | 9.9 | tag:building=hotel, t:pub |
| C | public | Gardenes iela 8 k-41 | 49635355 | 1 | 883 | 3.2 | t:pub |
| C | public | Baldones iela 7 | 49637264 | 1 | 882 | 6.4 | t:pub |
| C | public | Raņķa dambis 14 | 49638473 | 1 | 787 | 18 | t:pub |
| C | public | Kapseļu iela 9 | 49637156 | 1 | 741 | 6.4 | t:pub |
| C | public | Kolkasraga iela 18 | 49633043 | 1 | 717 | 8.4 | t:pub |
| C | public | Biešu iela 2A | 49632528 | 1 | 707 | 8.4 | t:pub |
| C | public | Valentīna iela 10A | 49639070 | 1 | 693 | 6.4 | t:pub |
| C | public | Daugavgrīvas iela 10 | 49637604 | 1 | 686 | 8.4 | t:pub |
| C | public | Zeļļu iela 23 | 49634438 | 1 | 665 | 18 | t:pub |
| C | public | Vienības gatve 30 | 49633617 | 1 | 533 | 8.4 | t:pub |
| C | public | Alīses iela 3A | 49637470 | 1 | 521 | 14.8 | t:pub |
| C | public | Gardenes iela 8 k-42 | 49633111 | 1 | 500 | 3.2 | t:pub |
| C | school | Cieceres iela 3 | 49634766 | 1 | 486 | 8.4 | tag:building=kindergarten, t:pub |
| C | public | Kalnciema iela 19 | 49639137 | 1 | 481 | 5.2 | t:pub |
| C | school | Kalnciema iela 10 k-2 | 49638334 | 1 | 474 | 18 | tag:building=school, t:pub |
| C | industrial | Kapseļu iela 15 | 49636675 | 1 | 470 | 3.2 | tag:building=hangar |
| C | public | Ojāra Vācieša iela 2 | 49632753 | 1 | 467 | 3.2 | t:pub |
| C | industrial | Kapseļu iela 15 | 49637168 | 1 | 459 | 3.2 | tag:building=hangar |
| C | school | Ventspils iela 13A | 49633028 | 1 | 454 | 8.4 | tag:building=kindergarten, t:pub |
| C | public | Mārupes iela 16 | 49635892 | 1 | 453 | 14.8 | t:pub |
| C | public | Krūzes iela 21 | 49651928 | 1 | 407 | 3.2 | t:pub |
| C | hospital | Pilsoņu iela 13 k-12 | 49635142 | 1 | 399 | 6.4 | tag:building=hospital, t:pub |
| C | hospital | Pilsoņu iela 13 k-109 | 49635769 | 1 | 396 | 6.4 | tag:building=hospital, t:pub |
| C | hospital | Pilsoņu iela 13 k-7 | 49633027 | 1 | 388 | 6.4 | tag:building=hospital, t:pub |
| C | wooden | Kapseļu iela 25 | 49636291 | 1 | 387 | 6.4 | wooden-quarter |
| C | wooden | Mazā Kuldīgas iela 4 | 49637325 | 1 | 384 | 8.4 | wooden-quarter |
| C | wooden | Kristapa iela 2 | 49613072 | 1 | 383 | 9.9 | wooden-quarter |
| C | public | Kokles iela 12B | 49635787 | 1 | 378 | 12.8 | t:pub |
| C | wooden | Ernestīnes iela 32 | 49636867 | 1 | 376 | 6.7 | wooden-quarter |
| C | wooden | Kapseļu iela 12 | 49636888 | 1 | 368 | 6.4 | wooden-quarter |
| C | school | Torņakalna iela 15 | 49632824 | 1 | 359 | 8.4 | tag:building=school, t:pub |
| C | public | Gregora iela 13A | 49640918 | 1 | 357 | 3.2 | t:pub |
| C | public | Nometņu iela 48 | 49636560 | 1 | 357 | 6.4 | t:pub |
| C | public | Krogus iela 12 | 49638222 | 1 | 354 | 6.4 | t:pub |
| C | wooden | Margrietas iela 18 | 49638836 | 1 | 353 | 9.9 | wooden-quarter |
| C | public | Nometņu iela 64A | 49634432 | 1 | 349 | 8.4 | t:pub |
| C | wooden | Margrietas iela 14 | 49638828 | 1 | 349 | 8.4 | wooden-quarter |
| C | school | Lavīzes iela 2B | 49637901 | 1 | 340 | 11.6 | tag:building=school, t:pub |
| C | wooden | Kalnciema iela 80 | 49652221 | 1 | 340 | 8.4 | wooden-quarter |
| C | wooden | Margrietas iela 2 | 49637107 | 1 | 338 | 8.4 | wooden-quarter |
| C | public | Cieceres iela 3A | 49635410 | 1 | 334 | 8.4 | t:pub |
| C | public | Kokles iela 12 | 49635776 | 1 | 332 | 11.6 | t:pub |
| C | public | Indriķa iela 8 | 49633983 | 1 | 329 | 3.2 | t:pub |
| C | wooden | Kapseļu iela 14 | 49637949 | 1 | 328 | 6.4 | wooden-quarter |
| C | hospital | Pilsoņu iela 13 k-8 | 49635281 | 1 | 326 | 9.6 | tag:building=hospital, t:pub |
| C | public | Struteles iela 2A | 49636958 | 1 | 324 | 3.2 | t:pub |
| C | public | Cieceres iela 1 | 49635488 | 1 | 319 | 8.4 | t:pub |
| C | historic | Daugavgrīvas iela 11 | 49637752 | 1 | 316 | 8.4 | tag:historic=building |
| C | wooden | Mazā Nometņu iela 88 | 49652241 | 1 | 315 | 6.4 | wooden-quarter |
| C | wooden | Valentīna iela 15 | 49637237 | 1 | 315 | 8.4 | wooden-quarter |
| C | wooden | Margrietas iela 15 | 49639078 | 1 | 315 | 8.4 | wooden-quarter |
| C | public | Melnsila iela 19A | 49637578 | 1 | 313 | 5.2 | t:pub |
| C | public | (unnamed) | 49635284 | 1 | 313 | 6.4 | t:pub |
| C | wooden | Valentīna iela 19 | 49637312 | 1 | 313 | 8.4 | wooden-quarter |
| C | school | Kalnciema iela 12 | 49638238 | 1 | 312 | 18 | tag:building=school, t:pub |
| C | wooden | Kristapa iela 3 | 49638929 | 1 | 312 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 80A | 49652417 | 1 | 310 | 6.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 43 | 49636124 | 1 | 309 | 6.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 41 | 49636666 | 1 | 304 | 9.9 | wooden-quarter |
| C | school | Daugavgrīvas iela 8 | 49638260 | 1 | 297 | 18 | tag:building=school, t:pub |
| C | public | Mārupes iela 1A | 49635258 | 1 | 297 | 11.6 | t:pub |
| C | wooden | Mazā Kuldīgas iela 1 | 49637538 | 1 | 296 | 5.2 | wooden-quarter |
| C | wooden | Valentīna iela 21 | 49637308 | 1 | 295 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 97 | 49651727 | 1 | 294 | 6.4 | wooden-quarter |
| C | wooden | Krūzes iela 2 | 49652277 | 1 | 287 | 6.4 | wooden-quarter |
| C | hospital | Viļa Plūdoņa iela 1 | 49636826 | 1 | 284 | 8.4 | tag:building=hospital, t:pub |
| C | public | Mārupes iela 22 | 49636127 | 1 | 283 | 8.4 | t:pub |
| C | wooden | Ventspils iela 25 | 49634975 | 1 | 276 | 8.4 | tag:building:material=wood |
| C | hospital | Pilsoņu iela 13 k-5 | 49633038 | 1 | 276 | 6.4 | tag:building=hospital |
| C | wooden | Margrietas iela 6 | 49636792 | 1 | 275 | 8.4 | wooden-quarter |
| C | school | Baložu iela 24 | 49637565 | 1 | 273 | 8.4 | tag:building=school, t:pub |
| C | industrial | Ojāra Vācieša iela 43 | 49632921 | 1 | 273 | 5.2 | tag:man_made=chimney |
| C | wooden | Kapseļu iela 10A | 49637098 | 1 | 270 | 8.4 | wooden-quarter |
| C | public | LNS Rehabilitācijas centrs | 49641326 | 1 | 263 | 11.6 | osm-name, t:pub |
| C | public | Kalnciema iela 27 | 49639138 | 1 | 263 | 8.4 | t:pub |
| C | wooden | Dreiliņu iela 9 | 49638483 | 1 | 263 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 76 | 49635839 | 1 | 261 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 2 | 49637095 | 1 | 261 | 6.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 82A | 49635251 | 1 | 260 | 9.9 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 69 | 49634594 | 1 | 260 | 8.4 | wooden-quarter |
| C | public | Nometņu iela 26A | 49635063 | 1 | 259 | 3.2 | t:pub |
| C | wooden | Valentīna iela 9 | 49637593 | 1 | 259 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 17 | 49636714 | 1 | 257 | 8.4 | wooden-quarter |
| C | public | Ernestīnes iela 39 | 49638537 | 1 | 254 | 3.2 | t:pub |
| C | wooden | Atpūtas iela 5 | 49634693 | 1 | 250 | 6.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 95 | 49652253 | 1 | 248 | 6.4 | wooden-quarter |
| C | hotel | Two Wheels | 49637669 | 1 | 245 | 3.2 | tag:tourism=hotel, osm-name |
| C | wooden | Āgenskalna iela 31 | 49637178 | 1 | 243 | 3.2 | wooden-quarter |
| C | industrial | Alīses iela 4 | 49614141 | 1 | 241 | 9.6 | tag:man_made=water_tower |
| C | wooden | Kuldīgas iela 55 | 49640765 | 1 | 241 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 67 | 49634414 | 1 | 237 | 9.9 | wooden-quarter |
| C | public | Pilsoņu iela 13 k-40 | 49635305 | 1 | 236 | 3.2 | t:pub |
| C | wooden | Dreiliņu iela 7 | 49636771 | 1 | 235 | 9.6 | wooden-quarter |
| C | public | Bišu iela 20 | 49635986 | 1 | 234 | 6.4 | t:pub |
| C | wooden | Tapešu iela 3 | 49638627 | 1 | 228 | 8.4 | wooden-quarter |
| C | public | Kalnciema iela 33 | 49637864 | 1 | 227 | 8.4 | t:pub |
| C | wooden | Ernestīnes iela 45A | 49636957 | 1 | 227 | 9.9 | wooden-quarter |
| C | wooden | Krūzes iela 2 k-1 | 49651785 | 1 | 226 | 6.4 | wooden-quarter |
| C | wooden | Margrietas iela 10 | 49636753 | 1 | 224 | 8.4 | wooden-quarter |
| C | public | Ojāra Vācieša iela 2E | 49632846 | 1 | 221 | 3.2 | t:pub |
| C | wooden | Struteles iela 2 | 49636403 | 1 | 221 | 6.4 | wooden-quarter |
| C | public | Ojāra Vācieša iela 4A | 49631761 | 1 | 220 | 3.2 | t:pub |
| C | wooden | Dreiliņu iela 6 | 49636779 | 1 | 220 | 3.2 | wooden-quarter |
| C | wooden | Ernestīnes iela 38 | 49636401 | 1 | 217 | 9.6 | wooden-quarter |
| C | wooden | Atpūtas iela 7A | 49633120 | 1 | 212 | 6.4 | wooden-quarter |
| C | wooden | Ķemeru iela 11A | 49652696 | 1 | 212 | 3.2 | wooden-quarter |
| C | wooden | Struteles iela 4 | 49638807 | 1 | 211 | 8.4 | wooden-quarter |
| C | wooden | Ķemeru iela 13 | 49653255 | 1 | 209 | 3.2 | wooden-quarter |
| C | public | Pilsoņu iela 13 k-4 | 49634772 | 1 | 207 | 11.6 | t:pub |
| C | wooden | Dreiliņu iela 4 | 49638707 | 1 | 207 | 9.9 | wooden-quarter |
| C | wooden | Margrietas iela 1 | 49636988 | 1 | 204 | 8.4 | wooden-quarter |
| C | wooden | Valentīna iela 8 | 49638289 | 1 | 202 | 3.2 | wooden-quarter |
| C | wooden | Mazā Kuldīgas iela 3 | 49637571 | 1 | 199 | 8.4 | wooden-quarter |
| C | wooden | Struteles iela 5 | 49636147 | 1 | 199 | 6.4 | wooden-quarter |
| C | public | Kokles iela 12A | 49635784 | 1 | 197 | 3.2 | t:pub |
| C | wooden | Atpūtas iela 7 | 49634832 | 1 | 196 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 46A | 49636571 | 1 | 196 | 6.4 | wooden-quarter |
| C | wooden | Margrietas iela 13 | 49637253 | 1 | 192 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 1 | 49636128 | 1 | 192 | 6.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 5 | 49636581 | 1 | 191 | 6.4 | wooden-quarter |
| C | wooden | Ķemeru iela 10 | 49654081 | 1 | 190 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 51 | 49639114 | 1 | 190 | 8.4 | wooden-quarter |
| C | wooden | Kalnciema iela 76 | 49649497 | 1 | 189 | 6.4 | wooden-quarter |
| C | wooden | Fridriha Candera iela 2B | 49654422 | 1 | 189 | 3.2 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 78 | 49635823 | 1 | 188 | 6.4 | wooden-quarter |
| C | wooden | Darba iela 4 | 49640903 | 1 | 187 | 9.9 | wooden-quarter |
| C | public | Olīvu iela 5A | 49633742 | 1 | 185 | 8.4 | t:pub |
| C | hospital | K13 | 49635890 | 1 | 183 | 6.4 | tag:building=hospital, osm-name, t:pub |
| C | public | Lapu iela 24 | 49636381 | 1 | 183 | 5.2 | t:pub |
| C | wooden | Ormaņu iela 42 | 49638981 | 1 | 183 | 9.6 | wooden-quarter |
| C | historic | Daugavgrīvas iela 7 | 49637927 | 1 | 182 | 8.4 | tag:historic=building |
| C | wooden | Valentīna iela 10 | 49639035 | 1 | 181 | 6.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 27 | 49637202 | 1 | 181 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 31 | 49638274 | 1 | 181 | 8.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 32A | 49636939 | 1 | 179 | 6.7 | wooden-quarter |
| C | wooden | Kristapa iela 11 | 49637402 | 1 | 178 | 6.7 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 65 | 49636376 | 1 | 177 | 9.9 | wooden-quarter |
| C | school | Baložu iela 18 | 49637494 | 1 | 176 | 6.4 | tag:building=kindergarten |
| C | wooden | Ormaņu iela 41 | 49634569 | 1 | 176 | 6.4 | wooden-quarter |
| C | school | Zeļļu iela 29 | 49634673 | 1 | 175 | 5.2 | tag:building=school, t:pub |
| C | wooden | Valentīna iela 6 | 49638218 | 1 | 175 | 6.4 | wooden-quarter |
| C | wooden | Ķemeru iela 2 | 49656108 | 1 | 174 | 3.2 | wooden-quarter |
| C | wooden | Kuldīgas iela 53 | 49640830 | 1 | 173 | 6.7 | wooden-quarter |
| C | wooden | Fridriha Candera iela 2 | 49654285 | 1 | 172 | 6.4 | wooden-quarter |
| C | public | Uzvaras bulvāris 15 | 49629616 | 1 | 168 | 3.2 | t:pub |
| C | wooden | Darba iela 7 | 49641054 | 1 | 168 | 8.4 | wooden-quarter |
| C | public | Ojāra Vācieša iela 6A | 49631758 | 1 | 166 | 8.4 | t:pub |
| C | wooden | Mazā Nometņu iela 81 | 49638552 | 1 | 166 | 6.7 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 65B | 49634495 | 1 | 166 | 6.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 12 | 49638341 | 1 | 166 | 8.4 | wooden-quarter |
| C | wooden | Kalnciema iela 46C | 49636815 | 1 | 165 | 6.4 | wooden-quarter |
| C | public | Zvārdes iela 1C | 49632802 | 1 | 164 | 5.2 | t:pub |
| C | wooden | Ormaņu iela 40 | 49639028 | 1 | 164 | 6.4 | wooden-quarter |
| C | wooden | Āgenskalna iela 26 | 49637446 | 1 | 164 | 8.4 | wooden-quarter |
| C | public | Kaķu palīdzības centrs REMI | 49651585 | 1 | 162 | 3.2 | osm-name, t:pub |
| C | wooden | Margrietas iela 20 | 49637574 | 1 | 160 | 8.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 45 | 49636805 | 1 | 159 | 9.9 | wooden-quarter |
| C | wooden | Ķemeru iela 5 | 49656271 | 1 | 158 | 3.2 | wooden-quarter |
| C | wooden | Kristapa iela 13 | 49639090 | 1 | 158 | 6.4 | wooden-quarter |
| C | wooden | Margrietas iela 11A | 49637367 | 1 | 157 | 3.2 | wooden-quarter |
| C | wooden | Tapešu iela 6 | 49640716 | 1 | 157 | 6.7 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 63A | 49634456 | 1 | 157 | 6.4 | wooden-quarter |
| C | wooden | Ormaņu iela 42A | 49638064 | 1 | 157 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 75 | 49637572 | 1 | 155 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 63 | 49635663 | 1 | 155 | 9.9 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 87A | 49636726 | 1 | 152 | 9.9 | wooden-quarter |
| C | wooden | Valentīna iela 16 k-7 | 49638673 | 1 | 152 | 8.4 | wooden-quarter |
| C | wooden | Margrietas iela 19 | 49637766 | 1 | 150 | 3.2 | wooden-quarter |
| C | wooden | Ķemeru iela 8 | 49653298 | 1 | 150 | 6.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 98 | 49653303 | 1 | 149 | 6.4 | wooden-quarter |
| C | wooden | Margrietas iela 23 | 49638766 | 1 | 149 | 3.2 | wooden-quarter |
| C | wooden | Ernestīnes iela 42 | 49637026 | 1 | 147 | 6.4 | wooden-quarter |
| C | wooden | Valentīna iela 16 k-6 | 49637763 | 1 | 144 | 8.4 | wooden-quarter |
| C | wooden | Āgenskalna iela 30 | 49638731 | 1 | 143 | 8.4 | wooden-quarter |
| C | wooden | Ķemeru iela 12 | 49652180 | 1 | 142 | 6.4 | wooden-quarter |
| C | wooden | Ķemeru iela 3 | 49652985 | 1 | 142 | 3.2 | wooden-quarter |
| C | wooden | Ormaņu iela 36 | 49638759 | 1 | 142 | 6.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 47A | 49638934 | 1 | 141 | 6.7 | wooden-quarter |
| C | wooden | Volguntes iela 3A | 49656549 | 1 | 140 | 5.2 | wooden-quarter |
| C | wooden | Ormaņu iela 44 | 49637866 | 1 | 140 | 6.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 83 | 49637838 | 1 | 138 | 5.2 | wooden-quarter |
| C | wooden | Āgenskalna iela 32 | 49638491 | 1 | 138 | 8.4 | wooden-quarter |
| C | wooden | Darba iela 4A | 49641605 | 1 | 138 | 9.9 | wooden-quarter |
| C | wooden | Kapseļu iela 27 | 49637135 | 1 | 136 | 6.4 | wooden-quarter |
| C | wooden | Volguntes iela 2 | 49652864 | 1 | 135 | 3.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 8 | 49638745 | 1 | 134 | 6.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 85 | 49638162 | 1 | 133 | 6.4 | wooden-quarter |
| C | wooden | Darba iela 5 | 49640906 | 1 | 132 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 92 | 49653244 | 1 | 131 | 6.4 | wooden-quarter |
| C | wooden | Nomales iela 5 | 49633129 | 1 | 130 | 6.4 | wooden-quarter |
| C | wooden | Valentīna iela 17 | 49637466 | 1 | 130 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 65A | 49636372 | 1 | 130 | 9.9 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 75A | 49638465 | 1 | 129 | 3.2 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 92A | 49649561 | 1 | 129 | 6.4 | wooden-quarter |
| C | wooden | Ormaņu iela 35 | 49634607 | 1 | 128 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 29 | 49638452 | 1 | 128 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 96 | 49652117 | 1 | 126 | 3.2 | wooden-quarter |
| C | wooden | Ernestīnes iela 36 | 49636132 | 1 | 125 | 3.2 | wooden-quarter |
| C | wooden | Kalnciema iela 45 | 49638438 | 1 | 124 | 8.4 | wooden-quarter |
| C | wooden | Atpūtas iela 3 | 49636190 | 1 | 121 | 3.2 | wooden-quarter |
| C | wooden | Atpūtas iela 2C | 49635223 | 1 | 120 | 3.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 23 | 49638248 | 1 | 120 | 8.4 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 87 | 49638015 | 1 | 119 | 3.2 | wooden-quarter |
| C | wooden | Darba iela 3 | 49641283 | 1 | 119 | 3.2 | wooden-quarter |
| C | wooden | Margrietas iela 11 | 49639067 | 1 | 117 | 3.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 25 | 49638142 | 1 | 114 | 5.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 8A | 49636926 | 1 | 113 | 3.2 | wooden-quarter |
| C | historic | Daugavgrīvas iela 9B | 49637990 | 1 | 112 | 6.4 | tag:historic=building |
| C | wooden | Āgenskalna iela 32A | 49639087 | 1 | 112 | 8.4 | wooden-quarter |
| C | wooden | Dreiliņu iela 3 | 49638564 | 1 | 112 | 6.7 | wooden-quarter |
| C | wooden | Ernestīnes iela 47 | 49636683 | 1 | 110 | 6.4 | wooden-quarter |
| C | wooden | Ormaņu iela 40B | 49636861 | 1 | 109 | 6.4 | wooden-quarter |
| C | wooden | Kapseļu iela 33 | 49636944 | 1 | 108 | 3.2 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 82 | 49634699 | 1 | 107 | 3.2 | wooden-quarter |
| C | wooden | Baseina iela 3 | 49653743 | 1 | 106 | 3.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 27A | 49637546 | 1 | 106 | 5.2 | wooden-quarter |
| C | wooden | Volguntes iela 4 | 49655196 | 1 | 105 | 3.2 | wooden-quarter |
| C | wooden | Volguntes iela 4 k-1 | 49655781 | 1 | 105 | 3.2 | wooden-quarter |
| C | wooden | Āgenskalna iela 28 | 49637691 | 1 | 104 | 5.2 | wooden-quarter |
| C | wooden | Ormaņu iela 36A | 49636725 | 1 | 104 | 3.2 | wooden-quarter |
| C | wooden | Kristapa iela 5 | 49637320 | 1 | 103 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 63 | 49638256 | 1 | 99 | 6.4 | wooden-quarter |
| C | wooden | Ormaņu iela 37 | 49635491 | 1 | 97 | 6.4 | wooden-quarter |
| C | wooden | Valentīna iela 7 | 49637877 | 1 | 96 | 5.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 10A | 49638635 | 1 | 94 | 8.4 | wooden-quarter |
| C | wooden | Kuldīgas iela 55A | 49641548 | 1 | 93 | 8.4 | wooden-quarter |
| C | wooden | Ķemeru iela 7 | 49653773 | 1 | 92 | 3.2 | wooden-quarter |
| C | wooden | Smārdes iela 1 | 49653798 | 1 | 92 | 3.2 | wooden-quarter |
| C | wooden | Ormaņu iela 38 | 49636795 | 1 | 92 | 3.2 | wooden-quarter |
| C | wooden | Kristapa iela 13A | 49638758 | 1 | 91 | 3.2 | wooden-quarter |
| C | wooden | Kristapa iela 7 | 49639101 | 1 | 89 | 5.2 | wooden-quarter |
| C | wooden | Kalnciema iela 45A | 49637874 | 1 | 88 | 3.2 | wooden-quarter |
| C | wooden | Dreiliņu iela 19 | 49639099 | 1 | 87 | 3.2 | wooden-quarter |
| C | wooden | Struteles iela 4A | 49636413 | 1 | 82 | 5.2 | wooden-quarter |
| C | wooden | Tapešu iela 4 | 49640711 | 1 | 80 | 5.2 | wooden-quarter |
| C | wooden | Kristapa iela 7A | 49638559 | 1 | 80 | 5.2 | wooden-quarter |
| C | wooden | Mazā Kuldīgas iela 1A | 49637360 | 1 | 79 | 3.2 | wooden-quarter |
| C | wooden | Margrietas iela 13A | 49637542 | 1 | 79 | 3.2 | wooden-quarter |
| C | wooden | Ormaņu iela 43 | 49635016 | 1 | 79 | 6.4 | wooden-quarter |
| C | wooden | Ernestīnes iela 44 | 49638093 | 1 | 75 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 76A | 49653356 | 1 | 74 | 6.4 | wooden-quarter |
| C | wooden | Kalnciema iela 45B | 49637467 | 1 | 74 | 6.4 | wooden-quarter |
| C | wooden | Kristapa iela 2A | 49637403 | 1 | 73 | 3.2 | wooden-quarter |
| C | wooden | Margrietas iela 18A | 49638708 | 1 | 72 | 3.2 | wooden-quarter |
| C | wooden | Kapseļu iela 14A | 49637728 | 1 | 71 | 3.2 | wooden-quarter |
| C | wooden | Ķemeru iela 8A | 49656458 | 1 | 69 | 6.4 | wooden-quarter |
| C | wooden | Ormaņu iela 40A | 49636664 | 1 | 69 | 3.2 | wooden-quarter |
| C | wooden | Ormaņu iela 39 | 49634391 | 1 | 68 | 3.2 | wooden-quarter |
| C | wooden | Mazā Kuldīgas iela 1B | 49637355 | 1 | 65 | 3.2 | wooden-quarter |
| C | wooden | Mazā Nometņu iela 86 | 49635374 | 1 | 64 | 5.2 | wooden-quarter |
| C | wooden | Kalnciema iela 79A | 49653383 | 1 | 64 | 3.2 | wooden-quarter |
| C | historic | Daugavgrīvas iela 11A | 49638194 | 1 | 63 | 3.2 | tag:historic=building |
| C | wooden | Fridriha Candera iela 2C | 49654408 | 1 | 62 | 5.2 | wooden-quarter |
| C | wooden | Margrietas iela 14A | 49638463 | 1 | 60 | 3.2 | wooden-quarter |
| C | church | Meža iela 2B | 49636360 | 1 | 46 | 8.4 | tag:building=chapel |

## mezaparks — 41 sights (A 2 / B 23 / C 16)

| tier | category | name | lead id | pieces | area m2 | h m | why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | sports | Lielā estrāde [estrade] | 49673065 | 49673065 49673070 | 18853 | 6.4 | tierA |
| A | public | Tropu māja [tropu] | 49672040 | 1 | 2121 | 13 | tierA |
| B | sports | Ķeizarmežs | 49665346 | 49665346 49662400 | 3894 | 6.4 | tag:leisure=sports_centre, osm-name, t:pub |
| B | market | Lidl | 49665580 | 1 | 2985 | 5.2 | osm-name, landmark |
| B | hospital | Jaunā Mežaparka iela 4 | 49668641 | 1 | 1404 | 11.6 | tag:building=hospital, t:pub |
| B | public | Āfrikas savanna | 49672866 | 1 | 1096 | 16 | landmark |
| B | church | Rīgas Kristus Karaļa Romas katoļu draudze | 49668667 | 1 | 919 | 3.2 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | public | Vides izglītības centrs "Zinarium" | 49672738 | 1 | 861 | 3.2 | osm-name, t:pub, landmark |
| B | industrial | Žirafju māja | 49671985 | 1 | 829 | 3.2 | osm-name, landmark |
| B | industrial | Terārijs | 49672149 | 1 | 802 | 11.4 | osm-name, landmark |
| B | historic | Villa 'Wasa' | 49665210 | 1 | 728 | 9.6 | tag:historic=building, osm-name, t:pub |
| B | public | "Ziemeļi", bērnu nams | 49665585 | 1 | 724 | 8.4 | osm-name, t:pub, landmark |
| B | public | BUJC Ziemeļi | 49664171 | 1 | 708 | 8.4 | osm-name, t:pub, landmark |
| B | school | Kārļa Vatsona iela 11A | 49665489 | 1 | 687 | 8.4 | tag:building=kindergarten, t:pub |
| B | theatre | Mežaparka filiālbibliotēka | 49671800 | 1 | 613 | 6.4 | tag:amenity=library, osm-name, landmark |
| B | industrial | Flamingu māja | 49672970 | 1 | 384 | 3.2 | landmark |
| B | market | Bella Bella | 49673124 | 1 | 367 | 3.2 | landmark |
| B | public | Villa Helenia | 49668674 | 1 | 359 | 8.4 | landmark |
| B | school | Rīgas Jāņa Poruka vidusskola | 49662383 | 1 | 298 | 9.9 | tag:amenity=school, osm-name, tag:heritage |
| B | market | Grāves muiža | 49665457 | 1 | 276 | 3.2 | tag:historic=manor, osm-name, landmark |
| B | public | Villa Lavanda | 49668634 | 1 | 274 | 8.4 | landmark |
| B | church | Kunga Apskaidrošanās pareizticīgo baznīca | 49666459 | 1 | 216 | 8.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | public | Villa Linnea | 49668672 | 1 | 202 | 6.4 | landmark |
| B | public | Villa Magnolia | 49668588 | 1 | 183 | 6.4 | landmark |
| B | church | Rīgas Mežaparka baznīca | 49665685 | 1 | 132 | 3.2 | tag:building=church, osm-name, t:rel |
| C | public | Meža prospekts 1 | 49672076 | 1 | 910 | 3.2 | t:pub |
| C | public | Stokholmas iela 24 | 49662474 | 1 | 719 | 6.4 | t:pub |
| C | public | Meža prospekts 5 | 49673064 | 1 | 667 | 3.2 | t:pub |
| C | public | Ezermalas iela 28 | 49665588 | 1 | 636 | 6.4 | t:pub |
| C | public | Cimzes iela 3 | 49662372 | 1 | 521 | 9.6 | t:pub |
| C | school | Stokholmas iela 3A | 49662574 | 1 | 469 | 8.4 | tag:building=kindergarten, t:pub |
| C | public | Kokneses prospekts 15 | 49662566 | 1 | 412 | 8.4 | t:pub |
| C | public | Kokneses prospekts 24 | 49672812 | 1 | 382 | 3.2 | t:pub |
| C | public | Ezermalas iela 32 | 49665340 | 1 | 244 | 6.4 | t:pub |
| C | station | Sarkandaugava | 49618114 | 1 | 209 | 8.4 | tag:building=train_station, osm-name |
| C | public | Meža prospekts 1 | 49672722 | 1 | 195 | 6.4 | t:pub |
| C | station | Sliežu iela 2 | 49616885 | 1 | 185 | 5.2 | tag:building=transportation |
| C | public | Visbijas prospekts 47 | 49672159 | 1 | 173 | 11.6 | t:pub |
| C | public | Meža prospekts 30 | 49672931 | 1 | 172 | 6.4 | t:pub |
| C | church | Meža prospekts 11A | 49668655 | 1 | 90 | 8.4 | t:rel |
| C | church | Nesaules iela 7 | 49668590 | 1 | 47 | 3.2 | t:rel |

## purvciems — 89 sights (A 0 / B 44 / C 45)

| tier | category | name | lead id | pieces | area m2 | h m | why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B | market | Mēbeļu nams | 49645026 | 1 | 9630 | 11.6 | osm-name, landmark |
| B | school | Nīcgales iela 26 | 49648478 | 49648478 49646534 49648480 | 7121 | 30.8 | tag:building=school, t:pub, tall |
| B | industrial | Box Storage | 49646556 | 1 | 6117 | 6.4 | osm-name, landmark |
| B | market | Promo Cash & Carry | 49645263 | 1 | 5145 | 5.2 | osm-name, landmark |
| B | church | Labā Vēsts | 49645108 | 1 | 4351 | 10 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | public | Tenisa klubs "Enri" | 49644528 | 49644528 49648611 | 3748 | 3.2 | osm-name, t:pub, landmark |
| B | school | Andromedas gatve 11 | 49648970 | 1 | 3484 | 14.8 | tag:building=school, t:pub |
| B | school | Lielvārdes iela 141 | 49644606 | 1 | 3402 | 11.6 | tag:building=school, t:pub |
| B | market | Astras biroji | 49646439 | 1 | 2945 | 27.6 | osm-name |
| B | market | Lidl | 49648484 | 1 | 2835 | 10 | osm-name, landmark |
| B | market | Senson Auto | 49646773 | 1 | 2807 | 5.2 | osm-name, landmark |
| B | public | Tenisa klubs ANRI | 49642345 | 1 | 2778 | 18 | osm-name, t:pub, landmark |
| B | school | Augusta Deglava iela 41A | 49644650 | 1 | 2583 | 11.6 | tag:building=school, t:pub |
| B | market | Lidl | 49649023 | 1 | 2561 | 5.2 | osm-name |
| B | school | Nīcgales iela 15 k-1 | 49644255 | 49644255 49646331 | 2460 | 8.4 | tag:building=school, t:pub |
| B | market | Astras biznesa centrs | 49646321 | 1 | 2425 | 24.4 | osm-name, landmark |
| B | school | Purvciema iela 32 | 49645901 | 1 | 1866 | 5.2 | tag:building=kindergarten, t:pub |
| B | market | Nice Home | 49642219 | 1 | 1840 | 8.4 | osm-name, landmark |
| B | sports | F1 | 49645469 | 1 | 1682 | 8.4 | tag:leisure=sports_centre, osm-name, t:pub |
| B | market | Vitrum | 49648311 | 1 | 1676 | 8.4 | osm-name, landmark |
| B | school | Bāreņu aprūpes centrs "Pļavnieki" | 49645032 | 1 | 1632 | 8.4 | tag:building=kindergarten, osm-name, landmark |
| B | market | JYSK | 49644263 | 1 | 1609 | 5.2 | osm-name, landmark |
| B | public | Mēness boulinga centrs | 49642417 | 1 | 1588 | 15 | osm-name, t:pub, landmark |
| B | market | Modern Home | 49645730 | 49645730 49646374 | 1461 | 18 | osm-name, landmark |
| B | school | Rīgas pirmsskolas izglītības iestāde "Māra" | 49645163 | 1 | 1454 | 8.4 | tag:building=kindergarten, osm-name, t:pub |
| B | school | Ilūkstes iela 101 k-4 | 49649019 | 1 | 1428 | 8.4 | tag:building=kindergarten, t:pub |
| B | market | GASO mācību centrs | 49644532 | 1 | 1301 | 6.4 | tag:amenity=college, osm-name, landmark |
| B | hospital | Veselības centrs Biķernieki | 49672403 | 1 | 1269 | 18 | tag:amenity=doctors, osm-name, t:pub |
| B | market | Online Hotel KaBerg | 49666915 | 1 | 1259 | 18 | tag:tourism=hotel, osm-name, landmark |
| B | school | Dzelzavas iela 17A | 49643939 | 1 | 1181 | 5.2 | tag:building=kindergarten, t:pub |
| B | hospital | Veselības centru apvienības poliklīnika "Aura" | 49644032 | 1 | 1136 | 24.4 | tag:amenity=clinic, osm-name, t:pub |
| B | hospital | NMPD RRC BAC "Purvciems" | 49642633 | 1 | 1028 | 8.4 | tag:building=hospital, osm-name, t:pub |
| B | tower | Augusta Deglava iela 41B | 49645176 | 1 | 925 | 30.8 | tall |
| B | church | Lūgšanu nams | 49667084 | 1 | 767 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | church | Svētās Trīsvienības katoļu baznīca | 49646403 | 1 | 736 | 6.4 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | hospital | Tuberkulozes un plaušu slimību centrs | 49672407 | 1 | 639 | 21.2 | tag:building=hospital, osm-name, t:pub |
| B | school | Dzelzavas iela 9 | 49645808 | 1 | 637 | 8.4 | tag:building=kindergarten, t:pub |
| B | gov | Rīgas pašvaldības policijas Vidzemes priekšpilsētas pārvalde | 49613921 | 1 | 609 | 6.4 | tag:amenity=police, osm-name |
| B | hotel | Felicia | 49644710 | 1 | 598 | 9.9 | tag:tourism=hotel, osm-name |
| B | market | Deglava tirdzniecības komplekss | 49647682 | 49647682 49645018 49646781 49645273 49646537 49646922 | 535 | 3.2 | tag:amenity=marketplace, osm-name, landmark |
| B | church | Jaunapustuliskā baznīca | 49645566 | 1 | 410 | 3.2 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | sports | Hansu | 49643659 | 1 | 310 | 5.2 | tag:leisure=sports_centre, osm-name, t:pub |
| B | church | Jehovas liecinieku valstības zāle | 49646794 | 1 | 274 | 3.2 | tag:amenity=place_of_worship, osm-name, t:rel |
| B | museum | Meteorītu muzejs | 49646366 | 1 | 123 | 6.4 | tag:tourism=museum, osm-name |
| C | public | Purvciema iela 38 | 49645310 | 1 | 4243 | 11.6 | t:pub |
| C | public | Purvciema iela 23A | 49644262 | 1 | 3537 | 9.6 | t:pub |
| C | public | Zentas Mauriņas iela 8 | 49646903 | 1 | 3270 | 11.6 | t:pub |
| C | public | Stirnu iela 8 | 49644711 | 1 | 2627 | 6.4 | t:pub |
| C | public | Vaidavas iela 6 | 49642531 | 1 | 2178 | 14.8 | t:pub |
| C | public | Burtnieku iela 34 | 49668573 | 1 | 2166 | 14.8 | t:pub |
| C | public | Lielvārdes iela 68 | 49672413 | 1 | 2132 | 16 | t:pub |
| C | public | Ūnijas iela 93 | 49646511 | 1 | 2065 | 14.8 | t:pub |
| C | public | Induļa iela 4 | 49645499 | 1 | 2062 | 14.8 | t:pub |
| C | public | Marsa gatve 16 | 49646189 | 1 | 1301 | 6.4 | t:pub |
| C | public | Ūnijas iela 83 | 49645830 | 1 | 1298 | 16.1 | t:pub |
| C | public | Augusta Deglava iela 41A | 49644715 | 1 | 1275 | 11.6 | t:pub |
| C | public | Pīļu iela 1 | 49646560 | 1 | 1264 | 6.4 | t:pub |
| C | public | Ieriķu iela 67A | 49668392 | 1 | 1249 | 6.4 | t:pub |
| C | public | Vaidavas iela 11 | 49643993 | 1 | 1233 | 21.3 | t:pub |
| C | public | Andromedas gatve 3 | 49644629 | 1 | 1225 | 16.5 | t:pub |
| C | public | Saktas iela 3A | 49645496 | 1 | 1217 | 17.2 | t:pub |
| C | hotel | Raunas iela 44 | 49668356 | 1 | 1211 | 21.2 | tag:building=hotel |
| C | public | Madonas iela 24B | 49644024 | 1 | 1201 | 6.4 | t:pub |
| C | public | Marsa gatve 8 | 49644949 | 1 | 1201 | 18.6 | t:pub |
| C | public | Dzelzavas iela 87 | 49646649 | 1 | 1198 | 19.3 | t:pub |
| C | public | Jaunrozes iela 12 | 49646643 | 1 | 1189 | 16.1 | t:pub |
| C | public | Active Kids | 49644959 | 1 | 1040 | 6.4 | tag:building=public, osm-name, t:pub |
| C | public | Vaidavas iela 9A | 49644143 | 1 | 1028 | 8.4 | t:pub |
| C | public | NVO nams | 49668406 | 1 | 957 | 14.8 | tag:building=public, osm-name |
| C | industrial | Euronics | 49644358 | 1 | 947 | 8.4 | osm-name |
| C | public | Lielvārdes iela 68 k-2 | 49672409 | 1 | 885 | 19.2 | t:pub |
| C | public | Raunas iela 44 k-1 | 49668219 | 1 | 818 | 21.2 | t:pub |
| C | public | Ieriķu iela 20 | 49643774 | 1 | 675 | 11.6 | t:pub |
| C | public | Raunas iela 43B | 49668290 | 1 | 663 | 3.2 | t:pub |
| C | public | Raunas iela 54 | 49668526 | 1 | 643 | 6.4 | t:pub |
| C | public | Kastrānes iela 5A | 49668077 | 1 | 642 | 3.2 | t:pub |
| C | public | Augusta Deglava iela 68 | 49648287 | 1 | 598 | 3.2 | t:pub |
| C | public | Raunas iela 64 | 49668497 | 1 | 512 | 6.4 | t:pub |
| C | public | Ieriķu iela 15 k-3 | 49644457 | 1 | 452 | 21.2 | t:pub |
| C | public | Dārzciema iela 9 | 49646850 | 1 | 366 | 6.7 | t:pub |
| C | public | Ilūkstes iela 54A | 49648406 | 1 | 296 | 5.2 | t:pub |
| C | public | Raunas iela 32 | 49668075 | 1 | 253 | 3.2 | t:pub |
| C | public | Ūnijas iela 54 | 49642546 | 1 | 232 | 6.4 | t:pub |
| C | public | Dimants | 49646955 | 1 | 228 | 6.4 | osm-name, t:pub |
| C | public | Ieriķu iela 15 k-2 | 49642318 | 1 | 226 | 11.6 | t:pub |
| C | public | Zvaigznāja gatve 2 | 49646739 | 1 | 216 | 6.4 | t:pub |
| C | public | Raunas iela 27 | 49668548 | 1 | 207 | 6.4 | t:pub |
| C | school | Raunas iela 34 | 49668079 | 1 | 178 | 8.4 | tag:building=kindergarten, t:pub |
| C | public | Ūnijas iela 91 | 49644198 | 1 | 168 | 5.2 | t:pub |
