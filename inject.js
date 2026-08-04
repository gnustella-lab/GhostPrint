// GhostPrint — runs in the page's JavaScript context.
//
// Sole goal: make EFF's Cover Your Tracks award the "your browser has a
// randomized fingerprint" status (the green badge Brave gets). That status
// requires ≥ 4 of these five fields to differ between first-party domains:
//   audio, canvas_hash_v2, webgl_hash_v2, plugins, hardware_concurrency
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
// The seed comes from sessionStorage, written by content.js under
// STORAGE_KEY (this is the same store the page context sees). The value is
// validated; anything unparseable falls back to a per-page random seed so
// pages cannot collapse all origins to seed 0.

(function () {
  'use strict';

  const STORAGE_KEY = '__ghostprint_seed_v1__'; // must match content.js

  let SEED;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    const parsed = parseInt(stored, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 0xFFFFFFFF) {
      SEED = parsed >>> 0;
    } else {
      SEED = ((Math.random() * 0xFFFFFFFE) + 1) >>> 0;
      // Write back so content.js (popup display) and inject.js agree on the
      // seed even if a page tampered with the key between the two loads.
      try { sessionStorage.setItem(STORAGE_KEY, String(SEED)); } catch (e) {}
    }
  } catch (e) {
    SEED = ((Math.random() * 0xFFFFFFFE) + 1) >>> 0;
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
    } catch (_) {}
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

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  const origToDataURL    = HTMLCanvasElement.prototype.toDataURL;
  const origToBlob       = HTMLCanvasElement.prototype.toBlob;
  const origGetContext   = HTMLCanvasElement.prototype.getContext;
  const origCreateElement = Document.prototype.createElement;

  function clampByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function toInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
  }

  // Perturb pixel data in place: nudge a sparse, seed-determined subset of
  // pixels by -1/0/+1 per RGB channel. Alpha is left untouched. Coordinates
  // are absolute within the source canvas, so overlapping reads receive the
  // same perturbation for the same seed and source pixels.
  function farblePixels(data, width, height, originX, originY, sourceWidth, sourceHeight) {
    if (!(data instanceof Uint8ClampedArray) || data.length % 4 !== 0) return;
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

  CanvasRenderingContext2D.prototype.getImageData = function () {
    const imageData = Reflect.apply(origGetImageData, this, arguments);
    try {
      const settings = arguments[4];
      const pixelFormat = settings && settings.pixelFormat;
      const data = imageData && imageData.data;
      if (pixelFormat && pixelFormat !== 'rgba-unorm8') return imageData;
      if (!(data instanceof Uint8ClampedArray) || data.length % 4 !== 0) return imageData;

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

  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    const copy = farbledCopy(this, true); // synchronous encode: scratch reuse is safe
    if (copy) return origToDataURL.call(copy, type, quality);
    return origToDataURL.call(this, type, quality);
  };

  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    // Fresh canvas per call: the encode runs asynchronously and reads the
    // bitmap at encode time, so a shared scratch would race (BUG-0013).
    const copy = farbledCopy(this, false);
    if (copy) return origToBlob.call(copy, callback, type, quality);
    return origToBlob.call(this, callback, type, quality);
  };

  // ─── WEBGL ───────────────────────────────────────────────────────────────
  // Fingerprint2 reads the rendered WebGL canvas via `gl.canvas.toDataURL()`
  // — the canvas override above handles that. We also farble readPixels for
  // fingerprinters that use it directly.
  //
  // Only RGBA + UNSIGNED_BYTE buffers are perturbed: that is the byte layout
  // (4 bytes/pixel) the nudge loop assumes. Other format/type combos (e.g.
  // RGB with 3 bytes/pixel, or float buffers) are left untouched so a ±1
  // nudge can't misalign and corrupt legitimate reads.
  const patchedWebGLContexts = new WeakSet();

  function patchWebGLContext(ctx) {
    if (patchedWebGLContexts.has(ctx) || !ctx || typeof ctx.readPixels !== 'function') return;

    const originalReadPixels = ctx.readPixels;
    const patchedReadPixels = function () {
      const args = arguments;
      Reflect.apply(originalReadPixels, this, args);

      const width = args[2];
      const height = args[3];
      const format = args[4];
      const type = args[5];
      const pixels = args[6];
      // WebGL contexts always define these constants (spec); no fallbacks needed.
      const isRGBA = format === ctx.RGBA;
      const isUint8 = type === ctx.UNSIGNED_BYTE;
      if (pixels && isRGBA && isUint8 &&
          (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
        for (let i = 0; i + 3 < pixels.length; i += 4) {
          const hash = mix(i, width, height, pixels[i], pixels[i + 1], pixels[i + 2]);
          if ((hash & 0x1f) === 0) {
            pixels[i]     = clampByte(pixels[i]     + ((hash >>> 5)  % 3) - 1);
            pixels[i + 1] = clampByte(pixels[i + 1] + ((hash >>> 11) % 3) - 1);
            pixels[i + 2] = clampByte(pixels[i + 2] + ((hash >>> 17) % 3) - 1);
          }
        }
      }
    };

    try {
      ctx.readPixels = patchedReadPixels;
      patchedWebGLContexts.add(ctx);
    } catch (_) {}
  }

  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = origGetContext.call(this, type, attrs);
    if (ctx && (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2')) {
      patchWebGLContext(ctx);
    }
    return ctx;
  };

  // ─── AUDIO ───────────────────────────────────────────────────────────────
  // Protect each available read surface independently. AudioBuffer samples are
  // farbled in place only after the native read succeeds, so
  // getChannelData/copyFromChannel observe the same stable view.
  const OfflineAudioCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  const AudioBufferClass = window.AudioBuffer;
  const AnalyserNodeClass = window.AnalyserNode;
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

  function farbleAudioRange(data, channel, start, end) {
    if (!(data instanceof Float32Array)) return;
    const first = Math.max(0, toInteger(start));
    const last = Math.min(data.length, Math.max(first, toInteger(end)));
    for (let i = first; i < last; i += 1) {
      const value = data[i];
      if (!Number.isFinite(value)) continue;
      const h = mix(0xA710, channel, i);
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
            farbleAudioRange(destination, channel, start, start + (destination ? destination.length : 0));
          }
        } catch (_) {}
        return result;
      };
    }

    if (originalCopyToChannel && originalGetChannelData) {
      proto.copyToChannel = function () {
        const result = Reflect.apply(originalCopyToChannel, this, arguments);
        try {
          const source = arguments[0];
          const channel = toInteger(arguments[1]);
          const start = toInteger(arguments[2]);
          const state = getAudioBufferState(this);
          const data = Reflect.apply(originalGetChannelData, this, [channel]);
          if (state.farbledChannels.has(channel)) {
            farbleAudioRange(data, channel, start, start + (source ? source.length : 0));
          } else {
            farbleAudioRange(data, channel, 0, data.length);
            state.farbledChannels.add(channel);
          }
        } catch (_) {}
        return result;
      };
    }
  }

  function farbleAnalyserArray(node, array, kind, tag) {
    if (!array || typeof array.length !== 'number') return;
    const limitValue = toInteger(node && node.frequencyBinCount);
    const limit = Math.min(array.length, limitValue > 0 ? limitValue : array.length);
    const isFloat = kind === 'float';
    if (isFloat && !(array instanceof Float32Array)) return;
    if (!isFloat && !(array instanceof Uint8Array)) return;

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

  // ─── HARDWARE CONCURRENCY ────────────────────────────────────────────────
  const HC_POOL = [2, 4, 6, 8, 12, 16];
  const spoofedHC = HC_POOL[mix(0xC0FFEE) % HC_POOL.length];
  defineGetter(Navigator.prototype, 'hardwareConcurrency', () => spoofedHC);
  // Also override on the navigator instance — some browsers define the
  // property there and prototype-level overrides get shadowed.
  defineGetter(navigator, 'hardwareConcurrency', () => spoofedHC);

  // ─── PDF VIEWER FLAG ─────────────────────────────────────────────────────
  // Modern fingerprinters read navigator.pdfViewerEnabled (replaces the old
  // plugins/mimeTypes checks). Farble it per-origin like the other vectors;
  // sites may use it to decide PDF affordances, so the value only changes
  // between origins, never within a page.
  const spoofedPdf = (mix(0x0F1E0E) & 1) === 1;
  defineGetter(Navigator.prototype, 'pdfViewerEnabled', () => spoofedPdf);
  defineGetter(navigator, 'pdfViewerEnabled', () => spoofedPdf);

  // ─── PLUGINS ─────────────────────────────────────────────────────────────
  // Append seed-determined fake plugins so the list differs per origin.
  // EFF iterates navigator.plugins → name/description/filename, sorts the
  // strings, and compares across first-party domains.
  //
  // Always inject 1-4 extras (never 0), and override on BOTH the instance
  // and the prototype — Firefox defines navigator.plugins on the instance,
  // so a prototype-only override gets shadowed and never takes effect.
  try {
    const realPlugins = navigator.plugins;
    if (realPlugins && typeof realPlugins.length === 'number') {

      function fakeMime(type, description, suffixes) {
        return { type, description, suffixes, enabledPlugin: null };
      }
      const pdfMime    = fakeMime('application/pdf', 'Portable Document Format', 'pdf');
      const textPdfMime = fakeMime('text/pdf',       'Portable Document Format', 'pdf');

      // Diversified pool: not every fake is a PDF viewer, so the per-origin
      // variation doesn't just shuffle PDF names. Each entry carries its own
      // description/filename/mime set so name and content stay consistent.
      const FAKE_POOL = [
        { name: 'WebKit built-in PDF',     description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'PDF.js',                  description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'Foxit PDF Viewer',        description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'Brave PDF Viewer',        description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'Edge PDF Viewer',         description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'Safari PDF Reader',       description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'Sumatra PDF',             description: 'Portable Document Format',          filename: 'internal-pdf-viewer', mimes: [pdfMime, textPdfMime] },
        { name: 'OpenH264 Video Decoder',  description: 'OpenH264 video codec for Firefox',  filename: 'libgmpopenh264',      mimes: [fakeMime('video/h264', 'H.264 video codec', 'mp4')] },
        { name: 'Widevine CDM',            description: 'Playback of DRM-protected content', filename: 'libwidevinecdm',      mimes: [fakeMime('application/x-ppapi-widevine-cdm', 'Widevine DRM', '')] },
      ];

      function makeFakePlugin(entry) {
        const mimes = entry.mimes.map((m) => ({ ...m, enabledPlugin: null }));
        const p = {
          name: entry.name,
          description: entry.description,
          filename: entry.filename,
          length: mimes.length,
          item: function (i) { return this[i] || null; },
          namedItem: function (n) { return mimes.find((m) => m.type === n) || null; },
        };
        for (let i = 0; i < mimes.length; i++) p[i] = mimes[i];
        return p;
      }

      // Always 1-4 extras (never 0) so plugin list always differs from the
      // baseline set; dedupe the picks so a seed can't produce two copies
      // of the same fake plugin.
      const extraCount = (mix(0xBADC0DE) % 4) + 1;
      const chosen = new Set();
      for (let k = 0; chosen.size < extraCount && k < 32; k++) {
        chosen.add(mix(0xF00BAA, k) % FAKE_POOL.length);
      }
      const fakes = [];
      for (const idx of chosen) fakes.push(makeFakePlugin(FAKE_POOL[idx]));

      const totalLen = realPlugins.length + fakes.length;

      const proxyPlugins = new Proxy(realPlugins, {
        get(target, prop) {
          if (prop === 'length') return totalLen;
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            const idx = parseInt(prop, 10);
            if (idx < realPlugins.length) return realPlugins[idx];
            return fakes[idx - realPlugins.length];
          }
          if (prop === 'item') return function (i) {
            if (i < realPlugins.length) return realPlugins.item(i);
            return fakes[i - realPlugins.length] || null;
          };
          if (prop === 'namedItem') return function (n) {
            const fake = fakes.find((p) => p.name === n);
            if (fake) return fake;
            return realPlugins.namedItem(n);
          };
          if (prop === 'refresh') return function () {};
          if (prop === Symbol.iterator) {
            return function* () {
              for (let i = 0; i < realPlugins.length; i++) yield realPlugins[i];
              for (const f of fakes) yield f;
            };
          }
          return Reflect.get(target, prop);
        },
      });

      defineGetter(navigator, 'plugins', () => proxyPlugins);
      defineGetter(Navigator.prototype, 'plugins', () => proxyPlugins);
    }
  } catch (_) {}
})();
