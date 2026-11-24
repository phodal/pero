// Local transport for Point's staged Chrome Relay flow, owned by Pero App Use.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { z } from 'zod';
import { EXTENSION_ID, MAX_FRAME, MAX_PARALLEL_REQUESTS, PAIR_LIFETIME_MS, RELAY_INCOMPATIBLE, RELAY_PATH, RELAY_PROTOCOL, webOrigin, type Pairing } from '../../../../packages/chrome-extension/src/protocol.ts';
import type { ArtifactDeliveryPort } from '../artifact-delivery.ts';
import type { AppInputs } from '../app-inputs.ts';
import type { BrowserUsePort } from './browser-use.ts';
import type { BrowserNode } from './document.ts';
import type { BrowserDiagnosticApproval } from './diagnostics.ts';
import type { SiteToolAccess } from './site-tools.ts';
import { cloudBrowserRequest } from './cloud-use.ts';
import { chromeActions, NativeBrowserUse, type DriverOperation, type DriverRequest, type DriverTab, type TabAction } from './native-use.ts';
import { browserInputSchema, browserRequest, type BrowserRequest } from './request.ts';

import { sidebarRequest, type SidebarPort } from './chrome-sidebar.ts';
import { ChromeSiteAccess, type ChromeSiteAccessPort } from './chrome-site-access.ts';

const pair = z.strictObject({
  type: z.literal('pair'), protocol: z.string().max(64), ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  parallel: z.literal(true).optional(),
});
const tabIdentity = z.uuid();
const snapshot = z.strictObject({
  id: tabIdentity,
  url: z.string().min(1).max(4096), title: z.string().max(160),
  active: z.boolean(), ready: z.boolean(), revision: z.number().int().min(0).safe(),
});
const incoming = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('response'), id: z.number().int().positive().safe(), value: z.unknown().optional(), error: z.string().max(500).optional() }),
  z.strictObject({ type: z.literal('sidebar'), id: z.uuid(), sessionId: z.string().optional(), request: sidebarRequest }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('revoke') }),
]);
type Ticket = Pairing & { thread: string };
type Pending = { settle(error?: Error, value?: unknown): void };
type Connection = {
  id: string; socket: WebSocket; thread: string; timer: NodeJS.Timeout; lastSeen: number; next: number;
  parallel: boolean; pending: Map<number, Pending>;
  ended: AbortController;
};
type ChromeConnectionStatus =
  | { state: 'notPaired' | 'pairing' | 'connected' }
  | { state: 'expired' | 'disconnected' | 'incompatible'; message: string };
type EndedPairing = { thread: string; status: Extract<ChromeConnectionStatus, { message: string }> };
const pairingExpired = { state: 'expired', message: 'The pairing code expired. Pair Chrome again from the Workbench.' } as const;
const connectionExpired = { state: 'expired', message: 'Chrome Relay expired. Pair Chrome again from the Workbench.' } as const;
const incompatible = { state: 'incompatible', message: RELAY_INCOMPATIBLE } as const;

class ChromeRelay {
  readonly browser: BrowserUsePort;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  private server?: Server;
  private ticket?: Ticket;
  private connection?: Connection;
  private endedPairing?: EndedPairing;

  private readonly selected: () => Promise<string | undefined>;

  private readonly sidebar?: SidebarPort;
  readonly siteAccess?: ChromeSiteAccess;

  constructor(selected: () => Promise<string | undefined>, private readonly evidenceRoot: string, sidebar?: SidebarPort,
    sitePort?: ChromeSiteAccessPort, approveDiagnostics?: BrowserDiagnosticApproval, siteTools?: SiteToolAccess) {
    this.sidebar = sidebar;
    this.selected = selected;
    const access = this.siteAccess = sitePort && new ChromeSiteAccess(join(dirname(evidenceRoot), 'chrome-site-access.json'), sitePort);
    this.browser = new NativeBrowserUse(request => this.request(request), evidenceRoot, 'chrome', access && {
      status: (thread, tab) => access.status(thread, tab.grantId, tab.origin),
      require: (thread, tab, signal) => {
        const connection = this.connection;
        if (!connection || connection.id !== tab.grantId || connection.thread !== thread)
          throw new Error('The paired Chrome profile changed.');
        return access.require(thread, tab.grantId, tab.origin, AbortSignal.any([signal, connection.ended.signal]));
      },
    }, approveDiagnostics, siteTools);
  }

  attach(server: Server) {
    this.server = server;
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== RELAY_PATH || request.headers.origin !== `chrome-extension://${EXTENSION_ID}`) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, ws => this.connect(ws));
    });
  }

  async pairing(label: string, expectedThread?: string) {
    const thread = await this.selected();
    const address = this.server?.address();
    if (!thread || (expectedThread && expectedThread !== thread) || !address || typeof address === 'string')
      throw new Error('Select an ordinary conversation in Pero before pairing Chrome.');
    this.revoke();
    const pairing: Pairing = { protocol: RELAY_PROTOCOL, baseUrl: `http://127.0.0.1:${address.port}`, parallel: true,
      ticket: randomBytes(32).toString('base64url'), expiresAt: Date.now() + PAIR_LIFETIME_MS,
      label: label.slice(0, 160) || 'Selected Pero conversation' };
    this.ticket = { ...pairing, thread };
    return JSON.stringify(pairing);
  }

  paired(thread: string) {
    return this.connection?.thread === thread;
  }

  status(thread: string): ChromeConnectionStatus {
    if (this.paired(thread)) return { state: 'connected' };
    if (this.ticket?.thread === thread)
      return this.ticket.expiresAt > Date.now() ? { state: 'pairing' } : pairingExpired;
    return this.endedPairing?.thread === thread ? this.endedPairing.status : { state: 'notPaired' };
  }

  async activeTabForCloud() {
    const connection = this.connection;
    if (!connection) return;
    const result = await this.request({ op: 'tabs', thread: connection.thread }, true);
    if (!result.ok || !Array.isArray(result.value) || this.connection !== connection) return;
    const tab = (result.value as DriverTab[]).find(tab => tab.active && tab.stamp);
    if (tab && (await this.siteAccess?.rules())?.[tab.origin] !== 'block') return tab;
  }

  async prepareCloudShare(target: Pick<DriverTab, 'tabId' | 'origin' | 'grantId'>,
    share: string, screenshots: boolean, files: AppInputs) {
    const active = await this.activeTabForCloud();
    if (active?.tabId !== target.tabId || active.origin !== target.origin || active.grantId !== target.grantId)
      return;
    const grant = this.shareTabWithCloud(active);
    return {
      grant: () => grant.signal,
      call: (input: unknown, signal: AbortSignal) =>
        grant.browser.call(share, cloudBrowserRequest(input, target.tabId, screenshots), signal, files),
    };
  }

  private shareTabWithCloud(tab: DriverTab) {
    const connection = this.connection;
    if (!connection || connection.id !== tab.grantId) throw new Error('The paired Chrome profile changed.');
    const grant = new AbortController();
    const signal = AbortSignal.any([connection.ended.signal, grant.signal]);
    const browser = new NativeBrowserUse(async request => {
      if (signal.aborted || this.connection !== connection || await this.selected() !== connection.thread) {
        grant.abort();
        return { ok: false, error: 'The paired Chrome conversation changed.' };
      }
      if (request.op === 'tabs') {
        if ((await this.siteAccess?.rules())?.[tab.origin] === 'block') {
          grant.abort();
          return { ok: false, error: 'Chrome site access was blocked for the shared tab.' };
        }
        const result = await this.request({ ...request, thread: connection.thread }, true);
        if (!result.ok || !Array.isArray(result.value)) return result;
        const selected = (result.value as DriverTab[]).find(item => item.tabId === tab.tabId && item.origin === tab.origin);
        if (!selected) {
          grant.abort();
          return { ok: true, value: [] };
        }
        return { ok: true, value: [selected] };
      }
      if (request.op === 'run' && request.tab === tab.tabId)
        return this.request({ ...request, thread: connection.thread });
      return { ok: false, error: 'This Cloud Run can operate only the shared Chrome tab.' };
    }, this.evidenceRoot, 'chrome');
    return { browser, signal };
  }

  revoke(thread?: string) {
    this.siteAccess?.forget(thread);
    if (this.ticket && (!thread || this.ticket.thread === thread)) {
      this.endedPairing = { thread: this.ticket.thread, status: { state: 'disconnected', message: 'Chrome access revoked.' } };
      this.ticket = undefined;
    }
    const connection = this.connection;
    if (connection && (!thread || thread === connection.thread)) this.disconnect(connection, 'Chrome access revoked.');
  }

  close() {
    this.revoke();
    for (const socket of this.sockets.clients) socket.terminate();
    this.sockets.close();
  }

  private disconnect(connection: Connection, reason: string,
    status: EndedPairing['status'] = { state: 'disconnected', message: reason }) {
    if (this.connection !== connection) return;
    this.connection = undefined;
    this.siteAccess?.forget(connection.thread);
    this.endedPairing = { thread: connection.thread, status };
    connection.ended.abort();
    clearInterval(connection.timer);
    for (const request of connection.pending.values()) request.settle(new Error(reason));
    connection.socket.close(1000, reason);
  }

  private send(socket: WebSocket, message: object) {
    const body = JSON.stringify(message);
    if (socket.readyState !== 1 || Buffer.byteLength(body) > MAX_FRAME || socket.bufferedAmount > MAX_FRAME)
      throw new Error('Chrome Relay is unavailable.');
    socket.send(body);
  }

  private connect(socket: WebSocket) {
    const deadline = setTimeout(() => socket.close(1008, 'Pairing required.'), 5000);
    let connection: Connection | undefined;
    let received = Promise.resolve();
    const close = () => {
      clearTimeout(deadline);
      if (connection) this.disconnect(connection, 'Chrome Relay disconnected.');
    };
    socket.on('close', close);
    socket.on('error', close);
    socket.on('message', (bytes: RawData, binary: boolean) => {
      const receive = async () => {
        if (binary) throw new Error('Invalid Chrome Relay message.');
        const value: unknown = JSON.parse(bytes.toString());
        if (!connection) {
          const message = pair.parse(value);
          const ticket = this.ticket;
          if (!ticket || ticket.expiresAt <= Date.now() ||
              !timingSafeEqual(Buffer.from(ticket.ticket), Buffer.from(message.ticket)))
            throw new Error('The pairing code is invalid or expired.');
          if (await this.selected() !== ticket.thread || this.ticket !== ticket || socket.readyState !== 1)
            throw new Error('The selected Pero conversation changed.');
          this.ticket = undefined;
          if (message.protocol !== RELAY_PROTOCOL) {
            this.endedPairing = { thread: ticket.thread, status: incompatible };
            socket.close(1008, incompatible.message);
            return;
          }
          const pairedAt = Date.now();
          const timer = setInterval(() => {
            if (connection && (Date.now() - connection.lastSeen > 35000 ||
                Date.now() - pairedAt > 30 * 60_000))
              this.disconnect(connection, connectionExpired.message, connectionExpired);
          }, 5000);
          connection = this.connection = { id: randomUUID(), socket, thread: ticket.thread, timer, lastSeen: pairedAt, next: 0,
            parallel: message.parallel === true, pending: new Map(), ended: new AbortController() };
          clearTimeout(deadline);
          this.send(socket, { type: 'paired', label: ticket.label });
          return;
        }
        if (this.connection !== connection) return;
        const current = connection;
        const message = incoming.parse(value);
        current.lastSeen = Date.now();
        if (message.type === 'ping') {
          this.send(socket, { type: 'pong' });
        } else if (message.type === 'revoke') {
          this.disconnect(current, 'Chrome access revoked.');
        } else if (message.type === 'sidebar') {
          const request = message.request;
          const check = () => {
            if (current !== this.connection) throw new Error('Chrome disconnected.');
            if (request.kind === 'collect' && !webOrigin(request.url)) throw new Error('Choose a regular Chrome web page.');
          };
          let result;
          try {
            check();
            if (!this.sidebar || await this.selected() !== current.thread ||
                (request.kind !== 'snapshot' && message.sessionId !== current.thread))
              throw new Error('Pair this conversation in Pero.');
            result = { value: await this.sidebar(current.thread, request, check) };
          } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error) };
          }
          if (this.connection === current) this.send(current.socket, { type: 'sidebarReply', id: message.id, ...result });
        } else {
          current.pending.get(message.id)?.settle(message.error ? new Error(message.error) : undefined, message.value);
        }
      };
      received = received.then(receive).catch(() => {
        if (connection) this.disconnect(connection, 'Chrome Relay rejected the request.');
        else socket.close(1008, 'The pairing code or selected conversation is unavailable.');
      });
    });
  }

  private call(connection: Connection, command: { kind: 'inspect' | 'inspectCloud' } |
    { kind: 'run'; tab: string; stamp: string; background?: true; operation: DriverOperation } |
    { kind: 'manage'; tab: string; action: TabAction }) {
    if (connection.pending.size >= (connection.parallel ? MAX_PARALLEL_REQUESTS : 1))
      throw new Error('The paired Chrome profile already has the maximum number of in-flight requests.');
    return new Promise<unknown>((resolve, reject) => {
      const id = ++connection.next;
      const settle = (error?: Error, value?: unknown) => {
        clearTimeout(timer);
        connection.pending.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => this.disconnect(connection, 'Chrome Relay did not reply. Check the tab before retrying.'), 16000);
      connection.pending.set(id, { settle });
      try { this.send(connection.socket, { type: 'request', id, command }); }
      catch (error) { settle(error as Error); }
    });
  }

  private async request(request: DriverRequest, cloudWindowOnly = false) {
    try {
      if (request.op === 'revoke') {
        this.revoke(request.thread);
        return { ok: true, value: null };
      }
      const connection = this.connection;
      if (!connection || connection.thread !== request.thread) {
        if (request.op === 'tabs') return { ok: true, value: [] };
        throw new Error('Pair the Pero Chrome extension with this conversation.');
      }
      if (await this.selected() !== request.thread || connection !== this.connection)
        throw new Error('The selected Pero conversation changed.');
      if (request.op === 'tabs') {
        const tabs = z.array(snapshot).parse(await this.call(connection, { kind: cloudWindowOnly ? 'inspectCloud' : 'inspect' }));
        if (await this.selected() !== request.thread || connection !== this.connection)
          return { ok: true, value: [] };
        const value: DriverTab[] = tabs.flatMap(tab => {
          const origin = webOrigin(tab.url);
          if (!origin) return [];
          return [{ origin, tabId: 'chrome:' + tab.id, grantId: connection.id, url: tab.url, title: tab.title,
            visible: tab.active, active: tab.active, stamp: tab.ready ? tab.revision + ':' + tab.url : null, loadError: null }];
        });
        return { ok: true, value };
      }
      const tab = request.tab.startsWith('chrome:') ? tabIdentity.safeParse(request.tab.slice('chrome:'.length)) : undefined;
      if (!tab?.success || (request.op === 'manage' && request.grant !== connection.id))
        throw new Error('The selected Chrome tab is unavailable. List tabs again.');
      const value = await this.call(connection, request.op === 'run'
        ? { kind: 'run', tab: tab.data, stamp: request.stamp, background: request.background, operation: request.operation }
        : { kind: 'manage', tab: tab.data, action: request.command });
      if (await this.selected() !== request.thread || connection !== this.connection)
        throw new Error('The paired Chrome conversation changed.');
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class WorkbenchBrowserUse implements BrowserUsePort {
  readonly tool: BrowserUsePort['tool'];
  private readonly embedded: BrowserUsePort;
  readonly relay: ChromeRelay;

  constructor(
    embedded: BrowserUsePort,
    selected: () => Promise<string | undefined>,
    evidenceRoot: string,
    sidebar?: SidebarPort,
    private readonly workspace: 'local' | 'ssh' = 'local',
    sitePort?: ChromeSiteAccessPort,
    approveDiagnostics?: BrowserDiagnosticApproval,
    private readonly siteTools?: SiteToolAccess,
  ) {
    this.embedded = embedded;
    this.relay = new ChromeRelay(selected, evidenceRoot, sidebar, sitePort, approveDiagnostics, siteTools);
    const tool = embedded.tool;
    this.tool = { ...tool, inputSchema: approveDiagnostics && siteTools ? browserInputSchema : limitedBrowserSchema(false, !!approveDiagnostics, !!siteTools), description: tool.description + ' Use act to locate a unique element and apply operation in one call, optionally waiting up to timeoutMs for it to appear. Pair Chrome from the Workbench to use regular Chrome web tabs in this conversation. tabs includes Chrome connection state and chrome: tab IDs. Use status with provider "chrome" to check Chrome explicitly. Pass background: true with an explicit chrome: tabId to observe or act on an inactive tab without selecting it. Chrome supports ' +
      chromeActions.filter(action => (action !== 'diagnose' || !!approveDiagnostics) &&
        (!browserSiteToolAction(action) || !!siteTools)).join(', ') + '. In Chrome, click with expectPopup returns a new web tab ID in the paired profile. Read a JavaScript dialog with getJsDialog and use handleJsDialog with its dialogId and decision. Chrome download requires an observed same-origin link. Pass its tabId to distinguish it from an embedded tab.' +
      (approveDiagnostics ? ' diagnose captures console messages, runtime errors, network timing, and Chromium performance metrics on the selected site. Set style to a selector and properties to read computed CSS. Set profile to true to sample CPU activity where supported. Browser Developer Mode and separate user approval are required.' : '') };
    if (this.workspace === 'ssh') {
      this.tool = {
        ...this.tool,
        inputSchema: limitedBrowserSchema(true),
        description: 'Observe and operate local web tabs explicitly shared with this SSH Workbench conversation. Start with tabs or status with provider "chrome". Workbench authorizes embedded web tabs and pairs Chrome. Pass the chrome: tabId for a Chrome tab and background: true to use an inactive Chrome tab. Use act to locate and operate in one call, or locate a fresh ref before input. Observe again to verify effects. Use getJsDialog and handleJsDialog for JavaScript dialogs.',
      };
    }
  }
  revoke(thread?: string) { this.embedded.revoke(thread); this.relay.browser.revoke(thread); }
  async forget(thread: string) { await this.embedded.forget(thread); await this.relay.browser.forget(thread); }
  async call(thread: string, input: unknown, signal: AbortSignal, files: AppInputs, workspace?: string, deliver?: ArtifactDeliveryPort) {
    const request = browserRequest.parse(input);
    if ('background' in request && request.background && !request.tabId?.startsWith('chrome:'))
      throw new Error('Background Browser Use requires an explicit Chrome tabId.');
    if (request.action === 'diagnose' && this.workspace === 'ssh')
      throw new Error('Browser Developer Mode requires a local Workbench conversation.');
    if (request.action === 'listSiteTools' || request.action === 'callSiteTool') {
      if (!this.siteTools || this.workspace === 'ssh')
        throw new Error('Browser Site Tools require a local Workbench conversation.');
      const target = request.tabId?.startsWith('chrome:') ? this.relay.browser : this.embedded;
      return target.call(thread, request, signal, files, workspace, deliver);
    }
    if (this.workspace === 'ssh' && browserFileAction(request.action))
      throw new Error('Browser file operations require a local Workbench conversation.');
    const { browser } = this.relay;
    if (request.action === 'tabs') {
      const local = await this.embedded.call(thread, input, signal, files, workspace, deliver);
      const chrome = await browser.call(thread, input, signal, files);
      return { kind: 'tabs', tabs: [...local.tabs as unknown[], ...chrome.tabs as unknown[]], chrome: this.relay.status(thread) };
    }
    if (request.action === 'status' && request.provider === 'chrome')
      return { ...await browser.call(thread, request, signal, files), chrome: this.relay.status(thread) };
    if (request.action === 'status' && request.provider === 'embedded')
      return this.embedded.call(thread, request, signal, files, workspace, deliver);
    const target = request.tabId?.startsWith('chrome:') || (!request.tabId && this.relay.paired(thread)) ? browser : this.embedded;
    if (request.action === 'act') {
      const { tabId, background, locator, frame, within, timeoutMs, operation } = request;
      const scope = { tabId, background, locator, frame, within };
      const observed = await target.call(thread, timeoutMs
        ? { ...scope, action: 'wait', condition: { kind: 'visible' }, timeoutMs }
        : { ...scope, action: 'locate' }, signal, files, workspace, deliver);
      if (observed.kind !== 'observation') return observed;
      const node = (observed.nodes as BrowserNode[])[0];
      if (!node?.ref || !node.actions?.includes(operation.action))
        throw new Error('The located element does not support this operation.');
      return target.call(thread, { ...operation, tabId, background, ref: node.ref }, signal, files, workspace, deliver);
    }
    return target.call(thread, input, signal, files, workspace, deliver);
  }
}

function browserFileAction(action: BrowserRequest['action']) {
  return action === 'files' || action === 'upload' || action === 'download';
}

function browserSiteToolAction(action: BrowserRequest['action']) {
  return action === 'listSiteTools' || action === 'callSiteTool';
}

function limitedBrowserSchema(ssh: boolean, diagnostics = false, siteTools = false) {
  return {
    type: 'object',
    anyOf: browserRequest.options.filter(({ shape }) => (diagnostics || shape.action.value !== 'diagnose') &&
      (siteTools || !browserSiteToolAction(shape.action.value)) &&
      !(ssh && browserFileAction(shape.action.value))).map(schema => {
      const { $schema: _, ...action } = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'throw' });
      return action;
    }),
  };
}
