// GhostPrint — runs in the page's JavaScript context.
// All native API overrides happen here.
(function () {
  'use strict';

  const cfg = window.__ghostprint__;
  if (!cfg || !cfg.enabled) return;

  const SEED = cfg.seed >>> 0;

  // ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────
  // Returns a deterministic sequence for this page session.
  let _state = SEED;
  function rand() {
    _state += 0x6D2B79F5;
    let t = _state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randInt(min, max) {
    return min + Math.floor(rand() * (max - min + 1));
  }

  // Small noise: returns -n..+n integer
  function noise(n) {
    return Math.round((rand() - 0.5) * 2 * n);
  }

  // ─── Safe property definer ───────────────────────────────────────────────
  function defineGetter(obj, prop, getter) {
    try {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      Object.defineProperty(obj, prop, {
        get: getter,
        configurable: true,
        enumerable: desc ? desc.enumerable : true
      });
    } catch (_) {}
  }

  // ─── CANVAS FINGERPRINTING ───────────────────────────────────────────────
  // Adds imperceptible ±1 pixel noise to canvas read-back operations.
  // Identical to Brave's farbling: the image looks the same but the bytes differ.

  function addPixelNoise(data) {
    for (let i = 0; i < data.length; i += 4) {
      if (rand() < 0.05) {  // modify ~5% of pixels
        data[i]     = Math.max(0, Math.min(255, data[i]     + noise(1)));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise(1)));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise(1)));
      }
    }
  }

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
    const imageData = origGetImageData.call(this, sx, sy, sw, sh);
    addPixelNoise(imageData.data);
    return imageData;
  };

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    const ctx = this.getContext && this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      const id = origGetImageData.call(ctx, 0, 0, this.width, this.height);
      addPixelNoise(id.data);
      ctx.putImageData(id, 0, 0);
    }
    return origToDataURL.call(this, type, quality);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    const ctx = this.getContext && this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      const id = origGetImageData.call(ctx, 0, 0, this.width, this.height);
      addPixelNoise(id.data);
      ctx.putImageData(id, 0, 0);
    }
    return origToBlob.call(this, callback, type, quality);
  };

  // measureText: font detection scripts measure text rendered in candidate
  // fonts and compare widths against a fallback. Adding deterministic
  // noise per (text, font, prop) is consistent within a page so layout
  // doesn't break, but defeats the standard detection algorithm.
  //
  // Noise scales with sqrt(text length). Font fingerprinters use long
  // strings ("mmmmmmmmwwwwwwww") to amplify per-glyph width differences;
  // scaling the noise the same way means the noise dominates the genuine
  // font-difference signal for long strings, while staying small enough
  // (~0.1 px) for typical short labels to keep layout intact.
  function textNoise(text, propName, fontState) {
    let h = SEED;
    const stir = (s) => {
      for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9) >>> 0;
      }
    };
    stir(text);
    stir(propName);
    stir(fontState);
    const base = ((h / 4294967296) - 0.5) * 0.5;          // ±0.25 px base
    const scale = Math.sqrt(Math.max(1, text.length));    // 1 → 1, 16 → 4, 64 → 8
    return base * scale;
  }

  const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText = function (text) {
    const metrics = origMeasureText.call(this, text);
    const fontState = this.font || '';
    return new Proxy(metrics, {
      get(target, prop) {
        const val = Reflect.get(target, prop);
        if (typeof val === 'number') return val + textNoise(String(text), String(prop), fontState);
        return val;
      }
    });
  };

  // Same defence for OffscreenCanvas if available
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const origOffMeasureText = OffscreenCanvasRenderingContext2D.prototype.measureText;
    OffscreenCanvasRenderingContext2D.prototype.measureText = function (text) {
      const metrics = origOffMeasureText.call(this, text);
      const fontState = this.font || '';
      return new Proxy(metrics, {
        get(target, prop) {
          const val = Reflect.get(target, prop);
          if (typeof val === 'number') return val + textNoise(String(text), String(prop), fontState);
          return val;
        }
      });
    };
  }

  // ─── WEBGL FINGERPRINTING ────────────────────────────────────────────────
  // Disable WEBGL_debug_renderer_info entirely — matches Firefox's
  // privacy.resistFingerprinting=true behaviour and CanvasBlocker's
  // {disabled} mode. Returning ANY spoofed string for UNMASKED_VENDOR /
  // UNMASKED_RENDERER (even generic ones like "Intel(R) HD Graphics") was
  // still 14+ bits in EFF's DB because the exact spoof string is itself
  // distinctive. The Firefox RFP "extension doesn't exist" state is much
  // more common (every privacy-conscious user shares it).
  //
  // We also randomize a few non-string numeric WebGL params (the GPU
  // capability values like MAX_TEXTURE_SIZE) so the WebGL hash keeps
  // changing per session/origin — CanvasBlocker's technique.

  // Numeric WebGL parameters that leak hardware identity. Indexed by their
  // GL enum value (the constant numeric pname). We perturb each by a small
  // amount, deterministic per session+pname so a single page is consistent.
  const WEBGL_PARAM_NOISE = {
    3379:  () => -randInt(0, 1),            // MAX_TEXTURE_SIZE       (right-shift by 0 or 1)
    34076: () => -randInt(0, 1),            // MAX_CUBE_MAP_TEXTURE_SIZE
    34024: () => -randInt(0, 1),            // MAX_RENDERBUFFER_SIZE
    33000: () => -randInt(0, 150),          // MAX_ELEMENTS_VERTICES
    33001: () => -randInt(0, 150),          // MAX_ELEMENTS_INDICES
  };

  function patchWebGLContext(ctx) {
    if (!ctx) return;

    // (1) Hide WEBGL_debug_renderer_info from getExtension
    const origGetExtension = ctx.getExtension.bind(ctx);
    ctx.getExtension = function (name) {
      if (name === 'WEBGL_debug_renderer_info') return null;
      return origGetExtension(name);
    };

    // (2) Hide it from getSupportedExtensions so feature-detection also fails
    const origGetSupportedExt = ctx.getSupportedExtensions.bind(ctx);
    ctx.getSupportedExtensions = function () {
      const exts = origGetSupportedExt();
      return exts ? exts.filter((e) => e !== 'WEBGL_debug_renderer_info') : exts;
    };

    // (3) For sites that try the raw enum (0x9245 / 0x9246) without getting
    // the extension first, return null too — matches Firefox RFP behaviour.
    const UNMASKED_VENDOR   = 0x9245;
    const UNMASKED_RENDERER = 0x9246;

    const origGetParam = ctx.getParameter.bind(ctx);
    ctx.getParameter = function (pname) {
      if (pname === UNMASKED_VENDOR || pname === UNMASKED_RENDERER) return null;
      // Perturb numeric capability values
      const perturb = WEBGL_PARAM_NOISE[pname];
      if (perturb) {
        const real = origGetParam(pname);
        if (typeof real === 'number') return real + perturb();
      }
      return origGetParam(pname);
    };

    // (4) Add noise to readPixels output
    const origReadPixels = ctx.readPixels.bind(ctx);
    ctx.readPixels = function (x, y, w, h, format, type, pixels) {
      origReadPixels(x, y, w, h, format, type, pixels);
      if (pixels instanceof Uint8Array) {
        for (let i = 0; i < pixels.length; i += 4) {
          if (rand() < 0.05) {
            pixels[i]     = Math.max(0, Math.min(255, pixels[i]     + noise(1)));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + noise(1)));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + noise(1)));
          }
        }
      }
    };
  }

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = origGetContext.call(this, type, attrs);
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
      patchWebGLContext(ctx);
    }
    return ctx;
  };

  // ─── AUDIO FINGERPRINTING ────────────────────────────────────────────────
  // Adds tiny imperceptible noise to AudioBuffer and AnalyserNode outputs.
  // Defeats the classic OscillatorNode → DynamicsCompressor → OfflineAudioContext attack.

  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  function patchAudioBuffer(buf) {
    if (!buf) return buf;
    const origGetChannelData = buf.getChannelData.bind(buf);
    buf.getChannelData = function (channel) {
      const data = origGetChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        if (rand() < 0.03) {
          data[i] += (rand() - 0.5) * 0.0001;
        }
      }
      return data;
    };
    return buf;
  }

  if (OfflineAudioCtxClass) {
    const origStartRendering = OfflineAudioCtxClass.prototype.startRendering;
    OfflineAudioCtxClass.prototype.startRendering = function () {
      return origStartRendering.call(this).then(buf => patchAudioBuffer(buf));
    };
  }

  if (AudioCtxClass) {
    const origCreateAnalyser = AudioCtxClass.prototype.createAnalyser;
    AudioCtxClass.prototype.createAnalyser = function () {
      const analyser = origCreateAnalyser.call(this);

      const origGetFloatFreq = analyser.getFloatFrequencyData.bind(analyser);
      analyser.getFloatFrequencyData = function (array) {
        origGetFloatFreq(array);
        for (let i = 0; i < array.length; i++) {
          if (array[i] > -Infinity) array[i] += (rand() - 0.5) * 0.0001;
        }
      };

      const origGetByteFreq = analyser.getByteFrequencyData.bind(analyser);
      analyser.getByteFrequencyData = function (array) {
        origGetByteFreq(array);
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.max(0, Math.min(255, array[i] + noise(1)));
        }
      };

      return analyser;
    };
  }

  // ─── NAVIGATOR FINGERPRINTING ────────────────────────────────────────────
  // Use fixed values matching the single most common configuration, not random
  // ones — this way every extension user looks identical and blends into the
  // largest possible group ("Tor Browser approach"). Per-user random values
  // would just scatter users into many small unique buckets.

  // User-Agent: spoof to Firefox 128 ESR (the most popular Firefox ESR).
  // The HTTP-layer User-Agent header is rewritten by background.js — this
  // override only handles the JS-side navigator.userAgent.
  const SPOOFED_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
  defineGetter(Navigator.prototype, 'userAgent',  () => SPOOFED_UA);
  defineGetter(Navigator.prototype, 'appVersion', () => '5.0 (X11)');
  defineGetter(Navigator.prototype, 'oscpu',      () => 'Linux x86_64');
  defineGetter(Navigator.prototype, 'buildID',    () => '20181001000000');

  // hardwareConcurrency: 4 cores is the global mode in EFF's dataset.
  // (Tried 2 to match Firefox RFP, but it's actually RARER than 4 in their
  // database — went from 2.10 bits → 4.26 bits. The RFP pool is small.)
  defineGetter(Navigator.prototype, 'hardwareConcurrency', () => 4);

  // deviceMemory: 8 GB is the most common bucket
  if ('deviceMemory' in Navigator.prototype) {
    defineGetter(Navigator.prototype, 'deviceMemory', () => 8);
  }

  // maxTouchPoints: 0 — typical desktop Firefox without touchscreen.
  // (User's test was leaking 5, identifying them as having touch hardware.)
  defineGetter(Navigator.prototype, 'maxTouchPoints', () => 0);

  // doNotTrack: signal DNT=1
  defineGetter(Navigator.prototype, 'doNotTrack', () => '1');

  // NOTE: We intentionally do NOT override navigator.plugins or navigator.mimeTypes.
  // Modern Firefox already returns a minimal stable plugin list for fingerprint
  // resistance, and our previous Object.create(PluginArray.prototype) override
  // was throwing "permission denied" errors when sites accessed it — the error
  // itself was uniquely identifying (10+ bits).

  // ─── SCREEN FINGERPRINTING ───────────────────────────────────────────────
  // Snap to the single most common screen configuration (1920x1080x24).
  // Adding noise (±Npx) creates NEW unique values like "1352x624x24" — worse
  // than the original. Snapping to one popular resolution blends every
  // extension user into the biggest bucket.

  try {
    const ScreenProto = Screen.prototype;
    defineGetter(ScreenProto, 'width',       () => 1920);
    defineGetter(ScreenProto, 'height',      () => 1080);
    defineGetter(ScreenProto, 'availWidth',  () => 1920);
    defineGetter(ScreenProto, 'availHeight', () => 1040);  // minus typical taskbar
    defineGetter(ScreenProto, 'colorDepth',  () => 24);
    defineGetter(ScreenProto, 'pixelDepth',  () => 24);
  } catch (_) {}

  // devicePixelRatio: 1 is the most common (standard DPI displays)
  try {
    defineGetter(window, 'devicePixelRatio', () => 1);
  } catch (_) {}

  // ─── WEBRTC IP LEAK PROTECTION ───────────────────────────────────────────
  // Intercept ICE candidates and suppress those that reveal local/public IPs.

  const origRTCPC = window.RTCPeerConnection;
  if (origRTCPC) {
    function GhostRTCPeerConnection(config, constraints) {
      const pc = new origRTCPC(config, constraints);

      // Wrap onicecandidate setter to filter candidates
      let _handler = null;
      Object.defineProperty(pc, 'onicecandidate', {
        get: () => _handler,
        set: (fn) => {
          _handler = fn ? function (evt) {
            if (evt && evt.candidate) {
              const c = evt.candidate.candidate || '';
              // Drop candidates that reveal host or srflx IPs
              if (/typ (host|srflx)/.test(c)) return;
            }
            fn.call(this, evt);
          } : null;
        },
        configurable: true
      });

      return pc;
    }
    GhostRTCPeerConnection.prototype = origRTCPC.prototype;
    Object.setPrototypeOf(GhostRTCPeerConnection, origRTCPC);

    try {
      window.RTCPeerConnection = GhostRTCPeerConnection;
    } catch (_) {}
  }

  // ─── BATTERY API ─────────────────────────────────────────────────────────
  // Return randomised but plausible battery state.

  if (navigator.getBattery) {
    const fakeLevel    = 0.2 + Math.round(rand() * 80) / 100;
    const fakeCharging = rand() > 0.4;

    navigator.getBattery = function () {
      return Promise.resolve({
        charging:        fakeCharging,
        chargingTime:    fakeCharging ? randInt(300, 7200) : Infinity,
        dischargingTime: fakeCharging ? Infinity : randInt(3600, 21600),
        level:           fakeLevel,
        addEventListener:    () => {},
        removeEventListener: () => {},
        dispatchEvent:       () => false
      });
    };
  }

  // ─── MEDIA DEVICES ───────────────────────────────────────────────────────
  // Randomize device IDs so they can't be used to track across sites.

  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    function hashId(str) {
      let h = SEED;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    }

    const origEnumDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = function () {
      return origEnumDevices().then(devices =>
        devices.map(d => ({
          kind:     d.kind,
          label:    d.label,
          deviceId: hashId(d.deviceId + 'device'),
          groupId:  hashId(d.groupId  + 'group'),
          toJSON:   () => ({})
        }))
      );
    };
  }

  // ─── FONT ENUMERATION ────────────────────────────────────────────────────
  // Override document.fonts.check() to return false for non-default fonts
  // with seeded probability, making font sets unreliable for fingerprinting.

  if (document.fonts && document.fonts.check) {
    const COMMON_FONTS = new Set([
      'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
      'Trebuchet MS', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'
    ]);

    const origCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function (font, text) {
      const result = origCheck(font, text);
      // Extract font family name from CSS font string
      const match = font.match(/"([^"]+)"|'([^']+)'|(\S+)$/);
      const name  = match ? (match[1] || match[2] || match[3]) : '';
      // Randomly suppress uncommon font detection based on seed
      if (result && !COMMON_FONTS.has(name)) {
        const fontHash = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, SEED);
        if ((fontHash % 100) < 40) return false;  // suppress 40% of uncommon fonts
      }
      return result;
    };
  }

  // ─── TIMEZONE PROTECTION ─────────────────────────────────────────────────
  // NOTE: We intentionally do NOT modify getTimezoneOffset() or
  // Intl.DateTimeFormat timezone. Modifying only one of them creates a
  // detectable inconsistency (e.g. offset says UTC-8 but IANA name says
  // "America/Sao_Paulo") that is itself uniquely identifying — worse than
  // doing nothing. Consistent timezone information is less harmful.

  // ─── CLIENT RECTS FINGERPRINTING ─────────────────────────────────────────
  // getBoundingClientRect / getClientRects are used to measure font/element metrics.

  const origGetBCR = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = origGetBCR.call(this);
    const n = noise(1) * 0.01;  // sub-pixel noise
    return new DOMRect(r.x + n, r.y + n, r.width + n, r.height + n);
  };

  // Clean up the preamble global so page scripts can't detect us
  try { delete window.__ghostprint__; } catch (_) {}
})();
