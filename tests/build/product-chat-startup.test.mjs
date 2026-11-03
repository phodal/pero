// Execute the Product shell against its renderer/Host ports, without a GUI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { Product } from '../../packages/product/product.ts';

const bundled = await build({
  entryPoints: ['desktop/src/product/shell.ts'], bundle: true, write: false, format: 'iife',
  plugins: [{ name: 'product-ports', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, namespace: 'ports' });
    build.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      export const appChatLauncher = () => () => {};
      export const previewContext = () => {};
      export const mountAppSurfaces = command => { ports.surfaceCommand = command; return ports.surface; };
      export const mountChatSurface = (_, options) => { ports.chatOptions = options; return ports.chat; };
      export const translate = (_, key) => key;
      export const applyAppearance = () => {};
      export const mountReaderSurface = () => {};
      export default {light:{},dark:{}};
    ` }));
  } }],
});

async function shell(connected = false) {
  const commands = [], events = [], contexts = [], elements = [], opens = [];
  const ports = {
    surface: { surface() {}, openLocation() {}, event(value) { events.push(value); } },
    chat: { context(value) { contexts.push(value); }, event(value) { events.push(value); }, selectedDraft: async () => undefined },
  };
  const element = (tag) => { const value = { tag, style: { setProperty() {} }, dataset: {}, classList: { toggle() {} },
    append() {}, setAttribute() {}, getBoundingClientRect: () => ({ height: 30 }), options: [], add(value) { this.options.push(value); } }; elements.push(value); return value; };
  const product = {
    onEvent(callback) { ports.receive = callback; }, onContext() {},
    connect: async () => ({ connected, dark: false, locale: 'en', product: { name: 'Fixture', chat: true, apps: ['fixture', 'other'], entry: { app: 'fixture', panel: 'main' } } }),
    open: async (name, panel) => { opens.push({ name, panel }); }, sessionCommand: async command => { commands.push(command); },
  };
  runInNewContext(bundled.outputFiles[0].text, {
    ports, window: { product, addEventListener() {} }, document: { createElement: element, body: element(), documentElement: element() },
    Option: function(text, value) { return { text, value }; }, innerWidth: 1200, innerHeight: 900,
  });
  // Await the bridge.connect continuation, not wall-clock arrival.
  await Promise.resolve();
  const event = (kind, data) => ports.receive({ version: 1, kind, data, text: '', request_id: null });
  return { ports, commands, events, contexts, event, opens, selector: elements.find(element => element.tag === 'select') };
}

for (const order of [ ['ready', 'chat', 'app'], ['ready', 'app', 'chat'], ['chat', 'app', 'ready'], ['chat', 'ready', 'app'], ['app', 'ready', 'chat'], ['app', 'chat', 'ready'] ]) {
  test(`Product startup waits for its App, Host and Chat: ${order.join(' / ')}`, async () => {
    const fixture = await shell();
    fixture.event('apps_opened', { name: 'other', panel: 'main' });
    assert.equal(fixture.commands.length, 0, 'another App cannot release this draft');
    fixture.event('apps_opened', { name: 'fixture', panel: 'other' });
    assert.equal(fixture.commands.length, 0, 'another panel cannot release this draft');
    for (const [index, step] of order.entries()) {
      if (step === 'chat') fixture.ports.chatOptions.ready();
      else fixture.event(step === 'app' ? 'apps_opened' : 'ready', step === 'app' ? { name: 'fixture', panel: 'main' } : undefined);
      assert.equal(fixture.commands.length, index === 2 ? 2 : 0, 'no automatic session preparation before App resolution');
    }
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.commands)), [{ action: 'list_agents' }, { method: 'settings.workbench.get' }]);
    assert.ok(fixture.contexts.every(context => context.scope.app === 'fixture' && context.scope.panel === 'main'));
  });
}

test('already-connected Host still waits for App resolution, and Chat reload reinitializes', async () => {
  const fixture = await shell(true);
  fixture.ports.chatOptions.ready();
  assert.equal(fixture.commands.length, 0);
  fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
  assert.equal(fixture.commands.length, 2);
  fixture.ports.chatOptions.ready();
  assert.equal(fixture.commands.length, 4);
});


test('App opening error remains visible and retry releases the original scope', async () => {
  const fixture = await shell(true);
  fixture.ports.chatOptions.ready();
  fixture.event('apps_error', { reason: 'fixture failure' });
  assert.equal(fixture.commands.length, 0);
  assert.ok(fixture.events.some(event => event.kind === 'apps_error'));
  fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
  assert.equal(fixture.commands.length, 2);
  assert.ok(fixture.contexts.every(context => context.scope.app === 'fixture' && context.scope.panel === 'main'));
});


for (const navigation of ['selector', 'app-link', 'panel-link']) {
  test(`App readiness belongs to the current selection: ${navigation}`, async () => {
    const fixture = await shell(true);
    fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
    assert.equal(fixture.commands.length, 0, 'Chat has not loaded yet');
    const target = navigation === 'panel-link' ? { app: 'fixture', panel: 'detail' } : { app: 'other', panel: 'main' };
    if (navigation === 'selector') {
      fixture.selector.value = target.app;
      fixture.selector.onchange();
    } else {
      await fixture.ports.chatOptions.command({ action: 'app_location', ...target, location: 'object:1' });
    }
    fixture.ports.chatOptions.ready();
    assert.equal(fixture.commands.length, 0, 'previous App readiness cannot initialize a newly selected scope');
    fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
    assert.equal(fixture.commands.length, 0, 'late previous completion cannot release the new scope');
    fixture.event('apps_opened', { name: target.app, panel: target.panel });
    assert.equal(fixture.commands.length, 2, 'matching completion initializes Chat');
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.contexts.at(-1).scope)), target);
  });
}


// Resolve the request actually sent by the shell, rather than inventing the
// requested completion: Product owns defaults; DesktopApps checks the manifest.
for (const panel of ['main', 'detail']) {
  test(`App link opens its requested panel through the Product bridge: ${panel}`, async () => {
    const fixture = await shell(true);
    const product = Product.parse({ schemaVersion: 1, id: 'com.pero.fixture', name: 'Fixture', version: '1.0.0', shell: 'app', apps: ['fixture', 'other'], entry: { app: 'fixture', panel: 'main' }, python: 'system' });
    const preload = await build({ entryPoints: ['desktop/src/product/preload.ts'], bundle: true, write: false, format: 'cjs', external: ['electron'] });
    let bridge;
    runInNewContext(preload.outputFiles[0].text, { require: () => ({
      contextBridge: { exposeInMainWorld: (_, value) => { bridge = value; } },
      ipcRenderer: { invoke: async (channel, name, panel) => {
        assert.equal(channel, 'product:open');
        const entry = product.selectApp(name, panel);
        return { name: entry.app, panel: entry.panel || 'main' };
      } },
    }) });
    const complete = async () => {
      const request = fixture.opens.at(-1);
      fixture.event('apps_opened', await bridge.open(request.name, request.panel));
    };
    // Omitted panel still opens the configured entry.
    assert.deepEqual(await bridge.open('fixture'), { name: 'fixture', panel: 'main' });
    assert.deepEqual(await bridge.open('other'), { name: 'other', panel: 'main' });
    await assert.rejects(bridge.open('excluded', panel));
    await fixture.ports.chatOptions.command({ action: 'app_location', app: 'fixture', panel, location: 'object:1' });
    fixture.ports.chatOptions.ready();
    assert.equal(fixture.commands.length, 0);
    await complete();
    assert.equal(fixture.commands.length, 2, 'the actual opened panel releases Chat initialization');
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.contexts.at(-1).scope)), { app: 'fixture', panel });
  });
}


test('SDK navigation preserves scope readiness, requested panel and presentation behavior', async () => {
  const fixture = await shell(true);
  fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
  await fixture.ports.surfaceCommand({ action: 'sdkbadge', name: 'fixture', count: 3 });
  assert.equal(fixture.selector.options[0].textContent, 'fixture (3)');
  await assert.rejects(fixture.ports.surfaceCommand({ action: 'sdkpage', page: 'tasks' }), /unavailable/);
  await assert.rejects(fixture.ports.surfaceCommand({ action: 'open', name: 'excluded', panel: 'detail' }), /included/);
  assert.equal(fixture.opens.length, 1, 'presentation and rejected navigation do not open another App');

  await fixture.ports.surfaceCommand({ action: 'open', name: 'other', panel: 'detail' });
  assert.deepEqual(fixture.opens.at(-1), { name: 'other', panel: 'detail' });
  assert.equal(fixture.selector.value, 'other');
  fixture.ports.chatOptions.ready();
  assert.equal(fixture.commands.length, 0, 'the previous App cannot release the SDK navigation');
  fixture.event('apps_opened', { name: 'fixture', panel: 'main' });
  fixture.event('apps_opened', { name: 'other', panel: 'main' });
  assert.equal(fixture.commands.length, 0, 'late or wrong-panel completions cannot release the selected scope');
  fixture.event('apps_opened', { name: 'other', panel: 'detail' });
  assert.equal(fixture.commands.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.contexts.at(-1).scope)), { app: 'other', panel: 'detail' });

  await fixture.ports.surfaceCommand({ action: 'apps_open', name: 'other', panel: 'detail' });
  assert.deepEqual(fixture.opens.at(-1), { name: 'other', panel: 'detail' }, 'retry retains the selected panel');
});
