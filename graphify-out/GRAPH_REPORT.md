# Graph Report - GhostPrint  (2026-08-21)

## Corpus Check
- 28 files · ~22,648 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 362 nodes · 440 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f20472c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- audio-harness.js
- manifest.json
- canvas-harness.js
- plugin-harness.js
- GhostPrint
- inject.js
- popup.js
- package.json
- build.js
- content.test.js
- installers.test.js
- settings.test.js
- seed.test.js
- popup-a11y.test.js
- frames.test.js
- background.js
- settings.js
- content.js
- seed.js
- FakeCanvas2DContext
- GATES.md
- popup-status.test.js

## God Nodes (most connected - your core abstractions)
1. `createPageContext()` - 11 edges
2. `GhostPrint` - 11 edges
3. `init()` - 10 edges
4. `renderInjectionViews()` - 8 edges
5. `Important architectural limitations` - 8 edges
6. `bindControls()` - 7 edges
7. `PageCanvas2DContext` - 7 edges
8. `PageCanvas` - 7 edges
9. `createPageContext()` - 7 edges
10. `PageAnalyserNode` - 6 edges

## Surprising Connections (you probably didn't know these)
- `createPageContext()` --indirect_call--> `PageCanvas2DContext`  [INFERRED]
  tests/helpers/inject-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageWebGLContext`  [INFERRED]
  tests/helpers/inject-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageCanvas`  [INFERRED]
  tests/helpers/inject-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageDocument`  [INFERRED]
  tests/helpers/canvas-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageNavigator`  [INFERRED]
  tests/helpers/canvas-harness.js → tests/helpers/audio-harness.js

## Import Cycles
- None detected.

## Communities (22 total, 2 thin omitted)

### Community 0 - "audio-harness.js"
Cohesion: 0.05
Nodes (19): assert, {
  createPageContext,
  installInject,
}, test, assert, {
  createPageContext,
  installInject,
}, test, createPageContext(), FakeStorage (+11 more)

### Community 1 - "manifest.json"
Cohesion: 0.06
Nodes (33): author, background, persistent, scripts, browser_action, default_icon, default_popup, default_title (+25 more)

### Community 2 - "canvas-harness.js"
Cohesion: 0.08
Nodes (14): assert, {
  createPageContext,
  installInject,
  sourcePixel,
}, test, PageCanvas, PageCanvas2DContext, createPageContext(), FakeStorage, FakeWebGLContext (+6 more)

### Community 3 - "plugin-harness.js"
Cohesion: 0.08
Nodes (14): createPageContext(), FakeMimeType, FakeMimeTypeArray, FakePlugin, FakePluginArray, FakeStorage, fs, INJECT_SOURCE (+6 more)

### Community 4 - "GhostPrint"
Cohesion: 0.10
Nodes (19): Current scope, Detectability and compatibility, Development and verification, Development installation, Firefox Android, Frames and special documents, Future WebGPU fingerprinting surfaces, GhostPrint (+11 more)

### Community 5 - "inject.js"
Cohesion: 0.16
Nodes (12): defineGetter(), installCanvasProtection(), installNavigatorProtection(), installPluginProtection(), isTypedArray(), mix(), parsePageSeed(), parseSeedFromCurrentScript() (+4 more)

### Community 6 - "popup.js"
Cohesion: 0.20
Nodes (23): bindActions(), bindControls(), closePopup(), currentSettings, EFF_FIELDS, getActiveTab(), init(), isSupportedTabUrl() (+15 more)

### Community 7 - "package.json"
Cohesion: 0.17
Nodes (11): description, engines, node, name, private, scripts, build, check (+3 more)

### Community 8 - "build.js"
Cohesion: 0.17
Nodes (10): { execFileSync }, files, fs, manifest, os, output, outputDirectory, path (+2 more)

### Community 9 - "content.test.js"
Cohesion: 0.18
Nodes (9): assert, CONTENT_SOURCE, fs, path, ROOT, SEED_SOURCE, SETTINGS_SOURCE, test (+1 more)

### Community 11 - "installers.test.js"
Cohesion: 0.05
Nodes (27): PageDocument, createPageContext(), FakeCanvas, FakeDocument, FakeNavigator, FakeStorage, FakeWebGLContext, fs (+19 more)

### Community 12 - "settings.test.js"
Cohesion: 0.15
Nodes (8): assert, BACKGROUND_SOURCE, fs, path, ROOT, SETTINGS_SOURCE, test, vm

### Community 14 - "seed.test.js"
Cohesion: 0.25
Nodes (6): assert, fs, path, SEED_SOURCE_PATH, test, vm

### Community 15 - "popup-a11y.test.js"
Cohesion: 0.29
Nodes (6): assert, css, fs, html, path, test

### Community 16 - "frames.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, manifest, path, test

### Community 18 - "background.js"
Cohesion: 0.48
Nodes (6): enqueueSettings(), ensureSettings(), readSettings(), settingsNeedRepair(), settingsQueue, writeSettings()

### Community 19 - "settings.js"
Cohesion: 0.44
Nodes (8): cloneDefaultSettings(), DEFAULT_SETTINGS, isValidSiteMode(), normalizeSettings(), normalizeSiteOrigin(), normalizeSites(), resolveEnabledForOrigin(), validateSettings()

### Community 20 - "content.js"
Cohesion: 0.31
Nodes (8): createReportToken(), initializeContentScript(), installHooks(), listenForInstallationReport(), loadSettingsFromBackground(), PAGE_ORIGIN, REPORT_SURFACES, sanitizeInstallationReport()

### Community 21 - "seed.js"
Cohesion: 0.83
Nodes (3): generateSeed(), getOrCreateSeed(), parseSeedValue()

### Community 28 - "popup-status.test.js"
Cohesion: 0.20
Nodes (10): assert, createElement(), fs, loadPopup(), path, POPUP_SOURCE, ROOT, SETTINGS_SOURCE (+2 more)

## Knowledge Gaps
- **147 isolated node(s):** `settingsQueue`, `REPORT_SURFACES`, `PAGE_ORIGIN`, `manifest_version`, `name` (+142 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createPageContext()` connect `installers.test.js` to `audio-harness.js`, `canvas-harness.js`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `PageNavigator` connect `audio-harness.js` to `plugin-harness.js`, `canvas-harness.js`, `installers.test.js`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `createPageContext()` connect `plugin-harness.js` to `audio-harness.js`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `createPageContext()` (e.g. with `inject-harness.js` and `PageCanvas`) actually correct?**
  _`createPageContext()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `settingsQueue`, `REPORT_SURFACES`, `PAGE_ORIGIN` to the rest of the system?**
  _147 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `audio-harness.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05365853658536585 - nodes in this community are weakly interconnected._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._