import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Product } from './product.ts';
const base = { schemaVersion: 1, id: 'com.openpero.virtualcell', name: 'Virtual Cell', version: '0.2.0', shell: 'app', apps: ['virtual-cell'], entry: { app: 'virtual-cell', panel: 'main' }, python: 'bundled' };
test('Product delivery invariants', () => {
  for (const [label, value, accepted] of [
    ['standalone entry', base, true],
    ['SVG icon', { ...base, icon: 'brand/cell.svg' }, true],
    ['icon outside product', { ...base, icon: '../icon.svg' }, false],
    ['unsupported icon format', { ...base, icon: 'icon.png' }, false],
    ['workbench', { ...base, shell: 'workbench', entry: undefined }, true],
    ['entry excluded', { ...base, apps: [] }, false],
    ['missing panel', { ...base, entry: { app: 'virtual-cell' } }, false],
    ['duplicate Apps', { ...base, apps: ['virtual-cell', 'virtual-cell'] }, false],
    ['unsafe name', { ...base, name: '../Escape' }, false],
    ['unknown shell', { ...base, shell: 'custom' }, false],
    ['bundled Node', { ...base, node: 'bundled' }, true],
    ['invalid Node policy', { ...base, node: 'download' }, false],
    ['unknown runtime', { ...base, python: 'download' }, false],
    ['unknown field', { ...base, command: 'anything' }, false],
    ['future version', { ...base, schemaVersion: 2 }, false],
  ] as const) {
    if (accepted) assert.doesNotThrow(() => Product.parse(value), label);
    else assert.throws(() => Product.parse(value), undefined, label);
  }
});

test('Product selects only its included Apps', () => {
  const product = Product.parse({ ...base, apps: ['virtual-cell', 'reaction-lab'] });
  assert.deepEqual(product.selectApp(), { app: 'virtual-cell', panel: 'main' });
  assert.deepEqual(product.selectApp('reaction-lab'), { app: 'reaction-lab' });
  assert.throws(() => product.selectApp('other'));
  assert.throws(() => product.selectApp({ app: 'virtual-cell' }));
});
