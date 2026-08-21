'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPageContext, installInject } = require('./helpers/plugin-harness');

test('plugins and MIME types expose one coherent graph', () => {
  const context = createPageContext();
  installInject(context);

  const plugins = context.navigator.plugins;
  const mimeTypes = context.navigator.mimeTypes;
  const pluginEntries = Array.from(plugins);
  const mimeEntries = Array.from(mimeTypes);

  assert.ok(pluginEntries.length > 0);
  assert.strictEqual(context.navigator.plugins, plugins);
  assert.strictEqual(context.navigator.mimeTypes, mimeTypes);
  assert.equal(plugins.length, pluginEntries.length);
  assert.equal(mimeTypes.length, mimeEntries.length);

  for (const plugin of pluginEntries) {
    assert.equal(plugin instanceof context.Plugin, true);
    for (let index = 0; index < plugin.length; index += 1) {
      const mime = plugin.item(index);
      assert.strictEqual(mime, plugin[index]);
      assert.strictEqual(plugin.namedItem(mime.type), mime);
      assert.strictEqual(mime.enabledPlugin, plugin);
      assert.equal(mime instanceof context.MimeType, true);
      assert.equal(mimeEntries.includes(mime), true);
      assert.strictEqual(mimeTypes.namedItem(mime.type), mime);
    }
  }

  for (let index = 0; index < mimeTypes.length; index += 1) {
    assert.strictEqual(mimeTypes.item(index), mimeTypes[index]);
  }

  const pdfPlugins = pluginEntries.filter((plugin) => {
    for (let index = 0; index < plugin.length; index += 1) {
      if (plugin.item(index).type === 'application/pdf') return true;
    }
    return false;
  });
  const pdfMimes = mimeEntries.filter((mime) => mime.type === 'application/pdf');
  assert.equal(pdfPlugins.length, 1);
  assert.equal(pdfMimes.length, 1);
  assert.strictEqual(pdfMimes[0].enabledPlugin, pdfPlugins[0]);
});

test('plugin and MIME list methods remain stable across reads', () => {
  const context = createPageContext();
  installInject(context);
  const plugins = context.navigator.plugins;
  const mimeTypes = context.navigator.mimeTypes;

  assert.strictEqual(plugins.item, plugins.item);
  assert.strictEqual(plugins.namedItem, plugins.namedItem);
  assert.strictEqual(mimeTypes.item, mimeTypes.item);
  assert.strictEqual(mimeTypes.namedItem, mimeTypes.namedItem);
  assert.deepEqual(Array.from(plugins), Array.from(plugins));
  assert.deepEqual(Array.from(mimeTypes), Array.from(mimeTypes));
});

test('plugins and MIME types preserve prototype location and named properties', () => {
  const context = createPageContext();
  installInject(context);
  const plugins = context.navigator.plugins;
  const mimeTypes = context.navigator.mimeTypes;
  const plugin = Array.from(plugins).find((entry) => entry.item(0).type === 'application/pdf');
  const mime = plugin.item(0);

  assert.equal(Object.hasOwn(context.navigator, 'plugins'), false);
  assert.equal(Object.hasOwn(context.navigator, 'mimeTypes'), false);
  assert.strictEqual(plugins[plugin.name], plugin);
  assert.strictEqual(mimeTypes[mime.type], mime);
  assert.strictEqual(plugin[mime.type], mime);
  assert.equal(Object.getOwnPropertyNames(plugins).includes(plugin.name), true);
  assert.equal(Object.getOwnPropertyNames(mimeTypes).includes(mime.type), true);
  assert.equal(Object.keys(plugin).includes('name'), false);
  assert.equal(Object.keys(plugin).includes('description'), false);
  assert.equal(Object.keys(plugin).includes('filename'), false);
  assert.equal(Object.keys(mime).length, 0);
});

test('plugin and MIME methods apply a receiver brand check', () => {
  const context = createPageContext();
  installInject(context);
  const plugins = context.navigator.plugins;
  const mimeTypes = context.navigator.mimeTypes;
  const plugin = Array.from(plugins).find((entry) => entry.item(0).type === 'application/pdf');

  const isIllegalInvocation = (error) => error && error.name === 'TypeError';
  assert.throws(() => plugins.item.call({}, 0), isIllegalInvocation);
  assert.throws(() => mimeTypes.namedItem.call({}, 'application/x-test'), isIllegalInvocation);
  assert.throws(() => plugin.item.call({}, 0), isIllegalInvocation);
});

test('global MIME types are canonicalized by type', () => {
  const context = createPageContext({ duplicateNativeMime: true });
  installInject(context);
  const types = Array.from(context.navigator.mimeTypes, (mime) => mime.type);

  assert.equal(types.length, new Set(types).size);
  assert.strictEqual(
    context.navigator.mimeTypes.namedItem('application/x-test'),
    context.navigator.mimeTypes.item(0),
  );
});

test('filtered PDF plugins retain non-PDF MIME types with an exposed owner', () => {
  const context = createPageContext();
  const nativePlugins = context.navigator.plugins;
  const nativeMimeTypes = context.navigator.mimeTypes;
  const nativePdfPlugin = nativePlugins.namedItem('Native PDF Viewer');
  const extraMime = new context.MimeType(
    'application/x-pdf-extra',
    'Extra PDF companion format',
    'xpdf',
    nativePdfPlugin,
  );
  nativePdfPlugin[1] = extraMime;
  nativePdfPlugin.length = 2;
  nativeMimeTypes[nativeMimeTypes.length] = extraMime;
  nativeMimeTypes.length += 1;

  installInject(context);

  const plugins = Array.from(context.navigator.plugins);
  const mime = context.navigator.mimeTypes.namedItem('application/x-pdf-extra');
  assert.ok(mime);
  assert.equal(plugins.includes(mime.enabledPlugin), true);
  assert.equal(
    Array.from(mime.enabledPlugin).some((entry) => entry.type === mime.type),
    true,
  );
});

test('duplicate native MIME claims do not orphan a plugin MIME record', () => {
  const context = createPageContext({ duplicateNativeMime: true });
  installInject(context);

  const plugins = Array.from(context.navigator.plugins);
  const mimeTypes = Array.from(context.navigator.mimeTypes);
  for (const plugin of plugins) {
    for (let index = 0; index < plugin.length; index += 1) {
      const mime = plugin.item(index);
      assert.equal(mimeTypes.includes(mime), true, `${plugin.name}:${mime.type}`);
      assert.strictEqual(mime.enabledPlugin, plugin, `${plugin.name}:${mime.type}`);
    }
  }
});
