import assert from 'node:assert/strict';
import test from 'node:test';
import { mystImportFormats, mystExportFormats } from '../src/myst-formats.ts';
import { MYST_SOURCE_MAX_BYTES, parseMystDocument } from '../src/myst.ts';

const input = (id: string) => mystImportFormats.find(format => format.id === id)!;
const output = (id: string) => mystExportFormats.find(format => format.id === id)!;

test('source and bundle codecs roundtrip actual scholarly source without losing unknown content', () => {
  const source = '---\ntitle: Study\nauthor: Ada Lovelace\ncustom: retained\n---\n\n```{unknown}\nExact **source**\n```\n'.replaceAll('\n', '\r\n');
  for (const id of ['source', 'bundle']) {
    const serialized = output(id).serialize({ source });
    const attrs = input(id).parse(serialized);
    assert.deepEqual(attrs, { schemaVersion: 1, source });
    assert.equal(output(id).serialize(attrs), serialized);
    assert.equal(parseMystDocument(attrs.source).scholarly.authors?.[0].name, 'Ada Lovelace');
  }
  assert.equal(input('source').maxBytes, MYST_SOURCE_MAX_BYTES);
  assert.ok(input('bundle').maxBytes! > input('source').maxBytes!);
  assert.deepEqual(input('source').extensions, ['.md', '.myst']);
  assert.deepEqual(input('bundle').extensions, ['.myst.json']);
});

test('bundle import rejects unknown versions and invalid source instead of trusting derived fields', () => {
  for (const bundle of ['{', JSON.stringify({ format: 'pero-myst', version: 2, source: 'preserve me' }), JSON.stringify({ format: 'pero-myst', version: 1, source: null })]) assert.throws(() => input('bundle').parse(bundle));
  const authored = '---\ntitle: Authored\n---\n\nActual text';
  const imported = input('bundle').parse(JSON.stringify({ format: 'pero-myst', version: 1, source: authored, metadata: { title: 'Forged' }, scholarly: { title: 'Forged' }, ast: { type: 'text', value: 'Forged' } }));
  assert.equal(parseMystDocument(imported.source).scholarly.title, 'Authored');
  assert.equal(output('source').serialize(imported), authored);
  assert.throws(() => input('source').parse('x'.repeat(MYST_SOURCE_MAX_BYTES + 1)));
});

test('source-only download needs no fabricated AST or supported schema; derived exports validate', () => {
  const future = { source: '未来 source\r\n', schemaVersion: 9, opaqueFutureField: 'retained elsewhere' };
  assert.equal(output('source').serialize(future), future.source);
  const oversized = { source: 'x'.repeat(MYST_SOURCE_MAX_BYTES + 1) };
  assert.equal(output('source').serialize(oversized), oversized.source);
  assert.throws(() => output('bundle').serialize(oversized));
  assert.throws(() => output('html').serialize(oversized));
});

test('HTML codec publishes actual parsed scientific content as inert HTML', () => {
  const source = '# Science\n\n$x^2$\n\n<script>alert(1)</script>';
  const html = output('html').serialize({ source });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<math/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.equal(output('html').mediaType, 'text/html');
  assert.deepEqual(output('html').extensions, ['.html']);
});


test('every legal source fits its own bundle import budget despite metadata aliases or JSON escaping', () => {
  const aliased = '---\ntitle: &text ' + 'a'.repeat(240000) + '\nsubtitle: *text\ndescription: *text\nshort_title: *text\nabstract: *text\n---\n';
  for (const source of [aliased, '\u0001'.repeat(MYST_SOURCE_MAX_BYTES)]) {
    assert.ok(Buffer.byteLength(source) <= MYST_SOURCE_MAX_BYTES);
    const serialized = output('bundle').serialize({ source });
    assert.ok(Buffer.byteLength(serialized) <= input('bundle').maxBytes!);
    assert.deepEqual(JSON.parse(serialized), { format: 'pero-myst', version: 1, source });
    assert.equal(input('bundle').parse(serialized).source, source);
  }
});
