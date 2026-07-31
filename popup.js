'use strict';

// DEFAULT_SETTINGS comes from settings.js (loaded first in popup.html).

// The five fields EFF's Cover Your Tracks checks for cross-domain
// randomization. If ≥ 4 of these differ between first-party domains,
// the EFF result becomes "your browser has a randomized fingerprint".
const EFF_FIELDS = [
  { icon: '🔊', label: 'AudioContext'        },
  { icon: '🖼️', label: 'Canvas hash'         },
  { icon: '🎮', label: 'WebGL hash'          },
  { icon: '🧩', label: 'Plugins'             },
  { icon: '⚙️', label: 'Hardware concurrency' },
];

let currentSettings = null;

async function loadSettings() {
  const r = await browser.storage.local.get('settings');
  if (!r.settings) {
    await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...r.settings };
}

async function saveSettings(s) {
  await browser.storage.local.set({ settings: s });
}

async function renderSeed() {
  const el = document.getElementById('sessionSeed');
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) throw new Error('no active tab');
    const seed = await browser.tabs.sendMessage(tab.id, { type: 'GET_SEED' });
    el.textContent = (seed === undefined || seed === null)
      ? '—'
      : '0x' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  } catch (err) {
    // No content script on this page (about:, chrome://, or the page was
    // opened before the extension was loaded) or the message failed.
    // Log the real error so the popup console (right-click → Inspect) shows
    // what happened instead of a silent "—".
    console.error('GhostPrint: could not read seed of active tab:', err);
    el.textContent = '— reload the page';
  }
}

function renderStatus(enabled) {
  const banner = document.getElementById('statusBanner');
  const icon   = document.getElementById('statusIcon');
  const text   = document.getElementById('statusText');
  if (enabled) {
    banner.className = 'status-banner active';
    icon.textContent  = '🛡️';
    text.textContent  = 'Randomizing';
  } else {
    banner.className = 'status-banner inactive';
    icon.textContent  = '⚠️';
    text.textContent  = 'Disabled — reload pages';
  }
}

function renderFields(enabled) {
  const list = document.getElementById('protectionsList');
  list.innerHTML = '';
  for (const f of EFF_FIELDS) {
    const row = document.createElement('div');
    row.className = 'protection-row ' + (enabled ? 'on' : 'off');

    const left = document.createElement('div');
    left.className = 'protection-left';

    const icon = document.createElement('span');
    icon.className = 'protection-icon';
    icon.textContent = f.icon;

    const name = document.createElement('span');
    name.className = 'protection-name';
    name.textContent = f.label;

    left.appendChild(icon);
    left.appendChild(name);

    const dot = document.createElement('div');
    dot.className = 'protection-dot';

    row.appendChild(left);
    row.appendChild(dot);
    list.appendChild(row);
  }
}

async function init() {
  currentSettings = await loadSettings();

  const toggle = document.getElementById('globalToggle');
  toggle.checked = currentSettings.enabled;
  toggle.addEventListener('change', async () => {
    currentSettings.enabled = toggle.checked;
    await saveSettings(currentSettings);
    renderStatus(currentSettings.enabled);
    renderFields(currentSettings.enabled);
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    await saveSettings(currentSettings);
    toggle.checked = currentSettings.enabled;
    renderStatus(currentSettings.enabled);
    renderFields(currentSettings.enabled);
  });

  renderStatus(currentSettings.enabled);
  renderFields(currentSettings.enabled);
  renderSeed();
}

document.addEventListener('DOMContentLoaded', init);
