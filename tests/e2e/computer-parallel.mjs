// Two real owned AppKit apps. Scope, input and receipts use the loopback MCP endpoint.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { computerFixture, waitFor } from '../fixtures/computer-app.mjs';

if (process.platform !== 'darwin' || process.env.PERO_COMPUTER_NATIVE !== '1')
  throw new Error('Run with PERO_COMPUTER_NATIVE=1 on macOS');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-parallel-'));
const source = resolve(root, 'desktop/src/main');
await build({
  stdin: {
    resolveDir: source,
    contents: `
      export { DesktopComputer } from './computer.ts';
      export { DesktopAppUse } from './app-use-mcp.ts';
      export { ConversationRepl } from './repl/repl.ts';
      export { startJavaScriptRepl } from './repl/javascript.ts';
    `,
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: resolve(temp, 'host.cjs'),
});
await build({ entryPoints: [resolve(source, 'repl/javascript-kernel.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: resolve(temp, 'javascript-repl.cjs') });
const require = createRequire(import.meta.url);
await Promise.all([
  cp(resolve(dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm'), resolve(temp, 'repl-tree-sitter.wasm')),
  cp(require.resolve('tree-sitter-wasms/out/tree-sitter-javascript.wasm'), resolve(temp, 'repl-javascript.wasm')),
]);
const { DesktopComputer, DesktopAppUse, ConversationRepl, startJavaScriptRepl } =
  await import(resolve(temp, 'host.cjs'));
const previews = new Map();
const desktop = new DesktopComputer(process.env.PERO_COMPUTER_BINARY || resolve(root, 'target/debug/pero-computer'),
  resolve(temp, 'journal'), () => {}, { preview: (thread, target) => previews.set(thread, target) });
let selected = 'left';
const bridge = new DesktopAppUse(() => ({ webContents: {
  mainFrame: { frames: [] }, executeJavaScript: async () => selected,
} }), () => {}, resolve(temp, 'evidence'), undefined, desktop, undefined, undefined, undefined,
  new ConversationRepl('javascript', startJavaScriptRepl));

let left, right;
try {
  left = await computerFixture(root, temp, false, { name: 'PeroParallelLeft', background: true });
  right = await computerFixture(root, temp, false, { name: 'PeroParallelRight', background: true });
  const leftId = 'dev.pero.peroparallelleft';
  const rightId = 'dev.pero.peroparallelright';
  await desktop.restore(true, [leftId, rightId]);
  const settings = await desktop.status();
  assert.equal(settings.status.accessibility, 'granted', settings.status.message);
  const env = await bridge.start();
  for (const thread_id of ['left', 'right', 'idle']) {
    bridge.accept({ kind: 'session_created', thread_id, data: { agent: 'fixture' } });
    if (thread_id !== 'idle') bridge.accept({ kind: 'turn_started', thread_id });
  }
  bridge.authority.select(selected);
  const rpc = async (thread, name, args) => {
    const response = await fetch(env.PERO_APP_USE_URL, { method: 'POST', headers: {
      Authorization: `Bearer ${env.PERO_APP_USE_TOKEN}`, 'X-Pero-Thread': thread, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  const tool = (thread, request) => rpc(thread, 'computer_use', request);
  const result = async (thread, request) => {
    const reply = await tool(thread, request);
    assert.equal(reply.isError, false, JSON.stringify(reply.content));
    return JSON.parse(reply.content[0].text);
  };
  const rejected = async (thread, request, code) => {
    const reply = await tool(thread, request);
    assert.equal(reply.isError, true, JSON.stringify(reply.content));
    assert.match(reply.content[0].text, new RegExp('^' + code + ':'));
  };
  const list = thread => result(thread, { operation: 'targets' });
  const targets = await list('left');
  const other = await list('right');
  assert.notEqual(targets.capabilities.runtime_id, other.capabilities.runtime_id);
  const target = (entries, id) => entries.targets.find(item => item.application_id === id).reference;
  const onLeft = target(targets, leftId);
  const leftFromRight = target(other, leftId);
  const onRight = target(other, rightId);
  const observe = (thread, target) => result(thread, { operation: 'observe', target, options: { want_image: false } });
  const first = (await observe('left', onLeft)).observation;
  await rejected('right', { operation: 'observe', target: leftFromRight }, 'busy');
  await rejected('right', { operation: 'observe', target: onLeft }, 'target_unavailable');
  await rejected('idle', { operation: 'targets' }, 'APP_SESSION_INACTIVE');
  const second = (await observe('right', onRight)).observation;

  const action = (id, observation, input, delivery = 'background') => ({ operation: 'act', action: {
    request_id: id, target: observation.target, observation_id: observation.id, delivery, input,
  } });
  const anchor = (observation, label) => ({ kind: 'element', element_id:
    observation.elements.find(item => item.label === label).id });
  const hold = (observation, id, duration) => action(id, observation, {
    kind: 'hold', anchor: anchor(observation, 'Gesture canvas'), button: 'middle', hold_ms: duration,
  });
  const focus = action('focus-right', second, { kind: 'focus_window' }, 'foreground');
  await rejected('right', focus, 'APP_SESSION_INACTIVE');

  const leftInput = tool('left', hold(first, 'hold-left', 10000));
  await waitFor(async () => (await left.state()).mouseEvents.middleDown === 1, 'left button-down');
  const leftPreview = previews.get('left').id;
  const rightPreview = previews.get('right').id;
  assert.equal((await bridge.computerPreview('left', leftPreview)).kind, 'waiting');
  assert.equal((await bridge.computerPreview('right', rightPreview)).kind, 'ended');
  selected = 'right';
  bridge.authority.select(selected);
  assert.ok((await bridge.computerPreview('right', rightPreview)).image, 'The selected preview uses the independent worker');
  assert.equal((await bridge.computerPreview('left', leftPreview)).kind, 'ended');
  await rejected('right', focus, 'busy');

  selected = 'left';
  bridge.authority.select(selected);
  const click = action('click-right', second, {
    kind: 'click', anchor: anchor(second, 'Increment'), button: 'left', count: 1,
  });
  const repl = await rpc('right', 'javascript_repl', { code: `
    let reply = await cua.computer(${JSON.stringify(click)});
    nodeRepl.write(reply.receipt.outcome.status);
  ` });
  assert.equal(repl.isError, false, JSON.stringify(repl.content));
  assert.match(repl.content[0].text, /executed/);
  await waitFor(async () => (await right.state()).count === 1, 'right click while left is holding');
  assert.equal((await left.state()).mouseEvents.middleUp ?? 0, 0, 'The background click completed before left input ended');
  assert.equal((await desktop.status()).running, true, 'One completed call does not hide other active input');

  const rightAfter = (await observe('right', onRight)).observation;
  const rightInput = tool('right', hold(rightAfter, 'hold-right', 2400));
  await waitFor(async () => (await right.state()).mouseEvents.middleDown === 1, 'right button-down');
  assert.equal((await result('left', { operation: 'stop' })).kind, 'stopped');
  assert.equal((await leftInput).isError, true);
  await waitFor(async () => (await left.state()).mouseEvents.middleUp === 1, 'left release after stop');
  const unknown = JSON.parse((await tool('left', { operation: 'receipt', request_id: 'hold-left' })).content[0].text);
  assert.equal(unknown.receipt.outcome.status, 'unknown');
  assert.equal((await rightInput).isError, false);
  await waitFor(async () => (await right.state()).mouseEvents.middleUp === 1, 'right release after completing input');
  assert.equal((await observe('right', leftFromRight)).observation.target.target_id, leftFromRight.target_id);

  bridge.accept({ kind: 'turn_finished', thread_id: 'right' });
  await desktop.endThread('right');
  await rejected('right', { operation: 'targets' }, 'APP_SESSION_INACTIVE');
  const current = target(await list('left'), leftId);
  assert.notEqual(current.runtime_id, onLeft.runtime_id);
  const latestLeft = (await observe('left', current)).observation;
  bridge.accept({ kind: 'turn_started', thread_id: 'right' });
  const currentRight = target(await list('right'), rightId);
  const latestRight = (await observe('right', currentRight)).observation;
  const revokeLeft = tool('left', hold(latestLeft, 'revoke-left', 10000));
  const keepRight = tool('right', hold(latestRight, 'keep-right', 2400));
  await waitFor(async () => (await left.state()).mouseEvents.middleDown === 2 &&
    (await right.state()).mouseEvents.middleDown === 2, 'both button-downs before revocation');
  await desktop.restore(true, [rightId]);
  assert.equal((await revokeLeft).isError, true);
  await waitFor(async () => (await left.state()).mouseEvents.middleUp === 2, 'revocation released the held button');
  assert.equal((await keepRight).isError, false);
  await waitFor(async () => (await right.state()).mouseEvents.middleUp === 2, 'the unrelated button was released normally');
  assert.equal((await list('right')).capabilities.runtime_id, currentRight.runtime_id);
  assert.deepEqual((await list('right')).targets.map(target => target.application_id), [rightId]);
  console.log('Parallel macOS Computer Use passed across MCP and REPL: separate apps overlapped, selection changes preserved background input, same-app input was excluded, and stopping one turn released only its worker.');
} finally {
  await bridge.close();
  await right?.close();
  await left?.close();
  await rm(temp, { recursive: true, force: true });
}
