import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMystMetadata } from '../src/myst-metadata.ts';

test('standard scholarly metadata normalizes aliases and linked contributors without changing authored data', () => {
  const raw = {
    title: 'Cell growth', subtitle: 'A reproducible study',
    author: [{ id: 'ada', name: { given: 'Ada', family: 'Lovelace' },
      orcid: '0000-0002-1825-0097', affiliation: 'lab', roles: ['Conceptualization'] }],
    affiliations: [{ id: 'lab', name: 'Example Institute', city: 'London', country: 'UK' }],
    date: '2024-02-29', doi: '10.1038/nphys1170', license: 'CC-BY-4.0',
    keywords: 'growth; reproducibility',
    funding: { statement: 'Supported by the Example Foundation', awards: [{ id: 'G1',
      sources: [{ id: 'foundation', name: 'Example Foundation' }], recipients: ['ada'] }] },
  };
  const before = structuredClone(raw);
  const result = validateMystMetadata(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.normalized.title, raw.title);
  assert.equal(result.normalized.authors?.[0].name, 'Ada Lovelace');
  assert.deepEqual(result.normalized.authors?.[0].affiliations, ['lab']);
  assert.equal(result.normalized.affiliations?.find(item => item.id === 'lab')?.name, 'Example Institute');
  assert.equal(result.normalized.authors?.[0].orcid, raw.author[0].orcid);
  assert.equal(result.normalized.doi, raw.doi);
  assert.equal(result.normalized.license?.content?.id, 'CC-BY-4.0');
  assert.deepEqual(result.normalized.keywords, ['growth', 'reproducibility']);
  assert.deepEqual(result.normalized.funding?.[0].awards?.[0].recipients, ['ada']);
  assert.deepEqual(result.normalized.funding?.[0].awards?.[0].sources, ['foundation']);
});

test('invalid scholarly fields report upstream diagnostics and are not mislabeled as normalized values', () => {
  const { normalized, diagnostics } = validateMystMetadata({
    title: { invalid: true }, doi: 'not-a-doi', authors: [{ name: 'Ada', orcid: 'bad' }],
    date: '2024-02-31', funding: false,
  });
  assert.equal(normalized.title, undefined);
  assert.equal(normalized.doi, undefined);
  assert.equal(normalized.date, undefined);
  assert.equal(normalized.authors?.[0].orcid, undefined);
  for (const field of ['title', 'doi', 'orcid', 'date', 'funding']) {
    assert.ok(diagnostics.some(item => item.severity === 'error' && item.property.includes(field)), field);
  }
});

test('unknown and custom namespaces remain authored data, not falsely validated schema fields', () => {
  const raw = { title: 'Study', custom: { nested: [1, null, 'x'] }, pero: { bibliography: [{ id: 'a' }] },
    identifiers: { doi: '10.1038/nphys1170' } };
  const before = structuredClone(raw);
  const result = validateMystMetadata(raw);
  assert.deepEqual(raw, before);
  assert.equal(result.normalized.doi, raw.identifiers.doi);
  assert.ok(!Object.hasOwn(result.normalized, 'custom'));
  assert.ok(!Object.hasOwn(result.normalized, 'pero'));
  for (const key of ['custom', 'pero']) {
    assert.ok(result.diagnostics.some(item => item.message.includes(`extra key ignored: ${key}`) && item.message.includes('retained')));
  }
});

test('dates are deterministic calendar values with no current-date or host timezone fallback', () => {
  assert.equal(validateMystMetadata({}).normalized.date, undefined);
  for (const date of ['today', 'now', 'March 3', '2024/01/02', 2024]) {
    const result = validateMystMetadata({ date });
    assert.equal(result.normalized.date, undefined);
    assert.ok(result.diagnostics.some(item => item.code === 'frontmatter-date'));
  }
  for (const [date, expected] of [['2024', '2024-01-01'], ['Sat, 1 Jan 2000', '2000-01-01'],
    ['2024-01-02T23:00:00-10:00', '2024-01-02']]) {
    assert.equal(validateMystMetadata({ date }).normalized.date, expected);
  }
  assert.ok(validateMystMetadata({ date: '2024' }).diagnostics.some(item => item.severity === 'warning'));
});

test('normalization is stable and remote metadata/configuration remains inert', () => {
  const raw = { authors: [{ name: 'Ada Lovelace', affiliations: [{ name: 'Lab' }] }],
    doi: '10.1038/nphys1170', bibliography: ['https://invalid.example/references.bib'],
    plugins: ['https://invalid.example/plugin.js'], exports: [{ format: 'pdf', template: 'https://invalid.example/template' }] };
  // Synchronous pure validation yields strings and metadata, not loaded resources.
  const first = validateMystMetadata(raw);
  assert.deepEqual(first, validateMystMetadata(raw));
  assert.deepEqual(first, JSON.parse(JSON.stringify(first)));
  assert.deepEqual(first.normalized.bibliography, raw.bibliography);
  assert.equal(first.normalized.authors?.[0].name, 'Ada Lovelace');
  assert.ok(first.diagnostics.some(item => item.message.includes('plugins')));
});

test('malformed nested values cannot abort parsing of the source document', () => {
  const raw = { title: 'Retained source', authors: [null] };
  const result = validateMystMetadata(raw);
  assert.deepEqual(raw, { title: 'Retained source', authors: [null] });
  assert.deepEqual(result.normalized, {});
  assert.ok(result.diagnostics.some(item => item.code === 'frontmatter-validator-error'));
});
