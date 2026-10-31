import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chartSeries, missingCount, parseImported, visibleAssets } from '../ui-src/model.ts';
import { seedAssets } from '../ui-src/sample.ts';

const assets = seedAssets();
const asset = (id: string) => assets.find(item => item.id === id)!;

test('sample library search and chart series', () => {
  assert.equal(missingCount(asset('motor-telemetry')), 5);
  assert.equal(missingCount(asset('plant-model')), 0);
  assert.deepEqual(visibleAssets(assets, '').map(item => item.name), ['servo-response.csv', 'motor-telemetry.csv', 'plant-model.json', 'baseline-response.csv', 'response-metrics.json', 'wind-disturbance.csv']);
  assert.deepEqual(visibleAssets(assets, 'rpm').map(item => item.id), ['motor-telemetry']);
  assert.deepEqual(visibleAssets(assets, 'Model').map(item => item.id), ['plant-model']);
  assert.deepEqual(chartSeries(asset('servo-response')), { x: 'time_s', ys: ['response', 'setpoint'] });
  assert.equal(chartSeries(asset('motor-telemetry')).ys[0], 'temperature_c');
});

test('import parsing accepts delimited and json records and rejects broken files', () => {
  const csv = parseImported('bench.csv', 'time_s,note\n0,ok\n0.1,\n1,"quoted, value"\n');
  assert.equal(csv.kind, 'Table');
  assert.deepEqual(csv.rows[0], { time_s: 0, note: 'ok' });
  assert.equal(csv.rows[1].note, null);
  assert.equal(csv.rows[2].note, 'quoted, value');
  const json = parseImported('model.json', '{"gain":1}');
  assert.equal(json.kind, 'Records');
  assert.deepEqual(json.rows, [{ gain: 1 }]);
  const jsonl = parseImported('rows.jsonl', '{"a":1}\n{"a":2}\n');
  assert.equal(jsonl.kind, 'Table');
  assert.equal(jsonl.rows.length, 2);
  assert.throws(() => parseImported('dup.csv', 'a,a\n1,2\n'), /Duplicate column/);
  assert.throws(() => parseImported('short.csv', 'a,b\n1\n'), /Row 2 has 1 fields/);
  assert.throws(() => parseImported('quote.csv', '"open\n'), /Unclosed/);
  assert.throws(() => parseImported('notes.txt', 'hello'), /Unsupported/);
  assert.throws(() => parseImported('empty.json', 'null'), /Expected an object/);
  const tooMany = JSON.stringify(Array.from({ length: 10001 }, () => ({ a: 1 })));
  assert.throws(() => parseImported('big.json', tooMany), /10,000/);
});
