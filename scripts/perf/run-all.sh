#!/bin/bash
# usage: scripts/perf/run-all.sh <label> <dist> [part ...]   parts: load build frame mem trace breakdown (default: all)
# Everything runs on port 5185 (PERF_PORT) with the real GPU; logs to docs/perf/data/<label>.log
cd "$(dirname "$0")/../.."
L=$1; D=$2; shift 2
PARTS="${@:-load build frame mem trace breakdown}"
export PERF_PORT=5185 GPU=1
P="node scripts/perf-pass.mjs"
LOG=docs/perf/data/$L.log
for part in $PARTS; do
  echo "=== $part $(date +%T)" >> $LOG
  case $part in
    load) $P load --dist $D --label $L --profiles desktop,pixel5,iphone13 --runs 3 >> $LOG 2>&1 ;;
    build) $P build --dist $D --label $L --profiles desktop --tiers low,medium,high --runs 3 >> $LOG 2>&1
           $P build --dist $D --label $L --profiles pixel5cpu,iphone13 --tiers low,high --runs 3 --merge --suffix -phone >> $LOG 2>&1 ;;
    frame) $P frame --dist $D --label $L --profiles desktop,iphone13 --tiers low,medium,high --runs 3 >> $LOG 2>&1
           $P frame --dist $D --label $L --profiles pixel5cpu --tiers low,high --runs 2 --suffix -pixel5cpu >> $LOG 2>&1 ;;
    mem) $P mem --dist $D --label $L --profiles desktop --tiers low,medium,high >> $LOG 2>&1 ;;
    trace) $P trace --dist $D --label $L --profiles desktop --tiers high,low >> $LOG 2>&1
           $P trace --dist $D --label $L --profiles iphone13 --tiers low --suffix -iphone >> $LOG 2>&1
           $P trace --dist $D --label $L --profiles pixel5cpu --tiers low --suffix -pixel5cpu >> $LOG 2>&1 ;;
    breakdown) $P breakdown --dist $D --label $L --profiles desktop --tiers high >> $LOG 2>&1 ;;
  esac
done
echo "=== ALL DONE $(date +%T)" >> $LOG
