import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv from 'ajv';

const manifest = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const declaration = manifest.contributes.writes.find((write: { name: string }) => write.name === 'apply-edits');
const validate = new Ajv().compile(declaration.schema);

test('the declared Host write accepts pinned reference proposals, without granting review or permission fields', () => {
  const operation = { op: 'propose_reference', proposalId: 'proposal-1', blockId: 'evidence-1', label: 'Review this source',
    source: { app: 'paper-agent', kind: 'report-citation', id: 'report-1', version: 'report-1', locator: '' } };
  const input = { entryId: 'a'.repeat(32), baseRevision: 1, operations: [operation] };
  assert.equal(validate(input), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...operation, source: { ...operation.source, version: '' } },
    { ...operation, source: { ...operation.source, snapshot: {} } },
    { ...operation, proposalId: '../proposal' },
    { ...operation, decision: 'accept' },
    { ...operation, permission: 'allow' },
    { ...operation, op: 'accept_reference' },
  ]) assert.equal(validate({ ...input, operations: [invalid] }), false);
  assert.equal(validate({ ...input, operations: [{ op: 'replace_text', blockId: 'intro', match: 'Before', replacement: 'After' }] }), true);
});
