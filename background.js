'use strict';

// GhostPrint background: just maintains the on/off setting. All real work
// happens in the content/inject scripts. DEFAULT_SETTINGS comes from
// settings.js (loaded first, see manifest background.scripts).

async function ensureSettings() {
  const result = await browser.storage.local.get('settings');
  if (!result.settings) {
    await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
}

browser.runtime.onInstalled.addListener(ensureSettings);
browser.runtime.onStartup.addListener(ensureSettings);

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'GET_SETTINGS') {
    return browser.storage.local.get('settings').then(r => r.settings || DEFAULT_SETTINGS);
  }
  if (message.type === 'SET_SETTINGS') {
    return browser.storage.local.set({ settings: message.settings });
  }
  if (message.type === 'RESET_SETTINGS') {
    return browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});
