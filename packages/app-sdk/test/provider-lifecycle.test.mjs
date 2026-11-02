import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

async function fixture(t) {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  const calls = [], lifecycle = [];
  let current;
  function Preview() {
    const api = ui.useAppApi(), mobile = ui.useHostCapability('mobile'), info = ui.useAppInfo();
    const launcher = ui.useChatLauncher();
    current = { api, mobile, info, launcher };
    React.useEffect(() => {
      if (!info.active || !mobile) return;
      lifecycle.push('attach');
      return () => { lifecycle.push('detach'); };
    }, [api, mobile, info.active]);
    return React.createElement('input', { defaultValue: 'unsaved draft' });
  }
  const props = {
    appName: 'preview', locale: 'zh', allowedApiPaths: ['/apps/preview/api'], allowedEvents: [],
    allowedHostCapabilities: ['mobile'], hostHeaders: { 'X-Point-Session-Id': 'session-a' },
    subscribeFn: () => () => {}, navigateFn: () => {}, notifyFn: () => {},
    hostCallFn: async (...args) => { calls.push(args); return 'first-host'; },
    fetch: async (_path, init) => { calls.push(init.headers.get('X-Point-Session-Id')); return new Response('{}'); },
  };
  return { ...env, props, calls, lifecycle, current: () => current,
    update: changes => render(React.createElement(ui.AppApiProvider, { ...props, ...changes }, React.createElement(Preview))) };
}

async function eventFixture(t) {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  const lifecycle = [], delivered = [], errors = [], listeners = new Set();
  let current;
  const carrier = name => (event, callback) => {
    lifecycle.push(['attach', name, event]);
    // Bound the old immediate-replay regression instead of hanging the test.
    if (lifecycle.filter(([kind]) => kind === 'attach').length > 20) throw new Error('Event resubscription loop');
    const listener = { event, callback }; listeners.add(listener);
    callback('initial');
    return () => { lifecycle.push(['release', name, event]); listeners.delete(listener); };
  };
  class Boundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { errors.push(error); }
    render() { return this.state.error ? React.createElement('p', { 'data-event-denied': true }, this.state.error.message) : this.props.children; }
  }
  function Observer({ event, label, onEvent }) {
    current = { api: ui.useAppApi(), mobile: ui.useHostCapability('mobile'), info: ui.useAppInfo() };
    ui.useAppEvents(event, value => { delivered.push([label, value]); onEvent(); });
    return null;
  }
  function Fixture({ event = 'session.changed', label = 'first', reset = 0, ...props }) {
    const [received, setReceived] = React.useState(0);
    // A real carrier can synchronously publish its snapshot at registration.
    // Its App callback updates this parent, recreating presentation callbacks.
    return React.createElement(ui.AppApiProvider, { ...props, navigateFn() {}, notifyFn() {}, launchChatFn() {}, setBadgeFn() {} },
      React.createElement(Boundary, { key: reset }, React.createElement(Observer, { event, label, onEvent: () => setReceived(value => value + 1) })),
      React.createElement('output', null, received));
  }
  let props = { appName: 'preview', locale: 'en', allowedApiPaths: [], allowedEvents: ['session.changed'],
    allowedHostCapabilities: ['mobile'], hostHeaders: { 'X-Point-Session-Id': 'session-a' },
    subscribeFn: carrier('first'), hostCallFn: async () => 'host' };
  return { ...env, lifecycle, delivered, errors, listeners, carrier, current: () => current,
    update: changes => { props = { ...props, ...changes }; return render(React.createElement(Fixture, props)); } };
}

test('App event snapshots do not resubscribe through presentation rerenders and callbacks stay current', async t => {
  const env = await eventFixture(t); if (!env) return;
  await env.update({});
  const first = env.current();
  assert.deepEqual(env.lifecycle, [['attach', 'first', 'session.changed']]);
  assert.equal(document.querySelector('output').textContent, '1');
  for (let i = 0; i < 4; i++) {
    await env.update({ locale: i % 2 ? 'zh' : 'en', appVersion: String(i), examples: { revision: i }, label: `label-${i}`,
      hostHeaders: new Headers({ 'x-point-session-id': 'session-a' }), allowedEvents: ['session.changed'] });
  }
  assert.deepEqual(env.lifecycle, [['attach', 'first', 'session.changed']]);
  assert.equal(env.current().api, first.api);
  assert.equal(env.current().mobile, first.mobile);
  await env.React.act(async () => { for (const listener of env.listeners) listener.callback('latest'); });
  assert.deepEqual(env.delivered.at(-1), ['label-3', 'latest']);
  assert.equal(env.lifecycle.length, 1);
  await env.update({ allowedHostCapabilities: [] });
  assert.equal(env.current().mobile, null, 'stable events do not retain a revoked Host capability');
  assert.equal(env.lifecycle.length, 1);
  await env.render(null);
  assert.deepEqual(env.lifecycle.at(-1), ['release', 'first', 'session.changed']);
  assert.equal(env.listeners.size, 0);
  assert.deepEqual(env.errors, []);
});

test('App event authority changes replace the scoped wrapper and revoked grants release the carrier', async t => {
  const env = await eventFixture(t); if (!env) return;
  await env.update({});
  const expectRefresh = async (changes, name = 'first') => {
    const before = env.lifecycle.length;
    await env.update(changes);
    assert.equal(env.lifecycle.length, before + 2, 'one teardown and one new registration');
    assert.deepEqual(env.lifecycle.at(-1), ['attach', name, 'session.changed']);
    assert.equal(env.listeners.size, 1);
  };
  await expectRefresh({ allowedEvents: ['session.changed', 'project:*'] });
  await expectRefresh({ hostHeaders: { 'X-Point-Session-Id': 'session-b' } });
  await expectRefresh({ appName: 'other-preview' });
  await expectRefresh({ active: false });
  await expectRefresh({ active: true });
  await expectRefresh({ subscribeFn: env.carrier('second') }, 'second');
  const beforeRevoke = env.lifecycle.length;
  await env.update({ allowedEvents: [] });
  assert.equal(env.lifecycle.length, beforeRevoke + 1, 'revocation cleans up but never reaches the raw carrier again');
  assert.deepEqual(env.lifecycle.at(-1), ['release', 'second', 'session.changed']);
  assert.equal(env.listeners.size, 0);
  assert.match(document.querySelector('[data-event-denied]').textContent, /Event "session.changed" is not declared/);
  assert.equal(env.errors.length, 1);
  await env.update({ allowedEvents: ['session.changed'], reset: 1 });
  assert.deepEqual(env.lifecycle.at(-1), ['attach', 'second', 'session.changed']);
  assert.equal(env.listeners.size, 1);
  await env.render(null);
  assert.equal(env.listeners.size, 0);
});

test('presentation updates preserve an active preview and use the latest chat action', async t => {
  const env = await fixture(t); if (!env) return;
  const { props, update, current, lifecycle, calls } = env;
  await update({});
  const first = current(), input = document.querySelector('input');
  input.value = 'edited draft'; input.focus();
  for (let i = 0; i < 4; i++) {
    await update({ locale: i % 2 ? 'zh' : 'en', appVersion: String(i), examples: { revision: i },
      allowedApiPaths: [...props.allowedApiPaths], allowedEvents: [], allowedHostCapabilities: ['mobile'],
      hostHeaders: new Headers({ 'x-point-session-id': 'session-a' }),
      navigateFn: () => {}, launchChatFn: () => calls.push(`chat-${i}`) });
    assert.equal(current().api, first.api);
    assert.equal(current().mobile, first.mobile);
    assert.equal(current().info.locale, i % 2 ? 'zh' : 'en');
    await current().launcher.openChat();
  }
  assert.deepEqual(calls, ['chat-0', 'chat-1', 'chat-2', 'chat-3']);
  assert.deepEqual(lifecycle, ['attach']);
  assert.equal(document.querySelector('input'), input);
  assert.equal(input.value, 'edited draft');
  assert.equal(document.activeElement, input);
  await update({ active: false });
  assert.deepEqual(lifecycle, ['attach', 'detach']);
  await update({ active: true });
  assert.deepEqual(lifecycle, ['attach', 'detach', 'attach']);
});

test('Session, API permissions and Host changes replace the scoped interfaces', async t => {
  const env = await fixture(t); if (!env) return;
  const { props, update, current, calls } = env;
  await update({});
  const first = current();
  const headers = { 'X-Point-Session-Id': 'session-b' };
  await update({ hostHeaders: headers });
  assert.notEqual(current().api, first.api);
  await current().api.get('/apps/preview/api/state');
  assert.equal(calls.at(-1), 'session-b');
  const second = current();
  await update({ hostHeaders: headers, allowedApiPaths: ['/apps/preview/api/other'], allowedHostCapabilities: [] });
  assert.notEqual(current().api, second.api);
  assert.equal(current().mobile, null);
  await assert.rejects(current().api.get('/apps/preview/api/state'), /cannot access/);
  await update({ ...props, hostCallFn: async () => 'second-host' });
  assert.notEqual(current().mobile, first.mobile);
  assert.equal(await current().mobile.call('list'), 'second-host');
});

test('App conversation slot belongs only to an active App and releases on hide or unmount', async t => {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  const calls = [];
  const mount = element => { calls.push(element); return () => calls.push('release'); };
  const props = { appName: 'preview', allowedApiPaths: [], allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {}, mountConversationFn: mount };
  const view = (active, slotActive = true) => React.createElement(ui.AppApiProvider, { ...props, active }, React.createElement(ui.AppConversation, { active: slotActive }));
  await render(view(true));
  const slot = document.querySelector('[data-pero-app-conversation]');
  assert.deepEqual(calls, [slot]);
  await render(view(false));
  assert.deepEqual(calls, [slot, 'release']);
  await render(view(true));
  assert.equal(document.querySelector('[data-pero-app-conversation]'), slot);
  await render(view(true, false));
  assert.deepEqual(calls, [slot, 'release', slot, 'release']);
  await render(view(true));
  await render(null);
  assert.deepEqual(calls, [slot, 'release', slot, 'release', slot, 'release']);
});

test('Session-bound conversation fails closed on older Hosts and releases each exact binding', async t => {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  const calls = [];
  const mount = (element, { sessionId }) => { calls.push(['mount', element, sessionId]); return () => calls.push(['release', sessionId]); };
  const props = { appName: 'preview', allowedApiPaths: [], allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {},
    mountConversationFn() { throw new Error('A bound slot must never use the legacy mount'); } };
  const view = ({ sessionId = 'session-a', supported = true, active = true, slotActive = true } = {}) => React.createElement(ui.AppApiProvider,
    { ...props, active, mountSessionConversationFn: supported ? mount : undefined },
    React.createElement(ui.AppSessionConversation, { sessionId, active: slotActive, fallback: 'Binding unavailable' }));
  await render(view({ supported: false }));
  assert.match(document.body.textContent, /Binding unavailable/);
  assert.deepEqual(calls, []);
  await render(view({ sessionId: '' }));
  assert.match(document.body.textContent, /Binding unavailable/);
  assert.deepEqual(calls, []);
  await render(view());
  const element = document.querySelector('[data-pero-app-session-conversation]');
  assert.deepEqual(calls, [['mount', element, 'session-a']]);
  await render(view());
  assert.equal(calls.length, 1, 'presentation rerenders retain the binding');
  await render(view({ sessionId: 'session-b' }));
  assert.deepEqual(calls.slice(-2), [['release', 'session-a'], ['mount', element, 'session-b']]);
  await render(view({ sessionId: 'session-b', active: false }));
  assert.deepEqual(calls.at(-1), ['release', 'session-b']);
  await render(view({ sessionId: 'session-b' }));
  await render(view({ sessionId: 'session-b', slotActive: false }));
  assert.deepEqual(calls.at(-1), ['release', 'session-b']);
  await render(view({ sessionId: 'session-b' }));
  await render(null);
  assert.deepEqual(calls.at(-1), ['release', 'session-b']);
  assert.equal(calls.filter(([kind]) => kind === 'mount').length, calls.filter(([kind]) => kind === 'release').length);
});

test('Project conversation capability is explicit and never downgrades to generic chat or Session-only slots', async t => {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  let launcher, unavailable = 0;
  const selection = Object.freeze({ sessionId: 'session', runtimeGeneration: 'native' });
  function Preview() { launcher = ui.useChatLauncher(); return React.createElement(ui.AppProjectRunConversation, { selection, fallback: 'Unavailable', onUnavailable: () => unavailable++ }); }
  const fail = () => { throw new Error('No legacy fallback'); };
  const props = { appName: 'preview', allowedApiPaths: [], allowedEvents: [], subscribeFn: () => () => {}, navigateFn() {}, notifyFn() {}, launchChatFn: fail, mountConversationFn: fail, mountSessionConversationFn: fail };
  await render(React.createElement(ui.AppApiProvider, props, React.createElement(Preview)));
  assert.equal(launcher.selectProjectRunSession, undefined);
  assert.match(document.body.textContent, /Unavailable/);
  const select = async () => selection;
  await render(React.createElement(ui.AppApiProvider, { ...props, selectProjectRunSessionFn: select, mountProjectRunConversationFn: () => null }, React.createElement(Preview)));
  assert.equal(launcher.selectProjectRunSession, select);
  assert.equal(await launcher.selectProjectRunSession({}), selection);
  assert.equal(unavailable, 1);
  assert.match(document.body.textContent, /Unavailable/);
});

test('App desktop slot mounts inside the App and releases on hide without navigating or executing', async t => {
  const env = await createUiRuntime(t, { contents: "export * from './index';", resolveDir: new URL('../src', import.meta.url).pathname });
  if (!env) return;
  const { React, ui, render } = env;
  const calls = [];
  const mount = element => { calls.push(element); return () => calls.push('release'); };
  const props = { appName: 'lab', allowedApiPaths: [], allowedEvents: [], subscribeFn: () => () => {}, navigateFn: () => { throw Error('must not navigate'); }, notifyFn() {}, mountDesktopFn: mount };
  const view = (active, slotActive = true) => React.createElement(ui.AppApiProvider, { ...props, active }, React.createElement(ui.AppDesktop, { active: slotActive, fallback: 'unavailable' }));
  await render(view(true));
  const slot = document.querySelector('[data-pero-app-desktop]');
  assert.equal(calls[0], slot);
  await render(view(true));
  assert.equal(calls.length, 1, 'presentation rerenders keep the native display attached');
  await render(view(false));
  assert.equal(calls.at(-1), 'release');
  await render(view(true));
  assert.equal(calls.at(-1), slot);
  await render(view(true, false));
  assert.equal(calls.at(-1), 'release');
  await render(React.createElement(ui.AppApiProvider, { ...props, mountDesktopFn: undefined }, React.createElement(ui.AppDesktop, { fallback: 'unavailable' })));
  assert.match(document.body.textContent, /unavailable/);
});
