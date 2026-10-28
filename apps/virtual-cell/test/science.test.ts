import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseDisplay, simulate, groupMeans } from '../ui-src/science.ts';
import { mechanismExample, volumeExample } from '../ui-src/demo.ts';

test('atlas retains real cell identities, expression order and groups; malformed vectors fail closed', () => {
  const atlas: any = parseDisplay(JSON.parse(readFileSync(new URL('../ui-src/pbmc-atlas.json', import.meta.url), 'utf8')));
  assert.equal(atlas.source.kind, 'observed');
  const means = groupMeans(atlas, ['CD4 T cells', 'CD14+ Monocytes']);
  const cd3d = atlas.genes.indexOf('CD3D');
  assert.ok(means[0].values[cd3d] > means[1].values[cd3d]);
  for (const mutate of [d => d.cells[0].expression.pop(), d => d.embedding.coordinates.pop(), d => d.cells[0].expression[0] = NaN, d => d.cells[1].id = d.cells[0].id, d => d.source.url = 'javascript:alert(1)']) {
    const bad = structuredClone(atlas); mutate(bad); assert.throws(() => parseDisplay(bad), /display_document_invalid/);
  }
});

test('first-order transfer conserves mass, stays nonnegative and responds to parameters', () => {
  const result = simulate(mechanismExample);
  for (const row of result.rows) {
    assert.ok(row.values.every(v => v >= 0));
    assert.ok(Math.abs(row.values.reduce((a, b) => a + b, 0) - 10) < 1e-10);
  }
  assert.ok(result.rows.at(-1)!.values[2] > 5);
  const frozen = simulate({ ...mechanismExample, reactions: mechanismExample.reactions.map(r => ({ ...r, rate: 0 })) });
  assert.deepEqual(frozen.rows.at(-1)!.values, [10, 0, 0]);
  const oneWay = simulate({ ...mechanismExample, reactions: [{ id: 'r', from: 'A', to: 'B', rate: .1 }] });
  assert.ok(Math.abs(oneWay.rows.at(-1)!.values[0] - 10 * Math.exp(-2)) < .02);
  assert.throws(() => simulate({ ...mechanismExample, reactions: [{ id: 'r', from: 'A', to: 'missing', rate: .1 }] }));
  assert.throws(() => parseDisplay({ ...mechanismExample, duration: 100, reactions: Array.from({ length: 64 }, (_, i) => ({ id: `r${i}`, from: 'A', to: 'B', rate: 10 })) }), /display_document_invalid/);
});

test('voxel import validates physical spacing, channel alignment and intensity bounds', () => {
  const volume = volumeExample(); parseDisplay(volume);
  assert.equal(volume.source.kind, 'illustrative');
  assert.equal(volume.source.revision, 'v2');
  assert.deepEqual(volume.dimensions, [64, 64, 64]);
  assert.deepEqual(volume.dimensions.map((n, i) => n * volume.spacing[i]), [12, 12, 12]);
  const exported = JSON.stringify(volume);
  assert.ok(Buffer.byteLength(exported) < 16 * 1024 * 1024, 'the built-in volume must export within the UI import budget');
  assert.deepEqual(parseDisplay(JSON.parse(exported)), volume);
  assert.equal(volume.channels[0].values.length, volume.dimensions.reduce((a, b) => a * b, 1));
  for (const mutate of [d => d.spacing[2] = 0, d => d.dimensions[0] = 10000, d => d.channels[0].values.pop(), d => d.channels[0].values[0] = 2]) {
    const bad = structuredClone(volume); mutate(bad); assert.throws(() => parseDisplay(bad), /display_document_invalid/);
  }
});
