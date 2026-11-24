import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';
import { ChromiumCdp } from './cdp.ts';
import type { BrowserDiagnosticApproval } from './diagnostics.ts';
import type { CdpTargetRequest } from './request.ts';

type ChildInfo = { targetId: string; type: string; url: string };
type Attachment = { sessionId: string; url: string; parent?: string };
type ChildDocument = { id: string; loaderId: string; url: string };
type Child = { targetId: string; document: ChildDocument; origin: string };
type Discovered = { path: readonly Child[]; cdp?: ChromiumCdp };
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
    const discovered = request.action === 'cdpListTargets' ? undefined : this.targets.get(request.target.id);
    if (request.action !== 'cdpListTargets' && discovered?.path.at(-1)?.origin !== request.target.origin)
      throw new Error('The CDP child target is stale. List targets again.');

    const children = new Map<string, Attachment>();
    let targetsChanged: (() => void) | undefined;
    const unsubscribe = subscribe((method, params, parent) => {
      if (method === 'Target.attachedToTarget') {
        const { targetInfo, sessionId } = params as { targetInfo: ChildInfo; sessionId: string };
        if (targetInfo.type === 'iframe') children.set(targetInfo.targetId, { sessionId, url: targetInfo.url, parent });
      } else if (method === 'Target.targetInfoChanged') {
        const { targetInfo } = params as { targetInfo: ChildInfo };
        const child = children.get(targetInfo.targetId);
        if (child) child.url = targetInfo.url;
      } else if (method === 'Target.detachedFromTarget') {
        for (const [id, child] of children) if (child.sessionId === params.sessionId) children.delete(id);
      } else return;
      targetsChanged?.();
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
    const enabled: (string | undefined)[] = [];
    const attachChildren = async (parent?: string) => {
      check();
      enabled.push(parent);
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        filter: [{ type: 'iframe', exclude: false }] }, parent);
      const pending = () => [...children.values()].some(child => child.parent === parent && child.url === '');
      if (pending()) await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', finish);
          targetsChanged = undefined;
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        targetsChanged = () => { if (!pending()) finish(); };
        signal.addEventListener('abort', finish, { once: true });
      });
      check();
    };

    try {
      await attachChildren();
      if (request.action === 'cdpListTargets') {
        const origins = cdpTargetOrigins(request, origin);
        const next = new Map<string, Discovered>();
        const targets: { id: string; type: 'iframe'; origin: string; url: string; parentId?: string }[] = [];
        let truncated = false;
        const discover = async (path: readonly Child[], parent?: string, parentId?: string) => {
          for (const [targetId, attachment] of [...children]) {
            if (attachment.parent !== parent) continue;
            const source = webOrigin(attachment.url);
            if (!source || !origins.includes(source)) continue;
            if (targets.length >= 24) { truncated = true; return; }
            const frame = await childDocument(targetId, attachment, source);
            const id = crypto.randomUUID();
            const branch = [...path, { targetId, origin: source, document: frame }];
            next.set(id, { path: branch });
            targets.push({ id, type: 'iframe', origin: source, url: (source + new URL(frame.url).pathname).slice(0, 1024),
              ...(parentId && { parentId }) });
            if (branch.length < (request.depth ?? 1)) {
              await attachChildren(attachment.sessionId);
              await discover(branch, attachment.sessionId, id);
            }
          }
        };
        await discover([]);
        this.targets = next;
        return { kind: 'cdpTargets', targets, truncated };
      }
      if (!discovered || request.action === 'cdpSend' && request.command.method.startsWith('Network.'))
        throw new Error('This CDP child command is unavailable.');
      const verify = async ({ targetId, origin: source, document: before }: Child, attachment: Attachment) => {
        const frame = await childDocument(targetId, attachment, source);
        if (frame.id !== before.id || frame.loaderId !== before.loaderId || frame.url !== before.url)
          throw new Error('The CDP child document changed. List targets again.');
      };
      const route: { child: Child; attachment: Attachment }[] = [];
      let parent: string | undefined;
      for (const [index, child] of discovered.path.entries()) {
        const attachment = children.get(child.targetId);
        if (!attachment || attachment.parent !== parent) throw new Error('The CDP child target is stale. List targets again.');
        await verify(child, attachment);
        route.push({ child, attachment });
        parent = attachment.sessionId;
        if (index < discovered.path.length - 1) await attachChildren(parent);
      }
      const { child, attachment } = route.at(-1)!;
      const cdp = discovered.cdp ??= new ChromiumCdp();
      const result = await cdp.call(request, child.document.loaderId, child.origin,
        (method, params) => send(method, params, attachment.sessionId), listener => subscribe((method, params, session) => {
          if (session === attachment.sessionId) listener(method, params);
        }), check, signal);
      for (const step of route) await verify(step.child, step.attachment);
      return { ...result, target: request.target };
    } finally {
      unsubscribe();
      for (const parent of enabled.reverse())
        await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, parent).catch(() => {});
    }
  }
}
