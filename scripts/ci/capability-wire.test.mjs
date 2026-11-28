import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/capabilities.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const fixture = resolve(root, 'protocol/fixtures/capability-wire');
const inventory = JSON.parse(readFileSync(resolve(root, 'protocol/inventory/capabilities.json'), 'utf8'));
const cases = JSON.parse(readFileSync(resolve(fixture, 'cases.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);
const validate = name => ajv.getSchema(`${schema.$id}#/$defs/${name}`);
const known = new Set(inventory.families.flatMap(family => (family.operations ?? []).map(operation => `${family.id}\0${operation.name}`)));

function document(item) {
  return item.file ? JSON.parse(readFileSync(resolve(fixture, item.file), 'utf8')) : item.document;
}

function admit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_input';
  const allowed = new Set(['protocolVersion', 'capability', 'operation', 'declaredHost', 'advertised']);
  if (Object.keys(value).some(key => !allowed.has(key))) return 'invalid_input';
  if (!Object.hasOwn(value, 'protocolVersion')) return 'missing_version';
  const version = value.protocolVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 4294967295) return 'invalid_input';
  if (version !== 1) return 'version_mismatch';
  if (typeof value.capability !== 'string' || value.capability.length < 1 || value.capability.length > 64) return 'invalid_input';
  if (typeof value.operation !== 'string' || value.operation.length < 1 || value.operation.length > 64) return 'invalid_input';
  if (!Array.isArray(value.declaredHost) || value.declaredHost.some(item => typeof item !== 'string')) return 'invalid_input';
  if (typeof value.advertised !== 'boolean') return 'invalid_input';
  return known.has(`${value.capability}\0${value.operation}`) ? 'accepted' : 'unknown_operation';
}

test('inventory names the six dispatch families and the recorded drift', () => {
  assert.deepEqual(inventory.families.map(family => family.id), ['agent', 'insights', 'connectors', 'automation', 'research-assets', 'skills']);
  assert.deepEqual(inventory.sciencePath.operations, ['science', 'science_sessions']);
  assert.ok(inventory.drift.some(item => item.id === 'research-assets-operations'));
  assert.ok(inventory.drift.some(item => item.id === 'agent-scope-project-id'));
  assert.equal(inventory.remoteNow, false);
  assert.equal(inventory.grant, false);
  const generated = readFileSync(resolve(root, 'protocol/generated/capabilities.ts'), 'utf8');
  for (const name of ['AgentStatusRequest', 'AgentStatusResponse', 'ResearchAssetsQueriesRequest', 'ResearchAssetsQueriesResponse', 'CapabilityError', 'CapabilityNegotiation']) {
    assert.match(generated, new RegExp(`export interface ${name} `));
  }
});

test('json schema accepts the canonical wire and rejects the shared negative fixtures', () => {
  for (const item of cases.wires) {
    const check = validate(item.schema);
    assert.ok(check, item.schema);
    const ok = check(document(item));
    assert.equal(ok, item.parse === 'accept', `${item.id}: ${ajv.errorsText(check.errors)}`);
  }
});

test('negotiation fails closed and a declaration is not a grant', () => {
  const check = validate('CapabilityNegotiation');
  for (const item of cases.negotiations) {
    const value = document(item);
    const schemaOk = check(value);
    const result = admit(value);
    assert.equal(result, item.result, item.id);
    if (result === 'accepted' || result === 'version_mismatch' || result === 'unknown_operation') assert.equal(schemaOk, true, item.id);
    else assert.equal(schemaOk, false, item.id);
    if (result === 'accepted') assert.equal(item.grant, false);
  }
  assert.equal(validate('CapabilityAdmission')({ outcome: 'accepted', grant: false }), true);
  assert.equal(validate('CapabilityAdmission')({ outcome: 'accepted', grant: true }), false);
});
