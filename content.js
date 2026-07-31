'use strict';

// ─── PER-SESSION + PER-ORIGIN SEED (Brave-style farbling) ─────────────────
// Stored in sessionStorage so the same origin, within the same tab session,
// sees a consistent fingerprint across page loads. New tab / new session /
// different origin → different seed.
//
// sessionStorage is keyed by origin, so storing under a fixed key gives us
// per-origin scoping for free. It's per-tab (not cross-tab like Brave), but
// that's a small deviation that doesn't reduce protection.
//
// NOTE: the seed lives in the page's own sessionStorage, which page scripts
// can also read (they share the store with the content script). That makes
// the extension detectable and the seed forgeable by the site; this is an
// inherent MV2 limitation of running farbling in the page context. We
// mitigate the worst failure mode by validating the stored value: garbage
// (e.g. a page overwriting the key) triggers a fresh seed instead of
// silently collapsing every origin to seed 0 via parseInt → NaN → 0.
const STORAGE_KEY = '__ghostprint_seed_v1__';

// Generates a seed in [1, 0xFFFFFFFE] — never 0, so a stored "0" can be
// treated as invalid and regenerated instead of meaning "seed 0".
function randomSeed() {
  return ((Math.random() * 0xFFFFFFFE) + 1) >>> 0;
}

let seed;
try {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  const parsed = parseInt(stored, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 0xFFFFFFFF) {
    seed = parsed >>> 0;
  } else {
    seed = randomSeed();
    sessionStorage.setItem(STORAGE_KEY, String(seed));
  }
} catch (e) {
  // sessionStorage may throw on some restricted contexts (e.g. about: pages,
  // sandboxed iframes). Fall back to a per-page random seed.
  seed = randomSeed();
}

// ─── INJECTION ────────────────────────────────────────────────────────────
// Inject inject.js via <script src> pointing at a web_accessible_resources
// URL. This is the robust pattern (used by uBlock Origin): extension-origin
// script loads are NOT blocked by the page's Content-Security-Policy,
// whereas inline <script> textContent injection is silently blocked on
// CSP-strict sites (github.com: script-src without 'unsafe-inline';
// youtube.com: nonce + 'strict-dynamic' + Trusted Types — verified). The
// seed travels via sessionStorage: inject.js runs in the page context and
// reads the same store (see STORAGE_KEY in inject.js).
function installHooks() {
  const script = document.createElement('script');
  script.src = browser.runtime.getURL('inject.js');
  (document.head || document.documentElement).appendChild(script);
  // Removing the element right away is safe: the fetch was already started,
  // and the spec keeps executing scripts that have "already started".
  script.remove();
}

// ─── HONOR THE ON/OFF TOGGLE ──────────────────────────────────────────────
// MV2 content scripts can only read browser.storage *asynchronously*, so we
// can't gate injection on it synchronously at document_start. When disabled
// we simply never inject. Because the settings read is async, a page's
// inline <head> scripts can run before the hooks land; that is an inherent
// MV2 limitation (no synchronous storage access from content scripts), and
// the popup already tells the user to reload pages for a change to take
// effect.
//
// Fail-safe: if storage is unavailable for ANY reason (synchronous throw OR
// asynchronous rejection), default to ON so the user keeps their protection
// rather than silently losing it.
try {
  browser.storage.local.get('settings').then((r) => {
    const enabled = r && r.settings ? r.settings.enabled !== false : DEFAULT_SETTINGS.enabled;
    if (enabled) installHooks();
  }).catch(() => installHooks());
} catch (e) {
  installHooks();
}

// ─── SEED QUERY FOR THE POPUP ─────────────────────────────────────────────
// The popup shows the real per-origin seed of the active tab. Only the top
// frame responds (frameId === 0); subframes have their own origin's seed.
browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'GET_SEED' && sender.frameId === 0) {
    return Promise.resolve(seed);
  }
});
