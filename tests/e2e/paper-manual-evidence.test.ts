import assert from 'node:assert/strict';
import test from 'node:test';
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

test('report choices require actual section evidence, not intent membership or section paper labels', () => {
  const base = { id: 'summary', intentId: 'multi-paper-intent', title: 'Summary', acceptance: 'unverified' as const };
  const reports: Report[] = [base,
    { ...base, id: 'labels-only', sections: [{ heading: '', content: '', paperIds: ['paper-a'], evidence: [{ paperId: 'paper-b', quote: 'B' }] }] },
    { ...base, id: 'cites-a', sections: [{ heading: '', content: '', paperIds: ['paper-a', 'paper-b'], evidence: [{ paperId: 'paper-a', quote: 'A' }] }] },
  ];
  assert.deepEqual(reportsCitingPaper(reports, 'paper-a').map(report => report.id), ['cites-a']);
  // Once a summary is hydrated by GET /api/reports/:id it can be selected only for its actual citations.
  const hydrated = { ...base, sections: [{ heading: '', content: '', paperIds: ['paper-a', 'paper-b'], evidence: [{ paperId: 'paper-b', quote: 'B' }] }] };
  assert.deepEqual(reportsCitingPaper([hydrated], 'paper-a'), []);
  assert.deepEqual(reportsCitingPaper([hydrated], 'paper-b'), [hydrated]);
});
