'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const SEED_SOURCE_PATH = path.resolve(__dirname, '..', 'seed.js');

function loadSeedContext({ stored = null, randomValues = [], persist = true } = {}) {
  const source = fs.readFileSync(SEED_SOURCE_PATH, 'utf8');
  const values = new Map();
  if (stored !== null) values.set('__ghostprint_seed_v1__', stored);
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (!persist) throw new Error('storage write failed');
      values.set(key, String(value));
    },
  };
  let randomIndex = 0;
  const crypto = {
    getRandomValues(array) {
      const value = randomValues[Math.min(randomIndex, randomValues.length - 1)];
      randomIndex += 1;
      if (value === undefined) throw new Error('crypto failure');
      array[0] = value;
      return array;
    },
  };
  const context = vm.createContext({
    sessionStorage: storage,
    crypto,
    Uint32Array,
    Number,
    Math,
  });
  vm.runInContext(source, context, { filename: 'seed.js' });
  return { context, storage, values };
}

test('seed validation accepts only the documented decimal range', () => {
  const { context } = loadSeedContext();
  const valid = vm.runInContext(`[
    parseSeedValue('1'),
    parseSeedValue('4294967294')
  ]`, context);
  const invalid = vm.runInContext(`[
    parseSeedValue('0'),
    parseSeedValue('4294967295'),
    parseSeedValue('123abc'),
    parseSeedValue('1e3'),
    parseSeedValue('01'),
    parseSeedValue(''),
    parseSeedValue(null),
    parseSeedValue(undefined)
  ]`, context);

  assert.deepEqual(Array.from(valid), [1, 4294967294]);
  assert.deepEqual(Array.from(invalid), [null, null, null, null, null, null, null, null]);
});

test('seed generation uses crypto and verifies the persisted value', () => {
  const { context, values } = loadSeedContext({ randomValues: [0, 4294967295, 3141592653] });
  const seed = vm.runInContext('getOrCreateSeed(sessionStorage, crypto)', context);

  assert.equal(seed, 3141592653);
  assert.equal(values.get('__ghostprint_seed_v1__'), '3141592653');
});

test('an existing valid seed is reused without consuming crypto', () => {
  const { context, values } = loadSeedContext({ stored: '123456789', randomValues: [999] });
  const seed = vm.runInContext('getOrCreateSeed(sessionStorage, crypto)', context);

  assert.equal(seed, 123456789);
  assert.equal(values.get('__ghostprint_seed_v1__'), '123456789');
});

test('seed creation returns null when crypto or storage fails', () => {
  const cryptoFailure = loadSeedContext({ randomValues: [] });
  const storageFailure = loadSeedContext({ randomValues: [123], persist: false });

  assert.equal(vm.runInContext('getOrCreateSeed(sessionStorage, crypto)', cryptoFailure.context), null);
  assert.equal(vm.runInContext('getOrCreateSeed(sessionStorage, crypto)', storageFailure.context), null);
});
