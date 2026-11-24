import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import type { CdpRequest } from './request.ts';

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Receive = (method: string, params: Record<string, unknown>) => void;
type Event = { method: 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'; timestamp: number; text: string; level?: string };
type Entry = Event & { sequence: number };
const eventCapacity = 128;
const replayCapacity = 256;

/** Reads Chromium's document-local replay under an approved, short-lived CDP attachment operation. */
export class ChromiumCdp {
  private stream = crypto.randomUUID();
  private document?: string;
  private sequence = 0;
  private events: Entry[] = [];
  private previousReplay = new Map<string, number>();

  async call(request: CdpRequest, document: string, origin: string, send: Send,
    subscribe: (receive: Receive) => () => void, check: () => void) {
    check();
    if (request.action === 'cdpSend') {
      const { command } = request;
      if (command.method !== 'Performance.getMetrics' && command.method !== 'Page.getLayoutMetrics' &&
          command.method !== 'DOM.getDocument') throw new Error('This CDP command is unavailable.');
      const metrics = command.method === 'Performance.getMetrics';
      if (metrics) await send('Performance.enable');
      try {
        check();
        const result = await send(command.method, command.method === 'DOM.getDocument'
          ? { depth: command.params?.depth ?? 0 } : undefined);
        check();
        if (new TextEncoder().encode(JSON.stringify(result)).length > 32768)
          throw new Error('The browser CDP reply exceeds 32 KiB.');
        return { kind: 'cdpResult', method: command.method, result };
      } finally {
        if (metrics) await send('Performance.disable').catch(() => {});
      }
    }

    if (this.document !== document) {
      this.document = document;
      this.stream = crypto.randomUUID();
      this.sequence = 0;
      this.events = [];
      this.previousReplay.clear();
    }
    const after = request.after;
    if (after && (after.stream !== this.stream || after.sequence > this.sequence))
      throw new Error('The CDP cursor is stale. Read events again without a cursor.');
    const { frameTree } = await send('Page.getFrameTree') as { frameTree: { frame: { id: string; url: string } } };
    const frame = frameTree.frame;
    if (webOrigin(frame.url) !== origin) throw new Error('The authorized document changed.');
    const contexts = new Set<number>();
    const replay: Event[] = [];
    let replayTruncated = false;
    const stop = subscribe((method, data) => {
      if (method === 'Runtime.executionContextCreated') {
        const context = data.context as { id: number; origin: string; auxData?: { isDefault?: boolean; frameId?: string } };
        if (context.origin === origin && context.auxData?.isDefault && context.auxData.frameId === frame.id)
          contexts.add(context.id);
        return;
      }
      if (method === 'Runtime.executionContextDestroyed') { contexts.delete(data.executionContextId as number); return; }
      if (method === 'Runtime.executionContextsCleared') { contexts.clear(); return; }
      let event: Event;
      if (method === 'Runtime.consoleAPICalled' && contexts.has(data.executionContextId as number)) {
        const args = data.args as Array<{ value?: unknown; type: string }>;
        const text = args.slice(0, 8).map(arg =>
          arg.value === null || ['string', 'number', 'boolean'].includes(typeof arg.value)
            ? String(arg.value).slice(0, 160) : `[${arg.type}]`).join(' ').slice(0, 480);
        event = { method, timestamp: data.timestamp as number, text, level: String(data.type).slice(0, 24) };
      } else if (method === 'Runtime.exceptionThrown') {
        const details = data.exceptionDetails as { executionContextId?: number; text: string; exception?: { description?: string } };
        if (!contexts.has(details.executionContextId ?? -1)) return;
        event = { method, timestamp: data.timestamp as number,
          text: (details.exception?.description?.split('\n', 1)[0] ?? details.text).slice(0, 480) };
      } else return;
      if (!Number.isFinite(event.timestamp)) return;
      if (replay.length === replayCapacity) { replay.shift(); replayTruncated = true; }
      replay.push(event);
    });
    try {
      check();
      await send('Runtime.enable');
    } finally {
      stop();
      await send('Runtime.disable').catch(() => {});
    }
    check();
    const replayCounts = new Map<string, number>();
    for (const event of replay) {
      const key = JSON.stringify(event);
      const count = (replayCounts.get(key) ?? 0) + 1;
      replayCounts.set(key, count);
      if (count <= (this.previousReplay.get(key) ?? 0)) continue;
      this.events.push({ ...event, sequence: ++this.sequence });
    }
    this.previousReplay = replayCounts;
    this.events = this.events.slice(-eventCapacity);
    const start = after?.sequence ?? 0;
    const matches = this.events.filter(event => event.sequence > start && (!request.methods || request.methods.includes(event.method)));
    const events = matches.slice(0, request.limit ?? 25);
    const hasMore = matches.length > events.length;
    return { kind: 'cdpEvents', events, hasMore, truncated: replayTruncated || start < this.sequence - this.events.length,
      cursor: { stream: this.stream, sequence: hasMore ? events.at(-1)!.sequence : this.sequence } };
  }
}
