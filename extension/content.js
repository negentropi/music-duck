// Route the YouTube Music player through a GainNode so ducking doesn't touch
// YT's own volume slider. Routing happens lazily on first duck.
const DUCK_GAIN = 0.5;
const RELEASE_MS = 1200; // hold duck briefly so short blips don't make music pump

let ctx, gain, releaseTimer;
const routed = new WeakSet();

function route() {
  ctx ??= new AudioContext();
  if (!gain) { gain = ctx.createGain(); gain.connect(ctx.destination); }
  for (const el of document.querySelectorAll('video, audio')) {
    if (routed.has(el)) continue;
    ctx.createMediaElementSource(el).connect(gain);
    routed.add(el);
  }
  // Page already has user activation (music is playing), so resume is allowed.
  if (ctx.state !== 'running') ctx.resume();
}

function setGain(v) {
  if (!gain) return;
  gain.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
}

chrome.runtime.onMessage.addListener(({ duck }) => {
  clearTimeout(releaseTimer);
  if (duck) { route(); setGain(DUCK_GAIN); }
  else releaseTimer = setTimeout(() => setGain(1), RELEASE_MS);
});

chrome.runtime.sendMessage('hello').catch(() => {});
