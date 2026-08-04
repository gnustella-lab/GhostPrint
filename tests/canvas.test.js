'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPageContext,
  installInject,
  sourcePixel,
} = require('./helpers/canvas-harness');

test('getImageData forwards optional settings and preserves this', () => {
  const context = createPageContext();
  installInject(context);
  const canvas = new context.HTMLCanvasElement();
  const renderingContext = canvas.getContext('2d');
  const settings = { colorSpace: 'display-p3' };

  renderingContext.getImageData(0, 0, 1, 1, settings);

  assert.equal(renderingContext.calls.length, 1);
  assert.strictEqual(renderingContext.calls[0].thisValue, renderingContext);
  assert.deepEqual(renderingContext.calls[0].args, [0, 0, 1, 1, settings]);
});

test('overlapping reads farble the same physical pixel identically', () => {
  const context = createPageContext();
  installInject(context);
  const renderingContext = new context.HTMLCanvasElement().getContext('2d');
  const full = renderingContext.getImageData(0, 0, 8, 8).data;
  const crop = renderingContext.getImageData(2, 2, 4, 4).data;

  for (let localY = 0; localY < 4; localY += 1) {
    for (let localX = 0; localX < 4; localX += 1) {
      const fullIndex = ((localY + 2) * 8 + localX + 2) * 4;
      const cropIndex = (localY * 4 + localX) * 4;
      assert.deepEqual(
        Array.from(crop.slice(cropIndex, cropIndex + 4)),
        Array.from(full.slice(fullIndex, fullIndex + 4)),
      );
    }
  }
});

test('unsupported float16-like ImageData is returned without byte farbling', () => {
  const context = createPageContext();
  installInject(context);
  const renderingContext = new context.HTMLCanvasElement().getContext('2d');
  const imageData = renderingContext.getImageData(1, 2, 1, 1, {
    pixelFormat: 'rgba-float16',
  });

  assert.ok(imageData.data instanceof Float32Array);
  assert.deepEqual(Array.from(imageData.data), [
    sourcePixel(1, 2, 0),
    sourcePixel(1, 2, 1),
    sourcePixel(1, 2, 2),
    255,
  ]);
});

test('concurrent toBlob calls use isolated temporary canvases', async () => {
  const context = createPageContext();
  installInject(context);
  const canvas = new context.HTMLCanvasElement();

  const blobs = await Promise.all([
    new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.5)),
    new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8)),
  ]);

  assert.notEqual(blobs[0].canvasId, blobs[1].canvasId);
  assert.equal(blobs[0].type, 'image/png');
  assert.equal(blobs[1].type, 'image/webp');
});
