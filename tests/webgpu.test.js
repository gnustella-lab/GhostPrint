'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPageContext, installInject } = require('./helpers/inject-harness');

test('GPUAdapterInfo hardware identity is scrubbed on adapters and devices', async () => {
  const context = createPageContext();
  installInject(context);
  const options = { featureLevel: 'compatibility', powerPreference: 'high-performance' };

  const adapterPromise = context.navigator.gpu.requestAdapter(options);
  assert.equal(typeof adapterPromise.then, 'function');
  const adapter = await adapterPromise;
  const adapterInfo = adapter.info;

  assert.equal(adapterInfo.vendor, '');
  assert.equal(adapterInfo.architecture, '');
  assert.equal(adapterInfo.device, '');
  assert.equal(adapterInfo.description, 'NVIDIA GeForce RTX 4090');
  assert.equal(adapterInfo.subgroupMinSize, 32);
  assert.equal(adapterInfo instanceof context.GPUAdapterInfo, true);
  assert.strictEqual(adapter.info, adapterInfo);
  assert.deepEqual(context.navigator.gpu.requestAdapterCalls[0], [options]);

  const descriptor = { requiredFeatures: ['shader-f16'] };
  const device = await adapter.requestDevice(descriptor);
  assert.strictEqual(device.adapterInfo, adapterInfo);
  assert.deepEqual(adapter.requestDeviceCalls[0], [descriptor]);
});

test('WebGPU capabilities and operational objects remain untouched', async () => {
  const context = createPageContext();
  installInject(context);
  const adapter = await context.navigator.gpu.requestAdapter();
  const adapterFeatures = adapter.features;
  const adapterLimits = adapter.limits;
  const requestDevice = adapter.requestDevice;
  const device = await requestDevice.call(adapter);

  assert.strictEqual(adapter.features, adapterFeatures);
  assert.strictEqual(adapter.limits, adapterLimits);
  assert.deepEqual(Array.from(adapter.features), ['shader-f16']);
  assert.equal(adapter.limits.maxTextureDimension2D, 8192);
  assert.deepEqual(Array.from(device.features), ['shader-f16']);
  assert.equal(device.limits.maxTextureDimension2D, 8192);
  assert.equal(device instanceof context.GPUDevice, true);
});

test('WebGPU getters retain receiver checks and do not accumulate wrappers', async () => {
  const context = createPageContext();
  const nativeInfoGetter = Object.getOwnPropertyDescriptor(context.GPUAdapter.prototype, 'info').get;
  installInject(context);
  const firstInfoGetter = Object.getOwnPropertyDescriptor(context.GPUAdapter.prototype, 'info').get;
  const firstVendorGetter = Object.getOwnPropertyDescriptor(context.GPUAdapterInfo.prototype, 'vendor').get;
  installInject(context);

  assert.notStrictEqual(firstInfoGetter, nativeInfoGetter);
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(context.GPUAdapter.prototype, 'info').get,
    firstInfoGetter,
  );
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(context.GPUAdapterInfo.prototype, 'vendor').get,
    firstVendorGetter,
  );
  assert.throws(() => firstInfoGetter.call({}), TypeError);
  assert.throws(() => firstVendorGetter.call({}), TypeError);

  const adapter = await context.navigator.gpu.requestAdapter();
  assert.equal(adapter.info.vendor, '');
});

test('requestAdapter fallback protects WebGPU when interface constructors are not exposed', async () => {
  const context = createPageContext();
  delete context.GPU;
  delete context.GPUAdapter;
  delete context.GPUDevice;
  delete context.GPUAdapterInfo;
  installInject(context);

  const adapter = await context.navigator.gpu.requestAdapter();
  assert.equal(adapter.info.vendor, '');
  assert.equal(adapter.info.architecture, '');
  assert.equal(adapter.info.device, '');

  const device = await adapter.requestDevice();
  assert.equal(device.adapterInfo.vendor, '');
  assert.equal(device.adapterInfo.architecture, '');
  assert.equal(device.adapterInfo.device, '');
  assert.deepEqual(Array.from(adapter.features), ['shader-f16']);
  assert.equal(device.limits.maxTextureDimension2D, 8192);
});
