import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadContentResult, cancelContentResult } from './content-results.ts';
import type { ContentChunk } from '../../packages/content-source/index.ts';
import type { HostEvent } from './bootstrap.ts';

const command = {
  action: 'read_result' as const,
  thread_id: 'chat',
  tool_call_id: 'tool',
  artifact_id: 'a'.repeat(64),
  request_id: 'read-1',
};
const chunk = (
  text: string,
  nextRead: ContentChunk['nextRead'] = null,
): ContentChunk => ({
  artifact: {
    id: command.artifact_id,
    bytes: 32,
    mediaType: 'application/json',
  },
  startByte: 0,
  endByte: 16,
  selectionEndByte: 32,
  text,
  truncated: !!nextRead,
  nextRead,
});
test('UI result loading joins exact source and reports file errors', async () => {
  const events: HostEvent[] = [];
  const source = [
    '[{"id":9007199254740993,',
    '"amount":1.0000000000000000001}]',
  ];
  await loadContentResult(
    command,
    async (request) =>
      request.startByte
        ? chunk(source[1])
        : chunk(source[0], {
            id: command.artifact_id,
            startByte: 16,
            endByte: 32,
            maxBytes: 16,
          }),
    (event) => events.push(event),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].text, source.join(''));
  assert.deepEqual(events[0].data, {
    tool_call_id: 'tool',
    artifact_id: command.artifact_id,
    status: 'ready',
  });
  await loadContentResult(
    command,
    async () => {
      throw new Error('Missing result file');
    },
    (event) => events.push(event),
  );
  assert.equal(events[1].text, 'Missing result file');
  assert.equal((events[1].data as { status: string }).status, 'error');
});
test('canceled UI reads discard the pending completion', async () => {
  let resolve!: (value: ContentChunk) => void;
  const pending = new Promise<ContentChunk>((done) => {
    resolve = done;
  });
  const events: HostEvent[] = [];
  const work = loadContentResult(
    command,
    () => pending,
    (event) => events.push(event),
  );
  cancelContentResult(command.request_id);
  resolve(chunk('[]'));
  await work;
  assert.deepEqual(events, []);
});
