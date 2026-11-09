# Chrome Web Store listing

Paste these into the developer dashboard. Images are in `store/`.

## Store listing tab

**Name:** Music Duck

**Summary** (from manifest, 124/132 chars): Automatically lowers YouTube Music while other audio plays (videos, calls, other apps), then brings it back when they stop.

**Category:** Tools · **Language:** English

**Description:**

```
Your music gets out of the way when something else needs to be heard.

Music Duck automatically lowers YouTube Music while any other sound plays: a video in another tab, a voice message, a call. When that sound stops, the music fades back in. No reaching for the volume slider, and YouTube Music's own volume setting stays exactly where you left it.

HOW IT WORKS
• Another tab starts playing → your music drops by 67%
• It stops → the music fades back in over 0.75 seconds
• Smooth fades, no sudden jumps, even when songs change

GO FURTHER ON MAC (optional, free, open source)
Install the small Music Duck helper and it also ducks for apps outside Chrome: Zoom, FaceTime, Spotify, games, anything. It measures how loud each app is (in LUFS, the loudness scale streaming services use) and sets your music 67% below it, so the quietest voice in the room still comes through. Setup: github.com/negentropi/music-duck

PRIVATE BY DESIGN
• Collects nothing, sends nothing, makes no network requests
• Can't see your other tabs' addresses or titles. Chrome only tells it whether a tab is playing sound
• Runs only on music.youtube.com
• Open source: github.com/negentropi/music-duck

Music Duck is an independent project, not affiliated with or endorsed by Google or YouTube.
```

**Images:**
- Icon: `extension/icons/128.png`
- Screenshots (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`, `store/screenshot-3.png`
- Small promo tile (440×280): `store/promo-small.png`
- Marquee (1400×560, optional): `store/promo-marquee.png`

**Additional fields:**
- Homepage URL: https://github.com/negentropi/music-duck
- Support URL: https://github.com/negentropi/music-duck/issues

## Privacy tab

**Single purpose:** Automatically lowers the volume of YouTube Music while other audio is playing, and restores it when that audio stops.

**Permission justifications:**
- `nativeMessaging`: Connects to the optional, user-installed Music Duck Mac helper, which reports which other Mac apps are playing sound and how loud they are, so the music can be lowered relative to them. The connection is local; no data leaves the device.
- Host permission `https://music.youtube.com/*`: Needed to adjust the playback volume of the YouTube Music player, and to tell the YouTube Music tab apart from other tabs that are playing sound.

**Remote code:** No, I am not using remote code.

**Data usage:** check none of the data types. Certify all three disclosures (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/negentropi/music-duck/blob/main/PRIVACY.md

## Distribution tab

Public · All regions · Free

## Store item

ID `klfcklmbgfkhjjjlmmmfgdegmaojoagh` (already in `STORE_ID` in `install.sh`).
