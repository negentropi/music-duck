// Route the YouTube Music player through a GainNode so ducking doesn't touch
// YT's own volume slider. Routing starts once music plays.
const DUCK_GAIN = 0.33; // lower by 67%
const DUCK_FADE_S = 0.4;
const RESTORE_FADE_S = 0.75;

let ctx, gain, current = 1;
const routed = new WeakSet();

// Only reroute once the AudioContext is actually running; a suspended context
// would silence the music instead of ducking it.
async function route() {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  if (ctx.state !== 'running') { console.warn('[music-duck] AudioContext not running'); return false; }
  if (!gain) {
    gain = ctx.createGain();
    gain.connect(ctx.destination);
    // YT can swap in a new player element; route it immediately so it can't play unducked.
    new MutationObserver(routeAll).observe(document, { childList: true, subtree: true });
  }
  routeAll();
  return true;
}

function routeAll() {
  for (const el of document.querySelectorAll('video, audio')) {
    if (routed.has(el)) continue;
    ctx.createMediaElementSource(el).connect(gain);
    routed.add(el);
  }
}

// Exponential ramp = even in dB, so the fade sounds smooth (a linear gain ramp is
// front-loaded and sounds like a sudden jump). Starts from the live value so an
// interrupted fade doesn't jump.
function setGain(v, seconds) {
  if (!gain || v === current) return;
  current = v;
  chrome.runtime.sendMessage({ gain: v }).catch(() => {});
  const p = gain.gain, now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.exponentialRampToValueAtTime(v, now + seconds);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // Test probe: live gain, target, context state.
  if (msg.probe) { reply({ gain: gain?.gain.value ?? 1, target: current, ctx: ctx?.state }); return; }
  onDuck(msg.duck);
});

async function onDuck(duck) {
  if (duck) { if (await route()) setGain(DUCK_GAIN, DUCK_FADE_S); }
  else setGain(1, RESTORE_FADE_S);
}

// Warm up routing as soon as music plays so the first duck is instant
// (starting the AudioContext on demand took ~1-3s).
document.addEventListener('playing', () => route(), true);
if ([...document.querySelectorAll('video, audio')].some((el) => !el.paused)) route();

chrome.runtime.sendMessage('hello').catch(() => {});
