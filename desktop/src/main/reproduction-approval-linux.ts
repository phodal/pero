import { BrowserWindow, ipcMain, nativeTheme, session, type IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import themes from '../../../web/src/theme.generated.json' with { type: 'json' };

// Trusted document only: no App URL, interpolated summary, page script or remote asset.
const documentURLs = Object.fromEntries((['light', 'dark'] as const).map(mode => [mode,
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"
content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>Paper reproduction</title><style>
:root{color-scheme:${mode};${Object.entries(themes[mode]).map(([key, value]) => `--pero-${key}:${value}`).join(';')}}
body{margin:0;padding:24px;background:var(--pero-surface);color:var(--pero-text);font:14px system-ui,sans-serif}
h1{font-size:18px;margin:0 0 16px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}
footer{display:flex;justify-content:flex-end;gap:12px;margin-top:24px}button{font:inherit;padding:9px 20px;border:1px solid var(--pero-input-border);border-radius:4px;background:var(--pero-surface);color:var(--pero-text)}
button:focus-visible{outline:2px solid var(--pero-focus);outline-offset:3px}button:hover:not(:disabled){background:var(--pero-surface-muted)}
button:disabled{background:var(--pero-disabled);color:var(--pero-disabled-text)}
</style></head><body><main role="dialog" aria-label="Paper reproduction" aria-modal="true">
<h1>Run this frozen local computation once?</h1><pre id="summary"></pre>
<footer><button id="cancel" disabled>Cancel</button><button id="allow" disabled>Run once</button></footer>
</main></body></html>`)]));
const channel = 'pero:reproduction-approval';
// Reserve synchronously: modal disablement starts only after asynchronous loading.
const pendingOwners = new WeakSet<BrowserWindow>();

/** A one-request trusted Host surface. This does not carry or create compute authority. */
export function confirmLinuxReproduction(owner: BrowserWindow, summary: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || owner.isDestroyed() || !owner.isEnabled() || pendingOwners.has(owner)) return Promise.resolve(false);
  // Electron resolves system preference and the Desktop/Product explicit override.
  // Select one bundled document; no renderer or App supplies CSS or markup.
  const dark = nativeTheme.shouldUseDarkColors;
  const documentURL = documentURLs[dark ? 'dark' : 'light'];
  const ownerContents = owner.webContents;
  const nonce = randomUUID();
  const isolated = session.fromPartition(`reproduction-approval-${nonce}`);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const denyDownload = (event: Electron.Event) => event.preventDefault();
  isolated.on('will-download', denyDownload);
  const popup = new BrowserWindow({ parent: owner, modal: true, show: false, width: 640, height: 430,
    title: 'Paper reproduction', backgroundColor: (dark ? themes.dark : themes.light).surface, autoHideMenuBar: true, minimizable: false, maximizable: false,
    webPreferences: { session: isolated, preload: resolve(typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url)), 'reproduction-approval-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, devTools: false,
      navigateOnDragDrop: false, safeDialogs: true } });
  const contents = popup.webContents;
  // Bootstrap only this exact trusted top-level document; even another data URL
  // or the same bytes requested by another window/subframe remain denied.
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel:
    details.webContentsId !== contents.id || details.resourceType !== 'mainFrame' || details.url !== documentURL }));
  popup.setMenu(null);
  pendingOwners.add(owner);
  return new Promise(resolveDecision => {
    let settled = false, configured = false;
    const finish = (allow = false) => {
      if (settled) return;
      settled = true;
      pendingOwners.delete(owner);
      const accepted = allow && configured && !signal.aborted && !owner.isDestroyed() && !popup.isDestroyed();
      clearTimeout(timer);
      signal.removeEventListener('abort', deny);
      owner.removeListener('close', deny); owner.removeListener('closed', deny);
      ownerContents.removeListener('render-process-gone', deny);
      ipcMain.removeListener(channel, message);
      popup.removeListener('close', deny); popup.removeListener('closed', deny);
      popup.removeListener('unresponsive', deny);
      contents.removeListener('render-process-gone', deny);
      contents.removeListener('did-fail-load', deny);
      isolated.removeListener('will-download', denyDownload);
      if (!popup.isDestroyed()) popup.destroy();
      resolveDecision(accepted);
    };
    const deny = () => finish(false);
    const trusted = (event: IpcMainEvent) => !popup.isDestroyed() &&
      event.sender === contents && event.senderFrame === contents.mainFrame &&
      event.senderFrame?.url === documentURL;
    const message = (event: IpcMainEvent, value: unknown) => {
      if (!trusted(event) || settled || !value || typeof value !== 'object') return;
      const payload = value as { kind?: unknown; nonce?: unknown; allow?: unknown };
      const keys = Object.keys(payload).sort().join(',');
      if (payload.kind === 'ready' && keys === 'kind' && !configured) {
        configured = true;
        contents.send('pero:reproduction-approval-config', { nonce, summary });
      } else if (configured && payload.kind === 'decision' && keys === 'allow,kind,nonce' &&
                 payload.nonce === nonce && typeof payload.allow === 'boolean') {
        finish(payload.allow);
      }
    };
    const preventNavigation = (event: Electron.Event) => { event.preventDefault(); deny(); };
    contents.on('will-navigate', preventNavigation);
    contents.on('will-frame-navigate', preventNavigation);
    contents.on('will-redirect', preventNavigation);
    contents.on('will-attach-webview', preventNavigation);
    contents.setWindowOpenHandler(() => { deny(); return { action: 'deny' }; });
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); deny(); }
    });
    contents.once('render-process-gone', deny);
    contents.once('did-fail-load', deny);
    popup.once('close', deny); popup.once('closed', deny); popup.once('unresponsive', deny);
    owner.once('close', deny); owner.once('closed', deny);
    ownerContents.once('render-process-gone', deny);
    signal.addEventListener('abort', deny, { once: true });
    ipcMain.on(channel, message);
    const timer = setTimeout(deny, 120_000);
    // Recheck after installing revocation handlers, before showing any UI.
    if (signal.aborted || owner.isDestroyed()) { deny(); return; }
    void popup.loadURL(documentURL).then(() => { if (!settled) popup.show(); }, deny);
  });
}
