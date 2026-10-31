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
  assert.equal(pointAppManifest({ ...base, backend: { ...backend, type: 'node', entryPoint: 'backend/index.mjs' } }).backend.entry, 'point-backend.mjs');
  assert.equal(pointAppManifest({ ...base, contributes: {panelTabs: [panel, {...panel, id: 'other'}]} }).contributes.panels[1].entry, 'dist/other.html');
  for (const [label, app] of [
    ['duplicate panels', { ...base, contributes: { panelTabs: [panel, panel] } }],
    ['escaping module', { ...base, contributes: { panelTabs: [{ ...panel, entry: '../outside.mjs' }] } }],
    ['host grant', { ...base, permissions: { host: ['agent'] } }],
    ['events', { ...base, permissions: { events: ['session.changed'] } }],
    ['extra permission', { ...base, permissions: { arbitrary: true } }],
    ['cross-app API', { ...base, backend, permissions: { api: ['/apps/other/api'] } }],
    ['Host API', { ...base, backend, permissions: { api: ['/api/workspaces'] } }],
    ['API traversal', { ...base, backend, permissions: { api: ['/apps/sample/api/../other'] } }],
    ['missing backend', { ...base, permissions: { api: ['/apps/sample/api'] } }],
    ['invalid agent tool', { ...base, contributes: { panelTabs: [panel], agentTools: [{name: 'bad'}] } }],
    ['mismatched Node entry', { ...base, backend: { ...backend, type: 'node' } }],
    ['fixed port', { ...base, backend: { ...backend, port: 9999 } }],
    ['unbounded body', { ...base, backend: { ...backend, maxBodyBytes: 0 } }],
    ['runtime command', { ...base, backend: { ...backend, command: 'sh' } }],
  ]) assert.throws(() => pointAppManifest(app), undefined, label);
});
