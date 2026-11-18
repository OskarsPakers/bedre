#!/bin/zsh
# v2: normal 5:00 round (no ?time=), shoot within the first ~2 min of the clock
cd /Users/oskars/projects/holeio
R=scripts/x-shots/retry.sh
O=scripts/out/x-shots/candidates/v2
FM='[{"tag":"fm","r":9,"need":["freedom"],"start":[12,30],"avoid":[[0,0,40]],"dir":[-1,0],"frames":12,"passes":2}]'
FMB='[{"tag":"fmB","r":9,"need":["freedom"],"start":[6,16],"avoid":[[0,0,15]],"dir":[-1,0.3],"frames":10,"passes":1}]'
RA='[{"tag":"rats","r":12,"need":[["Svētā Pētera baznīca",-243,444],["Melngalvju nams",-388,486]],"start":[-335,548],"avoid":[[-243,444,45],[-390,470,50]],"frames":14,"passes":2}]'
NAT='[{"tag":"nat","r":12,"need":[["Kristus Piedzimšanas pareizticīgo katedrāle",137,-271]],"start":[137,-233],"zoom":0.9,"avoid":[[137,-271,45]],"frames":14,"passes":2}]'
DOMA='[{"tag":"doma","r":14,"need":[["Rīgas Doms",-518,268]],"start":[-505,350],"avoid":[[-518,268,60]],"frames":14,"passes":2}]'
$R 8 $FM nov18 1600x900 2 $O none
$R 8 $FM day 1600x900 2 $O none
$R 8 $RA day 1600x900 2 $O none
$R 8 $NAT day 1600x900 2 $O none
$R 8 $DOMA day 1600x900 2 $O none
for sz in 1080x1080 1080x1350; do $R 8 $FMB nov18 $sz 1 $O-$sz none; $R 8 $RA day $sz 1 $O-$sz none; done
echo ALLDONE
