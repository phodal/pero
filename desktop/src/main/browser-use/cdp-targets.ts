import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { ChromiumCdp } from './cdp.ts';
import type { BrowserDiagnosticApproval } from './diagnostics.ts';
import type { CdpTargetRequest } from './request.ts';

type ChildInfo = { targetId: string; type: string; url: string };
type Attachment = { sessionId: string; url: string };
type ChildDocument = { id: string; loaderId: string; url: string };
type Discovered = { targetId: string; document: ChildDocument; origin: string };
export type SessionCdpSend = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
export type SessionCdpSubscribe = (receive: (method: string, params: Record<string, unknown>, parent?: string) => void) => () => void;

export function cdpTargetOrigins(request: CdpTargetRequest, origin: string) {
  return request.action === 'cdpListTargets' ? [...new Set([origin, ...(request.fromOrigins ?? [])])] : [request.target.origin];
}

export async function approveCdpTargets(request: CdpTargetRequest, origin: string, thread: string,
  signal: AbortSignal, approve: BrowserDiagnosticApproval) {
  let active = signal;
  for (const source of cdpTargetOrigins(request, origin)) active = await approve(thread, source, active);
  active.throwIfAborted();
  return active;
}

/** Keeps public target identifiers bound to one discovered child document. */
export class ChromiumCdpTargets {
  private document?: string;
  private targets = new Map<string, Discovered>();

  async call(request: CdpTargetRequest, document: string, origin: string, send: SessionCdpSend,
    subscribe: SessionCdpSubscribe, check: () => void, signal: AbortSignal) {
    if (this.document !== document) { this.document = document; this.targets.clear(); }
    check();
    const discovered = request.action === 'cdpSend' ? this.targets.get(request.target.id) : undefined;
    if (request.action === 'cdpSend' && (!discovered || discovered.origin !== request.target.origin))
      throw new Error('The CDP child target is stale. List targets again.');

    const children = new Map<string, Attachment>();
    const unsubscribe = subscribe((method, params, parent) => {
      if (parent) return;
      if (method === 'Target.attachedToTarget') {
        const { targetInfo, sessionId } = params as { targetInfo: ChildInfo; sessionId: string };
        if (targetInfo.type === 'iframe') children.set(targetInfo.targetId, { sessionId, url: targetInfo.url });
      } else if (method === 'Target.targetInfoChanged') {
        const { targetInfo } = params as { targetInfo: ChildInfo };
        const child = children.get(targetInfo.targetId);
        if (child) child.url = targetInfo.url;
      } else if (method === 'Target.detachedFromTarget') {
        for (const [id, child] of children) if (child.sessionId === params.sessionId) children.delete(id);
      }
    });
    const childDocument = async (targetId: string, attachment: Attachment, source: string) => {
      check();
      if (children.get(targetId) !== attachment || webOrigin(attachment.url) !== source)
        throw new Error('The CDP child target is stale. List targets again.');
      const { frameTree } = await send('Page.getFrameTree', undefined, attachment.sessionId) as {
        frameTree: { frame: ChildDocument };
      };
      check();
      const frame = frameTree.frame;
      if (children.get(targetId) !== attachment || webOrigin(frame.url) !== source || webOrigin(attachment.url) !== source)
        throw new Error('The CDP child target changed origin. List targets again.');
      return frame;
    };

    try {
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        filter: [{ type: 'iframe', exclude: false }] });
      check();
      if (request.action === 'cdpListTargets') {
        const origins = cdpTargetOrigins(request, origin);
        const next = new Map<string, Discovered>();
        const targets = [];
        let truncated = false;
        for (const [targetId, attachment] of children) {
          const source = webOrigin(attachment.url);
          if (!source || !origins.includes(source)) continue;
          if (targets.length >= 24) { truncated = true; break; }
          const frame = await childDocument(targetId, attachment, source);
          const id = crypto.randomUUID();
          next.set(id, { targetId, origin: source, document: frame });
          targets.push({ id, type: 'iframe', origin: source, url: (source + new URL(frame.url).pathname).slice(0, 1024) });
        }
        this.targets = next;
        return { kind: 'cdpTargets', targets, truncated };
      }
      if (!discovered || request.command.method.startsWith('Network.')) throw new Error('This CDP child command is unavailable.');
      const { targetId, origin: source, document: before } = discovered;
      const attachment = children.get(targetId);
      if (!attachment) throw new Error('The CDP child target is stale. List targets again.');
      const verify = async () => {
        const frame = await childDocument(targetId, attachment, source);
        if (frame.id !== before.id || frame.loaderId !== before.loaderId || frame.url !== before.url)
          throw new Error('The CDP child document changed. List targets again.');
      };
      await verify();
      const result = await new ChromiumCdp().call(request, before.loaderId, source,
        (method, params) => send(method, params, attachment.sessionId), () => () => {}, check, signal);
      await verify();
      return { ...result, target: request.target };
    } finally {
      unsubscribe();
      await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    }
  }
}
