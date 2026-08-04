'use strict';

const SEED_STORAGE_KEY = '__ghostprint_seed_v1__';
const SEED_MIN = 1;
const SEED_MAX = 0xFFFFFFFE;
const MAX_CRYPTO_ATTEMPTS = 8;

function parseSeedValue(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < SEED_MIN || parsed > SEED_MAX) return null;
  return parsed;
}

function generateSeed(cryptoSource) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') return null;
  const values = new Uint32Array(1);
  for (let attempt = 0; attempt < MAX_CRYPTO_ATTEMPTS; attempt += 1) {
    try {
      cryptoSource.getRandomValues(values);
    } catch (_) {
      return null;
    }
    const candidate = values[0] >>> 0;
    if (candidate >= SEED_MIN && candidate <= SEED_MAX) return candidate;
  }
  return null;
}

function getOrCreateSeed(storage, cryptoSource) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;

  let stored;
  try {
    stored = parseSeedValue(storage.getItem(SEED_STORAGE_KEY));
  } catch (_) {
    stored = null;
  }
  if (stored !== null) return stored;

  const generated = generateSeed(cryptoSource);
  if (generated === null) return null;

  try {
    storage.setItem(SEED_STORAGE_KEY, String(generated));
    return parseSeedValue(storage.getItem(SEED_STORAGE_KEY)) === generated ? generated : null;
  } catch (_) {
    return null;
  }
}
