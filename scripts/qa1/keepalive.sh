#!/bin/zsh
cd /Users/oskars/projects/holeio
while true; do
  if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:8801/; then
    echo "$(date +%T) restart" >> scripts/qa1/keepalive.log
    pkill -f "scripts/qa1/server2.mjs" 2>/dev/null
    nohup node scripts/qa1/server2.mjs >> scripts/qa1/server2.log 2>&1 &
    sleep 25
  fi
  sleep 4
done
