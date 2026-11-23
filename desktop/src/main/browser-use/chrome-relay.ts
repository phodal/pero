// Local transport for Point's staged Chrome Relay flow, owned by Pero App Use.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { z } from 'zod';
import { EXTENSION_ID, MAX_FRAME, PAIR_LIFETIME_MS, RELAY_PATH, RELAY_PROTOCOL, webOrigin, type Pairing } from '../../../../packages/chrome-extension/src/protocol.ts';
import type { ArtifactDeliveryPort } from '../artifact-delivery.ts';
import type { AppInputs } from '../app-inputs.ts';
import type { BrowserUsePort } from './browser-use.ts';
import { chromeActions, NativeBrowserUse, type DriverOperation, type DriverRequest, type DriverTab } from './native-use.ts';
import { browserRequest } from './request.ts';

const pair = z.strictObject({
  type: z.literal('pair'), protocol: z.literal(RELAY_PROTOCOL), ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const snapshot = z.strictObject({
  url: z.string().min(1).max(4096), title: z.string().max(160),
  active: z.boolean(), ready: z.boolean(), revision: z.number().int().min(0).safe(),
});
const incoming = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('approve'), tab: snapshot }),
  z.strictObject({ type: z.literal('response'), id: z.number().int().positive().safe(), value: z.unknown().optional(), error: z.string().max(500).optional() }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('revoke') }),
]);
type TabSnapshot = z.infer<typeof snapshot>;
type Ticket = Pairing & { thread: string };
type Pending = { settle(error?: Error, value?: unknown): void };
type Connection = {
  socket: WebSocket; thread: string; timer: NodeJS.Timeout; lastSeen: number; next: number; pending?: Pending;
  grant?: { id: string; tabId: string; origin: string };
};

export class ChromeRelay {
  readonly browser: BrowserUsePort;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  private server?: Server;
  private ticket?: Ticket;
  private connection?: Connection;

  private readonly selected: () => Promise<string | undefined>;

  constructor(selected: () => Promise<string | undefined>, evidenceRoot: string) {
    this.selected = selected;
    this.browser = new NativeBrowserUse(request => this.request(request), evidenceRoot, 'chrome');
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
    const pairing: Pairing = { protocol: RELAY_PROTOCOL, baseUrl: `http://127.0.0.1:${address.port}`,
      ticket: randomBytes(32).toString('base64url'), expiresAt: Date.now() + PAIR_LIFETIME_MS,
      label: label.slice(0, 160) || 'Selected Pero conversation' };
    this.ticket = { ...pairing, thread };
    return JSON.stringify(pairing);
  }

  approved(thread: string) {
    return this.connection?.thread === thread && !!this.connection.grant;
  }

  revoke(thread?: string) {
    if (!thread || this.ticket?.thread === thread) this.ticket = undefined;
    const connection = this.connection;
    if (connection && (!thread || thread === connection.thread)) this.disconnect(connection, 'Chrome access revoked.');
  }

  close() {
    this.revoke();
    for (const socket of this.sockets.clients) socket.terminate();
    this.sockets.close();
  }

  private disconnect(connection: Connection, reason: string) {
    if (this.connection !== connection) return;
    this.connection = undefined;
    clearInterval(connection.timer);
    connection.pending?.settle(new Error(reason));
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
    let authenticating = false;
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
          if (authenticating) throw new Error('Pairing is in progress.');
          authenticating = true;
          const message = pair.parse(value);
          const ticket = this.ticket;
          if (!ticket || ticket.expiresAt <= Date.now() ||
              !timingSafeEqual(Buffer.from(ticket.ticket), Buffer.from(message.ticket)))
            throw new Error('The pairing code is invalid or expired.');
          if (await this.selected() !== ticket.thread || this.ticket !== ticket || socket.readyState !== 1)
            throw new Error('The selected Pero conversation changed.');
          this.ticket = undefined;
          const pairedAt = Date.now();
          const timer = setInterval(() => {
            if (connection && (Date.now() - connection.lastSeen > 35000 ||
                Date.now() - pairedAt > (connection.grant ? 30 * 60_000 : PAIR_LIFETIME_MS)))
              this.disconnect(connection, 'Chrome Relay expired.');
          }, 5000);
          connection = this.connection = { socket, thread: ticket.thread, timer, lastSeen: pairedAt, next: 0 };
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
        } else if (message.type === 'approve') {
          const origin = webOrigin(message.tab.url);
          if (!origin || !message.tab.active || !message.tab.ready ||
              await this.selected() !== current.thread || this.connection !== current || current.grant)
            throw new Error('The reviewed Chrome tab or Pero conversation changed.');
          const id = randomUUID();
          current.grant = { id, tabId: 'chrome:' + id, origin };
          this.send(socket, { type: 'approved' });
        } else {
          if (!current.pending || message.id !== current.next)
            return; // A timed out reply can arrive after its action was invalidated.
          current.pending.settle(message.error ? new Error(message.error) : undefined, message.value);
        }
      };
      void receive().catch(() => {
        if (connection) this.disconnect(connection, 'Chrome Relay rejected the request.');
        else socket.close(1008, 'The pairing code or selected conversation is unavailable.');
      });
    });
  }

  private call(connection: Connection, command: { kind: 'inspect' } | { kind: 'run'; stamp: string; operation: DriverOperation }) {
    if (connection.pending) throw new Error('A Chrome Browser Use operation is already in progress.');
    return new Promise<unknown>((resolve, reject) => {
      const settle = (error?: Error, value?: unknown) => {
        clearTimeout(timer);
        connection.pending = undefined;
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => this.disconnect(connection, 'Chrome Relay did not reply. Check the tab before retrying.'), 8000);
      connection.pending = { settle };
      try { this.send(connection.socket, { type: 'request', id: ++connection.next, command }); }
      catch (error) { settle(error as Error); }
    });
  }

  private async request(request: DriverRequest) {
    try {
      if (request.op === 'revoke') {
        this.revoke(request.thread);
        return { ok: true, value: null };
      }
      const connection = this.connection, grant = connection?.grant;
      if (!connection || !grant || connection.thread !== request.thread) {
        if (request.op === 'tabs') return { ok: true, value: [] };
        throw new Error('Pair the Pero Chrome extension and allow this tab.');
      }
      if (await this.selected() !== request.thread || connection !== this.connection)
        throw new Error('The selected Pero conversation changed.');
      if (request.op === 'tabs') {
        const tab: TabSnapshot = snapshot.parse(await this.call(connection, { kind: 'inspect' }));
        if (await this.selected() !== request.thread || connection !== this.connection)
          return { ok: true, value: [] };
        if (webOrigin(tab.url) !== grant.origin) {
          this.disconnect(connection, 'Chrome tab left the authorized site.');
          return { ok: true, value: [] };
        }
        const value: DriverTab = { origin: grant.origin, tabId: grant.tabId, grantId: grant.id, url: tab.url, title: tab.title, visible: tab.active,
          active: tab.active, stamp: tab.ready && tab.active ? `${tab.revision}:${tab.url}` : null, loadError: null };
        return { ok: true, value: [value] };
      }
      if (request.op !== 'run' || request.tab !== grant.tabId ||
          !['check', 'evaluate', 'dispatch'].includes(request.operation.kind))
        throw new Error('This operation is unavailable in the Pero Chrome extension.');
      const value = await this.call(connection, { kind: 'run', stamp: request.stamp, operation: request.operation });
      if (await this.selected() !== request.thread || connection !== this.connection)
        throw new Error('Chrome authorization changed.');
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class WorkbenchBrowserUse implements BrowserUsePort {
  readonly tool;
  private readonly embedded: BrowserUsePort;
  private readonly relay: ChromeRelay;

  constructor(embedded: BrowserUsePort, relay: ChromeRelay) {
    this.embedded = embedded;
    this.relay = relay;
    const tool = embedded.tool;
    this.tool = { ...tool, description: tool.description + ' Pero Chrome Relay tabs use a chrome: tabId. Pair from the Workbench, then approve the specific tab in the extension. Chrome supports ' +
      chromeActions.join(', ') + '. Pass its tabId to distinguish it from an embedded tab.' };
  }
  revoke(thread?: string) { this.embedded.revoke(thread); this.relay.browser.revoke(thread); }
  async forget(thread: string) { await this.embedded.forget(thread); await this.relay.browser.forget(thread); }
  async call(thread: string, input: unknown, signal: AbortSignal, files: AppInputs, workspace?: string, deliver?: ArtifactDeliveryPort) {
    const request = browserRequest.parse(input);
    const { browser } = this.relay;
    if (request.action === 'tabs') {
      const local = await this.embedded.call(thread, input, signal, files, workspace, deliver);
      const chrome = await browser.call(thread, input, signal, files);
      return { kind: 'tabs', tabs: [...local.tabs as unknown[], ...chrome.tabs as unknown[]] };
    }
    const target = request.tabId?.startsWith('chrome:') || (!request.tabId && this.relay.approved(thread)) ? browser : this.embedded;
    return target.call(thread, input, signal, files, workspace, deliver);
  }
}
