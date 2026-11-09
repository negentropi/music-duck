#!/bin/bash
# Zip the extension for the Chrome Web Store. The store assigns its own ID and
# rejects the "key" field, so it's stripped here (the repo keeps it for a stable
# unpacked ID that the Mac helper trusts).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(jq -r .version extension/manifest.json)
OUT="$PWD/build/music-duck-$VERSION.zip"
STAGE=$(mktemp -d)
cp -R extension/. "$STAGE"
jq 'del(.key)' extension/manifest.json > "$STAGE/manifest.json"
mkdir -p build && rm -f "$OUT"
(cd "$STAGE" && zip -qrX "$OUT" . -x '.*')
echo "$OUT"
