// Point Relay's socket lifecycle, adapted for Pero's local
// conversation endpoint. Point source: browser/chrome-extension/relay.mjs (2449d4b98).
import { parseRelayPairing, webOrigin, MAX_FRAME, MAX_PARALLEL_REQUESTS, MAX_TRANSFER_BYTES, RELAY_PATH, RELAY_PROTOCOL } from './protocol.ts';
import { sendBrowserInput, type BrowserInput, type BrowserModifier } from '../../../desktop/src/main/browser-use/input.ts';
import { checkFrames, downloadLink, evaluateDocument, navigate, screenshot } from './tab-operations.ts';
import type { BrowserPopupResult } from '../../../desktop/src/main/browser-use/browser-use.ts';
import { dialogRefusal, type BrowserDialog } from '../../../desktop/src/main/browser-use/dialog.ts';
import { captureBrowserDiagnostics } from '../../../desktop/src/main/browser-use/diagnostics.ts';
import { ChromiumAccessibility } from '../../../desktop/src/main/browser-use/accessibility.ts';
import { ChromiumCdp } from '../../../desktop/src/main/browser-use/cdp.ts';
import { siteToolsScript } from '../../../desktop/src/main/browser-use/site-tools.ts';
import type { DriverOperation, TabAction } from '../../../desktop/src/main/browser-use/native-use.ts';
import type { SidebarRequest } from '../../../desktop/src/main/browser-use/chrome-sidebar.ts';

import { readVisiblePage } from './collector-capture.js';

type ChromeTab = { id?: number; windowId?: number; active?: boolean; incognito?: boolean; status?: string; url?: string; pendingUrl?: string; title?: string };
type TabHandle = { id: string; tabId: number; revision: number; attachment?: Promise<void>; accessibility?: ChromiumAccessibility;
  cdp?: ChromiumCdp; cdpStart?: { id: string; controller: AbortController };
  dialog?: { origin?: string; value: BrowserDialog }; dialogOpened?: () => void; pendingInput?: Promise<void> };
type Command = { kind: 'inspect' | 'inspectCloud' } | { kind: 'run'; tab: string; stamp: string; background?: true; operation: DriverOperation } |
  { kind: 'manage'; tab: string; action: TabAction };
type Peer = { socket: WebSocket; state: 'connecting' | 'paired'; label: string; timer?: number;
  lastPong: number; lastId: number; running: Set<string | number>; tabs: Map<number, TabHandle>;
  handedOff: Set<number>;
  sidebar: Map<string, (reply: {value?: unknown; error?: string}) => void>;
  capture?: { key: string; tabId: number; url: string; revision: number;
    scope: 'page' | 'selection'; truncated: boolean; capturedAt: number } };

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let peer: Peer | undefined;
let failure: string | undefined;
let collectorBusy = false;
const pendingKey = 'pendingProjectSourceSave';
type CollectRequest = Extract<SidebarRequest, { kind: 'collect' }>;
type PendingProjectSourceSave = {
  sessionId: string;
  request: CollectRequest & { project: NonNullable<CollectRequest['project']> };
};

async function pendingSourceSave(): Promise<PendingProjectSourceSave | undefined> {
  return (await chrome.storage.session.get(pendingKey))[pendingKey];
}

function status() {
  return { state: peer?.state ?? 'disconnected', label: peer?.label, error: failure };
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

function sidebarReply(connection: Peer, sessionId: string | undefined, request: unknown) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (response: { value?: unknown; error?: string }) => {
      clearTimeout(timer);
      connection.sidebar.delete(id);
      if (response.error) reject(new Error(response.error));
      else resolve(response.value);
    };
    const timer = setTimeout(() => finish({ error: 'Pero did not confirm the request.' }), 35000);
    connection.sidebar.set(id, finish);
    try { send(connection, { type: 'sidebar', id, sessionId, request }); }
    catch (error) { finish({ error: String(error) }); }
  });
}

async function release(connection: Peer, reason?: string) {
  if (peer !== connection) return;
  peer = undefined;
  for (const finish of connection.sidebar.values()) finish({ error: 'The paired conversation disconnected.' });
  connection.sidebar.clear();
  failure = reason;
  clearInterval(connection.timer);
  connection.socket.close();
  publish();
  for (const handle of connection.tabs.values()) {
    handle.cdpStart?.controller.abort();
    handle.cdp?.invalidate();
  }
  await Promise.allSettled([...connection.tabs.values()].flatMap(({ tabId, attachment }) =>
    attachment ? [attachment.then(() => chrome.debugger.detach({ tabId }))] : []));
}

function webTab(tab: ChromeTab): tab is ChromeTab & { id: number; url: string } {
  return !tab.incognito && tab.id !== undefined && !!tab.url && tab.url.length <= 4096 && !!webOrigin(tab.url);
}

function tabHandle(connection: Peer, tabId: number) {
  const current = connection.tabs.get(tabId);
  if (current) return current;
  const handle = { id: crypto.randomUUID(), tabId, revision: 0 };
  connection.tabs.set(tabId, handle);
  return handle;
}

function describeTab(tab: ChromeTab & { url: string }, handle: TabHandle, minimized: boolean) {
  return { id: handle.id, url: tab.url, title: (tab.title ?? '').slice(0, 160),
    active: !!tab.active && !minimized, ready: tab.status === 'complete' && (!tab.pendingUrl || tab.pendingUrl === tab.url),
    revision: handle.revision };
}

async function snapshot(connection: Peer, handle: TabHandle) {
  const tab: ChromeTab = await chrome.tabs.get(handle.tabId);
  const window = tab.windowId === undefined ? undefined : await chrome.windows.get(tab.windowId);
  if (!webTab(tab) || peer !== connection || connection.tabs.get(handle.tabId) !== handle)
    throw new Error('The selected Chrome tab is unavailable.');
  return describeTab(tab, handle, window?.state === 'minimized');
}

async function debuggerFor(connection: Peer, handle: TabHandle) {
  const target = { tabId: handle.tabId };
  const attachment = handle.attachment ??= (async () => {
    await chrome.debugger.attach(target, '1.3');
    try { await chrome.debugger.sendCommand(target, 'Page.enable'); }
    catch (error) {
      await chrome.debugger.detach(target).catch(() => {});
      throw error;
    }
  })();
  try { await attachment; } catch (error) {
    if (handle.attachment === attachment) handle.attachment = undefined;
    throw error;
  }
  return async (method: string, params?: Record<string, unknown>) => {
    if (peer !== connection || handle.attachment !== attachment || connection.tabs.get(handle.tabId) !== handle)
      throw new Error('The Chrome debugging session ended.');
    return chrome.debugger.sendCommand(target, method, params);
  };
}

async function untilDialog<T>(handle: TabHandle, operation: () => Promise<T>) {
  const opened = Promise.withResolvers<{ dialogOpened: true }>();
  handle.dialogOpened = () => opened.resolve({ dialogOpened: true });
  try {
    return await Promise.race([operation().then(value => ({ value })), opened.promise]);
  } finally {
    handle.dialogOpened = undefined;
  }
}

async function run(connection: Peer, command: Command) {
  if (command.kind === 'inspect' || command.kind === 'inspectCloud') {
    const [windows, tabs, focused]: [{ id?: number; state?: string }[], ChromeTab[], { id?: number }?] = await Promise.all([
      chrome.windows.getAll({ windowTypes: ['normal', 'popup'] }), chrome.tabs.query({}),
      command.kind === 'inspectCloud' ? chrome.windows.getLastFocused({ windowTypes: ['normal'] }) : undefined,
    ]);
    const minimized = new Set(windows.filter(window => window.state === 'minimized').map(window => window.id));
    return tabs.filter(webTab).filter(tab => !connection.handedOff.has(tab.id))
      .map(tab => describeTab(tab, tabHandle(connection, tab.id),
        minimized.has(tab.windowId) || command.kind === 'inspectCloud' && tab.windowId !== focused?.id));
  }
  const handle = [...connection.tabs.values()].find(handle => handle.id === command.tab);
  if (!handle) throw new Error('The selected Chrome tab is unavailable. List tabs again.');
  const captureId = command.kind === 'run' && command.operation.kind === 'cdp' ? command.operation.captureId : undefined;
  const starting = captureId && { id: captureId, controller: new AbortController() };
  if (starting) handle.cdpStart = starting;
  if (command.kind === 'run' && handle.pendingInput && !handle.dialog)
    await untilDialog(handle, () => handle.pendingInput!);
  const tab = await snapshot(connection, handle);
  const origin = webOrigin(tab.url)!;
  if (command.kind === 'manage') {
    if (command.action.kind === 'activate') {
      await chrome.tabs.update(handle.tabId, { active: true });
      return { kind: 'tabActivated', tabId: 'chrome:' + handle.id };
    }
    if (command.action.kind === 'close') {
      await chrome.tabs.remove(handle.tabId);
      return { kind: 'tabClosed', tabId: 'chrome:' + handle.id };
    }
    if (command.action.kind === 'handoff') {
      handle.cdpStart?.controller.abort();
      handle.cdp?.invalidate();
      connection.handedOff.add(handle.tabId);
      connection.tabs.delete(handle.tabId);
      if (handle.attachment) {
        await handle.attachment;
        await chrome.debugger.detach({ tabId: handle.tabId });
      }
      return { kind: 'tabHandedOff', tabId: 'chrome:' + handle.id };
    }
    if (command.action.kind === 'getJsDialog' || command.action.kind === 'handleJsDialog') {
      if (!tab.active) throw new Error('Activate the Chrome tab before handling its JavaScript dialog.');
      const cdp = await debuggerFor(connection, handle);
      const current = await snapshot(connection, handle);
      if (!current.active || current.url !== tab.url) throw new Error('The selected Chrome tab or document changed.');
      const dialog = handle.dialog?.origin === origin ? handle.dialog.value : undefined;
      if (command.action.kind === 'getJsDialog') return dialog ?? null;
      const rejected = dialogRefusal(dialog, command.action);
      if (rejected) return { rejected };
      const { decision, promptText } = command.action;
      await cdp('Page.handleJavaScriptDialog', { accept: decision === 'accept', ...(promptText !== undefined && { promptText }) });
      if (handle.dialog?.value === dialog) handle.dialog = undefined;
      return null;
    }
    if (!tab.active || !tab.ready || webOrigin(command.action.url) !== origin)
      throw new Error('Open a same-origin page from the active Chrome tab.');
    const source: ChromeTab = await chrome.tabs.get(handle.tabId);
    const opened = await chrome.tabs.create({ windowId: source.windowId, url: 'about:blank', active: true });
    if (opened.id === undefined) throw new Error('Chrome did not open the requested tab.');
    const target = { tabId: opened.id };
    const openedTab = tabHandle(connection, opened.id);
    try {
      if (peer !== connection) throw new Error('The Pero Relay disconnected.');
      const cdp = await debuggerFor(connection, openedTab);
      try {
        const result = await navigate(cdp, opened.id, origin, { kind: 'navigate', url: command.action.url }, true);
        if (result) throw new Error(result.rejected);
      } finally {
        if (peer === connection) {
          openedTab.attachment = undefined;
          await chrome.debugger.detach(target).catch(() => {});
        }
      }
    } catch (error) {
      await chrome.tabs.remove(opened.id).catch(() => {});
      throw error;
    }
    return { kind: 'tabOpened', tabId: 'chrome:' + openedTab.id, url: command.action.url, authorized: true };
  }
  if (command.kind !== 'run') throw new Error('Unknown Chrome Relay command.');
  const checkDocument = (tab: ReturnType<typeof describeTab>) => {
    if ((!tab.active && command.background !== true) || !tab.ready || command.stamp !== `${tab.revision}:${tab.url}`)
      throw new Error('The selected Chrome tab or document changed.');
  };
  checkDocument(tab);
  const operation = command.operation;
  if (handle.dialog) throw new Error('A JavaScript dialog is open. Use getJsDialog or close it in Chrome.');
  if (operation.kind === 'check') return null;
  if (operation.kind === 'checkFrames') return checkFrames(handle.tabId, origin);
  const cdp = await debuggerFor(connection, handle);
  const current = await snapshot(connection, handle);
  checkDocument(current);
  if (handle.dialog) throw new Error('A JavaScript dialog is open. Use getJsDialog or close it in Chrome.');
  const world = 'PeroBrowserUse-' + handle.id;
  if (operation.kind === 'evaluate') {
    const limit = operation.files ? Math.ceil(MAX_TRANSFER_BYTES / 3) * 4 + 100_000 : 100_000;
    if (typeof operation.script !== 'string' || operation.script.length > limit)
      throw new Error('Invalid Chrome Browser Use document operation.');
    const result = await untilDialog(handle, () => evaluateDocument(cdp, world, origin, operation.script));
    if ('dialogOpened' in result) throw new Error('Chrome opened a JavaScript dialog. Read it with getJsDialog.');
    return result.value;
  }
  if (operation.kind === 'siteTools') {
    const result = await untilDialog(handle, () =>
      evaluateDocument(cdp, world, origin, siteToolsScript(origin, operation.command), 'siteTools'));
    if ('dialogOpened' in result) throw new Error('The site tool opened a dialog. Inspect the tab before retrying.');
    if (peer !== connection) throw new Error('The Pero Relay disconnected.');
    checkDocument(await snapshot(connection, handle));
    return result.value;
  }
  if (operation.kind === 'screenshot') {
    const frames = await checkFrames(handle.tabId, origin);
    const image = await screenshot(cdp, operation);
    if (frames !== await checkFrames(handle.tabId, origin))
      throw new Error('The Chrome document changed during screenshot capture.');
    return image;
  }
  if (operation.kind === 'getAXState') {
    const accessibility = handle.accessibility ??= new ChromiumAccessibility();
    const check = () => {
      if (peer !== connection || handle.accessibility !== accessibility || handle.revision !== current.revision || handle.dialog)
        throw new Error('The Chrome document changed during the accessibility observation.');
    };
    const result = await accessibility.observe(cdp, origin, command.stamp, operation.since, check);
    const after = await snapshot(connection, handle);
    check();
    checkDocument(after);
    return result;
  }
  if (operation.kind === 'diagnose' || operation.kind === 'cdp') {
    const check = () => {
      if (starting) starting.controller.signal.throwIfAborted();
      if (peer !== connection || handle.revision !== current.revision || handle.dialog)
        throw new Error('The Chrome document changed during browser diagnostics.');
    };
    const subscribe = (listener: (method: string, params: Record<string, unknown>) => void) => {
      const receive = ({ tabId }: { tabId?: number }, method: string, params?: Record<string, unknown>) => {
        if (tabId === handle.tabId && params && handle.revision === current.revision) listener(method, params);
      };
      chrome.debugger.onEvent.addListener(receive);
      return () => chrome.debugger.onEvent.removeListener(receive);
    };
    if (operation.kind === 'diagnose') await handle.cdp?.stopCapture();
    const result = operation.kind === 'diagnose'
      ? await captureBrowserDiagnostics(origin, operation, cdp, subscribe, check)
      : await (handle.cdp ??= new ChromiumCdp()).call(operation.request, command.stamp, origin, cdp, subscribe, check,
        starting ? starting.controller.signal : new AbortController().signal, captureId);
    const after = await snapshot(connection, handle);
    check();
    checkDocument(after);
    return result;
  }
  if (operation.kind === 'download') return downloadLink(cdp, world, origin, operation.url);
  if (operation.kind === 'navigate' || operation.kind === 'history') {
    const result = await navigate(cdp, handle.tabId, origin, operation);
    if (!result) handle.revision++;
    return result;
  }
  if (operation.kind === 'dispatch' || operation.kind === 'clickAndWatchPopup') {
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
    const connected = () => peer === connection && connection.tabs.get(handle.tabId) === handle;
    const dispatch = () => untilDialog(handle, () => {
      const input = sendBrowserInput(cdp, connected, event);
      // A dialog can block the CDP response until it closes. Preserve the
      // original input's release without holding the Relay request open.
      const settled = input.catch(() => {}).finally(() => {
        if (handle.pendingInput === settled) handle.pendingInput = undefined;
      });
      handle.pendingInput = settled;
      return input;
    });
    if (operation.kind === 'dispatch') {
      await dispatch();
      return null;
    }
    if (event.kind !== 'click' || event.count !== 1) throw new Error('Watching for a popup requires a single click.');
    const popup = Promise.withResolvers<BrowserPopupResult>();
    const created = (details: { sourceTabId: number; tabId: number; url: string }) => {
      if (!connected() || handle.revision !== current.revision || details.sourceTabId !== handle.tabId ||
          details.tabId === handle.tabId || details.url.length > 4096 || !webOrigin(details.url)) return;
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(created);
      popup.resolve({ kind: 'tabOpened', tabId: 'chrome:' + tabHandle(connection, details.tabId).id, authorized: true });
    };
    chrome.webNavigation.onCreatedNavigationTarget.addListener(created);
    const timer = setTimeout(() => popup.resolve({ kind: 'notObserved', reason: 'Chrome did not report a new web tab.' }), 5000);
    try {
      const dispatched = await dispatch();
      const result = 'dialogOpened' in dispatched
        ? { kind: 'notObserved', reason: 'Chrome opened a JavaScript dialog.' } : await popup.promise;
      if (!connected()) throw new Error('The Chrome debugging session ended.');
      return result;
    } finally {
      clearTimeout(timer);
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(created);
    }
  }
  throw new Error('This action is unavailable in the Pero Chrome extension.');
}

function connect(code: string) {
  if (peer) throw new Error('Disconnect the current Pero session first.');
  const pairing = parseRelayPairing(code.trim());
  const socket = new WebSocket(pairing.baseUrl.replace('http:', 'ws:') + RELAY_PATH);
  const connection: Peer = { socket, state: 'connecting', label: pairing.label, lastPong: Date.now(), lastId: 0, running: new Set(),
    tabs: new Map(), handedOff: new Set(), sidebar: new Map() };
  peer = connection;
  failure = undefined;
  publish();
  socket.onopen = () => send(connection, { type: 'pair', protocol: RELAY_PROTOCOL, ticket: pairing.ticket,
    ...(pairing.parallel === true && { parallel: true }), ...(pairing.cdpNetwork === true && { cdpNetwork: true }) });
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
      if (message.type === 'stopCdpCapture' && connection.state === 'paired' && pairing.cdpNetwork === true) {
        const captureId = message.captureId;
        if (typeof captureId !== 'string') return;
        const handle = [...connection.tabs.values()].find(tab => tab.id === message.tab);
        if (handle?.cdpStart?.id === captureId) handle.cdpStart.controller.abort();
        void handle?.cdp?.stopCapture(captureId);
        return;
      }
      if (message.type === 'paired' && connection.state === 'connecting') {
        connection.state = 'paired';
        connection.label = message.label;
        connection.lastPong = Date.now();
        publish();
        return;
      }
      if (message.type !== 'request' || connection.state === 'connecting' ||
          !Number.isSafeInteger(message.id) || message.id <= connection.lastId)
        throw new Error('Invalid Pero Relay request.');
      connection.lastId = message.id;
      const command: Command = message.command;
      // Inventory can run beside a page operation. A tab has one debugger operation at a time.
      const lane = 'tab' in command ? command.tab : message.id;
      if (connection.running.has(lane) || connection.running.size >= (pairing.parallel === true ? MAX_PARALLEL_REQUESTS : 1)) {
        send(connection, { type: 'response', id: message.id, error: 'A Chrome Browser Use operation is already in progress for this target.' });
        return;
      }
      connection.running.add(lane);
      try {
        let value;
        try { value = await run(connection, command); }
        catch (error) {
          if (peer === connection) send(connection, { type: 'response', id: message.id,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
          return;
        }
        if (peer === connection) send(connection, { type: 'response', id: message.id, value });
      } finally { connection.running.delete(lane); }
    };
    void receive().catch(error => void release(connection, error.message));
  };
}

chrome.tabs.onUpdated.addListener((tabId: number, change: { status?: string; url?: string }) => {
  const handle = peer?.tabs.get(tabId);
  if (handle && (change.status === 'loading' || change.url)) {
    handle.revision++;
    handle.cdpStart?.controller.abort();
    handle.cdp?.invalidate();
  }
});
chrome.tabs.onRemoved.addListener((tabId: number) => {
  const handle = peer?.tabs.get(tabId);
  handle?.cdpStart?.controller.abort();
  handle?.cdp?.invalidate();
  peer?.tabs.delete(tabId);
  peer?.handedOff.delete(tabId);
});
chrome.debugger.onEvent.addListener(({ tabId }, method, params) => {
  const handle = tabId === undefined ? undefined : peer?.tabs.get(tabId);
  if (!handle?.attachment) return;
  if (method === 'Page.javascriptDialogOpening') {
    const { type, url, message } = params ?? {};
    if (type !== 'alert' && type !== 'confirm' && type !== 'prompt' && type !== 'beforeunload') return;
    handle.dialog = { origin: typeof url === 'string' ? webOrigin(url) : undefined,
      value: { id: crypto.randomUUID(), type, message: typeof message === 'string' ? message.slice(0, 2048) : '' } };
    handle.revision++;
    handle.dialogOpened?.();
  } else if (method === 'Page.javascriptDialogClosed') {
    handle.dialog = undefined;
    handle.revision++;
  }
});
chrome.debugger.onDetach.addListener(({ tabId }: { tabId?: number }, reason: string) => {
  const connection = peer;
  const handle = tabId === undefined ? undefined : connection?.tabs.get(tabId);
  if (!connection || !handle?.attachment) return;
  handle.attachment = undefined;
  handle.accessibility = undefined;
  handle.cdpStart?.controller.abort();
  handle.cdp?.invalidate();
  handle.cdp = undefined;
  handle.dialog = undefined;
  if (reason === 'canceled_by_user') {
    void release(connection, 'Chrome stopped Browser Use.');
  } else {
    handle.revision++;
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const source = sender.url?.split('#', 1)[0];
  if (sender.id !== chrome.runtime.id) return false;
  const panel = source === chrome.runtime.getURL('sidepanel.html'), collector = source === chrome.runtime.getURL('collector.html');
  if (!panel && !collector && source !== chrome.runtime.getURL('relay.html')) return false;
  const handle = async () => {
    if (message.type === 'status') return status();
    if (collector && ['collectorPending', 'collectorForget'].includes(message.type)) {
      const pending = await pendingSourceSave();
      if (!pending) return null;
      const { captureId: id, id: projectId, shared } = pending.request.project;
      if (message.type === 'collectorForget') {
        if (id !== message.key) throw new Error('The pending save changed. Reopen Collector.');
        await chrome.storage.session.remove(pendingKey);
        return null;
      }
      return { id, projectId, shared: !!shared, title: pending.request.title };
    }
    if (panel || collector) {
      const connection = peer;
      if (connection?.state !== 'paired') throw new Error('Write a draft here. To send it, pair from Pero → Settings → Browser Use.');
      let request = message.request;
      if (collector && message.type === 'collectorRecover') {
        const pending = await pendingSourceSave();
        if (!pending || pending.request.project.captureId !== message.key)
          throw new Error('The pending save changed. Reopen Collector.');
        if (pending.sessionId !== message.sessionId)
          throw new Error('Pair the original conversation to recover this save.');
        return sidebarReply(connection, pending.sessionId, pending.request);
      }
      if (message.type === 'capture' || message.type === 'share') {
        if (collector && await pendingSourceSave()) throw new Error('Resolve the pending Project save first.');
        if (!Number.isInteger(message.tabId)) throw new Error('Select a regular Chrome tab.');
        const handle = tabHandle(connection, message.tabId);
        const before = await snapshot(connection, handle);
        if (!before.active || !before.ready) throw new Error('Activate the loaded web tab first.');
        const origin = webOrigin(before.url)!;
        const cdp = await debuggerFor(connection, handle);
        let value;
        if (message.type === 'share' && panel) {
          const frames = await checkFrames(handle.tabId, origin);
          value = await screenshot(cdp);
          if (frames !== await checkFrames(handle.tabId, origin)) throw new Error('Frames changed during capture.');
        } else if (collector && ['page','selection'].includes(message.scope)) {
          value = await evaluateDocument(cdp, 'PeroBrowserUse-' + handle.id, origin,
            `(${readVisiblePage.toString()})(${JSON.stringify(message.scope)}, 200000)`);
          if (value.error) throw new Error(value.error);
        } else throw new Error('Unsupported capture.');
        const after = await snapshot(connection, handle);
        if (!after.active || !after.ready || before.url !== after.url || before.revision !== after.revision)
          throw new Error('The Chrome document changed.');
        if (collector) {
          const key = crypto.randomUUID();
          const capturedAt = Date.now();
          connection.capture = { key, tabId: handle.tabId, url: before.url, revision: before.revision,
            scope: value.captureScope, truncated: value.truncated, capturedAt };
          return { ...value, key, capturedAt };
        }
        return value;
      }
      if (message.type !== 'sidebar') throw new Error('Unsupported sidebar request.');
      if (collector && request?.kind === 'collect') {
        if (await pendingSourceSave()) throw new Error('Resolve the pending Project save first.');
        const captured = connection.capture;
        const handle = captured && connection.tabs.get(captured.tabId);
        if (!captured || !handle || message.key !== captured.key) throw new Error('Read this page again.');
        const current = await snapshot(connection, handle);
        if (current.url !== captured.url || current.revision !== captured.revision) throw new Error('The source page changed.');
        const { projectId, sharedProject, ...draft } = request;
        request = { ...draft, url: captured.url, project: projectId ? {
          id: projectId, captureId: captured.key, scope: captured.scope,
          truncated: captured.truncated, capturedAt: captured.capturedAt, shared: sharedProject,
        } : undefined };
        if (request.project) {
          if (typeof message.sessionId !== 'string' || !message.sessionId)
            throw new Error('Pair the conversation before saving to a Project.');
          const pending: PendingProjectSourceSave = { sessionId: message.sessionId, request };
          await chrome.storage.session.set({ [pendingKey]: pending });
        }
      } else if (collector ? !['snapshot', 'collectorTargets'].includes(request?.kind)
          : ['collect', 'collectorTargets'].includes(request?.kind)) throw new Error('Unsupported sidebar operation.');
      return sidebarReply(connection, message.sessionId, request);
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
    throw new Error('Unknown Pero Relay action.');
  };
  const collect = collector && (['capture', 'collectorRecover', 'collectorForget'].includes(message.type) ||
    message.type === 'sidebar' && message.request?.kind === 'collect');
  const runRequest = async () => {
    if (!collect) return handle();
    if (collectorBusy) throw new Error('Collector is processing another request.');
    collectorBusy = true;
    try { return await handle(); }
    finally { collectorBusy = false; }
  };
  void runRequest().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
