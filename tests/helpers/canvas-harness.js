'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'inject.js'),
  'utf8',
);

function sourcePixel(x, y, channel) {
  return 96 + ((x * 17 + y * 31 + channel * 7) % 80);
}

class FakeStorage {
  constructor(seed = '123456789') {
    this.values = new Map([['__ghostprint_seed_v1__', seed]]);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class FakeWebGLContext {
  constructor() {
    this.RGBA = 0x1908;
    this.UNSIGNED_BYTE = 0x1401;
  }

  readPixels() {}
}

function createPageContext({ seed = '123456789' } = {}) {
  let nextCanvasId = 1;

  class PageCanvas2DContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.calls = [];
      this.lastPutImageData = null;
    }

    getImageData(sx, sy, sw, sh, settings) {
      this.calls.push({ thisValue: this, args: Array.from(arguments) });
      const pixelFormat = settings && settings.pixelFormat;
      const TypedArray = pixelFormat === 'rgba-float16'
        ? Float32Array
        : Uint8ClampedArray;
      const data = new TypedArray(sw * sh * 4);
      const originX = Math.trunc(Number(sx));
      const originY = Math.trunc(Number(sy));
      for (let localY = 0; localY < sh; localY += 1) {
        for (let localX = 0; localX < sw; localX += 1) {
          const x = originX + localX;
          const y = originY + localY;
          const index = (localY * sw + localX) * 4;
          data[index] = sourcePixel(x, y, 0);
          data[index + 1] = sourcePixel(x, y, 1);
          data[index + 2] = sourcePixel(x, y, 2);
          data[index + 3] = 255;
        }
      }
      return { data, width: sw, height: sh };
    }

    drawImage(source) {
      this.drawnSource = source;
    }

    putImageData(imageData) {
      this.lastPutImageData = imageData.data.slice();
    }
  }

  class PageCanvas {
    constructor() {
      this.id = nextCanvasId;
      nextCanvasId += 1;
      this.width = 8;
      this.height = 8;
      this.context2d = new PageCanvas2DContext(this);
      this.contexts = {
        webgl: new FakeWebGLContext(),
        'experimental-webgl': new FakeWebGLContext(),
        webgl2: new FakeWebGLContext(),
      };
    }

    getContext(type) {
      if (type === '2d') return this.context2d;
      return this.contexts[type] || null;
    }

    toDataURL() {
      return `data:image/png;base64,canvas-${this.id}`;
    }

    toBlob(callback, type, quality) {
      const result = { canvasId: this.id, type, quality };
      setTimeout(() => callback(result), 0);
    }
  }

  class PageDocument {
    createElement(type) {
      if (type === 'canvas') return new PageCanvas();
      throw new Error(`unsupported element: ${type}`);
    }
  }

  class PageNavigator {
    constructor() {
      this.plugins = {
        length: 0,
        item() { return null; },
        namedItem() { return null; },
        [Symbol.iterator]: function* iterator() {},
      };
    }
  }

  const context = {
    console,
    document: new PageDocument(),
    navigator: new PageNavigator(),
    sessionStorage: new FakeStorage(seed),
    CanvasRenderingContext2D: PageCanvas2DContext,
    HTMLCanvasElement: PageCanvas,
    Document: PageDocument,
    Navigator: PageNavigator,
    Float32Array,
    Uint8ClampedArray,
    Uint8Array,
    Blob,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  return vm.createContext(context);
}

function installInject(context) {
  vm.runInContext(INJECT_SOURCE, context, { filename: 'inject.js' });
}

module.exports = {
  createPageContext,
  installInject,
  sourcePixel,
};
