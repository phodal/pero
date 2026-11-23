// Point Relay's reviewed-tab gate and socket lifecycle, adapted for Pero's local
// conversation endpoint. Point source: browser/chrome-extension/relay.mjs (2449d4b98).
import { parseRelayPairing, webOrigin, MAX_FRAME, MAX_TRANSFER_BYTES, RELAY_PATH, RELAY_PROTOCOL } from './protocol.ts';
import { sendBrowserInput, type BrowserInput, type BrowserModifier } from '../../../desktop/src/main/browser-use/input.ts';
import { checkFrames, downloadLink, evaluateDocument, navigate, screenshot } from './tab-operations.ts';
import type { DriverOperation, TabAction } from '../../../desktop/src/main/browser-use/native-use.ts';

import { readVisiblePage } from './collector-capture.js';

type ChromeTab = { id?: number; windowId?: number; active?: boolean; incognito?: boolean; status?: string; url?: string; pendingUrl?: string; title?: string };
type Review = { nonce: string; tabId: number; url: string; expiresAt: number };
type Claim = { id: string; tabId: number; origin: string; revision: number; world: string; navigating?: boolean };
type Command = { kind: 'inspect' } | { kind: 'run'; grant: string; stamp: string; operation: DriverOperation } |
  { kind: 'manage'; grant: string; action: TabAction };
type Peer = { socket: WebSocket; state: 'connecting' | 'paired' | 'authorizing' | 'approved'; label: string; timer?: number;
  lastPong: number; lastId: number; busy: boolean; review?: Review; claims: Map<number, Claim>; opened: Map<number, string>;
  sidebar: Map<string, (reply: {value?: unknown; error?: string}) => void>;
  capture?: { key: string; grant: string; url: string; revision: number };
  authorizing?: string; opening?: number };

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let peer: Peer | undefined;
let failure: string | undefined;

function status() {
  return { state: peer?.state ?? 'disconnected', label: peer?.label,
    approvedTabIds: [...(peer?.claims.keys() ?? [])], error: failure };
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
  for (const finish of connection.sidebar.values()) finish({ error: 'The paired conversation disconnected.' });
  connection.sidebar.clear();
  failure = reason;
  clearInterval(connection.timer);
  connection.socket.close();
  const tabs = [...connection.claims.keys()];
  if (connection.opening !== undefined) tabs.push(connection.opening);
  connection.claims.clear();
  await Promise.all(tabs.map(tabId => chrome.debugger.detach({ tabId }).catch(() => {})));
  publish();
}

async function revokeTab(connection: Peer, claim: Claim) {
  if (connection.claims.get(claim.tabId) !== claim) return;
  connection.claims.delete(claim.tabId);
  if (connection.authorizing === claim.id) connection.authorizing = undefined;
  connection.state = connection.authorizing ? 'authorizing' : connection.claims.size ? 'approved' : 'paired';
  send(connection, { type: 'tabRevoked', grant: claim.id });
  publish();
  await chrome.debugger.detach({ tabId: claim.tabId }).catch(() => {});
}

function inScope(tab: ChromeTab, origin: string, navigating = false) {
  return !tab.incognito && !!tab.url && webOrigin(tab.url) === origin &&
    (navigating || !tab.pendingUrl || webOrigin(tab.pendingUrl) === origin);
}

async function snapshot(connection: Peer, claim: Claim) {
  const tab: ChromeTab = await chrome.tabs.get(claim.tabId);
  if (!inScope(tab, claim.origin, claim.navigating)) throw new Error('The Chrome tab left its authorization.');
  const window = tab.windowId === undefined ? undefined : await chrome.windows.get(tab.windowId);
  if (peer !== connection || connection.claims.get(claim.tabId) !== claim)
    throw new Error('The Chrome tab left its authorization.');
  return { id: claim.id, url: tab.url!, title: (tab.title ?? '').slice(0, 160),
    active: !!tab.active && window?.state !== 'minimized',
    ready: tab.status === 'complete' && (!tab.pendingUrl || tab.pendingUrl === tab.url), revision: claim.revision };
}

async function run(connection: Peer, command: Command) {
  if (command.kind === 'inspect') {
    const tabs = await Promise.allSettled([...connection.claims.values()].map(claim => snapshot(connection, claim)));
    return tabs.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  }
  const claim = [...connection.claims.values()].find(claim => claim.id === command.grant);
  if (!claim) throw new Error('Allow this Chrome tab before using it.');
  const tab = await snapshot(connection, claim);
  if (command.kind === 'manage') {
    if (command.action.kind === 'activate') {
      await chrome.tabs.update(claim.tabId, { active: true });
      return { kind: 'tabActivated', tabId: 'chrome:' + claim.id };
    }
    if (command.action.kind === 'close') {
      await chrome.tabs.remove(claim.tabId);
      return { kind: 'tabClosed', tabId: 'chrome:' + claim.id };
    }
    if (!tab.active || !tab.ready || webOrigin(command.action.url) !== claim.origin)
      throw new Error('Open a same-origin page from the active approved Chrome tab.');
    const source: ChromeTab = await chrome.tabs.get(claim.tabId);
    const opened = await chrome.tabs.create({ windowId: source.windowId, url: 'about:blank', active: true });
    if (opened.id === undefined) throw new Error('Chrome did not open the requested tab.');
    const target = { tabId: opened.id };
    try {
      if (peer !== connection) throw new Error('The Pero Relay disconnected.');
      connection.opening = opened.id;
      await chrome.debugger.attach(target, '1.3');
      try {
        if (peer !== connection) throw new Error('The Pero Relay disconnected.');
        const cdp = (method: string, params?: Record<string, unknown>) => chrome.debugger.sendCommand(target, method, params);
        const result = await navigate(cdp, opened.id, claim.origin, { kind: 'navigate', url: command.action.url }, true);
        if (result) throw new Error(result.rejected);
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    } catch (error) {
      await chrome.tabs.remove(opened.id).catch(() => {});
      throw error;
    } finally {
      connection.opening = undefined;
    }
    const id = crypto.randomUUID();
    connection.opened.set(opened.id, id);
    return { kind: 'tabOpened', tabId: 'chrome:' + id, url: command.action.url, authorized: false };
  }
  if (command.kind !== 'run') throw new Error('Unknown Chrome Relay command.');
  if (!tab.active || !tab.ready || command.stamp !== `${tab.revision}:${tab.url}`)
    throw new Error('The selected Chrome tab or document changed.');
  const operation = command.operation;
  const target = { tabId: claim.tabId };
  const cdp = (method: string, params?: Record<string, unknown>) =>
    chrome.debugger.sendCommand(target, method, params);
  if (operation.kind === 'check') return null;
  if (operation.kind === 'checkFrames') return checkFrames(claim.tabId, claim.origin);
  if (operation.kind === 'evaluate') {
    const limit = operation.files ? Math.ceil(MAX_TRANSFER_BYTES / 3) * 4 + 100_000 : 100_000;
    if (typeof operation.script !== 'string' || operation.script.length > limit)
      throw new Error('Invalid Chrome Browser Use document operation.');
    return evaluateDocument(cdp, claim.world, claim.origin, operation.script);
  }
  if (operation.kind === 'screenshot') {
    const frames = await checkFrames(claim.tabId, claim.origin);
    const image = await screenshot(cdp, operation.clip);
    if (frames !== await checkFrames(claim.tabId, claim.origin))
      throw new Error('The Chrome document changed during screenshot capture.');
    return image;
  }
  if (operation.kind === 'download') return downloadLink(cdp, claim.world, claim.origin, operation.url);
  if (operation.kind === 'navigate' || operation.kind === 'history') {
    claim.navigating = true;
    try {
      const result = await navigate(cdp, claim.tabId, claim.origin, operation);
      if (!result) claim.revision++;
      return result;
    } finally {
      claim.navigating = false;
    }
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
    await sendBrowserInput(cdp, () => peer === connection && connection.claims.get(claim.tabId) === claim, event);
    return null;
  }
  throw new Error('This action is unavailable in the Pero Chrome extension.');
}

function connect(code: string) {
  if (peer) throw new Error('Disconnect the current Pero session first.');
  const pairing = parseRelayPairing(code.trim());
  const socket = new WebSocket(pairing.baseUrl.replace('http:', 'ws:') + RELAY_PATH);
  const connection: Peer = { socket, state: 'connecting', label: pairing.label, lastPong: Date.now(), lastId: 0, busy: false, claims: new Map(), opened: new Map(), sidebar: new Map() };
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
      if (message.type === 'sidebarReply') {
        connection.sidebar.get(message.id)?.(message);
        return;
      }
      if (message.type === 'pong') { connection.lastPong = Date.now(); return; }
      if (message.type === 'paired' && connection.state === 'connecting') {
        connection.state = 'paired';
        connection.label = message.label;
        connection.lastPong = Date.now();
        publish();
        return;
      }
      if (message.type === 'approved') {
        if (connection.authorizing === message.grant) {
          connection.authorizing = undefined;
          connection.state = 'approved';
        }
        publish();
        return;
      }
      if (message.type !== 'request' || connection.state === 'connecting' || connection.busy ||
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
  const connection = peer, claim = connection?.claims.get(tabId);
  if (!connection || !claim) return;
  if (!inScope(tab, claim.origin, claim.navigating)) void revokeTab(connection, claim).catch(error => void release(connection, error.message));
  else if (change.status === 'loading' || change.url) claim.revision++;
});
chrome.tabs.onRemoved.addListener((tabId: number) => {
  const connection = peer, claim = connection?.claims.get(tabId);
  connection?.opened.delete(tabId);
  if (connection && claim) void revokeTab(connection, claim).catch(error => void release(connection, error.message));
});
chrome.debugger.onDetach.addListener(({ tabId }: { tabId?: number }) => {
  const connection = peer, claim = tabId === undefined ? undefined : connection?.claims.get(tabId);
  if (connection && claim) void revokeTab(connection, claim).catch(error => void release(connection, error.message));
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const source = sender.url?.split('#', 1)[0];
  if (sender.id !== chrome.runtime.id) return false;
  const panel = source === chrome.runtime.getURL('sidepanel.html'), collector = source === chrome.runtime.getURL('collector.html');
  if (!panel && !collector && source !== chrome.runtime.getURL('relay.html')) return false;
  const handle = async () => {
    if (message.type === 'status') return status();
    if (panel || collector) {
      const connection = peer;
      if (!connection || !['paired','approved'].includes(connection.state)) throw new Error('Write a draft here. To send it, pair from Pero Native → Settings → Browser Use.');
      let request = message.request;
      if (message.type === 'capture' || message.type === 'share') {
        const claim = connection.claims.get(message.tabId);
        if (!claim) throw new Error('Review and allow this tab before reading it.');
        const before = await snapshot(connection, claim);
        if (!before.active || !before.ready) throw new Error('Activate the approved tab first.');
        const cdp = (method: string, params?: Record<string, unknown>) => chrome.debugger.sendCommand({tabId: claim.tabId}, method, params);
        let value;
        if (message.type === 'share' && panel) {
          const frames = await checkFrames(claim.tabId, claim.origin);
          value = await screenshot(cdp, undefined);
          if (frames !== await checkFrames(claim.tabId, claim.origin)) throw new Error('Frames changed during capture.');
        } else if (collector && ['page','selection'].includes(message.scope)) {
          value = await evaluateDocument(cdp, claim.world, claim.origin,
            `(${readVisiblePage.toString()})(${JSON.stringify(message.scope)}, 200000)`);
          if (value.error) throw new Error(value.error);
        } else throw new Error('Unsupported capture.');
        const after = await snapshot(connection, claim);
        if (!after.active || !after.ready || before.url !== after.url || before.revision !== after.revision)
          throw new Error('The reviewed document changed.');
        if (collector) {
          const key = crypto.randomUUID();
          connection.capture = { key, grant: claim.id, url: before.url, revision: before.revision };
          return { ...value, key };
        }
        return value;
      }
      if (message.type !== 'sidebar') throw new Error('Unsupported sidebar request.');
      if (collector && request?.kind === 'collect') {
        const captured = connection.capture;
        const claim = [...connection.claims.values()].find(item => item.id === captured?.grant);
        if (!captured || !claim || message.key !== captured.key) throw new Error('Read this approved page again.');
        const current = await snapshot(connection, claim);
        if (current.url !== captured.url || current.revision !== captured.revision) throw new Error('The source page changed.');
        request = { ...request, grant: captured.grant, url: captured.url };
      } else if (collector ? request?.kind !== 'snapshot' : request?.kind === 'collect') throw new Error('Unsupported sidebar operation.');
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const finish = (response: {value?: unknown; error?: string}) => {
          clearTimeout(timer); connection.sidebar.delete(id);
          if (response.error) reject(new Error(response.error)); else resolve(response.value);
        };
        const timer = setTimeout(() => finish({error:'Pero did not confirm the request. Check the conversation before retrying.'}), 35000);
        connection.sidebar.set(id, finish);
        try { send(connection, { type: 'sidebar', id, sessionId: message.sessionId, request }); }
        catch (error) { finish({error: String(error)}); }
      });
    }
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
    if (!connection || !['paired', 'approved'].includes(connection.state))
      throw new Error('Pair with Pero before allowing a Chrome tab.');
    if (message.type === 'preview') {
      if (!Number.isInteger(message.tabId) || connection.claims.has(message.tabId)) throw new Error('Choose a Chrome tab to review.');
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
          peer !== connection || connection.claims.has(review.tabId)) throw new Error('The reviewed tab changed.');
      const target = { tabId: review.tabId };
      connection.state = 'authorizing';
      let attached = false;
      try {
        await chrome.debugger.attach(target, '1.3');
        attached = true;
        if (peer !== connection) throw new Error('The Pero Relay disconnected.');
        const id = connection.opened.get(review.tabId) ?? crypto.randomUUID();
        const claim = { id, tabId: review.tabId, origin: webOrigin(review.url)!, revision: 0, world: 'PeroBrowserUse-' + id };
        connection.claims.set(review.tabId, claim);
        connection.authorizing = id;
        const current = await snapshot(connection, claim);
        if (current.url !== review.url || !current.ready || !current.active) throw new Error('The reviewed tab changed.');
        send(connection, { type: 'approve', tab: current });
        connection.opened.delete(review.tabId);
      } catch (error) {
        connection.claims.delete(review.tabId);
        connection.authorizing = undefined;
        if (attached) await chrome.debugger.detach(target).catch(() => {});
        if (peer === connection) connection.state = connection.claims.size ? 'approved' : 'paired';
        throw error;
      }
      return status();
    }
    throw new Error('Unknown Pero Relay action.');
  };
  void handle().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
