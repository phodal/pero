import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotebookDocument } from '../src/document.ts';
import { instantiateTemplate, validateTemplateParameters, type PublishedTemplate } from '../src/templates.ts';
import { createSourceExcerpt, readSourceExcerptAttachment, sourceExcerptAvailability, verifySourceExcerpt } from '../src/source-excerpt.ts';

const document = (): NotebookDocument => ({ schemaVersion: 1, title: 'Source', content: { type: 'doc', content: [
  { type: 'paragraph', attrs: { blockId: 'text' }, content: [{ type: 'text', text: 'Title {{x}}' }] },
  { type: 'evidence', attrs: { blockId: 'evidence', label: 'Evidence', source: { app: 'paper-agent', kind: 'report-citation', id: 'owner', version: 'digest', locator: 'fixed-source' }, snapshot: { exportSha256: 'stable-digest' } } },
  { type: 'finding', attrs: { blockId: 'finding', claim: 'Unchanged', limitations: '', evidenceIds: ['evidence', 'outside'] } },
  { type: 'spreadsheet', attrs: { blockId: 'sheet', label: 'Inputs', sheet: { rows: 2, columns: 2, cells: { A1: '5', B1: '=A1*2' } }, annotations: { A1: { unit: 'mg', evidenceIds: ['evidence'] } } } },
  { type: 'taskList', attrs: { blockId: 'tasks' }, content: [{ type: 'taskItem', attrs: { blockId: 'check', checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Checkbox' }] }] }] },
] } });
const template = (): PublishedTemplate => ({ id: 'template', revision: 1, name: 'Test', description: '', kind: 'entry', collections: [], archived: false, publishedAt: '2026-01-01T00:00:00Z', document: document(), parameters: [
  { key: 'label', label: 'Label', type: 'text', required: true, target: { kind: 'block-text', blockId: 'text' } },
  { key: 'amount', label: 'Amount', type: 'decimal', required: true, target: { kind: 'spreadsheet-cell', blockId: 'sheet', address: 'A1' } },
  { key: 'checked', label: 'Checked', type: 'boolean', required: true, target: { kind: 'block-attribute', blockId: 'check', field: 'checked' } },
] });
let sequence = 0;
const fresh = () => `new_${++sequence}`;
const values = { label: 'Changed', amount: 0, checked: false };

test('instances have independent IDs and internal citations, preserving pinned owner identities', () => {
  const source = template(), first = instantiateTemplate(source, values, fresh), second = instantiateTemplate(source, values, fresh);
  assert.equal(new Set([...Object.values(first.origin.idMap), ...Object.values(second.origin.idMap)]).size, Object.keys(first.origin.idMap).length * 2);
  const blocks = first.document.content.content;
  assert.equal(blocks[0].content![0].text, 'Changed');
  assert.deepEqual(blocks[1].attrs!.source, source.document.content.content[1].attrs!.source);
  assert.deepEqual(blocks[1].attrs!.snapshot, source.document.content.content[1].attrs!.snapshot);
  assert.deepEqual(blocks[2].attrs!.evidenceIds, [first.origin.idMap.evidence, 'outside']);
  assert.deepEqual((blocks[3].attrs!.annotations as any).A1.evidenceIds, [first.origin.idMap.evidence]);
  assert.equal((blocks[3].attrs!.sheet as any).cells.A1, '0');
  assert.equal((blocks[3].attrs!.sheet as any).cells.B1, '=A1*2');
  assert.equal(blocks[4].content![0].attrs!.checked, false);
  assert.deepEqual(first.origin.parameterValues, values);
  assert.equal(source.document.content.content[0].content![0].text, 'Title {{x}}');
  source.revision = 2; source.document.content.content[2].attrs!.claim = 'v2 changed';
  assert.equal(blocks[2].attrs!.claim, 'Unchanged');
  assert.equal(first.origin.revision, 1);
});

test('fragment instances have portable origin on their root blocks, not an entry title mutation', () => {
  const source = template(); source.kind = 'fragment';
  const instance = instantiateTemplate(source, values, fresh);
  assert.equal((instance.document as any).templateOrigin, undefined);
  for (const node of instance.document.content.content) assert.deepEqual(node.attrs!.templateOrigin, instance.origin);
  assert.doesNotThrow(() => JSON.stringify(instance.document));
});

test('parameters reject missing, mismatched, stale, duplicated and calculated-field bindings', () => {
  const source = template();
  assert.throws(() => instantiateTemplate(source, { label: 'x' }, fresh), /Missing Amount/);
  assert.throws(() => instantiateTemplate(source, { ...values, amount: '3' }, fresh), /Invalid decimal/);
  assert.throws(() => instantiateTemplate(source, { ...values, amount: NaN }, fresh), /Invalid decimal/);
  assert.throws(() => instantiateTemplate(source, { ...values, unknown: 'x' }, fresh), /Unknown/);
  for (const address of ['Z1', 'A999', 'B1']) {
    source.parameters[1].target = { kind: 'spreadsheet-cell', blockId: 'sheet', address };
    assert.throws(() => validateTemplateParameters(source.document, source.parameters, source.kind), /binding/);
  }
  source.parameters[1].target = { kind: 'block-text', blockId: 'missing' };
  assert.throws(() => validateTemplateParameters(source.document, source.parameters, source.kind), /stale/);
  source.parameters = [source.parameters[0], { ...source.parameters[0], key: 'other' }];
  assert.throws(() => validateTemplateParameters(source.document, source.parameters, source.kind), /same field/);
});

test('archive and duplicate identity factories cannot create misleading instances', () => {
  const source = template(); source.archived = true;
  assert.throws(() => instantiateTemplate(source, values, fresh), /Archived/);
  source.archived = false;
  assert.throws(() => instantiateTemplate(source, values, () => 'same'), /fresh IDs/);
});

test('typed text cells remain literal and copied catalog tables retain historical receipts', () => {
  const source = template();
  source.parameters = [{ key: 'text', label: 'Text', type: 'text', required: true, target: { kind: 'spreadsheet-cell', blockId: 'sheet', address: 'A1' } }];
  source.document.content.content.push({ type: 'registrationTable', attrs: { blockId: 'registration',
    table: { id: 'table', name: 'Materials', schema: { id: 'schema', revision: 1, columns: [{ id: 'column', name: 'Name' }] }, rows: [{ id: 'row', cells: { column: 'Buffer' } }] },
    receipts: [{ tableId: 'table', schemaId: 'schema', records: [{ rowId: 'row', recordId: 'fixed-record', version: 1 }] }],
  } });
  const copied = instantiateTemplate(source, { text: '=SUM(1,2)' }, fresh);
  assert.equal((copied.document.content.content[3].attrs!.sheet as any).cells.A1, "'=SUM(1,2)");
  const registration = copied.document.content.content.at(-1)!.attrs as any;
  assert.equal(registration.table.id, copied.origin.idMap.table);
  assert.equal(registration.table.rows[0].id, copied.origin.idMap.row);
  assert.equal(registration.table.schema.id, 'schema');
  assert.equal(registration.table.schema.columns[0].id, 'column');
  assert.deepEqual(registration.receipts, source.document.content.content.at(-1)!.attrs!.receipts);
});

test('procedure runs reset while nested step content receives new identities', () => {
  const source = template(); source.parameters = [];
  source.document.procedures = [{ id: 'procedure', title: 'Protocol', description: '', materials: [], steps: [{
    id: 'step', text: 'Measure', level: 'step', critical: false, pause: false, minutes: 5, completed: true,
    kind: 'timer', timer: { elapsedMs: 100, startedAt: 1000 },
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'nested' }, content: [{ type: 'text', text: 'Instructions' }] }] },
  } as any] }];
  const result = instantiateTemplate(source, {}, fresh);
  const step = result.document.procedures![0].steps[0] as any;
  assert.equal(step.completed, false);
  assert.deepEqual(step.timer, { elapsedMs: 0, startedAt: null });
  assert.equal(step.content.content[0].attrs.blockId, result.origin.idMap.nested);
  assert.equal(step.id, result.origin.idMap.step);
  assert.equal(source.document.procedures[0].steps[0].completed, true);
});

test('template excerpts follow copied local attachments across rich roots without rewriting source bytes or external IDs', async () => {
  const text = '\ufeffExact\r\n🧪 source', data = Buffer.from(text).toString('base64');
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
  const attachment = { filename: 'source.txt', mime: 'text/plain', caption: '', data, sha256 };
  const excerpt = createSourceExcerpt(await readSourceExcerptAttachment({ blockId: 'source', attachment }), 1, 6);
  const source = template(); source.parameters = [];
  source.document.content.content = [{ type: 'attachment', attrs: { blockId: 'source', ...attachment } }];
  const chemical = { name: 'Portable', graph: { atoms: [], bonds: [] }, source: { id: 'source', revision: 1, moleculeId: 'source', original: { atoms: [], bonds: [] } } };
  const materialSource = { source: 'notebook-local-catalog' as const, catalogId: 'catalog', recordId: 'source', version: 1, schemaId: 'source', schemaRevision: 1 };
  source.document.procedures = [{ id: 'procedure', title: 'Method', description: '', steps: [], materials: [{ id: 'material', name: 'Selected', quantity: '', source: materialSource }],
    introduction: { type: 'doc', content: [{ type: 'sourceExcerpt', attrs: { blockId: 'excerpt', label: '', excerpt } }, { type: 'chemical', attrs: { blockId: 'chemical', chemical } }] } }];
  const copied = instantiateTemplate(source, {}, fresh), nodes = copied.document.procedures![0].introduction!.content!;
  const next = nodes[0].attrs!.excerpt as typeof excerpt;
  assert.deepEqual(next, { ...excerpt, source: { ...excerpt.source, blockId: copied.origin.idMap.source } });
  assert.equal(sourceExcerptAvailability(next, [{ blockId: copied.origin.idMap.source, attachment }]), 'available');
  await verifySourceExcerpt(next);
  assert.deepEqual(nodes[1].attrs!.chemical, chemical);
  assert.deepEqual(copied.document.procedures![0].materials[0].source, materialSource);
  assert.equal(excerpt.source.blockId, 'source');
  source.document.content.content = [{ type: 'paragraph', attrs: { blockId: 'source' } }];
  const excerptOnly = instantiateTemplate(source, {}, fresh).document.procedures![0].introduction!.content![0].attrs!.excerpt;
  assert.deepEqual(excerptOnly, excerpt, 'A non-attachment sharing the old ID must not retarget the retained source');
});
