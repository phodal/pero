import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_PARALLEL_REQUESTS } from '../../../../packages/chrome-extension/src/protocol.ts';
import { AppUseError } from '../app-use-task.ts';

export type ReplCapability = 'browser' | 'computer';
type Image = { type: 'image'; data: string; mimeType: string };
type Content = { type: 'text'; text: string } | Image;
export type CuaResult = { value: object; image?: Image; isError: boolean };
export type ReplCommand =
  | { type: 'exec'; id: string; code: string }
  | { type: 'reply'; id: string; result: { value?: unknown; error?: string } };
export type ReplEvent =
  | { type: 'call'; cell: string; id: string; capability: ReplCapability; input: unknown }
  | { type: 'write'; cell: string; text: string }
  | { type: 'image'; cell: string; id: string }
  | { type: 'done'; cell: string; error?: string };
export type ReplProcess = { send(message: ReplCommand): void; stop(): void };
export type StartRepl = (
  receive: (event: ReplEvent) => void, fail: (error: Error) => void,
) => ReplProcess | Promise<ReplProcess>;

const execute = z.strictObject({
  code: z.string().min(1).max(64 * 1024),
  timeout_ms: z.number().int().min(1).max(60_000).optional(),
  title: z.string().max(160).optional(),
});
const reset = z.strictObject({});
type Session = {
  process?: Promise<ReplProcess>;
  active?: {
    controller: AbortController;
    receive(event: ReplEvent): Promise<void>;
    fail(error: Error): void;
  };
};
const MAX_TEXT = 32 * 1024;

export class ConversationRepl {
  private readonly sessions = new Map<string, Session>();
  readonly tool;
  readonly resetTool;
  private readonly start: StartRepl;

  constructor(language: 'javascript' | 'python', start: StartRepl) {
    this.start = start;
    const javascript = language === 'javascript';
    this.tool = {
      name: javascript ? 'javascript_repl' : 'python_repl',
      description: javascript
        ? 'Run JavaScript in the current Electron conversation. Top-level bindings and await are supported. Call await cua.browser(request) or await cua.computer(request) with the browser_use or computer_use input schema. Use nodeRepl.write(value) for output and nodeRepl.emitImage(result) for an image from this cell. There are no Node imports. Await actions in order on each tab and reobserve after input. Separate calls with explicit Chrome tab IDs can run together. Authorization and receipts belong to the existing tools.'
        : 'Run Python in the current Native conversation. Names and top-level await are supported. Call await cua.browser(request) or await cua.computer(request) with the browser_use or computer_use input schema. Use print(value) for output and cua.emit_image(result) for an image from this cell. Await actions in order on each tab and reobserve after input. Separate calls with explicit Chrome tab IDs can run together. Authorization and receipts belong to the existing tools.',
      inputSchema: z.toJSONSchema(execute, { target: 'draft-7' }),
    };
    this.resetTool = {
      name: `${this.tool.name}_reset`,
      description: 'Stop execution and discard the current conversation’s REPL bindings. Actions already sent to the browser or desktop may have taken effect.',
      inputSchema: z.toJSONSchema(reset, { target: 'draft-7' }),
    };
  }

  forget(thread?: string) {
    const sessions = thread === undefined ? [...this.sessions] : [[thread, this.sessions.get(thread)]] as const;
    for (const [key, session] of sessions) {
      this.sessions.delete(key);
      session?.active?.controller.abort(new Error('REPL reset. Observe the target before retrying any action.'));
      void session?.process?.then(process => process.stop(), () => {});
    }
  }

  async call(thread: string, name: string, input: unknown, signal: AbortSignal,
    invoke: (capability: ReplCapability, input: unknown, signal: AbortSignal) => Promise<CuaResult>,
  ) {
    if (name === this.resetTool.name) {
      reset.parse(input);
      this.forget(thread);
      return { content: [{ type: 'text', text: 'REPL bindings cleared.' }], isError: false };
    }
    const { code, timeout_ms = 30_000 } = execute.parse(input);
    const session: Session = this.sessions.get(thread) ?? {};
    if (session.active) throw new AppUseError('REPL_BUSY', 'Wait for the current REPL cell or reset it.');
    this.sessions.set(thread, session);
    const controller = new AbortController();
    const bounded = AbortSignal.any([signal, controller.signal]);
    const cell = randomUUID();
    const content: Content[] = [];
    const images = new Map<string, Image>();
    let textBytes = 0;
    let imageBytes = 0;
    let truncated = false;
    const pending = new Set<string>();
    let finished = false;
    const write = (text: string) => {
      const remaining = MAX_TEXT - textBytes;
      if (remaining === 0) { truncated = true; return; }
      const bytes = Buffer.from(text);
      textBytes += Math.min(remaining, bytes.length);
      truncated ||= remaining < bytes.length;
      if (!bytes.length) return;
      const slice = bytes.subarray(0, remaining).toString('utf8');
      const last = content.at(-1);
      if (last?.type === 'text') last.text += slice;
      else content.push({ type: 'text', text: slice });
    };
    const timer = setTimeout(() => {
      controller.abort(new Error('REPL cell timed out. Bindings cleared. Observe the target before retrying any action.'));
    }, timeout_ms);
    try {
      const error = await new Promise<string | undefined>((resolve, reject) => {
        const receive = async (event: ReplEvent) => {
          if (event.cell !== cell || finished || bounded.aborted) return;
          if (event.type === 'write') write(event.text);
          if (event.type === 'image') {
            const image = images.get(event.id);
            if (image) {
              content.push(image);
              images.delete(event.id);
            }
          }
          if (event.type === 'done') {
            if (pending.size) {
              controller.abort(new Error('REPL ended with an unawaited action. Bindings cleared. Observe the target before retrying.'));
              return;
            }
            finished = true;
            resolve(event.error);
          }
          if (event.type !== 'call') return;
          const process = await session.process!;
          if (bounded.aborted || finished) return;
          const send = (result: Extract<ReplCommand, {type:'reply'}>['result']) =>
            process.send({ type: 'reply', id: event.id, result });
          const input = event.input;
          const target = event.capability === 'browser' && input && typeof input === 'object' &&
            'tabId' in input && typeof input.tabId === 'string' && input.tabId.startsWith('chrome:') ? input.tabId : '';
          if (pending.has(target) || pending.has('') || (!target && pending.size) || pending.size >= MAX_PARALLEL_REQUESTS) {
            const error = target && pending.has(target)
              ? 'A Browser Use operation is already in progress for this target.'
              : 'Await each browser or computer call before starting the next one.';
            send({ error });
            return;
          }
          pending.add(target);
          let reply;
          try {
            const result = await invoke(event.capability, event.input, bounded);
            const image = result.image;
            let imageId;
            if (image && image.data.length + imageBytes <= 10 * 1024 * 1024 && images.size < 4) {
              imageBytes += image.data.length;
              imageId = event.id;
              images.set(imageId, image);
            }
            reply = { value: { ...result.value, ...(imageId && { imageId }) },
              ...(result.isError && { error: 'The action failed. Inspect the attached result before retrying.' }) };
          } catch (failure) {
            reply = { error: failure instanceof Error ? failure.message : String(failure) };
          } finally {
            pending.delete(target);
          }
          if (!bounded.aborted && !finished) send(reply);
        };
        // The process persists, while the listener belongs to the current cell.
        // Update the session listener on each call instead of accumulating listeners.
        session.active = { controller, receive, fail: reject };
        bounded.addEventListener('abort', () => reject(bounded.reason), { once: true });
        if (bounded.aborted) { reject(bounded.reason); return; }
        session.process ??= Promise.resolve().then(() => this.start(
          event => {
            const active = session.active;
            if (active) void active.receive(event).catch(active.fail);
          },
          failure => {
            session.active?.fail(failure);
            if (this.sessions.get(thread) === session) this.forget(thread);
          },
        ));
        void session.process.then(process => {
          if (!bounded.aborted) process.send({ type: 'exec', id: cell, code });
        }).catch(reject);
      });
      if (error) write(content.length ? '\n' + error : error);
      if (truncated) content.push({ type: 'text', text: 'REPL output truncated.' });
      if (!content.length) content.push({ type: 'text', text: 'Cell completed.' });
      return { content, isError: !!error };
    } catch (failure) {
      if (this.sessions.get(thread) === session) this.forget(thread);
      throw new AppUseError('REPL_INTERRUPTED', failure instanceof Error ? failure.message : String(failure));
    } finally {
      clearTimeout(timer);
      session.active = undefined;
    }
  }

}
