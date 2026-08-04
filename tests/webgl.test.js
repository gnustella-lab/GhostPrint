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

  assert.strictEqual(canvas.getContext('webgl'), firstContext);
  assert.strictEqual(canvas.getContext('webgl').readPixels, firstWrapper);
  assert.strictEqual(canvas.getContext('webgl').getExtension, firstExtensionWrapper);
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

test('distinct WebGL contexts receive distinct wrappers', () => {
  const context = createPageContext();
  installInject(context);
  const firstCanvas = new context.HTMLCanvasElement();
  const secondCanvas = new context.HTMLCanvasElement();
  const firstContext = firstCanvas.getContext('webgl');
  const secondContext = secondCanvas.getContext('webgl');

  assert.notStrictEqual(firstContext, secondContext);
  assert.notStrictEqual(firstContext.readPixels, secondContext.readPixels);

  const firstPixels = new Uint8Array(4);
  const secondPixels = new Uint8Array(4);
  firstContext.readPixels(0, 0, 1, 1, firstContext.RGBA, firstContext.UNSIGNED_BYTE, firstPixels);
  secondContext.readPixels(0, 0, 1, 1, secondContext.RGBA, secondContext.UNSIGNED_BYTE, secondPixels);

  assert.equal(firstContext.nativeReadPixelsCalls, 1);
  assert.equal(secondContext.nativeReadPixelsCalls, 1);
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

test('WebGL hides debug renderer metadata and preserves other extensions', () => {
  const context = createPageContext();
  installInject(context);
  const gl = new context.HTMLCanvasElement().getContext('webgl');

  assert.equal(gl.getExtension('WEBGL_debug_renderer_info'), null);
  assert.equal(gl.getSupportedExtensions().includes('WEBGL_debug_renderer_info'), false);
  assert.equal(gl.getSupportedExtensions().includes('OES_texture_float'), true);
  assert.equal(gl.getParameter(0x9245), null);
  assert.equal(gl.getParameter(0x9246), null);
  assert.equal(gl.getExtension('OES_texture_float').name, 'OES_texture_float');
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
