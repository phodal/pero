import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import type { DesktopComputer } from './computer.ts';
import { LinuxDesktop } from './linux-desktop.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';
import { testWindowOptions } from './test-display.ts';
import { translate, type Locale } from '../../../locales/index.ts';
import { join } from 'node:path';

export class LinuxDesktopWindow {
  readonly session: LinuxDesktop;
  private url?: Promise<string>;
  private window?: BrowserWindow;

  constructor(private assets: string, private computer: DesktopComputer, private locale: () => Locale,
    private selectedThread: () => Promise<string | undefined>) {
    this.session = new LinuxDesktop(new LinuxDesktopVnc(assets), () => computer.enabled, () => this.publish());
    ipcMain.handle('pero:linux-desktop', async (event, action: unknown) => {
      const window = this.window;
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame?.url !== await this.url) throw new Error('Untrusted Linux desktop viewer');
      switch (action) {
        case 'state': break;
        case 'start': await this.session.start(); break;
        case 'takeover': await this.session.handoff(true); break;
        case 'return': await this.session.handoff(false); break;
        case 'enable': await this.computer.command({ action: 'computer_set', enabled: true }); break;
        case 'attach': {
          const thread = await this.selectedThread();
          if (!thread) throw new Error(translate(this.locale(), 'linux_desktop.select_chat'));
          this.session.attach(thread);
          break;
        }
        case 'detach': await this.session.detach(); break;
        case 'stop': {
          const t = (key: Parameters<typeof translate>[1]) => translate(this.locale(), key);
          const answer = await dialog.showMessageBox(window, { type: 'warning', message: t('linux_desktop.discard'),
            buttons: [t('linux_desktop.cancel'), t('linux_desktop.stop')], cancelId: 0, defaultId: 0, noLink: true });
          if (answer.response === 1) await this.session.stop();
          break;
        }
        default: throw new Error('Invalid Linux desktop action');
      }
      return this.snapshot();
    });
  }

  private snapshot() { return { ...this.session.state, locale: this.locale(), dark: nativeTheme.shouldUseDarkColors }; }
  publish() {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('pero:linux-desktop-state', this.snapshot());
  }

  async open() {
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return; }
    this.url ??= this.session.vnc.open().catch(error => { this.url = undefined; throw error; });
    const url = await this.url;
    if (this.window && !this.window.isDestroyed()) return;
    const window = this.window = new BrowserWindow({
      width: 1060, height: 760, minWidth: 460, minHeight: 320, title: translate(this.locale(), 'linux_desktop.title'),
      ...testWindowOptions,
      webPreferences: { ...testWindowOptions.webPreferences, preload: join(this.assets, 'linux-desktop-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => {
      this.window = undefined;
      void this.session.returnControl().catch(error => console.error(error));
    });
    window.webContents.on('render-process-gone', () => { void this.session.returnControl().catch(error => console.error(error)); });
    await window.loadURL(url);
  }

  async close() {
    await this.session.stop();
    this.window?.destroy();
    await this.session.vnc.close();
  }
}
