import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const ipcMain = new EventEmitter();
const windows: FakeWindow[] = [];
const partitions: { name: string; session: FakeSession }[] = [];
class FakeSession extends EventEmitter {
  permissionRequest?: (...args: any[]) => void;
  permissionCheck?: (...args: any[]) => boolean;
  network?: (...args: any[]) => void;
  webRequest = { onBeforeRequest: (...args: any[]) => { this.network = args.at(-1); } };
  setPermissionRequestHandler(callback: (...args: any[]) => void) { this.permissionRequest = callback; }
  setPermissionCheckHandler(callback: (...args: any[]) => boolean) { this.permissionCheck = callback; }
}
class FakeContents extends EventEmitter {
  mainFrame = { url: '' };
  sent: { channel: string; value: any }[] = [];
  opener?: (...args: any[]) => unknown;
  send(channel: string, value: any) { this.sent.push({ channel, value }); }
  getURL() { return this.mainFrame.url; }
  setWindowOpenHandler(callback: (...args: any[]) => unknown) { this.opener = callback; }
  isDestroyed() { return false; }
}
class FakeWindow extends EventEmitter {
  options: any;
  webContents = new FakeContents();
  destroyed = false;
  enabled = true;
  shown = false;
  constructor(options?: any) { super(); this.options = options; if (options) windows.push(this); }
  isDestroyed() { return this.destroyed; }
  isEnabled() { return this.enabled; }
  setEnabled() { assert.fail('Approval must not enable/disable an owner itself'); }
  loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
  setMenu(_menu: unknown) {}
  show() { this.shown = true; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  close() { this.emit('close'); this.destroy(); }
}
Object.assign(globalThis, { __approvalElectron: {
  BrowserWindow: FakeWindow, ipcMain,
  session: { fromPartition(name: string) { const session = new FakeSession(); partitions.push({ name, session }); return session; } },
} });
const mock = 'data:text/javascript,export const {BrowserWindow,ipcMain,session}=globalThis.__approvalElectron;';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: mock, shortCircuit: true } : nextResolve(specifier, context);
} });
const { confirmLinuxReproduction } = await import('./reproduction-approval-linux.ts');
const channel = 'pero:reproduction-approval';
const summary = '<img src="https://invalid.test/" onerror="alert(1)"> frozen text';
function start() {
  const owner = new FakeWindow(), controller = new AbortController();
  const result = confirmLinuxReproduction(owner as never, summary, controller.signal);
  const popup = windows.at(-1)!;
  const event = { sender: popup.webContents, senderFrame: popup.webContents.mainFrame };
  const send = (value: unknown, source: unknown = event) => ipcMain.emit(channel, source, value);
  send({ kind: 'ready' });
  const configuration = popup.webContents.sent.find(item => item.channel === 'pero:reproduction-approval-config')?.value;
  assert.ok(configuration, 'Only the verified main frame receives its frozen configuration');
  return { owner, popup, controller, result, send, event, configuration };
}

test('trusted isolated approval binds one decision and never exposes HTML as executable content', async () => {
  const h = start();
  try {
    assert.equal(h.configuration.summary, summary);
    assert.equal(typeof h.configuration.nonce, 'string');
    assert.ok(h.configuration.nonce.length > 0);
    assert.equal(h.popup.options.parent, h.owner);
    assert.equal(h.popup.options.modal, true);
    assert.equal(h.popup.options.webPreferences.nodeIntegration, false);
    assert.equal(h.popup.options.webPreferences.contextIsolation, true);
    assert.equal(h.popup.options.webPreferences.sandbox, true);
    assert.ok(h.popup.options.webPreferences.preload.endsWith('reproduction-approval-preload.cjs'));
    assert.ok(!partitions.at(-1)!.name.startsWith('persist:'));
    const html = decodeURIComponent(h.popup.webContents.mainFrame.url);
    assert.ok(!html.includes(summary));
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    const session = partitions.at(-1)!.session;
    assert.equal(session.permissionCheck?.({}, 'notifications'), false);
    let permission: unknown;
    session.permissionRequest?.({}, 'notifications', (allow: boolean) => { permission = allow; });
    assert.equal(permission, false);
    let network: unknown;
    session.network?.({ url: 'https://invalid.test/' }, (value: unknown) => { network = value; });
    assert.deepEqual(network, { cancel: true });
    h.send({ kind: 'decision', nonce: h.configuration.nonce, allow: true });
    assert.equal(await h.result, true);
    h.send({ kind: 'decision', nonce: h.configuration.nonce, allow: false });
    assert.equal(h.popup.destroyed, true);
    assert.equal(ipcMain.listenerCount(channel), 0);
  } finally { h.controller.abort(); }
});

test('wrong sender, subframe, URL, nonce, malformed decision and old-request replay cannot allow', async () => {
  const previous = start(); previous.controller.abort(); assert.equal(await previous.result, false);
  const h = start();
  let settled = false; void h.result.then(() => { settled = true; });
  const valid = { kind: 'decision', nonce: h.configuration.nonce, allow: true };
  try {
    for (const event of [{ ...h.event, sender: new FakeContents() },
      { ...h.event, senderFrame: { url: h.event.senderFrame.url } }]) h.send(valid, event);
    const url = h.event.senderFrame.url;
    h.event.senderFrame.url = 'https://untrusted.invalid/'; h.send(valid); h.event.senderFrame.url = url;
    for (const value of [null, {}, { ...valid, nonce: previous.configuration.nonce },
      { ...valid, nonce: 'wrong' }, { ...valid, allow: 'true' }, { ...valid, extra: 'unexpected' }, { kind: 'decision' }]) h.send(value);
    await Promise.resolve(); assert.equal(settled, false);
    h.controller.abort(); assert.equal(await h.result, false);
  } finally { h.controller.abort(); }
});

test('all close/cancel/crash/failed-load paths deny and remove owner/IPC listeners', async () => {
  for (const mode of ['cancel', 'abort', 'owner-close', 'owner-closed', 'popup-close', 'popup-closed', 'renderer-gone', 'owner-renderer-gone', 'unresponsive', 'failed-load', 'navigation', 'new-window', 'escape']) {
    const h = start();
    if (mode === 'cancel') h.send({ kind: 'decision', nonce: h.configuration.nonce, allow: false });
    if (mode === 'abort') h.controller.abort();
    if (mode === 'owner-close') h.owner.emit('close', { preventDefault() {} });
    if (mode === 'owner-closed') h.owner.destroy();
    if (mode === 'popup-close') h.popup.close();
    if (mode === 'popup-closed') h.popup.destroy();
    if (mode === 'renderer-gone') h.popup.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    if (mode === 'owner-renderer-gone') h.owner.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    if (mode === 'navigation') {
      let prevented = false;
      h.popup.webContents.emit('will-navigate', { preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    }
    if (mode === 'new-window') assert.deepEqual(h.popup.webContents.opener?.({ url: 'https://invalid.test/' }), { action: 'deny' });
    if (mode === 'escape') {
      let prevented = false;
      h.popup.webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'Escape' });
      assert.equal(prevented, true);
    }
    if (mode === 'unresponsive') h.popup.emit('unresponsive');
    if (mode === 'failed-load') h.popup.webContents.emit('did-fail-load', {}, -2, 'failed');
    assert.equal(await h.result, false, mode);
    h.send({ kind: 'decision', nonce: h.configuration.nonce, allow: true });
    assert.equal(h.owner.listenerCount('close'), 0, mode);
    assert.equal(h.owner.listenerCount('closed'), 0, mode);
    assert.equal(ipcMain.listenerCount(channel), 0, mode);
  }
});

test('disabled/destroyed owners and pre-aborted requests cannot create or re-enable a popup', async () => {
  for (const mode of ['disabled', 'destroyed', 'aborted']) {
    const owner = new FakeWindow(), controller = new AbortController();
    if (mode === 'disabled') owner.enabled = false;
    if (mode === 'destroyed') owner.destroyed = true;
    if (mode === 'aborted') controller.abort();
    const count = windows.length;
    assert.equal(await confirmLinuxReproduction(owner as never, summary, controller.signal), false);
    assert.equal(windows.length, count);
  }
});

test('a second request cannot overlap the same owner while its first window loads', async () => {
  const h = start();
  const count = windows.length;
  assert.equal(await confirmLinuxReproduction(h.owner as never, 'different request', new AbortController().signal), false);
  assert.equal(windows.length, count);
  h.controller.abort();
  assert.equal(await h.result, false);
  const controller = new AbortController();
  const later = confirmLinuxReproduction(h.owner as never, 'later request', controller.signal);
  assert.equal(windows.length, count + 1);
  controller.abort();
  assert.equal(await later, false);
});

test('request timeout denies, never renews or approves', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = start();
  context.mock.timers.tick(120_000);
  assert.equal(await h.result, false);
  assert.equal(ipcMain.listenerCount(channel), 0);
});

// The isolated preload has no page-facing bridge. Drive its DOM/IPC boundaries,
// not a live browser: synthetic untrusted events must never submit a decision.
test('preload renders summary as text and accepts only one trusted control event', () => {
  const ipc = new EventEmitter() as EventEmitter & { send(channel: string, value: unknown): void };
  const sent: unknown[] = [];
  ipc.send = (_channel, value) => { sent.push(value); };
  const elements = new Map(['cancel', 'allow', 'summary'].map(id => [id, {
    disabled: true, textContent: '', focus() {},
    handlers: new Map<string, (event: { isTrusted: boolean }) => void>(),
    addEventListener(name: string, handler: (event: { isTrusted: boolean }) => void) { this.handlers.set(name, handler); },
    set innerHTML(_value: string) { assert.fail('Summary must never be interpreted as HTML'); },
  }]));
  let ready!: () => void;
  const source = stripTypeScriptTypes(readFileSync(new URL('../preload/reproduction-approval.ts', import.meta.url), 'utf8'))
    .replace("import { ipcRenderer } from 'electron';", 'const ipcRenderer = injectedIPC;');
  const pageWindow = { addEventListener(name: string, callback: () => void) { assert.equal(name, 'DOMContentLoaded'); ready = callback; } };
  runInNewContext(source, {
    injectedIPC: ipc,
    window: pageWindow,
    document: { getElementById(id: string) { return elements.get(id); } },
  });
  ready();
  assert.deepEqual(Object.keys(pageWindow), ['addEventListener'], 'No approval API is exposed to page scripts');
  assert.equal(JSON.stringify(sent), JSON.stringify([{ kind: 'ready' }]));
  elements.get('allow')!.handlers.get('click')!({ isTrusted: true });
  assert.equal(sent.length, 1, 'No decision before main-process configuration');
  ipc.emit('pero:reproduction-approval-config', {}, { nonce: 'fresh-request', summary });
  ipc.emit('pero:reproduction-approval-config', {}, { nonce: 'replacement', summary: 'changed' });
  assert.equal(elements.get('summary')!.textContent, summary);
  elements.get('allow')!.handlers.get('click')!({ isTrusted: false });
  assert.equal(sent.length, 1, 'DOM-dispatched click is not approval');
  elements.get('allow')!.handlers.get('click')!({ isTrusted: true });
  elements.get('cancel')!.handlers.get('click')!({ isTrusted: true });
  assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ kind: 'decision', nonce: 'fresh-request', allow: true }));
  assert.equal(sent.length, 2);
  assert.equal(elements.get('allow')!.disabled, true);
  assert.equal(elements.get('cancel')!.disabled, true);
});
