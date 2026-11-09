// Duck YouTube Music while any other sound plays: another Chrome tab (tabs.audible)
// or another Mac app (reported by the native host via Core Audio).
const MUSIC = 'music.youtube.com';
const HOST = 'com.felix.musicduck';

let otherApps = [];
let quietestLufs = null; // loudness of the quietest other app (host-measured)
let ducked = null;
let port;
const hostLog = (msg) => { try { port?.postMessage(msg); } catch {} };

// Host permission reveals URLs of music tabs only; other tabs have no url.
const isMusic = (tab) => {
  try { return new URL(tab.url || tab.pendingUrl || '').host === MUSIC; } catch { return false; }
};

async function update() {
  const tabs = await chrome.tabs.query({});
  const otherTabs = tabs.filter((t) => t.audible && !isMusic(t));
  const duck = otherTabs.length > 0 || otherApps.length > 0;
  if (duck !== ducked) {
    const why = { tabs: otherTabs.length, apps: otherApps }; // no "tabs" permission: other tabs' URLs are hidden
    console.log('[music-duck]', duck ? 'duck' : 'restore', JSON.stringify(why));
    hostLog({ event: duck ? 'duck' : 'restore', ...why });
  }
  ducked = duck;
  // Other Chrome tabs share Chrome's audio process with the music, so their loudness
  // can't be measured apart from it; then the content script uses a fixed duck.
  const otherLufs = duck && otherTabs.length === 0 ? quietestLufs : null;
  for (const t of tabs.filter(isMusic)) chrome.tabs.sendMessage(t.id, { duck, otherLufs }).catch(() => {});
}

function connectHost() {
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => { otherApps = msg.apps || []; quietestLufs = msg.quietestLufs ?? null; update(); });
  port.onDisconnect.addListener(() => {
    console.warn('[music-duck] host disconnected', chrome.runtime.lastError?.message);
    otherApps = [];
    quietestLufs = null;
    update();
    setTimeout(connectHost, 5000);
  });
}

chrome.tabs.onUpdated.addListener((_id, change) => { if ('audible' in change || 'url' in change) update(); });
chrome.tabs.onRemoved.addListener(update);
// Content script asks for current state when it (re)loads.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg === 'hello') update();
  else if (msg?.gain !== undefined) hostLog({ event: 'gain', ...msg });
});

connectHost();
update();
