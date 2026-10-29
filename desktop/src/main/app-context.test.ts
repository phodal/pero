import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppChatContext } from './app-chat-context.ts';
import { AppInputs } from './app-inputs.ts';
import { PreparedAppWrite, parseAppWrite } from './app-write.ts';
import { AppUseTask, type AppSurface } from './app-use-task.ts';
import type { AppUsePorts } from './app-use.ts';
import type { ContextReference } from '../../../protocol/generated/host';
import { parseAppChatLaunch } from '../../../packages/app-sdk/src/app-chat.ts';

const surface: AppSurface = {
  app: 'demo',
  panel: 'main',
  surfaceId: 'demo:main',
  instance: 'frame-1',
  visible: true,
  active: true,
  operable: true,
  rect: { x: 4, y: 5, width: 20, height: 10 },
};

test('App contexts freeze object revisions, selections and screenshot receipts in the selected draft', async () => {
  for (const scenario of [
    'object',
    'stale',
    'foreign draft',
    'capture',
    'changed capture',
    'hidden',
  ] as const) {
    let selected = 'draft',
      revision = 3,
      captures = 0,
      annotations = 0;
    const receipts: unknown[] = [];
    const ports: AppUsePorts = {
      now: () => 1000,
      selectedThread: async () => selected,
      page: async (_scope, request) => {
        if (request.action === 'status') return { ...surface, operable: scenario !== 'hidden' };
        if (request.action === 'semantic')
          return {
            objects: [{ id: 'object', revision, state: { count: 2 }, kind: 'research', label: 'Results' }],
          };
        if (request.action === 'annotation')
          return { rect: surface.rect, revision: scenario === 'changed capture' ? ++annotations : 3 };
        throw new Error('unexpected page request');
      },
      presence: () => {},
      capture: async () => {
        captures++;
        return { png: Buffer.from('frozen pixels'), pixels: Buffer.from([]), width: 20, height: 10 };
      },
      recordEvidence: async (receipt) => {
        receipts.push(receipt);
      },
    };
    const context = new AppChatContext(ports);
    if (scenario === 'foreign draft') selected = 'other';
    const capture = ['capture', 'changed capture', 'hidden'].includes(scenario);
    const freeze = () =>
      context.freeze(
        { app: 'demo', panel: 'main' },
        'draft',
        capture
          ? { capture: true }
          : {
              attachments: [
                {
                  type: 'app-object',
                  objectId: 'object',
                  revision: scenario === 'stale' ? 2 : 3,
                  selection: { cell: 'A' },
                },
              ],
            },
      );
    if (['stale', 'foreign draft', 'changed capture', 'hidden'].includes(scenario)) {
      await assert.rejects(freeze);
      assert.equal(receipts.length, 0, scenario);
      assert.equal(captures, scenario === 'changed capture' ? 1 : 0, scenario);
      continue;
    }
    const refs = await freeze();
    if (capture) {
      assert.equal(refs.length, 2);
      assert.equal(refs[0].kind, 'image');
      const receipt = JSON.parse((refs[1].content as { text: string }).text).evidence;
      assert.deepEqual(JSON.parse(JSON.stringify(receipts)), [receipt]);
      assert.equal(receipt.threadId, 'draft');
      assert.deepEqual(receipt.rect, surface.rect);
      assert.equal(receipt.sha256, createHash('sha256').update('frozen pixels').digest('hex'));
      assert.equal(receipt.instance, 'frame-1');
      assert.equal(receipt.capturedAt, '1970-01-01T00:00:01.000Z');
    } else {
      revision = 4;
      const value = JSON.parse((refs[0].content as { text: string }).text);
      assert.equal(value.revision, 3);
      assert.deepEqual(value.selection, { cell: 'A' });
      assert.equal(refs[0].kind, 'app_object');
    }
  }
  for (const bad of [
    { url: 'https://example.org' },
    { attachments: [{ type: 'app-object', objectId: 'x', revision: 0 }] },
    { capture: 'true' },
    { mode: 'send' },
  ])
    assert.throws(() => parseAppChatLaunch(bad));
});

test('Conversation files resolve only declared file fields into App and task scoped grants', async () => {
  const inputs = new AppInputs();
  const file: ContextReference = {
    id: 'file',
    kind: 'file',
    label: '/private/data/输入.json',
    source: '/private/data/输入.json',
    content: { type: 'text', text: '{"value":1.0}' },
  };
  inputs.retain('thread', [file]);
  const [entry] = inputs.catalog('thread');
  assert.equal(entry.name, '输入.json');
  assert.equal(JSON.stringify(entry).includes('/private'), false);
  const schema = {
    type: 'object',
    properties: { file: { type: 'string', format: 'pero-file-ref' }, label: { type: 'string' } },
    required: ['file', 'label'],
    additionalProperties: false,
  };
  const task = new AppUseTask('task', 'thread', surface, ['semantic.invoke'], false, 100);
  const params = await inputs.resolve(task, schema, { file: entry.ref, label: entry.ref });
  assert.equal(params.label, entry.ref);
  const token = String(params.file).split('/').at(-1)!;
  const grant = inputs.read('demo', token, 101);
  file.content = { type: 'text', text: 'changed' };
  assert.equal(grant.file.data.toString(), '{"value":1.0}');
  assert.equal(grant.taskId, 'task');
  assert.equal(grant.threadId, 'thread');
  assert.throws(() => inputs.read('foreign', token, 101));
  assert.throws(() => inputs.read('demo', token, task.expiresAt));
  for (const value of ['/etc/passwd', 'https://example.org/private', 'sha256:' + '0'.repeat(64)])
    await assert.rejects(inputs.resolve(task, schema, { file: value, label: 'x' }));
  const other = new AppUseTask('other', 'other', surface, ['semantic.invoke'], false, 100);
  await assert.rejects(inputs.resolve(other, schema, { file: entry.ref, label: 'x' }));
  inputs.forget('thread');
  assert.equal(inputs.catalog('thread').length, 0);
  assert.throws(() => inputs.read('demo', token, 101));
});

test('Declared App writes freeze a validated document and the installed route before execution', () => {
  const definition = {
    app: 'demo',
    panel: 'main',
    version: '1',
    name: 'import',
    description: 'Import data',
    path: '/api/import',
    schema: {
      type: 'object',
      properties: { value: { type: 'integer' } },
      required: ['value'],
      additionalProperties: false,
    },
  };
  const document = { value: 1 },
    write = new PreparedAppWrite(definition, document);
  document.value = 2;
  assert.deepEqual(write.document, { value: 1 });
  assert.equal(write.digest, createHash('sha256').update('{"value":1}').digest('hex'));
  assert.doesNotThrow(() => write.requireCurrent({ ...definition }));
  for (const current of [undefined, { ...definition, version: '2' }, { ...definition, path: '/api/other' }])
    assert.throws(() => write.requireCurrent(current));
  for (const bad of [{ value: '1' }, { value: 1, extra: true }, {}])
    assert.throws(() => new PreparedAppWrite(definition, bad));
  for (const bad of [
    { app: 'demo', tool: 'import', document: {}, path: '/api/other' },
    { app: '../demo', tool: 'import', document: {} },
    { app: 'demo', tool: 'import' },
  ])
    assert.throws(() => parseAppWrite(bad));
});
