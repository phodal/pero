import { app, BrowserWindow, ipcMain, Menu, protocol, net, dialog, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, sep, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeLocale, translate, type Locale, type MessageKey } from '../../../locales';
import { RemoteAdapter, type StoredRemoteConnection } from './remote';
import { DesktopApps } from './apps';
import { DesktopContributions } from './contributions';

// GPUI uses WebGPU; Chromium still gates this backend on Linux.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-unsafe-webgpu');

// Register before ready so macOS cannot deliver the callback before the listener.
// pero://connect/ completes sign-in; pero://tasks/<id> opens a Cloud task from the task square.
const deepLink = (value: string) => value.startsWith('pero://connect/') || value.startsWith('pero://tasks/');
let pendingDeepLink: string | undefined;
let acceptDeepLink: ((url: string) => void) | undefined;
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (!deepLink(url)) return;
  if (acceptDeepLink) acceptDeepLink(url); else pendingDeepLink = url;
});
// Development profiles are independent; packaged launches share one app instance.
app.on('second-instance', (_event, argv) => {
  const url = argv.find(deepLink);
  if (url && acceptDeepLink) acceptDeepLink(url);
});
protocol.registerSchemesAsPrivileged(['pero', 'pero-app'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
if (process.env.PERO_DESKTOP_DATA_DIR) {
  mkdirSync(process.env.PERO_DESKTOP_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.PERO_DESKTOP_DATA_DIR);
}
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit();
const root = resolve(__dirname, '../..');
let window: BrowserWindow;
let host: ChildProcessWithoutNullStreams;
let ready = false;
let locale: Locale = 'en';
const t = (key: MessageKey) => translate(locale, key);
const send = (event: object) => { if (window && !window.isDestroyed()) window.webContents.send('pero:event', event); };
const apps = new DesktopApps(request => {
  if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable');
  host.stdin.write(JSON.stringify(request) + '\n');
}, send, async () => {
  const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  return selected.canceled ? undefined : selected.filePaths[0];
});
let runtimeSettingsPath = '';
const preferenceWrites = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
async function saveRemotePreference(connection: StoredRemoteConnection | null): Promise<void> {
  for (let i = 0; i < 100 && !ready; i++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable. Reopen Desktop and reconnect.');
  const id = `remote-settings-${randomUUID()}`;
  return new Promise((resolveWrite, rejectWrite) => {
    const timer = setTimeout(() => { preferenceWrites.delete(id); rejectWrite(new Error('Saving the connection timed out. Retry after checking the local runtime.')); }, 5000);
    preferenceWrites.set(id, { resolve: resolveWrite, reject: rejectWrite, timer });
    host.stdin.write(JSON.stringify({ method: 'settings.remote', id, connection }) + '\n', error => {
      if (!error) return;
      clearTimeout(timer); preferenceWrites.delete(id);
      rejectWrite(new Error('The local runtime could not save the connection. Retry connecting.'));
    });
  });
}
function rejectPreferenceWrites() {
  for (const pending of preferenceWrites.values()) {
    clearTimeout(pending.timer); pending.reject(new Error('The local runtime stopped before saving the connection. Reopen Desktop and retry.'));
  }
  preferenceWrites.clear();
}
const remote = new RemoteAdapter(send, {
  load: () => {
    if (!runtimeSettingsPath) return undefined;
    try {
      if (statSync(runtimeSettingsPath).size > 64 * 1024) throw new Error('Runtime settings exceed limit');
      const value = JSON.parse(readFileSync(runtimeSettingsPath, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime settings');
      return Object.hasOwn(value, 'remote_connection') ? value.remote_connection : undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  },
  save: saveRemotePreference,
});
const contributions = new DesktopContributions(send, {
  request: (path, method, body) => remote.contributionRequest(path, method, body),
  identity: () => remote.contributionIdentity,
  host: request => {
    if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable. Reopen Desktop.');
    host.stdin.write(JSON.stringify(request) + '\n');
  },
  chooseParent: async () => {
    const selected = await dialog.showOpenDialog(window, { title: t('contribution.choose_parent'), properties: ['openDirectory', 'createDirectory'] });
    return selected.canceled ? undefined : selected.filePaths[0];
  },
});
const event = (kind: string, message_key: MessageKey) => ({ version: 1, kind, request_id: null, text: '', message_key });
const changeLocale = (value: string) => {
  if (!ready || !['en', 'zh-CN'].includes(value)) throw new Error('Invalid locale');
  host.stdin.write(JSON.stringify({ method: 'settings.locale', locale: value }) + '\n');
};
function updateMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Pero', submenu: [{ role: 'about', label: t('menu.about') }, { type: 'separator' }, { role: 'quit', label: t('menu.quit') }] },
    { label: t('menu.edit'), submenu: [
      { role: 'undo', label: t('menu.undo') }, { role: 'redo', label: t('menu.redo') }, { type: 'separator' },
      { role: 'cut', label: t('menu.cut') }, { role: 'copy', label: t('menu.copy') },
      { role: 'paste', label: t('menu.paste') }, { role: 'selectAll', label: t('menu.select_all') },
    ] },
    { label: t('menu.workbench'), submenu: [{ id: 'remote-tasks', label: t('nav.remote'), accelerator: 'CmdOrCtrl+Shift+R', click: () => send({version:1,kind:'remote_open',request_id:null,text:''}) }, { id: 'connection-message', label: t('menu.connection'), accelerator: 'CmdOrCtrl+Shift+E', click: () => send(event('notice', 'notice.desktop')) }, { role: 'reload', label: t('menu.reload') }, { role: 'toggleDevTools', label: t('menu.developer_tools') }] },
    { label: t('menu.language'), submenu: [
      { id: 'locale-zh-CN', label: '简体中文', type: 'radio', checked: locale === 'zh-CN', click: () => changeLocale('zh-CN') },
      { id: 'locale-en', label: 'English', type: 'radio', checked: locale === 'en', click: () => changeLocale('en') },
    ] },
  ]));
  if (window && !window.isDestroyed()) window.setTitle(t('window.title'));
}

app.whenReady().then(async () => {
  locale = normalizeLocale(process.env.PERO_LOCALE || app.getLocale());
  if (app.isPackaged) app.setAsDefaultProtocolClient('pero');
  else if (process.platform === 'win32' && process.argv[1]) app.setAsDefaultProtocolClient('pero', process.execPath, [resolve(process.argv[1])]);
  protocol.handle('pero', (request) => {
    const url = new URL(request.url);
    const directory = resolve(root, 'web/dist');
    const file = resolve(directory, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.host !== 'workbench' || !file.startsWith(directory + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src pero-app:; object-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
  });
  protocol.handle('pero-app', request => apps.serve(request));
  runtimeSettingsPath = process.env.PERO_SETTINGS_PATH || resolve(app.getPath('userData'), 'runtime-settings.json');
  // Local Agents must not inherit the Desktop's cloud operator/database credentials.
  const hostEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_')));
  host = spawn(resolve(root, `${app.isPackaged ? 'bin' : 'target/debug'}/pero-host${process.platform === 'win32' ? '.exe' : ''}`), ['--stdio'], { cwd: app.isPackaged ? app.getPath('home') : root, stdio: 'pipe', env: {
    ...hostEnvironment, PATH: [resolve(root,'bin'),resolve(root,'node_modules/.bin'),process.env.PATH,resolve(app.getPath('home'),'.opencode/bin'),'/opt/homebrew/bin',resolve(app.getPath('home'),'.local/bin')].filter(Boolean).join(delimiter), PERO_LOCALE: locale,
    PERO_AGENT_ROOT: root,
    ...(app.isPackaged ? { PERO_ADAPTER_NODE: process.execPath } : {}),
    ...(process.env.PERO_AGENTS_FILE ? { PERO_AGENTS_FILE: process.env.PERO_AGENTS_FILE } : {}),
    PERO_SETTINGS_PATH: runtimeSettingsPath,
    PERO_APPS_ROOT: process.env.PERO_APPS_ROOT || resolve(app.getPath('userData'), 'apps'),
    PERO_BUILTIN_APPS_ROOT: resolve(root, 'apps'),
    ...(process.env.PERO_APP_NODE ? { PERO_APP_NODE: process.env.PERO_APP_NODE } : {}),
    ...(process.env.PERO_APP_PYTHON ? { PERO_APP_PYTHON: process.env.PERO_APP_PYTHON } : {}),
    PERO_HISTORY_PATH: process.env.PERO_HISTORY_PATH || resolve(app.getPath('userData'), 'sessions.jsonl'),
  } });
  createInterface({ input: host.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (apps.accept(message)) return;
      if (contributions.accept(message)) return;
      if (message.kind === 'remote_settings_saved' || message.kind === 'remote_settings_error') {
        const pending = preferenceWrites.get(message.request_id);
        if (pending) {
          clearTimeout(pending.timer); preferenceWrites.delete(message.request_id);
          if (message.kind === 'remote_settings_saved') pending.resolve();
          else pending.reject(new Error('The runtime could not save the connection. Check the settings location and retry.'));
        }
        return; // Internal acknowledgement; never publish stored credential envelopes.
      }
      if (message.kind === 'settings') { locale = normalizeLocale(message.text); updateMenus(); }
      if (message.kind === 'ready') ready = true;
      send(message);
    }
    catch { console.error('Invalid Host event'); }
  });
  host.stderr.on('data', (data) => console.error(String(data)));
  host.on('error', () => { ready = false; apps.close(); contributions.close(); rejectPreferenceWrites(); send(event('disconnected', 'error.host_start')); });
  host.on('exit', () => { ready = false; apps.close(); contributions.close(); rejectPreferenceWrites(); send(event('disconnected', 'error.host_stopped')); });
  void remote.initialize();
  const trusted = (sender: Electron.IpcMainInvokeEvent) => {
    if (sender.sender !== window.webContents || sender.senderFrame?.url !== 'pero://workbench/') throw new Error('Untrusted sender');
  };
  ipcMain.handle('pero:connect', async (sender) => {
    trusted(sender);
    // The child normally starts before the renderer; wait for its actual ready event.
    for (let i = 0; i < 100 && !ready; i++) await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    return event(ready ? 'ready' : 'disconnected', ready ? 'status.host_ready' : 'error.host_wait');
  });
  ipcMain.handle('pero:locale:get', (sender) => { trusted(sender); return locale; });
  ipcMain.handle('pero:remote', async (sender, command: unknown) => {
    trusted(sender);
    if ((command as { action?: string })?.action?.startsWith('remote_contribution_')) return contributions.command(command);
    if (['remote_disconnect', 'remote_configure'].includes((command as { action?: string })?.action || '')) contributions.reset();
    await remote.command(command);
  });
  ipcMain.handle('pero:apps', (sender, command: unknown) => { trusted(sender); return apps.command(command); });
  ipcMain.handle('pero:locale:set', (sender, value: string) => { trusted(sender); changeLocale(value); });
  ipcMain.handle('pero:probe', (sender, request: unknown) => {
    trusted(sender);
    const r = request as { id?: unknown; text?: unknown };
    if (!r || typeof r.id !== 'string' || r.id.length > 128 || typeof r.text !== 'string' || Array.from(r.text).length > 4096 || !ready) throw new Error('Invalid probe');
    host.stdin.write(JSON.stringify({ id: r.id, text: r.text }) + '\n');
  });
  ipcMain.handle('pero:session', (sender, command: unknown) => {
    trusted(sender);
    if (!ready || !command || typeof command !== 'object') throw new Error('Invalid session command');
    const action = (command as { action?: string }).action;
    if (!['list_agents','new_session','prompt','cancel','permission','model','configure','authenticate','close'].includes(action || '') || JSON.stringify(command).length > 260000) throw new Error('Invalid session command');
    host.stdin.write(JSON.stringify(command) + '\n');
  });
  ipcMain.handle('pero:workspace', async (sender) => {
    trusted(sender);
    const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) host.stdin.write(JSON.stringify({action:'workspace',path:selected.filePaths[0]})+'\n');
  });
  ipcMain.handle('pero:context', async (sender) => {
    trusted(sender);
    const selected=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections']});
    if(!selected.canceled && selected.filePaths.length)host.stdin.write(JSON.stringify({action:'attach_files',paths:selected.filePaths})+'\n');
  });
  window = new BrowserWindow({ width: 1488, height: 1086, minWidth: 1000, minHeight: 680,
    title: t('window.title'), backgroundColor: '#F7F9FC',
    webPreferences: { preload: resolve(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  updateMenus();
  await window.loadURL('pero://workbench/');
  acceptDeepLink = url => {
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    send({ version: 1, kind: 'remote_open', request_id: null, text: 'desktop_login' });
    // The adapter validates the identifier; without a connection the Cloud page shows its setup instead.
    if (url.startsWith('pero://tasks/')) void remote.command({ action: 'remote_select', task_id: new URL(url).pathname.slice(1) });
    else void remote.acceptDeepLink(url);
  };
  const initialLink = pendingDeepLink || process.argv.find(deepLink);
  if (initialLink) acceptDeepLink(initialLink);
  pendingDeepLink = undefined;
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { remote.close(); apps.close(); contributions.close(); rejectPreferenceWrites(); host?.stdin.end(); });
