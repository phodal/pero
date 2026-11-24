import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import type { CdpRequest } from './request.ts';
import { ChromiumCdpCapture, cdpCaptureMs } from './cdp-capture.ts';
import { CdpEventBuffer, topRuntimeEvents, type CdpRead, type CdpSend, type CdpSubscribe, type RuntimeEvent } from './cdp-events.ts';

type FrameTree = {
  frame: { id: string; loaderId: string; parentId?: string; url: string; mimeType: string; securityOrigin?: string };
  childFrames?: FrameTree[];
  resources?: { url: string }[];
};
const replayCapacity = 256;

function scopedFrameTree(tree: FrameTree, origin: string): FrameTree | undefined {
  const { id, loaderId, parentId, url, mimeType, securityOrigin } = tree.frame;
  if (webOrigin(url) !== origin) return;
  const childFrames = tree.childFrames?.flatMap(child => scopedFrameTree(child, origin) ?? []);
  return {
    frame: { id, loaderId, parentId, url, mimeType, securityOrigin },
    ...(childFrames?.length && { childFrames }),
    ...(tree.resources && { resources: tree.resources.filter(resource => webOrigin(resource.url) === origin) }),
  };
}

/** Owns approved CDP reads and captures for one Chromium debugger attachment. */
export class ChromiumCdp {
  private document?: string;
  private buffer = new CdpEventBuffer();
  private previousReplay = new Map<string, number>();
  private capture?: ChromiumCdpCapture;

  stopCapture(id?: string) {
    if (!id || this.capture?.id === id) return this.capture?.stop();
  }

  detachCapture() { return this.capture?.detach(); }

  readDetachedEvents(request: CdpRead) { return this.capture?.readDetached(request); }

  invalidate() {
    this.document = undefined;
    void this.stopCapture();
  }

  async call(request: CdpRequest, document: string, origin: string, send: CdpSend,
    subscribe: CdpSubscribe, check: () => void, signal: AbortSignal, captureId?: string, onCaptureEnd?: () => void) {
    if (this.document !== document) {
      await this.stopCapture();
      this.document = document;
      this.buffer = new CdpEventBuffer();
      this.previousReplay.clear();
    } else if (this.capture && !this.capture.active) await this.capture.stop();
    check();
    const topFrame = async () => {
      const { frameTree } = await send('Page.getFrameTree') as { frameTree: FrameTree };
      check();
      if (webOrigin(frameTree.frame.url) !== origin) throw new Error('The authorized document changed.');
      return frameTree.frame;
    };

    if (request.action === 'cdpSend') {
      const { command } = request;
      if (command.method === 'Network.enable') {
        await this.stopCapture();
        const frame = await topFrame();
        const capture = this.capture = new ChromiumCdpCapture(captureId ?? crypto.randomUUID(), origin,
          frame.id, frame.loaderId, send, subscribe, signal, check, onCaptureEnd);
        try {
          const cursor = await capture.start();
          check();
          return { kind: 'cdpResult', method: command.method, result: { cursor, captureMs: cdpCaptureMs } };
        } catch (error) {
          await capture.stop();
          throw error;
        }
      }
      if (command.method === 'Network.disable') {
        await this.stopCapture();
        check();
        return { kind: 'cdpResult', method: command.method, result: {} };
      }
      if (command.method === 'Network.getResponseBody') {
        if (!this.capture?.active) throw new Error('Enable Network before reading a response body.');
        const result = await this.capture.responseBody(command.params.requestId);
        check();
        return { kind: 'cdpResult', method: command.method, result };
      }
      const frameTree = command.method === 'Page.getFrameTree' || command.method === 'Page.getResourceTree';
      if (command.method !== 'Performance.getMetrics' && command.method !== 'Page.getLayoutMetrics' &&
          command.method !== 'DOM.getDocument' && !frameTree) throw new Error('This CDP command is unavailable.');
      const metrics = command.method === 'Performance.getMetrics';
      if (metrics) await send('Performance.enable');
      try {
        check();
        let result = await send(command.method, command.method === 'DOM.getDocument'
          ? { depth: command.params?.depth ?? 0 } : undefined);
        check();
        if (frameTree) {
          const tree = scopedFrameTree((result as { frameTree: FrameTree }).frameTree, origin);
          if (!tree) throw new Error('The authorized document changed.');
          result = { frameTree: tree };
        }
        if (new TextEncoder().encode(JSON.stringify(result)).length > 32768)
          throw new Error('The browser CDP reply exceeds 32 KiB.');
        return { kind: 'cdpResult', method: command.method, result };
      } finally {
        if (metrics) await send('Performance.disable').catch(() => {});
      }
    }

    if (this.capture?.active || this.capture?.matches(request.after)) {
      const result = await this.capture.read(request);
      check();
      return result;
    }
    this.buffer.read(request); // Reject a stale cursor before reading the browser.
    if (request.timeoutMs || request.methods?.some(method => method.startsWith('Network.')))
      throw new Error('Enable Network before using live CDP event reads.');
    const frame = await topFrame();
    const replay: RuntimeEvent[] = [];
    let replayTruncated = false;
    const stop = subscribe(topRuntimeEvents(frame.id, origin, event => {
      if (replay.length === replayCapacity) { replay.shift(); replayTruncated = true; }
      replay.push(event);
    }));
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
      this.buffer.append(event);
    }
    this.previousReplay = replayCounts;
    return this.buffer.read(request, false, replayTruncated);
  }
}
