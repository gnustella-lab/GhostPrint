'use strict';

// Single source of truth for the default settings. Loaded by the background
// page, content scripts, and popup. Keep this schema deliberately small.
const DEFAULT_SETTINGS = Object.freeze({ enabled: true });

function cloneDefaultSettings() {
  return { enabled: DEFAULT_SETTINGS.enabled };
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return cloneDefaultSettings();
  }
  return {
    enabled: typeof value.enabled === 'boolean'
      ? value.enabled
      : DEFAULT_SETTINGS.enabled,
  };
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, settings: null };
  }
  if ('enabled' in value && typeof value.enabled !== 'boolean') {
    return { valid: false, settings: null };
  }
  return { valid: true, settings: normalizeSettings(value) };
}
