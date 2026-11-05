import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppUseTask,
  AppUseError,
  parseAppUseRequest,
  type AppSurface,
  type AppUseAction,
} from './app-use-task.ts';
import { AppUse } from './app-use.ts';

const surface: AppSurface = {
  app: 'demo',
  panel: 'main',
  surfaceId: 'demo:main',
  instance: 'instance-1',
  visible: true,
  active: true,
  operable: true,
  rect: { x: 0, y: 0, width: 10, height: 10 },
};
test('App Use grants bind action, session, instance, visibility and bounded expiry', () => {
  const cases: {
    name: string;
    actions: AppUseAction[];
    standing?: boolean;
    thread?: string;
    changes?: Partial<AppSurface>;
    action: AppUseAction;
    now: number;
    grant?: boolean;
    code?: string;
  }[] = [
    {
      name: 'observe hidden',
      actions: ['observe'],
      changes: { operable: false },
      action: 'observe',
      now: 100,
    },
    {
      name: 'capture requires visible',
      actions: ['capture'],
      changes: { operable: false },
      action: 'capture',
      now: 100,
      code: 'APP_SURFACE_HIDDEN',
    },
    {
      name: 'operation not granted',
      actions: ['observe'],
      action: 'dom.click',
      now: 100,
      code: 'APP_ACTION_DENIED',
    },
    {
      name: 'foreign thread',
      actions: ['observe'],
      thread: 'other',
      action: 'observe',
      now: 100,
      code: 'APP_TASK_ENDED',
    },
    {
      name: 'replaced frame',
      actions: ['observe'],
      changes: { instance: 'new' },
      action: 'observe',
      now: 100,
      code: 'APP_SURFACE_REPLACED',
    },
    { name: 'expired task', actions: ['observe'], action: 'observe', now: 300001, code: 'APP_TASK_EXPIRED' },
    {
      name: 'standing renewal',
      actions: ['observe'],
      standing: true,
      grant: true,
      action: 'observe',
      now: 300001,
    },
    {
      name: 'revoked standing never renews',
      actions: ['observe'],
      standing: true,
      action: 'observe',
      now: 300001,
      code: 'APP_TASK_EXPIRED',
    },
  ];
  for (const c of cases) {
    const task = new AppUseTask(c.name, 'thread', surface, c.actions, !!c.standing, 0);
    const run = () =>
      task.authorize(c.thread || 'thread', { ...surface, ...c.changes }, c.action, c.now, !!c.grant);
    if (c.code) assert.throws(run, (error) => error instanceof AppUseError && error.code === c.code, c.name);
    else {
      assert.doesNotThrow(run, c.name);
      if (c.standing) assert.equal(task.expiresAt, c.now + 300000);
    }
  }
  assert.throws(
    () => new AppUseTask('write', 'thread', surface, ['semantic.invoke'], true, 0),
    /reading only/,
  );
  assert.throws(() => parseAppUseRequest({ action: 'start', approval: true }), /Unknown/);
});

test('App Use separates action effects from verification and ends plans without retrying', async () => {
  let state = { view: 'cells' },
    revision = 1,
    effects = 0,
    now = 1;
  let selected: string | undefined = 'thread';
  const presence: unknown[] = [];
  let delayedRead: Promise<unknown> | undefined;
  let notifyRead: (() => void) | undefined;
  const use = new AppUse({
    now: () => now,
    selectedThread: async () => selected,
    page: async (_scope, request) => {
      if (request.action === 'status' || request.action === 'geometry') return surface;
      if (request.action === 'inventory') return { surfaces: [surface] };
      if (request.action === 'observe' && delayedRead) {
        notifyRead?.();
        return delayedRead;
      }
      if (request.action === 'observe')
        return {
          objects: [{ id: 'app', revision, state }],
          revisions: { objects: { app: revision }, snapshot: revision },
          text: state.view,
          dom: [],
        };
      if (request.action === 'invoke') {
        effects++;
        state = { view: 'mechanism' };
        revision++;
        return { verdict: 'not-run' };
      }
      if (request.action === 'verify') return { verdict: state.view === request.equals ? 'pass' : 'fail' };
      throw new Error('unexpected page operation');
    },
    presence: (_thread, data) => presence.push(data),
    capture: async () => ({
      png: Buffer.from('png'),
      pixels: Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]),
      width: 2,
      height: 1,
    }),
  });
  use.accept({
    kind: 'session_created',
    thread_id: 'thread',
    data: { scope: { app: 'demo', panel: 'main' } },
  });
  use.accept({ kind: 'turn_started', thread_id: 'thread' });
  const start = (await use.call('thread', {
    action: 'start',
    surfaceId: surface.surfaceId,
    actions: ['semantic.invoke', 'verify'],
  })) as { taskId: string };
  const action = (await use.call('thread', {
    action: 'act',
    taskId: start.taskId,
    command: 'semantic.invoke',
    target: 'app',
    name: 'select',
    expectedRevisions: { objects: { app: 1 } },
  })) as { verdict: string };
  assert.equal(action.verdict, 'not-run');
  assert.equal(effects, 1);
  assert.deepEqual(
    await use.call('thread', {
      action: 'wait',
      taskId: start.taskId,
      until: { target: 'app', key: 'view', equals: 'mechanism' },
    }),
    {
      matched: true,
      snapshot: {
        objects: [{ id: 'app', revision: 2, state }],
        revisions: { objects: { app: 2 }, snapshot: 2 },
        text: 'mechanism',
        dom: [],
      },
    },
  );
  assert.deepEqual(
    await use.call('thread', {
      action: 'verify',
      taskId: start.taskId,
      check: { kind: 'semantic.equals', target: 'app', key: 'view', value: 'mechanism' },
    }),
    { verdict: 'pass' },
  );
  const plan = (await use.call('thread', {
    action: 'runPlan',
    taskId: start.taskId,
    steps: [
      { id: 'seen', request: { action: 'observe' } },
      {
        id: 'failed',
        request: {
          action: 'verify',
          check: { kind: 'semantic.equals', target: 'app', key: 'view', value: 'volume' },
        },
      },
      {
        id: 'skipped',
        request: {
          action: 'act',
          command: 'semantic.invoke',
          target: 'app',
          name: 'select',
          expectedRevisions: { $ref: 'seen.revisions' },
        },
      },
    ],
  })) as { state: string; steps: unknown[] };
  assert.equal(plan.state, 'failed');
  assert.equal(plan.steps.length, 2);
  assert.equal(effects, 1);
  await assert.rejects(
    use.call('thread', { action: 'observe', taskId: start.taskId }),
    /Start an App Use task/,
  );
  const standing = (await use.call('thread', {
    action: 'start',
    surfaceId: surface.surfaceId,
    scope: 'session',
    actions: ['observe', 'verify'],
  })) as { taskId: string };
  now = 300002;
  await use.call('thread', { action: 'observe', taskId: standing.taskId });
  assert.equal((presence.at(-1) as { tasks: { expiresAt: number }[] }).tasks[0].expiresAt, now + 300000);
  use.revoke('thread');
  await assert.rejects(
    use.call('thread', { action: 'observe', taskId: standing.taskId }),
    /Start an App Use task/,
  );
  selected = 'other';
  await assert.rejects(use.call('thread', { action: 'inventory' }), /selected in Chat/);
  assert.ok(presence.length);
  // Reload restores session association from Host history, never its grants.
  selected = 'thread';
  use.reset(true);
  use.accept({
    kind: 'replay',
    data: {
      active: ['thread'],
      events: [
        { kind: 'session_created', thread_id: 'thread', data: { scope: { app: 'demo', panel: 'main' } } },
        { kind: 'turn_started', thread_id: 'thread' },
      ],
    },
  });
  assert.equal(
    ((await use.call('thread', { action: 'inventory' })) as { surfaces: unknown[] }).surfaces.length,
    1,
  );
  const timed = (await use.call('thread', {
    action: 'start',
    surfaceId: surface.surfaceId,
    actions: ['observe'],
  })) as { taskId: string };
  let timer: ReturnType<typeof setTimeout>;
  delayedRead = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ objects: [] }), 100);
  });
  try {
    const result = (await use.call('thread', {
      action: 'runPlan',
      taskId: timed.taskId,
      timeoutMs: 10,
      steps: [{ id: 'slow', request: { action: 'observe' } }],
    })) as { state: string };
    assert.equal(result.state, 'failed');
  } finally {
    clearTimeout(timer!);
    delayedRead = undefined;
  }
  const cancellable = (await use.call('thread', {
    action: 'start',
    surfaceId: surface.surfaceId,
    actions: ['observe'],
  })) as { taskId: string };
  const entered = new Promise<void>((resolve) => {
    notifyRead = resolve;
  });
  delayedRead = new Promise(() => {});
  const read = use.call('thread', { action: 'observe', taskId: cancellable.taskId });
  await entered;
  use.command({ action: 'cancel', thread_id: 'thread' });
  await assert.rejects(read, /stopped waiting/);
});

test('MCP transport works with the official client and preserves App image metadata', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { DesktopAppUse } = await import('./app-use-mcp.ts');
  const { runInNewContext } = await import('node:vm');
  const { tmpdir } = await import('node:os');
  const {mkdtemp,rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const evidenceRoot = await mkdtemp(join(tmpdir(),'pero-mcp-output-'));
  const state: {image:{uri:string};rows?:{id:number;value:string}[]} = { image: { uri: 'app-owned-image-metadata' } };
  const browser = {
    peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: 'thread' }], activeChat: 0 }) },
    peroAppUse: async ({ request }: { request: { action: string } }) => ({
      ok: true,
      value:
        request.action === 'inventory'
          ? { surfaces: [surface] }
          : request.action === 'status'
            ? surface
            : {
                objects: [{ id: 'app', revision: 1, state }],
                revisions: { objects: { app: 1 }, snapshot: 1 },
              },
    }),
  };
  const window = {
    webContents: {
      mainFrame: { frames: [] },
      executeJavaScript: (expression: string) => runInNewContext(expression, { window: browser }),
    },
  };
  const desktop = new DesktopAppUse(
    () => window as never,
    () => {},
    evidenceRoot,
  );
  const env = await desktop.start();
  desktop.accept({
    kind: 'session_created',
    thread_id: 'thread',
    data: { scope: { app: 'demo', panel: 'main' } },
  });
  desktop.accept({ kind: 'turn_started', thread_id: 'thread' });
  const client = new Client({ name: 'app-use-contract', version: '1.0.0' });
  try {
    assert.equal((await fetch(env.PERO_APP_USE_URL, { method: 'POST', body: '{}' })).status, 403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(env.PERO_APP_USE_URL), {
        requestInit: {
          headers: { Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': 'thread' },
        },
      }),
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['app_use', 'content_read'],
    );
    const started = await client.callTool({
      name: 'app_use',
      arguments: { action: 'start', surfaceId: surface.surfaceId, actions: ['observe'] },
    });
    const taskId = JSON.parse((started.content as { text: string }[])[0].text).taskId;
    const observed = await client.callTool({ name: 'app_use', arguments: { action: 'observe', taskId } });
    assert.equal(observed.isError, false);
    const content = observed.content as { type: string; text: string }[];
    assert.equal(content.length, 1);
    assert.equal(content[0].type, 'text');
    assert.deepEqual(JSON.parse(content[0].text).objects[0].state, state);
    state.rows=Array.from({length:8000},(_,id)=>({id,value:'structured data'.repeat(8)}));
    const large=await client.callTool({name:'app_use',arguments:{action:'observe',taskId}});
    const reference=JSON.parse((large.content as {text:string}[])[0].text);
    assert.equal(reference.type,'content_reference');
    assert.ok(reference.artifact.bytes>1_000_000);
    assert.ok(Buffer.byteLength((large.content as {text:string}[])[0].text)<2048);
    const selected=await client.callTool({name:'content_read',arguments:{id:reference.artifact.id,pointer:'/objects/0/state/rows/7999/id'}});
    assert.equal(selected.isError,false);
    assert.match((selected.content as {text:string}[])[0].text,/\n7999\n/);

  } finally {
    await client.close();
    desktop.close();
    await rm(evidenceRoot,{recursive:true,force:true});
  }
});

test('App tasks span turns, scoped revocation preserves another App, and selection ends tasks immediately', async () => {
  let now = 100;
  const other = { ...surface, app: 'other', surfaceId: 'other:main' };
  const use = new AppUse({
    now: () => now,
    selectedThread: async () => 'thread',
    page: async (scope, request) =>
      request.action === 'inventory'
        ? { surfaces: [surface, other] }
        : request.action === 'status'
          ? scope?.app === 'other'
            ? other
            : surface
          : { objects: [] },
    presence: () => {},
    capture: async () => {
      throw new Error('not captured');
    },
  });
  use.accept({ kind: 'session_created', thread_id: 'thread' });
  use.accept({ kind: 'turn_started', thread_id: 'thread' });
  use.select('thread');
  const start = async (surfaceId: string) =>
    (await use.call('thread', { action: 'start', surfaceId, actions: ['observe'], scope: 'session' })) as {
      taskId: string;
    };
  const a = await start(surface.surfaceId),
    b = await start(other.surfaceId);
  use.accept({ kind: 'turn_finished', thread_id: 'thread' });
  use.accept({ kind: 'turn_started', thread_id: 'thread' });
  await use.call('thread', { action: 'observe', taskId: a.taskId });
  use.revoke('thread', { app: 'demo', panel: 'main' });
  await assert.rejects(use.call('thread', { action: 'observe', taskId: a.taskId }), /Start an App Use task/);
  await use.call('thread', { action: 'observe', taskId: b.taskId });
  const inventory = (await use.call('thread', { action: 'inventory' })) as { standing: { app: string }[] };
  assert.deepEqual(
    inventory.standing.map((s) => s.app),
    ['other'],
  );
  use.select('different');
  use.select('thread');
  await assert.rejects(use.call('thread', { action: 'observe', taskId: b.taskId }), /Start an App Use task/);
  const c = await start(other.surfaceId);
  now += 300001;
  await use.call('thread', { action: 'observe', taskId: c.taskId });
  use.command({ action: 'cancel', thread_id: 'thread' });
  use.accept({ kind: 'turn_started', thread_id: 'thread' });
  await assert.rejects(use.call('thread', { action: 'observe', taskId: c.taskId }), /Start an App Use task/);
});

test('MCP writes use Agent approval and still reject invalid or foreign documents', async () => {
  const { DesktopAppUse } = await import('./app-use-mcp.ts');
  const { runInNewContext } = await import('node:vm');
  const { tmpdir } = await import('node:os');
  let effects = 0;
  let selected = 'thread';
  const events: { kind: string }[] = [];
  const definition = {
    app: 'demo',
    panel: 'main',
    version: '1',
    name: 'import',
    description: 'Import',
    path: '/api/import',
    schema: {
      type: 'object',
      properties: { value: { type: 'integer' } },
      required: ['value'],
      additionalProperties: false,
    },
  };
  const window = {
    webContents: {
      mainFrame: { frames: [] },
      executeJavaScript: (expression: string) =>
        runInNewContext(expression, { window: { peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: selected }], activeChat: 0 }) } } }),
    },
  };
  const desktop = new DesktopAppUse(
    () => window as never,
    (event) => events.push(event),
    tmpdir(),
    {
      describe: async () => [definition, { ...definition, app: 'other' }, { ...definition, name: 'secondary', panel: 'secondary' }],
      apply: async (prepared) => {
        effects++;
        return prepared.document;
      },
    },
  );
  const env = await desktop.start();
  desktop.accept({
    kind: 'session_created',
    thread_id: 'thread',
    data: { scope: { app: 'demo', panel: 'main' } },
  });
  desktop.accept({ kind: 'turn_started', thread_id: 'thread' });
  const tool = async (name: string, args: object, thread = 'thread') => {
    const r = await fetch(env.PERO_APP_USE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': thread },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    return (await r.json()).result;
  };
  try {
    const described = await tool('app_describe', {});
    assert.equal(JSON.parse(described.content[0].text).apps[0].tool, 'import');
    for (const value of [1, 2]) {
      const result = value===1 ? await tool('app__demo__import', {value}) : await tool('app_write', { app: 'demo', tool: 'import', document: { value } });
      assert.equal(result.isError, false);
      assert.deepEqual(JSON.parse(result.content[0].text).result, { value });
    }
    assert.equal(effects, 2);
    const invalid = await tool('app__demo__import', {});
    assert.equal(invalid.isError, true);
    assert.equal(effects, 2);
    const foreign = await tool('app_write', { app: 'other', tool: 'import', document: { value: 1 } });
    assert.equal(foreign.isError, true);
    assert.equal(effects, 2);
    // Only Host App bindings grant background access. A normal scoped Chat
    // and a mismatched binding still require the selected conversation.
    for (const [thread, appBinding] of [
      ['app-owned', { app: 'demo' }],
      ['scope-only', undefined],
      ['binding-mismatch', { app: 'other' }],
    ] as const) {
      desktop.accept({ kind: 'session_created', thread_id: thread, data: {
        scope: { app: 'demo', panel: 'main' }, ...(appBinding ? { appBinding } : {}),
      } });
      desktop.accept({ kind: 'turn_started', thread_id: thread });
      const result = await tool('app_describe', {}, thread);
      assert.equal(result.isError, thread !== 'app-owned', thread);
      if (thread === 'app-owned') {
        assert.deepEqual(JSON.parse(result.content[0].text).apps.map((app: { app: string }) => app.app), ['demo']);
      } else assert.match(result.content[0].text, /APP_SESSION_INACTIVE/);
    }
    selected = 'unrelated';
    const background = await tool('app_write', { app: 'demo', tool: 'import', document: { value: 3 } }, 'app-owned');
    assert.equal(background.isError, false);
    assert.deepEqual(JSON.parse(background.content[0].text).result, { value: 3 });
    const foreignBackground = await tool('app_write', { app: 'other', tool: 'import', document: { value: 4 } }, 'app-owned');
    assert.match(foreignBackground.content[0].text, /APP_SCOPE_FOREIGN/);
    const foreignPanel = await tool('app_write', { app: 'demo', tool: 'secondary', document: { value: 4 } }, 'app-owned');
    assert.match(foreignPanel.content[0].text, /APP_SCOPE_FOREIGN/);
    const backgroundUi = await tool('app_use', { action: 'inventory' }, 'app-owned');
    assert.match(backgroundUi.content[0].text, /APP_SESSION_INACTIVE/);
    const ordinary = await tool('app_write', { app: 'demo', tool: 'import', document: { value: 5 } });
    assert.match(ordinary.content[0].text, /APP_SESSION_INACTIVE/);
    desktop.accept({ kind: 'turn_finished', thread_id: 'app-owned' });
    const completed = await tool('app_write', { app: 'demo', tool: 'import', document: { value: 6 } }, 'app-owned');
    assert.match(completed.content[0].text, /APP_SESSION_INACTIVE/);
    assert.equal(effects, 3);
    assert.equal(
      events.some((event) => event.kind === 'permission'),
      false,
    );
  } finally {
    desktop.close();
  }
});

test('App-owned data access waits for a running turn and ends with the Host turn', async () => {
  const scope = { app: 'demo', panel: 'main' };
  const use = new AppUse({
    selectedThread: async () => 'unrelated',
    page: async () => { throw new Error('Backend access must not use an App panel'); },
    presence: () => {},
    capture: async () => { throw new Error('Backend access must not capture'); },
  });
  const create = (thread: string) => use.accept({
    kind: 'session_created', thread_id: thread, data: { scope, appBinding: { app: 'demo' } },
  });
  const signal = new AbortController().signal;
  let effects = 0;
  create('starting');
  const waiting = use.access('starting', scope, async () => ++effects, signal, 'app-data');
  assert.equal(effects, 0);
  use.accept({ kind: 'turn_started', thread_id: 'starting' });
  assert.equal(await waiting, 1);
  await assert.rejects(use.access('starting', scope, async () => ++effects, signal), { code: 'APP_SESSION_INACTIVE' });
  await assert.rejects(use.access('starting', { ...scope, panel: 'foreign' }, async () => ++effects, signal, 'app-data'), /scoped to another App/);

  create('cancel-before-start');
  const cancelled = use.access('cancel-before-start', scope, async () => ++effects, signal, 'app-data');
  use.command({ action: 'cancel', thread_id: 'cancel-before-start' });
  await assert.rejects(cancelled, /did not start/);
  assert.equal(effects, 1);

  for (const ending of ['selection', 'turn_finished', 'cancel', 'session_closed', 'disconnected'] as const) {
    const thread = `app-${ending}`;
    create(thread);
    use.accept({ kind: 'turn_started', thread_id: thread });
    let enter!: () => void, release!: () => void, operationSignal!: AbortSignal;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const pending = use.access(thread, scope, async (_scope, bounded) => {
      operationSignal = bounded;
      enter();
      await released;
      bounded.throwIfAborted();
      return ++effects;
    }, signal, 'app-data');
    await entered;
    if (ending === 'selection') {
      use.select('another-chat');
      assert.equal(operationSignal.aborted, false);
      release();
      assert.equal(await pending, 2);
    } else {
      if (ending === 'cancel') use.command({ action: 'cancel', thread_id: thread });
      else use.accept({ kind: ending, thread_id: thread });
      await assert.rejects(pending, /stopped waiting/);
      assert.equal(operationSignal.aborted, true);
      release();
      await assert.rejects(use.access(thread, scope, async () => ++effects, signal, 'app-data'), { code: 'APP_SESSION_INACTIVE' });
      assert.equal(effects, 2);
    }
  }
});

test('Product context reads the current trusted Chat frame without a timed parent query or replay', async t => {
  const { DesktopAppUse } = await import('./app-use-mcp.ts');
  const { runInNewContext } = await import('node:vm');
  const { tmpdir } = await import('node:os');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const scenario of ['delayed', 'switched', 'missing', 'foreign', 'nested', 'duplicate', 'navigated', 'unready', 'destroyed'] as const) {
    let selected = 'draft', pageCalls = 0, reads = 0, parentQueries = 0;
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const chat = {
      url: 'pero://chat/chat.html',
      executeJavaScript: async (expression: string) => {
        reads++;
        await delayed;
        if (scenario === 'destroyed') throw new Error('Frame was destroyed');
        return runInNewContext(expression, {
          location: { href: scenario === 'navigated' ? 'pero-app://demo/' : chat.url },
          window: { peroChatDiagnostics: scenario === 'unready' ? undefined : {
            snapshot: () => JSON.stringify({ chats: [{ id: selected }], activeChat: 0 }),
          } },
        });
      },
    };
    const foreign = { url: 'pero-app://demo/', frames: [chat], executeJavaScript: () => { throw new Error('Never read an App'); } };
    const window = { webContents: {
      mainFrame: { frames: scenario === 'missing' ? [] : scenario === 'foreign' || scenario === 'nested' ? [foreign] : scenario === 'duplicate' ? [chat, chat] : [chat] },
      executeJavaScript: (expression: string) => runInNewContext(expression, { window: {
        // The old Product bridge resolves a missing reply as no selection at 2 s.
        peroAppUseThread: () => { parentQueries++; return new Promise(resolve => setTimeout(() => resolve(undefined), 2000)); },
        peroAppUse: () => { pageCalls++; return { ok: true, value: surface }; },
      } }),
    } };
    const desktop = new DesktopAppUse(() => window as never, () => {}, tmpdir());
    const freezing = desktop.draftContext.freeze({ app: 'demo', panel: 'main' }, 'draft', { message: 'context' });
    const outcome = freezing.then(value => ({ value }), error => ({ error }));
    let settled = false;
    void outcome.then(() => { settled = true; });
    t.mock.timers.tick(2001);
    await Promise.resolve();
    if (scenario === 'delayed') assert.equal(settled, false);
    if (scenario === 'switched') selected = 'other';
    release();
    const result = await outcome;
    if (scenario === 'delayed') {
      assert.deepEqual(result, { value: [] });
      assert.equal(pageCalls, 1);
    } else {
      assert.ok('error' in result);
      assert.equal(pageCalls, 0);
    }
    assert.equal(parentQueries, 0);
    assert.ok(reads <= 1, 'no selection retry or replay');
  }
});

test('MCP advertises only the UI operations supplied by its shell', async () => {
  const { DesktopAppUse } = await import('./app-use-mcp.ts');
  const { tmpdir } = await import('node:os');
  const unavailable = async ():Promise<never> => { throw new Error('Unsupported native UI port must not be called'); };
  for (const native of [false,true]) {
    const shell = native ? {selectedThread:async()=> 'thread',page:unavailable,capture:unavailable,presence:()=>{}}
      : ()=>({} as never);
    const endpoint=new DesktopAppUse(shell,()=>{},tmpdir());
    const env=await endpoint.start();
    const rpc=async(method:string,params?:object)=>{
      const response=await fetch(env.PERO_APP_USE_URL,{method:'POST',headers:{Authorization:`Bearer ${env.PERO_APP_USE_TOKEN}`,'X-Pero-Thread':'thread'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      return (await response.json()).result;
    };
    try {
      const listed=await rpc('tools/list');
      assert.equal(listed.tools.some((tool:{name:string})=>tool.name==='app_use'),!native);
      assert.equal(listed.tools.some((tool:{name:string})=>tool.name==='content_read'),true);
      if(native)assert.equal((await rpc('tools/call',{name:'app_use',arguments:{action:'inventory'}})).isError,true);
    } finally {await endpoint.close();}
  }
});

test('Only declared version-bound Paper image reads become MCP image content', async () => {
  const { createHash } = await import('node:crypto');
  const { DesktopAppUse } = await import('./app-use-mcp.ts');
  const { PreparedAppWrite } = await import('./app-write.ts');
  const { PaperSourceImage } = await import('./paper-source-image.ts');
  const { runInNewContext } = await import('node:vm');
  const { tmpdir } = await import('node:os');
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=';
  const image = { type: 'source_image', mimeType: 'image/png', data, provenance: {
    archiveDigest: 'a'.repeat(64), memberId: 'b'.repeat(64), originalSha256: 'c'.repeat(64),
    previewSha256: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex'), width: 1, height: 1,
  } };
  const definition = { app: 'paper-agent', panel: 'main', version: '1', name: 'research-source-read', description: 'Read frozen source', path: '/api/research/source-read', schema: {
    type: 'object', properties: { operation: { type: 'string', enum: ['image', 'read'] }, memberId: { type: 'string' } }, required: ['operation', 'memberId'], additionalProperties: false,
  } };
  const document = { operation: 'image', memberId: image.provenance.memberId };
  const prepared = new PreparedAppWrite(definition, document);
  for (const [name, value] of [
    ['unknown type', { ...image, type: 'other' }], ['wrong MIME', { ...image, mimeType: 'image/jpeg' }],
    ['invalid observation ID', { ...image, observationId: 'forged' }],
    ['null observation ID', { ...image, observationId: null }],
    ['non-string warning', { ...image, observationWarning: false }],
    ['empty warning', { ...image, observationWarning: ' ' }],
    ['oversized warning', { ...image, observationWarning: 'x'.repeat(501) }],
    ['ambiguous observation', { ...image, observationId: 'e'.repeat(64), observationWarning: 'Not persisted' }],
    ['URL not bytes', { ...image, data: 'https://example.org/picture.png' }], ['noncanonical base64', { ...image, data: data + '\n' }],
    ['extra field', { ...image, url: 'https://example.org' }], ['extra provenance', { ...image, provenance: { ...image.provenance, path: '/tmp/private' } }],
    ['wrong member', { ...image, provenance: { ...image.provenance, memberId: 'd'.repeat(64) } }],
    ['non-PNG bytes', { ...image, data: Buffer.alloc(64).toString('base64'), provenance: { ...image.provenance, previewSha256: createHash('sha256').update(Buffer.alloc(64)).digest('hex') } }],
    ['wrong SHA', { ...image, provenance: { ...image.provenance, previewSha256: 'd'.repeat(64) } }],
    ['dimension mismatch', { ...image, provenance: { ...image.provenance, width: 2 } }],
    ['too many pixels', { ...image, provenance: { ...image.provenance, width: 2049 } }],
    ['oversized bytes', { ...image, data: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }],
  ] as const) assert.throws(() => PaperSourceImage.parse(prepared, value), /source image.*invalid/, name);
  for (const [name, route, input] of [
    ['foreign App', { ...definition, app: 'other' }, document], ['undeclared tool', { ...definition, name: 'other' }, document],
    ['other path', { ...definition, path: '/api/other' }, document], ['other operation', definition, { ...document, operation: 'read' }],
  ] as const) assert.equal(PaperSourceImage.parse(new PreparedAppWrite(route, input), image), null, name);
  const window = { webContents: { mainFrame: { frames: [] }, executeJavaScript: (expression: string) => runInNewContext(expression, {
    window: { peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: 'source-image' }], activeChat: 0 }) } },
  }) } };
  let reply: unknown = image;
  const desktop = new DesktopAppUse(() => window as never, () => {}, tmpdir(), { describe: async () => [definition], apply: async () => reply });
  const env = await desktop.start();
  desktop.accept({ kind: 'session_created', thread_id: 'source-image', data: { scope: { app: 'paper-agent', panel: 'main' } } });
  desktop.accept({ kind: 'turn_started', thread_id: 'source-image' });
  const call = async (operation = 'image') => {
    const response = await fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': 'source-image' }, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'app__paper-agent__research-source-read', arguments: { ...document, operation } },
    }) });
    return (await response.json()).result;
  };
  try {
    const result = await call();
    assert.equal(result.isError, false);
    assert.deepEqual(result.content.map((item: { type: string }) => item.type), ['text', 'image']);
    assert.equal(result.content[1].data, data); assert.equal(result.content[1].mimeType, 'image/png');
    assert.deepEqual(JSON.parse(result.content[0].text).result.provenance, image.provenance);
    assert.equal(JSON.parse(result.content[0].text).result.answerImage.uri, `pero-image://${image.provenance.previewSha256}`);
    const reference = `pero-app-location://paper-agent/main/figure/${image.provenance.archiveDigest}/${image.provenance.memberId}`;
    assert.equal(JSON.parse(result.content[0].text).result.answerImage.markdown, `\n\n[![Source image](pero-image://${image.provenance.previewSha256})](${reference})\n\n`);
    assert.equal(result.content[0].text.includes(data), false, 'base64 never becomes text or an artifact reference');
    assert.equal(Object.hasOwn(JSON.parse(result.content[0].text).result, 'observationId'), false, 'legacy image remains supported without invented observation');
    for (const observation of [{ observationId: 'e'.repeat(64) }, { observationWarning: 'Observation capacity reached; preview is not reportable.' }]) {
      reply = { ...image, ...observation };
      const observed = await call();
      assert.equal(observed.isError, false);
      assert.equal(observed.content[1].data, data, 'typed image survives observation metadata');
      assert.deepEqual(JSON.parse(observed.content[0].text).result, {
        type: 'source_image', mimeType: 'image/png', provenance: image.provenance,
        answerImage: { uri: `pero-image://${image.provenance.previewSha256}`, reference, markdown: `\n\n[![Source image](pero-image://${image.provenance.previewSha256})](${reference})\n\n` }, ...observation,
      });
      assert.equal(observed.content[0].text.includes(data), false);
    }

    assert.equal((await call('read')).content.some((item: { type: string }) => item.type === 'image'), false, 'ordinary JSON remains data');
    reply = { ...image, type: 'unknown' };
    assert.equal((await call()).isError, true);
    desktop.accept({ kind: 'turn_finished', thread_id: 'source-image' });
    assert.equal((await call()).isError, true, 'image route does not bypass Host turn authority');
  } finally { desktop.close(); }
});
