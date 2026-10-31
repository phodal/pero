import test from 'node:test';
import assert from 'node:assert/strict';
import { pointAppManifest } from './manifest.mjs';

const panel = { id: 'sample', title: 'Sample', entry: 'dist/index.mjs' };
const base = { name: 'sample', version: '1.0.0', displayName: 'Sample', contributes: { panelTabs: [panel] } };
test('Point packaging preserves identity and refuses contracts Pero cannot carry', () => {
  const expected = { schemaVersion: 1, name: 'sample', version: '1.0.0', displayName: 'Sample', description: '', permissions: { host: [] }, contributes: { panels: [{ id: 'sample', title: 'Sample', entry: 'dist/index.html' }] } };
  assert.deepEqual(pointAppManifest(base), expected);
  const backend = { type: 'python', entryPoint: 'backend/server.py', port: 'auto', healthCheck: '/health', maxBodyBytes: 1024 };
  assert.deepEqual(pointAppManifest({ ...base, backend, permissions: { api: ['/apps/sample/api'] } }), { ...expected, backend: { type: 'python', entry: 'point-backend.py' } });
  for (const [label, app] of [
    ['multiple panels', { ...base, contributes: { panelTabs: [panel, { ...panel, id: 'other' }] } }],
    ['escaping module', { ...base, contributes: { panelTabs: [{ ...panel, entry: '../outside.mjs' }] } }],
    ['host grant', { ...base, permissions: { host: ['agent'] } }],
    ['events', { ...base, permissions: { events: ['session.changed'] } }],
    ['extra permission', { ...base, permissions: { storage: true } }],
    ['cross-app API', { ...base, backend, permissions: { api: ['/apps/other/api'] } }],
    ['Host API', { ...base, backend, permissions: { api: ['/api/projects'] } }],
    ['API traversal', { ...base, backend, permissions: { api: ['/apps/sample/api/../other'] } }],
    ['missing backend', { ...base, permissions: { api: ['/apps/sample/api'] } }],
    ['agent tool', { ...base, contributes: { panelTabs: [panel], agentTools: [] } }],
    ['Node backend', { ...base, backend: { ...backend, type: 'node' } }],
    ['fixed port', { ...base, backend: { ...backend, port: 9999 } }],
    ['unbounded body', { ...base, backend: { ...backend, maxBodyBytes: 0 } }],
    ['runtime command', { ...base, backend: { ...backend, command: 'sh' } }],
  ]) assert.throws(() => pointAppManifest(app), undefined, label);
});
