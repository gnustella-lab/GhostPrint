# GhostPrint

GhostPrint is a Firefox Manifest V2 extension that applies deterministic farbling to selected fingerprinting APIs. It aims to reduce fingerprint stability across origins without altering every native call or pretending to be equivalent to Brave, Tor Browser, or Firefox Resist Fingerprinting.

The extension does not collect, transmit, or send data to external servers. The seed is generated locally with `crypto.getRandomValues` and used only to produce deterministic values in the page context.

## Current scope

The implemented surfaces are:

| Surface | Behavior |
| --- | --- |
| Canvas 2D | Changes a sparse subset of RGB channels in `getImageData`, `toDataURL`, and `toBlob` reads. Alpha remains intact. |
| WebGL | Changes only `RGBA` reads with `UNSIGNED_BYTE` typed arrays. It respects the actual write range and the WebGL 2 `dstOffset`. The numeric PBO overload is not treated as an array. It hides `WEBGL_debug_renderer_info` and leaves the vendor/renderer enums unmasked. |
| Web Audio | Applies deterministic farbling to `AudioBuffer` and `AnalyserNode` reads, including frequency and time-domain channels when those APIs exist. |
| Navigator | Applies deterministic farbling to `hardwareConcurrency`. |
| Plugins and MIME types | Preserves native entries and adds a deterministic PDF profile with related objects across `navigator.plugins` and `navigator.mimeTypes`. |

The code uses feature detection. The absence of one specific API should not prevent other available installers from running.

## How the seed works

The seed is a validated decimal integer persisted by the extension's background page. Before loading `inject.js`, the content script carries the validated value in the URL fragment of the external resource. The page realm uses only that loaded value, without reading or writing `sessionStorage`, avoiding a seed swap between the content-script query and hook startup.

Generation occurs before injection when the background page can obtain and verify a cryptographic seed. If storage or crypto fails, the extension fails explicitly and avoids partial injection. When protection is disabled, no new seed is created.

The seed and URL fragment are not secrets. The page can observe the fragment and the script element, and can also try to interfere with the DOM. Therefore, the seed is a determinism anchor, not a security boundary. Later changes to any page storage do not change the seed already loaded by the hooks.

## Important architectural limitations

### Manifest V2 exposure window

The content script is requested at `document_start`, but the `browser.storage.local` query and seed generation/verification are asynchronous. Very early inline scripts may execute before `inject.js`. The extension cannot eliminate this window using Manifest V2 and asynchronous storage alone.

### Frames and special documents

The manifest uses `all_frames`, `match_about_blank`, and `match_origin_as_fallback` to expand coverage to matching HTTP and HTTPS frames, `about:blank`, `about:srcdoc`, `data:`, and `blob:` documents. In Firefox, empty iframes may not receive content scripts at `document_start`, even with `match_about_blank`.

Frames whose URLs do not match, privileged browser pages, extension pages, some opaque-origin documents, and documents loaded before installation may remain unprotected.

### Workers and worklets

`Worker`, `SharedWorker`, `ServiceWorker`, `AudioWorklet`, `PaintWorklet`, `OffscreenCanvas`, and other independent realms are not protected by `inject.js`. An application that computes its fingerprint in those realms can bypass the hooks in the main page.

### Detectability and compatibility

A page can detect changes by inspecting descriptors, prototypes, `toString`, object identities, errors, timing, uncovered overloads, and differences between realms. Synthetic Plugin/MIME type objects are built to preserve coherent references, but they do not have the browser's native internal slots and may be detectable or incompatible with code that relies on non-standard details.

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

The popup lets you enable or disable protection. The change affects only new injections, so pages must be reloaded.

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

`npm run build` creates a versioned ZIP in `dist/` containing only the files required by the extension. The `dist` directory is ignored by Git.

The local suite uses behavioral tests with `vm` realms and API mocks. It covers WebGL idempotence, `dstOffset` overloads, Canvas coordinates, Audio surfaces, seeds, settings, API degradation, Plugin/MIME type coherence, and static popup accessibility. These tests do not replace execution in real Firefox.

Before distributing a version, manually verify the following in Firefox:

- HTTP and HTTPS pages with early inline scripts;
- same-origin, cross-origin, `about:blank`, and `srcdoc` iframes;
- PDF.js and image upload/export;
- WebGL 1 and WebGL 2 calls, including PBOs;
- `AudioBuffer`, `AnalyserNode`, workers, and `OffscreenCanvas`;
- navigation after disabling and re-enabling the extension;
- keyboard access, visible focus, and popup error messages.

## Main files

| File | Purpose |
| --- | --- |
| `manifest.json` | Firefox MV2 manifest, permissions, and injection rules |
| `settings.js` | Defaults, schema, normalization, and validation |
| `seed.js` | Seed validation and cryptographic generation |
| `background.js` | State owner and settings communication |
| `content.js` | Bridge between the content script, background page, and page |
| `inject.js` | Canvas, WebGL, Audio, Navigator, and Plugin/MIME type hooks |
| `popup.html`, `popup.js`, `popup.css` | Accessible control interface |
| `tests/` | Harnesses and behavioral tests |
| `scripts/build.js` | Distribution ZIP packaging |

## Privacy

The extension has no analytics, telemetry, remote calls, or integrations with external services. Page content is not sent outside the browser. Host permissions exist to allow content scripts on matching HTTP and HTTPS pages.

## License

MIT. See `LICENSE`.
