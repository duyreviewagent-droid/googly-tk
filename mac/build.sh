#!/bin/bash
# Builds "Googly TK.app": the whole game packed inside a native Mac window (plays offline).
# The icon is mac/icon-1024.png (drawn by the game itself: open the page with ?icon=1).
set -euo pipefail
cd "$(dirname "$0")"
APP="../Googly TK.app"
BIN="$APP/Contents/MacOS/GooglyTK"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -target "$(uname -m)-apple-macos13.0" main.swift -o "$BIN" -framework Cocoa -framework WebKit 2>&1 | grep -v warning || true
[ -f "$BIN" ] || { echo "Build failed"; exit 1; }
cp Info.plist "$APP/Contents/Info.plist"
cp -R ../web/public "$APP/Contents/Resources/web"
SET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s icon-1024.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) icon-1024.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --deep -s - "$APP" >/dev/null 2>&1
touch "$APP"
echo "Built $(cd .. && pwd)/Googly TK.app"
