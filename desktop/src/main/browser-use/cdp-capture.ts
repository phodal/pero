import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { CdpEventBuffer, topRuntimeEvents, type CdpRead, type CdpSend, type CdpSubscribe } from './cdp-events.ts';

export const cdpCaptureMs = 60_000;
const bodyBytes = 16 * 1024;
const requestCapacity = 128;

type CapturedRequest = { url: string; mimeType?: string; finished?: boolean };

/** Bounded live events from one approved Chromium document. */
export class ChromiumCdpCapture {
  private readonly buffer: CdpEventBuffer;
  private readonly requests = new Map<string, CapturedRequest>();
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly domains: string[] = [];
  private readonly ready: Promise<void>;
  private closing?: Promise<void>;
  private notify?: () => void;
  private detached = false;
  private readonly deadline = performance.now() + cdpCaptureMs;

  constructor(readonly id: string, private readonly origin: string, private readonly frameId: string,
    private readonly loaderId: string, private readonly send: CdpSend, subscribe: CdpSubscribe,
    private readonly signal: AbortSignal, check: () => void, private readonly onEnd?: () => void) {
    this.buffer = new CdpEventBuffer(id);
    const runtime = topRuntimeEvents(frameId, origin, event => this.append(event));
    this.unsubscribe = subscribe((method, params) => {
      if (this.closing) return;
      if (method.startsWith('Runtime.')) runtime(method, params);
      else if (method.startsWith('Network.')) this.networkEvent(method, params);
    });
    this.timer = setTimeout(this.cancel, cdpCaptureMs);
    signal.addEventListener('abort', this.cancel, { once: true });
    this.ready = (async () => {
      for (const domain of ['Runtime', 'Network']) {
        signal.throwIfAborted();
        check();
        await send(domain + '.enable', domain === 'Network' ? {
          maxTotalBufferSize: 1024 * 1024, maxResourceBufferSize: bodyBytes, maxPostDataSize: 0,
        } : undefined);
        this.domains.push(domain);
      }
    })();
  }

  private cancel = () => { void this.stop(); };

  stop() {
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.cancel);
    this.detached = false;
    this.buffer.clear();
    return this.disconnect();
  }

  detach() {
    if (!this.active || this.signal.aborted || performance.now() >= this.deadline) return false;
    this.detached = true;
    void this.disconnect(false);
    return true;
  }

  readDetached(request: CdpRead) {
    if (!this.detached) return;
    if (this.signal.aborted || performance.now() >= this.deadline) { void this.stop(); return; }
    return { ...this.buffer.read(request, true), detached: true };
  }

  private disconnect(disableDomains = true) {
    if (this.closing) return this.closing;
    this.unsubscribe();
    this.requests.clear();
    this.closing = this.ready.catch(() => {}).then(async () => {
      if (disableDomains) {
        for (const domain of this.domains.reverse()) await this.send(domain + '.disable').catch(() => {});
      } else {
        // Release auto-attach after the native detach notification returns.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      this.onEnd?.();
    });
    this.notify?.();
    return this.closing;
  }

  get active() { return !this.closing; }
  matches(cursor: CdpRead['after']) { return this.buffer.matches(cursor); }

  async start() {
    await this.ready;
    return (await this.read({ action: 'cdpReadEvents' })).cursor;
  }

  async read(request: CdpRead) {
    if (!this.active) throw new Error('The CDP capture ended. Enable Network again for a new cursor.');
    let result = this.buffer.read(request, true);
    if (!result.events.length && request.timeoutMs) {
      const after = result.cursor;
      const truncated = result.truncated;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); this.notify = undefined; resolve(); };
        this.notify = () => {
          if (!this.active) { finish(); return; }
          result = this.buffer.read({ ...request, after }, true, truncated);
          if (result.events.length) finish();
        };
        const timer = setTimeout(finish, request.timeoutMs);
      });
    }
    if (!this.active) throw new Error('The CDP capture ended. Enable Network again for a new cursor.');
    return result;
  }

  async responseBody(requestId: string) {
    const request = this.requests.get(requestId);
    if (!request?.finished || !request.mimeType || !/^(text\/|application\/(?:json|[\w.+-]+\+json)$)/i.test(request.mimeType))
      throw new Error('Read a completed, same-origin text or JSON response from the current CDP capture.');
    const result = await this.send('Network.getResponseBody', { requestId }) as { body: string; base64Encoded: boolean };
    if (!this.active) throw new Error('The CDP capture ended.');
    if ((result.base64Encoded ? Math.floor(result.body.length * 3 / 4) : new TextEncoder().encode(result.body).length) > bodyBytes)
      throw new Error('The CDP response body exceeds 16 KiB.');
    return result;
  }

  private append(event: Parameters<CdpEventBuffer['append']>[0]) {
    this.buffer.append(event);
    this.notify?.();
  }

  private networkEvent(method: string, data: Record<string, unknown>) {
    const { requestId, timestamp } = data;
    if (typeof requestId !== 'string' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return;
    if (method === 'Network.requestWillBeSent') {
      this.requests.delete(requestId); // Chrome reuses the ID across redirect hops.
      const request = data.request as { url: string; method: string };
      if (data.frameId !== this.frameId || data.loaderId !== this.loaderId || webOrigin(request.url) !== this.origin) return;
      if (this.requests.size === requestCapacity) this.requests.delete(this.requests.keys().next().value!);
      this.requests.set(requestId, { url: request.url });
      const url = this.origin + new URL(request.url).pathname;
      this.append({ method, params: { requestId, timestamp, url: url.slice(0, 512), verb: request.method.slice(0, 24) } });
      return;
    }
    const request = this.requests.get(requestId);
    if (!request) return;
    const url = (this.origin + new URL(request.url).pathname).slice(0, 512);
    if (method === 'Network.responseReceived') {
      const response = data.response as { url: string; status: number; mimeType: string };
      if (request.url !== response.url) { this.requests.delete(requestId); return; }
      request.mimeType = response.mimeType.slice(0, 128);
      this.append({ method, params: { requestId, timestamp, url, status: response.status, mimeType: request.mimeType } });
    } else if (method === 'Network.loadingFinished') {
      request.finished = true;
      this.append({ method, params: { requestId, timestamp, url, encodedDataLength: data.encodedDataLength as number } });
    } else if (method === 'Network.loadingFailed') {
      this.requests.delete(requestId);
      this.append({ method, params: { requestId, timestamp, url, errorText: String(data.errorText).slice(0, 160) } });
    }
  }
}
