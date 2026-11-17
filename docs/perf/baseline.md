# Perf pass: baseline (before any change)

Harness: `scripts/perf-pass.mjs` (modes load / build / frame / trace / mem / breakdown), `scripts/perf/lib.mjs` (static server that mirrors the live delivery: brotli for html/js/css/json, .gz/.png as is, Cache-Control from `_headers`, ETag/304, wire bytes counted per URL), `scripts/perf/run-all.sh`. Raw JSON: `docs/perf/data/*-base*.json`, logs `base.log`. Medians of 3 runs (1 run for the Pixel 5 profile on Āgenskalns / Purvciems). Machine: M-series Mac, real GPU through Metal/ANGLE, shared with other agents: absolute frame ms drift by about +-1 ms between sessions (an A/B in one session is stable), so compare within the same table / session.
Profiles: desktop (Chromium 1280x720), pixel5 (Chromium Pixel 5, Fast 4G 9/1.5 Mbit 170 ms RTT, 4x CPU), pixel5cpu (same without network throttle), iphone13 (WebKit emulation, no throttling, timer resolution 1 ms so sim/render split is noisy; WebKit has no service worker / HTTP cache persistence in a fresh context, so its "warm" rows are not a warm cache).
Time to playable = navigation start -> `body[data-ready]` (loader removed, Play enabled). Transfer = bytes the server wrote (requests issued) up to ready; "after 6 s" adds the service worker's background downloads.
Live site (read-only, curl, brotli): `/` 4.8 KB, index.js 153 KB, three.js 148 KB, css 11 KB, riga.json 766 KB, shapes 1149 KB, ground png 561 KB, objects 324 KB, sights 2.6 KB, areas 9 KB (Centre = 3.13 MB); Mežaparks riga.json 196 KB, shapes 187 KB, ground 393 KB. No fonts. Cache-Control as in `public/_headers`; matches the build.

## The 5 biggest findings

1. **Wide views are draw-call bound, and props are the cost.** Whole-city intro and r>=90 / max zoom-out submit 1,150-2,050 draw calls and 1.3-3.2 M triangles: 6-7 ms CPU on the desktop, **16-29 ms on the Pixel 5 4x profile** (frame drops in the 3 s intro and in the late game). Hiding props takes the intro from 6.5 to 2.9 ms; people alone are 1.1 M triangles on Purvciems, 6 person kinds x ~130 cells = 760 tiny meshes.
2. **World build on a phone is 3.0 s on the Centre (Pixel 5, 4x), the loader is frozen for all of it** (longest task 3.3 s). Desktop 0.73 s. Half of the building geometry time was one function: `neighbourRef` (hypot + full sort of ~4,500 buildings per sight = 160 ms desktop / 670 ms phone), the building batch step spent 65 % in `cornerHeights` (every corner x every triangle).
3. **First visit to a district downloaded the Centre as well:** the service worker precached the Centre's five data files (2.6 MB) at install, for every new player, also on Mežaparks (cold total 4.0-4.8 MB instead of 1.6-2.5 MB).
4. **Close-up ground repaint hitch:** while the hole is small (camera < 85 m) the detail layer repaints a 110 m window every ~22 m of movement, 31-47 ms on the desktop (about 3 frames, 100+ ms on phones). 70 % of it is `smoothRasterWindow` (a Math.hypot per tap, 1.7 M per repaint).
5. **Network is bandwidth-bound and already tight:** PNG ground raster is already a 4-bit palette (re-deflate 9 = +0 %), shapes / objects are gzip-9 (brotli-11 would give -10 / -15 % but needs a client decoder). Warm (service worker) loads cost 0 bytes: time-to-playable on a warm phone (3.8 s Centre) is all main-thread build. Memory is fine on the low tier (66 MB textures Centre; high tier 350 MB, desktop only; JS heap 30-62 MB). Sim is not the problem: 0.4-2.2 ms/frame (traffic.update ~0.7 ms of it), gameplay render 2-3 ms.

## Tables (all numbers raw from the harness)

### Load: transfer (KB at ready, as served; brotli for html/js/css/json) and time to playable (s, median of runs)
| profile | map | cache | base: KB / ready s / FCP ms / build ms |
|---|---|---|---|
| desktop | centrs | cold | 3160 / 1.01 / 24 / 759 |
| desktop | centrs | warm | 0 / 1.02 / 20 / 763 |
| desktop | agenskalns | cold | 4813 / 0.74 / 24 / 462 |
| desktop | agenskalns | warm | 0 / 0.74 / 20 / 462 |
| desktop | mezaparks | cold | 4002 / 0.47 / 24 / 220 |
| desktop | mezaparks | warm | 0 / 0.51 / 20 / 229 |
| desktop | purvciems | cold | 4207 / 0.53 / 24 / 267 |
| desktop | purvciems | warm | 0 / 0.54 / 20 / 265 |
| pixel5 | centrs | cold | 3160 / 6.54 / 436 / 2981 |
| pixel5 | centrs | warm | 0 / 3.81 / 68 / 2968 |
| pixel5 | agenskalns | cold | 4813 / 4.79 / 440 / 1766 (1 run) |
| pixel5 | agenskalns | warm | 0 / 2.56 / 64 / 1733 (1 run) |
| pixel5 | mezaparks | cold | 3455 / 2.92 / 428 / 775 |
| pixel5 | mezaparks | warm | 0 / 1.48 / 68 / 781 |
| pixel5 | purvciems | cold | 3659 / 3.33 / 436 / 933 (1 run) |
| pixel5 | purvciems | warm | 0 / 1.71 / 68 / 940 (1 run) |
| iphone13 | centrs | cold | 5541 / 1.00 / 52 / 678 |
| iphone13 | centrs | warm | 4510 / 1.04 / 37 / 681 |
| iphone13 | agenskalns | cold | 4742 / 0.68 / 35 / 368 |
| iphone13 | agenskalns | warm | 3706 / 0.65 / 34 / 371 |
| iphone13 | mezaparks | cold | 2727 / 0.50 / 40 / 197 |
| iphone13 | mezaparks | warm | 1691 / 0.43 / 36 / 192 |
| iphone13 | purvciems | cold | 3652 / 0.50 / 40 / 218 |
| iphone13 | purvciems | warm | 2616 / 0.48 / 33 / 213 |

### Load: bytes after 6 s (SW background traffic), cold
| profile | map | base: KB after 6 s |
|---|---|---|
| desktop | centrs | 3160 |
| desktop | agenskalns | 4813 |
| desktop | mezaparks | 4002 |
| desktop | purvciems | 4207 |
| pixel5 | centrs | 3160 |
| pixel5 | agenskalns | 4813 |
| pixel5 | mezaparks | 4002 |
| pixel5 | purvciems | 4207 |

### Per-resource transfer, centre, cold (KB)
| resource | base |
|---|---|
| /data/riga-shapes.bin.gz | 1122 |
| /data/riga.json | 687 |
| /data/riga-ground.png | 547 |
| /data/riga-objects.bin.gz | 316 |
| /assets/index.js | 140 |
| /assets/three.js | 134 |
| /icons/icon-512.png | 133 |
| /icons/icon-192.png | 25 |
| /icons/apple-touch-icon.png | 20 |
| /assets/index.css | 10 |
| /data/riga-areas.json | 9 |
| / | 4 |
| /data/thumb.png | 3 |
| /data/sights.json | 2 |
| /sw.js | 2 |
| /manifest.webmanifest | 0 |
| /favicon.svg | 0 |

### World build, desktop (Chromium, M-series, unthrottled): ms (median of 3), per map x tier
| profile | map | tier | label | buildMs | ground-total | ground-prep | ground-tiles | ground-skirt | buildings-total | bld-pass1 | bld-geometry | bld-sights-treatment(in geometry) | bld-batch | traffic-roadnet | props-total | blockers | json-parse | longest | first frame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop | centrs | low | base | 733 | 173.2 | 41.0 | 125.8 | 5.4 | 460.0 | 22.4 | 315.6 | 160.7 | 112.1 | 64.6 | 27.4 | 2.4 | 9.0 | 797 | 59.5 |
| desktop | centrs | medium | base | 766 | 205.5 | 41.3 | 121.3 | 40.8 | 460.0 | 19.5 | 315.1 | 159.1 | 116.5 | 64.7 | 28.9 | 2.3 | 9.2 | 828 | 85.4 |
| desktop | centrs | high | base | 789 | 227.2 | 41.0 | 132.3 | 52.2 | 456.1 | 19.0 | 315.7 | 160.8 | 112.5 | 67.1 | 28.5 | 2.3 | 8.8 | 849 | 83.2 |
| desktop | agenskalns | low | base | 433 | 107.2 | 32.5 | 68.2 | 5.1 | 277.8 | 16.6 | 203.2 | 111.1 | 48.0 | 13.4 | 25.8 | 2.3 | 6.6 | 502 | 60.6 |
| desktop | agenskalns | medium | base | 471 | 138.5 | 32.2 | 69.5 | 34.9 | 282.7 | 15.5 | 203.7 | 111.9 | 53.2 | 13.2 | 28.2 | 2.1 | 6.8 | 542 | 77.7 |
| desktop | agenskalns | high | base | 476 | 151.7 | 33.5 | 75.1 | 43.3 | 277.2 | 14.8 | 205.3 | 110.9 | 45.6 | 12.7 | 25.3 | 3.4 | 7.1 | 544 | 110.3 |
| desktop | mezaparks | low | base | 207 | 69.3 | 30.9 | 32.1 | 5.2 | 76.5 | 8.9 | 43.6 | 8.0 | 20.5 | 24.2 | 27.7 | 1.4 | 2.2 | 271 | 48.9 |
| desktop | mezaparks | medium | base | 217 | 85.4 | 31.6 | 31.8 | 20.1 | 73.5 | 6.1 | 43.5 | 7.1 | 20.3 | 24.1 | 29.6 | 0.8 | 2.1 | 278 | 79.1 |
| desktop | mezaparks | high | base | 232 | 99.3 | 31.2 | 38.1 | 28.8 | 74.8 | 6.3 | 44.1 | 7.4 | 20.5 | 24.2 | 30.0 | 0.8 | 2.3 | 288 | 109.8 |
| desktop | purvciems | low | base | 234 | 92.8 | 32.7 | 54.5 | 5.3 | 105.0 | 12.0 | 66.4 | 25.5 | 21.9 | 5.6 | 26.1 | 1.6 | 5.8 | 308 | 53.7 |
| desktop | purvciems | medium | base | 258 | 118.5 | 33.9 | 52.9 | 28.7 | 103.5 | 8.9 | 66.7 | 25.5 | 23.0 | 6.1 | 24.0 | 1.4 | 6.2 | 333 | 72.3 |
| desktop | purvciems | high | base | 280 | 133.7 | 34.6 | 59.5 | 38.2 | 106.1 | 9.2 | 69.3 | 26.3 | 23.1 | 6.6 | 26.4 | 1.4 | 5.9 | 349 | 110.3 |

### World build, phone: Pixel 5 profile 4x CPU (Chromium) and iPhone 13 (WebKit): ms (median of 3), per map x tier
| profile | map | tier | label | buildMs | ground-total | ground-prep | ground-tiles | ground-skirt | buildings-total | bld-pass1 | bld-geometry | bld-sights-treatment(in geometry) | bld-batch | traffic-roadnet | props-total | blockers | json-parse | longest | first frame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pixel5cpu | centrs | low | base | 3006 | 712.2 | 169.3 | 520.9 | 16.5 | 1903.5 | 78.1 | 1326.2 | 671.5 | 463.2 | 251.7 | 104.5 | 10.0 | 34.5 | 3273 | 169.5 |
| pixel5cpu | centrs | high | base | 3172 | 906.7 | 165.8 | 544.7 | 195.9 | 1887.4 | 79.3 | 1314.7 | 663.9 | 465.6 | 251.7 | 101.0 | 10.1 | 33.1 | 3424 | 224.9 |
| pixel5cpu | agenskalns | low | base | 1749 | 427.3 | 121.8 | 286.3 | 15.2 | 1145.3 | 59.1 | 849.7 | 457.6 | 194.9 | 48.8 | 98.7 | 9.2 | 26.3 | 2027 | 145.3 |
| pixel5cpu | agenskalns | high | base | 1871 | 583.3 | 119.5 | 293.7 | 166.1 | 1118.8 | 60.5 | 818.4 | 455.7 | 195.7 | 48.0 | 95.5 | 11.2 | 25.2 | 2145 | 186.2 |
| pixel5cpu | mezaparks | low | base | 812 | 256.9 | 117.8 | 118.0 | 15.4 | 326.7 | 31.6 | 190.0 | 31.9 | 84.8 | 99.9 | 112.0 | 3.8 | 7.4 | 1075 | 125.7 |
| pixel5cpu | mezaparks | high | base | 952 | 382.9 | 127.6 | 137.7 | 112.9 | 321.7 | 23.4 | 189.1 | 31.8 | 84.5 | 100.7 | 119.0 | 3.7 | 9.5 | 1218 | 168.4 |
| pixel5cpu | purvciems | low | base | 935 | 360.1 | 132.6 | 213.3 | 12.5 | 426.5 | 42.5 | 274.1 | 103.4 | 91.0 | 21.1 | 100.4 | 7.2 | 21.6 | 1207 | 121.4 |
| pixel5cpu | purvciems | high | base | 1063 | 501.8 | 131.2 | 230.4 | 136.9 | 418.5 | 35.1 | 275.9 | 103.9 | 90.3 | 21.2 | 95.2 | 6.2 | 21.6 | 1325 | 168.9 |
| iphone13 | centrs | low | base | 720 | 186.0 | 56.0 | 121.0 | 7.0 | 430.0 | 26.0 | 285.0 | 147.0 | 112.0 | 85.0 | 32.0 | 2.0 | 9.0 | 0 | 125.0 |
| iphone13 | centrs | high | base | 780 | 234.0 | 51.0 | 120.0 | 61.0 | 423.0 | 18.0 | 287.0 | 151.0 | 112.0 | 83.0 | 28.0 | 2.0 | 7.0 | 0 | 184.0 |
| iphone13 | agenskalns | low | base | 434 | 115.0 | 38.0 | 68.0 | 7.0 | 270.0 | 19.0 | 196.0 | 101.0 | 49.0 | 17.0 | 27.0 | 2.0 | 6.0 | 0 | 101.0 |
| iphone13 | agenskalns | high | base | 463 | 164.0 | 35.0 | 74.0 | 53.0 | 253.0 | 14.0 | 182.0 | 87.0 | 50.0 | 15.0 | 24.0 | 2.0 | 8.0 | 0 | 149.0 |
| iphone13 | mezaparks | low | base | 197 | 61.0 | 31.0 | 23.0 | 5.0 | 79.0 | 8.0 | 46.0 | 8.0 | 21.0 | 27.0 | 25.0 | 1.0 | 2.0 | 0 | 73.0 |
| iphone13 | mezaparks | high | base | 214 | 85.0 | 32.0 | 24.0 | 29.0 | 70.0 | 6.0 | 42.0 | 5.0 | 20.0 | 27.0 | 27.0 | 1.0 | 2.0 | 0 | 126.0 |
| iphone13 | purvciems | low | base | 214 | 82.0 | 35.0 | 41.0 | 5.0 | 100.0 | 13.0 | 61.0 | 20.0 | 23.0 | 6.0 | 21.0 | 1.0 | 4.0 | 0 | 73.0 |
| iphone13 | purvciems | high | base | 241 | 115.0 | 36.0 | 42.0 | 36.0 | 95.0 | 8.0 | 62.0 | 23.0 | 22.0 | 6.0 | 21.0 | 1.0 | 4.0 | 0 | 123.0 |

### Frame cost, desktop Chromium (real GPU): cpu ms (sim + render submit) | Mtri | draw calls, 8 holes
| map | tier | label | intro overview | r=3 | r=30 | r=90 | max zoom-out |
|---|---|---|---|---|---|---|---|
| centrs | low | base | 6.32 (0.35+5.98) \| 1.94 \| 2047 | 2.79 (0.77+2.02) \| 0.30 \| 122 | 2.04 (0.44+1.6) \| 0.53 \| 309 | 4.89 (0.45+4.44) \| 1.42 \| 1356 | 4.52 (0.45+4.07) \| 1.28 \| 1162 |
| centrs | medium | base | 6.88 (0.48+6.4) \| 2.89 \| 2048 | 3 (0.83+2.17) \| 0.62 \| 167 | 3 (0.73+2.27) \| 0.75 \| 310 | 5.85 (0.6+5.25) \| 2.09 \| 1358 | 5.56 (0.65+4.9) \| 1.91 \| 1163 |
| centrs | high | base | 6.85 (0.53+6.33) \| 2.89 \| 2048 | 3.16 (1+2.16) \| 0.61 \| 173 | 3.1 (0.73+2.37) \| 1.31 \| 531 | 5.74 (0.69+5.05) \| 2.09 \| 1358 | 5.14 (0.71+4.42) \| 1.91 \| 1163 |
| agenskalns | low | base | 6.06 (0.39+5.67) \| 2.00 \| 1859 | 3.57 (1.1+2.48) \| 0.30 \| 110 | 3.48 (0.73+2.73) \| 0.52 \| 317 | 5.35 (0.55+4.79) \| 1.70 \| 1428 | 5.17 (0.56+4.6) \| 1.59 \| 1256 |
| agenskalns | medium | base | 6.63 (0.5+6.13) \| 2.93 \| 1860 | 3.39 (0.94+2.46) \| 0.68 \| 170 | 3.66 (0.9+2.77) \| 0.73 \| 318 | 5.91 (0.62+5.31) \| 2.52 \| 1430 | 5.56 (0.62+4.94) \| 2.38 \| 1257 |
| agenskalns | high | base | 6.68 (0.66+5.99) \| 2.93 \| 1860 | 2.4 (0.83+1.57) \| 0.68 \| 172 | 3.37 (0.86+2.5) \| 1.43 \| 574 | 5.48 (0.84+4.68) \| 2.52 \| 1430 | 5.07 (0.73+4.28) \| 2.38 \| 1257 |
| mezaparks | low | base | 4.88 (0.45+4.44) \| 2.12 \| 1569 | 1.26 (0.53+0.73) \| 0.35 \| 113 | 1.76 (0.54+1.22) \| 0.61 \| 290 | 3.31 (0.57+2.73) \| 1.43 \| 955 | 3.63 (0.64+2.98) \| 1.27 \| 842 |
| mezaparks | medium | base | 5.68 (0.67+5.02) \| 2.58 \| 1570 | 4 (1.65+2.36) \| 0.74 \| 178 | 3.42 (1.31+2.11) \| 0.74 \| 288 | 4.74 (0.94+3.81) \| 1.84 \| 1011 | 4.51 (0.88+3.59) \| 1.72 \| 902 |
| mezaparks | high | base | 5.74 (0.82+4.92) \| 2.58 \| 1570 | 3.43 (1.7+1.73) \| 0.74 \| 177 | 3.62 (1.34+2.29) \| 1.49 \| 539 | 4.85 (1.12+3.74) \| 1.84 \| 1011 | 4.66 (1.1+3.57) \| 1.72 \| 902 |
| purvciems | low | base | 5.87 (0.57+5.3) \| 2.68 \| 1815 | 4.1 (1.95+2.15) \| 0.43 \| 107 | 3.71 (1.24+2.46) \| 0.76 \| 299 | 5.33 (0.83+4.49) \| 2.24 \| 1312 | 5.04 (0.8+4.23) \| 2.06 \| 1140 |
| purvciems | medium | base | 6.49 (0.82+5.67) \| 3.18 \| 1816 | 3.86 (1.83+2.04) \| 0.82 \| 150 | 3.71 (1.49+2.17) \| 0.88 \| 300 | 5.74 (1.04+4.69) \| 2.70 \| 1313 | 5.62 (1.13+4.5) \| 2.49 \| 1141 |
| purvciems | high | base | 6.67 (1.05+5.61) \| 3.18 \| 1816 | 3.84 (2.06+1.77) \| 0.86 \| 165 | 4.12 (1.75+2.39) \| 1.68 \| 546 | 5.77 (1.32+4.44) \| 2.55 \| 1231 | 5.57 (1.41+4.16) \| 2.42 \| 1143 |

### Frame cost, iPhone 13 emulation on WebKit (timer resolution 1 ms: sim / render split is noisy): cpu ms (sim + render submit) | Mtri | draw calls, 8 holes
| map | tier | label | intro overview | r=3 | r=30 | r=90 | max zoom-out |
|---|---|---|---|---|---|---|---|
| centrs | low | base | 4.34 (0.32+4.01) \| 1.94 \| 2047 | 3.87 (0.81+3.07) \| 0.28 \| 107 | 3.28 (0.68+2.6) \| 0.45 \| 238 | 3.05 (0.48+2.57) \| 0.85 \| 704 | 2.96 (0.43+2.53) \| 0.80 \| 620 |
| centrs | medium | base | 4.63 (0.35+4.3) \| 2.89 \| 2048 | 3.9 (1.09+2.83) \| 0.58 \| 159 | 3.17 (0.91+2.25) \| 0.64 \| 239 | 3.54 (0.79+2.77) \| 1.24 \| 705 | 3.24 (0.6+2.66) \| 1.17 \| 621 |
| centrs | high | base | 4.66 (0.41+4.15) \| 2.89 \| 2048 | 3.82 (1.3+2.52) \| 0.56 \| 158 | 3.91 (1.19+2.76) \| 1.39 \| 539 | 3.6 (0.85+2.64) \| 1.24 \| 705 | 3.3 (0.71+2.6) \| 1.17 \| 621 |
| agenskalns | low | base | 3.83 (0.34+3.5) \| 1.99 \| 1833 | 3.75 (0.9+2.87) \| 0.28 \| 111 | 3.36 (0.79+2.59) \| 0.42 \| 203 | 3.17 (0.6+2.57) \| 1.06 \| 791 | 3.03 (0.56+2.47) \| 1.00 \| 728 |
| agenskalns | medium | base | 4.21 (0.33+3.87) \| 2.92 \| 1834 | 3.87 (1.26+2.66) \| 0.65 \| 165 | 2.98 (0.86+2.14) \| 0.65 \| 214 | 3.57 (0.66+2.95) \| 1.53 \| 792 | 3.44 (0.62+2.83) \| 1.44 \| 729 |
| agenskalns | high | base | 4.3 (0.58+3.72) \| 2.92 \| 1834 | 3.89 (1.52+2.37) \| 0.65 \| 165 | 3.72 (1.23+2.56) \| 1.54 \| 576 | 3.7 (0.89+2.78) \| 1.53 \| 792 | 3.26 (0.63+2.66) \| 1.44 \| 729 |
| mezaparks | low | base | 3.75 (0.42+3.31) \| 2.12 \| 1569 | 4.03 (1.53+2.48) \| 0.31 \| 87 | 3.43 (1.15+2.28) \| 0.51 \| 213 | 3.03 (0.82+2.2) \| 0.92 \| 546 | 3.1 (0.72+2.42) \| 0.85 \| 490 |
| mezaparks | medium | base | 4.25 (0.68+3.57) \| 2.58 \| 1570 | 4.35 (1.55+2.8) \| 0.67 \| 148 | 3.38 (1.37+2) \| 0.62 \| 220 | 3.28 (0.93+2.26) \| 1.16 \| 564 | 3.02 (0.81+2.19) \| 1.05 \| 516 |
| mezaparks | high | base | 4.34 (0.65+3.74) \| 2.58 \| 1570 | 4.11 (2.11+2) \| 0.67 \| 148 | 3.87 (1.82+2.05) \| 1.49 \| 542 | 3.38 (1.1+2.28) \| 1.16 \| 564 | 3.21 (0.96+2.25) \| 1.05 \| 516 |
| purvciems | low | base | 4.12 (0.61+3.51) \| 2.68 \| 1815 | 3.29 (1.48+1.81) \| 0.40 \| 89 | 3.74 (1.46+2.17) \| 0.58 \| 205 | 3.21 (0.87+2.34) \| 1.38 \| 701 | 2.93 (0.71+2.23) \| 1.27 \| 623 |
| purvciems | medium | base | 4.42 (0.69+3.74) \| 3.18 \| 1816 | 3.75 (1.96+1.79) \| 0.78 \| 134 | 3.36 (1.8+1.6) \| 0.65 \| 206 | 3.59 (1.07+2.52) \| 1.64 \| 702 | 3.42 (0.91+2.42) \| 1.53 \| 624 |
| purvciems | high | base | 4.64 (0.86+3.78) \| 3.18 \| 1816 | 4.1 (2.46+1.64) \| 0.82 \| 149 | 4.19 (1.97+2.29) \| 1.73 \| 561 | 3.56 (1.15+2.39) \| 1.54 \| 631 | 3.6 (1.26+2.34) \| 1.39 \| 569 |

### Frame cost, Pixel 5 profile, 4x CPU throttle: cpu ms (sim + render submit) | Mtri | draw calls, 8 holes
| map | tier | label | intro overview | r=3 | r=30 | r=90 | max zoom-out |
|---|---|---|---|---|---|---|---|
| centrs | low | base | 24.28 (1.29+22.99) \| 1.94 \| 2047 | 2.96 (0.46+2.49) \| 0.28 \| 107 | 4.4 (0.68+3.72) \| 0.43 \| 224 | 9.5 (1.13+8.38) \| 0.84 \| 674 | 8.54 (0.94+7.6) \| 0.78 \| 592 |
| centrs | high | base | 29.05 (2.33+26.72) \| 2.89 \| 2048 | 5.27 (1.32+3.95) \| 0.56 \| 158 | 7.9 (1.62+6.24) \| 1.38 \| 531 | 11.75 (2.02+9.73) \| 1.23 \| 675 | 10.44 (1.8+8.62) \| 1.12 \| 593 |
| agenskalns | low | base | 22.36 (1.33+20.99) \| 1.99 \| 1830 | 3.23 (0.67+2.56) \| 0.28 \| 110 | 4.58 (0.72+3.86) \| 0.42 \| 205 | 11.05 (1.27+9.78) \| 1.03 \| 763 | 10.07 (1.14+8.84) \| 0.96 \| 693 |
| agenskalns | high | base | 25.75 (2.66+23.01) \| 2.92 \| 1831 | 6.03 (1.76+4.22) \| 0.65 \| 164 | 8.58 (2.14+6.37) \| 1.48 \| 553 | 13.09 (2.37+10.72) \| 1.49 \| 764 | 12.25 (2.3+9.89) \| 1.39 \| 694 |
| mezaparks | low | base | 16.72 (1.4+15.31) \| 2.12 \| 1569 | 2.34 (0.74+1.6) \| 0.32 \| 88 | 3.56 (0.84+2.73) \| 0.51 \| 221 | 6.62 (1.13+5.5) \| 0.90 \| 530 | 6.25 (1.13+5.12) \| 0.84 \| 480 |
| mezaparks | high | base | 19.64 (2.68+16.96) \| 2.58 \| 1570 | 4.43 (1.85+2.56) \| 0.67 \| 147 | 6.88 (2.41+4.42) \| 1.49 \| 540 | 9 (2.68+6.32) \| 1.14 \| 547 | 8.26 (2.42+5.85) \| 1.01 \| 498 |
| purvciems | low | base | 20.59 (1.82+18.76) \| 2.68 \| 1815 | 2.9 (1.03+1.78) \| 0.40 \| 89 | 3.99 (1.09+2.9) \| 0.58 \| 209 | 9.08 (1.65+7.44) \| 1.34 \| 671 | 8.41 (1.58+6.84) \| 1.22 \| 596 |
| purvciems | high | base | 26.62 (4.05+22.58) \| 3.18 \| 1816 | 6.04 (2.91+3.13) \| 0.82 \| 151 | 8.89 (3.52+5.37) \| 1.71 \| 549 | 12.36 (3.84+8.52) \| 1.50 \| 606 | 11.39 (3.75+7.64) \| 1.31 \| 546 |

### 60 s autoplay trace, desktop Chromium: frame interval ms (p50 / p95 / p99 / max), frames >33 ms, >50 ms, long tasks, cpu ms
| map | tier | label | p50 | p95 | p99 | max | >33 | >50 | long tasks | cpu (sim+render) | end radius |
|---|---|---|---|---|---|---|---|---|---|---|---|
| centrs | high | base | 16.7 | 16.7 | 16.8 | 33.4 | 2 | 0 | 0 | 3.85 (1.35+2.5) | 14.1 |
| centrs | low | base | 16.7 | 16.8 | 16.8 | 33.4 | 0 | 0 | 0 | 4.11 (1.27+2.83) | 14.1 |
| agenskalns | high | base | 16.7 | 16.8 | 16.8 | 33.4 | 1 | 0 | 0 | 3.77 (1.33+2.44) | 23.2 |
| agenskalns | low | base | 16.7 | 16.8 | 16.8 | 50 | 1 | 0 | 0 | 3.86 (1.18+2.67) | 20.2 |
| mezaparks | high | base | 16.7 | 16.8 | 16.8 | 33.4 | 1 | 0 | 0 | 3.78 (1.87+1.91) | 21.6 |
| mezaparks | low | base | 16.7 | 16.8 | 16.8 | 33.3 | 0 | 0 | 0 | 3.75 (1.62+2.12) | 29.3 |
| purvciems | high | base | 16.7 | 16.7 | 16.8 | 33.4 | 0 | 0 | 0 | 3.94 (2.24+1.7) | 7.2 |
| purvciems | low | base | 16.7 | 16.8 | 16.8 | 50 | 1 | 0 | 0 | 3.97 (1.9+2.06) | 7.8 |

### 60 s autoplay trace, iPhone 13 WebKit (low): frame interval ms (p50 / p95 / p99 / max), frames >33 ms, >50 ms, long tasks, cpu ms
| map | tier | label | p50 | p95 | p99 | max | >33 | >50 | long tasks | cpu (sim+render) | end radius |
|---|---|---|---|---|---|---|---|---|---|---|---|
| centrs | low | base | 17 | 19 | 19 | 70 | 2 | 2 | 0 | 2.99 (0.84+2.15) | 46.8 |
| agenskalns | low | base | 17 | 19 | 19 | 87 | 1 | 1 | 0 | 2.9 (0.86+2.04) | 80.1 |
| mezaparks | low | base | 17 | 19 | 19 | 81 | 3 | 3 | 0 | 2.72 (1.02+1.7) | 74.8 |
| purvciems | low | base | 17 | 19 | 19 | 71 | 3 | 3 | 0 | 3.14 (1.3+1.83) | 37.9 |

### 60 s autoplay trace, Pixel 5 4x CPU (low): frame interval ms (p50 / p95 / p99 / max), frames >33 ms, >50 ms, long tasks, cpu ms
| map | tier | label | p50 | p95 | p99 | max | >33 | >50 | long tasks | cpu (sim+render) | end radius |
|---|---|---|---|---|---|---|---|---|---|---|---|
| centrs | low | base | 16.7 | 16.7 | 16.8 | 83.3 | 1 | 1 | 1 | 4.15 (0.9+3.25) | 57.1 |
| agenskalns | low | base | 16.7 | 16.7 | 16.8 | 83.2 | 1 | 1 | 1 | 5.89 (1.34+4.55) | 83.9 |
| mezaparks | low | base | 16.7 | 16.8 | 16.8 | 83.4 | 4 | 3 | 3 | 4.44 (1.51+2.93) | 82.8 |
| purvciems | low | base | 16.7 | 16.8 | 16.8 | 83.3 | 2 | 2 | 2 | 3.16 (1.21+1.94) | 17.3 |

### Memory (desktop Chromium): JS heap after load -> after 3 rounds (MB); texture MB; geometry MB (computed from the scene); renderer.info counts
| map | tier | label | heap MB | tex MB | geo MB | textures / geometries | parts |
|---|---|---|---|---|---|---|---|
| centrs | low | base | 47.7 -> 49.7 | 63.1 | 40.8 | 10 / 35 | {"geo:other":2.1,"tex:ground":51,"tex:other":0,"geo:buildings(src)":36.5,"tex:batched":0.1,"geo:instances":2.2,"tex:detail":12.1} |
| centrs | medium | base | 62.2 -> 64.3 | 129.6 | 45.7 | 12 / 36 | {"geo:other":7,"tex:ground":104.1,"tex:other":0,"geo:buildings(src)":36.5,"tex:batched":0.1,"geo:instances":2.2,"rt:shadow":4,"tex:detail":21.4} |
| centrs | high | base | 62.3 -> 64.4 | 326.7 | 45.7 | 12 / 36 | {"geo:other":7,"tex:ground":289.2,"tex:other":0,"geo:buildings(src)":36.5,"tex:batched":0.1,"geo:instances":2.2,"rt:shadow":16,"tex:detail":21.4} |
| agenskalns | low | base | 46.2 -> 48.3 | 49.2 | 24.2 | 13 / 34 | {"geo:other":1.8,"tex:ground":37,"tex:other":0,"geo:buildings(src)":19.9,"tex:batched":0.1,"geo:instances":2.4,"tex:detail":12.1} |
| agenskalns | medium | base | 56 -> 58.5 | 101.1 | 28.6 | 15 / 36 | {"geo:other":6.3,"tex:ground":75.5,"tex:other":0,"geo:buildings(src)":19.9,"tex:batched":0.1,"geo:instances":2.4,"rt:shadow":4,"tex:detail":21.4} |
| agenskalns | high | base | 56 -> 58.2 | 247.9 | 28.6 | 15 / 36 | {"geo:other":6.3,"tex:ground":210.3,"tex:other":0,"geo:buildings(src)":19.9,"tex:batched":0.1,"geo:instances":2.4,"rt:shadow":16,"tex:detail":21.4} |
| mezaparks | low | base | 29 -> 31.1 | 49.6 | 12.5 | 11 / 36 | {"geo:other":1.9,"tex:ground":37.5,"tex:other":0,"geo:buildings(src)":7.5,"tex:batched":0,"geo:instances":3.1,"tex:detail":12.1} |
| mezaparks | medium | base | 32.3 -> 34.2 | 105.2 | 13.5 | 10 / 37 | {"geo:other":2.9,"tex:ground":79.7,"tex:other":0,"geo:buildings(src)":7.5,"tex:batched":0,"geo:instances":3.1,"rt:shadow":4,"tex:detail":21.4} |
| mezaparks | high | base | 32.3 -> 34.2 | 259.5 | 13.5 | 10 / 37 | {"geo:other":2.9,"tex:ground":222,"tex:other":0,"geo:buildings(src)":7.5,"tex:batched":0,"geo:instances":3.1,"rt:shadow":16,"tex:detail":21.4} |
| purvciems | low | base | 38.4 -> 40.5 | 51.7 | 12 | 8 / 29 | {"geo:other":1.9,"tex:ground":39.6,"tex:other":0,"geo:buildings(src)":7.7,"tex:batched":0.1,"geo:instances":2.3,"tex:detail":12.1} |
| purvciems | medium | base | 45.1 -> 47.1 | 106.3 | 14.6 | 10 / 30 | {"geo:other":4.6,"tex:ground":80.8,"tex:other":0,"geo:buildings(src)":7.7,"tex:batched":0.1,"geo:instances":2.3,"rt:shadow":4,"tex:detail":21.4} |
| purvciems | high | base | 45.2 -> 47.1 | 256.6 | 14.6 | 12 / 30 | {"geo:other":4.6,"tex:ground":219.1,"tex:other":0,"geo:buildings(src)":7.7,"tex:batched":0.1,"geo:instances":2.3,"rt:shadow":16,"tex:detail":21.4} |

### What a wide view costs (desktop, high): cpu ms / Mtri / calls with one class hidden
| map | view | label | all | no trees | no props | no buildings | no ground | no shadow |
|---|---|---|---|---|---|---|---|---|
| centrs | intro | base | 6.96 / 2.89 / 2048 | 5.91 / 1.50 / 1767 | 2.1 / 1.90 / 406 | 7.16 / 2.46 / 2046 | 6.93 / 2.84 / 1946 | 6.65 / 2.89 / 2048 |
| centrs | r30 | base | 3.93 / 1.44 / 600 | 3.78 / 0.82 / 514 | 3.18 / 0.83 / 133 | 3.73 / 1.20 / 547 | 3.94 / 1.27 / 513 | 3.63 / 0.88 / 377 |
| centrs | zoomout | base | 5.81 / 1.89 / 1159 | 4.96 / 1.02 / 1003 | 2.69 / 1.14 / 237 | 5.07 / 1.46 / 953 | 5.14 / 1.59 / 872 | 4.98 / 1.63 / 933 |
| agenskalns | intro | base | 6.54 / 2.93 / 1860 | 5.6 / 1.47 / 1622 | 2.16 / 1.77 / 345 | 6.58 / 2.70 / 1858 | 6.49 / 2.89 / 1776 | 6.28 / 2.93 / 1860 |
| agenskalns | r30 | base | 4.19 / 1.66 / 654 | 3.88 / 0.87 / 547 | 3.17 / 0.94 / 158 | 3.83 / 1.36 / 585 | 4.11 / 1.39 / 554 | 3.82 / 0.93 / 391 |
| agenskalns | zoomout | base | 5.57 / 2.38 / 1254 | 4.9 / 1.12 / 1044 | 2.49 / 1.31 / 233 | 5.17 / 1.96 / 1039 | 5.22 / 2.02 / 970 | 5.14 / 2.07 / 1029 |
| mezaparks | intro | base | 5.71 / 2.58 / 1570 | 5.21 / 1.58 / 1353 | 2.95 / 1.12 / 324 | 5.72 / 2.50 / 1568 | 5.76 / 2.57 / 1486 | 5.7 / 2.58 / 1570 |
| mezaparks | r30 | base | 3.75 / 1.62 / 590 | 3.61 / 0.96 / 477 | 2.94 / 0.71 / 160 | 3.56 / 1.51 / 564 | 3.73 / 1.49 / 523 | 3.99 / 0.87 / 339 |
| mezaparks | zoomout | base | 4.65 / 1.71 / 900 | 4.07 / 0.96 / 765 | 3.45 / 0.82 / 209 | 4.35 / 1.56 / 820 | 4.36 / 1.57 / 763 | 4.4 / 1.58 / 814 |
| purvciems | intro | base | 6.52 / 3.18 / 1816 | 5.87 / 2.40 / 1683 | 2.89 / 0.92 / 239 | 6.58 / 3.08 / 1814 | 6.48 / 3.15 / 1732 | 6.44 / 3.18 / 1816 |
| purvciems | r30 | base | 4.28 / 1.86 / 613 | 4.26 / 1.48 / 561 | 3.67 / 0.36 / 93 | 3.99 / 1.69 / 553 | 4.11 / 1.65 / 524 | 4.12 / 1.05 / 367 |
| purvciems | zoomout | base | 5.53 / 2.42 / 1141 | 5.3 / 1.77 / 1059 | 3.27 / 0.75 / 163 | 5.41 / 2.28 / 1010 | 5.35 / 2.27 / 938 | 5.42 / 2.29 / 993 |
