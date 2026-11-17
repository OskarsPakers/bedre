# Perf pass: candidate changes, ranking, decision

Ranked by (measured or estimated gain) / effort. Gains refer to the baseline in `baseline.md`.

| # | Candidate | Evidence (baseline) | Gain | Effort | Risk | Visual | Decision |
|---|---|---|---|---|---|---|---|
| 1 | Distance LOD of props (tiny static kinds thin out, trees use the phone crown, beyond ~450 m camera distance) | whole-city view: 2048 calls / 2.9-3.2 Mtri, 6-7 ms cpu desktop, 24 ms on Pixel 5 4x; props = 55 % of cpu and 65-80 % of triangles; people alone 1.1 Mtri on Purvciems | intro / r90 / zoom-out -35..45 % cpu, -50 % tris, -55 % calls | small (one function + 2 hooks) | low | far views only | DONE |
| 2 | `neighbourRef` partial selection instead of hypot + full sort per sight | 160 ms desktop / 670 ms Pixel 5 on the Centre (50 % of building geometry) | -150 / -600 ms | tiny | none (identical wall colours, checked) | none | DONE |
| 3 | `cornerHeights` triangle bbox reject | 75 ms desktop / 330 ms phone in the building batch step | -65 / -260 ms | tiny | none (geometry hashes identical) | none | DONE |
| 4 | Service worker: no more Centre precache for every first visit; cache the map actually played | cold visit to a district downloaded +2.6 MB (Centre files) in the background | -2.6 MB first-visit data on non-Centre maps | small | low (offline for the played map kept) | none | DONE |
| 5 | Close-up ground repaint: `smoothRasterWindow` squared distance + no per-pixel fill, ring bbox cache | repaint 31-47 ms desktop every ~22 m while the hole is small (early game): a visible hitch, 100 ms+ on phones | repaint ~-60 % | small | none | boundary pixels only (ties) | DONE |
| 6 | `prep` raster to colour canvas with a 32-bit LUT; `attachStops` bbox skip | ground-prep 41 ms / 170 ms phone; roadnet 62 / 250 | -20 / -90 ms; -10 / -50 ms | tiny | none | none | DONE |
| 7 | Coarser render chunks for tiny kinds (merge 250 m meshes) | 1923 meshes -> 783 | wide views -40 %, but gameplay triangles +40-60 % | small | low | none | TRIED, REVERTED (LOD wins without the gameplay triangle cost) |
| 8 | Crop the raster `drawImage` per ground tile | ground-tiles 125 ms | 0 (measured 94.7 vs 96.1) | tiny | - | - | TRIED, REVERTED |
| 9 | Far movers update every 3rd frame | traffic.update ~0.7-0.9 ms/frame (of 1.3-2.2 ms sim) | ~0.3-0.5 ms | medium (car-following consistency) | medium | none | NOT DONE (see results) |
| 10 | Worker for geometry building, yielding the loader | build 3.0 s on Pixel 5 (centre) = frozen loader | responsive loader | large | high | none | NOT DONE (architecture change) |
| 11 | Recompress shapes / objects / ground with a better codec | brotli-11 would save 10-15 % of 1.1 MB / 0.32 MB, ground PNG already 4-bit palette, re-deflate 9 gives 0 % | 150-250 KB | needs a client decoder (no brotli in DecompressionStream) | medium | none | NOT DONE |
| 12 | Drop unused riga.json fields / quantise | all fields are read at runtime (ground painting, traffic, labels) | maybe 10 % of 766 KB | medium + verification | medium | possible | NOT DONE |
| 13 | Immutable hashed data URLs | with the SW (production) repeat visits already cost 0 bytes; without it a 304 per file after 1 h | ~0 | small | low | none | NOT DONE (no measurable gain) |
| 14 | Frame-update shadow map every 2nd frame | shadow pass faded out already at wide zoom; casters move every frame | small | small | visible shimmer | - | NOT DONE |
