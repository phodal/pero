import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AppParameterSchema } from '../../packages/app-sdk/src/app-use.ts';
import { PreparedAppWrite } from '../../desktop/src/main/app-write.ts';
import { AppWriteRoutes } from '../../desktop/src/main/app-write-routes.ts';
import { reviseEvidence, reportsCitingPaper, type ManualEvidence } from '../../apps/paper-agent/ui-src/manual-evidence.ts';
import type { Report } from '../../apps/paper-agent/ui-src/types.ts';

test('editing or removing one evidence row preserves other references for the same paper', () => {
  const rows: ManualEvidence[] = [
    { paperId: 'paper-a', reportId: 'report-1', stance: 'support', note: 'First conditions' },
    { paperId: 'paper-a', reportId: 'report-2', stance: 'counterevidence', note: 'Different conditions' },
    { paperId: 'paper-b', reportId: null, stance: 'gap', note: 'Not observed' },
  ];
  const edited = reviseEvidence(rows, 0, { note: 'Revised conditions' });
  assert.equal(edited.length, 3);
  assert.equal(edited[0].note, 'Revised conditions');
  assert.equal(rows[0].note, 'First conditions');
  assert.equal(edited[1], rows[1]);
  assert.equal(edited[2], rows[2]);
  assert.deepEqual(reviseEvidence(edited, 1, null), [edited[0], rows[2]]);
  assert.deepEqual(reviseEvidence(rows, 2, { reportId: 'report-3', stance: 'support' }).slice(0, 2), rows.slice(0, 2));
  const html = [{ ...rows[0], sourceKind: 'html' as const }];
  assert.equal(reviseEvidence(html, 0, { note: 'Review HTML' })[0].sourceKind, 'html');
  assert.equal(reviseEvidence(html, 0, { reportId: 'pdf-report' })[0].sourceKind, 'pdf');
});

test('report choices require actual evidence in every report location, not intent membership or paper labels', () => {
  const base = { id: 'summary', intentId: 'multi-paper-intent', title: 'Summary', acceptance: 'unverified' as const };
  const reports: Report[] = [base,
    { ...base, id: 'labels-only', sections: [{ heading: '', content: '', paperIds: ['paper-a'], evidence: [{ paperId: 'paper-b', quote: 'B' }] }] },
    { ...base, id: 'cites-a', sections: [{ heading: '', content: '', paperIds: ['paper-a', 'paper-b'], evidence: [{ paperId: 'paper-a', quote: 'A' }] }] },
  ];
  const experiment = { title: 'Not run', status: 'not-run' as const, files: [], commands: [], paperIds: ['paper-a'], expected: '', observed: '', limitations: '' };
  const cell = { paperId: 'paper-a', columnId: 'finding', value: '', status: 'missing' as const, evidence: [] };
  reports.push(
    { ...base, id: 'experiment-label-only', experiments: [experiment] },
    { ...base, id: 'matrix-label-only', matrix: { columns: [], cells: [cell] } },
    { ...base, id: 'experiment-cites-a', experiments: [{ ...experiment, evidence: [{ paperId: 'paper-a', quote: 'A' }] }] },
    { ...base, id: 'matrix-cites-a', matrix: { columns: [], cells: [{ ...cell, status: 'supported', value: 'A', evidence: [{ paperId: 'paper-a', quote: 'A' }] }] } },
  );
  assert.deepEqual(reportsCitingPaper(reports, 'paper-a').map(report => report.id), ['cites-a', 'experiment-cites-a', 'matrix-cites-a']);
  // Once a summary is hydrated by GET /api/reports/:id it can be selected only for its actual citations.
  const hydrated = { ...base, sections: [{ heading: '', content: '', paperIds: ['paper-a', 'paper-b'], evidence: [{ paperId: 'paper-b', quote: 'B' }] }] };
  assert.deepEqual(reportsCitingPaper([hydrated], 'paper-a'), []);
  assert.deepEqual(reportsCitingPaper([hydrated], 'paper-b'), [hydrated]);
});

test('installed manual record write prepares and routes every operation including nullable references', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/paper-agent/app.json', import.meta.url), 'utf8'));
  const write = manifest.contributes.writes.find((route: { name: string }) => route.name === 'research-record');
  assert.ok(write, 'installed research-record route');
  const sent: unknown[] = [];
  const routes = new AppWriteRoutes(async <T>(action: string) => {
    if (action === 'list') return [{ name: manifest.name, version: manifest.version, enabled: true, panels: [{ id: 'main' }], writes: [write] }] as T;
    assert.equal(action, 'resolve');
    return { backend: { url: 'http://fixture.invalid', token: 'fixture-token' } } as T;
  }, () => {}, async (url, init) => {
    assert.equal(url, 'http://fixture.invalid/api/research/record');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('X-Pero-App-Token'), 'fixture-token');
    sent.push(JSON.parse(String(init.body)));
    return new Response('{}');
  });
  const [definition] = await routes.describe();
  const id = 'a'.repeat(64);
  const initial = { operation: 'create', parentId: null, question: 'Question', scope: 'Scope', inclusion: 'Include', exclusion: 'Exclude',
    paperIds: [id], decisions: [{ paperId: id, decision: 'pending', reason: 'Review' }],
    evidence: [{ paperId: id, reportId: null, stance: 'gap', note: 'Not observed' }] };
  const documents = [initial, { ...initial, parentId: id, evidence: [{ paperId: id, reportId: id, stance: 'support', note: 'Local interpretation' }] },
    { operation: 'list' }, ...['read', 'impact', 'export'].map(operation => ({ operation, recordId: id })),
    { operation: 'select', recordId: id, paperIds: [id] }];
  for (const document of documents) await routes.apply(new PreparedAppWrite(definition, document), new AbortController().signal);
  assert.deepEqual(sent, documents);
  for (const document of [{}, { operation: 'execute' }, { operation: 'list', unknown: true },
    ...[null, 42, 'a'.repeat(63), 'a'.repeat(65)].map(recordId => ({ operation: 'read', recordId })),
    ...[42, 'source-id', 'a'.repeat(65)].flatMap(value => [
      { ...initial, parentId: value }, { ...initial, paperIds: [value] },
      { ...initial, decisions: [{ ...initial.decisions[0], paperId: value }] },
      { ...initial, evidence: [{ ...initial.evidence[0], paperId: value }] },
      { ...initial, evidence: [{ ...initial.evidence[0], reportId: value }] },
    ])]) assert.throws(() => new PreparedAppWrite(definition, document));
});


test('every installed Paper write uses the supported App parameter schema subset', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/paper-agent/app.json', import.meta.url), 'utf8'));
  for (const write of manifest.contributes.writes) {
    assert.doesNotThrow(() => AppParameterSchema.parse(write.schema), write.name);
  }
});

test('installed source-report writes accept observed references but not nullable or malformed IDs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/paper-agent/app.json', import.meta.url), 'utf8'));
  const write = manifest.contributes.writes.find((route: { name: string }) => route.name === 'research-source-report');
  assert.ok(write, 'installed research-source-report route');
  const definition = { app: manifest.name, panel: 'main', version: manifest.version, ...write };
  assert.equal(definition.path, '/api/research/source-report');
  const id = 'a'.repeat(64);
  const create = { operation: 'create', bundleId: id, title: 'Observed source', observationIds: [id], interpretations: ['Unresolved'] };
  for (const document of [create, { operation: 'read', bundleId: id, reportId: id },
    ...['observations', 'list'].map(operation => ({ operation, bundleId: id }))]) {
    assert.deepEqual(new PreparedAppWrite(definition, document).document, document);
  }
  for (const document of [{ operation: 'list' }, { ...create, operation: 'execute' }, { ...create, visualReview: 'verified' },
    { ...create, observationIds: [] }, { ...create, observationIds: Array(65).fill(id) },
    ...[null, 42, 'source-id', 'a'.repeat(63), 'a'.repeat(65)].flatMap(value => [
      { ...create, bundleId: value }, { ...create, observationIds: [value] },
      { operation: 'read', bundleId: id, reportId: value },
    ])]) assert.throws(() => new PreparedAppWrite(definition, document));
});

test('installed numeric proposals support nullable observations without granting review authority', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/paper-agent/app.json', import.meta.url), 'utf8'));
  const write = manifest.contributes.writes.find((route: { name: string }) => route.name === 'numeric-propose');
  assert.ok(write);
  const definition = { app: manifest.name, panel: 'main', version: manifest.version, ...write };
  const evidence = { identity: { metric: '', condition: '', series: '', statistic: '', unit: '' },
    sourceKind: 'figure', method: 'visual', rawText: 'unresolved source', value: null };
  const proposal = { annotationId: 'a'.repeat(64), extractionId: 'b'.repeat(64), evidence: [evidence] };
  const axis = { ticks: [{ pixel: 0, rawText: '0', value: 0 }, { pixel: 100, rawText: '10', value: 10 }],
    scale: 'linear', multiplier: 1, pixel: null };
  for (const item of [evidence, { ...evidence, value: 12, rawText: '12' },
    { ...evidence, axis }, { ...evidence, axis: { ...axis, pixel: 50 } }]) {
    const document = { ...proposal, evidence: [item] };
    assert.deepEqual(new PreparedAppWrite(definition, document).document, document);
  }
  for (const item of [{ ...evidence, value: '12' }, { ...evidence, semanticConfirmed: true },
    { ...evidence, reviewer: 'Agent' }, { ...evidence, previousId: 'c'.repeat(64) },
    { ...evidence, axis: { ...axis, pixel: '50' } },
    { ...evidence, axis: { ...axis, scaleConfirmed: true } },
    ...[0, -1].map(multiplier => ({ ...evidence, axis: { ...axis, multiplier } }))]) {
    assert.throws(() => new PreparedAppWrite(definition, { ...proposal, evidence: [item] }));
  }
});
