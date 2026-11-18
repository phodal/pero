// Run with the baseline and candidate Host binaries from the same build profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [baselinePath, candidatePath] = process.argv.slice(2);
assert(baselinePath && candidatePath, 'Usage: node tests/runtime/project-snapshot.mjs BASELINE_HOST CANDIDATE_HOST');
const profileEvents = 100_000;
const projectThreads = 50;
const projectTurns = 20;
const sampleCount = 25;
const warmups = 3;
const projectId = 'snapshot-fixture';
const workspace = await mkdtemp(join(tmpdir(), 'pero-project-snapshot-'));
const settings = join(workspace, 'settings.json');
const history = join(workspace, 'sessions.jsonl');
const agents = join(workspace, 'agents.json');

function fixture() {
  const events = [];
  const record = (thread_id, kind, data = {}) => {
    events.push(JSON.stringify({ version: 1, request_id: null, text: '', thread_id, kind, data }));
  };
  const threadIds = Array.from({ length: projectThreads }, (_, index) => `project-thread-${index}`);
  for (const [index, thread] of threadIds.entries()) {
    record(thread, 'session_created', { agent: 'fixture', workspace,
      projectAgent: { project_id: projectId, parent_thread: index === 0 ? null : threadIds[0], label: thread } });
  }
  for (let turn = 0; turn < projectTurns; turn++) {
    for (const thread of threadIds) {
      const toolCallId = `${thread}-tool-${turn}`;
      record(thread, 'user_message');
      record(thread, 'turn_started');
      record(thread, 'session_update', { sessionUpdate: 'tool_call', toolCallId, title: 'Check fixture', status: 'in_progress' });
      record(thread, 'session_update', { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: `Evidence from ${toolCallId}` });
      record(thread, 'session_update', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Turn ${turn} completed on ${thread}` } });
      record(thread, 'turn_finished', { stopReason: 'end_turn' });
    }
  }
  const projectEvents = events.length;
  while (events.length < profileEvents) {
    const index = events.length - projectEvents;
    const thread = `unrelated-${Math.floor(index / 100)}`;
    if (index % 100 === 0) record(thread, 'session_created', { agent: 'fixture', workspace });
    else record(thread, 'session_update', { sessionUpdate: 'tool_call_update', toolCallId: `tool-${index}`, rawOutput: 'Ordinary conversation output' });
  }
  return { journal: events.join('\n') + '\n', projectEvents, threadIds };
}

async function measure(path) {
  const host = spawn(resolve(path), ['--stdio'], {
    cwd: workspace, stdio: ['pipe', 'pipe', 'inherit'], timeout: 60_000,
    env: { PATH: process.env.PATH, PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: history,
      PERO_AGENTS_FILE: agents, PERO_ENV_FILE: join(workspace, 'no-env'), PERO_APPS_ROOT: join(workspace, 'apps') },
  });
  const closed = once(host, 'close');
  const lines = createInterface({ input: host.stdout })[Symbol.asyncIterator]();
  const next = async predicate => {
    for (let line = await lines.next(); !line.done; line = await lines.next()) {
      const event = JSON.parse(line.value);
      if (predicate(event)) return event;
    }
    throw new Error(`Host stopped before it sent the expected event: ${path}`);
  };
  const samples = [];
  let snapshot;
  try {
    await next(event => event.kind === 'ready');
    for (let i = 0; i < warmups + sampleCount; i++) {
      const request_id = `snapshot-${i}`;
      const at = performance.now();
      host.stdin.write(JSON.stringify({ method: 'project_agent', action: 'snapshot', request_id, project_id: projectId }) + '\n');
      const event = await next(event => event.request_id === request_id);
      const elapsed = performance.now() - at;
      assert.equal(event.kind, 'project_agent', event.text);
      snapshot ??= event.data;
      assert.deepEqual(event.data, snapshot);
      if (i >= warmups) samples.push(elapsed);
    }
  } finally {
    host.stdin.end();
    const [code, signal] = await closed;
    assert.equal(code, 0, `Host exit: ${signal || code}`);
  }
  samples.sort((a, b) => a - b);
  const percentile = p => Number(samples[Math.ceil(samples.length * p) - 1].toFixed(2));
  return { snapshot, timing: { p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1) } };
}

try {
  const { journal, projectEvents, threadIds } = fixture();
  await Promise.all([
    writeFile(settings, JSON.stringify({ workbench: { research_projects: [{
      id: projectId, title: 'Project snapshot fixture', goal: '', workspace, resources: [],
    }] } })),
    writeFile(history, journal),
    writeFile(agents, '[]'),
  ]);
  const baseline = await measure(baselinePath);
  const candidate = await measure(candidatePath);
  assert.deepEqual(candidate.snapshot, baseline.snapshot);
  assert.deepEqual(candidate.snapshot.sessions.map(session => session.thread_id), threadIds);
  for (const session of candidate.snapshot.sessions) {
    assert.equal(session.status, 'completed');
    assert.equal(session.result, `Turn ${projectTurns - 1} completed on ${session.thread_id}`);
    assert.equal(session.evidence[0]?.tool_call_id, `${session.thread_id}-tool-${projectTurns - 1}`);
  }
  console.log(JSON.stringify({
    profileEvents, projectEvents, projectThreads, sampleCount, warmups,
    journalBytes: Buffer.byteLength(journal), snapshotBytes: Buffer.byteLength(JSON.stringify(candidate.snapshot)),
    baseline: baseline.timing, candidate: candidate.timing,
  }, null, 2));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
