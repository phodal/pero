import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyTypedProposal, freezeTypedGeneration, hasAIApplication, listAISources, listAITables, readAIBlockSource, readAISourceBytes, readTypedProposal, reviewTypedCells, recoveredAIWorkspace, validateAISources, type AISource, type CellDecision } from '../src/ai-generation.ts';
import type { StructuredTableDraft } from '../src/structured-table.ts';
const target = { entryId: 'a'.repeat(32), revision: 4 };
const table: StructuredTableDraft = { id: 'table-1', name: 'Observations', schema: { id: 'schema-1', revision: 2, columns: [
  { id: 'mass', name: 'Mass', type: 'quantity', required: true, options: [], units: ['mg'] },
  { id: 'count', name: 'Count', type: 'decimal', required: false, options: [], units: [] },
  { id: 'note', name: 'Note', type: 'text', required: false, options: [], units: [] },
  { id: 'missing', name: 'Unavailable', type: 'missing', required: false, options: [], units: [] },
] }, rows: [{ id: 'row-1', cells: { count: '3' } }] };
const doc = { type: 'doc', content: [{ type: 'inputTable', attrs: { blockId: 'block-1', table, receipts: [] } }, { type: 'lookupTable', attrs: { blockId: 'lookup', table } }] };
const content = JSON.stringify(doc);
const source = async () => readAISourceBytes('source-1', 'measurements.csv', 'text/csv', new TextEncoder().encode('mass,count\n2.5 mg,4'));
const response = (columnId = 'mass', value = '2.5 mg') => JSON.stringify({ cells: [{ blockId: 'block-1', rowId: 'row-1', columnId, value, sourceIds: ['source-1'], reason: 'Recorded CSV mass' }] });
const decide = (proposal: ReturnType<typeof readTypedProposal>, decision: CellDecision) => Object.fromEntries(proposal.cells.map(cell => [cell.id, decision]));

test('source extraction reads selected bytes, rejects unsupported/binary/oversized input and checks attachment digests', async () => {
  const read = await source(); assert.equal(read.text, 'mass,count\n2.5 mg,4'); assert.equal(read.sha256.length, 64);
  for (const [name, mime, bytes] of [['paper.pdf', 'application/pdf', new Uint8Array([1])], ['x.txt', 'text/plain', new Uint8Array([0xff])], ['x.txt', 'text/plain', new Uint8Array([0])], ['x.txt', 'text/plain', new Uint8Array(65_537)]] as const) await assert.rejects(readAISourceBytes('file', name, mime, bytes));
  const attrs = { blockId: 'attachment-1', filename: 'file.csv', mime: 'text/csv', data: btoa(read.text), caption: '', sha256: read.sha256 };
  const options = listAISources(JSON.stringify({ type: 'doc', content: [{ type: 'attachment', attrs }, { type: 'attachment', attrs: { ...attrs, blockId: 'pdf', filename: 'paper.pdf', mime: 'application/pdf' } }] }));
  assert.equal(options.length, 2); assert.equal(options[1].supported, true);
  await assert.rejects(readAIBlockSource(options[1]), /explicit local extraction/);
  assert.equal((await readAIBlockSource(options[0])).text, read.text);
  await assert.rejects(readAIBlockSource({ ...options[0], node: { ...options[0].node, attrs: { ...attrs, sha256: 'f'.repeat(64) } } }), /SHA-256/);
});

test('typed proposals validate schema, source provenance, target identity and both stale guards', async () => {
  const sources = [await source()];
  const frozen = await freezeTypedGeneration('request-1', 'host-agent', target, content, 'Extract mass', 'block-1', sources, true);
  assert.equal(listAITables(content).length, 1);
  assert.ok(frozen.prompt.includes(sources[0].text.replaceAll('\n', '\\n')));
  const proposal = readTypedProposal(frozen, 'host-session', response()), decisions = decide(proposal, 'accepted');
  const reviewed = reviewTypedCells(frozen, proposal, decisions);
  assert.deepEqual(reviewed[0].typed, { type: 'quantity', value: '2.5', unit: 'mg' });
  const applied = applyTypedProposal(frozen, proposal, decisions, target, content, true);
  const after = JSON.parse(applied.content);
  assert.equal(after.content[0].attrs.table.rows[0].cells.mass, '2.5 mg');
  assert.equal(after.content[0].attrs.table.rows[0].cells.count, '3');
  assert.deepEqual(after.content[1], doc.content[1]);
  assert.equal(applied.evidence.sessionId, 'host-session'); assert.equal(applied.evidence.sourceDigests[0].sha256, sources[0].sha256);
  for (const [nowTarget, nowContent, ack] of [[{ ...target, revision: 5 }, content, true], [target, content + ' ', true], [target, content, false]] as const) assert.throws(() => applyTypedProposal(frozen, proposal, decisions, nowTarget, nowContent, ack));
  assert.throws(() => applyTypedProposal(frozen, proposal, {}, target, content, true));
  assert.throws(() => readTypedProposal(frozen, 'session', response().replace('source-1', 'invented-source')));
  assert.throws(() => readTypedProposal(frozen, 'session', JSON.stringify({ cells: [...JSON.parse(response()).cells, ...JSON.parse(response()).cells] })));
  for (const [column, value] of [['mass', '2.5 kg'], ['count', '4'], ['missing', 'measured'], ['not-a-column', '4']]) {
    const invalid = readTypedProposal(frozen, 'host-session', response(column, value));
    assert.ok(reviewTypedCells(frozen, invalid, {})[0].error);
    assert.throws(() => applyTypedProposal(frozen, invalid, decide(invalid, 'accepted'), target, content, true));
  }
  const nonempty = await freezeTypedGeneration('request-2', 'host-agent', target, content, 'Update count', 'block-1', sources, false);
  const count = readTypedProposal(nonempty, 'host-session', response('count', '4'));
  assert.equal(reviewTypedCells(nonempty, count, {})[0].error, '');
  for (const kind of ['lookupTable', 'savedSearch', 'reference']) assert.equal(listAITables(JSON.stringify({ ...doc, content: [{ ...doc.content[0], type: kind }] })).length, 0);
  for (const policy of ['protected', 'readOnly', 'computed', 'snapshot']) assert.equal(listAITables(JSON.stringify({ ...doc, content: [{ ...doc.content[0], attrs: { ...doc.content[0].attrs, [policy]: true } }] })).length, 0);
  const receipt = JSON.stringify({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: JSON.stringify(applied.evidence) }] }] });
  assert.ok(hasAIApplication(receipt, 'request-1', 'host-session')); assert.equal(hasAIApplication(receipt, 'request-2', 'host-session'), false);
});

test('requests reject no sources, excessive bytes and invalid schemas rather than silently truncating', async () => {
  const src = await source();
  await assert.rejects(() => freezeTypedGeneration('request', 'agent', target, content, 'goal', 'lookup', [src], false));
  await assert.rejects(() => freezeTypedGeneration('request', 'agent', target, content, 'goal', 'block-1', [], false));
  const big: AISource = { ...src, bytes: 65_536, text: 'x'.repeat(65_536) };
  await assert.rejects(() => freezeTypedGeneration('request', 'agent', target, content, 'goal', 'block-1', [big, { ...big, id: 'other' }], false), /96 KiB/);
  const bad = structuredClone(doc); bad.content[0].attrs.table.schema.columns[0].units = [];
  await assert.rejects(() => freezeTypedGeneration('request', 'agent', target, JSON.stringify(bad), 'goal', 'block-1', [src], false), /schema errors/);
});


test('persisted sources bind exact UTF-8 text, original BOM bytes and SHA-256 before generation or recovery', async () => {
  for (const text of ['original', '\ufefforiginal', '\ufeff质量: 2.5 mg\r\n', 'Δ mass: 2.5 mg']) {
    const bytes = new TextEncoder().encode(text);
    const src = await readAISourceBytes('source-1', 'source.txt', 'text/plain', bytes);
    assert.equal(src.text, text, 'Extraction must preserve the BOM and line endings');
    assert.equal(src.bytes, bytes.length);
    assert.equal(src.sha256, createHash('sha256').update(bytes).digest('hex'));
    await validateAISources([src]);
    const frozen = await freezeTypedGeneration('request-integrity', 'host-agent', target, content, 'Extract source data', 'block-1', [src], true);
    const workspace = { version: 1, record: { frozen, sessionId: 'session', status: 'completed' as const, transcript: '{"cells":[]}', decisions: {}, application: 'reviewing' as const } };
    assert.deepEqual(await recoveredAIWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
    const changed = structuredClone(workspace); changed.record.frozen.sources[0].sha256 = 'f'.repeat(64);
    await assert.rejects(recoveredAIWorkspace(changed), /SHA-256/);
    for (const delta of [-1, 1]) await assert.rejects(validateAISources([{ ...src, bytes: src.bytes + delta }]), /byte count/);
    if (text.startsWith('\ufeff')) await assert.rejects(validateAISources([{ ...src, text: text.slice(1) }]), /byte count/);
  }
  const original = await readAISourceBytes('source-1', 'source.txt', 'text/plain', new TextEncoder().encode('original'));
  const tampered = { ...original, text: 'tampered' };
  await assert.rejects(validateAISources([tampered]), /SHA-256/);
  await assert.rejects(freezeTypedGeneration('request-tampered', 'host-agent', target, content, 'Extract source data', 'block-1', [tampered], true), /SHA-256/);
  const illFormed = { ...original, text: '\ud800', bytes: 3, sha256: createHash('sha256').update(new TextEncoder().encode('\ud800')).digest('hex') };
  await assert.rejects(validateAISources([illFormed]), /SHA-256/);
});
