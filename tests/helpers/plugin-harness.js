'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'inject.js'),
  'utf8',
);

class FakeStorage {
  constructor(seed) {
    this.seed = seed;
  }

  getItem() {
    return this.seed;
  }
}

class FakeMimeType {
  constructor(type, description, suffixes, enabledPlugin = null) {
    this.type = type;
    this.description = description;
    this.suffixes = suffixes;
    this.enabledPlugin = enabledPlugin;
  }
}

class FakePlugin {
  constructor(name, description, filename, mimeTypes = []) {
    this.name = name;
    this.description = description;
    this.filename = filename;
    this.length = mimeTypes.length;
    for (let i = 0; i < mimeTypes.length; i += 1) this[i] = mimeTypes[i];
  }

  item(index) {
    return this[index] || null;
  }

  namedItem(type) {
    for (let i = 0; i < this.length; i += 1) {
      if (this[i] && this[i].type === type) return this[i];
    }
    return null;
  }
}

class FakePluginArray {
  constructor(entries) {
    this.length = entries.length;
    for (let i = 0; i < entries.length; i += 1) this[i] = entries[i];
  }

  item(index) {
    return this[index] || null;
  }

  namedItem(name) {
    for (let i = 0; i < this.length; i += 1) {
      if (this[i] && this[i].name === name) return this[i];
    }
    return null;
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i += 1) yield this[i];
  }
}

class FakeMimeTypeArray {
  constructor(entries) {
    this.length = entries.length;
    for (let i = 0; i < entries.length; i += 1) this[i] = entries[i];
  }

  item(index) {
    return this[index] || null;
  }

  namedItem(type) {
    for (let i = 0; i < this.length; i += 1) {
      if (this[i] && this[i].type === type) return this[i];
    }
    return null;
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i += 1) yield this[i];
  }
}

function createPageContext({ seed = '123456789', duplicateNativeMime = false } = {}) {
  const nativeMime = new FakeMimeType('application/x-test', 'Test format', 'test');
  const nativePlugin = new FakePlugin(
    'Native Test Plugin',
    'Native test plugin',
    'native-test',
    [nativeMime],
  );
  nativeMime.enabledPlugin = nativePlugin;
  const duplicateMime = new FakeMimeType('application/x-test', 'Duplicate test format', 'test');
  const duplicatePlugin = new FakePlugin(
    'Duplicate Test Plugin',
    'Duplicate test plugin',
    'duplicate-test',
    [duplicateMime],
  );
  duplicateMime.enabledPlugin = duplicatePlugin;
  const nativePdfMime = new FakeMimeType('application/pdf', 'Native PDF', 'pdf');
  const nativePdfPlugin = new FakePlugin(
    'Native PDF Viewer',
    'Native PDF viewer',
    'native-pdf',
    [nativePdfMime],
  );
  nativePdfMime.enabledPlugin = nativePdfPlugin;
  const plugins = new FakePluginArray([
    nativePlugin,
    ...(duplicateNativeMime ? [duplicatePlugin] : []),
    nativePdfPlugin,
  ]);
  const mimeTypes = new FakeMimeTypeArray([
    nativeMime,
    ...(duplicateNativeMime ? [duplicateMime] : []),
    nativePdfMime,
  ]);

  class PageNavigator {
  }

  Object.defineProperties(PageNavigator.prototype, {
    plugins: { configurable: true, enumerable: true, get: () => plugins },
    mimeTypes: { configurable: true, enumerable: true, get: () => mimeTypes },
  });

  const context = {
    console,
    document: { currentScript: { src: `moz-extension://test/inject.js#seed=${seed}` } },
    navigator: new PageNavigator(),
    sessionStorage: new FakeStorage(seed),
    Navigator: PageNavigator,
    Plugin: FakePlugin,
    MimeType: FakeMimeType,
    PluginArray: FakePluginArray,
    MimeTypeArray: FakeMimeTypeArray,
    Uint8Array,
    Uint8ClampedArray,
  };
  context.window = context;
  return vm.createContext(context);
}

function installInject(context) {
  vm.runInContext(INJECT_SOURCE, context, { filename: 'inject.js' });
}

module.exports = { createPageContext, installInject };
