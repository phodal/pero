import type { BrowserRequest, CdpReadTargetEvents, CdpRequest, CdpTargetEventMethod } from './request.ts';

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
export type CdpReceive = (method: string, params: Record<string, unknown>) => void;
export type CdpSubscribe = (receive: CdpReceive) => () => void;
export type CdpRead = Extract<CdpRequest, { action: 'cdpReadEvents' }>;
export function cdpTargetEventRequest(request: BrowserRequest): request is CdpReadTargetEvents {
  return request.action === 'cdpReadEvents' && !request.target && !!request.methods?.some(method => method.startsWith('Target.'));
}
export type RuntimeEvent = { method: 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'; timestamp: number; text: string; level?: string };
export type NetworkEvent = { method: 'Network.requestWillBeSent' | 'Network.responseReceived' | 'Network.loadingFinished' | 'Network.loadingFailed';
  params: { requestId: string; timestamp: number; url: string; verb?: string; status?: number; mimeType?: string; encodedDataLength?: number; errorText?: string } };
export type TargetEvent = { method: CdpTargetEventMethod;
  params: { targetId: string; type: 'iframe'; origin: string; url: string } };
type CdpEvent = RuntimeEvent | NetworkEvent | TargetEvent;
export class CdpEventBuffer<Event extends CdpEvent = CdpEvent> {
  private sequence = 0;
  private entries: (Event & { sequence: number })[] = [];

  constructor(private readonly stream: string = crypto.randomUUID()) {}

  append(event: Event) {
    if (this.entries.length === 128) this.entries.shift();
    this.entries.push({ ...event, sequence: ++this.sequence });
  }

  matches(cursor: CdpRead['after']) { return cursor?.stream === this.stream; }

  clear() { this.entries = []; }

  read(request: CdpRead, checkpoint = false, truncated = false) {
    if (request.after && (!this.matches(request.after) || request.after.sequence > this.sequence))
      throw new Error('The CDP cursor is stale. Read events again without a cursor.');
    const start = request.after?.sequence ?? (checkpoint ? this.sequence : 0);
    const matches = this.entries.filter(event => event.sequence > start && (!request.methods || request.methods.includes(event.method)));
    const events = matches.slice(0, request.limit ?? 25);
    const hasMore = matches.length > events.length;
    return { kind: 'cdpEvents', events, hasMore, truncated: truncated || start < this.sequence - this.entries.length,
      cursor: { stream: this.stream, sequence: hasMore ? events.at(-1)!.sequence : this.sequence } };
  }
}

/** Accept console and exception events from the approved top frame's default world. */
export function topRuntimeEvents(frame: string, origin: string, append: (event: RuntimeEvent) => void): CdpReceive {
  const contexts = new Set<number>();
  return (method, data) => {
    if (method === 'Runtime.executionContextCreated') {
      const context = data.context as { id: number; origin: string; auxData?: { isDefault?: boolean; frameId?: string } };
      if (context.origin === origin && context.auxData?.isDefault && context.auxData.frameId === frame)
        contexts.add(context.id);
      return;
    }
    if (method === 'Runtime.executionContextDestroyed') { contexts.delete(data.executionContextId as number); return; }
    if (method === 'Runtime.executionContextsCleared') { contexts.clear(); return; }
    const timestamp = data.timestamp as number;
    if (!Number.isFinite(timestamp)) return;
    if (method === 'Runtime.consoleAPICalled' && contexts.has(data.executionContextId as number)) {
      const args = data.args as Array<{ value?: unknown; type: string }>;
      const text = args.slice(0, 8).map(arg =>
        arg.value === null || ['string', 'number', 'boolean'].includes(typeof arg.value)
          ? String(arg.value).slice(0, 160) : `[${arg.type}]`).join(' ').slice(0, 480);
      append({ method, timestamp, text, level: String(data.type).slice(0, 24) });
    } else if (method === 'Runtime.exceptionThrown') {
      const details = data.exceptionDetails as { executionContextId?: number; text: string; exception?: { description?: string } };
      if (contexts.has(details.executionContextId ?? -1)) append({ method, timestamp,
        text: (details.exception?.description?.split('\n', 1)[0] ?? details.text).slice(0, 480) });
    }
  };
}
