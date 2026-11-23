import { LinuxDesktopDock } from "./linux-desktop-dock.ts";
import { BrowserWindow, WebContentsView, dialog, ipcMain, nativeTheme } from 'electron';
import type { DesktopComputer } from './computer.ts';
import { LinuxDesktop } from './linux-desktop.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';
import { testWindowOptions } from './test-display.ts';
import { translate, type Locale } from '../../../locales/index.ts';
import { join } from 'node:path';
import { sshVncProfile } from './ssh-desktop.ts';
import type { SshHostProfile } from './ssh-host.ts';
import { createDesktopPair, relayOrigin } from './linux-desktop-share.ts';

export class LinuxDesktopWindow {
  readonly session: LinuxDesktop;
  private url?: Promise<string>;
  private window?: BrowserWindow;
  private dock?: LinuxDesktopDock;
  private relay = relayOrigin();

  constructor(private assets: string, private computer: DesktopComputer, private locale: () => Locale,
    private selectedThread: () => Promise<string | undefined>, private ssh?: SshHostProfile) {
    this.session = new LinuxDesktop(new LinuxDesktopVnc(assets, this.relay), () => computer.enabled, () => this.publish());
    ipcMain.handle('pero:linux-desktop', async (event, action: unknown, value: unknown) => {
      const window = this.dock?.window ?? this.window;
      const viewer = this.dock?.viewer.webContents ?? this.window?.webContents;
      if (!window || !viewer || event.sender !== viewer || event.senderFrame !== viewer.mainFrame ||
          event.senderFrame?.url !== await this.url) throw new Error('Untrusted Linux desktop viewer');
      switch (action) {
        case 'move': this.dock?.move(); break;
        case 'hide': this.closeDock(); break;
        case 'state': break;
        case 'start':
          if (this.ssh && !this.ssh.desktop) throw new Error('This SSH profile does not configure a managed Linux desktop.');
          await this.session.start(this.ssh?.desktop ? { host: this.ssh.host, launcher: this.ssh.desktop } : undefined); break;
        case 'connect': await this.session.connect(sshVncProfile.parse(value)); break;
        case 'share': {
          if (!this.relay) throw new Error('Configure a desktop relay first.');
          const { endpoint, viewOnly } = await this.session.share();
          try {
            return { ...this.snapshot(), pair: { ...await createDesktopPair(viewOnly, this.relay), endpoint } };
          } catch (error) {
            await this.session.endShare();
            throw error;
          }
        }
        case 'end-share': await this.session.endShare(); break;
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
          if (this.session.state.external || this.session.state.remoteManaged) { await this.session.stop(); break; }
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

  private snapshot() { return { ...this.session.state, dockSide: this.dock?.side, locale: this.locale(), dark: nativeTheme.shouldUseDarkColors,
    sshHost: this.ssh && { host: this.ssh.host, managed: Boolean(this.ssh.desktop) }, relayAvailable: !!this.relay }; }
  publish() {
    if (this.dock && !this.dock.viewer.webContents.isDestroyed()) this.dock.viewer.webContents.send('pero:linux-desktop-state', this.snapshot());
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('pero:linux-desktop-state', this.snapshot());
  }

  private closeDock = () => {
    if (!this.dock) return;
    this.dock.window.removeListener('closed', this.closeDock);
    this.dock.close();
    this.dock = undefined;
    void this.session.returnControl().catch(console.error);
  };

  async open(parent?: BrowserWindow) {
    if (this.dock) { this.dock.viewer.webContents.focus(); return; }
    if (parent && this.window) this.window.close();
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return; }
    this.url ??= this.session.vnc.open().catch(error => { this.url = undefined; throw error; });
    const url = await this.url;
    if (this.window && !this.window.isDestroyed()) return;
    if (parent) {
      if (this.dock || parent.isDestroyed()) return;
      const view = new WebContentsView({webPreferences: {preload: join(this.assets, 'linux-desktop-preload.cjs'), sandbox:true, contextIsolation:true, nodeIntegration:false}});
      this.dock = new LinuxDesktopDock(parent, view);
      parent.once('closed', this.closeDock);
      view.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      view.webContents.on('will-navigate', event => event.preventDefault());
      view.webContents.once('render-process-gone', this.closeDock);
      try { await view.webContents.loadURL(url); } catch (error) { this.closeDock(); throw error; }
      return;
    }
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
    this.closeDock();
    await this.session.stop();
    this.window?.destroy();
    await this.session.vnc.close();
  }
}
