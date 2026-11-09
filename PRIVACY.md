# Music Duck privacy policy

_Last updated: 2026-11-09_

Music Duck does not collect, store, sell, or transmit any personal data.

- **No network requests.** The extension and the Mac helper never contact any server.
- **No browsing data.** The extension doesn't request the "tabs" permission. It can't see the addresses or titles of your other tabs; Chrome only tells it whether a tab is playing sound. It runs only on music.youtube.com, where it adjusts the playback volume.
- **Audio stays on your device.** The optional Mac helper measures how loud other apps are. It reads their audio only to compute a loudness number, then discards it. The audio is never recorded, saved, or sent anywhere. The helper passes only app names and loudness numbers to the extension, over Chrome's local native-messaging connection.
- **Local log.** The helper writes a diagnostics log (timestamps, app names, volume levels) to `~/Library/Logs/music-duck.log` on your Mac. It never leaves your Mac; you can delete it at any time.

Questions: open an issue at https://github.com/negentropi/music-duck/issues.
