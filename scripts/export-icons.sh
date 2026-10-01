#!/bin/sh
# Dev-only: render icons/icon.svg to the PNG sizes in manifest.json using headless Chrome.
# Usage: scripts/export-icons.sh   (from anywhere; set CHROME to override the browser path)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SVG="$ROOT/icons/icon.svg"
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for size in 16 32 48 128; do
  # Render the vector at each exact size (sharper than downscaling one large PNG).
  cat > "$TMP/icon.html" <<HTML
<!doctype html>
<style>html, body { margin: 0; background: transparent; } img { display: block; width: ${size}px; height: ${size}px; }</style>
<img src="file://$SVG">
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --default-background-color=00000000 --force-device-scale-factor=1 \
    --window-size="$size,$size" --virtual-time-budget=1000 \
    --screenshot="$ROOT/icons/icon-$size.png" "file://$TMP/icon.html" >/dev/null 2>&1
  echo "icons/icon-$size.png"
done
