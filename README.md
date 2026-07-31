# GhostPrint

A Firefox browser extension that randomizes your browser fingerprint to protect your privacy, inspired by Brave Browser's native fingerprinting protection.

## What it does

GhostPrint injects anti-fingerprinting hooks into every web page to make your browser appear different across different websites, preventing trackers from building a consistent profile of you.

## Protected fingerprint vectors

| Vector | Technique |
|--------|-----------|
| **Canvas** | Imperceptible pixel noise on read operations |
| **WebGL** | Same canvas farbling applied to `readPixels` |
| **Audio** | Subtle noise on `OfflineAudioContext` and analyser reads |
| **Plugins** | Injects seed-determined fake PDF plugins |
| **Hardware Concurrency** | Reports a randomized core count (2, 4, 6, 8, 12, or 16) |

## How it works

- **Per-session, per-origin seed**: Each tab session and each website gets its own random seed. The same site in the same tab always sees the same fingerprint (so pages don't break), but a different site or a new tab sees a completely different one.
- **Deterministic farbling**: All noise is a pure function of the seed, pixel position, and source values. This guarantees that repeated fingerprint probes on the same page return identical results, which is required to pass EFF's Cover Your Tracks cross-domain check.
- **Canvas reads are imperceptibly altered**: `getImageData`, `toDataURL`, and `toBlob` return real pixels with ~1 in 32 of them nudged by ±1 per RGB channel (alpha untouched). This shifts the fingerprint hash but is visually undetectable; note that exported images (PNG/JPEG/WebP, QR codes, screenshots saved via `toDataURL`) differ slightly from the original bytes.
- **Fail-safe defaults**: If storage is unavailable, protection stays ON rather than silently disabling.

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV2) |
| `settings.js` | Shared default settings, loaded by background, content scripts, and popup |
| `background.js` | Maintains on/off setting in `browser.storage.local` |
| `content.js` | Content script that runs at `document_start`; stores the per-origin seed in `sessionStorage` and injects `inject.js` via a web-accessible `<script src>` (CSP-safe) |
| `inject.js` | Injected into page context; overrides `Canvas`, `WebGL`, `Audio`, `navigator.plugins`, and `navigator.hardwareConcurrency` |
| `popup.html` / `popup.js` / `popup.css` | Extension popup UI with toggle, status, and protection list |
| `icons/ghost.svg` | Extension icon |

## Install (developer mode)

1. Open Firefox and go to `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Select `manifest.json` from this folder.
3. The GhostPrint icon will appear in the toolbar.

## Toggle protection

Click the GhostPrint icon in the toolbar to open the popup. Use the switch to enable or disable protection. Pages must be reloaded for the change to take effect.

## Compatibility

- Firefox (Manifest V2)
- Targets EFF's [Cover Your Tracks](https://coveryourtracks.eff.org/) test

## License

MIT
