import {ConversationContentRead} from '../../../packages/content-source/index.ts';
import { app, BrowserWindow, ipcMain, Menu, protocol, net, dialog, shell, globalShortcut } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, sep, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeLocale, translate, type Locale, type MessageKey } from '../../../locales';
import { RemoteAdapter, type StoredRemoteConnection } from './remote';
import { DesktopApps } from './apps';
import {WebPages} from './web-pages';
import { DesktopContributions } from './contributions';
import { LocalExecutionController } from './local-execution';
import { DesktopAppUse } from './app-use-mcp';
import { DesktopComputer } from './computer';
import { computerPermissions } from './computer-electron';
import { backgroundTest, testWindowOptions } from './test-display';

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
let appUse: DesktopAppUse | undefined;
let webPages:WebPages|undefined;
let computer: DesktopComputer | undefined;
let locale: Locale = 'en';
const t = (key: MessageKey) => translate(locale, key);
let localExecution: LocalExecutionController | undefined;
const send = (event: object) => {
  if ((event as {kind?: string}).kind === 'remote_state') localExecution?.sync();
  if (window && !window.isDestroyed()) window.webContents.send('pero:event', event);
};
const apps = new DesktopApps(request => {
  if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable');
  host.stdin.write(JSON.stringify(request) + '\n');
}, send, async () => {
  const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
  return selected.canceled ? undefined : selected.filePaths[0];
},async(name,token)=>{if(!appUse)throw new Error('App input unavailable');return appUse.input(name,token);});
let runtimeSettingsPath = '';
const preferenceWrites = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
async function savePreference(method: 'settings.remote' | 'settings.computer', fields: object): Promise<void> {
  for (let i = 0; i < 100 && !ready; i++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable. Reopen Desktop and reconnect.');
  const id = `settings-${randomUUID()}`;
  return new Promise((resolveWrite, rejectWrite) => {
    const timer = setTimeout(() => { preferenceWrites.delete(id); rejectWrite(new Error('Saving the connection timed out. Retry after checking the local runtime.')); }, 5000);
    preferenceWrites.set(id, { resolve: resolveWrite, reject: rejectWrite, timer });
    host.stdin.write(JSON.stringify({ method, id, ...fields }) + '\n', error => {
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
  save: connection => savePreference('settings.remote', {connection}),
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
    { label: t('menu.workbench'), submenu: [{id:'open-url',label:t('web.open_url'),click:()=>send({version:1,kind:'web_choose',request_id:null,text:''})}, { id:'open-file',label:t('content.open_file'),accelerator:'CmdOrCtrl+O',click:()=>send({version:1,kind:'document_choose',request_id:null,text:''}) }, { id: 'remote-tasks', label: t('nav.remote'), accelerator: 'CmdOrCtrl+Shift+R', click: () => send({version:1,kind:'remote_open',request_id:null,text:''}) }, { id: 'connection-message', label: t('menu.connection'), accelerator: 'CmdOrCtrl+Shift+E', click: () => send(event('notice', 'notice.desktop')) }, { role: 'reload', label: t('menu.reload') }, { role: 'toggleDevTools', label: t('menu.developer_tools') }] },
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
    if (!['workbench', 'chat'].includes(url.host) || !file.startsWith(directory + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src pero-app: pero://chat; object-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
  });
  protocol.handle('pero-app', request => apps.serve(request));
  runtimeSettingsPath = process.env.PERO_SETTINGS_PATH || resolve(app.getPath('userData'), 'runtime-settings.json');
  localExecution = new LocalExecutionController(resolve(app.getPath('userData'),'local-execution.json'),remote,request=>{
    if (!ready || !host?.stdin.writable) throw new Error('The local runtime is unavailable.');
    host.stdin.write(JSON.stringify(request)+'\n');
  },send);
  // Local Agents must not inherit the Desktop's cloud operator/database credentials.
  const hostEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_')));
  computer = new DesktopComputer(resolve(root, `${app.isPackaged ? 'bin' : 'target/debug'}/pero-computer${process.platform === 'win32' ? '.exe' : ''}`), resolve(app.getPath('userData'),'computer-use'), send, {
    save: enabled => savePreference('settings.computer',{enabled}),
    permissions: computerPermissions,
  });
  globalShortcut.register('CommandOrControl+Shift+Escape',()=>{void computer?.command({action:'computer_stop'}).catch(error=>console.error(error));});
  appUse = new DesktopAppUse(() => window, send, resolve(app.getPath('userData'), 'app-use-evidence'),{describe:()=>apps.describeWrites(),apply:(write,signal)=>apps.applyWrite(write,signal)},computer);
  const appUseEnvironment = await appUse.start();
  host = spawn(resolve(root, `${app.isPackaged ? 'bin' : 'target/debug'}/pero-host${process.platform === 'win32' ? '.exe' : ''}`), ['--stdio'], { cwd: app.isPackaged ? app.getPath('home') : root, stdio: 'pipe', env: {
    ...hostEnvironment, ...appUseEnvironment, PATH: [resolve(root,'bin'),resolve(root,'node_modules/.bin'),process.env.PATH,resolve(app.getPath('home'),'.opencode/bin'),'/opt/homebrew/bin',resolve(app.getPath('home'),'.local/bin')].filter(Boolean).join(delimiter), PERO_LOCALE: locale,
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
      if(message.kind==='computer_settings'||message.kind==='computer_settings_error'){
        const pending=preferenceWrites.get(message.request_id);
        if(pending){clearTimeout(pending.timer);preferenceWrites.delete(message.request_id);}
        if(message.kind==='computer_settings')void computer!.restore(message.data.enabled).then(()=>pending?.resolve(),error=>pending?.reject(error));
        else pending?.reject(new Error('Could not save Computer Use settings'));
        return;
      }
      appUse?.accept(message);
      localExecution?.accept(message);
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
  host.on('error', () => { ready = false; appUse?.reset(); void computer?.stop(); apps.close(); contributions.close(); rejectPreferenceWrites(); send(event('disconnected', 'error.host_start')); });
  host.on('exit', () => { ready = false; appUse?.reset(); void computer?.stop(); apps.close(); contributions.close(); rejectPreferenceWrites(); send(event('disconnected', 'error.host_stopped')); });
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
  ipcMain.handle('pero:computer',(sender,command:unknown)=>{trusted(sender);return computer!.command(command);});
  ipcMain.handle('pero:content-read', (sender, value: unknown) => {
    trusted(sender);
    if(!appUse) throw new Error('Result files are unavailable');
    const request=ConversationContentRead.parse(value);
    return appUse.results.read(request.thread,request.request);
  });
  ipcMain.handle('pero:app-use', async (sender, command: {action?:string;thread_id?:string;scope?:{app:string;panel:string};options?:unknown}) => {
    trusted(sender);
    if(command?.action==='context'&&command.scope&&typeof command.thread_id==='string'){if(!appUse)throw new Error('App context is unavailable');return appUse.draftContext.freeze(command.scope,command.thread_id,command.options);}
    if(command?.action==='select'){appUse?.authority.select(command.thread_id||undefined);return;}
    if(command?.action!=='revoke'||typeof command.thread_id!=='string')throw new Error('Invalid App Use command');
    appUse?.authority.revoke(command.thread_id,command.scope);
  });
  ipcMain.handle('pero:locale:set', (sender, value: string) => { trusted(sender); changeLocale(value); });
  ipcMain.handle('pero:probe', (sender, request: unknown) => {
    trusted(sender);
    const r = request as { id?: unknown; text?: unknown };
    if (!r || typeof r.id !== 'string' || r.id.length > 128 || typeof r.text !== 'string' || Array.from(r.text).length > 4096 || !ready) throw new Error('Invalid probe');
    host.stdin.write(JSON.stringify({ id: r.id, text: r.text }) + '\n');
  });
  ipcMain.handle('pero:web',(sender,command:unknown)=>{
    trusted(sender);
    try {if(!webPages)throw new Error('Web views are unavailable');webPages.command(command);}
    catch(error){send({version:1,kind:'web_error',request_id:null,text:error instanceof Error?error.message:String(error)});}
  });
  ipcMain.handle('pero:session', async (sender, command: unknown) => {
    trusted(sender);
    if (!ready || !command || typeof command !== 'object') throw new Error('Invalid session command');
    const action = (command as { action?: string }).action;
    const method = (command as { method?: string }).method;
    if (action?.startsWith('local_worker_')) {
      if (!['local_worker_init','local_worker_enroll','local_worker_resume','local_worker_disable','local_worker_skip'].includes(action)) throw new Error('Invalid local execution action');
      await localExecution!.command(command);return;
    }
    if (action === 'choose_worker_workspace') {
      const selected=await dialog.showOpenDialog(window,{properties:['openDirectory']});
      if (!selected.canceled && selected.filePaths[0]) send({version:1,kind:'local_worker_workspace',request_id:null,text:'',data:{path:realpathSync(selected.filePaths[0])}});
      return;
    }
    if (action === 'choose_document') {
      const selected=await dialog.showOpenDialog(window,{properties:['openFile']});
      if(!selected.canceled && selected.filePaths[0]) host.stdin!.write(JSON.stringify({method:'documents',action:'open',request_id:'open-file',path:selected.filePaths[0]})+'\n');
      return;
    }
    if ((!['list_agents','workspace','load_roadmap','new_session','prompt','cancel','permission','model','configure','authenticate','close','delete','search_context','resolve_context','attach_files'].includes(action || '') && !['settings.workbench', 'settings.workbench.get', 'documents'].includes(method || '')) || JSON.stringify(command).length > 16_000_000) throw new Error('Invalid session command');
    appUse?.authority.command(command as {action?:string;thread_id?:string});
    host.stdin.write(JSON.stringify(command) + '\n');
  });
  ipcMain.handle('pero:workspace', async (sender) => {
    trusted(sender);
    const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) host.stdin.write(JSON.stringify({action:'workspace',path:selected.filePaths[0]})+'\n');
  });
  ipcMain.handle('pero:context', async (sender, request?: unknown) => {
    trusted(sender);
    if (request === undefined) {
      const selected = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
      if (!selected.canceled && selected.filePaths.length) host.stdin.write(JSON.stringify({ action: 'attach_files', paths: selected.filePaths }) + '\n');
      return;
    }
    const command = request as { kind?: unknown; request_id?: unknown };
    if (!command || typeof command.kind !== 'string' || !['file', 'image', 'directory'].includes(command.kind) || typeof command.request_id !== 'string' || !command.request_id || command.request_id.length > 128) throw new Error('Invalid context picker request');
    const selected = await dialog.showOpenDialog(window, {
      properties: command.kind === 'directory' ? ['openDirectory'] : ['openFile'],
      ...(command.kind === 'image' ? { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] } : {}),
    });
    if (!selected.canceled && selected.filePaths[0]) host.stdin.write(JSON.stringify({ action: 'resolve_context', request_id: command.request_id, kind: command.kind, source: selected.filePaths[0] }) + '\n');
  });
  window = new BrowserWindow({ ...testWindowOptions, width: 1488, height: 1086, minWidth: 1000, minHeight: 680,
    title: t('window.title'), backgroundColor: '#F7F9FC',
    webPreferences: { ...testWindowOptions.webPreferences, preload: resolve(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  webPages=new WebPages(window,send);
  window.on('closed',()=>webPages?.dispose());
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) appUse?.reset(); });
  window.webContents.on('render-process-gone', () => appUse?.reset());
  window.webContents.on('will-prevent-unload',event=>{
    const answer=dialog.showMessageBoxSync(window,{type:'warning',message:t('content.unsaved'),detail:t('content.unsaved_window'),buttons:[t('content.keep_editing'),t('content.discard_window')],defaultId:0,cancelId:0});
    if(answer===1)event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  updateMenus();
  await window.loadURL('pero://workbench/');
  acceptDeepLink = url => {
    if (!backgroundTest) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
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
let shuttingDown = false;
let shutdownComplete = false;
app.on('before-quit', quit => {
  if (shutdownComplete) return;
  quit.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  const computerClosed=appUse?.close()||Promise.resolve(); globalShortcut.unregisterAll(); localExecution?.close(); remote.close(); apps.close(); contributions.close(); rejectPreferenceWrites();
  if (!host?.pid || host.exitCode !== null || host.signalCode !== null) {
    void computerClosed.catch(error=>console.error(error)).finally(()=>{shutdownComplete = true; app.quit();}); return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishing = false;
  const finish = () => {
    if (finishing) return;
    finishing = true;
    clearTimeout(timer);
    void computerClosed.catch(error=>console.error(error)).finally(()=>{shutdownComplete = true; app.quit();});
  };
  // EOF tells the known Host to stop its supervised Worker and Agents. Wait
  // for observed process exit before permitting a replacement Desktop process
  // to open the same Worker journal during a normal restart.
  host.once('exit',finish);
  timer = setTimeout(() => {
    host.kill('SIGTERM');
    timer = setTimeout(() => { host.kill('SIGKILL'); finish(); },2000);
  },10000);
  void computerClosed.catch(error=>console.error(error)).finally(()=>host.stdin.end());
});
