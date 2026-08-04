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

  assert.strictEqual(canvas.getContext('webgl'), firstContext);
  assert.strictEqual(canvas.getContext('webgl').readPixels, firstWrapper);
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
