'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPageContext,
  installInject,
} = require('./helpers/audio-harness');

test('missing audio APIs do not block the available protections', async () => {
  const context = createPageContext({
    missing: ['copyFromChannel', 'getByteTimeDomainData'],
  });
  installInject(context);

  const buffer = await new context.OfflineAudioContext().startRendering();
  assert.equal(typeof buffer.getChannelData, 'function');
  assert.equal(buffer.copyFromChannel, undefined);
  buffer.getChannelData(0);

  const analyser = new context.AudioContext().createAnalyser();
  assert.equal(typeof analyser.getFloatFrequencyData, 'function');
  assert.equal(analyser.getByteTimeDomainData, undefined);
  const output = new Float32Array(16);
  analyser.getFloatFrequencyData(output);
});
