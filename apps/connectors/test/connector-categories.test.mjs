import test from 'node:test';
import assert from 'node:assert/strict';
import { pointCatalog } from '../../../packages/connectors/src/connectors/catalog.mjs';
import { CONNECTOR_SHELVES, connectorSections, connectorShelf, connectorShelfLabels } from '../ui-src/connector-categories.mjs';

const visible = () => pointCatalog().visibleProviders();

test('every catalog provider sits on exactly one shelf, and shelves name only real providers', () => {
  const listed = visible().filter(entry => !['custom', 'builtin', 'messaging'].includes(entry.category));
  for (const entry of listed) assert.ok(connectorShelf(entry), `${entry.providerId} has no shelf`);
  const placed = CONNECTOR_SHELVES.flatMap(shelf => shelf.providers);
  assert.equal(new Set(placed).size, placed.length, 'a provider is on two shelves');
  for (const id of placed) assert.ok(pointCatalog().provider(id), `${id} is not a catalog provider`);
});

test('the catalog is one level: sections follow tab order and cover every listed entry once', () => {
  const sections = connectorSections(visible(), 'en');
  assert.deepEqual(sections.map(section => section.id), CONNECTOR_SHELVES.map(shelf => shelf.id));
  assert.ok(sections.every(section => section.label && section.entries.length > 0));
  const listed = visible().filter(entry => connectorShelf(entry));
  assert.deepEqual(sections.flatMap(section => section.entries.map(entry => entry.providerId)).sort(), listed.map(entry => entry.providerId).sort());
});

test('shelves place tools by what they are for', () => {
  const shelf = id => connectorShelf(pointCatalog().provider(id));
  assert.equal(shelf('linear'), 'work');
  assert.equal(shelf('microsoft-365'), 'work');
  assert.equal(shelf('kicad'), 'design');
  assert.equal(shelf('wandb'), 'computing');
  assert.equal(shelf('zotero'), 'literature');
  assert.equal(shelf('benchling'), 'life-sciences');
  assert.equal(shelf('cyanheads-pubmed'), 'literature');
  assert.equal(shelf('cyanheads-uniprot'), 'life-sciences');
  assert.equal(shelf('cyanheads-noaa-climate'), 'computing');
});

test('an unplaced provider falls back by runtime category; templates, built-ins and channels have no shelf', () => {
  assert.equal(connectorShelf({ providerId: 'future-cad', category: 'engineering' }), 'simulation');
  assert.equal(connectorShelf({ providerId: 'future-lab', category: 'research' }), 'computing');
  for (const id of ['remote-oauth', 'remote-token', 'local-process', 'point-builtin', 'wechat']) {
    assert.ok(pointCatalog().provider(id));
    assert.equal(connectorShelf(pointCatalog().provider(id)), null);
  }
});

test('shelf labels support both languages', () => {
  assert.equal(connectorShelfLabels().literature, '文献与科研写作');
  assert.equal(connectorShelfLabels('en').literature, 'Literature & publishing');
});
