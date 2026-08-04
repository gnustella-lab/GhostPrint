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

class PageCanvas2DContext {
  constructor(canvas) {
    this.canvas = canvas;
  }

  getImageData(_sx, _sy, sw, sh) {
    return { data: new Uint8ClampedArray(sw * sh * 4), width: sw, height: sh };
  }

  drawImage() {}

  putImageData() {}
}

class PageWebGLContext {
  constructor() {
    this.RGBA = 0x1908;
    this.UNSIGNED_BYTE = 0x1401;
  }

  readPixels() {}
}

class PageCanvas {
  constructor() {
    this.width = 4;
    this.height = 4;
    this.context2d = new PageCanvas2DContext(this);
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
    return 'data:image/png;base64,test';
  }

  toBlob(callback) {
    setTimeout(() => callback({}), 0);
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

class PageAudioBuffer {
  constructor(channelCount = 2, length = 1024) {
    this.channels = Array.from({ length: channelCount }, (_, channel) => {
      const data = new Float32Array(length);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = ((channel + 1) * 0.01) + (i % 97) / 1000;
      }
      data[3] = NaN;
      data[7] = -Infinity;
      return data;
    });
  }

  getChannelData(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.channels.length) {
      throw new RangeError('channel out of range');
    }
    return this.channels[channel];
  }

  copyFromChannel(destination, channel, startInChannel = 0) {
    const source = this.getChannelData(channel);
    if (startInChannel < 0 || startInChannel + destination.length > source.length) {
      throw new RangeError('copy out of range');
    }
    destination.set(source.subarray(startInChannel, startInChannel + destination.length));
    return undefined;
  }

  copyToChannel(source, channel, startInChannel = 0) {
    const destination = this.getChannelData(channel);
    destination.set(source, startInChannel);
    return undefined;
  }
}

class PageOfflineAudioContext {
  constructor() {
    this.buffer = new PageAudioBuffer();
  }

  startRendering() {
    return Promise.resolve(this.buffer);
  }
}

class PageAnalyserNode {
  constructor() {
    this.frequencyBinCount = 4;
  }

  getFloatFrequencyData(array) {
    for (let i = 0; i < Math.min(array.length, this.frequencyBinCount); i += 1) {
      array[i] = i === 1 ? -Infinity : -40 + i;
    }
    return 'native-float-frequency';
  }

  getByteFrequencyData(array) {
    for (let i = 0; i < Math.min(array.length, this.frequencyBinCount); i += 1) {
      array[i] = 100 + i;
    }
    return 'native-byte-frequency';
  }

  getFloatTimeDomainData(array) {
    for (let i = 0; i < Math.min(array.length, this.frequencyBinCount); i += 1) {
      array[i] = 0.1 + i / 100;
    }
    return 'native-float-time';
  }

  getByteTimeDomainData(array) {
    for (let i = 0; i < Math.min(array.length, this.frequencyBinCount); i += 1) {
      array[i] = 128 + i;
    }
    return 'native-byte-time';
  }
}

class PageAudioContext {
  createAnalyser() {
    return new PageAnalyserNode();
  }
}

function createPageContext({ seed = '123456789', missing = [] } = {}) {
  const missingSet = new Set(missing);
  class LocalCanvas2DContext extends PageCanvas2DContext {}
  class LocalWebGLContext extends PageWebGLContext {}
  class LocalCanvas extends PageCanvas {
    constructor() {
      super();
      this.context2d = new LocalCanvas2DContext(this);
      this.contexts = {
        webgl: new LocalWebGLContext(),
        'experimental-webgl': new LocalWebGLContext(),
        webgl2: new LocalWebGLContext(),
      };
    }
  }

  class LocalDocument extends PageDocument {
    createElement(type) {
      if (type === 'canvas') return new LocalCanvas();
      throw new Error(`unsupported element: ${type}`);
    }
  }

  class LocalNavigator {
    constructor() {
      Object.defineProperty(this, 'plugins', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: {
          length: 0,
          item() { return null; },
          namedItem() { return null; },
          [Symbol.iterator]: function* iterator() {},
        },
      });
    }
  }

  class LocalAudioBuffer extends PageAudioBuffer {}

  class LocalOfflineAudioContext {
    constructor() {
      this.buffer = new LocalAudioBuffer();
    }

    startRendering() {
      return Promise.resolve(this.buffer);
    }
  }

  class LocalAnalyserNode extends PageAnalyserNode {}

  class LocalAudioContext {
    createAnalyser() {
      return new LocalAnalyserNode();
    }
  }

  if (missingSet.has('getChannelData')) {
    Object.defineProperty(LocalAudioBuffer.prototype, 'getChannelData', { value: undefined, configurable: true });
  }
  if (missingSet.has('copyFromChannel')) {
    Object.defineProperty(LocalAudioBuffer.prototype, 'copyFromChannel', { value: undefined, configurable: true });
  }
  if (missingSet.has('copyToChannel')) {
    Object.defineProperty(LocalAudioBuffer.prototype, 'copyToChannel', { value: undefined, configurable: true });
  }
  if (missingSet.has('startRendering')) {
    Object.defineProperty(LocalOfflineAudioContext.prototype, 'startRendering', { value: undefined, configurable: true });
  }
  for (const method of [
    'getFloatFrequencyData',
    'getByteFrequencyData',
    'getFloatTimeDomainData',
    'getByteTimeDomainData',
  ]) {
    if (missingSet.has(method)) {
      Object.defineProperty(LocalAnalyserNode.prototype, method, { value: undefined, configurable: true });
    }
  }

  const context = {
    console,
    document: new LocalDocument(),
    navigator: new LocalNavigator(),
    sessionStorage: new FakeStorage(seed),
    CanvasRenderingContext2D: LocalCanvas2DContext,
    HTMLCanvasElement: LocalCanvas,
    Document: LocalDocument,
    Navigator: LocalNavigator,
    AudioBuffer: LocalAudioBuffer,
    OfflineAudioContext: LocalOfflineAudioContext,
    AudioContext: LocalAudioContext,
    AnalyserNode: LocalAnalyserNode,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    Blob,
    Promise,
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
};
