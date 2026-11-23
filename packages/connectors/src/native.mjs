import { NotebookInspector } from '../../../desktop/src/main/notebook-inspector.ts';
import { fileURLToPath } from 'node:url';
// Native shell composition. Same manager and MCP authority as Electron Main.
import { createInterface } from 'node:readline';
import { HostConnectors } from './host.mjs';
import { DesktopComputer } from '../../../desktop/src/main/computer.ts';
import { DesktopAppUse } from '../../../desktop/src/main/app-use-mcp.ts';
import { AppWriteRoutes } from '../../../desktop/src/main/app-write-routes.ts';
import { join, dirname } from 'node:path';
import { NativeBrowserUse } from '../../../desktop/src/main/browser-use/native-use.ts';
import { ConnectorMcp } from './mcp.ts';
import { ConversationRepl } from '../../../desktop/src/main/repl/repl.ts';
import { pythonRepl } from '../../../desktop/src/main/repl/python.ts';

// stdout carries private protocol replies; management diagnostics use stderr.
console.log = console.error;

const [root, executable, helpers, computerExecutable, bundledPython] = process.argv.slice(2);
const pending = new Map();
let next = 0;
const send = value => {
  if (!closing && !process.stdout.destroyed) process.stdout.write(JSON.stringify(value) + '\n');
};
const effect = (action, fields = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, { resolve, reject });
  send({ effect: action, id, ...fields });
});
const owner = new HostConnectors({ root, executable, helpers, nodeExecutable: process.execPath,
  authorize: () => effect('authorize'), openURL: url => effect('open', { url }),
  store: {
    read: key => effect('secret.read', { key }),
    write: (key, value) => effect('secret.write', { key, value }),
    remove: key => effect('secret.remove', { key }),
  },
});
const mcp = new ConnectorMcp(owner);
const routes = new AppWriteRoutes((action, fields = {}) => effect('apps', { value: { action, ...fields } }),
  event => effect('surface', { value: { action: 'written', event } }), fetch);
const computer = new DesktopComputer(computerExecutable, join(dirname(root), 'computer-use'),
  event => send({ id: 0, computer_state: event.data }), {
    save: async enabled => {
      await effect('computer.settings', { value: enabled });
      await computer.restore(enabled);
    },
  });
const browser = process.platform === 'darwin'
  ? new NativeBrowserUse(request => effect('surface', { value: { action: 'browser', ...request } }),
    join(dirname(root), 'browser-use-evidence'))
  : undefined;
const appUse = new DesktopAppUse({
  selectedThread: () => effect('surface', { value: { action: 'selected' } }),
  page: (scope, request) => effect('surface', { value: { action: 'page', scope, request } }),
  capture: async () => { throw new Error('Native App capture is unavailable'); },
  presence: () => {},
}, () => {}, join(dirname(root), 'app-evidence'), { describe: () => routes.describe(), apply: (write, signal, goal) => routes.apply(write, signal, goal) }, computer,
  (thread, artifact) => effect('artifact', { value: { ...artifact, thread_id: thread } }), new NotebookInspector(dirname(fileURLToPath(import.meta.url))), browser,
  process.platform === 'darwin' ? new ConversationRepl('python', pythonRepl(helpers, bundledPython)) : undefined);

let closing;
const close = () => closing ??= (async () => {
  for (const promise of pending.values()) promise.reject(Object.assign(new Error('MCP_CONTROL_DISPOSED'), { code: 'MCP_CONTROL_DISPOSED' }));
  pending.clear();
  await appUse.close();
  await mcp.close();
  process.exit(0);
})();
// The native shell may close its pipe before the helper finishes draining.
process.stdout.on('error', error => {
  if (error.code === 'EPIPE') void close();
  else throw error;
});
process.once('SIGTERM', close);
process.once('SIGINT', close);
const input = createInterface({ input: process.stdin });
input.once('close', close);
input.on('line', line => {
  const message = JSON.parse(line);
  if ('reply' in message) {
    const promise = pending.get(message.reply);
    pending.delete(message.reply);
    if (message.ok) promise?.resolve(message.value);
    else promise?.reject(Object.assign(new Error(message.code), { code: message.code }));
  } else if (message.event) {
    if (message.event.kind === 'computer_settings') {
      void computer.restore(message.event.data.enabled).then(() => computer.status()).catch(console.error);
    } else {
      mcp.accept(message.event);
      appUse.accept(message.event);
    }
  } else if (message.computer) {
    void computer.command(message.computer).catch(console.error);
  } else if (message.command) {
    const command = message.command;
    if (command.action === 'app_use_selection') appUse.authority.select(command.thread_id || undefined);
    else appUse.command(command);
  } else if (message.shutdown) {
    void close();
  } else if (message.id) {
    const request = message.request;
    const result = request?.operation === 'app-context'
      ? appUse.draftContext.freeze(request.scope, request.thread, request.options)
      : request?.operation === 'chrome-relay-pair'
        ? appUse.chromeRelay.pairing(request.label, request.thread).then(code => ({ ok: true, code }),
          error => ({ ok: false, message: error.message }))
        : request?.operation === 'chrome-relay-stop'
          ? Promise.resolve(appUse.chromeRelay.revoke()).then(() => ({ ok: true }))
          : owner.request(request);
    void result.then(
      value => send({ id: message.id, value }),
      error => send({ id: message.id, value: { ok: false, code: 'MCP_OPERATION_FAILED', ...(message.request?.operation === 'app-context' ? { message: String(error.message) } : {}) } }),
    );
  }
});
await owner.start();
send({ ready: { ...await mcp.start(), ...await appUse.start() } });
