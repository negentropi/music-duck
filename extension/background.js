// Duck YouTube Music while any other sound plays: another Chrome tab (tabs.audible)
// or another Mac app (reported by the native host via Core Audio).
const MUSIC = 'music.youtube.com';
const HOST = 'com.felix.musicduck';

let otherApps = [];
let ducked = null;
let port;
const hostLog = (msg) => { try { port?.postMessage(msg); } catch {} };

const isMusic = (tab) => {
  try { return new URL(tab.url || tab.pendingUrl || '').host === MUSIC; } catch { return false; }
};

async function update() {
  const tabs = await chrome.tabs.query({});
  const otherTabs = tabs.filter((t) => t.audible && !isMusic(t));
  const duck = otherTabs.length > 0 || otherApps.length > 0;
  if (duck !== ducked) {
    const why = { tabs: otherTabs.map((t) => t.url), apps: otherApps };
    console.log('[music-duck]', duck ? 'duck' : 'restore', JSON.stringify(why));
    hostLog({ event: duck ? 'duck' : 'restore', ...why });
  }
  ducked = duck;
  for (const t of tabs.filter(isMusic)) chrome.tabs.sendMessage(t.id, { duck }).catch(() => {});
}

function connectHost() {
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => { otherApps = msg.apps || []; update(); });
  port.onDisconnect.addListener(() => {
    console.warn('[music-duck] host disconnected', chrome.runtime.lastError?.message);
    otherApps = [];
    update();
    setTimeout(connectHost, 5000);
  });
}

chrome.tabs.onUpdated.addListener((_id, change) => { if ('audible' in change || 'url' in change) update(); });
chrome.tabs.onRemoved.addListener(update);
// Content script asks for current state when it (re)loads.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg === 'hello') update();
  else if (msg?.gain !== undefined) hostLog({ event: 'gain', gain: msg.gain });
});

connectHost();
update();
