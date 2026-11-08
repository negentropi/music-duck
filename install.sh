#!/bin/bash
# Build the native host and register it with Chrome.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
swiftc -O host/*.swift -o build/musicduck-host
EXT_ID=aedaaoejknlhpfaokkgbdflpeelkhnfc # fixed by "key" in extension/manifest.json
DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
cat > "$DIR/com.felix.musicduck.json" <<EOF
{
  "name": "com.felix.musicduck",
  "description": "Music Duck audio watcher",
  "path": "$PWD/build/musicduck-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
echo "host installed. Load unpacked: $PWD/extension"
