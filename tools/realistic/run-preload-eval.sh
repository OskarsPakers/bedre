#!/bin/sh
# before (legacy=1) vs after (predictive) on both prepared routes; pos = screenshots at fixed track positions (+ metrics), trace = frame times + camera-switch tests
cd "$(dirname "$0")"
for R in centrs-3 centrs-1; do
  node verify2.mjs $R balanced before pos 1 60
  node verify2.mjs $R balanced after pos 0 60
  SECS=260 node verify2.mjs $R balanced before trace 1
  node verify2.mjs $R balanced after trace 0
done
