'use strict';

// Single source of truth for the default settings. Loaded by the background
// page, content scripts, and popup. Keep this schema deliberately small.
//
// Schema v2: { enabled: boolean, sites: { "<origin>": "on" | "off" } }
// - "sites" holds per-origin overrides for HTTP/HTTPS origins only.
// - Semantics are denylist-style: the global toggle wins over any per-site
//   value, and a site value of "off" disables that origin while the global
//   switch is on. Absent entries and explicit "on" follow the global switch.
// - v1 payloads ({ enabled }) normalize to v2 with an empty map.
const DEFAULT_SETTINGS = Object.freeze({ enabled: true });
const SITE_MODE_ON = 'on';
const SITE_MODE_OFF = 'off';
const SITE_OVERRIDE_MAX_ENTRIES = 500;
const SITE_ORIGIN_MAX_LENGTH = 300;

function cloneDefaultSettings() {
  return { enabled: DEFAULT_SETTINGS.enabled, sites: {} };
}

// Normalizes an HTTP/HTTPS origin string ("https://example.com",
// "http://example.com:8080", "http://[::1]:8443") to its canonical lowercase
// serialized form. Returns null for anything else. Uses the URL parser so
// default ports collapse and IDN/punycode forms converge on one key.
function normalizeSiteOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SITE_ORIGIN_MAX_LENGTH) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin === 'null' || parsed.origin.length > SITE_ORIGIN_MAX_LENGTH) return null;
  return parsed.origin;
}

function isValidSiteMode(value) {
  return value === SITE_MODE_ON || value === SITE_MODE_OFF;
}

// Keeps only valid entries, keyed by canonical origin. Keys are processed in
// sorted order so capping at the size limit is deterministic. Later duplicate
// keys (after normalization) overwrite earlier ones deterministically.
function normalizeSites(value) {
  const sites = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sites;
  const entries = Object.keys(value)
    .sort()
    .map((key) => [normalizeSiteOrigin(key), value[key]])
    .filter((entry) => entry[0] !== null && isValidSiteMode(entry[1]));
  const limit = Math.min(entries.length, SITE_OVERRIDE_MAX_ENTRIES);
  for (let index = 0; index < limit; index += 1) {
    sites[entries[index][0]] = entries[index][1];
  }
  return sites;
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return cloneDefaultSettings();
  }
  return {
    enabled: typeof value.enabled === 'boolean'
      ? value.enabled
      : DEFAULT_SETTINGS.enabled,
    sites: normalizeSites(value.sites),
  };
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, settings: null };
  }
  if ('enabled' in value && typeof value.enabled !== 'boolean') {
    return { valid: false, settings: null };
  }
  if ('sites' in value) {
    const sites = value.sites;
    if (!sites || typeof sites !== 'object' || Array.isArray(sites)) {
      return { valid: false, settings: null };
    }
    const keys = Object.keys(sites);
    if (keys.length > SITE_OVERRIDE_MAX_ENTRIES) {
      return { valid: false, settings: null };
    }
    for (const key of keys) {
      // Site writes come from our own UI and must already be canonical:
      // reject anything that is not exactly its normalized form so storage
      // never accumulates near-duplicate keys.
      if (normalizeSiteOrigin(key) !== key) {
        return { valid: false, settings: null };
      }
      if (!isValidSiteMode(sites[key])) {
        return { valid: false, settings: null };
      }
    }
  }
  return { valid: true, settings: normalizeSettings(value) };
}

// Effective protection for one origin. The global switch always wins; an
// explicit "off" override disables the origin while protection is globally
// on. Unknown or non-HTTP(S) origins follow the global switch.
function resolveEnabledForOrigin(settings, origin) {
  if (!settings || typeof settings.enabled !== 'boolean') return false;
  if (!settings.enabled) return false;
  const key = normalizeSiteOrigin(origin);
  if (key === null) return true;
  if (!settings.sites || typeof settings.sites !== 'object') return true;
  return settings.sites[key] !== SITE_MODE_OFF;
}

// Canonical origin for an address typed by hand. A bare host (with optional
// port or path) defaults to https so users do not have to type a scheme;
// anything that already carries a scheme is normalized strictly and rejected
// when it is not http/https. The host-shaped check keeps inputs such as
// "mailto:user@host" from being reinterpreted as an https URL.
function parseSiteInput(value) {
  const direct = normalizeSiteOrigin(value);
  if (direct !== null) return direct;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SITE_ORIGIN_MAX_LENGTH) return null;
  if (/\s/.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  if (!/^[a-z0-9._-]+(:\d{1,5})?(\/.*)?$/i.test(trimmed)) return null;
  return normalizeSiteOrigin(`https://${trimmed}`);
}

// Adds or updates one exception without mutating the input settings. Returns
// the normalized settings so callers can persist them through SET_SETTINGS.
// The entry cap is enforced here so the UI can explain the failure instead of
// silently dropping an entry during normalization.
function addSiteException(settings, value, mode) {
  const resolvedMode = mode === undefined ? SITE_MODE_OFF : mode;
  if (!isValidSiteMode(resolvedMode)) {
    return { ok: false, error: 'invalid-mode' };
  }
  const origin = parseSiteInput(value);
  if (origin === null) return { ok: false, error: 'invalid-origin' };
  const current = normalizeSettings(settings);
  const sites = Object.assign({}, current.sites);
  const exists = Object.prototype.hasOwnProperty.call(sites, origin);
  if (!exists && Object.keys(sites).length >= SITE_OVERRIDE_MAX_ENTRIES) {
    return { ok: false, error: 'limit-reached' };
  }
  sites[origin] = resolvedMode;
  return {
    ok: true,
    origin,
    settings: { enabled: current.enabled, sites: normalizeSites(sites) },
  };
}

function removeSiteException(settings, value) {
  const origin = parseSiteInput(value);
  if (origin === null) return { ok: false, error: 'invalid-origin' };
  const current = normalizeSettings(settings);
  if (!Object.prototype.hasOwnProperty.call(current.sites, origin)) {
    return { ok: false, error: 'not-found' };
  }
  const sites = Object.assign({}, current.sites);
  delete sites[origin];
  return {
    ok: true,
    origin,
    settings: { enabled: current.enabled, sites },
  };
}
