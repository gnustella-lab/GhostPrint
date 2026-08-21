# Graph Report - GhostPrint  (2026-08-20)

## Corpus Check
- 28 files · ~18,459 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 337 nodes · 387 edges · 29 communities (24 shown, 5 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7e48a354`
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
- createPageContext
- installers.test.js
- settings.test.js
- inject-harness.js
- seed.test.js
- popup-a11y.test.js
- frames.test.js
- FakeWebGLContext
- background.js
- settings.js
- content.js
- seed.js
- FakeCanvas
- FakeCanvas2DContext
- FakeStorage
- webgpu.test.js
- PageWebGLContext
- GATES.md
- popup-status.test.js

## God Nodes (most connected - your core abstractions)
1. `createPageContext()` - 11 edges
2. `GhostPrint` - 11 edges
3. `init()` - 8 edges
4. `Important architectural limitations` - 8 edges
5. `bindControls()` - 7 edges
6. `PageCanvas2DContext` - 7 edges
7. `PageCanvas` - 7 edges
8. `createPageContext()` - 7 edges
9. `PageAnalyserNode` - 6 edges
10. `createPageContext()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `createPageContext()` --indirect_call--> `PageNavigator`  [INFERRED]
  tests/helpers/plugin-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageCanvas2DContext`  [INFERRED]
  tests/helpers/canvas-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageCanvas2DContext`  [INFERRED]
  tests/helpers/inject-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageWebGLContext`  [INFERRED]
  tests/helpers/inject-harness.js → tests/helpers/audio-harness.js
- `createPageContext()` --indirect_call--> `PageCanvas`  [INFERRED]
  tests/helpers/canvas-harness.js → tests/helpers/audio-harness.js

## Import Cycles
- None detected.

## Communities (29 total, 5 thin omitted)

### Community 0 - "audio-harness.js"
Cohesion: 0.06
Nodes (17): assert, {
  createPageContext,
  installInject,
}, test, assert, {
  createPageContext,
  installInject,
}, test, createPageContext(), FakeStorage (+9 more)

### Community 1 - "manifest.json"
Cohesion: 0.06
Nodes (33): author, background, persistent, scripts, browser_action, default_icon, default_popup, default_title (+25 more)

### Community 2 - "canvas-harness.js"
Cohesion: 0.12
Nodes (11): assert, {
  createPageContext,
  installInject,
  sourcePixel,
}, test, FakeStorage, FakeWebGLContext, fs, INJECT_SOURCE, installInject() (+3 more)

### Community 3 - "plugin-harness.js"
Cohesion: 0.08
Nodes (14): createPageContext(), FakeMimeType, FakeMimeTypeArray, FakePlugin, FakePluginArray, FakeStorage, fs, INJECT_SOURCE (+6 more)

### Community 4 - "GhostPrint"
Cohesion: 0.11
Nodes (18): Current scope, Detectability and compatibility, Development and verification, Development installation, Firefox Android, Frames and special documents, Future WebGPU fingerprinting surfaces, GhostPrint (+10 more)

### Community 5 - "inject.js"
Cohesion: 0.19
Nodes (10): defineGetter(), installCanvasProtection(), installNavigatorProtection(), installPluginProtection(), isTypedArray(), mix(), parsePageSeed(), parseSeedFromCurrentScript() (+2 more)

### Community 6 - "popup.js"
Cohesion: 0.31
Nodes (13): bindControls(), currentSettings, EFF_FIELDS, init(), loadInjectionStatus(), loadSettings(), renderError(), renderFields() (+5 more)

### Community 7 - "package.json"
Cohesion: 0.17
Nodes (11): description, engines, node, name, private, scripts, build, check (+3 more)

### Community 8 - "build.js"
Cohesion: 0.17
Nodes (10): { execFileSync }, files, fs, manifest, os, output, outputDirectory, path (+2 more)

### Community 9 - "content.test.js"
Cohesion: 0.18
Nodes (9): assert, CONTENT_SOURCE, fs, path, ROOT, SEED_SOURCE, SETTINGS_SOURCE, test (+1 more)

### Community 10 - "createPageContext"
Cohesion: 0.28
Nodes (6): installInject(), readPixelsAfterGetContextCalls(), assert, {
  createPageContext,
  installInject,
  readPixelsAfterGetContextCalls,
}, syntheticFor(), test

### Community 11 - "installers.test.js"
Cohesion: 0.18
Nodes (7): assert, { createPageContext, installInject }, fs, INJECT_SOURCE, path, test, vm

### Community 12 - "settings.test.js"
Cohesion: 0.17
Nodes (8): assert, BACKGROUND_SOURCE, fs, path, ROOT, SETTINGS_SOURCE, test, vm

### Community 13 - "inject-harness.js"
Cohesion: 0.22
Nodes (6): FakeDocument, FakeNavigator, fs, INJECT_SOURCE, path, vm

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
Cohesion: 0.60
Nodes (4): cloneDefaultSettings(), DEFAULT_SETTINGS, normalizeSettings(), validateSettings()

### Community 20 - "content.js"
Cohesion: 0.83
Nodes (3): initializeContentScript(), installHooks(), loadSettingsFromBackground()

### Community 21 - "seed.js"
Cohesion: 0.83
Nodes (3): generateSeed(), getOrCreateSeed(), parseSeedValue()

### Community 25 - "webgpu.test.js"
Cohesion: 0.50
Nodes (3): assert, { createPageContext, installInject }, test

### Community 26 - "PageWebGLContext"
Cohesion: 0.12
Nodes (7): PageCanvas, PageCanvas2DContext, PageDocument, PageNavigator, PageWebGLContext, createPageContext(), createPageContext()

### Community 28 - "popup-status.test.js"
Cohesion: 0.20
Nodes (10): assert, createElement(), fs, loadPopup(), path, POPUP_SOURCE, ROOT, SETTINGS_SOURCE (+2 more)

## Knowledge Gaps
- **145 isolated node(s):** `settingsQueue`, `manifest_version`, `name`, `version`, `description` (+140 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createPageContext()` connect `PageWebGLContext` to `webgpu.test.js`, `createPageContext`, `installers.test.js`, `inject-harness.js`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `PageNavigator` connect `PageWebGLContext` to `audio-harness.js`, `plugin-harness.js`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `createPageContext()` connect `plugin-harness.js` to `PageWebGLContext`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `createPageContext()` (e.g. with `inject-harness.js` and `PageCanvas`) actually correct?**
  _`createPageContext()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `settingsQueue`, `manifest_version`, `name` to the rest of the system?**
  _145 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `audio-harness.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06190476190476191 - nodes in this community are weakly interconnected._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._