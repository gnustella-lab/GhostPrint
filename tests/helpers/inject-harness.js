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
    this.VENDOR = 0x1F00;
    this.RENDERER = 0x1F01;
    this.nativeReadPixelsCalls = 0;
    this.nativeGetSupportedExtensionsCalls = 0;
    this.pboBytes = new Uint8Array(64).fill(23);
    this.debugRendererInfoEnabled = false;
    this.supportedExtensions = ['WEBGL_debug_renderer_info', 'OES_texture_float'];
  }

  readPixels(...args) {
    const [, , width, height, , , pixels, dstOffset] = args;
    this.nativeReadPixelsCalls += 1;
    if (typeof pixels === 'number') {
      for (let i = pixels; i < pixels + width * height * 4 && i < this.pboBytes.length; i += 4) {
        this.pboBytes[i] = 100;
        this.pboBytes[i + 1] = 100;
        this.pboBytes[i + 2] = 100;
        this.pboBytes[i + 3] = 255;
      }
      return;
    }
    if (!pixels || typeof pixels !== 'object') return;
    const offset = typeof dstOffset === 'number' ? dstOffset : 0;
    for (let i = offset; i < offset + width * height * 4; i += 4) {
      pixels[i] = 100;
      pixels[i + 1] = 100;
      pixels[i + 2] = 100;
      pixels[i + 3] = 255;
    }
  }

  getExtension(name) {
    if (String(name).toLowerCase() === 'webgl_debug_renderer_info') {
      this.debugRendererInfoEnabled = true;
      return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
    }
    return this.getSupportedExtensions().some(
      (extension) => extension.toLowerCase() === String(name).toLowerCase(),
    ) ? { name } : null;
  }

  getSupportedExtensions() {
    this.nativeGetSupportedExtensionsCalls += 1;
    return this.supportedExtensions.slice();
  }

  getParameter(parameter) {
    if (parameter === this.VENDOR) return 'Real WebGL Vendor';
    if (parameter === this.RENDERER) return 'Real WebGL Renderer';
    if (parameter === 0x9245) return this.debugRendererInfoEnabled ? 'Real GPU Vendor' : null;
    if (parameter === 0x9246) return this.debugRendererInfoEnabled ? 'Real GPU Renderer' : null;
    return 4096;
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

function createPageContext({ seed = '123456789', currentScriptSrc = null } = {}) {
  class PageCanvas2DContext {
    getImageData(_sx, _sy, sw, sh) {
      return { data: new Uint8ClampedArray(sw * sh * 4) };
    }

    drawImage() {}

    putImageData() {}
  }

  class PageWebGLContext extends FakeWebGLContext {}
  class PageWebGL2Context extends FakeWebGLContext {}

  class PageOffscreenCanvas {
    constructor() {
      this.contexts = {
        webgl: new PageWebGLContext(),
        'experimental-webgl': new PageWebGLContext(),
        webgl2: new PageWebGL2Context(),
      };
      this.lastGetContextArgs = null;
    }

    getContext(...args) {
      this.lastGetContextArgs = args;
      return this.contexts[args[0]] || null;
    }
  }

  class PageCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.context2d = new PageCanvas2DContext();
      this.lastGetContextArgs = null;
      this.contexts = {
        webgl: new PageWebGLContext(),
        'experimental-webgl': new PageWebGLContext(),
        webgl2: new PageWebGL2Context(),
      };
    }

    getContext(...args) {
      this.lastGetContextArgs = args;
      const [type] = args;
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

  const adapterInfoValues = new WeakMap();

  class PageGPUAdapterInfo {
    constructor(values) {
      adapterInfoValues.set(this, { ...values });
    }

    get vendor() { return adapterInfoValues.get(this).vendor; }
    get architecture() { return adapterInfoValues.get(this).architecture; }
    get device() { return adapterInfoValues.get(this).device; }
    get description() { return adapterInfoValues.get(this).description; }
    get subgroupMinSize() { return 32; }
    get subgroupMaxSize() { return 64; }
  }

  const deviceValues = new WeakMap();

  class PageGPUDevice {
    constructor(info) {
      deviceValues.set(this, info);
      this.features = new Set(['shader-f16']);
      this.limits = Object.freeze({ maxTextureDimension2D: 8192 });
    }

    get adapterInfo() {
      if (!deviceValues.has(this)) throw new TypeError('Illegal invocation');
      return deviceValues.get(this);
    }
  }

  const adapterValues = new WeakMap();

  class PageGPUAdapter {
    constructor() {
      const info = new PageGPUAdapterInfo({
        vendor: 'nvidia',
        architecture: 'ada',
        device: 'RTX 4090',
        description: 'NVIDIA GeForce RTX 4090',
      });
      adapterValues.set(this, info);
      this.features = new Set(['shader-f16']);
      this.limits = Object.freeze({ maxTextureDimension2D: 8192 });
      this.requestDeviceCalls = [];
    }

    get info() {
      if (!adapterValues.has(this)) throw new TypeError('Illegal invocation');
      return adapterValues.get(this);
    }

    requestDevice(...args) {
      this.requestDeviceCalls.push(args);
      return Promise.resolve(new PageGPUDevice(adapterValues.get(this)));
    }
  }

  class PageGPU {
    constructor() {
      this.adapter = new PageGPUAdapter();
      this.requestAdapterCalls = [];
    }

    requestAdapter(...args) {
      this.requestAdapterCalls.push(args);
      return Promise.resolve(this.adapter);
    }
  }

  const pageGPU = new PageGPU();
  Object.defineProperty(PageNavigator.prototype, 'gpu', {
    configurable: true,
    enumerable: true,
    get() { return pageGPU; },
  });

  const pageDocument = new PageDocument();
  pageDocument.currentScript = {
    src: currentScriptSrc || `moz-extension://test/inject.js#seed=${seed}`,
  };
  const context = {
    console,
    document: pageDocument,
    navigator: new PageNavigator(),
    sessionStorage: new FakeStorage(seed),
    CanvasRenderingContext2D: PageCanvas2DContext,
    HTMLCanvasElement: PageCanvas,
    OffscreenCanvas: PageOffscreenCanvas,
    WebGLRenderingContext: PageWebGLContext,
    WebGL2RenderingContext: PageWebGL2Context,
    GPU: PageGPU,
    GPUAdapter: PageGPUAdapter,
    GPUDevice: PageGPUDevice,
    GPUAdapterInfo: PageGPUAdapterInfo,
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
