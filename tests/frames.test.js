'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'manifest.json'), 'utf8'),
);

test('GPU protections are injected at document_start in matching child and fallback frames', () => {
  const [contentScript] = manifest.content_scripts;

  assert.equal(contentScript.run_at, 'document_start');
  assert.equal(contentScript.all_frames, true);
  assert.equal(contentScript.match_about_blank, true);
  assert.equal(contentScript.match_origin_as_fallback, true);
  assert.deepEqual(contentScript.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(contentScript.js, ['settings.js', 'seed.js', 'content.js']);
  assert.equal(manifest.web_accessible_resources.includes('inject.js'), true);
});
