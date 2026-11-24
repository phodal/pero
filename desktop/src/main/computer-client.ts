import { startComputerProcess, type ComputerProcess } from './computer-process.ts';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../protocol/generated/computer-response.schema.json' with { type: 'json' };
import type { ComputerPreviewRequest, ComputerRequest, ComputerWorkerOperation, ComputerWorkerRequest } from '../../../protocol/generated/computer-request';
import type { ComputerAppshotResponse, ComputerPreviewResponse, ComputerResponse, ComputerWorkerResponse, ComputerWorkerValue, ComputerError } from '../../../protocol/generated/computer-response';

const ajv = new Ajv2020({ strict: true });
ajv.addSchema(schema);
const validReply = ajv.getSchema<ComputerWorkerResponse>(`${schema.$id}#/$defs/ComputerWorkerResponse`)!;

export class ComputerFailure extends Error {
  readonly detail: ComputerError;
  readonly dispatched: boolean;
  constructor(detail: ComputerError, dispatched = false) { super(detail.message); this.detail = detail; this.dispatched = dispatched; }
}
/** Owns exactly one native process and serializes its private NDJSON stream. */
export class ComputerClient {
  private binary: string;
  private args: string[];
  private connection?: ComputerProcess;
  private starting?: { controller: AbortController; ready: Promise<void> };
  private closing?: Promise<void>;
  private exiting?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private pending?: { id: string; dispatched: boolean; resolve(value: ComputerWorkerValue): void; reject(error: Error): void; dispose(): void };
  constructor(binary: string, args: string[] = []) { this.binary = binary; this.args = args; }

  async request(thread: string, request: ComputerRequest, signal: AbortSignal, allowedApplications?: string[]): Promise<ComputerResponse> {
    const value = await this.send(thread, request, signal, allowedApplications);
    if (value.kind === 'appshot' || value.kind === 'preview_frame') throw new Error('Unexpected Computer Use reply');
    return value;
  }

  async appshot(foreground_pid: number, signal: AbortSignal): Promise<ComputerAppshotResponse> {
    const value = await this.send('user-appshot', { operation: 'appshot', foreground_pid }, signal);
    if (value.kind !== 'appshot') throw new Error('Invalid Appshot reply');
    return value;
  }

  async preview(thread: string, target: ComputerPreviewRequest['target'], signal: AbortSignal, allowedApplications: string[]): Promise<ComputerPreviewResponse | undefined> {
    if (!this.connection) throw new ComputerFailure({ code: 'target_unavailable', message: 'The preview worker has closed.' });
    if (this.queued) return undefined;
    const value = await this.send(thread, { operation: 'preview_frame', target }, signal, allowedApplications);
    if (value.kind !== 'preview_frame') throw new Error('Invalid Computer Use preview reply');
    return value;
  }

  private send(thread: string, request: ComputerWorkerOperation, signal: AbortSignal, allowedApplications?: string[]): Promise<ComputerWorkerValue> {
    this.queued++;
    const result = this.queue.then(async () => {
      await this.closing;
      signal.throwIfAborted();
      if (!this.connection) {
        if (request.operation === 'preview_frame')
          throw new ComputerFailure({ code: 'target_unavailable', message: 'The preview worker has closed.' });
        const controller = new AbortController();
        const startup = AbortSignal.any([controller.signal, signal]);
        const ready = this.start(startup);
        this.starting = { controller, ready };
        try {
          await ready;
          startup.throwIfAborted();
        } finally {
          this.starting = undefined;
        }
      }
      signal.throwIfAborted();
      const connection = this.connection;
      if (!connection) throw new ComputerFailure({ code: 'cancelled', message: 'Computer Use was interrupted before dispatch.' });
      return new Promise<ComputerWorkerValue>((resolve, reject) => {
        const abort = () => { void this.stop('cancelled').catch(() => {}); };
        const timer = setTimeout(() => { void this.stop('timeout').catch(() => {}); }, 30_000);
        const id = randomUUID();
        this.pending = { id, dispatched: true, resolve, reject, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
        signal.addEventListener('abort', abort, { once: true });
        const envelope: ComputerWorkerRequest = { id, thread, request, allowed_applications: allowedApplications };
        connection.input.write(JSON.stringify(envelope) + '\n', error => {
          if (error) void this.stop('failed').catch(() => {});
        });
      });
    }).finally(() => { this.queued--; });
    this.queue = result.catch(() => {});
    return result;
  }
  private async start(signal: AbortSignal) {
    let connection: ComputerProcess;
    try {
      connection = await startComputerProcess(this.binary, this.args, signal);
    } catch (error) {
      throw new ComputerFailure({ code: signal.aborted ? 'cancelled' : 'failed', message: error instanceof Error ? error.message : String(error) });
    }
    this.connection = connection;
    let buffer = '';
    connection.output.setEncoding('utf8');
    connection.output.on('data', chunk => {
      if (this.connection !== connection) return;
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
    const stopped = () => {
      if (this.connection !== connection) return;
      this.connection = undefined;
      const pending = this.pending; this.pending = undefined;
      pending?.dispose();
      pending?.reject(new ComputerFailure({ code: 'failed', message: 'The native desktop connection closed. Observe again before continuing.' }, pending.dispatched));
    };
    void connection.exited.then(stopped);
  }
  drained(): Promise<void> {
    return this.exiting ?? Promise.resolve();
  }
  stop(reason: 'cancelled' | 'timeout' | 'failed' = 'cancelled'): Promise<void> {
    if (this.closing) return this.closing;
    const starting = this.starting;
    if (starting) {
      starting.controller.abort();
      return starting.ready.then(() => { this.starting = undefined; return this.stop(reason); }, () => {});
    }
    const connection = this.connection;
    this.connection = undefined;
    this.exiting = connection?.exited;
    const pending = this.pending; this.pending = undefined;
    pending?.dispose();
    pending?.reject(new ComputerFailure({ code: reason, message: 'Native work was interrupted. Input may have happened; inspect its receipt and observe again.' }, pending.dispatched));
    if (!connection) return Promise.resolve();
    this.closing = new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => connection.kill(), 1500);
      const deadline = setTimeout(() => reject(new Error('Native desktop process exit is unconfirmed')), 4000);
      void connection.exited.then(() => { clearTimeout(force); clearTimeout(deadline); this.closing = undefined; this.exiting = undefined; resolve(); });
      // EOF asks the native worker to cancel and release held input before exit.
      connection.input.end();
    });
    return this.closing;
  }
}
