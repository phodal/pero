import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { capabilityOutcome, createCapabilitySnapshot } from '../../packages/app-sdk/src/capability-client.mjs';
import { dispatchEnvelope } from '../../desktop/src/main/capability-dispatch.mjs';

const root = new URL('../../', import.meta.url);
const corpus = JSON.parse(readFileSync(new URL('protocol/fixtures/protocol-ready/corpus.json', root), 'utf8'));
const inventory = JSON.parse(readFileSync(new URL('protocol/inventory/capabilities.json', root), 'utf8'));

test('Electron dispatch matches the protocol corpus', () => {
  for (const item of corpus.dispatch) {
    const result = dispatchEnvelope(item.body);
    if (item.error) {
      assert.equal(result.ok, false, item.id);
      assert.equal(result.error.code, item.error, item.id);
      continue;
    }
    assert.equal(result.ok, true, item.id);
    assert.equal(result.route, item.route, item.id);
    assert.equal(result.owner, item.owner, item.id);
    assert.equal(result.injectOperation, item.injectOperation, item.id);
    assert.deepEqual(result.body, item.forward, item.id);
    assert.equal(item.remote, false, item.id);
    assert.equal(result.route.startsWith('/host/'), true, item.id);
  }
});

test('version negotiation fails closed before a transport call', () => {
  for (const item of corpus.version) {
    const snapshot = createCapabilitySnapshot({
      protocolVersion: item.protocolVersion,
      providerGeneration: 'browser-1',
      operations: { 'paper/read': { version: 1 }, 'run/observe': { version: 1 }, 'device/pick': { version: 1 } },
    });
    assert.equal(capabilityOutcome(snapshot, item.capability, item.operation), item.outcome, item.id);
  }
});

test('local-only operations are not remote grants', () => {
  const local = new Set();
  for (const family of inventory.families) {
    for (const operation of family.operations ?? []) {
      if (operation.exposure === 'local_only' || operation.exposure === 'privileged') {
        local.add(`${family.id}/${operation.name}`);
      }
    }
  }
  for (const name of corpus.notRemote) {
    assert.equal(local.has(name), true, name);
    assert.equal(corpus.remoteAllow.includes(name), false, name);
  }
  for (const grant of corpus.remoteAllow) {
    assert.equal(local.has(grant), false, grant);
  }
  const clients = readFileSync(new URL('server/internal/httpapi/clients.go', root), 'utf8');
  assert.match(clients, /app-resources\/paper/);
  assert.match(clients, /runs\/observe/);
  assert.match(clients, /device-handles/);
  assert.doesNotMatch(clients, /\/host\/app-agent/);
  const electron = readFileSync(new URL('desktop/src/main/capability-dispatch.mjs', root), 'utf8');
  const native = readFileSync(new URL('crates/pero-ui/src/capability_dispatch.rs', root), 'utf8');
  assert.match(electron, /protocol\/inventory\/capabilities\.json/);
  assert.match(native, /protocol\/inventory\/capabilities\.json/);
  const harness = readFileSync(new URL('web/protocol-harness/session.mjs', root), 'utf8');
  assert.doesNotMatch(harness, /electron|capacitor|preload/);
  const exports = JSON.parse(readFileSync(new URL('packages/app-sdk/test/contracts/public-exports.json', root), 'utf8'));
  for (const name of ['readPaperResource', 'observeRun', 'interpretDevicePick', 'planDeviceTransfer', 'capabilityOutcome']) {
    assert.equal(exports.entries['.'].includes(name), true, name);
  }
});
