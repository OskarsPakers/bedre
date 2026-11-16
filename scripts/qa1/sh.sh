#!/bin/zsh
# sh.sh out.png prefix N  -> sheet of N evenly-spaced files matching prefix*
cd /Users/oskars/projects/holeio/scripts/out
out=$1; pre=$2; n=$3
files=(${(f)"$(ls ${pre}*.png | grep -v sheet)"})
tot=${#files}; sel=()
for ((i=0;i<n;i++)); do idx=$(( 1 + i*(tot-1)/(n>1?n-1:1) )); sel+=($files[$idx]); done
node ../qa1/sheet.mjs $out $sel; echo $sel
