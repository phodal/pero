import { app, BrowserWindow, ipcMain, Menu, protocol, nativeTheme } from 'electron';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DesktopApps } from './apps';
import { Product } from '../../../packages/product/product';

const root = resolve(__dirname, '../..');
const product = Product.parse(JSON.parse(readFileSync(resolve(root, 'product.json'), 'utf8')));
if (product.shell !== 'app') throw new Error('This entry requires an App Product');
app.setName(product.name);
app.setPath('userData', process.env.PERO_DESKTOP_DATA_DIR || resolve(app.getPath('appData'), product.id));
protocol.registerSchemesAsPrivileged(['pero', 'pero-app'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
let window: BrowserWindow;
let host: ReturnType<typeof spawn>;
let ready = false;
let resolveReady: () => void;
const hostReady = new Promise<void>(resolve => { resolveReady = resolve; });
const apps = new DesktopApps(request => {
  if (!ready || !host.stdin?.writable) throw new Error('The local runtime is unavailable. Restart the application.');
  host.stdin.write(JSON.stringify(request) + '\n');
}, event => { if (!window.isDestroyed()) window.webContents.send('product:event', event); }, async () => undefined);
let locale: 'en' | 'zh-CN' = 'en';
function context() { return { product, locale, dark: nativeTheme.shouldUseDarkColors }; }
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
  window = new BrowserWindow({ title: product.name, width: 1280, height: 900, minWidth: 760, minHeight: 600,
    webPreferences: { preload: resolve(__dirname, 'product-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  protocol.handle('pero-app', request => apps.serve(request));
  // Only the product shell has a preload; App documents retain their separate origin.
  protocol.handle('pero', async () => new Response(readFileSync(resolve(root, 'desktop/dist/product.html')), {
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src pero-app:" },
  }));
  host = spawn(resolve(root, 'bin/pero-host'), ['--stdio'], { cwd: app.getPath('home'), env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_'))),
    PERO_SETTINGS_PATH: resolve(profile, 'runtime-settings.json'), PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'),
    PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: resolve(root, 'apps'),
    PERO_APP_NODE: product.node === 'bundled' ? resolve(root, 'runtime/node/bin/node') : product.node === 'system' ? 'node' : resolve(root, 'runtime/unavailable-node'),
    PERO_LOCALE: locale, PERO_APP_PYTHON: product.python === 'bundled' ? resolve(root, 'runtime/python/bin/python3') : 'python3',
  }, stdio: 'pipe' });
  createInterface({ input: host.stdout! }).on('line', line => {
    const message = JSON.parse(line);
    if (apps.accept(message)) return;
    if (message.kind === 'ready') { ready = true; resolveReady(); }
    if (message.kind === 'settings') {
      locale = message.text === 'zh-CN' ? 'zh-CN' : 'en'; menus();
      window.webContents.send('product:context', context());
    }
  });
  host.stderr?.on('data', data => console.error(String(data)));
  const stopped = () => { ready = false; apps.close(); if (!window.isDestroyed()) window.webContents.send('product:event', { kind: 'disconnected' }); };
  host.on('error', stopped); host.on('exit', stopped);
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== 'pero://workbench/') throw new Error('Untrusted sender');
  };
  ipcMain.handle('product:connect', event => { trusted(event); return context(); });
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  menus();
  await window.loadURL('pero://workbench/');
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { apps.close(); host?.stdin?.end(); });
