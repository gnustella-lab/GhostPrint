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

async function loadPopup({ injectionState }) {
  const ids = [
    'globalToggle',
    'resetBtn',
    'statusBanner',
    'statusIcon',
    'statusText',
    'sessionSeed',
    'protectionsList',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  let domReady;
  const statusRequests = [];
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
      sendMessage: async (message) => ({ ok: true, settings: { enabled: true }, message }),
    },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (tabId, message, options) => {
        statusRequests.push({ tabId, message, options });
        if (message.type === 'GET_INJECTION_STATUS') return { state: injectionState };
        return undefined;
      },
    },
  };
  const context = vm.createContext({
    browser,
    document,
    console: { error() {} },
    Promise,
    setTimeout,
  });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(POPUP_SOURCE, context, { filename: 'popup.js' });
  domReady();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { elements, statusRequests };
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
