'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'inject.js'),
  'utf8',
);

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

class FakeCanvas2DContext {
  getImageData(_sx, _sy, sw, sh) {
    return { data: new Uint8ClampedArray(sw * sh * 4) };
  }

  drawImage() {}

  putImageData() {}
}

class FakeWebGLContext {
  constructor() {
    this.RGBA = 0x1908;
    this.UNSIGNED_BYTE = 0x1401;
    this.nativeReadPixelsCalls = 0;
  }

  readPixels(_x, _y, width, height, _format, _type, pixels) {
    this.nativeReadPixelsCalls += 1;
    for (let i = 0; i < width * height * 4; i += 4) {
      pixels[i] = 100;
      pixels[i + 1] = 100;
      pixels[i + 2] = 100;
      pixels[i + 3] = 255;
    }
  }
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.context2d = new FakeCanvas2DContext();
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
    return 'data:image/png;base64,fixture';
  }

  toBlob(callback) {
    callback(new Blob());
  }
}

class FakeDocument {
  createElement(type) {
    if (type === 'canvas') return new FakeCanvas();
    throw new Error(`unsupported element: ${type}`);
  }
}

class FakeNavigator {
  constructor() {
    this.plugins = {
      length: 0,
      item() { return null; },
      namedItem() { return null; },
      [Symbol.iterator]: function* iterator() {},
    };
  }
}

function createPageContext({ seed = '123456789' } = {}) {
  class PageCanvas2DContext {
    getImageData(_sx, _sy, sw, sh) {
      return { data: new Uint8ClampedArray(sw * sh * 4) };
    }

    drawImage() {}

    putImageData() {}
  }

  class PageWebGLContext extends FakeWebGLContext {}

  class PageCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.context2d = new PageCanvas2DContext();
      this.contexts = {
        webgl: new PageWebGLContext(),
        'experimental-webgl': new PageWebGLContext(),
        webgl2: new PageWebGLContext(),
      };
    }

    getContext(type) {
      if (type === '2d') return this.context2d;
      return this.contexts[type] || null;
    }

    toDataURL() {
      return 'data:image/png;base64,fixture';
    }

    toBlob(callback) {
      callback(new Blob());
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
    Uint8Array,
    Uint8ClampedArray,
    Blob,
  };
  context.window = context;
  return vm.createContext(context);
}

function installInject(context) {
  vm.runInContext(INJECT_SOURCE, context, { filename: 'inject.js' });
}

function readPixelsAfterGetContextCalls({ type = 'webgl', getContextCalls = 1 } = {}) {
  const context = createPageContext();
  installInject(context);
  const canvas = vm.runInContext('new HTMLCanvasElement()', context);
  let gl;
  for (let i = 0; i < getContextCalls; i += 1) {
    gl = canvas.getContext(type);
  }
  const pixels = new Uint8Array(128 * 128 * 4);
  gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return {
    bytes: Buffer.from(pixels),
    nativeReadPixelsCalls: gl.nativeReadPixelsCalls,
  };
}

module.exports = {
  createPageContext,
  installInject,
  readPixelsAfterGetContextCalls,
};
