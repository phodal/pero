import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../protocol/generated/host.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/ProjectResourceCatalog`);

test('Data catalog accepts an asset identity and rejects a moving or malformed version', () => {
  const id = `ds-${'a'.repeat(32)}`, revision = 'b'.repeat(32);
  const valid = reference => validate({ app: 'data', resources: [{
    reference, title: 'Dataset', summary: '', status: 'stored',
    location: `pero-app-location://data/main/dataset/${id}/version/${revision}`,
  }] });
  const reference = { app: 'data', kind: 'dataset', id, revision };
  assert.equal(valid(reference), true, JSON.stringify(validate.errors));
  for (const malformed of [{ revision: 'latest' }, { revision: '2' }, { revision: revision + '\n' },
    { id: id.slice(3) }, { kind: 'entry' }, { id: '../dataset' }]) {
    assert.equal(valid({ ...reference, ...malformed }), false, JSON.stringify(malformed));
  }
});
