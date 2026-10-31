import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { pointTarget, pointHeaders, pointWrites, appProxyHeaders } from './point-apps.ts';

test('Point API targets and signatures preserve the exact verb, query and binary body', () => {
  const app = { name: 'map', version: '1', permissions: { api: ['/apps/map/api'] }, contributes: {} };
  const bytes = new Uint8Array([0, 255, 13, 10]);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const target = pointTarget(app, '/apps/map/api/document?part=a%2Fb');
    assert.equal(target, '/api/document?part=a%2Fb');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const expected = createHmac('sha256', 'secret').update(`1793440000:${method}:${target}:${digest}`).digest('hex');
    assert.deepEqual(pointHeaders('secret', method, target, bytes, 1793440000), { 'X-Point-App-Proxy': `1793440000:${expected}` });
  }
  for (const path of ['/apps/other/api/data', '/api/projects', 'https://external.invalid/api/data', '/api/data%5Cprivate']) assert.throws(() => pointTarget(app, path));
  const narrow = { ...app, permissions: { api: ['/apps/map/api/documents'] } };
  assert.throws(() => pointTarget(narrow, '/api/documents-extra'));
  const headers = appProxyHeaders(new Headers({'Range':'bytes=0-4','X-Request-ID':'same-request','Authorization':'caller','X-Point-App-Proxy':'forged'}));
  assert.equal(headers.get('range'),'bytes=0-4'); assert.equal(headers.get('x-request-id'),'same-request');
  assert.equal(headers.get('authorization'),null); assert.equal(headers.get('x-point-app-proxy'),null);
  assert.equal(appProxyHeaders(new Headers({'X-Point-Tile-Source':'placeholder','Content-Encoding':'gzip'}),true).get('x-point-tile-source'),'placeholder');
  const definition = pointWrites({ ...app, contributes: { agentTools: [{ name: 'write_document', description: 'Write', method: 'PUT', route: '/apps/map/api/document', parameters: { type: 'object' } }] } }, 'map')[0];
  assert.equal(definition.name, 'write_document');
  assert.equal(definition.method, 'PUT');
  assert.equal(definition.path, '/api/document');
});
