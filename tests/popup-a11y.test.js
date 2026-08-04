'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '..', 'popup.css'), 'utf8');

test('popup exposes accessible language, toggle name and status announcements', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /id="globalToggle"[^>]*aria-label="[^"]+"/);
  assert.match(html, /id="statusBanner"[^>]*role="status"/);
  assert.match(html, /id="statusBanner"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, /<img src="icons\/ghost\.svg" alt="Ghost"/);
});

test('popup keeps the toggle focusable and provides visible keyboard focus', () => {
  assert.doesNotMatch(css, /\.toggle input\s*\{\s*display:\s*none\s*;/);
  assert.match(css, /\.toggle input\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.toggle input:focus-visible\s*\+\s*\.slider/);
  assert.match(css, /\.btn-reset:focus-visible/);
});
