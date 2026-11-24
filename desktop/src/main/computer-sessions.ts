import type { ComputerAction, ComputerDelivery, ComputerTargetRef } from '../../../protocol/generated/computer-action';
import type { ComputerResponse, ComputerTarget } from '../../../protocol/generated/computer-response';
import { ComputerClient, ComputerFailure } from './computer-client.ts';

function targetKey(target: ComputerTargetRef) {
  return `${target.runtime_id}\0${target.target_id}`;
}

/** Ephemeral native handles and cancellation for one running conversation. */
export class ComputerSession {
  readonly controller = new AbortController();
  readonly applications = new Set<string>();
  closing?: Promise<void>;
  private readonly targets = new Map<string, { application: string; title: string }>();
  private runtime?: string;

  readonly client: ComputerClient;
  constructor(client: ComputerClient) { this.client = client; }

  application(target: ComputerTargetRef): string {
    return this.window(target).application;
  }

  window(target: ComputerTargetRef) {
    const window = this.targets.get(targetKey(target));
    if (!window) throw new ComputerFailure({
      code: 'target_unavailable', message: 'List targets again in this conversation.',
    });
    return window;
  }

  remember(result: ComputerResponse) {
    const remember = (target: ComputerTarget) => {
      if (target.reference.runtime_id !== this.runtime) {
        this.targets.clear();
        this.runtime = target.reference.runtime_id;
      }
      if (target.application_id)
        this.targets.set(targetKey(target.reference), { application: target.application_id, title: target.title });
    };
    if (result.kind === 'targets') {
      if (result.capabilities.runtime_id !== this.runtime) this.targets.clear();
      this.runtime = result.capabilities.runtime_id;
      for (const target of result.targets) remember(target);
    } else if (result.kind === 'opened' && result.target) {
      remember(result.target);
    }
  }
}

/** App ownership spans observation and input. Foreground delivery has exclusive input. */
export class ComputerSessions {
  private readonly sessions = new Map<string, ComputerSession>();
  private readonly owners = new Map<string, ComputerSession>();
  private readonly input = new Map<symbol, ComputerDelivery>();

  private readonly createClient: () => ComputerClient;
  constructor(createClient: () => ComputerClient) { this.createClient = createClient; }

  async session(thread: string, signal: AbortSignal): Promise<ComputerSession> {
    let session = this.sessions.get(thread);
    if (session?.closing) {
      await session.closing;
      session = this.sessions.get(thread);
    }
    signal.throwIfAborted();
    if (session) return session;
    session = new ComputerSession(this.createClient());
    this.sessions.set(thread, session);
    return session;
  }

  claim(session: ComputerSession, application: string) {
    session.controller.signal.throwIfAborted();
    const owner = this.owners.get(application);
    if (owner && owner !== session) throw new ComputerFailure({
      code: 'busy', message: 'Another conversation is using this application. Wait for it to finish or stop it, then observe again.',
    });
    this.owners.set(application, session);
    session.applications.add(application);
  }

  beginInput(session: ComputerSession, action: ComputerAction): () => void {
    this.claim(session, session.application(action.target));
    return this.beginDelivery(action.delivery, session.client);
  }

  beginDelivery(delivery: ComputerDelivery, client: ComputerClient): () => void {
    if (delivery === 'foreground' ? this.input.size > 0 : [...this.input.values()].includes('foreground')) {
      throw new ComputerFailure({
        code: 'busy', message: 'Foreground input requires exclusive access. Wait for current input to finish and observe again.',
      });
    }
    const ticket = Symbol();
    this.input.set(ticket, delivery);
    return () => { void client.drained().then(() => this.input.delete(ticket)); };
  }

  stop(thread: string): Promise<void> {
    const session = this.sessions.get(thread);
    if (!session) return Promise.resolve();
    if (session.closing) return session.closing;
    session.controller.abort();
    const stop = session.client.stop();
    const release = () => {
      this.sessions.delete(thread);
      for (const application of session.applications) this.owners.delete(application);
    };
    session.closing = stop.then(release, error => {
      // The worker's deadline is not evidence that an input has stopped.
      void session.client.drained().then(release);
      throw error;
    });
    return session.closing;
  }

  async stopSessions(revoked?: string[]) {
    const threads = [...this.sessions].filter(([, session]) =>
      !revoked || revoked.some(application => session.applications.has(application)));
    const results = await Promise.allSettled(threads.map(([thread]) => this.stop(thread)));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
}
