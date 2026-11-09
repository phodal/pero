import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTemplateRevisions, type PublishedTemplate } from '../src/templates.ts';

function template(kind: 'entry' | 'fragment' = 'entry'): PublishedTemplate {
  return { id: 'template', revision: 1, name: 'Protocol', description: '', kind, collections: [], archived: false, publishedAt: '2026-11-09T00:00:00Z',
    document: { schemaVersion: 1, title: 'Protocol', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'first' }, content: [{ type: 'text', text: 'Before' }] }, { type: 'paragraph', attrs: { blockId: 'second' } }] } },
    parameters: [{ key: 'value', label: 'Value', type: 'text', required: true, target: { kind: 'block-text', blockId: 'first' }, default: 'A' }] };
}

test('entry and fragment revisions compare stable blocks, moves and typed parameters without mutating instances', () => {
  for (const kind of ['entry', 'fragment'] as const) {
    const before = template(kind), after = structuredClone(before), frozen = JSON.stringify(before);
    after.revision = 2; after.document.content.content.reverse(); after.document.content.content[1].content![0].text = 'After';
    after.parameters[0].default = 'B'; after.parameters[0].target = { kind: 'block-text', blockId: 'second' };
    const result = compareTemplateRevisions(before, after);
    assert.equal(result.total, 4); assert.ok(result.changes.some(change => change.kind === 'reordered'));
    assert.ok(result.changes.some(change => change.path.includes('[first]') && change.before === '"Before"' && change.after === '"After"'));
    assert.ok(result.changes.some(change => change.path === 'parameters[value].target'));
    assert.equal(JSON.stringify(before), frozen);
  }
});

test('comparison excludes mutable archive/publication status and bounds previews without hiding equality differences', () => {
  const before = template(), after = structuredClone(before);
  after.archived = true; after.publishedAt = 'later'; after.revision = 3;
  assert.equal(compareTemplateRevisions(before, after).total, 0);
  after.name = 'New'; after.description = 'x'.repeat(1000); after.parameters = [];
  const result = compareTemplateRevisions(before, after, 1);
  assert.equal(result.total, 3); assert.equal(result.changes.length, 1); assert.equal(result.limited, true);
  assert.throws(() => compareTemplateRevisions(before, { ...after, id: 'another' }), /same template/);
});
