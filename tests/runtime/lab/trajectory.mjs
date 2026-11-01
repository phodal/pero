import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readTrajectory(directory) {
  const events = [];
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.jsonl'))) {
    const raw = await readFile(resolve(directory, file), 'utf8');
    events.push(...raw.trim().split('\n').filter(Boolean).map(JSON.parse).map(record => record.event).filter(Boolean));
  }
  return events;
}

export function verifyTrajectory(events, trials) {
  const calls = events.filter(e => e.type === 'tool/call');
  const results = new Map(events.filter(e => e.type === 'tool/result').map(e => [e.data.toolCallId, e]));
  const succeeded = call => results.has(call.data.callId) && !results.get(call.data.callId).data.isError;
  const document = call => call.data.name === 'mcp__pero-app-use__app_write' ? call.data.arguments.document : call.data.arguments;
  const lab = calls.filter(call => call.data.name.startsWith('mcp__pero-app-use__app__lab__') ||
    call.data.name === 'mcp__pero-app-use__app_write' && call.data.arguments.app === 'lab');
  const proposals = lab.filter(call => document(call).action === 'propose' && succeeded(call));
  assert.equal(proposals.length, 2, 'Two successful model tool proposals required');
  for (const [index, call] of proposals.entries()) {
    assert.deepEqual(document(call).protocol, trials[index].protocol, 'Model protocol must match persisted protocol');
    if (index) assert.equal(document(call).parentTrialId, trials[0].id);
  }
  const feedback = lab.find(call => document(call).action === 'evaluate' && document(call).trialId === trials[0].id && succeeded(call));
  assert(feedback && results.get(feedback.data.callId).seq < proposals[1].seq, 'Model must receive first evaluation before revising');
  assert(!calls.some(call => /(?:^|__)(?:shell|computer_use|spawn_agent|fork_agent|write_file|read_file)$/.test(call.data.name)));
  assert(!lab.some(call => document(call).action === 'review'));
  return { modelProposalsMatchExport: true, feedbackBeforeRevision: true, calls: calls.length };
}
