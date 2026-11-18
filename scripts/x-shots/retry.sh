#!/bin/zsh
# retry.sh <attempts> <shoot args...> : re-run a session until the sights it needs survived the (bot-driven) growth phase
n=$1; shift
for i in $(seq 1 $n); do node scripts/x-shots/shoot.mjs "$@" && exit 0; [ $? -eq 3 ] || exit 1; echo "retry $i"; done
