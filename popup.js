'use strict';

// One entry per surface reported by inject.js through the content script's
// diagnostic channel. When no report arrived yet, rows fall back to mirroring
// the global switch (legacy behavior).
const EFF_FIELDS = [
  { surface: 'audio', icon: '🔊', label: 'Audio' },
  { surface: 'canvas', icon: '🖼️', label: 'Canvas hash' },
  { surface: 'webgl', icon: '🎮', label: 'WebGL hash' },
  { surface: 'webgpu', icon: '🌐', label: 'WebGPU adapter info' },
  { surface: 'plugins', icon: '🧩', label: 'Plugins / MIME types' },
  { surface: 'navigator', icon: '⚙️', label: 'Hardware concurrency' },
];

let currentSettings = cloneDefaultSettings();
let activeTab = null;
let activeOrigin = null;
let lastInjectionStatus = null;
let needsReloadHint = false;

async function requestSettings(type, settings) {
  const message = { type };
  if (settings !== undefined) message.settings = settings;
  const response = await browser.runtime.sendMessage(message);
  if (!response || response.ok !== true) {
    throw new Error(response && response.error ? response.error : 'settings-request-failed');
  }
  return response.settings ? normalizeSettings(response.settings) : cloneDefaultSettings();
}

async function loadSettings() {
  return requestSettings('GET_SETTINGS');
}

async function saveSettings(settings) {
  return requestSettings('SET_SETTINGS', settings);
}

async function resetSettings() {
  return requestSettings('RESET_SETTINGS');
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id === undefined) throw new Error('no active tab');
  return tab;
}

function isSupportedTabUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function loadInjectionStatus() {
  const tab = await getActiveTab();
  const response = await browser.tabs.sendMessage(
    tab.id,
    { type: 'GET_INJECTION_STATUS' },
    { frameId: 0 },
  );
  if (!response || typeof response.state !== 'string') throw new Error('injection-status-unavailable');
  return response;
}

function renderBanner(className, iconText, text) {
  const banner = document.getElementById('statusBanner');
  const icon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');
  banner.className = className;
  icon.textContent = iconText;
  statusText.textContent = text;
}

function renderStatus(enabled, injectionStatus) {
  if (!enabled) {
    renderBanner('status-banner inactive', '⚠️', 'Disabled, reload pages');
    return;
  }
  const state = injectionStatus ? injectionStatus.state : null;
  if (state === 'disabled-site') {
    renderBanner('status-banner inactive', '⚠️', 'Disabled on this site');
    return;
  }
  if (state !== null && state !== 'installed') {
    const message = state === 'pending'
      ? 'Starting protection, reload if needed'
      : 'Protection unavailable, reload the page';
    renderBanner('status-banner error', '⚠️', message);
    return;
  }
  renderBanner('status-banner active', '🛡️', 'Randomizing, reload pages');
}

function renderError(message) {
  renderBanner('status-banner error', '⚠️', message);
}

// Dots mirror reality when a diagnostic report exists: green = hook
// installed, gray = API absent in this browser, red = installer failed or
// protection off. Without a report they degrade to the global switch.
function renderFields(enabled, surfaces) {
  const list = document.getElementById('protectionsList');
  list.replaceChildren();
  for (const field of EFF_FIELDS) {
    let dotClass = enabled ? 'on' : 'off';
    const reported = surfaces && typeof surfaces === 'object' ? surfaces[field.surface] : undefined;
    if (reported === 'installed') dotClass = 'on';
    else if (reported === 'unavailable') dotClass = 'na';
    else if (reported === 'failed') dotClass = 'off';

    const row = document.createElement('div');
    row.className = 'protection-row ' + dotClass;

    const left = document.createElement('div');
    left.className = 'protection-left';

    const icon = document.createElement('span');
    icon.className = 'protection-icon';
    icon.textContent = field.icon;
    icon.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'protection-name';
    name.textContent = field.label;

    left.appendChild(icon);
    left.appendChild(name);

    const dot = document.createElement('div');
    dot.className = 'protection-dot';
    dot.setAttribute('aria-hidden', 'true');

    row.appendChild(left);
    row.appendChild(dot);
    list.appendChild(row);
  }
}

function updateSiteCard() {
  const card = document.getElementById('siteCard');
  const originEl = document.getElementById('siteOrigin');
  const siteToggle = document.getElementById('siteToggle');
  if (!activeOrigin || !currentSettings.enabled) {
    card.hidden = true;
    originEl.textContent = '';
    siteToggle.checked = false;
    return;
  }
  originEl.textContent = activeOrigin;
  siteToggle.checked = resolveEnabledForOrigin(currentSettings, activeOrigin);
  siteToggle.disabled = false;
  card.hidden = false;
}

function updateReloadButton(injectionStatus) {
  const button = document.getElementById('reloadBtn');
  const state = injectionStatus && typeof injectionStatus.state === 'string'
    ? injectionStatus.state
    : null;
  const shouldShow = activeOrigin !== null && (
    needsReloadHint ||
    (currentSettings.enabled && state !== null && state !== 'installed')
  );
  button.hidden = !shouldShow;
}

// Seed line disambiguates its failure modes instead of one generic hint:
// global off / site override / unsupported page / needs reload / real value.
async function renderSeed() {
  const el = document.getElementById('sessionSeed');
  if (!currentSettings.enabled) {
    el.textContent = '— protection off';
    return;
  }
  if (lastInjectionStatus && lastInjectionStatus.state === 'disabled-site') {
    el.textContent = '— off for this site';
    return;
  }
  try {
    const tab = await getActiveTab();
    if (!isSupportedTabUrl(tab.url)) {
      el.textContent = '— page not supported';
      return;
    }
    const seed = await browser.tabs.sendMessage(tab.id, { type: 'GET_SEED' }, { frameId: 0 });
    el.textContent = (seed === undefined || seed === null)
      ? '— reload the page'
      : '0x' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  } catch (err) {
    console.error('GhostPrint: could not read seed of active tab:', err);
    el.textContent = '— reload the page';
  }
}

function closePopup() {
  try {
    if (typeof window !== 'undefined' && typeof window.close === 'function') window.close();
  } catch (_) {}
}

async function queryInjectionViews() {
  let injectionStatus;
  try {
    injectionStatus = await loadInjectionStatus();
  } catch (err) {
    console.error('GhostPrint: could not read injection status:', err);
    injectionStatus = { state: 'unavailable' };
  }
  lastInjectionStatus = injectionStatus;
  return injectionStatus;
}

function renderInjectionViews(injectionStatus) {
  updateSiteCard();
  renderStatus(currentSettings.enabled, injectionStatus);
  renderFields(currentSettings.enabled, injectionStatus.surfaces);
  updateReloadButton(injectionStatus);
  void renderSeed();
}

// After any persisted change the loaded page still runs the previous decision
// until reload, so on supported pages we say exactly that instead of letting
// a stale "installed" status speak for the new setting.
async function refreshAfterSettingsChange() {
  const injectionStatus = await queryInjectionViews();
  if (activeOrigin !== null) needsReloadHint = true;
  renderInjectionViews(injectionStatus);
  if (needsReloadHint) {
    renderBanner('status-banner error', '⚠️', 'Applies after reloading the page');
  }
}

function bindControls() {
  const toggle = document.getElementById('globalToggle');
  const resetButton = document.getElementById('resetBtn');
  const siteToggle = document.getElementById('siteToggle');

  toggle.addEventListener('change', async () => {
    const requested = toggle.checked;
    toggle.disabled = true;
    try {
      currentSettings = await saveSettings({ enabled: requested });
      toggle.checked = currentSettings.enabled;
      await refreshAfterSettingsChange();
    } catch (err) {
      console.error('GhostPrint: could not save settings:', err);
      toggle.checked = currentSettings.enabled;
      renderError('Could not save settings');
    } finally {
      toggle.disabled = false;
    }
  });

  siteToggle.addEventListener('change', async () => {
    if (!activeOrigin) return;
    const desired = siteToggle.checked;
    siteToggle.disabled = true;
    try {
      const sites = Object.assign({}, currentSettings.sites);
      if (desired) delete sites[activeOrigin];
      else sites[activeOrigin] = 'off';
      currentSettings = await saveSettings({ enabled: currentSettings.enabled, sites });
      await refreshAfterSettingsChange();
    } catch (err) {
      console.error('GhostPrint: could not save the site exception:', err);
      renderError('Could not save settings');
    } finally {
      siteToggle.disabled = false;
      updateSiteCard();
    }
  });

  resetButton.addEventListener('click', async () => {
    resetButton.disabled = true;
    try {
      currentSettings = await resetSettings();
      await refreshAfterSettingsChange();
    } catch (err) {
      console.error('GhostPrint: could not reset settings:', err);
      renderError('Could not restore defaults');
    } finally {
      resetButton.disabled = false;
    }
  });
}

function bindActions() {
  const reloadButton = document.getElementById('reloadBtn');
  const newIdentityButton = document.getElementById('newIdentityBtn');

  reloadButton.addEventListener('click', async () => {
    if (!activeTab) return;
    reloadButton.disabled = true;
    try {
      await browser.tabs.reload(activeTab.id);
      closePopup();
    } catch (err) {
      console.error('GhostPrint: could not reload the active tab:', err);
      reloadButton.disabled = false;
    }
  });

  newIdentityButton.addEventListener('click', async () => {
    if (!activeTab || activeOrigin === null) return;
    newIdentityButton.disabled = true;
    try {
      const response = await browser.tabs.sendMessage(
        activeTab.id,
        { type: 'RESET_SEED' },
        { frameId: 0 },
      );
      if (!response || response.ok !== true) throw new Error('reset-seed-failed');
      await browser.tabs.reload(activeTab.id);
      closePopup();
    } catch (err) {
      console.error('GhostPrint: could not rotate the session seed:', err);
      renderError('Could not rotate the identity');
      newIdentityButton.disabled = false;
    }
  });
}

async function init() {
  const toggle = document.getElementById('globalToggle');
  let settingsFailed = false;
  try {
    currentSettings = await loadSettings();
  } catch (err) {
    console.error('GhostPrint: could not load settings:', err);
    currentSettings = cloneDefaultSettings();
    settingsFailed = true;
    renderError('Could not load settings');
  }

  toggle.checked = currentSettings.enabled;
  bindControls();
  bindActions();
  renderFields(currentSettings.enabled, null);
  if (settingsFailed) return;

  try {
    activeTab = await getActiveTab();
  } catch (_) {
    activeTab = null;
  }
  activeOrigin = activeTab && isSupportedTabUrl(activeTab.url)
    ? normalizeSiteOrigin(activeTab.url)
    : null;

  const injectionStatus = await queryInjectionViews();
  renderInjectionViews(injectionStatus);
}

document.addEventListener('DOMContentLoaded', () => {
  void init().catch((err) => {
    console.error('GhostPrint: popup initialization failed:', err);
    renderError('Popup initialization failed');
  });
});
