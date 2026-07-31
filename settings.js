'use strict';

// Single source of truth for the default settings. Loaded by the background
// page (manifest "background.scripts"), by content scripts (manifest
// "content_scripts.js"), and by the popup (popup.html) — all in that order,
// so every context sees the same DEFAULT_SETTINGS binding. Do not duplicate
// this object anywhere else.
const DEFAULT_SETTINGS = { enabled: true };
