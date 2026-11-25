'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_SOURCE = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function loadSettingsContext(extraGlobals = {}) {
  const context = vm.createContext({ Object, Array, Boolean, Number, String, URL, ...extraGlobals });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  return context;
}

function loadBackgroundContext({ initial = undefined, failGet = false, failSet = false } = {}) {
  let stored = initial;
  const listeners = {};
  const browser = {
    storage: {
      local: {
        get: async () => {
          if (failGet) throw new Error('get failed');
          return stored === undefined ? {} : { settings: stored };
        },
        set: async (value) => {
          if (failSet) throw new Error('set failed');
          stored = value.settings;
        },
      },
    },
    runtime: {
      getURL: (value) => `moz-extension://test/${value}`,
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
    },
  };
  const context = vm.createContext({ browser, Promise, Object, Array, Boolean, Number, String, URL });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return {
    context,
    getStored: () => stored,
    send: (message, sender = { url: 'moz-extension://test/popup.html' }) =>
      listeners.message(message, sender),
  };
}

function loadDeferredBackgroundContext() {
  let stored = { enabled: 'invalid' };
  const pendingGets = [];
  const pendingSets = [];
  const listeners = {};
  const browser = {
    storage: {
      local: {
        get: () => new Promise((resolve) => pendingGets.push({ resolve })),
        set: (value) => new Promise((resolve) => {
          pendingSets.push({
            value,
            resolve: () => {
              stored = value.settings;
              resolve();
            },
          });
        }),
      },
    },
    runtime: {
      getURL: (value) => `moz-extension://test/${value}`,
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
    },
  };
  const context = vm.createContext({ browser, Promise, Object, Array, Boolean, Number, String, URL, setTimeout });
  vm.runInContext(SETTINGS_SOURCE, context, { filename: 'settings.js' });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return {
    get: () => stored,
    pendingGets,
    pendingSets,
    send: (message, sender = { url: 'moz-extension://test/popup.html' }) =>
      listeners.message(message, sender),
  };
}

function makeOversizedSites(count) {
  const sites = {};
  for (let index = 0; index < count; index += 1) {
    sites[`https://site-${index}.test`] = 'off';
  }
  return sites;
}

test('settings helpers clone defaults and remove unknown properties', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`({
    normalized: normalizeSettings({ enabled: false, unexpected: true }),
    fallback: normalizeSettings({ enabled: 'yes' }),
    valid: validateSettings({ enabled: true, unexpected: true }),
    invalid: validateSettings({ enabled: 'yes' })
  })`, context);

  assert.equal(JSON.stringify(result.normalized), JSON.stringify({ enabled: false, sites: {} }));
  assert.equal(JSON.stringify(result.fallback), JSON.stringify({ enabled: true, sites: {} }));
  assert.equal(JSON.stringify(result.valid), JSON.stringify({ valid: true, settings: { enabled: true, sites: {} } }));
  assert.equal(JSON.stringify(result.invalid), JSON.stringify({ valid: false, settings: null }));
});

test('GET_SETTINGS repairs invalid persisted state', async () => {
  const background = loadBackgroundContext({ initial: { enabled: false, extra: 'remove me' } });
  const response = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(JSON.stringify(response), JSON.stringify({ ok: true, settings: { enabled: false, sites: {} } }));
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: false, sites: {} }));
});

test('legacy v1 storage migrates to the v2 schema on first read', async () => {
  const background = loadBackgroundContext({ initial: { enabled: false } });
  const response = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(JSON.stringify(response), JSON.stringify({ ok: true, settings: { enabled: false, sites: {} } }));
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: false, sites: {} }));
});

test('SET_SETTINGS rejects invalid payloads and accepts only the schema', async () => {
  const background = loadBackgroundContext();
  const invalid = await background.send({ type: 'SET_SETTINGS', settings: { enabled: 'true' } });
  const valid = await background.send({ type: 'SET_SETTINGS', settings: { enabled: false, ignored: 1 } });

  assert.equal(JSON.stringify(invalid), JSON.stringify({ ok: false, error: 'invalid-settings' }));
  assert.equal(JSON.stringify(valid), JSON.stringify({ ok: true, settings: { enabled: false, sites: {} } }));
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: false, sites: {} }));
});

test('storage failures are returned as structured errors', async () => {
  const readFailure = loadBackgroundContext({ failGet: true });
  const writeFailure = loadBackgroundContext({ failSet: true });

  assert.equal(JSON.stringify(await readFailure.send({ type: 'GET_SETTINGS' })), JSON.stringify({ ok: false, error: 'storage-read-failed' }));
  assert.equal(JSON.stringify(await writeFailure.send({ type: 'SET_SETTINGS', settings: { enabled: false } })), JSON.stringify({ ok: false, error: 'storage-write-failed' }));
  assert.equal(JSON.stringify(await writeFailure.send({ type: 'RESET_SETTINGS' })), JSON.stringify({ ok: false, error: 'storage-write-failed' }));
});

test('settings repair cannot overwrite a concurrent explicit write', async () => {
  const background = loadDeferredBackgroundContext();
  const getPromise = background.send({ type: 'GET_SETTINGS' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  background.pendingGets.shift().resolve({ settings: { enabled: 'invalid' } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const setPromise = background.send({ type: 'SET_SETTINGS', settings: { enabled: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(background.pendingSets.length, 1);

  background.pendingSets[0].resolve();
  const getResult = await getPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(background.pendingSets.length, 2);
  background.pendingSets[1].resolve();
  const setResult = await setPromise;

  assert.equal(JSON.stringify(setResult), JSON.stringify({ ok: true, settings: { enabled: false, sites: {} } }));
  assert.equal(JSON.stringify(getResult), JSON.stringify({ ok: true, settings: { enabled: true, sites: {} } }));
  assert.equal(JSON.stringify(background.get()), JSON.stringify({ enabled: false, sites: {} }));
});

test('unknown messages and unauthorized extension-page senders are rejected', async () => {
  const background = loadBackgroundContext();

  assert.equal(JSON.stringify(await background.send({ type: 'UNKNOWN' })), JSON.stringify({ ok: false, error: 'unknown-message' }));
  assert.equal(JSON.stringify(await background.send({ type: 'GET_SETTINGS' }, { url: 'https://example.test/' })), JSON.stringify({ ok: false, error: 'unauthorized-sender' }));
});

test('site overrides normalize to canonical origins and drop junk entries', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`({
    normalized: normalizeSettings({
      enabled: true,
      sites: {
        'HTTPS://Example.com/path': 'off',
        'https://example.com': 'on',
        'ftp://example.com': 'off',
        'https://other.test': 'maybe',
        'not a url': 'off',
        'chrome://internal': 'off'
      }
    }),
    emptyWhenAbsent: normalizeSettings({ enabled: true })
  })`, context);

  assert.equal(
    JSON.stringify(result.normalized.sites),
    JSON.stringify({ 'https://example.com': 'on' }),
  );
  assert.deepEqual(Object.keys(result.normalized), ['enabled', 'sites']);
  assert.equal(JSON.stringify(result.emptyWhenAbsent.sites), '{}');
});

test('site overrides above the size cap are rejected on write and capped on repair', () => {
  const oversized = makeOversizedSites(501);
  const context = loadSettingsContext({ oversized });
  const result = vm.runInContext(`({
    writeRejected: validateSettings({ enabled: true, sites: oversized }).valid,
    repairCapped: Object.keys(normalizeSettings({ enabled: true, sites: oversized }).sites).length
  })`, context);

  assert.equal(result.writeRejected, false);
  assert.ok(result.repairCapped <= 500);
});

test('validateSettings rejects non-canonical site keys and modes', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`({
    upperKey: validateSettings({ enabled: true, sites: { 'HTTPS://X.TEST': 'off' } }).valid,
    trailingSlashKey: validateSettings({ enabled: true, sites: { 'https://x.test/': 'off' } }).valid,
    badMode: validateSettings({ enabled: true, sites: { 'https://x.test': 'maybe' } }).valid,
    sitesNotAnObject: validateSettings({ enabled: true, sites: 'nope' }).valid,
    goodEntry: validateSettings({ enabled: true, sites: { 'https://x.test': 'off' } }).valid
  })`, context);

  assert.equal(result.upperKey, false);
  assert.equal(result.trailingSlashKey, false);
  assert.equal(result.badMode, false);
  assert.equal(result.sitesNotAnObject, false);
  assert.equal(result.goodEntry, true);
});

test('origin resolution follows denylist semantics with the global switch winning', () => {
  const context = loadSettingsContext();
  const cases = vm.runInContext(`([
    resolveEnabledForOrigin({ enabled: true, sites: {} }, 'https://a.test'),
    resolveEnabledForOrigin({ enabled: true, sites: { 'https://a.test': 'off' } }, 'https://a.test'),
    resolveEnabledForOrigin({ enabled: true, sites: { 'https://a.test': 'on' } }, 'https://a.test'),
    resolveEnabledForOrigin({ enabled: false, sites: { 'https://a.test': 'on' } }, 'https://a.test'),
    resolveEnabledForOrigin({ enabled: true, sites: { 'https://a.test': 'off' } }, 'https://B.test'),
    resolveEnabledForOrigin({ enabled: true, sites: { 'https://a.test': 'off' } }, 'about:blank'),
    resolveEnabledForOrigin({ enabled: true, sites: {} }, null),
    resolveEnabledForOrigin(null, 'https://a.test')
  ])`, context);

  assert.deepEqual(Array.from(cases), [
    true,   // default follows global
    false,  // explicit site off while globally on
    true,   // explicit site on while globally on
    false,  // global switch wins over any site value
    true,   // different origin unaffected ('https://B.test' normalizes)
    true,   // unsupported origin schemes follow the global switch
    true,   // missing origin follows the global switch
    false   // malformed settings disable everything (fail safe stays ON only via defaults)
  ]);
});

test('GET_SETTINGS resolves the effective decision for one origin', async () => {
  const background = loadBackgroundContext({
    initial: { enabled: true, sites: { 'https://blocked.test': 'off' } },
  });
  const blocked = await background.send({ type: 'GET_SETTINGS', origin: 'https://blocked.test/path' });
  const allowed = await background.send({ type: 'GET_SETTINGS', origin: 'https://open.test' });
  const withoutOrigin = await background.send({ type: 'GET_SETTINGS' });

  assert.equal(blocked.ok, true);
  assert.equal(blocked.siteEnabled, false);
  assert.equal(allowed.siteEnabled, true);
  assert.equal(withoutOrigin.siteEnabled, undefined);
});

test('SET_SETTINGS persists per-site overrides and rejects malformed ones', async () => {
  const background = loadBackgroundContext();
  const saved = await background.send({
    type: 'SET_SETTINGS',
    settings: { enabled: true, sites: { 'https://quiet.test': 'off' } },
  });
  assert.equal(saved.ok, true);
  assert.equal(
    JSON.stringify(background.getStored()),
    JSON.stringify({ enabled: true, sites: { 'https://quiet.test': 'off' } }),
  );

  const nonCanonical = await background.send({
    type: 'SET_SETTINGS',
    settings: { enabled: true, sites: { 'HTTPS://QUIET.TEST': 'off' } },
  });
  const badMode = await background.send({
    type: 'SET_SETTINGS',
    settings: { enabled: true, sites: { 'https://quiet.test': 'sometimes' } },
  });
  assert.equal(nonCanonical.ok, false);
  assert.equal(badMode.ok, false);
  assert.equal(
    JSON.stringify(background.getStored()),
    JSON.stringify({ enabled: true, sites: { 'https://quiet.test': 'off' } }),
  );
});

test('RESET_SETTINGS clears every per-site override', async () => {
  const background = loadBackgroundContext({
    initial: { enabled: true, sites: { 'https://quiet.test': 'off' } },
  });
  const reset = await background.send({ type: 'RESET_SETTINGS' });

  assert.equal(reset.ok, true);
  assert.equal(JSON.stringify(background.getStored()), JSON.stringify({ enabled: true, sites: {} }));
});

test('parseSiteInput accepts bare hosts and rejects unusable addresses', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`([
    parseSiteInput('example.com'),
    parseSiteInput('  Example.COM/path  '),
    parseSiteInput('example.com:8080'),
    parseSiteInput('http://plain.test/page'),
    parseSiteInput('https://[::1]:8443'),
    parseSiteInput(''),
    parseSiteInput('   '),
    parseSiteInput('ftp://files.test'),
    parseSiteInput('chrome://settings'),
    parseSiteInput('two words.test'),
    parseSiteInput(null),
    parseSiteInput(42),
    parseSiteInput('mailto:user@example.com'),
    parseSiteInput('javascript:alert(1)'),
    parseSiteInput('example.com@evil.test')
  ])`, context);

  assert.deepEqual(Array.from(result), [
    'https://example.com',
    'https://example.com',
    'https://example.com:8080',
    'http://plain.test',
    'https://[::1]:8443',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});

test('addSiteException adds, updates and never mutates the input settings', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`(() => {
    const original = { enabled: true, sites: { 'https://kept.test': 'off' } };
    const before = JSON.stringify(original);
    const added = addSiteException(original, 'new.test');
    const replaced = addSiteException(original, 'kept.test', 'on');
    const defaultMode = addSiteException({ enabled: true, sites: {} }, 'implicit.test');
    return {
      untouched: JSON.stringify(original) === before,
      addedOk: added.ok,
      addedOrigin: added.origin,
      addedSites: added.settings.sites,
      replacedSites: replaced.settings.sites,
      defaultModeSites: defaultMode.settings.sites,
      badMode: addSiteException({ enabled: true, sites: {} }, 'x.test', 'maybe'),
      badOrigin: addSiteException({ enabled: true, sites: {} }, 'ftp://x.test'),
      preservesEnabled: addSiteException({ enabled: false, sites: {} }, 'x.test').settings.enabled
    };
  })()`, context);

  assert.equal(result.untouched, true);
  assert.equal(result.addedOk, true);
  assert.equal(result.addedOrigin, 'https://new.test');
  assert.equal(
    JSON.stringify(result.addedSites),
    JSON.stringify({ 'https://kept.test': 'off', 'https://new.test': 'off' }),
  );
  assert.equal(
    JSON.stringify(result.replacedSites),
    JSON.stringify({ 'https://kept.test': 'on' }),
  );
  assert.equal(JSON.stringify(result.defaultModeSites), JSON.stringify({ 'https://implicit.test': 'off' }));
  assert.equal(result.badMode.ok, false);
  assert.equal(result.badMode.error, 'invalid-mode');
  assert.equal(result.badOrigin.ok, false);
  assert.equal(result.badOrigin.error, 'invalid-origin');
  assert.equal(result.preservesEnabled, false);
});

test('addSiteException refuses to grow past the entry cap but updates existing entries', () => {
  const context = loadSettingsContext({ oversized: makeOversizedSites(500) });
  const result = vm.runInContext(`({
    atCap: addSiteException({ enabled: true, sites: oversized }, 'one-more.test'),
    existing: addSiteException({ enabled: true, sites: oversized }, 'site-0.test', 'on')
  })`, context);

  assert.equal(result.atCap.ok, false);
  assert.equal(result.atCap.error, 'limit-reached');
  assert.equal(result.existing.ok, true);
  assert.equal(result.existing.settings.sites['https://site-0.test'], 'on');
  assert.equal(Object.keys(result.existing.settings.sites).length, 500);
});

test('removeSiteException drops one entry and reports missing ones', () => {
  const context = loadSettingsContext();
  const result = vm.runInContext(`(() => {
    const original = { enabled: true, sites: { 'https://a.test': 'off', 'https://b.test': 'on' } };
    const removed = removeSiteException(original, 'A.test');
    return {
      ok: removed.ok,
      origin: removed.origin,
      sites: removed.settings.sites,
      untouched: Object.keys(original.sites).length,
      missing: removeSiteException(original, 'https://absent.test'),
      badOrigin: removeSiteException(original, 'not a url')
    };
  })()`, context);

  assert.equal(result.ok, true);
  assert.equal(result.origin, 'https://a.test');
  assert.equal(JSON.stringify(result.sites), JSON.stringify({ 'https://b.test': 'on' }));
  assert.equal(result.untouched, 2);
  assert.equal(result.missing.ok, false);
  assert.equal(result.missing.error, 'not-found');
  assert.equal(result.badOrigin.error, 'invalid-origin');
});

test('exceptions saved through addSiteException are accepted by SET_SETTINGS and change the decision', async () => {
  const background = loadBackgroundContext();
  const added = vm.runInContext(
    'addSiteException({ enabled: true, sites: {} }, "quiet.test")',
    loadSettingsContext(),
  );
  const saved = await background.send({ type: 'SET_SETTINGS', settings: added.settings });
  const blocked = await background.send({ type: 'GET_SETTINGS', origin: 'https://quiet.test/x' });

  assert.equal(saved.ok, true);
  assert.equal(added.ok, true);
  assert.equal(blocked.siteEnabled, false);
  assert.equal(
    JSON.stringify(background.getStored()),
    JSON.stringify({ enabled: true, sites: { 'https://quiet.test': 'off' } }),
  );
});
