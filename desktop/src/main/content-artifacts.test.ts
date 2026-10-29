import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ContentRead, JsonSource } from '../../../packages/content-source/index.ts';
import { ContentArtifacts } from './content-artifacts.ts';
import { DesktopAppUse } from './app-use-mcp.ts';

test('source pointers preserve numeric spelling, Unicode, escaped keys and exact scope', () => {
  const source = JsonSource.stored(
    '{"n":9007199254740993,"a/b~c":["中文😀",1.0000000000000000001,null,"null",""]}',
  );
  for (const [pointer, expected] of [
    ['/n', '9007199254740993'],
    ['/a~1b~0c/0', '"中文😀"'],
    ['/a~1b~0c/1', '1.0000000000000000001'],
    ['/a~1b~0c/2', 'null'],
    ['/a~1b~0c/3', '"null"'],
    ['/a~1b~0c/4', '""'],
  ]) {
    const { start, end } = source.pointer(pointer);
    assert.equal(
      Buffer.from(source.text).subarray(start, end).toString(),
      expected,
    );
  }
  for (const pointer of ['/missing', '/a~2', 'n', '/a~1b~0c/01'])
    assert.throws(() => source.pointer(pointer));
});

test('large output is file backed, resumable and bound to its conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-content-files-'));
  try {
    const artifacts = new ContentArtifacts(root);
    const value = {
      status: 'complete',
      rows: Array.from({ length: 8000 }, (_, i) => ({
        id: String(9007199254740993n + BigInt(i)),
        value: '中文😀'.repeat(8),
      })),
    };
    const original = JSON.stringify(value);
    const result = JSON.parse(await artifacts.select('thread-1', value));
    assert.equal(result.type, 'content_reference');
    assert.equal(
      result.artifact.sha256,
      createHash('sha256').update(original).digest('hex'),
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(result)) <
        Buffer.byteLength(original) * 0.01,
    );
    const node = await artifacts.read(
      'thread-1',
      ContentRead.parse({ id: result.artifact.id, pointer: '/rows/7999/id' }),
    );
    assert.equal(node.text, '"9007199254748992"');
    let request = ContentRead.parse({
      id: result.artifact.id,
      maxBytes: 16384,
    });
    let restored = '';
    for (;;) {
      const part = await artifacts.read('thread-1', request);
      assert.ok(Buffer.byteLength(part.text) <= 16384);
      assert.ok(!part.text.includes('�'));
      restored += part.text;
      if (!part.nextRead) break;
      assert.ok(part.nextRead.startByte > part.startByte);
      request = ContentRead.parse(part.nextRead);
    }
    assert.equal(restored, original);
    await assert.rejects(
      artifacts.read('thread-2', ContentRead.parse({ id: result.artifact.id })),
      /ENOENT/,
    );
    assert.equal(
      await artifacts.select('thread-1', { ok: true }),
      '{"ok":true}',
    );
    await artifacts.forget('thread-1');
    await assert.rejects(artifacts.read('thread-1', request), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real loopback MCP exposes bounded artifact reads without replaying App operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-content-mcp-'));
  const service = new DesktopAppUse(
    () => {
      throw new Error('No App operation should run');
    },
    () => {},
    root,
  );
  try {
    const config = await service.start();
    const reference = JSON.parse(
      await service.results.select('thread-a', {
        rows: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          value: 'result',
        })),
      }),
    );
    let id = 0;
    const call = async (
      method: string,
      params: unknown = undefined,
      thread = 'thread-a',
    ) =>
      (
        await (
          await fetch(config.PERO_APP_USE_URL, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.PERO_APP_USE_TOKEN}`,
              'content-type': 'application/json',
              'x-pero-thread': thread,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          })
        ).json()
      ).result;
    assert.ok(
      (await call('tools/list')).tools.some(
        (t: { name: string }) => t.name === 'content_read',
      ),
    );
    const result = await call('tools/call', {
      name: 'content_read',
      arguments: { id: reference.artifact.id, pointer: '/rows/9999' },
    });
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes('{"id":9999,"value":"result"}'));
    assert.ok(Buffer.byteLength(result.content[0].text) < 1000);
    assert.equal(
      (
        await call(
          'tools/call',
          { name: 'content_read', arguments: { id: reference.artifact.id } },
          'thread-b',
        )
      ).isError,
      true,
    );
    assert.equal(
      (
        await call('tools/call', {
          name: 'content_read',
          arguments: { id: '../escape' },
        })
      ).isError,
      true,
    );
  } finally {
    service.close();
    await rm(root, { recursive: true, force: true });
  }
});
