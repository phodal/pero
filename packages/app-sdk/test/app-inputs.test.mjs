import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedApi } from '../src/core.mjs';

const prefix = '/api/apps/vehicle-investigation/inputs';
const path = prefix + '/' + 'a'.repeat(64);
test('binary input reads preserve Host Session headers and bytes', async () => {
  let call;
  const api = createScopedApi({ appName: 'vehicle-investigation', allowedApiPaths: [prefix], hostHeaders: { 'X-Pero-Session-Id': 'source' }, fetch: async (...args) => { call = args; return new Response(new Uint8Array([0, 255, 1])); } });
  assert.deepEqual(new Uint8Array(await api.readFile(path, { headers: { 'X-Pero-Session-Id': 'foreign' } })), new Uint8Array([0, 255, 1]));
  assert.equal(call[1].headers.get('X-Pero-Session-Id'), 'source');
  assert.equal(call[1].method, 'GET');
  assert.equal(call[1].redirect, 'error');
});
test('binary API refuses foreign App, arbitrary URL/path and expired grants', async () => {
  const api = createScopedApi({ appName: 'vehicle-investigation', allowedApiPaths: [prefix], fetch: async () => new Response('expired', { status: 404 }) });
  for (const value of ['/etc/passwd', 'https://evil.test', '/api/apps/other/inputs/' + 'a'.repeat(64), path + '?path=secret', prefix + '/../config']) await assert.rejects(api.readFile(value));
  await assert.rejects(api.readFile(path), error => error.status === 404);
});
