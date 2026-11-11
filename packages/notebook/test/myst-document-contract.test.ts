import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mystDocumentDefinition } from '../src/myst.ts';

// Python persistence consumes this same corpus, including exact source line endings.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/myst-document-contract.json', import.meta.url), 'utf8'));

test('MyST SDK validation agrees with the persisted source wire contract', () => {
  for (const { name, accepted, attrs } of fixture.cases) {
    if (!accepted) {
      assert.throws(() => mystDocumentDefinition.validate(attrs), undefined, name);
      continue;
    }
    const validated = mystDocumentDefinition.validate(attrs);
    const wire = { ...fixture.document, content: { type: 'doc', content: [{ type: mystDocumentDefinition.type, attrs: validated }] } };
    const reopened = JSON.parse(JSON.stringify(wire)).content.content[0].attrs;
    assert.deepEqual(mystDocumentDefinition.validate(reopened), attrs, name);
    assert.deepEqual(Buffer.from(reopened.source, 'utf8'), Buffer.from(attrs.source, 'utf8'), name);
  }
});

test('MyST source wire budget counts UTF-8 bytes across languages', () => {
  const boundary = fixture.utf8Boundary;
  const source = boundary.unit.repeat(boundary.repeat) + boundary.suffix;
  assert.equal(Buffer.byteLength(source, 'utf8'), boundary.maxBytes);
  const attrs = { blockId: 'utf8-contract', schemaVersion: 1, source };
  const reopened = JSON.parse(JSON.stringify(mystDocumentDefinition.validate(attrs)));
  assert.equal(mystDocumentDefinition.validate(reopened).source, source);
  assert.throws(() => mystDocumentDefinition.validate({ ...attrs, source: source + boundary.overflow }));
});
