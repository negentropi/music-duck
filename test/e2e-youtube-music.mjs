// E2E: real YouTube Music in Chrome for Testing with the extension loaded.
// Fakes "another app is playing" in the service worker, then samples the live
// gain through duck -> track switch -> restore.
// Usage: CHROME=/path/to/Chrome\ for\ Testing node test/e2e-youtube-music.mjs
// (needs puppeteer-core; branded Chrome can't --load-extension)
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ext = fileURLToPath(new URL('../extension', import.meta.url));
// Temp profile with the real native host registered (run ./install.sh first);
// a missing host makes the extension retry and reset otherApps every 5s.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-duck-e2e-'));
fs.mkdirSync(path.join(userDataDir, 'NativeMessagingHosts'));
fs.copyFileSync(path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.felix.musicduck.json'), path.join(userDataDir, 'NativeMessagingHosts/com.felix.musicduck.json'));
const b = await puppeteer.launch({
  executablePath: process.env.CHROME, headless: 'new', pipe: true, enableExtensions: [ext], userDataDir,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await (await b.waitForTarget((t) => t.type() === 'service_worker')).worker();
const p = await b.newPage();
await p.setUserAgent((await b.userAgent()).replace('Headless', ''));
await p.goto('https://music.youtube.com/watch?v=B8HfbiT2IP0&list=RDAMVMB8HfbiT2IP0', { waitUntil: 'networkidle2' });
await sleep(9000); // headless YT starts playback late
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://music.youtube.com/*' }))[0].id);
// Detach the native host (already settled) so only the fake app drives ducking.
const otherApp = (on) => sw.evaluate((on) => { port?.disconnect(); otherApps = on ? ['fake-app'] : []; update(); }, on);
const probe = () => sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { probe: true }), tabId);
const sample = async (ms) => { const out = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { out.push((await probe()).gain); await sleep(100); } return out; };

let fail = 0;
const check = (name, ok, vals) => { console.log(ok ? 'PASS' : 'FAIL', name, vals.map((v) => v.toFixed(2)).join(' ')); fail += !ok; };
await otherApp(true);
const duck = await sample(800);
check('ducks to 0.33 within 0.6s', duck.slice(6).every((v) => Math.abs(v - 0.33) < 0.02), duck);
await p.evaluate(() => document.querySelector('#movie_player').nextVideo());
const sw2 = await sample(4000);
check('stays ducked across track switch', sw2.every((v) => Math.abs(v - 0.33) < 0.02), sw2);
await otherApp(false);
const rest = await sample(1100);
const rising = rest.every((v, i) => i === 0 || v >= rest[i - 1] - 1e-3);
check('restores smoothly to 1 (no jump)', rising && rest.at(-1) > 0.99 && rest[1] < 0.5, rest);
await b.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
