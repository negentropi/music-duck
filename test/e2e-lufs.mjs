// E2E: relative ducking math on a known-loudness tone served as music.youtube.com.
// Tone = 330 Hz stereo sine at -20 dBFS RMS = -17.8 LUFS (ffmpeg ebur128).
// Usage: CHROME=/path/to/Chrome\ for\ Testing node test/e2e-lufs.mjs
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const ext = fileURLToPath(new URL('../extension', import.meta.url));
const b = await puppeteer.launch({
  executablePath: process.env.CHROME, headless: 'new', pipe: true, enableExtensions: [ext],
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await (await b.waitForTarget((t) => t.type() === 'service_worker')).worker();
// Cut off any real native host (it would report this Mac's real audio over the fake
// state) and stop the reconnect loop.
await sw.evaluate(() => { connectHost = () => {}; port?.disconnect(); });
const p = await b.newPage();
await p.setRequestInterception(true);
const page = `<script>
  const fs = 48000, a = 10 ** (-20 / 20) * Math.SQRT2, n = fs * 30;
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) pcm[2 * i] = pcm[2 * i + 1] = Math.round(a * 32767 * Math.sin(2 * Math.PI * 330 * i / fs));
  const hdr = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => hdr.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); hdr.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVEfmt '); hdr.setUint32(16, 16, true); hdr.setUint16(20, 1, true);
  hdr.setUint16(22, 2, true); hdr.setUint32(24, fs, true); hdr.setUint32(28, fs * 4, true); hdr.setUint16(32, 4, true); hdr.setUint16(34, 16, true);
  w(36, 'data'); hdr.setUint32(40, pcm.byteLength, true);
  const el = new Audio(URL.createObjectURL(new Blob([hdr, pcm], { type: 'audio/wav' }))); el.id = 'm'; document.documentElement.append(el); el.play();
</script>`;
p.on('request', (r) => (r.url().startsWith('https://music.youtube.com/') ? r.respond({ contentType: 'text/html', body: page }) : r.continue()));
await p.goto('https://music.youtube.com/watch');
await sleep(4000);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://music.youtube.com/*' }))[0].id);
const probe = () => sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { probe: true }), tabId);
const other = (lufs, tab = false) => sw.evaluate((lufs) => { otherApps = lufs === undefined ? [] : ['fake-app']; quietestLufs = lufs ?? null; update(); }, lufs);

let fail = 0;
const near = (name, got, want, tol) => { const ok = Math.abs(got - want) <= tol; console.log(ok ? 'PASS' : 'FAIL', name, 'got', got?.toFixed(3), 'want', want.toFixed(3)); fail += !ok; };
const music = (await probe()).musicLufs;
near('music loudness ≈ -17.8 LUFS', music, -17.8, 0.5);
const expect = (o) => Math.min(1, Math.max(0.05, 10 ** ((o + 20 * Math.log10(0.33) - music) / 20)));
for (const o of [-27.8, -17.8, -10]) {
  await other(o); await sleep(2000);
  near(`other at ${o} LUFS -> music ${(o - 9.6).toFixed(1)} LUFS`, (await probe()).gain, expect(o), 0.01);
}
await other(null); await sleep(2000);
near('unmeasured other -> fixed 0.33', (await probe()).gain, 0.33, 0.01);
await other(undefined); await sleep(1200);
near('restore -> 1', (await probe()).gain, 1, 0.01);
await p.evaluate(() => { document.getElementById('m').volume = 0.5; }); await sleep(3000);
near('YT volume slider at 50% is metered (-6 dB)', (await probe()).musicLufs, -17.8 - 6.02, 0.7);
await b.close();
process.exit(fail ? 1 : 0);
