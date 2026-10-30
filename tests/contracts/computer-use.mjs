// One public contract corpus, shared with the Rust observation-admission tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import actionSchema from '../../protocol/generated/computer-action.schema.json' with { type: 'json' };
import requestSchema from '../../protocol/generated/computer-request.schema.json' with { type: 'json' };
import observationSchema from '../../protocol/generated/computer-observation.schema.json' with { type: 'json' };

const fixture = JSON.parse(readFileSync(new URL('./computer-use.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(actionSchema).addSchema(observationSchema).addSchema(requestSchema);
const validate = (type, value) => {
  const schema = [actionSchema, observationSchema, requestSchema].find(schema => schema.$defs[type]);
  assert.ok(schema, `No public schema for ${type}`);
  const check = ajv.getSchema(`${schema.$id}#/$defs/${type}`);
  return { valid: check(value), errors: ajv.errorsText(check.errors) };
};
for (const [type, values] of [
  ['ComputerCapabilities', [fixture.capabilities]],
  ['ComputerTarget', [fixture.target]],
  ['ComputerObservation', [fixture.observation]],
  ['ComputerAction', fixture.actions],
  ['ComputerActionReceipt', fixture.receipts],
]) {
  for (const value of values) {
    const result = validate(type, value);
    assert.ok(result.valid, `${type}: ${result.errors}`);
  }
}
for (const { name, type, value } of fixture.invalid) {
  assert.equal(validate(type, value).valid, false, name);
}
console.log('Computer Use v1 shared contract corpus passed.');

for (const request of [
  { operation: 'open', application: { kind: 'bundle_id', bundle_id: 'dev.pero.example' } },
  { operation: 'observe', target: fixture.target.reference, options: { want_image: false, max_nodes: 1, max_depth: 1, root: { observation_id: 'observation-1', element_id: 'editor' } } },
]) assert.ok(validate('ComputerRequest', request).valid);
for (const options of [{ max_nodes: 0 }, { max_nodes: 4097 }, { max_depth: 65 }, { want_image: 'false' }, { root: { element_id: 'editor' } }]) {
  assert.equal(validate('ComputerRequest', { operation: 'observe', target: fixture.target.reference, options }).valid, false);
}
