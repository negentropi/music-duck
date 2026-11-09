// E2E: another Chrome tab playing ducks the music by the fixed 67%, with no "tabs"
// permission (tabs.audible needs none). Headless Chrome never marks tabs audible, so
// this runs a real window off-screen with both tabs at an inaudible level (25 Hz, -66 dBFS).
// Usage: CHROME=/path/to/Chrome\ for\ Testing node test/e2e-other-tab.mjs
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const ext = fileURLToPath(new URL('../extension', import.meta.url));
const b = await puppeteer.launch({
  executablePath: process.env.CHROME, headless: false, pipe: true, enableExtensions: [ext],
  args: ['--autoplay-policy=no-user-gesture-required', '--window-position=-3000,-3000'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await (await b.waitForTarget((t) => t.type() === 'service_worker')).worker();
await sw.evaluate(() => { connectHost = () => {}; port?.disconnect(); }); // real Mac audio would skew the result
const hum = `const c = new AudioContext(), o = c.createOscillator(), g = c.createGain();
  o.frequency.value = 25; g.gain.value = 0.0005; o.connect(g).connect(c.destination); o.start();`;

const music = await b.newPage();
await music.setRequestInterception(true);
// An <audio> element (what the extension routes) fed by the quiet hum.
music.on('request', (r) => r.respond({ contentType: 'text/html', body: `<script>${hum}
  const d = c.createMediaStreamDestination(); g.connect(d);
  const el = new Audio(); el.srcObject = d.stream; document.documentElement.append(el); el.play();</script>` }));
await music.goto('https://music.youtube.com/watch');
await sleep(2000);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://music.youtube.com/*' }))[0].id);
const probe = async () => (await sw.evaluate((id) => chrome.tabs.sendMessage(id, { probe: true }), tabId)).gain;

let fail = 0;
const check = (name, got, want) => { const ok = Math.abs(got - want) < 0.01; console.log(ok ? 'PASS' : 'FAIL', name, 'got', got.toFixed(3)); fail += !ok; };
check('alone -> 1', await probe(), 1);
const other = await b.newPage();
await other.goto('about:blank');
await other.evaluate(hum);
await sleep(2500);
check('other tab audible -> 0.33', await probe(), 0.33);
await other.close();
await sleep(4000); // tabs stay "audible" ~2s after sound stops
check('other tab closed -> 1', await probe(), 1);
await b.close();
process.exit(fail ? 1 : 0);
