// Cell compilation ports Qwen Code 36fc21f5d83272489e173fe697bac13c62baa732 from packages/node-repl.
import { parentPort } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { prepareNodeReplCell, type NodeReplBindingDescriptor } from './qwen/cell-transform.ts';
import type { ReplCommand, ReplEvent } from './repl.ts';

const port = parentPort!;
const send = (message: ReplEvent) => port.postMessage(message);

async function run() {
  const engine = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(48 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const vm = runtime.newContext();
  let bindings: readonly NodeReplBindingDescriptor[] = [];
  let previous = vm.newObject(vm.null);
  let cell = '';
  let serial = 0;
  let output = 0;
  const replies = new Map<string, QuickJSDeferredPromise>();

  const define = (name: string, fn: Parameters<typeof vm.newFunction>[1]) =>
    vm.newFunction(name, fn).consume(handle => vm.setProp(vm.global, name, handle));
  define('__write', value => {
    const text = vm.getString(value);
    if (!cell || output >= 32 * 1024) return;
    output += text.length;
    send({ type: 'write', cell, text: text.slice(0, 32 * 1024) + '\n' });
  });
  define('__image', value => {
    if (cell) send({ type: 'image', cell, id: vm.getString(value) });
  });
  define('__call', (tool, value) => {
    const capability = vm.getString(tool);
    const input = vm.getString(value);
    if (!cell || (capability !== 'browser' && capability !== 'computer') || input.length > 64 * 1024)
      throw new Error('Invalid REPL tool request.');
    const id = `${cell}:${++serial}`;
    const reply = vm.newPromise();
    replies.set(id, reply);
    send({ type: 'call', cell, id, capability, input: JSON.parse(input) });
    return reply.handle;
  });
  vm.unwrapResult(vm.evalCode(`
    (() => {
      const call = __call, write = __write, image = __image;
      delete globalThis.__call; delete globalThis.__write; delete globalThis.__image;
      const stringify = JSON.stringify, parse = JSON.parse;
      const invoke = async (name, request) => {
        const reply = parse(await call(name, stringify(request)));
        if (reply.error) throw Object.assign(new Error(reply.error), {result: reply.value});
        return reply.value;
      };
      const print = (...values) => write(values.map(v => typeof v === 'string' ? v : stringify(v) ?? String(v)).join(' '));
      Object.defineProperties(globalThis, {
        cua: {value: Object.freeze({
          browser: input => invoke('browser', input),
          computer: input => invoke('computer', input),
        })},
        nodeRepl: {value: Object.freeze({
          write: print,
          emitImage: result => { if (!result?.imageId) throw new Error('This result has no image.'); image(result.imageId); },
        })},
        console: {value: Object.freeze({log: print, info: print, warn: print, error: print})},
      });
    })();
  `)).dispose();

  const pump = () => {
    const result = runtime.executePendingJobs();
    if (result.error) result.error.dispose();
  };

  port.on('message', async (message: ReplCommand) => {
    if (message.type === 'reply') {
      const reply = replies.get(message.id);
      if (!reply) return;
      replies.delete(message.id);
      vm.newString(JSON.stringify(message.result)).consume(value => reply.resolve(value));
      reply.dispose();
      pump();
      return;
    }
    cell = message.id;
    output = 0;
    let error: string | undefined;
    try {
      const prepared = await prepareNodeReplCell(message.code, { previousBindings: bindings, cellId: cell });
      const finish = vm.newFunction('finish', (table, partial) => {
        const next = vm.newObject(vm.null);
        const names: NodeReplBindingDescriptor[] = [];
        for (const binding of prepared.bindings) {
          vm.getProp(table, binding.name).consume(entry => {
            if (vm.typeof(entry) !== 'object') return;
            if (vm.eq(partial, vm.true)) {
              vm.getProp(entry, 'binding').consume(ref => vm.setProp(next, binding.name, ref));
            } else vm.setProp(next, binding.name, entry);
            names.push(binding);
          });
        }
        previous.dispose();
        previous = next;
        bindings = names;
      });
      let completion;
      try {
        const fn = vm.unwrapResult(vm.evalCode(prepared.source, 'cell.js', { type: 'global' }));
        completion = fn.consume(handle => vm.unwrapResult(vm.callFunction(handle, vm.undefined, previous, finish)));
      } finally {
        finish.dispose();
      }
      const result = completion.consume(handle => vm.resolvePromise(handle));
      pump();
      vm.unwrapResult(await result).dispose();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    send({ type: 'done', cell, error });
    cell = '';
  });
}
void run();
