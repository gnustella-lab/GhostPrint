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

async function runContent({ settingsResponse, settingsReject = false, randomValue = 123456789, storageWritable = true } = {}) {
  const values = new Map();
  const appended = [];
  let seedListener;
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => {
      if (!storageWritable) throw new Error('storage failed');
      values.set(key, String(value));
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
    sendMessage: () => settingsReject ? Promise.reject(new Error('settings failed')) : Promise.resolve(settingsResponse),
    onMessage: { addListener: (listener) => { seedListener = listener; } },
  };
  const crypto = {
    getRandomValues: (array) => {
      array[0] = randomValue;
      return array;
    },
  };
  const context = vm.createContext({
    browser: { runtime },
    document,
    sessionStorage: storage,
    crypto,
    Promise,
    Uint32Array,
    Number,
    Math,
    console,
  });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(SEED_SOURCE, context, { filename: 'seed.js' });
  vm.runInContext(CONTENT_SOURCE, context, { filename: 'content.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { values, appended, seedListener };
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
  assert.equal(result.appended[0].src, 'moz-extension://test/inject.js#seed=3141592653');
  assert.equal(result.appended[0].removed, undefined);
  assert.equal(typeof result.appended[0].onload, 'function');
  result.appended[0].onload();
  assert.equal(result.appended[0].removed, true);
  assert.equal(await result.seedListener({ type: 'GET_SEED' }), 3141592653);
});

test('settings failure fails safe to enabled protection', async () => {
  const result = await runContent({ settingsReject: true, randomValue: 42 });

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
