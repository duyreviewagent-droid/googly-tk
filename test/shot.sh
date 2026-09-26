#!/bin/zsh
# test/shot.sh OUT.png "query" [w h budget maxsec] — headless Chrome screenshot (serves web/public on :8123)
cd "$(dirname "$0")/.."
curl -s localhost:8123/health >/dev/null || { PORT=8123 node web/server.js >/dev/null 2>&1 & sleep 0.6; }
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
rm -f $1; caffeinate -u -t ${6:-200} &
"$CH" --headless=new --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=${3:-1280},${4:-800} --virtual-time-budget=${5:-9000} --user-data-dir=$(mktemp -d) --screenshot=$1 "http://localhost:8123/?shim=1&$2" >/dev/null 2>&1 &
pid=$!
for i in $(seq 1 ${6:-200}); do [ -s $1 ] && sleep 1 && break; sleep 1; done
pkill -P $pid 2>/dev/null; kill $pid 2>/dev/null
[ -s $1 ] && echo "wrote $1" || echo "TIMEOUT $1"
