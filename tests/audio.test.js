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

  const first = new Float32Array(4096);
  const second = new Float32Array(4096);
  const firstAnalyser = new firstContext.AudioContext().createAnalyser();
  const secondAnalyser = new secondContext.AudioContext().createAnalyser();
  firstAnalyser.frequencyBinCount = 4096;
  secondAnalyser.frequencyBinCount = 4096;
  firstAnalyser.getFloatTimeDomainData(first);
  secondAnalyser.getFloatTimeDomainData(second);

  assert.equal(asBytes(first).equals(asBytes(second)), false);
});

test('copyToChannel does not farble samples outside the written range', async () => {
  const context = createPageContext();
  installInject(context);
  const buffer = await new context.OfflineAudioContext().startRendering();
  const before = buffer.channels[0].slice();
  const source = new Float32Array([0.75]);

  buffer.copyToChannel(source, 0, 9);

  assert.equal(buffer.channels[0][9], 0.75);
  for (let i = 0; i < before.length; i += 1) {
    if (i !== 9) assert.equal(buffer.channels[0][i], before[i], `sample ${i}`);
  }

  const beforeEmptyWrite = buffer.channels[0].slice();
  buffer.copyToChannel(new Float32Array(0), 0, 12);
  assert.deepEqual(Array.from(buffer.channels[0]), Array.from(beforeEmptyWrite));
});

test('copyFromChannel fallback farbles destination indices using source offsets', async () => {
  const expectedContext = createPageContext();
  installInject(expectedContext);
  const expectedBuffer = await new expectedContext.OfflineAudioContext().startRendering();
  const expected = new Float32Array(128);
  expectedBuffer.copyFromChannel(expected, 0, 9);

  const fallbackContext = createPageContext({ missing: ['getChannelData'] });
  installInject(fallbackContext);
  const fallbackBuffer = await new fallbackContext.OfflineAudioContext().startRendering();
  const actual = new Float32Array(128);
  fallbackBuffer.copyFromChannel(actual, 0, 9);

  assert.deepEqual(Array.from(actual), Array.from(expected));
});

test('re-evaluating inject.js does not accumulate Audio wrappers', async () => {
  const context = createPageContext();
  installInject(context);
  const firstGetChannelData = context.AudioBuffer.prototype.getChannelData;
  const firstCopyToChannel = context.AudioBuffer.prototype.copyToChannel;
  const firstAnalyserMethod = context.AnalyserNode.prototype.getFloatTimeDomainData;
  const firstStartRendering = context.OfflineAudioContext.prototype.startRendering;

  installInject(context);

  assert.strictEqual(context.AudioBuffer.prototype.getChannelData, firstGetChannelData);
  assert.strictEqual(context.AudioBuffer.prototype.copyToChannel, firstCopyToChannel);
  assert.strictEqual(context.AnalyserNode.prototype.getFloatTimeDomainData, firstAnalyserMethod);
  assert.strictEqual(context.OfflineAudioContext.prototype.startRendering, firstStartRendering);
});

test('invalid analyser frequencyBinCount does not farble untouched output', () => {
  const context = createPageContext();
  installInject(context);
  const analyser = new context.AudioContext().createAnalyser();

  for (const value of [0, -1, NaN]) {
    analyser.frequencyBinCount = value;
    const output = new Float32Array(4096);
    output.fill(1.25);
    analyser.getFloatTimeDomainData(output);
    assert.equal(output.every((sample) => sample === 1.25), true, String(value));
  }
});
