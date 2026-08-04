'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostprint-build-'));
const outputDirectory = path.join(root, 'dist');
const output = path.join(outputDirectory, `${manifest.name}-${manifest.version}.zip`);
const files = [
  'manifest.json',
  'background.js',
  'content.js',
  'inject.js',
  'settings.js',
  'seed.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'README.md',
  'LICENSE',
  'icons',
];

function copyEntry(relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(staging, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

try {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const file of files) copyEntry(file);
  fs.rmSync(output, { force: true });
  execFileSync('zip', ['-q', '-r', output, '.'], { cwd: staging, stdio: 'inherit' });
  console.log(`Built ${path.relative(root, output)}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
