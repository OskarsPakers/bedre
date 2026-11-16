#!/bin/sh
# Full map-fix pipeline from the pre-fix data backup (tools/.cache/mapfix-before): riga.json + ground png -> trees / canopy -> buildings -> shapes (spike filter) -> placements.
# Needs the qa-map DSM rasters (node tools/qa-map/dsm-full.mjs <map> 1.0 1) and tools/.cache/qa-map/{bld,missing}-<map>.json.
set -e
cd "$(dirname "$0")/../.."
tools/mapfix/reset.sh
node tools/mapfix/trees.mjs
node tools/mapfix/buildings.mjs
for m in centrs agenskalns mezaparks purvciems; do (cd tools/detail && node build-meshes.mjs --map=$m | tail -1 | cut -c1-120); done
GPU=1 MP_TABLE_PORT=5183 npm run build:mp
