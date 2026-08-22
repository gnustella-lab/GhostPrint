'use strict';

// The background page is the only settings owner. settings.js supplies the
// schema, defaults and validation helpers shared by all other contexts.

// Repair is needed whenever the raw persisted value is not already in its
// canonical v2 form (including the legacy v1 { enabled } shape, which
// normalizes to { enabled, sites: {} }).
function settingsNeedRepair(raw, normalized) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes('enabled') || !keys.includes('sites')) return true;
  if (raw.enabled !== normalized.enabled) return true;
  const rawSites = raw.sites;
  if (!rawSites || typeof rawSites !== 'object' || Array.isArray(rawSites)) return true;
  const normalizedSites = normalized.sites;
  const rawSiteKeys = Object.keys(rawSites);
  if (rawSiteKeys.length !== Object.keys(normalizedSites).length) return true;
  for (const key of rawSiteKeys) {
    if (rawSites[key] !== normalizedSites[key]) return true;
  }
  return false;
}

let settingsQueue = Promise.resolve();

function enqueueSettings(operation) {
  const next = settingsQueue.then(operation, operation);
  settingsQueue = next.catch(() => undefined);
  return next;
}

function readSettings() {
  return enqueueSettings(async () => {
    const result = await browser.storage.local.get('settings');
    const raw = result && result.settings;
    const normalized = normalizeSettings(raw);
    if (settingsNeedRepair(raw, normalized)) {
      await browser.storage.local.set({ settings: normalized });
    }
    return normalized;
  });
}

function writeSettings(value) {
  const validation = validateSettings(value);
  if (!validation.valid) return Promise.resolve({ ok: false, error: 'invalid-settings' });
  return enqueueSettings(async () => {
    await browser.storage.local.set({ settings: validation.settings });
    return { ok: true, settings: validation.settings };
  });
}

async function ensureSettings() {
  try {
    await readSettings();
  } catch (_) {
    // The content script fails safe to ON when this read is unavailable.
  }
}

browser.runtime.onInstalled.addListener(() => { void ensureSettings(); });
browser.runtime.onStartup.addListener(() => { void ensureSettings(); });

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== 'string') {
    return Promise.resolve({ ok: false, error: 'invalid-message' });
  }
  if (sender && !sender.tab && typeof sender.url === 'string' &&
      !sender.url.startsWith(browser.runtime.getURL(''))) {
    return Promise.resolve({ ok: false, error: 'unauthorized-sender' });
  }

  if (message.type === 'GET_SETTINGS') {
    return readSettings()
      .then((settings) => {
        // Content scripts and the popup may request the effective decision
        // for one origin alongside the global settings. Without an origin
        // the field stays undefined and callers follow settings.enabled.
        const response = { ok: true, settings };
        if (typeof message.origin === 'string') {
          response.siteEnabled = resolveEnabledForOrigin(settings, message.origin);
        }
        return response;
      })
      .catch(() => ({ ok: false, error: 'storage-read-failed' }));
  }
  if (message.type === 'SET_SETTINGS') {
    return writeSettings(message.settings)
      .then((response) => response)
      .catch(() => ({ ok: false, error: 'storage-write-failed' }));
  }
  if (message.type === 'RESET_SETTINGS') {
    return writeSettings(cloneDefaultSettings())
      .catch(() => ({ ok: false, error: 'storage-write-failed' }));
  }
  return Promise.resolve({ ok: false, error: 'unknown-message' });
});
