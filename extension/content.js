// Route the YouTube Music player through a GainNode so ducking doesn't touch
// YT's own volume slider. Routing happens lazily on first duck.
if (!window.__musicDuck) {
  window.__musicDuck = true;
  const DUCK_GAIN = 0.5;
  const RELEASE_MS = 1200; // hold duck briefly so short blips don't make music pump

  let ctx, gain, releaseTimer;
  const routed = new WeakSet();

  // Only reroute once the AudioContext is actually running; a suspended context
  // would silence the music instead of ducking it.
  async function route() {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') { console.warn('[music-duck] AudioContext not running'); return false; }
    if (!gain) { gain = ctx.createGain(); gain.connect(ctx.destination); }
    for (const el of document.querySelectorAll('video, audio')) {
      if (routed.has(el)) continue;
      ctx.createMediaElementSource(el).connect(gain);
      routed.add(el);
    }
    return true;
  }

  const setGain = (v) => {
    if (!gain) return;
    console.log('[music-duck] gain', v);
    gain.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
  };

  chrome.runtime.onMessage.addListener(async ({ duck }) => {
    clearTimeout(releaseTimer);
    if (duck) { if (await route()) setGain(DUCK_GAIN); }
    else releaseTimer = setTimeout(() => setGain(1), RELEASE_MS);
  });

  chrome.runtime.sendMessage('hello').catch(() => {});
}
