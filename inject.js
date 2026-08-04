// GhostPrint, runs in the page's JavaScript context.
//
// The hooks below apply deterministic farbling to selected fingerprinting
// surfaces. They are not a complete browser privacy boundary and do not claim
// equivalence with Brave, Tor Browser, or Firefox Resist Fingerprinting.
//
// Design: Brave-style farbling. Every read of canvas pixels returns the real
// pixels perturbed by tiny, seed-determined noise (~1 in 32 pixels, ±1 per
// RGB channel, alpha untouched). The perturbation is a pure function of
// (seed, pixel position, source pixel values), so a canvas that is drawn
// identically twice produces byte-identical farbled output. EFF draws the
// same probe canvas on both of its runs within a page, so the hash is
// stable within the page; a different first-party origin has a different
// seed, so the hash differs across origins — which is what EFF rewards.
//
// Known caveat (documented, not silently ignored): because the source pixel
// values feed into the hash, if the browser renders the same canvas
// slightly differently between two draws (sub-pixel text/gradient
// variation), the farbled output could differ between EFF's two runs and
// the field would be flagged "randomized" within the page, losing
// cross-domain credit. In practice canvas rendering is deterministic for
// identical draw calls, so this is theoretical; if EFF ever stops passing,
// drop the source pixels from the hash (pure function of seed + position +
// dimensions).
//
// Audio's OfflineAudioContext rendering is mathematically deterministic, so
// value-dependent noise is safe there; a per-channel cache keeps repeated
// reads identical.
//
// The seed is carried by content.js in the external script URL fragment. The
// value is validated without using page-visible storage. Without a verified
// seed, no page hooks are installed, avoiding disagreement between the content
// script and the page context.

(function () {
  'use strict';

  const SEED_MIN = 1;
  const SEED_MAX = 0xFFFFFFFE;

  function parsePageSeed(value) {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < SEED_MIN || parsed > SEED_MAX) return null;
    return parsed;
  }


  function parseSeedFromCurrentScript() {
    try {
      const currentScript = typeof document !== 'undefined' ? document.currentScript : null;
      const source = currentScript && typeof currentScript.src === 'string'
        ? currentScript.src
        : '';
      const marker = '#seed=';
      const markerIndex = source.indexOf(marker);
      if (markerIndex < 0) return null;
      const encoded = source.slice(markerIndex + marker.length).split('&', 1)[0];
      return parsePageSeed(decodeURIComponent(encoded));
    } catch (_) {
      return null;
    }
  }

  const SEED = parseSeedFromCurrentScript();

  // Without a verified seed, do not install hooks that would disagree with
  // the content script or collapse all origins to a shared fallback.
  if (SEED === null) return;

  // A WeakSet created in this evaluation cannot prevent a second evaluation
  // of this file from wrapping the same realm again. Keep only installer state
  // in a non-enumerable per-realm registry; no API object receives a marker.
  // Use an unregistered symbol so pages cannot address the registry through a
  // predictable Symbol.for key. The symbol itself is still page-observable to
  // hostile code enumerating every own symbol, so this is concealment, not a
  // security boundary.
  const REGISTRY_FALLBACK_KEY = '__ghostprint_installation_v1__';
  const pageGlobal = typeof globalThis !== 'undefined' ? globalThis : window;
  let installationRegistry;
  try {
    const canUsePrivateSymbol = typeof Symbol === 'function'
      && typeof Object.getOwnPropertySymbols === 'function';
    if (canUsePrivateSymbol) {
      const symbols = Object.getOwnPropertySymbols(pageGlobal);
      for (const symbol of symbols) {
        const candidate = pageGlobal[symbol];
        if (candidate && candidate.version === 1
          && candidate.installers && candidate.patchedWebGLContexts) {
          installationRegistry = candidate;
          break;
        }
      }
    } else {
      installationRegistry = pageGlobal[REGISTRY_FALLBACK_KEY];
    }
    if (!installationRegistry) {
      installationRegistry = {
        version: 1,
        patchedWebGLContexts: new WeakSet(),
        installers: Object.create(null),
      };
      const registryKey = canUsePrivateSymbol ? Symbol() : REGISTRY_FALLBACK_KEY;
      Object.defineProperty(pageGlobal, registryKey, {
        value: installationRegistry,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }
  } catch (_) {
    return;
  }

  // ─── Deterministic 32-bit hash mixer ─────────────────────────────────────
  // Stateless. Same args + same SEED → same output, always.
  function mix() {
    let h = SEED;
    for (let i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] >>> 0), 0x9e3779b9) >>> 0;
      h ^= h >>> 16;
    }
    return h >>> 0;
  }

  function defineGetter(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, { get: getter, configurable: true, enumerable: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  // ─── CANVAS ──────────────────────────────────────────────────────────────
  // Farble canvas reads the way Brave does: apply tiny, IMPERCEPTIBLE, seed-
  // determined noise to the *real* pixels instead of replacing them. This is
  // both correct for EFF and non-destructive for legitimate canvas use
  // (image editors, croppers, format converters, QR/chart exporters, etc.) —
  // with the caveat that exported bytes (toDataURL/toBlob) are imperceptibly
  // altered, see the README.
  //
  // Determinism is what makes this safe for EFF's twice-per-page probe: the
  // perturbation is a pure function of (seed, pixel position, source pixel
  // values). EFF draws the *same* probe canvas on both runs, so identical
  // source pixels + identical seed → byte-identical output → a stable hash
  // within the page. A different first-party origin has a different seed →
  // different noise → a different hash → the cross-domain difference EFF
  // rewards with the "randomized fingerprint" status.

  function clampByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function toInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
  }

  function isTypedArray(value, name) {
    return Boolean(
      value &&
      typeof ArrayBuffer !== 'undefined' &&
      ArrayBuffer.isView(value) &&
      Object.prototype.toString.call(value) === `[object ${name}]`,
    );
  }

  function installCanvasProtection() {
    if (installationRegistry.installers.canvas) {
      return { installed: true, reason: 'already-installed' };
    }
    const Canvas2DClass = typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D
      : null;
    const CanvasElementClass = typeof HTMLCanvasElement !== 'undefined'
      ? HTMLCanvasElement
      : null;
    const DocumentClass = typeof Document !== 'undefined' ? Document : null;
    if (!Canvas2DClass || !CanvasElementClass || !DocumentClass) {
      return { installed: false, reason: 'api-unavailable' };
    }

    const origGetImageData = Canvas2DClass.prototype.getImageData;
    const origToDataURL = CanvasElementClass.prototype.toDataURL;
    const origToBlob = CanvasElementClass.prototype.toBlob;
    const origGetContext = CanvasElementClass.prototype.getContext;
    const origCreateElement = DocumentClass.prototype.createElement;

  // Perturb pixel data in place: nudge a sparse, seed-determined subset of
  // pixels by -1/0/+1 per RGB channel. Alpha is left untouched. Coordinates
  // are absolute within the source canvas, so overlapping reads receive the
  // same perturbation for the same seed and source pixels.
  function farblePixels(data, width, height, originX, originY, sourceWidth, sourceHeight) {
    if (!isTypedArray(data, 'Uint8ClampedArray') || data.length % 4 !== 0) return;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return;

    const pixelCount = Math.min(data.length / 4, width * height);
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const localX = pixelIndex % width;
      const localY = Math.floor(pixelIndex / width);
      const absoluteX = originX + localX;
      const absoluteY = originY + localY;
      const index = pixelIndex * 4;
      const h = mix(
        absoluteX,
        absoluteY,
        sourceWidth,
        sourceHeight,
        data[index],
        data[index + 1],
        data[index + 2],
      );
      if ((h & 0x1f) === 0) {
        data[index]     = clampByte(data[index]     + ((h >>> 5)  % 3) - 1);
        data[index + 1] = clampByte(data[index + 1] + ((h >>> 11) % 3) - 1);
        data[index + 2] = clampByte(data[index + 2] + ((h >>> 17) % 3) - 1);
      }
    }
  }

  // Snapshot a canvas (2D or WebGL) into a fresh 2D canvas, farble it, and
  // return that canvas so the original is never mutated. Returns null if the
  // source can't be snapshotted (e.g. tainted/cross-origin) so callers fall
  // back to the unmodified original.
  //
  // A single reusable scratch canvas avoids allocating a full w*h*4 buffer
  // on every export call; it is only resized when the source size changes
  // (resizing clears it, and we always redraw + re-read the full source
  // area, so stale content outside it is never encoded). The scratch is
  // created via the captured original createElement/getContext, so it is
  // invisible to our own overrides and never exposed to the page.
  //
  // IMPORTANT: the scratch may ONLY be used for synchronous paths (toDataURL
  // encodes synchronously and returns before any other code can run). The
  // toBlob path encodes "in parallel" per spec and reads the canvas bitmap
  // at encode time, not at call time: a second farbledCopy before the first
  // encode reads the bitmap would overwrite the shared scratch and the
  // earlier blob would be encoded from the later canvas's pixels. toBlob
  // therefore always allocates a fresh canvas per call (BUG-0013).
  let scratchCanvas = null;
  let scratchCtx = null;

  function farbledCopy(src, reuseScratch) {
    const w = src.width, h = src.height;
    if (w <= 0 || h <= 0) return null;
    try {
      let tmp, tctx;
      if (reuseScratch) {
        if (scratchCanvas && !scratchCtx) {
          // Previous init failed partway (e.g. getContext returned null):
          // reset so we retry instead of failing permanently.
          scratchCanvas = null;
        }
        if (!scratchCanvas) {
          scratchCanvas = origCreateElement.call(document, 'canvas');
          scratchCtx = origGetContext.call(scratchCanvas, '2d');
        }
        if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
          scratchCanvas.width = w;
          scratchCanvas.height = h;
        }
        tmp = scratchCanvas;
        tctx = scratchCtx;
      } else {
        tmp = origCreateElement.call(document, 'canvas');
        tmp.width = w;
        tmp.height = h;
        tctx = origGetContext.call(tmp, '2d');
      }
      if (!tctx) return null;
      tctx.drawImage(src, 0, 0);
      const id = origGetImageData.call(tctx, 0, 0, w, h);
      farblePixels(id.data, w, h, 0, 0, w, h);
      tctx.putImageData(id, 0, 0);
      return tmp;
    } catch (_) {
      return null;
    }
  }

    if (typeof origGetImageData === 'function') {
      Canvas2DClass.prototype.getImageData = function () {
    const imageData = Reflect.apply(origGetImageData, this, arguments);
    try {
      const settings = arguments[4];
      const pixelFormat = settings && settings.pixelFormat;
      const data = imageData && imageData.data;
      if (pixelFormat && pixelFormat !== 'rgba-unorm8') return imageData;
      if (!isTypedArray(data, 'Uint8ClampedArray') || data.length % 4 !== 0) return imageData;

      const width = toInteger(imageData.width);
      const height = toInteger(imageData.height);
      const sourceCanvas = this && this.canvas;
      const sourceWidth = toInteger(sourceCanvas && sourceCanvas.width);
      const sourceHeight = toInteger(sourceCanvas && sourceCanvas.height);
      if (width <= 0 || height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return imageData;

      farblePixels(
        data,
        width,
        height,
        toInteger(arguments[0]),
        toInteger(arguments[1]),
        sourceWidth,
        sourceHeight,
      );
    } catch (_) {}
    return imageData;
      };
    }

    if (typeof origToDataURL === 'function' &&
        typeof origCreateElement === 'function' &&
        typeof origGetContext === 'function' &&
        typeof origGetImageData === 'function') {
      CanvasElementClass.prototype.toDataURL = function () {
    const copy = farbledCopy(this, true); // synchronous encode: scratch reuse is safe
    if (copy) return Reflect.apply(origToDataURL, copy, arguments);
    return Reflect.apply(origToDataURL, this, arguments);
      };
    }

    if (typeof origToBlob === 'function' &&
        typeof origCreateElement === 'function' &&
        typeof origGetContext === 'function' &&
        typeof origGetImageData === 'function') {
      CanvasElementClass.prototype.toBlob = function () {
    // Fresh canvas per call: the encode runs asynchronously and reads the
    // bitmap at encode time, so a shared scratch would race (BUG-0013).
    const copy = farbledCopy(this, false);
    if (copy) return Reflect.apply(origToBlob, copy, arguments);
    return Reflect.apply(origToBlob, this, arguments);
      };
    }

    installationRegistry.installers.canvas = true;
    return { installed: true };
  }

  // ─── WEBGL ───────────────────────────────────────────────────────────────
  // Fingerprint2 reads the rendered WebGL canvas via `gl.canvas.toDataURL()`
  // — the canvas override above handles that. We also farble readPixels for
  // fingerprinters that use it directly.
  //
  // Only RGBA + UNSIGNED_BYTE buffers are perturbed: that is the byte layout
  // (4 bytes/pixel) the nudge loop assumes. Other format/type combos (e.g.
  // RGB with 3 bytes/pixel, or float buffers) are left untouched so a ±1
  // nudge can't misalign and corrupt legitimate reads.
  function installWebGLProtection() {
    if (installationRegistry.installers.webgl) {
      return { installed: true, reason: 'already-installed' };
    }
    const CanvasElementClass = typeof HTMLCanvasElement !== 'undefined'
      ? HTMLCanvasElement
      : null;
    if (!CanvasElementClass || typeof CanvasElementClass.prototype.getContext !== 'function') {
      return { installed: false, reason: 'api-unavailable' };
    }
    const origGetContext = CanvasElementClass.prototype.getContext;
    const patchedWebGLContexts = installationRegistry.patchedWebGLContexts;

  function patchWebGLContext(ctx) {
    if (patchedWebGLContexts.has(ctx) || !ctx || typeof ctx.readPixels !== 'function') return;

    const DEBUG_RENDERER_EXTENSION = 'WEBGL_debug_renderer_info';
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;
    const originalReadPixels = ctx.readPixels;
    const patchedReadPixels = function () {
      const args = arguments;
      Reflect.apply(originalReadPixels, this, args);

      const width = toInteger(args[2]);
      const height = toInteger(args[3]);
      const format = args[4];
      const type = args[5];
      const pixels = args[6];
      // WebGL 2 also accepts a numeric PBO offset in args[6]. Only typed-array
      // reads expose bytes that this wrapper can safely post-process.
      const dstOffset = typeof args[7] === 'number' ? toInteger(args[7]) : 0;
      const byteCount = width > 0 && height > 0 ? width * height * 4 : 0;
      const start = Math.max(0, dstOffset);
      const end = Math.min(pixels && pixels.length, start + byteCount);
      // WebGL contexts always define these constants (spec); no fallbacks needed.
      const isRGBA = format === ctx.RGBA;
      const isUint8 = type === ctx.UNSIGNED_BYTE;
      if (byteCount > 0 && pixels && isRGBA && isUint8 &&
          (isTypedArray(pixels, 'Uint8Array') || isTypedArray(pixels, 'Uint8ClampedArray'))) {
        for (let i = start; i + 3 < end; i += 4) {
          const pixelIndex = i - start;
          const hash = mix(pixelIndex, width, height, pixels[i], pixels[i + 1], pixels[i + 2]);
          if ((hash & 0x1f) === 0) {
            pixels[i]     = clampByte(pixels[i]     + ((hash >>> 5)  % 3) - 1);
            pixels[i + 1] = clampByte(pixels[i + 1] + ((hash >>> 11) % 3) - 1);
            pixels[i + 2] = clampByte(pixels[i + 2] + ((hash >>> 17) % 3) - 1);
          }
        }
      }
    };

    // Mark before assignment: if a browser exposes a non-writable native
    // method, a later getContext call must not stack another readPixels wrapper
    // over the partially patched context.
    patchedWebGLContexts.add(ctx);
    try {
      ctx.readPixels = patchedReadPixels;
    } catch (_) {}

    const originalGetExtension = typeof ctx.getExtension === 'function'
      ? ctx.getExtension
      : null;
    if (originalGetExtension) {
      try {
        ctx.getExtension = function () {
          if (arguments[0] === DEBUG_RENDERER_EXTENSION) return null;
          return Reflect.apply(originalGetExtension, this, arguments);
        };
      } catch (_) {}
    }

    const originalGetSupportedExtensions = typeof ctx.getSupportedExtensions === 'function'
      ? ctx.getSupportedExtensions
      : null;
    if (originalGetSupportedExtensions) {
      try {
        ctx.getSupportedExtensions = function () {
          const extensions = Reflect.apply(originalGetSupportedExtensions, this, arguments);
          if (!Array.isArray(extensions)) return extensions;
          return extensions.filter((name) => name !== DEBUG_RENDERER_EXTENSION);
        };
      } catch (_) {}
    }

    const originalGetParameter = typeof ctx.getParameter === 'function'
      ? ctx.getParameter
      : null;
    if (originalGetParameter) {
      try {
        ctx.getParameter = function () {
          const parameter = arguments[0];
          if (parameter === UNMASKED_VENDOR_WEBGL || parameter === UNMASKED_RENDERER_WEBGL) {
            return null;
          }
          return Reflect.apply(originalGetParameter, this, arguments);
        };
      } catch (_) {}
    }
  }

    CanvasElementClass.prototype.getContext = function () {
      const type = arguments[0];
      const ctx = Reflect.apply(origGetContext, this, arguments);
      if (ctx && (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2')) {
        patchWebGLContext(ctx);
      }
      return ctx;
    };

    installationRegistry.installers.webgl = true;
    return { installed: true };
  }

  function installAudioProtection() {
    if (installationRegistry.installers.audio) {
      return { installed: true, reason: 'already-installed' };
    }
    const pageWindow = typeof window !== 'undefined' ? window : null;
    if (!pageWindow) return { installed: false, reason: 'api-unavailable' };

    // Protect each available read surface independently. AudioBuffer samples are
    // farbled in place only after the native read succeeds, so
    // getChannelData/copyFromChannel observe the same stable view.
    const OfflineAudioCtxClass = pageWindow.OfflineAudioContext || pageWindow.webkitOfflineAudioContext;
    const AudioCtxClass = pageWindow.AudioContext || pageWindow.webkitAudioContext;
    const AudioBufferClass = pageWindow.AudioBuffer;
    const AnalyserNodeClass = pageWindow.AnalyserNode;
    if (!OfflineAudioCtxClass && !AudioCtxClass && !AudioBufferClass && !AnalyserNodeClass) {
      return { installed: false, reason: 'api-unavailable' };
    }
    const audioBufferStates = new WeakMap();
    const patchedAnalyserNodes = new WeakSet();

  function getAudioBufferState(buffer) {
    let state = audioBufferStates.get(buffer);
    if (!state) {
      state = { farbledChannels: new Set() };
      audioBufferStates.set(buffer, state);
    }
    return state;
  }

  function farbleAudioRange(data, channel, start, end, logicalStart = start) {
    if (!isTypedArray(data, 'Float32Array')) return;
    const first = Math.max(0, toInteger(start));
    const last = Math.min(data.length, Math.max(first, toInteger(end)));
    const logicalBase = toInteger(logicalStart);
    for (let i = first; i < last; i += 1) {
      const value = data[i];
      if (!Number.isFinite(value)) continue;
      const h = mix(0xA710, channel, logicalBase + (i - first));
      if ((h & 0xff) < 8) {
        data[i] = value + ((h / 0x100000000) - 0.5) * 1e-4;
      }
    }
  }

  function farbleWholeAudioChannel(buffer, state, originalGetChannelData, channel) {
    if (state.farbledChannels.has(channel)) return null;
    const data = Reflect.apply(originalGetChannelData, buffer, [channel]);
    farbleAudioRange(data, channel, 0, data.length);
    state.farbledChannels.add(channel);
    return data;
  }

  function patchAudioBufferPrototype() {
    if (!AudioBufferClass || !AudioBufferClass.prototype) return;
    const proto = AudioBufferClass.prototype;
    const originalGetChannelData = typeof proto.getChannelData === 'function'
      ? proto.getChannelData
      : null;
    const originalCopyFromChannel = typeof proto.copyFromChannel === 'function'
      ? proto.copyFromChannel
      : null;
    const originalCopyToChannel = typeof proto.copyToChannel === 'function'
      ? proto.copyToChannel
      : null;

    if (originalGetChannelData) {
      proto.getChannelData = function () {
        const data = Reflect.apply(originalGetChannelData, this, arguments);
        try {
          const state = getAudioBufferState(this);
          const channel = toInteger(arguments[0]);
          if (!state.farbledChannels.has(channel)) {
            farbleAudioRange(data, channel, 0, data.length);
            state.farbledChannels.add(channel);
          }
        } catch (_) {}
        return data;
      };
    }

    if (originalCopyFromChannel) {
      proto.copyFromChannel = function () {
        const result = Reflect.apply(originalCopyFromChannel, this, arguments);
        try {
          const destination = arguments[0];
          const channel = toInteger(arguments[1]);
          const start = toInteger(arguments[2]);
          const state = getAudioBufferState(this);
          let sourceData = null;
          if (originalGetChannelData) {
            sourceData = farbleWholeAudioChannel(this, state, originalGetChannelData, channel);
            if (!sourceData) sourceData = Reflect.apply(originalGetChannelData, this, [channel]);
            if (destination && typeof destination.length === 'number' && sourceData) {
              const count = Math.min(destination.length, sourceData.length - start);
              for (let i = 0; i < count; i += 1) destination[i] = sourceData[start + i];
            }
          } else {
            const count = destination && typeof destination.length === 'number'
              ? destination.length
              : 0;
            farbleAudioRange(destination, channel, 0, count, start);
          }
        } catch (_) {}
        return result;
      };
    }

    if (originalCopyToChannel) {
      proto.copyToChannel = function () {
        const result = Reflect.apply(originalCopyToChannel, this, arguments);
        if (originalGetChannelData) try {
          const source = arguments[0];
          const channel = toInteger(arguments[1]);
          const start = toInteger(arguments[2]);
          const state = getAudioBufferState(this);
          if (state.farbledChannels.has(channel)) {
            const data = Reflect.apply(originalGetChannelData, this, [channel]);
            const count = source && typeof source.length === 'number' ? source.length : 0;
            farbleAudioRange(data, channel, start, start + count);
          }
        } catch (_) {}
        return result;
      };
    }
  }

  function farbleAnalyserArray(node, array, kind, tag) {
    if (!array || typeof array.length !== 'number') return;
    const limitValue = Number(node && node.frequencyBinCount);
    if (!Number.isSafeInteger(limitValue) || limitValue <= 0) return;
    const limit = Math.min(array.length, limitValue);
    const isFloat = kind === 'float';
    if (isFloat && !isTypedArray(array, 'Float32Array')) return;
    if (!isFloat && !isTypedArray(array, 'Uint8Array')) return;

    for (let i = 0; i < limit; i += 1) {
      const value = array[i];
      if (isFloat) {
        if (!Number.isFinite(value)) continue;
        const h = mix(0xA711, tag, i);
        if ((h & 0xff) < 8) array[i] = value + ((h / 0x100000000) - 0.5) * 1e-4;
      } else {
        const h = mix(0xA712, tag, i);
        if ((h & 0xff) < 32) array[i] = Math.max(0, Math.min(255, value + ((h >>> 8) % 3) - 1));
      }
    }
  }

  function patchAnalyserMethods(proto) {
    if (!proto) return false;
    const methods = [
      ['getFloatFrequencyData', 'float', 1],
      ['getByteFrequencyData', 'byte', 2],
      ['getFloatTimeDomainData', 'float', 3],
      ['getByteTimeDomainData', 'byte', 4],
    ];
    let installed = false;
    for (const [name, kind, tag] of methods) {
      const original = typeof proto[name] === 'function' ? proto[name] : null;
      if (!original) continue;
      proto[name] = function () {
        const result = Reflect.apply(original, this, arguments);
        try { farbleAnalyserArray(this, arguments[0], kind, tag); } catch (_) {}
        return result;
      };
      installed = true;
    }
    return installed;
  }

  function patchAnalyserInstance(analyser) {
    if (!analyser || patchedAnalyserNodes.has(analyser)) return analyser;
    patchedAnalyserNodes.add(analyser);
    const methods = [
      ['getFloatFrequencyData', 'float', 1],
      ['getByteFrequencyData', 'byte', 2],
      ['getFloatTimeDomainData', 'float', 3],
      ['getByteTimeDomainData', 'byte', 4],
    ];
    for (const [name, kind, tag] of methods) {
      const original = typeof analyser[name] === 'function' ? analyser[name] : null;
      if (!original) continue;
      analyser[name] = function () {
        const result = Reflect.apply(original, this, arguments);
        try { farbleAnalyserArray(this, arguments[0], kind, tag); } catch (_) {}
        return result;
      };
    }
    return analyser;
  }

  patchAudioBufferPrototype();

  if (OfflineAudioCtxClass && typeof OfflineAudioCtxClass.prototype.startRendering === 'function') {
    const originalStartRendering = OfflineAudioCtxClass.prototype.startRendering;
    OfflineAudioCtxClass.prototype.startRendering = function () {
      return Reflect.apply(originalStartRendering, this, arguments);
    };
  }

  if (AnalyserNodeClass && AnalyserNodeClass.prototype) {
    patchAnalyserMethods(AnalyserNodeClass.prototype);
  } else if (AudioCtxClass && typeof AudioCtxClass.prototype.createAnalyser === 'function') {
    const originalCreateAnalyser = AudioCtxClass.prototype.createAnalyser;
    AudioCtxClass.prototype.createAnalyser = function () {
      return patchAnalyserInstance(Reflect.apply(originalCreateAnalyser, this, arguments));
    };
  }

    installationRegistry.installers.audio = true;
    return { installed: true };
  }

  function installNavigatorProtection() {
    if (installationRegistry.installers.navigator) {
      return { installed: true, reason: 'already-installed' };
    }
    const NavigatorClass = typeof Navigator !== 'undefined' ? Navigator : null;
    if (!NavigatorClass || typeof navigator === 'undefined') {
      return { installed: false, reason: 'api-unavailable' };
    }
    const HC_POOL = [2, 4, 6, 8, 12, 16];
    const spoofedHC = HC_POOL[mix(0xC0FFEE) % HC_POOL.length];
    defineGetter(NavigatorClass.prototype, 'hardwareConcurrency', () => spoofedHC);
    // Also override on the navigator instance, some browsers define the
    // property there and prototype-level overrides get shadowed.
    defineGetter(navigator, 'hardwareConcurrency', () => spoofedHC);

    installationRegistry.installers.navigator = true;
    return { installed: true };
  }

  function installPluginProtection() {
    if (installationRegistry.installers.plugins) {
      return { installed: true, reason: 'already-installed' };
    }
    const NavigatorClass = typeof Navigator !== 'undefined' ? Navigator : null;
    if (!NavigatorClass || typeof navigator === 'undefined') {
      return { installed: false, reason: 'api-unavailable' };
    }
    try {
      const realPlugins = navigator.plugins;
      const realMimeTypes = navigator.mimeTypes;
      if (!realPlugins || typeof realPlugins.length !== 'number') {
        return { installed: false, reason: 'api-unavailable' };
      }

      const PluginClass = typeof Plugin !== 'undefined' ? Plugin : null;
      const MimeTypeClass = typeof MimeType !== 'undefined' ? MimeType : null;

      function createNativeLikeObject(Class, fallbackObject) {
        let prototype;
        try {
          prototype = Class && Class.prototype
            ? Class.prototype
            : fallbackObject
              ? Object.getPrototypeOf(fallbackObject)
              : Object.prototype;
          return Object.create(prototype);
        } catch (_) {
          try {
            const object = {};
            Object.setPrototypeOf(object, prototype || Object.prototype);
            return object;
          } catch (_) {
            return {};
          }
        }
      }

      function setValue(target, property, value, enumerable = false) {
        try {
          Object.defineProperty(target, property, {
            value,
            writable: false,
            configurable: true,
            enumerable,
          });
        } catch (_) {}
      }

      function readItem(collection, index) {
        try {
          if (collection && typeof collection.item === 'function') {
            return collection.item(index);
          }
        } catch (_) {}
        try { return collection[index] || null; } catch (_) { return null; }
      }

      function appendUnique(entries, value) {
        if (value && !entries.includes(value)) entries.push(value);
      }

      function appendUniqueMime(entries, value) {
        if (!value) return;
        const type = typeof value.type === 'string' ? value.type : null;
        if (type !== null) {
          if (!entries.some((entry) => entry && entry.type === type)) entries.push(value);
          return;
        }
        appendUnique(entries, value);
      }

      function isPdfMime(mime) {
        if (!mime || typeof mime.type !== 'string') return false;
        return mime.type === 'application/pdf' || mime.type === 'text/pdf';
      }

      function isPdfPlugin(plugin) {
        if (!plugin) return false;
        const name = typeof plugin.name === 'string' ? plugin.name.toLowerCase() : '';
        const description = typeof plugin.description === 'string'
          ? plugin.description.toLowerCase()
          : '';
        if (name.includes('pdf') || description.includes('pdf')) return true;
        if (typeof plugin.length !== 'number') return false;
        for (let i = 0; i < plugin.length; i += 1) {
          if (isPdfMime(readItem(plugin, i))) return true;
        }
        return false;
      }

      const pluginEntries = [];
      for (let i = 0; i < realPlugins.length; i += 1) {
        const plugin = readItem(realPlugins, i);
        if (!isPdfPlugin(plugin)) appendUnique(pluginEntries, plugin);
      }

      const mimeEntries = [];
      if (realMimeTypes && typeof realMimeTypes.length === 'number') {
        for (let i = 0; i < realMimeTypes.length; i += 1) {
          const mime = readItem(realMimeTypes, i);
          if (!isPdfMime(mime)) appendUniqueMime(mimeEntries, mime);
        }
      }
      for (const plugin of pluginEntries) {
        if (!plugin || typeof plugin.length !== 'number') continue;
        for (let i = 0; i < plugin.length; i += 1) {
          const mime = readItem(plugin, i);
          if (!isPdfMime(mime)) appendUniqueMime(mimeEntries, mime);
        }
      }

      const FAKE_POOL = [
        { name: 'PDF.js', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Mozilla PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Portable Document Format', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
      ];
      const profile = FAKE_POOL[mix(0xF00BAA) % FAKE_POOL.length];
      const fakePlugin = createNativeLikeObject(PluginClass, pluginEntries[0]);
      const fakeMimes = [
        ['application/pdf', 'Portable Document Format', 'pdf'],
        ['text/pdf', 'Portable Document Format', 'pdf'],
      ].map(([type, description, suffixes]) => {
        const mime = createNativeLikeObject(MimeTypeClass, mimeEntries[0]);
        setValue(mime, 'type', type);
        setValue(mime, 'description', description);
        setValue(mime, 'suffixes', suffixes);
        setValue(mime, 'enabledPlugin', fakePlugin);
        return mime;
      });

      setValue(fakePlugin, 'name', profile.name);
      setValue(fakePlugin, 'description', profile.description);
      setValue(fakePlugin, 'filename', profile.filename);
      setValue(fakePlugin, 'length', fakeMimes.length);
      fakeMimes.forEach((mime, index) => setValue(fakePlugin, String(index), mime, true));
      fakeMimes.forEach((mime) => setValue(fakePlugin, mime.type, mime));
      setValue(fakePlugin, 'item', function item(index) {
        if (this !== fakePlugin) throw new TypeError('Illegal invocation');
        const i = toInteger(index);
        return i >= 0 && i < fakeMimes.length ? fakeMimes[i] : null;
      });
      setValue(fakePlugin, 'namedItem', function namedItem(type) {
        if (this !== fakePlugin) throw new TypeError('Illegal invocation');
        return fakeMimes.find((mime) => mime.type === String(type)) || null;
      });

      pluginEntries.push(fakePlugin);
      for (const mime of fakeMimes) mimeEntries.push(mime);

      function makeList(entries, nameProperty) {
        const list = {};
        setValue(list, 'length', entries.length);
        entries.forEach((entry, index) => {
          setValue(list, String(index), entry, true);
          const name = entry && entry[nameProperty];
          if (typeof name === 'string' && name.length > 0) {
            setValue(list, name, entry);
          }
        });
        setValue(list, 'item', function item(index) {
          if (this !== list) throw new TypeError('Illegal invocation');
          const i = toInteger(index);
          return i >= 0 && i < entries.length ? entries[i] : null;
        });
        setValue(list, 'namedItem', function namedItem(name) {
          if (this !== list) throw new TypeError('Illegal invocation');
          const value = String(name);
          return entries.find((entry) => entry && entry[nameProperty] === value) || null;
        });
        setValue(list, Symbol.iterator, function* iterator() {
          if (this !== list) throw new TypeError('Illegal invocation');
          for (const entry of entries) yield entry;
        });
        return list;
      }

      const pluginList = makeList(pluginEntries, 'name');
      const mimeList = makeList(mimeEntries, 'type');
      setValue(pluginList, 'refresh', function refresh() {
        if (this !== pluginList) throw new TypeError('Illegal invocation');
      });
      const pluginsInstalled = defineGetter(
        NavigatorClass.prototype,
        'plugins',
        () => pluginList,
      );
      const mimeTypesInstalled = defineGetter(
        NavigatorClass.prototype,
        'mimeTypes',
        () => mimeList,
      );
      if (!pluginsInstalled) defineGetter(navigator, 'plugins', () => pluginList);
      if (!mimeTypesInstalled) defineGetter(navigator, 'mimeTypes', () => mimeList);
      installationRegistry.installers.plugins = true;
      return { installed: true };
    } catch (_) {
      return { installed: false, reason: 'installer-error' };
    }
  }

  function runInstaller(name, installer) {
    try {
      const result = installer();
      return result && typeof result === 'object'
        ? result
        : { installed: Boolean(result) };
    } catch (_) {
      return { installed: false, reason: 'installer-error' };
    }
  }

  // Keep the result private. Exposing it on window would give pages a direct
  // feature-detection oracle. The extension context can still use the same
  // runner when a privileged diagnostic channel is added later.
  const installationResults = {
    canvas: runInstaller('canvas', installCanvasProtection),
    webgl: runInstaller('webgl', installWebGLProtection),
    audio: runInstaller('audio', installAudioProtection),
    navigator: runInstaller('navigator', installNavigatorProtection),
    plugins: runInstaller('plugins', installPluginProtection),
  };
  void installationResults;
})();
