'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_SOURCE = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function loadSettingsContext() {
  const context = vm.createContext({ Object, Array, Boolean, Number, String });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  return context;
}

function loadBackgroundContext({ initial = undefined, failGet = false, failSet = false } = {}) {
  let stored = initial;
  const listeners = {};
  const browser = {
    storage: {
      local: {
        get: async () => {
          if (failGet) throw new Error('get failed');
          return stored === undefined ? {} : { settings: stored };
        },
        set: async (value) => {
          if (failSet) throw new Error('set failed');
          stored = value.settings;
        },
      },
    },
    runtime: {
      getURL: (value) => `moz-extension://test/${value}`,
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
    },
  };
  const context = vm.createContext({ browser, Promise, Object, Array, Boolean, Number, String });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return {
    context,
    getStored: () => stored,
    send: (message, sender = { url: 'moz-extension://test/popup.html' }) =>
      listeners.message(message, sender),
  };
}

function loadDeferredBackgroundContext() {
  let stored = { enabled: 'invalid' };
  const pendingGets = [];
  const pendingSets = [];
  const listeners = {};
  const browser = {
    storage: {
      local: {
        get: () => new Promise((resolve) => pendingGets.push({ resolve })),
        set: (value) => new Promise((resolve) => {
          pendingSets.push({
            value,
            resolve: () => {
              stored = value.settings;
              resolve();
            },
          });
        }),
      },
    },
    runtime: {
      getURL: (value) => `moz-extension://test/${value}`,
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
    },
  };
  const context = vm.createContext({ browser, Promise, Object, Array, Boolean, Number, String, setTimeout });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return {
    get: () => stored,
    pendingGets,
    pendingSets,
    send: (message, sender = { url: 'moz-extension://test/popup.html' }) =>
      listeners.message(message, sender),
  };
}

test('settings helpers clone defaults and remove unknown properties', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`({
    normalized: normalizeSettings({ enabled: false, unexpected: true }),
    fallback: normalizeSettings({ enabled: 'yes' }),
    valid: validateSettings({ enabled: true, unexpected: true }),
    invalid: validateSettings({ enabled: 'yes' })
  })`, context);

  assert.equal(JSON.stringify(result.normalized), JSON.stringify({ enabled: false }));
  assert.equal(JSON.stringify(result.fallback), JSON.stringify({ enabled: true }));
  assert.equal(JSON.stringify(result.valid), JSON.stringify({ valid: true, settings: { enabled: true } }));
  assert.equal(JSON.stringify(result.invalid), JSON.stringify({ valid: false, settings: null }));
});

test('GET_SETTINGS repairs invalid persisted state', async () => {
  const background = loadBackgroundContext({ initial: { enabled: false, extra: 'remove me' } });
  const response = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(JSON.stringify(response), JSON.stringify({ ok: true, settings: { enabled: false } }));
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: false }));
});

test('SET_SETTINGS rejects invalid payloads and accepts only the schema', async () => {
  const background = loadBackgroundContext();
  const invalid = await background.send({ type: 'SET_SETTINGS', settings: { enabled: 'true' } });
  const valid = await background.send({ type: 'SET_SETTINGS', settings: { enabled: false, ignored: 1 } });

  assert.equal(JSON.stringify(invalid), JSON.stringify({ ok: false, error: 'invalid-settings' }));
  assert.equal(JSON.stringify(valid), JSON.stringify({ ok: true, settings: { enabled: false } }));
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: false }));
});

test('storage failures are returned as structured errors', async () => {
  const readFailure = loadBackgroundContext({ failGet: true });
  const writeFailure = loadBackgroundContext({ failSet: true });

  assert.equal(JSON.stringify(await readFailure.send({ type: 'GET_SETTINGS' })), JSON.stringify({ ok: false, error: 'storage-read-failed' }));
  assert.equal(JSON.stringify(await writeFailure.send({ type: 'SET_SETTINGS', settings: { enabled: false } })), JSON.stringify({ ok: false, error: 'storage-write-failed' }));
  assert.equal(JSON.stringify(await writeFailure.send({ type: 'RESET_SETTINGS' })), JSON.stringify({ ok: false, error: 'storage-write-failed' }));
});

test('settings repair cannot overwrite a concurrent explicit write', async () => {
  const background = loadDeferredBackgroundContext();
  const getPromise = background.send({ type: 'GET_SETTINGS' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  background.pendingGets.shift().resolve({ settings: { enabled: 'invalid' } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const setPromise = background.send({ type: 'SET_SETTINGS', settings: { enabled: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(background.pendingSets.length, 1);

  background.pendingSets[0].resolve();
  const getResult = await getPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(background.pendingSets.length, 2);
  background.pendingSets[1].resolve();
  const setResult = await setPromise;

  assert.equal(JSON.stringify(setResult), JSON.stringify({ ok: true, settings: { enabled: false } }));
  assert.equal(JSON.stringify(getResult), JSON.stringify({ ok: true, settings: { enabled: true } }));
  assert.equal(JSON.stringify(background.get()), JSON.stringify({ enabled: false }));
});

test('unknown messages and unauthorized extension-page senders are rejected', async () => {
  const background = loadBackgroundContext();

  assert.equal(JSON.stringify(await background.send({ type: 'UNKNOWN' })), JSON.stringify({ ok: false, error: 'unknown-message' }));
  assert.equal(JSON.stringify(await background.send({ type: 'GET_SETTINGS' }, { url: 'https://example.test/' })), JSON.stringify({ ok: false, error: 'unauthorized-sender' }));
});
