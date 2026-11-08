// Route the YouTube Music player through Web Audio so ducking doesn't touch YT's
// own volume slider, and meter the music's loudness (LUFS) to duck relative to
// the quietest other sound. Routing starts once music plays.
//
//   media -> pre -> duck -> speakers
//             \-> K-weighting -> L/R analysers (music loudness, pre-duck)

const RELATIVE_DB = 20 * Math.log10(0.33); // music sits 67% (≈ -9.6 dB) below the quietest other sound
const FIXED_GAIN = 0.33; // when the other sound can't be measured (other Chrome tabs, no permission)
const MIN_GAIN = 0.05;
const GATE_LUFS = -55; // pauses quieter than this don't move the level
const DUCK_FADE_S = 0.4;
const RESTORE_FADE_S = 0.75;

let ctx, pre, duckGain, analysers, musicPower = null;
let current = 1;
let state = { duck: false, otherLufs: null };
const routed = new WeakSet();

const lufs = (power) => -0.691 + 10 * Math.log10(Math.max(power, 1e-12));
const musicLufs = () => (musicPower === null ? null : lufs(musicPower));

// BS.1770 K-weighting (high shelf + high pass), same formulas as the native host.
function kWeighting(fs) {
  let k = Math.tan(Math.PI * 1681.974450955533 / fs), q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = ctx.createIIRFilter(
    [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
    [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]);
  k = Math.tan(Math.PI * 38.13547087602444 / fs); q = 0.5003270373238773;
  a0 = 1 + k / q + k * k;
  const highpass = ctx.createIIRFilter([1, -2, 1], [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]);
  shelf.connect(highpass);
  return { input: shelf, output: highpass };
}

// Only reroute once the AudioContext is actually running; a suspended context
// would silence the music instead of ducking it.
async function route() {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  if (ctx.state !== 'running') { console.warn('[music-duck] AudioContext not running'); return false; }
  if (!pre) {
    pre = ctx.createGain();
    duckGain = ctx.createGain();
    pre.connect(duckGain).connect(ctx.destination);
    const k = kWeighting(ctx.sampleRate);
    const split = ctx.createChannelSplitter(2);
    pre.connect(k.input);
    k.output.connect(split);
    analysers = [0, 1].map((ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 8192;
      split.connect(a, ch);
      return a;
    });
    setInterval(tick, 200);
    // YT can swap in a new player element; route it immediately so it can't play unducked.
    new MutationObserver(routeAll).observe(document, { childList: true, subtree: true });
  }
  routeAll();
  return true;
}

function routeAll() {
  for (const el of document.querySelectorAll('video, audio')) {
    if (routed.has(el)) continue;
    ctx.createMediaElementSource(el).connect(pre);
    routed.add(el);
  }
}

const buf = new Float32Array(8192);
function tick() {
  // Mean square per channel, summed (BS.1770), gated + smoothed (~1s).
  let power = 0;
  for (const a of analysers) {
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    power += s / buf.length;
  }
  if (lufs(power) > GATE_LUFS) musicPower = musicPower === null ? power : musicPower + 0.25 * (power - musicPower);
  if (state.duck) apply();
}

function targetGain() {
  if (!state.duck) return 1;
  const music = musicLufs();
  if (state.otherLufs === null || music === null) return FIXED_GAIN;
  const g = 10 ** ((state.otherLufs + RELATIVE_DB - music) / 20);
  return Math.min(1, Math.max(MIN_GAIN, g));
}

// Exponential ramp = even in dB, so fades sound smooth (a linear gain ramp is
// front-loaded and sounds like a sudden jump). Starts from the live value so an
// interrupted fade doesn't jump. Ignores sub-0.5 dB wobble from the meters.
function apply() {
  const v = targetGain();
  if (!duckGain || Math.abs(20 * Math.log10(v / current)) < 0.5) return;
  const seconds = v > current && !state.duck ? RESTORE_FADE_S : DUCK_FADE_S;
  current = v;
  chrome.runtime.sendMessage({ gain: Number(v.toFixed(3)), musicLufs: musicLufs()?.toFixed(1), otherLufs: state.otherLufs }).catch(() => {});
  const p = duckGain.gain, now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.exponentialRampToValueAtTime(v, now + seconds);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // Test probe: live gain, target, context state, measured music loudness.
  if (msg.probe) { reply({ gain: duckGain?.gain.value ?? 1, target: current, ctx: ctx?.state, musicLufs: musicLufs() }); return; }
  onState(msg);
});

async function onState({ duck, otherLufs = null }) {
  state = { duck, otherLufs };
  if (duck && !(await route())) return;
  apply();
}

// Warm up routing + metering as soon as music plays so the first duck is instant
// and already knows the music's loudness.
document.addEventListener('playing', () => route(), true);
if ([...document.querySelectorAll('video, audio')].some((el) => !el.paused)) route();

chrome.runtime.sendMessage('hello').catch(() => {});
