#!/bin/sh
# restore the pre-mapfix riga.json + ground png from tools/.cache/mapfix-before (local backup of the data before this pipeline ran), then re-run: trees -> buildings -> shapes
cd "$(dirname "$0")/../.."
B=tools/.cache/mapfix-before/data
cp $B/riga.json $B/riga-ground.png public/data/
for m in agenskalns mezaparks purvciems; do cp $B/$m/riga.json $B/$m/riga-ground.png public/data/$m/; done
