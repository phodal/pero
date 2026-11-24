import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { cdpCaptureMs } from './cdp-capture.ts';
import { CdpEventBuffer, type TargetEvent } from './cdp-events.ts';
import type { CdpReadTargetEvents, CdpTargetEventMethod } from './request.ts';

/** The bounded event stream for a tab's approved direct child targets. */
export class CdpTargetEvents {
  private readonly buffer: CdpEventBuffer;
  private readonly admitted = new Map<string, TargetEvent['params']>();
  private readonly timer: ReturnType<typeof setTimeout>;
  private notify?: () => void;
  private active = true;

  constructor(readonly id: string, private readonly origins: readonly string[],
    private readonly signal: AbortSignal, private readonly onEnd: () => void) {
    this.buffer = new CdpEventBuffer(id);
    this.timer = setTimeout(this.stop, cdpCaptureMs);
    signal.addEventListener('abort', this.stop, { once: true });
  }

  stop = () => {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.stop);
    this.admitted.clear();
    this.buffer.clear();
    this.notify?.();
    this.onEnd();
  };

  observe(method: CdpTargetEventMethod, attachment: { sessionId: string; url: string; parent?: string }) {
    if (!this.active || attachment.parent) return;
    const { sessionId, url } = attachment;
    const previous = this.admitted.get(sessionId);
    if (method === 'Target.detachedFromTarget') {
      if (!previous) return;
      this.admitted.delete(sessionId);
      this.buffer.append({ method, params: previous });
    } else {
      const origin = webOrigin(url);
      if (!origin || !this.origins.includes(origin)) {
        this.admitted.delete(sessionId);
        return;
      }
      // Chromium often announces the attachment before its URL is known.
      // Admit its identity and public URL together once the origin is known.
      const sameOrigin = previous?.origin === origin;
      const params = { targetId: sameOrigin ? previous.targetId : crypto.randomUUID(), type: 'iframe' as const,
        origin, url: (origin + new URL(url).pathname).slice(0, 1024) };
      if (!previous && this.admitted.size === 128) this.admitted.delete(this.admitted.keys().next().value!);
      this.admitted.set(sessionId, params);
      if (!sameOrigin && method === 'Target.targetInfoChanged') this.buffer.append({ method: 'Target.attachedToTarget', params });
      this.buffer.append({ method, params });
    }
    this.notify?.();
  }

  async read(request: CdpReadTargetEvents, origins: readonly string[]) {
    if (origins.length !== this.origins.length || origins.some(origin => !this.origins.includes(origin)))
      throw new Error('The CDP target event origins changed. Read events again without a cursor.');
    let result = this.buffer.read(request, true);
    if (!result.events.length && request.timeoutMs) {
      const initial = result;
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.notify = undefined; resolve(); };
        const timer = setTimeout(done, request.timeoutMs);
        this.notify = () => {
          if (!this.active) { done(); return; }
          result = this.buffer.read({ ...request, after: initial.cursor }, true, initial.truncated);
          if (result.events.length) done();
        };
      });
    }
    if (!this.active) throw new Error('The CDP target event stream ended. Read events again without a cursor.');
    return result;
  }
}
