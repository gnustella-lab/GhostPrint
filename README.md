# GhostPrint

GhostPrint is a Firefox Manifest V2 extension that applies deterministic farbling to selected fingerprinting APIs. It aims to reduce fingerprint stability across origins without altering every native call or pretending to be equivalent to Brave, Tor Browser, or Firefox Resist Fingerprinting.

The extension does not collect, transmit, or send data to external servers. The seed is generated locally with `crypto.getRandomValues` and used only to produce deterministic values in the page context.

## Current scope

The implemented surfaces are:

| Surface | Behavior |
| --- | --- |
| Canvas 2D | Changes a sparse subset of RGB channels in `getImageData`, `toDataURL`, and `toBlob` reads. Alpha remains intact. |
| WebGL and WebGL 2 | Normalizes masked and unmasked vendor/renderer values to the generic Firefox-aligned string `Mozilla`. `WEBGL_debug_renderer_info` remains usable, but its hardware strings are normalized. Real extensions remain available and one seed-selected synthetic extension is appended; `getExtension()` returns one stable, inert object for that synthetic name. `readPixels()` farbling still applies only to safe `RGBA` + `UNSIGNED_BYTE` typed-array reads and respects WebGL 2 `dstOffset`. |
| WebGPU | Scrubs `vendor`, `architecture`, and `device` from `GPUAdapterInfo` reached through both `GPUAdapter.info` and `GPUDevice.adapterInfo`. Adapter/device identity, Promises, `requestDevice()`, `features`, and `limits` remain operational and are not randomized. |
| Web Audio | Applies deterministic farbling to `AudioBuffer` and `AnalyserNode` reads, including frequency and time-domain channels when those APIs exist. `AudioBuffer` channel reads use stable farbled copies so native playback samples are not mutated. |
| Navigator | Applies deterministic farbling to `hardwareConcurrency`. |
| Plugins and MIME types | Preserves native entries and adds a deterministic PDF profile with related objects across `navigator.plugins` and `navigator.mimeTypes`. |

The code uses feature detection. The absence of one specific API should not prevent other available installers from running.

### Per-site overrides

Settings are `{ enabled: boolean, sites: { "<origin>": "on" | "off" } }`. The popup exposes a per-origin switch for the active tab using denylist semantics: the global switch always wins, and an explicit `off` disables one origin while protection is globally on. The content script sends its origin with the settings request and the background resolves the effective decision; when the background is unreachable the content script still fails safe to global ON. Site writes must already be canonical origins (lowercase serialized `http`/`https` origin); normalization caps the map at 500 entries.

The popup also shows which surfaces actually installed on the loaded page. After injection, `inject.js` answers a one-time tokened `postMessage` handshake started by the content script with its installer results (`installed`, `unavailable`, or `failed` per surface). The page can observe, spoof, or suppress that report — it is advisory status for the popup only, never a functional input, and the receiving side validates an unguessable token before trusting it.

Two actions complete the popup: **Reload page** applies pending setting changes to the active tab, and **New identity** clears the site's session seed through a `RESET_SEED` message and reloads the tab so the next load generates a fresh one.

## How the seed works

`seed.js` creates a validated 32-bit decimal seed with `crypto.getRandomValues` and stores it in the content script's `sessionStorage`. Before loading `inject.js`, `content.js` carries that validated value in the URL fragment of the external resource. The page-realm code uses only the carried value and never reads page-visible storage, avoiding a seed swap between the content-script lookup and hook startup.

The practical scope is the browser's session-storage area: the same origin in the same top-level browsing context normally reuses the seed across reloads, while a separate origin, tab/session-storage area, or contextual storage environment creates its own seed. Same-origin iframes normally share their top-level context's same-origin storage area; cross-origin frames use a different area and therefore a different seed. `example.com`, `www.example.com`, and `sub.example.com` are separate origins and are not collapsed to one eTLD+1 seed. This intentionally avoids incorrect hand-written public-suffix parsing and extra permissions. Brave instead persists a farbling token in Shields metadata by profile and schemeful site, clears it with the corresponding site metadata, and mixes StorageKey/partition entropy where applicable; the article's session/site/storage wording is not equivalent to resetting one token on every browser restart.

Generation occurs before injection. If session storage or crypto fails, the extension avoids partial page-realm installation. When protection is disabled, no new seed is created.

The seed and URL fragment are not secrets. The page can observe the fragment and the script element, and can also try to interfere with the DOM. Because the storage key is page-visible, an early script can pre-populate a valid seed before the asynchronous settings gate and force that value for the load. Therefore, the seed is a determinism anchor, not a security boundary. Later changes to page storage do not change the seed already loaded by the hooks.

## GPU protection design reference

The GPU changes are based on Brave 1.93's published design and its upstream implementation work, not only the announcement: [GPU protection article](https://brave.com/privacy-updates/38-webgl-webgpu-fingerprinting-protections/), [WebGL identity normalization](https://github.com/brave/brave-core/pull/36354), [farbled extension integration](https://github.com/brave/brave-core/pull/36605), [WebGL extension handler](https://github.com/brave/brave-core/pull/36762), and [WebGPU adapter-info scrubbing](https://github.com/brave/brave-core/pull/36817). GhostPrint reproduces the relevant observable behavior in the Firefox page realm; it does not claim engine-level equivalence with Brave's Blink patches.

## Important architectural limitations

### Manifest V2 exposure window

The content script is requested at `document_start`, but the `browser.storage.local` query and seed generation/verification are asynchronous. Very early inline scripts may execute before `inject.js`. The extension cannot eliminate this window using Manifest V2 and asynchronous storage alone.

A page script that wins this race and saves original WebGL/WebGPU methods, a pre-protection context, or already-read GPU strings can keep using those references; JavaScript installed afterward cannot revoke them. The prototype hooks do cover contexts obtained later through a saved native `getContext` reference.

### Frames and special documents

The manifest uses `all_frames`, `match_about_blank`, and `match_origin_as_fallback` to expand coverage to matching HTTP and HTTPS frames, `about:blank`, `about:srcdoc`, `data:`, and `blob:` documents. In Firefox, empty iframes may not receive content scripts at `document_start`, even with `match_about_blank`.

Frames whose URLs do not match, privileged browser pages, extension pages, some opaque-origin documents, and documents loaded before installation may remain unprotected.

### Workers and worklets

`OffscreenCanvas` is protected when it is used in an injected document realm, through the same WebGL/WebGL 2 prototype hooks as `HTMLCanvasElement`. `Worker`, `SharedWorker`, `ServiceWorker`, `AudioWorklet`, `PaintWorklet`, and other independent realms are not entered by a Firefox content script, so worker-owned `OffscreenCanvas`, WebGL, and WebGPU remain possible bypasses. GhostPrint does not rewrite worker source URLs or blob scripts because doing so would be invasive and brittle.

In a protected document realm, `OffscreenCanvas` WebGL metadata and typed-array `readPixels()` calls are covered. `convertToBlob()`, `transferToImageBitmap()`, OffscreenCanvas 2D readback, and other export paths are not wrapped directly and can remain alternate readback surfaces.

### Detectability and compatibility

A page can detect changes by inspecting descriptors, prototypes, `toString`, object identities, errors, timing, uncovered overloads, and differences between realms. Synthetic Plugin/MIME type objects are built to preserve coherent references, but they do not have the browser's native internal slots and may be detectable or incompatible with code that relies on non-standard details.

The idempotency registry lives in the page realm. Its symbol key is not predictable, but a hostile page can enumerate or pre-forge structurally similar symbol values, alter the registry, or tamper with the patched prototypes. No JavaScript-only marker in the same realm can provide engine-level authenticity.

WebGL 2 pixel-pack-buffer readback remains a bypass: the numeric `readPixels(..., offset)` overload writes native bytes into the bound PBO, and GhostPrint does not intercept the later `getBufferSubData()` read. The wrapper intentionally does not treat a numeric offset as a typed array or guess buffer layout.

The synthetic WebGL extension object is deliberately inert: it grants no capability and carries no methods. Its name is selected from a 21-entry Khronos-style pool derived locally from the seed and cached per context. The pool recreates Brave's combinatorial strategy without copying Brave's extension-name list. This keeps the behavior coherent, but the JavaScript object cannot reproduce Blink/V8 internal slots and is therefore detectable by sufficiently adversarial code.

### Future WebGPU fingerprinting surfaces

WebGPU `description`, `features`, `limits`, subgroup sizes, memory-heap information, and future adapter/device fields are not modified. Brave 1.93 scrubs only `vendor`, `architecture`, and `device`; extension/feature farbling for WebGPU is described by Brave as future work. Some of these untouched fields can still carry fingerprinting entropy.

Brave 1.93 also deliberately bypasses its `GPUAdapterInfo` scrubbing when Chromium's WebGPU developer features are enabled. GhostPrint does not model Brave's OFF/BALANCED/MAXIMUM modes or that developer-feature exception; when its protection is enabled and the JavaScript hooks are reached, it scrubs the three fields.

### Other compatibility notes

`navigator.pdfViewerEnabled` is not spoofed. The property may reflect the real viewer availability, avoiding contradictions with PDF support and preventing viewer breakage.

### Firefox Android

The manifest declares Firefox 140 as the minimum version. This configuration has not been validated on a real Android device in this project version. Treat Android support as experimental until the extension has been exercised in Firefox for Android.

## What the extension does not promise

- It is not equivalent to Brave, Tor Browser, or Firefox Resist Fingerprinting.
- It does not guarantee anonymity or prevent correlation through IP address, cookies, login, storage, fonts, screen, network, or behavior.
- It does not protect every realm, worker, worklet, iframe, or fingerprinting API.
- It does not guarantee that every page will remain compatible with the synthetic Plugin/MIME type objects.
- It does not guarantee permanent approval in Cover Your Tracks. That result is only evidence about some surfaces in one specific configuration.

## Development installation

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Click **Load Temporary Add-on**.
4. Select the `manifest.json` file in this directory.
5. Reload pages that were already open.

The popup lets you enable or disable protection globally, toggle it for the current site, reload the page to apply changes, and rotate the session seed with **New identity**. Setting changes affect only new injections, so pages must be reloaded; the popup surfaces a reload action whenever that is the case.

## Development and verification

Requirements: Node.js 20 or later, npm, and the `zip` utility for local builds.

```bash
npm ci
npm test
npm run check
npm run lint
npm run build
```

`npm run lint` downloads exactly the `web-ext@10.5.0` version declared in the script through `npx`; this tool is not a runtime dependency and is not packaged with the extension.

`npm run build` creates a versioned ZIP in `dist/` containing only the files required by the extension. The `dist` directory is ignored by Git. `tests/gpu-fingerprinting-harness.html` provides a manual WebGL/WebGL 2/WebGPU collection and rendering smoke test; serve the repository over HTTP(S) so the extension matches the page and WebGPU can use a secure context.

The local suite uses behavioral tests with `vm` realms and API mocks. It covers WebGL idempotence, `dstOffset` overloads, Canvas coordinates, Audio surfaces, seeds, settings, API degradation, Plugin/MIME type coherence, and static popup accessibility. These tests do not replace execution in real Firefox.

Before distributing a version, manually verify the following in Firefox:

- HTTP and HTTPS pages with early inline scripts;
- same-origin, cross-origin, `about:blank`, and `srcdoc` iframes;
- PDF.js and image upload/export;
- WebGL 1 and WebGL 2 calls, including PBOs;
- `AudioBuffer`, `AnalyserNode`, workers, and `OffscreenCanvas`;
- navigation after disabling and re-enabling the extension;
- keyboard access, visible focus, and popup error messages;
- per-site switch on and off against the loaded page (banner and seed line);
- New identity produces a different seed hex for the same origin after reload.

## Main files

| File | Purpose |
| --- | --- |
| `manifest.json` | Firefox MV2 manifest, permissions, and injection rules |
| `settings.js` | Defaults, schema, normalization, and validation |
| `seed.js` | Seed validation and cryptographic generation |
| `background.js` | State owner and settings communication |
| `content.js` | Bridge between the content script, background page, and page |
| `inject.js` | Canvas, WebGL, WebGPU, Audio, Navigator, and Plugin/MIME type hooks |
| `popup.html`, `popup.js`, `popup.css` | Accessible control interface |
| `tests/` | Harnesses and behavioral tests |
| `scripts/build.js` | Distribution ZIP packaging |

## Privacy

The extension has no analytics, telemetry, remote calls, or integrations with external services. Page content is not sent outside the browser. Host permissions exist to allow content scripts on matching HTTP and HTTPS pages.

## License

MIT. See `LICENSE`.
