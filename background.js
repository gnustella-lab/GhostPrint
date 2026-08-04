'use strict';

// The background page is the only settings owner. settings.js supplies the
// schema, defaults and validation helpers shared by all other contexts.

function settingsNeedRepair(raw, normalized) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const keys = Object.keys(raw);
  return keys.length !== 1 || keys[0] !== 'enabled' || raw.enabled !== normalized.enabled;
}

async function readSettings() {
  const result = await browser.storage.local.get('settings');
  const raw = result && result.settings;
  const normalized = normalizeSettings(raw);
  if (settingsNeedRepair(raw, normalized)) {
    await browser.storage.local.set({ settings: normalized });
  }
  return normalized;
}

async function writeSettings(value) {
  const validation = validateSettings(value);
  if (!validation.valid) return { ok: false, error: 'invalid-settings' };
  await browser.storage.local.set({ settings: validation.settings });
  return { ok: true, settings: validation.settings };
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
      .then((settings) => ({ ok: true, settings }))
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
