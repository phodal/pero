import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../protocol/generated/computer-response.schema.json' with { type: 'json' };
import type { ComputerRequest } from '../../../protocol/generated/computer-request';
import type { ComputerResponse, ComputerWorkerResponse, ComputerError } from '../../../protocol/generated/computer-response';

const ajv = new Ajv2020({ strict: true });
ajv.addSchema(schema);
const validReply = ajv.getSchema<ComputerWorkerResponse>(`${schema.$id}#/$defs/ComputerWorkerResponse`)!;

export class ComputerFailure extends Error {
  constructor(readonly detail: ComputerError, readonly dispatched = false) { super(detail.message); }
}
/** Owns exactly one native process and serializes its private NDJSON stream. */
export class ComputerClient {
  private child?: ChildProcessWithoutNullStreams;
  private closing?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: { id: string; dispatched: boolean; resolve(value: ComputerResponse): void; reject(error: Error): void; dispose(): void };
  constructor(private binary: string, private args: string[] = []) {}

  request(thread: string, request: ComputerRequest, signal: AbortSignal): Promise<ComputerResponse> {
    const result = this.queue.then(async () => {
      await this.closing;
      signal.throwIfAborted();
      if (!this.child) this.start();
      const child = this.child!;
      return new Promise<ComputerResponse>((resolve, reject) => {
        const abort = () => { void this.stop('cancelled').catch(() => {}); };
        const timer = setTimeout(() => { void this.stop('timeout').catch(() => {}); }, 30_000);
        const id = randomUUID();
        this.pending = { id, dispatched: child.pid !== undefined, resolve, reject, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
        signal.addEventListener('abort', abort, { once: true });
        child.stdin.write(JSON.stringify({ id, thread, request }) + '\n', error => {
          if (error) void this.stop('failed').catch(() => {});
        });
      });
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private start() {
    const child = spawn(this.binary, this.args, { stdio: 'pipe', env: { ...process.env, PERO_COMPUTER_HOST_PID: String(process.pid) } });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) { void this.stop('failed').catch(() => {}); return; }
      let at: number;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        try {
          const parsed: unknown = JSON.parse(line);
          if (!validReply(parsed)) throw new Error('Invalid native Computer Use reply');
          const value = parsed as ComputerWorkerResponse;
          if (!this.pending || value.id !== this.pending.id) throw new Error('Invalid native Computer Use reply');
          const pending = this.pending; this.pending = undefined; pending.dispose();
          if ('error' in value) pending.reject(new ComputerFailure(value.error, true));
          else pending.resolve(value.value);
        } catch {
          void this.stop('failed').catch(() => {});
        }
      }
    });
    child.stderr.on('data', data => console.error(String(data)));
    const stopped = () => {
      if (this.child !== child) return;
      this.child = undefined;
      const pending = this.pending; this.pending = undefined;
      pending?.dispose();
      pending?.reject(new ComputerFailure({ code: 'failed', message: 'The native desktop connection closed. Observe again before continuing.' }, pending.dispatched));
    };
    child.once('error', stopped);
    child.once('exit', stopped);
  }
  stop(reason: 'cancelled' | 'timeout' | 'failed' = 'cancelled'): Promise<void> {
    if (this.closing) return this.closing;
    const child = this.child;
    this.child = undefined;
    const pending = this.pending; this.pending = undefined;
    pending?.dispose();
    pending?.reject(new ComputerFailure({ code: reason, message: 'Native work was interrupted. Input may have happened; inspect its receipt and observe again.' }, pending.dispatched));
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    this.closing = new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 1500);
      const deadline = setTimeout(() => reject(new Error('Native desktop process exit is unconfirmed')), 4000);
      child.once('exit', () => { clearTimeout(force); clearTimeout(deadline); this.closing = undefined; resolve(); });
      child.kill('SIGTERM');
    });
    return this.closing;
  }
}
