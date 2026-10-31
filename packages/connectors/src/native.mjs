// Native shell composition. Same manager and MCP authority as Electron Main.
import { createInterface } from 'node:readline';
import { HostConnectors } from './host.mjs';
import { ConnectorMcp } from './mcp.ts';

// stdout carries private protocol replies; management diagnostics use stderr.
console.log = console.error;

const [root, executable, helpers] = process.argv.slice(2);
const pending = new Map();
let next = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
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
let closing;
const close = () => closing ??= (async () => {
  for (const promise of pending.values()) promise.reject(Object.assign(new Error('MCP_CONTROL_DISPOSED'), { code: 'MCP_CONTROL_DISPOSED' }));
  pending.clear();
  await mcp.close();
  process.exit(0);
})();
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
    mcp.accept(message.event);
  } else if (message.shutdown) {
    void close();
  } else if (message.id) {
    void owner.request(message.request).then(
      value => send({ id: message.id, value }),
      () => send({ id: message.id, value: { ok: false, code: 'MCP_OPERATION_FAILED' } }),
    );
  }
});
await owner.start();
send({ ready: await mcp.start() });
