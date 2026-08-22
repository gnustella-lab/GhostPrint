'use strict';

// Seed helpers come from seed.js, loaded immediately before this script.
let seed = null;
let injectionState = 'pending';
let installationSurfaces = null;

const REPORT_SURFACES = ['canvas', 'webgl', 'webgpu', 'audio', 'navigator', 'plugins'];

// ─── PAGE ORIGIN ──────────────────────────────────────────────────────────
// Computed once at document_start so early popup queries see a stable value
// even while initialization is still pending.
function getPageOrigin() {
  try {
    if (typeof location === 'undefined') return null;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return typeof location.origin === 'string' && location.origin.length > 0
      ? location.origin
      : null;
  } catch (_) {
    return null;
  }
}

const PAGE_ORIGIN = getPageOrigin();

// ─── INJECTION ────────────────────────────────────────────────────────────
// Inject inject.js via <script src> pointing at a web_accessible_resources
// URL. This is the robust pattern (used by uBlock Origin): extension-origin
// script loads are NOT blocked by the page's Content-Security-Policy,
// whereas inline <script> textContent injection is silently blocked on
// CSP-strict sites. The validated seed is also carried in the fragment, so
// page-controlled sessionStorage cannot change the value used by the page
// realm between this step and script start. The page can still observe or
// attempt to interfere with the injected element.
//
// A one-time diagnostic channel rides along: an unguessable token generated
// here (not derivable from the page-visible seed alone) is appended as
// &report=…, and inject.js answers once via postMessage carrying that same
// token plus its per-surface installer results. This is diagnostics for the
// popup, not a security boundary: hostile pages may spoof or suppress the
// report, and nothing functional depends on it.
function createReportToken(cryptoSource) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') return null;
  try {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    let hex = '';
    for (let index = 0; index < bytes.length; index += 1) {
      hex += bytes[index].toString(16).padStart(2, '0');
    }
    return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
  } catch (_) {
    return null;
  }
}

function sanitizeInstallationReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const surfaces = {};
  let seen = 0;
  for (const surface of REPORT_SURFACES) {
    const state = value[surface];
    if (state === 'installed' || state === 'unavailable' || state === 'failed') {
      surfaces[surface] = state;
      seen += 1;
    }
  }
  return seen > 0 ? surfaces : null;
}

function listenForInstallationReport(token) {
  if (token === null || typeof window === 'undefined'
    || typeof window.addEventListener !== 'function'
    || typeof window.removeEventListener !== 'function') {
    return null;
  }
  const handler = (event) => {
    try {
      if (!event || event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.__ghostprintReport !== token) return;
      window.removeEventListener('message', handler);
      const surfaces = sanitizeInstallationReport(data.results);
      if (surfaces !== null) installationSurfaces = surfaces;
    } catch (_) {}
  };
  window.addEventListener('message', handler);
  return handler;
}

function installHooks() {
  if (seed === null) {
    injectionState = 'seed-unavailable';
    return false;
  }
  try {
    const cryptoSource = typeof crypto !== 'undefined' ? crypto : null;
    const reportToken = createReportToken(cryptoSource);
    const reportHandler = listenForInstallationReport(reportToken);
    let source = `${browser.runtime.getURL('inject.js')}#seed=${seed}`;
    if (reportHandler !== null) source += `&report=${reportToken}`;

    const script = document.createElement('script');
    script.src = source;
    script.onload = () => {
      injectionState = 'installed';
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
    return true;
  } catch (_) {
    seed = null;
    injectionState = 'injection-failed';
    return false;
  }
}

// ─── HONOR THE ON/OFF TOGGLES ─────────────────────────────────────────────
// MV2 content scripts still need an asynchronous settings lookup, so inline
// page scripts may run before the hooks land. The background is the sole
// settings owner; storage errors fail safe to protection ON. When the origin
// is known, the background also resolves the per-site override ("denylist"
// semantics: global on + site off ⇒ off for this origin).
async function loadSettingsFromBackground(pageOrigin) {
  const message = { type: 'GET_SETTINGS' };
  if (pageOrigin !== null) message.origin = pageOrigin;
  const response = await browser.runtime.sendMessage(message);
  if (!response || response.ok !== true) throw new Error('settings-unavailable');
  return response;
}

async function initializeContentScript() {
  let response;
  try {
    response = await loadSettingsFromBackground(PAGE_ORIGIN);
  } catch (_) {
    response = null;
  }

  const settings = response && response.ok === true
    ? normalizeSettings(response.settings)
    : cloneDefaultSettings();
  // Without a resolved per-origin decision (older background, restricted
  // origin, or failed lookup), follow the global switch.
  const globallyEnabled = settings.enabled === true;
  const siteEnabled = response && typeof response.siteEnabled === 'boolean'
    ? response.siteEnabled
    : globallyEnabled;

  if (!globallyEnabled) {
    injectionState = 'disabled';
    return;
  }
  if (!siteEnabled) {
    injectionState = 'disabled-site';
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

// ─── QUERIES FOR THE POPUP ────────────────────────────────────────────────
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
      origin: PAGE_ORIGIN === null ? undefined : PAGE_ORIGIN,
      surfaces: installationSurfaces === null ? undefined : installationSurfaces,
    });
  }
  if (message && message.type === 'RESET_SEED') {
    // Clears the stored session seed so the next navigation generates a fresh
    // one. Already-installed hooks keep their seed until the caller reloads;
    // the popup reloads the tab right after this succeeds.
    let cleared = false;
    try {
      sessionStorage.removeItem(SEED_STORAGE_KEY);
      cleared = true;
    } catch (_) {
      cleared = false;
    }
    return Promise.resolve({ ok: cleared });
  }
});
