'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPageContext,
  installInject,
  readPixelsAfterGetContextCalls,
} = require('./helpers/inject-harness');

test('repeated getContext calls do not stack readPixels farbling', () => {
  const once = readPixelsAfterGetContextCalls({ getContextCalls: 1 });
  const repeated = readPixelsAfterGetContextCalls({ getContextCalls: 3 });

  assert.equal(once.nativeReadPixelsCalls, 1);
  assert.equal(repeated.nativeReadPixelsCalls, 1);
  assert.equal(repeated.bytes.equals(once.bytes), true);
});

test('the same WebGL context keeps one stable wrapper', () => {
  const context = createPageContext();
  installInject(context);
  const canvas = new context.HTMLCanvasElement();

  const firstContext = canvas.getContext('webgl');
  const firstWrapper = firstContext.readPixels;
  const firstExtensionWrapper = firstContext.getExtension;
  const firstSupportedExtensionsWrapper = firstContext.getSupportedExtensions;
  const firstParameterWrapper = firstContext.getParameter;

  assert.strictEqual(canvas.getContext('webgl'), firstContext);
  assert.strictEqual(canvas.getContext('webgl').readPixels, firstWrapper);
  assert.strictEqual(canvas.getContext('webgl').getExtension, firstExtensionWrapper);
  assert.strictEqual(
    canvas.getContext('webgl').getSupportedExtensions,
    firstSupportedExtensionsWrapper,
  );
  assert.strictEqual(canvas.getContext('webgl').getParameter, firstParameterWrapper);
});

test('getContext forwards the exact argument list', () => {
  const context = createPageContext();
  installInject(context);
  const canvas = new context.HTMLCanvasElement();
  const attributes = { antialias: false };

  canvas.getContext('webgl');
  assert.deepEqual(canvas.lastGetContextArgs, ['webgl']);

  canvas.getContext('webgl2', attributes);
  assert.deepEqual(canvas.lastGetContextArgs, ['webgl2', attributes]);
});

test('WebGL 1 and WebGL 2 are independently idempotent', () => {
  for (const type of ['webgl', 'webgl2']) {
    const once = readPixelsAfterGetContextCalls({ type, getContextCalls: 1 });
    const repeated = readPixelsAfterGetContextCalls({ type, getContextCalls: 2 });

    assert.equal(repeated.nativeReadPixelsCalls, 1, type);
    assert.equal(repeated.bytes.equals(once.bytes), true, type);
  }
});

test('distinct WebGL contexts share one prototype wrapper without sharing output buffers', () => {
  const context = createPageContext();
  installInject(context);
  const firstCanvas = new context.HTMLCanvasElement();
  const secondCanvas = new context.HTMLCanvasElement();
  const firstContext = firstCanvas.getContext('webgl');
  const secondContext = secondCanvas.getContext('webgl');

  assert.notStrictEqual(firstContext, secondContext);
  assert.strictEqual(firstContext.readPixels, secondContext.readPixels);

  const firstPixels = new Uint8Array(4);
  const secondPixels = new Uint8Array(4);
  firstContext.readPixels(0, 0, 1, 1, firstContext.RGBA, firstContext.UNSIGNED_BYTE, firstPixels);
  secondContext.readPixels(0, 0, 1, 1, secondContext.RGBA, secondContext.UNSIGNED_BYTE, secondPixels);

  assert.equal(firstContext.nativeReadPixelsCalls, 1);
  assert.equal(secondContext.nativeReadPixelsCalls, 1);
});

test('prototype hooks protect contexts obtained through a saved native getContext reference', () => {
  const context = createPageContext();
  const savedGetContext = context.HTMLCanvasElement.prototype.getContext;
  installInject(context);
  const canvas = new context.HTMLCanvasElement();
  const gl = savedGetContext.call(canvas, 'webgl');
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

  assert.equal(gl.getParameter(gl.VENDOR), 'Mozilla');
  assert.equal(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL), 'Mozilla');
  assert.equal(
    gl.getSupportedExtensions().some((name) => name.startsWith('EXT_') &&
      !['WEBGL_debug_renderer_info', 'OES_texture_float'].includes(name)),
    true,
  );

  const pixels = new Uint8Array(128 * 128 * 4);
  gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  assert.equal(pixels.some((value, index) => index % 4 !== 3 && value !== 100), true);
});

test('prototype hooks protect a context created before installation when native methods were not saved', () => {
  const context = createPageContext();
  const gl = new context.HTMLCanvasElement().getContext('webgl2');
  installInject(context);
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

  assert.equal(gl.getParameter(gl.VENDOR), 'Mozilla');
  assert.equal(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL), 'Mozilla');
  assert.ok(gl.getSupportedExtensions().at(-1).startsWith('EXT_'));
});

test('OffscreenCanvas WebGL and WebGL2 contexts receive the same protection', () => {
  const context = createPageContext();
  installInject(context);

  for (const type of ['webgl', 'experimental-webgl', 'webgl2']) {
    const canvas = new context.OffscreenCanvas(16, 16);
    const first = canvas.getContext(type);
    const readPixels = first.readPixels;
    const extensions = first.getSupportedExtensions();
    const synthetic = extensions.find((name) =>
      !['WEBGL_debug_renderer_info', 'OES_texture_float'].includes(name));

    assert.strictEqual(canvas.getContext(type), first, type);
    assert.strictEqual(first.readPixels, readPixels, type);
    assert.equal(first.getParameter(first.VENDOR), 'Mozilla', type);
    assert.equal(typeof synthetic, 'string', type);
    assert.strictEqual(first.getExtension(synthetic), first.getExtension(synthetic), type);
  }
});

test('getContext fallback protects instances when WebGL constructors are not exposed', () => {
  const context = createPageContext();
  delete context.WebGLRenderingContext;
  delete context.WebGL2RenderingContext;
  installInject(context);
  const gl = new context.HTMLCanvasElement().getContext('webgl');
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const extensions = gl.getSupportedExtensions();

  assert.equal(gl.getParameter(gl.VENDOR), 'Mozilla');
  assert.equal(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL), 'Mozilla');
  assert.equal(extensions.length, gl.supportedExtensions.length + 1);
  assert.strictEqual(gl.getExtension(extensions.at(-1)), gl.getExtension(extensions.at(-1)));
});

test('unsupported RGBA formats and types remain untouched', () => {
  const context = createPageContext();
  installInject(context);
  const gl = new context.HTMLCanvasElement().getContext('webgl');

  const rgbPixels = new Uint8Array(4);
  const floatPixels = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, 0x1907, gl.UNSIGNED_BYTE, rgbPixels);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, 0x1406, floatPixels);

  assert.deepEqual(Array.from(rgbPixels), [100, 100, 100, 255]);
  assert.deepEqual(Array.from(floatPixels), [100, 100, 100, 255]);
});

test('WebGL2 dstOffset limits farbling to the native output range', () => {
  const context = createPageContext();
  installInject(context);
  const gl = new context.HTMLCanvasElement().getContext('webgl2');
  const width = 32;
  const height = 32;
  const dstOffset = 257;
  const outputBytes = width * height * 4;
  const pixels = new Uint8Array(dstOffset + outputBytes + 257);
  pixels.fill(17);

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels, dstOffset);

  assert.deepEqual(Array.from(pixels.slice(0, dstOffset)), new Array(dstOffset).fill(17));
  assert.deepEqual(
    Array.from(pixels.slice(dstOffset + outputBytes)),
    new Array(257).fill(17),
  );
  assert.equal(gl.nativeReadPixelsCalls, 1);

  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  assert.deepEqual(Array.from(gl.pboBytes.slice(0, 4)), [100, 100, 100, 255]);
});

test('WebGL normalizes masked and unmasked renderer metadata without hiding the debug extension', () => {
  const context = createPageContext();
  installInject(context);

  for (const type of ['webgl', 'experimental-webgl', 'webgl2']) {
    const gl = new context.HTMLCanvasElement().getContext(type);
    assert.equal(gl.getParameter(gl.VENDOR), 'Mozilla', type);
    assert.equal(gl.getParameter(gl.RENDERER), 'Mozilla', type);
    assert.equal(gl.getParameter(0x9245), null, type);
    assert.equal(gl.getParameter(0x9246), null, type);

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    assert.equal(typeof debugInfo, 'object', type);
    assert.equal(debugInfo.UNMASKED_VENDOR_WEBGL, 0x9245, type);
    assert.equal(debugInfo.UNMASKED_RENDERER_WEBGL, 0x9246, type);
    assert.equal(gl.getSupportedExtensions().includes('WEBGL_debug_renderer_info'), true, type);
    assert.equal(gl.getSupportedExtensions().includes('OES_texture_float'), true, type);
    assert.equal(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL), 'Mozilla', type);
    assert.equal(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL), 'Mozilla', type);
    assert.equal(gl.getExtension('OES_texture_float').name, 'OES_texture_float', type);
  }
});

test('supported extensions add one seed-stable synthetic entry with a coherent cached object', () => {
  const context = createPageContext({ seed: '123456789' });
  installInject(context);
  const gl = new context.HTMLCanvasElement().getContext('webgl');
  const nativeNames = new Set(['WEBGL_debug_renderer_info', 'OES_texture_float']);

  const first = gl.getSupportedExtensions();
  const second = gl.getSupportedExtensions();
  const synthetic = first.filter((name) => !nativeNames.has(name));

  assert.notStrictEqual(first, second);
  assert.deepEqual(first, second);
  assert.equal(synthetic.length, 1);
  assert.equal(first.filter((name) => name === synthetic[0]).length, 1);

  const firstObject = gl.getExtension(synthetic[0]);
  const secondObject = gl.getExtension(synthetic[0].toLowerCase());
  assert.strictEqual(firstObject, secondObject);
  assert.deepEqual(Object.keys(firstObject), []);
  assert.match(Object.prototype.toString.call(firstObject), /^\[object [A-Za-z][A-Za-z0-9]*\]$/);
  assert.equal(gl.nativeGetSupportedExtensionsCalls, 2);
  assert.equal(gl.getExtension('EXT_definitely_not_supported'), null);
});

test('synthetic extension selection is deterministic for a seed and varies across the seed space', () => {
  function syntheticFor(seed) {
    const context = createPageContext({ seed: String(seed) });
    installInject(context);
    const list = new context.HTMLCanvasElement().getContext('webgl').getSupportedExtensions();
    return list.find((name) => !['WEBGL_debug_renderer_info', 'OES_texture_float'].includes(name));
  }

  assert.equal(syntheticFor(1001), syntheticFor(1001));
  const observed = new Set(Array.from({ length: 64 }, (_, index) => syntheticFor(index + 1)));
  assert.ok(observed.size > 1);
  assert.equal(observed.has(undefined), false);
});

test('synthetic extension selection skips a colliding real extension name', () => {
  const baselineContext = createPageContext({ seed: '424242' });
  installInject(baselineContext);
  const baseline = new baselineContext.HTMLCanvasElement().getContext('webgl');
  const selected = baseline.getSupportedExtensions().at(-1);

  const collisionContext = createPageContext({ seed: '424242' });
  installInject(collisionContext);
  const gl = new collisionContext.HTMLCanvasElement().getContext('webgl');
  gl.supportedExtensions.push(selected);
  const farbled = gl.getSupportedExtensions();

  assert.equal(farbled.filter((name) => name === selected).length, 1);
  assert.equal(farbled.length, gl.supportedExtensions.length + 1);
  assert.notEqual(farbled.at(-1), selected);
});

test('page injection uses the seed carried by the external script URL', () => {
  const directContext = createPageContext({
    seed: '123',
    currentScriptSrc: 'moz-extension://test/inject.js#seed=456',
  });
  installInject(directContext);
  const directGL = new directContext.HTMLCanvasElement().getContext('webgl');
  const directPixels = new Uint8Array(128 * 128 * 4);
  directGL.readPixels(0, 0, 128, 128, directGL.RGBA, directGL.UNSIGNED_BYTE, directPixels);

  const expectedContext = createPageContext({ seed: '456' });
  installInject(expectedContext);
  const expectedGL = new expectedContext.HTMLCanvasElement().getContext('webgl');
  const expectedPixels = new Uint8Array(128 * 128 * 4);
  expectedGL.readPixels(0, 0, 128, 128, expectedGL.RGBA, expectedGL.UNSIGNED_BYTE, expectedPixels);

  assert.deepEqual(Array.from(directPixels), Array.from(expectedPixels));
});
