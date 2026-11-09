#!/bin/bash
# Build the Mac helper (native host) and register it with Chrome.
# Needs macOS 14.2+ and the Xcode command line tools (xcode-select --install).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
swiftc -O host/*.swift -o build/musicduck-host
DEV_ID=aedaaoejknlhpfaokkgbdflpeelkhnfc   # unpacked build, fixed by "key" in extension/manifest.json
STORE_ID=""                               # Chrome Web Store build; set once the store assigns it
ORIGINS="\"chrome-extension://$DEV_ID/\""
[ -n "$STORE_ID" ] && ORIGINS="$ORIGINS, \"chrome-extension://$STORE_ID/\""
DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
cat > "$DIR/com.felix.musicduck.json" <<JSON
{
  "name": "com.felix.musicduck",
  "description": "Music Duck audio watcher",
  "path": "$PWD/build/musicduck-host",
  "type": "stdio",
  "allowed_origins": [$ORIGINS]
}
JSON
echo "Helper installed. Reload the Music Duck extension and your YouTube Music tab."
