// One public contract corpus, shared with the Rust observation-admission tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import actionSchema from '../../protocol/generated/computer-action.schema.json' with { type: 'json' };
import observationSchema from '../../protocol/generated/computer-observation.schema.json' with { type: 'json' };

const fixture = JSON.parse(readFileSync(new URL('./computer-use.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(actionSchema).addSchema(observationSchema);
const validate = (type, value) => {
  const schema = [actionSchema, observationSchema].find(schema => schema.$defs[type]);
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
