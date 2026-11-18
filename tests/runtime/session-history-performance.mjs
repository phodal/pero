// Compare Host readiness and conversation restore using the same disposable profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [baseline, candidate] = process.argv.slice(2).map(path => resolve(path));
assert(baseline && candidate, 'Usage: node tests/runtime/session-history-performance.mjs BASELINE_HOST CANDIDATE_HOST');
const profile = await mkdtemp(join(tmpdir(), 'pero-history-performance-'));
const history = join(profile, 'sessions.jsonl');

function fixture(count) {
  const events = Array.from({ length: count }, (_, index) => {
    const thread_id = `conversation-${Math.floor(index / 100)}`;
    const event = { version: 1, thread_id, request_id: null, text: '', data: {} };
    if (index % 100 === 0) return { ...event, kind: 'session_created', data: { agent: 'fixture', workspace: profile } };
    if (index % 2 === 1) return { ...event, kind: 'user_message', text: `Question ${index}` };
    return { ...event, kind: 'session_update', data: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Observed evidence for ${index}. `.repeat(4) },
    } };
  });
  return { journal: events.map(event => JSON.stringify(event)).join('\n') + '\n',
    threadId: events.at(-1).thread_id };
}

async function measure(binary, catalog, threadId) {
  const start = performance.now();
  const host = spawn(binary, ['--stdio'], {
    cwd: profile, stdio: ['pipe', 'pipe', 'inherit'], timeout: 60_000,
    env: { PATH: process.env.PATH, PERO_APPS_ROOT: join(profile, 'apps'), PERO_HISTORY_PATH: history,
      PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_AGENTS_FILE: join(profile, 'agents.json'),
      PERO_ENV_FILE: join(profile, 'no-env') },
  });
  const closed = once(host, 'close');
  const lines = createInterface({ input: host.stdout })[Symbol.asyncIterator]();
  const next = async kind => {
    for (let line = await lines.next(); !line.done; line = await lines.next()) {
      const event = JSON.parse(line.value);
      if (event.kind === kind) return { event, bytes: Buffer.byteLength(line.value) + 1 };
    }
    throw new Error(`${binary} exited before sending ${kind}`);
  };
  const send = value => host.stdin.write(JSON.stringify(value) + '\n');
  try {
    await next('ready');
    const hostReadyMs = performance.now() - start;
    const requestedAt = performance.now();
    send({ action: 'list_agents', ...(catalog ? { history: 'catalog' } : {}) });
    const replay = await next('replay');
    const replayMs = performance.now() - requestedAt;
    let selected = replay.event.data.events.filter(event => event.thread_id === threadId);
    let bodyBytes = 0;
    if (catalog) {
      assert(replay.event.data.catalog.some(thread => thread.thread_id === threadId && thread.has_messages));
      assert.equal(selected.length, 1, 'the first response should contain the origin only');
      send({ action: 'load_thread_history', thread_id: threadId, request_id: 'selected-history' });
      const body = await next('thread_history');
      assert.equal(body.event.request_id, 'selected-history');
      selected = body.event.data.events;
      bodyBytes = body.bytes;
    }
    const selectedMs = performance.now() - requestedAt;
    assert.equal(selected.length, 100);
    return { selected, hostReadyMs, replayMs, selectedMs, replayBytes: replay.bytes, bodyBytes };
  } finally {
    host.stdin.end();
    const [code, signal] = await closed;
    assert.equal(code, 0, `Host exit: ${signal || code}`);
  }
}

function summarize(samples) {
  const median = key => Number(samples.map(sample => sample[key]).sort((left, right) => left - right)[1].toFixed(2));
  const [{ replayBytes, bodyBytes }] = samples;
  return { hostReadyMs: median('hostReadyMs'), replayMs: median('replayMs'),
    selectedMs: median('selectedMs'), replayBytes, bodyBytes };
}

try {
  await writeFile(join(profile, 'agents.json'), '[]');
  for (const size of [1_000, 10_000, 100_000]) {
    const { journal, threadId } = fixture(size);
    await writeFile(history, journal);
    const samples = [[], []];
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const mode of repeat === 1 ? [1, 0] : [0, 1]) {
        samples[mode].push(await measure(mode ? candidate : baseline, Boolean(mode), threadId));
      }
    }
    assert.deepEqual(samples[1][0].selected, samples[0][0].selected);
    console.log(JSON.stringify({ events: size, journalBytes: Buffer.byteLength(journal),
      samplesPerBinary: 3, legacy: summarize(samples[0]), catalog: summarize(samples[1]) }));
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
