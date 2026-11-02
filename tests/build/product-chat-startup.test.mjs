// Execute the Product shell against its renderer/Host ports, without a GUI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['desktop/src/product/shell.ts'], bundle: true, write: false, format: 'iife',
  plugins: [{ name: 'product-ports', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, namespace: 'ports' });
    build.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      export const appChatLauncher = () => () => {};
      export const previewContext = () => {};
      export const mountAppSurfaces = () => ports.surface;
      export const mountChatSurface = (_, options) => { ports.chatOptions = options; return ports.chat; };
      export const translate = (_, key) => key;
      export const applyAppearance = () => {};
      export const mountReaderSurface = () => {};
      export default {light:{},dark:{}};
    ` }));
  } }],
});

async function shell(connected = false) {
  const commands = [], events = [], contexts = [], elements = [];
  const ports = {
    surface: { surface() {}, openLocation() {}, event(value) { events.push(value); } },
    chat: { context(value) { contexts.push(value); }, event(value) { events.push(value); }, selectedDraft: async () => undefined },
  };
  const element = (tag) => { const value = { tag, style: { setProperty() {} }, dataset: {}, classList: { toggle() {} },
    append() {}, setAttribute() {}, getBoundingClientRect: () => ({ height: 30 }), options: [], add(value) { this.options.push(value); } }; elements.push(value); return value; };
  const product = {
    onEvent(callback) { ports.receive = callback; }, onContext() {},
    connect: async () => ({ connected, dark: false, locale: 'en', product: { name: 'Fixture', chat: true, apps: ['fixture', 'other'], entry: { app: 'fixture', panel: 'main' } } }),
    open: async () => {}, sessionCommand: async command => { commands.push(command); },
  };
  runInNewContext(bundled.outputFiles[0].text, {
    ports, window: { product, addEventListener() {} }, document: { createElement: element, body: element(), documentElement: element() },
    Option: function(text, value) { return { text, value }; }, innerWidth: 1200, innerHeight: 900,
  });
  // Await the bridge.connect continuation, not wall-clock arrival.
  await Promise.resolve();
  const event = (kind, data) => ports.receive({ version: 1, kind, data, text: '', request_id: null });
  return { ports, commands, events, contexts, event, selector: elements.find(element => element.tag === 'select') };
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
