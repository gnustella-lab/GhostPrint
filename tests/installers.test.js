'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const INJECT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', 'inject.js'),
  'utf8',
);
const { createPageContext, installInject } = require('./helpers/inject-harness');

function installWorkerLikeContext() {
  const context = vm.createContext({
    console,
    sessionStorage: {
      getItem() { return '123456789'; },
      setItem() {},
    },
    Uint8Array,
    Uint8ClampedArray,
  });
  vm.runInContext(INJECT_SOURCE, context, { filename: 'inject.js' });
  return context;
}

test('missing Canvas APIs do not block WebGL and Navigator installers', () => {
  const context = createPageContext();
  vm.runInContext('delete CanvasRenderingContext2D; delete Document;', context);

  assert.doesNotThrow(() => installInject(context));
  assert.equal(typeof context.navigator.hardwareConcurrency, 'number');
  assert.equal(context.installationResults, undefined);
});

test('missing Audio and Navigator APIs do not block Canvas', () => {
  const context = createPageContext();
  vm.runInContext(
    'delete AudioBuffer; delete OfflineAudioContext; delete AudioContext; delete AnalyserNode; delete Navigator; delete navigator;',
    context,
  );

  assert.doesNotThrow(() => installInject(context));
  const canvas = vm.runInContext('new HTMLCanvasElement()', context);
  assert.doesNotThrow(() => canvas.getContext('2d').getImageData(0, 0, 1, 1));
});

test('worker-like realms are left untouched instead of rewriting scripts', () => {
  const context = installWorkerLikeContext();
  assert.equal(context.installationResults, undefined);
});

test('re-evaluating inject.js does not stack installers in one realm', () => {
  const context = createPageContext();
  installInject(context);
  const canvas = vm.runInContext('new HTMLCanvasElement()', context);
  const gl = canvas.getContext('webgl');
  const firstGetContext = context.HTMLCanvasElement.prototype.getContext;
  const firstReadPixels = gl.readPixels;
  const firstPlugins = context.navigator.plugins;
  const firstPluginCount = firstPlugins.length;

  installInject(context);

  assert.strictEqual(context.HTMLCanvasElement.prototype.getContext, firstGetContext);
  assert.strictEqual(gl.readPixels, firstReadPixels);
  assert.strictEqual(context.navigator.plugins, firstPlugins);
  assert.equal(context.navigator.plugins.length, firstPluginCount);
});

test('an unavailable realm registry fails closed instead of stacking installers', () => {
  const context = createPageContext();
  const nativeGetContext = context.HTMLCanvasElement.prototype.getContext;
  vm.runInContext(
    "const nativeDefineProperty = Object.defineProperty; Object.defineProperty = function (target, property, descriptor) { if (target === globalThis && typeof property === 'symbol') throw new TypeError('blocked'); return nativeDefineProperty(target, property, descriptor); }",
    context,
  );

  assert.doesNotThrow(() => installInject(context));
  assert.strictEqual(context.HTMLCanvasElement.prototype.getContext, nativeGetContext);
});

test('injection uses the carried seed without page storage', () => {
  const context = createPageContext();
  const nativeGetContext = context.HTMLCanvasElement.prototype.getContext;
  let storageAccesses = 0;
  context.sessionStorage = {
    getItem() {
      storageAccesses += 1;
      throw new Error('unexpected storage read');
    },
    setItem() {
      storageAccesses += 1;
      throw new Error('unexpected storage write');
    },
  };

  assert.doesNotThrow(() => installInject(context));
  assert.notStrictEqual(context.HTMLCanvasElement.prototype.getContext, nativeGetContext);
  assert.equal(storageAccesses, 0);
});

test('idempotency registry does not use the predictable global symbol key', () => {
  const context = createPageContext();
  installInject(context);

  assert.equal(
    vm.runInContext(
      "Object.getOwnPropertySymbols(globalThis).some((symbol) => Symbol.keyFor(symbol) === 'GhostPrint.installation.v1')",
      context,
    ),
    false,
  );
});

test('navigator fallback remains available when WebIDL prototypes are locked', () => {
  const context = createPageContext();
  vm.runInContext(`
    for (const property of ['plugins', 'mimeTypes']) {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, property);
      Object.defineProperty(Navigator.prototype, property, {
        ...descriptor,
        configurable: false,
      });
    }
  `, context);

  installInject(context);

  assert.equal(vm.runInContext("Object.hasOwn(navigator, 'plugins')", context), true);
  assert.equal(vm.runInContext("Object.hasOwn(navigator, 'mimeTypes')", context), true);
  assert.equal(vm.runInContext('navigator.plugins.length > 0', context), true);
  assert.equal(vm.runInContext('navigator.mimeTypes.length > 0', context), true);
});
