<img src="extension/icons/128.png" width="96" alt="Music Duck icon">

# Music Duck

Your music gets out of the way when something else needs to be heard.

Music Duck lowers **YouTube Music** in Chrome while any other sound plays: a video in another tab, a call, a voice message, a game. When that sound stops, the music fades back in. You never touch the volume slider, and YouTube Music's own volume setting stays exactly where you left it.

"Ducking" is the audio-engineering term for this: radio and podcasts lower the music under a voice the same way.

## How much it lowers

- **Another Chrome tab plays:** music drops by 67% (about −9.6 dB).
- **Another Mac app plays** (with the optional Mac helper): Music Duck measures how loud that app is and sets the music 67% below it. If several apps play, it follows the quietest one, so nothing gets drowned out. If the music is already quieter than that, it's left alone.
- **It stops:** music fades back up over 0.75 s.

Loudness is measured in LUFS (ITU-R BS.1770), the same scale streaming services use to match volume across songs. The music's own loudness is measured inside the tab; it's never counted as one of the "other" sounds.

## Install

1. **Extension:** install [Music Duck from the Chrome Web Store](https://chromewebstore.google.com/detail/klfcklmbgfkhjjjlmmmfgdegmaojoagh) (in review), or load it unpacked:
   open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension` folder.
2. **Optional Mac helper** (needed to duck for apps outside Chrome, e.g. Zoom, FaceTime, Spotify, games). macOS 14.2 or later, plus the Xcode command line tools (`xcode-select --install`):

   ```sh
   git clone https://github.com/negentropi/music-duck.git
   cd music-duck
   ./install.sh
   ```

   Then reload the extension in `chrome://extensions` and reload your YouTube Music tab.

Without the helper, Music Duck still ducks for other Chrome tabs, on any OS.

## How it works

- **Extension** (`extension/`): routes the YouTube Music player through Web Audio and adjusts a gain stage after it. That's why YouTube's own volume slider never moves. It watches Chrome's "this tab is playing sound" flag for other tabs and meters the music's loudness.
- **Mac helper** (`host/`): a small Swift program Chrome starts through [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). It listens to Core Audio for apps that start or stop playing, and measures each one's loudness with a Core Audio process tap. It sends the extension only the app names and a loudness number. System sounds such as the volume-key click are ignored.

Detection takes about half a second, and the music starts coming back about 0.8 s after the other sound stops. A timestamped log is written to `~/Library/Logs/music-duck.log`.

## Privacy

Music Duck collects nothing and sends nothing anywhere. See [PRIVACY.md](PRIVACY.md).

## Development

```sh
npx @puppeteer/browsers install chrome@stable     # Chrome for Testing (branded Chrome can't load test extensions)
npm i puppeteer-core
CHROME="/path/to/Google Chrome for Testing" node test/e2e-lufs.mjs        # loudness math (headless)
CHROME="/path/to/Google Chrome for Testing" node test/e2e-other-tab.mjs   # other-tab ducking (off-screen window)
CHROME="/path/to/Google Chrome for Testing" node test/e2e-youtube-music.mjs  # real YouTube Music (needs ./install.sh first)
./scripts/pack.sh                                  # store zip -> build/music-duck-<version>.zip
```

## License

[MIT](LICENSE)
