'use strict';

const EFF_FIELDS = [
  { icon: '🔊', label: 'Áudio' },
  { icon: '🖼️', label: 'Hash do Canvas' },
  { icon: '🎮', label: 'Hash do WebGL' },
  { icon: '🧩', label: 'Plugins / tipos MIME' },
  { icon: '⚙️', label: 'Concorrência de hardware' },
];

let currentSettings = cloneDefaultSettings();

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

async function renderSeed() {
  const el = document.getElementById('sessionSeed');
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) throw new Error('no active tab');
    const seed = await browser.tabs.sendMessage(tab.id, { type: 'GET_SEED' }, { frameId: 0 });
    el.textContent = (seed === undefined || seed === null)
      ? '— indisponível'
      : '0x' + (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  } catch (err) {
    console.error('GhostPrint: could not read seed of active tab:', err);
    el.textContent = '— recarregue a página';
  }
}

function renderStatus(enabled) {
  const banner = document.getElementById('statusBanner');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  banner.className = enabled ? 'status-banner active' : 'status-banner inactive';
  icon.textContent = enabled ? '🛡️' : '⚠️';
  text.textContent = enabled ? 'Randomizando, recarregue as páginas' : 'Desativado, recarregue as páginas';
}

function renderError(message) {
  const banner = document.getElementById('statusBanner');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  banner.className = 'status-banner error';
  icon.textContent = '⚠️';
  text.textContent = message;
}

function renderFields(enabled) {
  const list = document.getElementById('protectionsList');
  list.replaceChildren();
  for (const field of EFF_FIELDS) {
    const row = document.createElement('div');
    row.className = 'protection-row ' + (enabled ? 'on' : 'off');

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

function bindControls() {
  const toggle = document.getElementById('globalToggle');
  const resetButton = document.getElementById('resetBtn');

  toggle.addEventListener('change', async () => {
    const requested = toggle.checked;
    toggle.disabled = true;
    try {
      currentSettings = await saveSettings({ enabled: requested });
      toggle.checked = currentSettings.enabled;
      renderStatus(currentSettings.enabled);
      renderFields(currentSettings.enabled);
    } catch (err) {
      console.error('GhostPrint: could not save settings:', err);
      toggle.checked = currentSettings.enabled;
      renderError('Não foi possível salvar a configuração');
    } finally {
      toggle.disabled = false;
    }
  });

  resetButton.addEventListener('click', async () => {
    resetButton.disabled = true;
    try {
      currentSettings = await resetSettings();
      toggle.checked = currentSettings.enabled;
      renderStatus(currentSettings.enabled);
      renderFields(currentSettings.enabled);
    } catch (err) {
      console.error('GhostPrint: could not reset settings:', err);
      renderError('Não foi possível restaurar os padrões');
    } finally {
      resetButton.disabled = false;
    }
  });
}

async function init() {
  const toggle = document.getElementById('globalToggle');
  try {
    currentSettings = await loadSettings();
  } catch (err) {
    console.error('GhostPrint: could not load settings:', err);
    currentSettings = cloneDefaultSettings();
    renderError('Não foi possível carregar a configuração');
  }

  toggle.checked = currentSettings.enabled;
  bindControls();
  renderFields(currentSettings.enabled);
  if (document.getElementById('statusBanner').classList.contains('error') === false) {
    renderStatus(currentSettings.enabled);
  }
  void renderSeed();
}

document.addEventListener('DOMContentLoaded', () => {
  void init().catch((err) => {
    console.error('GhostPrint: popup initialization failed:', err);
    renderError('Falha ao inicializar o popup');
  });
});
