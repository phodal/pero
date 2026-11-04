// Exercise the real Product main entry over its Electron/Host ports, without a GUI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['desktop/src/main/product.ts'], bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{ name: 'product-ports', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' || args.path.startsWith('node:') ? undefined : { path: args.path, namespace: 'ports' });
    build.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
      export const { app, BrowserWindow, ipcMain, Menu, protocol, nativeTheme, net, dialog, globalShortcut, shell,
        DesktopApps, DesktopAppUse, DesktopComputer, Product } = ports;
      export const harnessEnvironment = () => ({}), translate = (_, key) => key;
      export const testWindowOptions = {}, computerPermissions = {}, ConversationContentRead = {};
      export const confirmReproduction = () => {}, bindAppFrameEditing = () => {};
    ` }));
  } }],
});

async function product() {
  const delivered = [], lifecycle = new EventEmitter();
  const host = new EventEmitter();
  host.stdout = new PassThrough(); host.stderr = new PassThrough();
  host.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const app = new EventEmitter(), theme = new EventEmitter();
  let window, boot;
  const ports = {
    app: Object.assign(app, {
      setName() {}, setPath() {}, getPath: () => '/tmp', getLocale: () => 'en',
      whenReady: () => ({ then: callback => { boot = Promise.resolve().then(callback); } }),
      quit() {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        app.emit('before-quit', event);
        if (!event.defaultPrevented) { window.destroyed = true; lifecycle.emit('quit'); }
        return event;
      },
    }),
    BrowserWindow: class {
      constructor() {
        window = this; this.destroyed = false;
        this.webContents = Object.assign(new EventEmitter(), {
          isDestroyed: () => this.rendererDestroyed || this.destroyed,
          send: (channel, value) => { if (this.destroyed || this.rendererDestroyed) throw new Error('Object has been destroyed'); delivered.push({ channel, value }); },
          setWindowOpenHandler() {},
        });
      }
      isDestroyed() { return this.destroyed; }
      async loadURL() {}
    },
    ipcMain: { handle() {} }, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
    protocol: { handle() {}, registerSchemesAsPrivileged() {} }, nativeTheme: theme,
    globalShortcut: { register() {}, unregisterAll() {} },
    DesktopApps: class { accept() { return false; } close() {} },
    DesktopAppUse: class {
      constructor(_window, send) { ports.appEvent = send; }
      async start() { return {}; } async close() {} reset() {} accept() {}
    },
    DesktopComputer: class {
      constructor(_path, _profile, send) { ports.computerEvent = send; }
      async stop() {}
    },
    Product: { parse: () => ({ shell: 'app', name: 'Fixture', id: 'fixture', chat: true, required: [] }) },
  };
  const require = createRequire(import.meta.url);
  runInNewContext(bundled.outputFiles[0].text, {
    ports, __dirname: '/tmp/fixture/desktop/dist', process, console, setTimeout, clearTimeout,
    require: name => name === 'node:child_process' ? { spawn: () => host }
      : name === 'node:fs' ? { readFileSync: () => '{}' } : require(name),
  });
  await boot;
  const message = kind => host.stdout.write(JSON.stringify({ version: 1, kind, text: 'en' }) + '\n');
  return { app, host, window, delivered, ports, lifecycle, message };
}

for (const destroyed of ['window', 'renderer']) {
  test(`late Host and service events do not access a destroyed ${destroyed}`, async () => {
    const fixture = await product();
    fixture.message('session_closed'); fixture.message('settings');
    assert.deepEqual(fixture.delivered.map(value => value.channel), ['product:event', 'product:context']);
    if (destroyed === 'window') fixture.window.destroyed = true;
    else fixture.window.rendererDestroyed = true;
    fixture.message('session_closed'); fixture.message('settings');
    fixture.ports.appEvent({ kind: 'session_closed' });
    fixture.ports.computerEvent({ kind: 'computer_status' });
    fixture.host.emit('exit', 0);
    assert.equal(fixture.delivered.length, 2);
    fixture.host.stdout.end(); fixture.host.stderr.end(); fixture.host.emit('close', 0);
  });
}

test('normal and repeated quit wait for owned Host stdio closure, not only exit', async () => {
  const fixture = await product();
  const inputEnded = once(fixture.host.stdin, 'finish');
  assert.equal(fixture.app.quit().defaultPrevented, true);
  await inputEnded;
  assert.equal(fixture.app.quit().defaultPrevented, true, 'repeated quit cannot bypass cleanup');
  fixture.host.emit('exit', 0);
  assert.equal(fixture.app.quit().defaultPrevented, true, 'Host exit alone does not prove drained pipes');
  fixture.message('session_closed');
  assert.equal(fixture.delivered.at(-1).value.kind, 'session_closed', 'final live-window event is delivered');
  const quit = once(fixture.lifecycle, 'quit');
  fixture.host.stdout.end(); fixture.host.stderr.end(); fixture.host.emit('close', 0);
  await quit;
  assert.equal(fixture.window.destroyed, true);
});

test('quit also completes when the owned Host already closed', async () => {
  const fixture = await product();
  fixture.host.emit('exit', 0);
  fixture.host.stdout.end(); fixture.host.stderr.end(); fixture.host.emit('close', 0);
  const quit = once(fixture.lifecycle, 'quit');
  assert.equal(fixture.app.quit().defaultPrevented, true);
  await quit;
});

test('unexpected send errors on a live renderer remain failures', async () => {
  const fixture = await product();
  fixture.window.webContents.send = () => { throw new Error('transport failure'); };
  assert.throws(() => fixture.message('session_closed'), /transport failure/);
  fixture.host.stdout.end(); fixture.host.stderr.end(); fixture.host.emit('close', 0);
});
