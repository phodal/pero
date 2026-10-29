import {ConversationContentRead} from '../../../packages/content-source/index.ts';
import { app, BrowserWindow, ipcMain, Menu, protocol, nativeTheme, net, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve, sep, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DesktopApps } from './apps';
import { DesktopAppUse } from './app-use-mcp';
import { Product } from '../../../packages/product/product';
import { testWindowOptions } from './test-display';

const root = resolve(__dirname, '../..');
const product = Product.parse(JSON.parse(readFileSync(resolve(root, 'product.json'), 'utf8')));
if (product.shell !== 'app') throw new Error('This entry requires an App Product');
app.setName(product.name);
app.setPath('userData', process.env.PERO_DESKTOP_DATA_DIR || resolve(app.getPath('appData'), product.id));
protocol.registerSchemesAsPrivileged(['pero', 'pero-app'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
let window: BrowserWindow;
let host: ReturnType<typeof spawn>;
let ready = false;
let appUse: DesktopAppUse | undefined;
let resolveReady: () => void;
const hostReady = new Promise<void>(resolve => { resolveReady = resolve; });
const apps = new DesktopApps(request => {
  if (!ready || !host.stdin?.writable) throw new Error('The local runtime is unavailable. Restart the application.');
  host.stdin.write(JSON.stringify(request) + '\n');
}, event => { if (!window.isDestroyed()) window.webContents.send('product:event', event); }, async () => undefined,async(name,token)=>{if(!appUse)throw new Error('App input unavailable');return appUse.input(name,token);});
let locale: 'en' | 'zh-CN' = 'en';
function context() { return { product, locale, dark: nativeTheme.shouldUseDarkColors, connected: ready }; }
function menus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: product.name, submenu: [{ role: 'about' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View / 显示', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' },
      { label: 'Light / 浅色', click: () => { nativeTheme.themeSource = 'light'; } },
      { label: 'Dark / 深色', click: () => { nativeTheme.themeSource = 'dark'; } }] },
    { label: 'Language / 语言', submenu: (['en', 'zh-CN'] as const).map(value => ({ id: `locale-${value}`, label: value === 'en' ? 'English' : '简体中文', type: 'radio' as const, checked: locale === value,
      click: () => { host.stdin?.write(JSON.stringify({ method: 'settings.locale', locale: value }) + '\n'); } })) },
  ]));
}
app.whenReady().then(async () => {
  locale = (process.env.PERO_LOCALE || app.getLocale()).startsWith('zh') ? 'zh-CN' : 'en';
  const profile = app.getPath('userData');
  window = new BrowserWindow({ ...testWindowOptions, title: product.name, width: 1280, height: 900, minWidth: 760, minHeight: 600,
    webPreferences: { ...testWindowOptions.webPreferences, preload: resolve(__dirname, 'product-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  protocol.handle('pero-app', request => apps.serve(request));
  // Only the product shell has a preload; App documents retain their separate origin.
  protocol.handle('pero', async request => {
    const url = new URL(request.url);
    if (product.chat && url.host === 'chat') {
      const directory = resolve(root, 'web/chat');
      const file = resolve(directory, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(directory + sep)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.host !== 'workbench' || url.pathname !== '/') return new Response('Not found', { status: 404 });
    return new Response(readFileSync(resolve(root, 'desktop/dist/product.html')), {
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; frame-src pero-app: pero://chat" },
    });
  });
  appUse = product.chat ? new DesktopAppUse(() => window, event => window.webContents.send('product:event', event), resolve(profile, 'app-use-evidence'),{describe:()=>apps.describeWrites(),apply:(write,signal)=>apps.applyWrite(write,signal)}) : undefined;
  const appUseEnvironment = await appUse?.start();
  host = spawn(resolve(root, 'bin', process.platform === 'win32' ? 'pero-host.exe' : 'pero-host'), ['--stdio'], { cwd: app.getPath('home'), env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_'))),
    ...appUseEnvironment,
    PERO_SETTINGS_PATH: resolve(profile, 'runtime-settings.json'), PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'),
    PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: resolve(root, 'apps'),
    PERO_APP_NODE: product.node === 'bundled' ? resolve(root, 'runtime/node/bin/node') : product.node === 'system' ? 'node' : resolve(root, 'runtime/unavailable-node'),
    PERO_LOCALE: locale, PERO_APP_PYTHON: product.python === 'bundled' ? resolve(root, 'runtime/python/bin/python3') : 'python3',
    ...(product.chat ? {
      PATH: [resolve(root, 'bin'), resolve(root, 'node_modules/.bin'), process.env.PATH, resolve(app.getPath('home'), '.local/bin'), '/opt/homebrew/bin'].filter(Boolean).join(delimiter),
      PERO_AGENT_ROOT: root, PERO_ADAPTER_NODE: process.execPath,
      ...(process.env.PERO_AGENTS_FILE ? { PERO_AGENTS_FILE: process.env.PERO_AGENTS_FILE } : {}),
    } : {}),
  }, stdio: 'pipe' });
  createInterface({ input: host.stdout! }).on('line', line => {
    const message = JSON.parse(line);
    appUse?.accept(message);
    if (apps.accept(message)) return;
    if (message.kind === 'ready') { ready = true; resolveReady(); }
    if (message.kind === 'settings') {
      locale = message.text === 'zh-CN' ? 'zh-CN' : 'en'; menus();
      window.webContents.send('product:context', context());
    }
    if (product.chat && ['ready', 'agents', 'workspace', 'replay', 'workbench_settings', 'context_files', 'context_candidates', 'context_resolved', 'context_error', 'session_created', 'agent_info', 'session_authenticated', 'session_auth_required', 'session_auth_error', 'user_message', 'session_connecting', 'session_ready', 'session_update', 'model_changed', 'configuration_changed', 'turn_started', 'turn_finished', 'session_usage', 'permission', 'session_error', 'session_closed', 'session_deleted', 'command_rejected', 'error'].includes(message.kind)) {
      window.webContents.send('product:event', message);
    }
  });
  host.stderr?.on('data', data => console.error(String(data)));
  const stopped = () => { ready = false; appUse?.reset(); apps.close(); if (!window.isDestroyed()) window.webContents.send('product:event', { version: 1, kind: 'disconnected', request_id: null, text: '' }); };
  host.on('error', stopped); host.on('exit', stopped);
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== 'pero://workbench/') throw new Error('Untrusted sender');
  };
  ipcMain.handle('product:connect', event => { trusted(event); return context(); });
  ipcMain.handle('product:content-read', (sender, value: unknown) => {
    trusted(sender);
    if(!appUse) throw new Error('Result files are unavailable');
    const request=ConversationContentRead.parse(value);
    return appUse.results.read(request.thread,request.request);
  });
  ipcMain.handle('product:app-use', async (event, command: {action?:string;thread_id?:string;scope?:{app:string;panel:string};options?:unknown}) => {
    trusted(event);
    if(command?.action==='context'&&command.scope&&typeof command.thread_id==='string'){if(!appUse)throw new Error('App context is unavailable');return appUse.draftContext.freeze(command.scope,command.thread_id,command.options);}
    if(command?.action==='select'){appUse?.authority.select(command.thread_id||undefined);return;}
    if(command?.action!=='revoke'||typeof command.thread_id!=='string')throw new Error('Invalid App Use command');
    appUse?.authority.revoke(command.thread_id,command.scope);
  });
  ipcMain.handle('product:session', async (event, command: unknown) => {
    trusted(event);
    if (!product.chat || !ready || !command || typeof command !== 'object' || Array.isArray(command)) throw new Error('Chat runtime is unavailable');
    const value = command as { action?: string; method?: string; kind?: unknown; request_id?: unknown };
    if (value.action === 'choose_workspace') {
      const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (!selected.canceled && selected.filePaths[0]) host.stdin!.write(JSON.stringify({ action: 'workspace', path: selected.filePaths[0] }) + '\n');
      return;
    }
    if (value.action === 'choose_context') {
      const kind = value.kind ?? undefined;
      if (kind !== undefined && (!['file', 'image', 'directory'].includes(String(kind)) || typeof value.request_id !== 'string' || !value.request_id || value.request_id.length > 128)) throw new Error('Invalid context picker request');
      const selected = await dialog.showOpenDialog(window, {
        properties: kind === 'directory' ? ['openDirectory'] : kind === undefined ? ['openFile', 'multiSelections'] : ['openFile'],
        ...(kind === 'image' ? { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] } : {}),
      });
      if (!selected.canceled && selected.filePaths.length) host.stdin!.write(JSON.stringify(kind === undefined
        ? { action: 'attach_files', paths: selected.filePaths }
        : { action: 'resolve_context', request_id: value.request_id, kind, source: selected.filePaths[0] }) + '\n');
      return;
    }
    if ((!['list_agents', 'workspace', 'new_session', 'prompt', 'cancel', 'permission', 'model', 'configure', 'authenticate', 'close', 'delete', 'search_context', 'resolve_context', 'attach_files'].includes(value.action || '') && !['settings.workbench', 'settings.workbench.get'].includes(value.method || '')) || JSON.stringify(value).length > 16_000_000) throw new Error('Invalid session command');
    appUse?.authority.command(value as {action?:string;thread_id?:string});
    host.stdin!.write(JSON.stringify(value) + '\n');
  });
  ipcMain.handle('product:open', async (event, name: unknown) => {
    trusted(event);
    const entry = product.selectApp(name);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([hostReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime startup timed out. Restart the application.')), 10000); })]);
      await apps.command({ action: 'apps_list' });
      await apps.command({ action: 'apps_open', name: entry.app, panel: entry.panel });
    } finally { clearTimeout(timer); }
  });
  nativeTheme.on('updated', () => { if (!window.isDestroyed()) window.webContents.send('product:context', context()); });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) appUse?.reset(); });
  window.webContents.on('render-process-gone', () => appUse?.reset());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  menus();
  await window.loadURL('pero://workbench/');
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { appUse?.close(); apps.close(); host?.stdin?.end(); });
