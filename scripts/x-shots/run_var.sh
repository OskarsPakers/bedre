#!/bin/zsh
cd /Users/oskars/projects/holeio
R=scripts/x-shots/retry.sh
FM='[{"tag":"fm","r":9,"need":["freedom"],"start":[12,30],"avoid":[[0,0,40]],"dir":[-1,0],"frames":12,"passes":2}]'
RA='[{"tag":"rats","r":12,"need":[["Svētā Pētera baznīca",-243,444],["Melngalvju nams",-388,486]],"start":[-335,548],"avoid":[[-243,444,45],[-390,470,50]],"frames":14,"passes":2}]'
for th in evening nov18; do $R 6 $FM $th 1600x900 2; $R 6 $RA $th 1600x900 2; done
for sz in 1080x1080 1080x1350; do $R 6 $FM day $sz 1 scripts/out/x-shots/candidates/burst-$sz; $R 6 $RA day $sz 1 scripts/out/x-shots/candidates/burst-$sz; done
echo ALLDONE
