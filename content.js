'use strict';

// Seed helpers come from seed.js, loaded immediately before this script.
let seed = null;
let injectionState = 'pending';

// ─── INJECTION ────────────────────────────────────────────────────────────
// Inject inject.js via <script src> pointing at a web_accessible_resources
// URL. This is the robust pattern (used by uBlock Origin): extension-origin
// script loads are NOT blocked by the page's Content-Security-Policy,
// whereas inline <script> textContent injection is silently blocked on
// CSP-strict sites. The validated seed is also carried in the fragment, so
// page-controlled sessionStorage cannot change the value used by the page
// realm between this step and script start. The page can still observe or
// attempt to interfere with the injected element.
function installHooks() {
  if (seed === null) {
    injectionState = 'seed-unavailable';
    return false;
  }
  try {
    const script = document.createElement('script');
    script.src = `${browser.runtime.getURL('inject.js')}#seed=${seed}`;
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      seed = null;
      injectionState = 'injection-failed';
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    // Keep the element connected until the external script has loaded. Removing
    // it before the post-connection steps can prevent the browser from
    // preparing and executing a dynamically inserted script.
    injectionState = 'installed';
    return true;
  } catch (_) {
    seed = null;
    injectionState = 'injection-failed';
    return false;
  }
}

// ─── HONOR THE ON/OFF TOGGLE ──────────────────────────────────────────────
// MV2 content scripts still need an asynchronous settings lookup, so inline
// page scripts may run before the hooks land. The background is the sole
// settings owner; storage errors fail safe to protection ON.
async function loadSettingsFromBackground() {
  const response = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (!response || response.ok !== true) throw new Error('settings-unavailable');
  return normalizeSettings(response.settings);
}

async function initializeContentScript() {
  let settings;
  try {
    settings = await loadSettingsFromBackground();
  } catch (_) {
    settings = cloneDefaultSettings();
  }

  if (!settings.enabled) {
    injectionState = 'disabled';
    return;
  }

  const cryptoSource = typeof crypto !== 'undefined' ? crypto : null;
  seed = getOrCreateSeed(sessionStorage, cryptoSource);
  if (seed === null) {
    injectionState = 'seed-unavailable';
    return;
  }
  installHooks();
}

initializeContentScript().catch(() => {
  injectionState = 'initialization-failed';
});

// ─── SEED QUERY FOR THE POPUP ─────────────────────────────────────────────
// The popup targets the top frame explicitly (tabs.sendMessage options.frameId:
// 0). Returning undefined distinguishes a disabled or unavailable seed from a
// real numeric seed without exposing internal diagnostic state to the page.
browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'GET_SEED') {
    return Promise.resolve(seed === null ? undefined : seed);
  }
  if (message && message.type === 'GET_INJECTION_STATUS') {
    return Promise.resolve({
      state: injectionState,
      seed: seed === null ? undefined : seed,
    });
  }
});
