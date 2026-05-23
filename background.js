'use strict';

const SPOOFED_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';

// Firefox 128's default top-level navigation Accept header. Rewriting this
// normalises away the jQuery-style "text/html, */*; q=0.01" Accept that
// EFF saw (7.63 bits). We rewrite for document-like requests only — leaving
// API/XHR/JSON Accept headers alone so applications keep working.
const SPOOFED_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const SPOOFED_ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

const DEFAULT_SETTINGS = {
  enabled: true,
  protections: {
    canvas: true,
    webgl: true,
    audio: true,
    navigator: true,
    screen: true,
    webrtc: true,
    battery: true,
    fonts: true,
    mediaDevices: true,
    timezone: true,
    userAgent: true
  }
};

async function ensureSettings() {
  const result = await browser.storage.local.get('settings');
  if (!result.settings) {
    await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
}

browser.runtime.onInstalled.addListener(ensureSettings);
browser.runtime.onStartup.addListener(ensureSettings);

// ─── HTTP HEADER REWRITING ─────────────────────────────────────────────
// Rewrites the User-Agent header on outgoing requests so the value matches
// what we spoof in navigator.userAgent. Without this, the HTTP layer leaks
// the real Firefox 153 string and EFF (and trackers) read it directly.
//
// We deliberately leave Accept-Language and Accept untouched per user
// preference — keeping pt-BR for normal browsing.

let uaSpoofingEnabled = true;

async function loadUASpoofPreference() {
  const result = await browser.storage.local.get('settings');
  const s = result.settings || DEFAULT_SETTINGS;
  uaSpoofingEnabled = s.enabled && (s.protections.userAgent !== false);
}

loadUASpoofPreference();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) loadUASpoofPreference();
});

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!uaSpoofingEnabled) return {};

    // Document-like requests get full header normalisation (Accept, etc.)
    // Other requests (XHR, fetch, JSON API calls, etc.) only get the UA
    // rewritten — preserving application-set Accept headers like
    // "application/json" that APIs depend on.
    const isDocument = details.type === 'main_frame' ||
                       details.type === 'sub_frame' ||
                       details.type === 'xmlhttprequest';

    for (const h of details.requestHeaders) {
      const n = h.name.toLowerCase();
      if (n === 'user-agent') {
        h.value = SPOOFED_UA;
      } else if (isDocument && n === 'accept') {
        h.value = SPOOFED_ACCEPT;
      } else if (isDocument && n === 'accept-encoding') {
        h.value = SPOOFED_ACCEPT_ENCODING;
      }
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestHeaders']
);

// ─── MESSAGE HANDLERS ──────────────────────────────────────────────────
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'GET_SETTINGS') {
    return browser.storage.local.get('settings').then(result => {
      return result.settings || DEFAULT_SETTINGS;
    });
  }
  if (message.type === 'SET_SETTINGS') {
    return browser.storage.local.set({ settings: message.settings });
  }
  if (message.type === 'RESET_SETTINGS') {
    return browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});
