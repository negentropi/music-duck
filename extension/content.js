// Route the YouTube Music player through a GainNode so ducking doesn't touch
// YT's own volume slider. Routing happens lazily on first duck.
if (!window.__musicDuck) {
  window.__musicDuck = true;
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
    if (!gain) { gain = ctx.createGain(); gain.connect(ctx.destination); }
    for (const el of document.querySelectorAll('video, audio')) {
      if (routed.has(el)) continue;
      ctx.createMediaElementSource(el).connect(gain);
      routed.add(el);
    }
    return true;
  }

  // Linear ramp from wherever the gain is now, so a fade interrupted midway doesn't jump.
  const setGain = (v, seconds) => {
    if (!gain || v === current) return;
    current = v;
    console.log('[music-duck] gain', v);
    chrome.runtime.sendMessage({ gain: v }).catch(() => {});
    const p = gain.gain, now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(v, now + seconds);
  };

  chrome.runtime.onMessage.addListener(async ({ duck }) => {
    if (duck) { if (await route()) setGain(DUCK_GAIN, DUCK_FADE_S); }
    else setGain(1, RESTORE_FADE_S);
  });

  chrome.runtime.sendMessage('hello').catch(() => {});
}
