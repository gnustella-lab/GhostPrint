'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPageContext,
  installInject,
} = require('./helpers/audio-harness');

function asBytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

test('getChannelData and copyFromChannel expose one stable farbled view', async () => {
  const context = createPageContext();
  installInject(context);
  const firstBuffer = await new context.OfflineAudioContext().startRendering();
  const firstView = firstBuffer.getChannelData(0);

  assert.strictEqual(firstBuffer.getChannelData(0), firstView);

  const secondBuffer = await new context.OfflineAudioContext().startRendering();
  const copied = new Float32Array(1024);
  secondBuffer.copyFromChannel(copied, 0, 0);
  const secondView = secondBuffer.getChannelData(0);

  assert.equal(asBytes(copied).equals(asBytes(secondView)), true);
  assert.equal(Number.isNaN(secondView[3]), true);
  assert.equal(secondView[7], -Infinity);
});

test('all analyser read methods preserve returns and only farble filled data', () => {
  const context = createPageContext();
  installInject(context);
  const analyser = new context.AudioContext().createAnalyser();
  analyser.frequencyBinCount = 128;

  const cases = [
    ['getFloatFrequencyData', Float32Array, 'native-float-frequency', -999],
    ['getByteFrequencyData', Uint8Array, 'native-byte-frequency', 251],
    ['getFloatTimeDomainData', Float32Array, 'native-float-time', -999],
    ['getByteTimeDomainData', Uint8Array, 'native-byte-time', 251],
  ];

  for (const [method, TypedArray, nativeReturn, sentinel] of cases) {
    const array = new TypedArray(256);
    array.fill(sentinel);
    const returned = analyser[method](array);

    assert.equal(returned, nativeReturn, method);
    assert.equal(array[255], sentinel, method);
    assert.equal(array.some((value) => value !== sentinel), true, method);
  }

  const floatFrequency = new Float32Array(256);
  floatFrequency.fill(-999);
  analyser.getFloatFrequencyData(floatFrequency);
  assert.equal(floatFrequency[1], -Infinity);
});

test('different seeds produce different deterministic analyser output', () => {
  const firstContext = createPageContext({ seed: '1001' });
  const secondContext = createPageContext({ seed: '2002' });
  installInject(firstContext);
  installInject(secondContext);

  const first = new Float32Array(128);
  const second = new Float32Array(128);
  const firstAnalyser = new firstContext.AudioContext().createAnalyser();
  const secondAnalyser = new secondContext.AudioContext().createAnalyser();
  firstAnalyser.frequencyBinCount = 128;
  secondAnalyser.frequencyBinCount = 128;
  firstAnalyser.getFloatTimeDomainData(first);
  secondAnalyser.getFloatTimeDomainData(second);

  assert.equal(asBytes(first).equals(asBytes(second)), false);
});
