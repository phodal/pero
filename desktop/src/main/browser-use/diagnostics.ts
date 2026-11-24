import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';

export type BrowserDiagnosticOptions = {
  captureMs?: number;
  profile?: boolean;
  style?: { selector: string; properties: string[] };
};
export type BrowserDiagnosticApproval = (thread: string, origin: string, signal: AbortSignal) => Promise<AbortSignal>;

export class BrowserDeveloperMode {
  private mode?: AbortController;

  constructor(private readonly confirm: (thread: string, origin: string) => Promise<boolean>) {}

  get enabled() { return !!this.mode; }

  set(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.mode?.abort();
    this.mode = enabled ? new AbortController() : undefined;
  }

  approve: BrowserDiagnosticApproval = async (thread, origin, signal) => {
    if (!this.mode) throw new Error('Enable Browser Developer Mode from the Workbench first.');
    const active = AbortSignal.any([signal, this.mode.signal]);
    active.throwIfAborted();
    const allowed = await this.confirm(thread, origin);
    active.throwIfAborted();
    if (!allowed) throw new Error('Browser diagnostics were declined.');
    return active;
  };
}

type CDPEvent = (method: string, params: Record<string, unknown>) => void;
type CDPSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type ConsoleEntry = { level: string; text: string };
type NetworkEntry = { method: string; url: string; status?: number; durationMs?: number; error?: string };
type ProfileNode = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };

/** Events from the authorized origin, bounded before they leave the driver. */
class BrowserDiagnosticCapture {
  private readonly contexts = new Set<number>();
  private readonly requests = new Map<string, { entry: NetworkEntry; startedAt: number }>();
  readonly console: ConsoleEntry[] = [];
  readonly errors: string[] = [];
  truncated = false;

  constructor(private readonly origin: string) {}

  private push<T>(values: T[], value: T) {
    if (values.length === 40) this.truncated = true;
    else values.push(value);
  }

  private address(url: unknown) {
    if (typeof url !== 'string' || webOrigin(url) !== this.origin) return;
    const { origin, pathname } = new URL(url);
    return (origin + pathname).slice(0, 320);
  }

  event: CDPEvent = (method, params) => {
    if (method === 'Runtime.executionContextCreated') {
      const { id, origin, auxData } = params.context as { id: number; origin: string; auxData?: { isDefault?: boolean } };
      if (origin === this.origin && auxData?.isDefault) this.contexts.add(id);
    } else if (method === 'Runtime.executionContextDestroyed') {
      this.contexts.delete(params.executionContextId as number);
    } else if (method === 'Runtime.executionContextsCleared') {
      this.contexts.clear();
    } else if (method === 'Runtime.consoleAPICalled' && this.contexts.has(params.executionContextId as number)) {
      const args = params.args as { value?: unknown; description?: string; type: string; subtype?: string }[];
      const text = args.slice(0, 8).map(arg => arg.value === null || ['string', 'number', 'boolean'].includes(typeof arg.value)
        ? String(arg.value).slice(0, 320)
        : arg.subtype === 'error' ? arg.description?.split('\n', 1)[0]?.slice(0, 320) ?? '[error]' : `[${arg.type}]`
      ).join(' ').slice(0, 480);
      this.push(this.console, { level: String(params.type), text });
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails as { text: string; executionContextId?: number; exception?: { description?: string } };
      if (details.executionContextId !== undefined && this.contexts.has(details.executionContextId))
        this.push(this.errors, (details.exception?.description?.split('\n', 1)[0] ?? details.text).slice(0, 480));
    } else if (method === 'Network.requestWillBeSent') {
      const id = params.requestId as string;
      const request = params.request as { method: string; url: string };
      const url = this.address(request.url);
      // A redirect reuses the request ID. Remove the old entry before
      // attributing any response or timing to the destination.
      this.requests.delete(id);
      if (!url) return;
      if (this.requests.size === 40) { this.truncated = true; return; }
      this.requests.set(id, { entry: { method: request.method.slice(0, 16), url }, startedAt: params.timestamp as number });
    } else if (method === 'Network.responseReceived' || method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      const request = this.requests.get(params.requestId as string);
      if (!request) return;
      if (method === 'Network.responseReceived') {
        const response = params.response as { status: number; url: string };
        if (this.address(response.url) === request.entry.url) request.entry.status = response.status;
      } else {
        request.entry.durationMs = Math.round(((params.timestamp as number) - request.startedAt) * 1000);
        if (method === 'Network.loadingFailed') request.entry.error = String(params.errorText).slice(0, 160);
      }
    }
  };

  result(metrics: { name: string; value: number }[], profile?: { nodes: ProfileNode[]; samples?: number[] }) {
    const profileNodes = new Map(profile?.nodes.map(node => [node.id, node.callFrame]));
    const samples = new Map<string, { name: string; url: string; line: number; samples: number }>();
    for (const id of profile?.samples ?? []) {
      const frame = profileNodes.get(id);
      const url = this.address(frame?.url);
      if (!frame || !url) continue;
      const name = frame.functionName.slice(0, 120);
      const line = frame.lineNumber + 1;
      const key = JSON.stringify([name, url, line]);
      const existing = samples.get(key);
      if (existing) existing.samples++;
      else samples.set(key, { name, url, line, samples: 1 });
    }
    return {
      console: this.console,
      errors: this.errors,
      network: Array.from(this.requests.values(), request => request.entry),
      metrics: Object.fromEntries(metrics.filter(({ name }) =>
        ['JSHeapUsedSize', 'LayoutCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].includes(name))
        .map(({ name, value }) => [name, value])),
      ...(profile && { cpu: [...samples.values()].sort((a, b) => b.samples - a.samples).slice(0, 20) }),
      truncated: this.truncated || samples.size > 20,
    };
  }
}

export async function captureBrowserDiagnostics(origin: string, options: BrowserDiagnosticOptions, send: CDPSend,
  subscribe: (listener: CDPEvent) => () => void, check: () => void, signal?: AbortSignal) {
  const duration = options.captureMs ?? 750;
  if (!Number.isInteger(duration) || duration < 100 || duration > 4000 || options.profile !== undefined && typeof options.profile !== 'boolean')
    throw new Error('Invalid browser diagnostics capture options.');
  const capture = new BrowserDiagnosticCapture(origin);
  const unsubscribe = subscribe(capture.event);
  const domains: string[] = [];
  let profileUnavailable = false;
  let profiling = false;
  try {
    for (const domain of ['Runtime', 'Network', 'Performance', ...(options.style ? ['DOM', 'CSS'] : [])]) {
      check();
      await send(domain + '.enable');
      domains.push(domain);
    }
    if (options.profile) {
      check();
      try {
        await send('Profiler.enable');
        domains.push('Profiler');
      } catch (error) {
        if (!(error instanceof Error) || !/Profiler\.enable.*wasn't found/.test(error.message)) throw error;
        profileUnavailable = true;
      }
      if (!profileUnavailable) {
        await send('Profiler.start');
        profiling = true;
      }
    }
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notify: (() => void) | undefined;
    try {
      await new Promise<void>(resolve => {
        notify = () => resolve();
        timer = setTimeout(resolve, duration);
        signal?.addEventListener('abort', notify, { once: true });
      });
    } finally {
      clearTimeout(timer);
      if (notify) signal?.removeEventListener('abort', notify);
    }
    check();
    const { metrics } = await send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
    const profile = profiling ? (await send('Profiler.stop') as { profile: { nodes: ProfileNode[]; samples?: number[] } }).profile : undefined;
    profiling = false;
    let style: { matched: boolean; values: Record<string, string> } | undefined;
    if (options.style) {
      check();
      const { root } = await send('DOM.getDocument', { depth: 0 }) as { root: { nodeId: number; documentURL: string } };
      if (webOrigin(root.documentURL) !== origin) throw new Error('The approved document changed during style inspection.');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: options.style.selector }) as { nodeId: number };
      const reply = nodeId ? await send('CSS.getComputedStyleForNode', { nodeId }) as { computedStyle: { name: string; value: string }[] } : undefined;
      style = { matched: !!nodeId, values: Object.fromEntries(reply?.computedStyle
        .filter(property => options.style?.properties.includes(property.name))
        .map(({ name, value }) => [name, value.slice(0, 320)]) ?? []) };
    }
    check();
    return { ...capture.result(metrics, profile), ...(profileUnavailable && { profileUnavailable: true as const }), ...(style && { style }) };
  } finally {
    unsubscribe();
    if (profiling) await send('Profiler.stop').catch(() => {});
    for (const domain of domains.reverse()) await send(domain + '.disable').catch(() => {});
  }
}
