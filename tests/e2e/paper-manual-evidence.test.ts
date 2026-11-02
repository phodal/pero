import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
