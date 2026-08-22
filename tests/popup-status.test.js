'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_SOURCE = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const POPUP_SOURCE = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

function createElement(id = null) {
  const element = {
    id,
    className: '',
    textContent: '',
    checked: false,
    disabled: false,
    hidden: false,
    children: [],
    listeners: {},
    classList: {
      contains(name) {
        return element.className.split(/\s+/).includes(name);
      },
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute() {},
  };
  return element;
}

async function loadPopup({
  injectionState = 'installed',
  surfaces = null,
  seedValue,
  settingsResponse = null,
  tabUrl = null,
} = {}) {
  const ids = [
    'globalToggle',
    'resetBtn',
    'siteCard',
    'siteOrigin',
    'siteToggle',
    'statusBanner',
    'statusIcon',
    'statusText',
    'sessionSeed',
    'protectionsList',
    'reloadBtn',
    'newIdentityBtn',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  let domReady;
  const statusRequests = [];
  const runtimeMessages = [];
  const document = {
    getElementById(id) {
      return elements[id];
    },
    createElement() {
      return createElement();
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') domReady = listener;
    },
  };
  const browser = {
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        if (settingsResponse) return settingsResponse;
        if (message && message.type === 'SET_SETTINGS') {
          return { ok: true, settings: message.settings };
        }
        return { ok: true, settings: { enabled: true } };
      },
    },
    tabs: {
      query: async () => [tabUrl ? { id: 7, url: tabUrl } : { id: 7 }],
      sendMessage: async (tabId, message, options) => {
        statusRequests.push({ tabId, message, options });
        if (message.type === 'GET_INJECTION_STATUS') {
          return surfaces
            ? { state: injectionState, surfaces }
            : { state: injectionState };
        }
        if (message.type === 'GET_SEED') return seedValue;
        return undefined;
      },
    },
  };
  const context = vm.createContext({
    browser,
    document,
    console: { error() {} },
    Promise,
    Object,
    URL,
    setTimeout,
  });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(POPUP_SOURCE, context, { filename: 'popup.js' });
  domReady();
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { elements, statusRequests, runtimeMessages };
}

test('popup reports failed page injection instead of claiming active protection', async () => {
  const { elements, statusRequests } = await loadPopup({ injectionState: 'injection-failed' });

  assert.equal(elements.statusBanner.className, 'status-banner error');
  assert.equal(elements.statusText.textContent, 'Protection unavailable, reload the page');
  assert.equal(
    statusRequests.some((request) =>
      request.message.type === 'GET_INJECTION_STATUS' && request.options.frameId === 0),
    true,
  );
});

test('protection dots reflect the real per-surface diagnostic report', async () => {
  const { elements } = await loadPopup({
    injectionState: 'installed',
    tabUrl: 'https://example.test/page',
    surfaces: { audio: 'installed', webgl2: 'ignored-key', webgpu: 'unavailable', plugins: 'failed' },
  });

  const rows = elements.protectionsList.children;
  assert.equal(rows.length, 6);
  // Reported states win over the global mirror…
  assert.match(rows[0].className, /(^| )on($| )/);          // audio: installed
  assert.match(rows[3].className, /(^| )na($| )/);          // webgpu: unavailable API
  assert.match(rows[4].className, /(^| )off($| )/);         // plugins: failed
  // …unknown surfaces fall back to mirroring the global switch.
  assert.match(rows[1].className, /(^| )on($| )/);          // canvas: no report
  assert.match(rows[5].className, /(^| )on($| )/);          // navigator: no report
});

test('reload action appears while injection is pending or failed on supported pages', async () => {
  const pending = await loadPopup({ injectionState: 'pending', tabUrl: 'https://example.test/' });
  assert.equal(pending.elements.reloadBtn.hidden, false);

  const installed = await loadPopup({ injectionState: 'installed', tabUrl: 'https://example.test/' });
  assert.equal(installed.elements.reloadBtn.hidden, true);

  const restricted = await loadPopup({ injectionState: 'injection-failed' });
  assert.equal(restricted.elements.reloadBtn.hidden, true);
});

test('per-site switch persists an override for the active origin', async () => {
  const { elements, runtimeMessages } = await loadPopup({
    injectionState: 'installed',
    tabUrl: 'https://Example.com/page',
  });

  assert.equal(elements.siteCard.hidden, false);
  assert.equal(elements.siteOrigin.textContent, 'https://example.com');
  assert.equal(elements.siteToggle.checked, true);

  elements.siteToggle.checked = false;
  await elements.siteToggle.listeners.change();

  const saved = runtimeMessages.find((message) => message.type === 'SET_SETTINGS');
  assert.equal(
    JSON.stringify(saved.settings),
    JSON.stringify({ enabled: true, sites: { 'https://example.com': 'off' } }),
  );
  assert.equal(elements.siteToggle.checked, false);
  assert.equal(elements.reloadBtn.hidden, false);
  assert.equal(elements.statusText.textContent, 'Applies after reloading the page');

  elements.siteToggle.checked = true;
  await elements.siteToggle.listeners.change();

  const restored = runtimeMessages.filter((message) => message.type === 'SET_SETTINGS').pop();
  assert.equal(
    JSON.stringify(restored.settings),
    JSON.stringify({ enabled: true, sites: {} }),
  );
  assert.equal(elements.siteToggle.checked, true);
});

test('the site control hides itself when the page is unsupported or globally off', async () => {
  const restricted = await loadPopup({ tabUrl: 'about:newtab' });
  assert.equal(restricted.elements.siteCard.hidden, true);

  const globallyOff = await loadPopup({
    settingsResponse: { ok: true, settings: { enabled: false } },
    tabUrl: 'https://example.test/',
  });
  assert.equal(globallyOff.elements.siteCard.hidden, true);
  assert.equal(globallyOff.elements.sessionSeed.textContent, '— protection off');
});

test('a per-site override is announced instead of claiming active protection', async () => {
  const { elements } = await loadPopup({ injectionState: 'disabled-site', tabUrl: 'https://example.test/' });

  assert.equal(elements.statusBanner.className, 'status-banner inactive');
  assert.equal(elements.statusText.textContent, 'Disabled on this site');
  assert.equal(elements.sessionSeed.textContent, '— off for this site');
});

test('seed line distinguishes unsupported pages from pages that need a reload', async () => {
  const unsupported = await loadPopup({ tabUrl: 'about:newtab', seedValue: 305419896 });
  assert.equal(unsupported.elements.sessionSeed.textContent, '— page not supported');

  const stale = await loadPopup({ tabUrl: 'https://example.test/', seedValue: undefined });
  assert.equal(stale.elements.sessionSeed.textContent, '— reload the page');

  const seeded = await loadPopup({ tabUrl: 'https://example.test/', seedValue: 305419896 });
  assert.equal(seeded.elements.sessionSeed.textContent, '0x12345678');
});
