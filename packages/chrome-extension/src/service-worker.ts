// Point Relay's reviewed-tab gate and socket lifecycle, adapted for Pero's local
// conversation endpoint. Point source: browser/chrome-extension/relay.mjs (2449d4b98).
import { parseRelayPairing, webOrigin, MAX_FRAME, RELAY_PATH, RELAY_PROTOCOL } from './protocol.ts';
import { sendBrowserInput, type BrowserInput, type BrowserModifier } from '../../../desktop/src/main/browser-use/input.ts';
import type { DriverOperation } from '../../../desktop/src/main/browser-use/native-use.ts';

type ChromeTab = { id?: number; windowId?: number; active?: boolean; incognito?: boolean; status?: string; url?: string; pendingUrl?: string; title?: string };
type Review = { nonce: string; tabId: number; url: string; expiresAt: number };
type Claim = { tabId: number; origin: string; revision: number; world: string };
type Peer = { socket: WebSocket; state: 'connecting' | 'paired' | 'authorizing' | 'approved'; label: string; timer?: number;
  lastPong: number; lastId: number; busy: boolean; review?: Review; claim?: Claim };

let peer: Peer | undefined;
let failure: string | undefined;

function status() {
  return { state: peer?.state ?? 'disconnected', label: peer?.label, origin: peer?.claim?.origin, error: failure };
}

function publish() {
  void chrome.runtime.sendMessage({ type: 'pero.relay.changed', ...status() }).catch(() => {});
}

function send(connection: Peer, message: object) {
  if (peer !== connection || connection.socket.readyState !== WebSocket.OPEN)
    throw new Error('The Pero Relay disconnected.');
  const body = JSON.stringify(message);
  if (new TextEncoder().encode(body).length > MAX_FRAME || connection.socket.bufferedAmount > MAX_FRAME)
    throw new Error('The Chrome Relay message exceeds its limit.');
  connection.socket.send(body);
}

async function release(connection: Peer, reason?: string) {
  if (peer !== connection) return;
  peer = undefined;
  failure = reason;
  clearInterval(connection.timer);
  connection.socket.close();
  const claim = connection.claim;
  connection.claim = undefined;
  if (claim) await chrome.debugger.detach({ tabId: claim.tabId }).catch(() => {});
  publish();
}

function inScope(tab: ChromeTab, origin: string) {
  return !tab.incognito && !!tab.url && webOrigin(tab.url) === origin &&
    (!tab.pendingUrl || webOrigin(tab.pendingUrl) === origin);
}

async function snapshot(connection: Peer, claim: Claim) {
  const tab: ChromeTab = await chrome.tabs.get(claim.tabId);
  if (peer !== connection || connection.claim !== claim || !inScope(tab, claim.origin))
    throw new Error('The Chrome tab left its authorization.');
  const window = tab.windowId === undefined ? undefined : await chrome.windows.get(tab.windowId);
  if (peer !== connection || connection.claim !== claim) throw new Error('The Chrome tab left its authorization.');
  return { url: tab.url!, title: (tab.title ?? '').slice(0, 160), active: !!tab.active && window?.state !== 'minimized',
    ready: tab.status === 'complete' && (!tab.pendingUrl || tab.pendingUrl === tab.url), revision: claim.revision };
}

async function run(connection: Peer, command: { kind: 'inspect' } | { kind: 'run'; stamp: string; operation: DriverOperation }) {
  const claim = connection.claim;
  if (connection.state !== 'approved' || !claim) throw new Error('Allow this Chrome tab before using it.');
  const tab = await snapshot(connection, claim);
  if (command.kind === 'inspect') return tab;
  if (command.kind !== 'run') throw new Error('Unknown Chrome Relay command.');
  if (!tab.active || !tab.ready || command.stamp !== `${tab.revision}:${tab.url}`)
    throw new Error('The selected Chrome tab or document changed.');
  const operation = command.operation;
  const target = { tabId: claim.tabId };
  const cdp = (method: string, params?: Record<string, unknown>) =>
    chrome.debugger.sendCommand(target, method, params);
  if (operation.kind === 'check') return null;
  if (operation.kind === 'evaluate') {
    if (typeof operation.script !== 'string' || operation.script.length > 100_000)
      throw new Error('Invalid Chrome Browser Use document operation.');
    const { frameTree } = await cdp('Page.getFrameTree');
    const frame = frameTree?.frame;
    if (!frame || webOrigin(frame.url) !== claim.origin)
      throw new Error('The Chrome tab left its authorization.');
    const { executionContextId } = await cdp('Page.createIsolatedWorld', { frameId: frame.id, worldName: claim.world });
    const result = await cdp('Runtime.evaluate', {
      expression: operation.script, contextId: executionContextId, returnByValue: true, silent: true,
    });
    if (result.exceptionDetails || !result.result || result.result.value === undefined)
      throw new Error('The authorized Chrome document did not answer.');
    return result.result.value;
  }
  if (operation.kind === 'dispatch') {
    const input = operation.input;
    let event: BrowserInput;
    if (input.kind === 'key') {
      event = { kind: 'press', key: input.key, modifiers: input.modifiers as BrowserModifier[] | undefined };
    } else {
      if (![input.x, input.y].every(value => Number.isFinite(value) && value >= 0 && value <= 16384))
        throw new Error('Invalid Chrome viewport point.');
      const point = { x: input.x, y: input.y };
      if (input.kind === 'wheel') {
        event = { kind: 'scroll', point, deltaX: input.delta_x, deltaY: input.delta_y };
      } else if (input.count === 0) event = { kind: 'hover', point };
      else if (input.count === 1 || input.count === 2) event = { kind: 'click', point, count: input.count };
      else throw new Error('Invalid Chrome click count.');
    }
    await sendBrowserInput(cdp, () => peer === connection && connection.claim === claim, event);
    return null;
  }
  throw new Error('This action is unavailable in the Pero Chrome extension.');
}

function connect(code: string) {
  if (peer) throw new Error('Disconnect the current Pero session first.');
  const pairing = parseRelayPairing(code.trim());
  const socket = new WebSocket(pairing.baseUrl.replace('http:', 'ws:') + RELAY_PATH);
  const connection: Peer = { socket, state: 'connecting', label: pairing.label, lastPong: Date.now(), lastId: 0, busy: false };
  peer = connection;
  failure = undefined;
  publish();
  socket.onopen = () => send(connection, { type: 'pair', protocol: RELAY_PROTOCOL, ticket: pairing.ticket });
  socket.onclose = event => void release(connection, event.reason || 'The Pero Relay disconnected.');
  socket.onerror = () => void release(connection, 'Could not connect to Pero. Check the pairing code.');
  connection.timer = setInterval(() => {
    if (peer !== connection) return;
    if (Date.now() - connection.lastPong > (connection.state === 'connecting' ? 5000 : 25000)) {
      void release(connection, 'The Pero Relay stopped responding.');
    } else if (socket.readyState === WebSocket.OPEN && connection.state !== 'connecting') {
      send(connection, { type: 'ping' });
    }
  }, 5000);
  socket.onmessage = event => {
    const receive = async () => {
      if (peer !== connection) return;
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > MAX_FRAME)
        throw new Error('Invalid Pero Relay frame.');
      const message = JSON.parse(event.data);
      if (message.type === 'pong') { connection.lastPong = Date.now(); return; }
      if (message.type === 'paired' && connection.state === 'connecting') {
        connection.state = 'paired';
        connection.label = message.label;
        connection.lastPong = Date.now();
        publish();
        return;
      }
      if (message.type === 'approved' && connection.state === 'authorizing' && connection.claim) {
        connection.state = 'approved';
        publish();
        return;
      }
      if (message.type !== 'request' || connection.state !== 'approved' || connection.busy ||
          !Number.isSafeInteger(message.id) || message.id <= connection.lastId)
        throw new Error('Invalid Pero Relay request.');
      connection.lastId = message.id;
      connection.busy = true;
      try {
        let value;
        try { value = await run(connection, message.command); }
        catch (error) {
          if (peer === connection) send(connection, { type: 'response', id: message.id,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
          return;
        }
        if (peer === connection) send(connection, { type: 'response', id: message.id, value });
      } finally { connection.busy = false; }
    };
    void receive().catch(error => void release(connection, error.message));
  };
}

chrome.tabs.onUpdated.addListener((tabId: number, change: { status?: string; url?: string }, tab: ChromeTab) => {
  const connection = peer, claim = connection?.claim;
  if (!connection || !claim || claim.tabId !== tabId) return;
  if (!inScope(tab, claim.origin)) void release(connection, 'The Chrome tab left the authorized site.');
  else if (change.status === 'loading' || change.url) claim.revision++;
});
chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (peer?.claim?.tabId === tabId) void release(peer, 'The authorized Chrome tab closed.');
});
chrome.debugger.onDetach.addListener(({ tabId }: { tabId?: number }) => {
  const connection = peer;
  if (connection?.claim && connection.claim.tabId === tabId) void release(connection, 'Chrome detached Browser Use.');
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('relay.html')) return false;
  const handle = async () => {
    if (message.type === 'status') return status();
    if (message.type === 'pair') { connect(message.code); return status(); }
    if (message.type === 'stop') {
      if (peer) {
        const connection = peer;
        try { if (connection.socket.readyState === WebSocket.OPEN) send(connection, { type: 'revoke' }); }
        finally { await release(connection); }
      }
      return status();
    }
    const connection = peer;
    if (!connection || connection.state !== 'paired' || connection.claim)
      throw new Error('Pair with Pero before allowing a Chrome tab.');
    if (message.type === 'preview') {
      if (!Number.isInteger(message.tabId)) throw new Error('Choose a Chrome tab to review.');
      const tab: ChromeTab = await chrome.tabs.get(message.tabId);
      const origin = tab.url && webOrigin(tab.url);
      if (!tab.active || tab.status !== 'complete' || !origin || !inScope(tab, origin) || peer !== connection)
        throw new Error('Select a loaded HTTP or HTTPS tab in Chrome, then review it again.');
      const nonce = crypto.randomUUID();
      connection.review = { nonce, tabId: tab.id!, url: tab.url!, expiresAt: Date.now() + 60000 };
      return { nonce, title: tab.title, url: tab.url };
    }
    if (message.type === 'allow') {
      const review = connection.review;
      connection.review = undefined;
      if (!review || review.nonce !== message.nonce || review.expiresAt <= Date.now())
        throw new Error('Review this Chrome tab again.');
      const tab: ChromeTab = await chrome.tabs.get(review.tabId);
      if (!tab.active || tab.url !== review.url || tab.status !== 'complete' || tab.pendingUrl && tab.pendingUrl !== tab.url ||
          peer !== connection || connection.claim) throw new Error('The reviewed tab changed.');
      const target = { tabId: review.tabId };
      connection.state = 'authorizing';
      let attached = false;
      try {
        await chrome.debugger.attach(target, '1.3');
        attached = true;
        if (peer !== connection) throw new Error('The Pero Relay disconnected.');
        const claim = connection.claim = { tabId: review.tabId, origin: webOrigin(review.url)!, revision: 0, world: 'PeroBrowserUse-' + crypto.randomUUID() };
        const current = await snapshot(connection, claim);
        if (current.url !== review.url || !current.ready || !current.active) throw new Error('The reviewed tab changed.');
        send(connection, { type: 'approve', tab: current });
      } catch (error) {
        connection.claim = undefined;
        if (attached) await chrome.debugger.detach(target).catch(() => {});
        if (peer === connection) connection.state = 'paired';
        throw error;
      }
      return status();
    }
    throw new Error('Unknown Pero Relay action.');
  };
  void handle().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
