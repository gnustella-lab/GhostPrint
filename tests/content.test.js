'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_SOURCE = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const SEED_SOURCE = fs.readFileSync(path.join(ROOT, 'seed.js'), 'utf8');
const CONTENT_SOURCE = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

// Deterministic tokens produced by the fake crypto source below: it writes
// randomValue into byte 0 and leaves the remaining 15 bytes at zero.
const TOKEN_FOR_42 = '2a000000000000000000000000000000';
const TOKEN_FOR_3141592653 = '4d000000000000000000000000000000';

async function runContent({
  settingsResponse,
  settingsReject = false,
  randomValue = 123456789,
  storageWritable = true,
  storageRemovable = true,
  location = null,
} = {}) {
  const values = new Map();
  const appended = [];
  const sentMessages = [];
  const messageListeners = [];
  let seedListener;
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => {
      if (!storageWritable) throw new Error('storage failed');
      values.set(key, String(value));
    },
    removeItem: (key) => {
      if (!storageRemovable) throw new Error('storage remove failed');
      values.delete(key);
    },
  };
  const document = {
    head: { appendChild: (script) => appended.push(script) },
    documentElement: { appendChild: (script) => appended.push(script) },
    createElement: () => ({
      remove() { this.removed = true; },
      src: '',
    }),
  };
  const runtime = {
    getURL: (value) => `moz-extension://test/${value}`,
    sendMessage: async (message) => {
      sentMessages.push(message);
      if (settingsReject) throw new Error('settings failed');
      return settingsResponse;
    },
    onMessage: { addListener: (listener) => { seedListener = listener; } },
  };
  const crypto = {
    getRandomValues: (array) => {
      array[0] = randomValue;
      return array;
    },
  };
  const windowMock = {
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'message') return;
      const index = messageListeners.indexOf(listener);
      if (index >= 0) messageListeners.splice(index, 1);
    },
  };
  const sandbox = {
    browser: { runtime },
    document,
    sessionStorage: storage,
    crypto,
    window: windowMock,
    Promise,
    Uint32Array,
    Uint8Array,
    Number,
    Math,
    console,
  };
  if (location) sandbox.location = location;
  const context = vm.createContext(sandbox);
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(SEED_SOURCE, context, { filename: 'seed.js' });
  vm.runInContext(CONTENT_SOURCE, context, { filename: 'content.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    values,
    appended,
    sentMessages,
    seedListener,
    messageListeners,
    window: windowMock,
  };
}

test('disabled protection does not create a seed or inject hooks', async () => {
  const result = await runContent({ settingsResponse: { ok: true, settings: { enabled: false } } });

  assert.equal(result.values.has('__ghostprint_seed_v1__'), false);
  assert.equal(result.appended.length, 0);
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), undefined);
});

test('enabled protection persists one verified crypto seed before injection', async () => {
  const result = await runContent({ settingsResponse: { ok: true, settings: { enabled: true } }, randomValue: 3141592653 });

  assert.equal(result.values.get('__ghostprint_seed_v1__'), '3141592653');
  assert.equal(result.appended.length, 1);
  assert.equal(
    result.appended[0].src,
    `moz-extension://test/inject.js#seed=3141592653&report=${TOKEN_FOR_3141592653}`,
  );
  assert.equal(result.appended[0].removed, undefined);
  assert.equal(typeof result.appended[0].onload, 'function');
  result.appended[0].onload();
  assert.equal(result.appended[0].removed, true);
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), 3141592653);
});

test('the diagnostic channel listener is armed before the script element connects', async () => {
  const result = await runContent({ settingsResponse: { ok: true, settings: { enabled: true } }, randomValue: 42 });

  assert.equal(result.messageListeners.length, 1);
  assert.equal(result.appended.length, 1);
});

test('settings failure fails safe to enabled protection', async () => {
  const result = await runContent({ settingsReject: true, randomValue: 42 });

  assert.equal(result.sentMessages[0].type, 'GET_SETTINGS');
  assert.equal(result.values.get('__ghostprint_seed_v1__'), '42');
  assert.equal(result.appended.length, 1);
});

test('seed persistence failure prevents partial injection', async () => {
  const result = await runContent({ settingsResponse: { ok: true, settings: { enabled: true } }, storageWritable: false });

  assert.equal(result.appended.length, 0);
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), undefined);
});

test('injection failure invalidates the seed exposed to the popup', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });

  result.appended[0].onerror();

  assert.equal(result.appended[0].removed, true);
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), undefined);
  const status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(status.state, 'injection-failed');
  assert.equal(status.seed, undefined);
});

test('injection is not reported as installed before the page script loads', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });

  const beforeLoad = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  result.appended[0].onload();
  const afterLoad = await result.seedListener({ type: 'GET_INJECTION_STATUS' });

  assert.equal(beforeLoad.state, 'pending');
  assert.equal(afterLoad.state, 'installed');
});

test('GET_SETTINGS carries the page origin only when one exists', async () => {
  const withOrigin = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
    location: { protocol: 'https:', origin: 'https://example.com' },
  });
  assert.equal(withOrigin.sentMessages.length, 1);
  assert.equal(withOrigin.sentMessages[0].type, 'GET_SETTINGS');
  assert.equal(withOrigin.sentMessages[0].origin, 'https://example.com');

  const withoutOrigin = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });
  assert.equal(withoutOrigin.sentMessages.length, 1);
  assert.equal('origin' in withoutOrigin.sentMessages[0], false);
});

test('a per-site override disables injection while protection stays globally on', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true }, siteEnabled: false },
    randomValue: 42,
    location: { protocol: 'https:', origin: 'https://example.com' },
  });

  assert.equal(result.values.has('__ghostprint_seed_v1__'), false);
  assert.equal(result.appended.length, 0);
  const status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(status.state, 'disabled-site');
  assert.equal(status.seed, undefined);
  assert.equal(status.origin, 'https://example.com');
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), undefined);
});

test('RESET_SEED clears the stored session seed for the next navigation', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });
  assert.equal(result.values.has('__ghostprint_seed_v1__'), true);

  const cleared = await result.seedListener({ type: 'RESET_SEED' });
  assert.equal(cleared.ok, true);
  assert.equal(result.values.has('__ghostprint_seed_v1__'), false);
});

test('RESET_SEED reports failure when session storage rejects removals', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
    storageRemovable: false,
  });

  const cleared = await result.seedListener({ type: 'RESET_SEED' });
  assert.equal(cleared.ok, false);
});

test('diagnostic report accepts one tokened message from the page window and detaches', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });
  assert.equal(result.messageListeners.length, 1);
  const handler = result.messageListeners[0];

  handler({
    source: result.window,
    data: { __ghostprintReport: 'f'.repeat(32), results: { canvas: 'installed' } },
  });
  let status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(status.surfaces, undefined);
  assert.equal(result.messageListeners.length, 1);

  handler({
    source: {},
    data: { __ghostprintReport: TOKEN_FOR_42, results: { canvas: 'failed' } },
  });
  status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(status.surfaces, undefined);
  assert.equal(result.messageListeners.length, 1);

  handler({
    source: result.window,
    data: {
      __ghostprintReport: TOKEN_FOR_42,
      results: { canvas: 'installed', webgl: 'failed', evil: 'installed', navigator: 'bogus' },
    },
  });
  status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(JSON.stringify(status.surfaces), JSON.stringify({ canvas: 'installed', webgl: 'failed' }));
  assert.equal(result.messageListeners.length, 0);
});

test('malformed diagnostic payloads never replace the surface map', async () => {
  const result = await runContent({
    settingsResponse: { ok: true, settings: { enabled: true } },
    randomValue: 42,
  });
  const handler = result.messageListeners[0];

  // A message carrying the valid token consumes the one-shot channel even
  // when its payload is garbage; the surface map must stay untouched.
  handler({ source: result.window, data: { __ghostprintReport: TOKEN_FOR_42 } });
  handler({ source: result.window, data: { __ghostprintReport: TOKEN_FOR_42, results: 'all installed' } });
  handler({ source: result.window, data: { __ghostprintReport: TOKEN_FOR_42, results: [] } });
  handler({ source: result.window, data: null });

  const status = await result.seedListener({ type: 'GET_INJECTION_STATUS' });
  assert.equal(status.surfaces, undefined);
  assert.equal(result.messageListeners.length, 0);
});
