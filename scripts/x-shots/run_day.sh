#!/bin/zsh
# first-pass candidate sweep (day theme, 1600x900 @2x). Output: scripts/out/x-shots/candidates/burst/<tag>-day-p<pass>-<frame>-f<falling>.png
cd /Users/oskars/projects/holeio
R=scripts/x-shots/retry.sh
A='day 1600x900 2'
$R 6 '[{"tag":"fm","r":9,"need":["freedom"],"start":[12,30],"avoid":[[0,0,40]],"dir":[-1,0],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"nat","r":12,"need":[["Kristus Piedzimšanas pareizticīgo katedrāle",137,-271]],"start":[137,-233],"zoom":0.9,"avoid":[[137,-271,45]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"rats","r":12,"need":[["Svētā Pētera baznīca",-243,444],["Melngalvju nams",-388,486]],"start":[-335,548],"avoid":[[-243,444,45],[-390,470,50]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"doma","r":14,"need":[["Rīgas Doms",-518,268]],"start":[-505,350],"avoid":[[-518,268,60]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"opera","r":14,"need":[["Nacionālā opera",84,232]],"start":[95,318],"avoid":[[84,240,70]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"mkt","r":25,"need":[["Zivju paviljons",24,910],["Zinātņu akadēmija",535,937]],"start":[330,990],"zoom":0.9,"avoid":[[130,850,200],[535,937,60]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"lib","r":25,"need":[["Latvijas Nacionālā bibliotēka",-1009,1163]],"start":[-1000,1300],"avoid":[[-1009,1163,90]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"castle","r":30,"need":[["Rīgas pils",-644,12],["Rīgas Doms",-518,268]],"start":[-650,130],"zoom":1.1,"avoid":[[-644,12,50]],"frames":14,"passes":2}]' $=A
$R 6 '[{"tag":"old","r":45,"need":[["Svētā Pētera baznīca",-243,444],["Rīgas Doms",-518,268],["Svētā Jēkaba katedrāle",-522,76]],"start":[-330,780],"zoom":0.85,"avoid":[[-243,444,80],[-518,268,80]],"frames":14,"passes":2}]' $=A
echo ALLDONE
