import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { z } from 'zod';
import type { DesktopComputer } from './computer.ts';
import { LinuxDesktop } from './linux-desktop.ts';
import { LinuxDesktopVnc } from './linux-desktop-vnc.ts';
import { testWindowOptions } from './test-display.ts';
import { translate, type Locale } from '../../../locales/index.ts';
import { join } from 'node:path';
import { sshVncProfile } from './ssh-desktop.ts';
import type { SshHostProfile } from './ssh-host.ts';
import { createDesktopPair, relayOrigin } from './linux-desktop-share.ts';

export const linuxDesktopSurface = z.object({
  thread: z.string().min(1),
  visible: z.boolean(),
}).nullable();
type DesktopSurface = z.infer<typeof linuxDesktopSurface>;

export class LinuxDesktopWindow {
  readonly session: LinuxDesktop;
  private url?: Promise<string>;
  private window?: BrowserWindow;
  private workbench?: BrowserWindow;
  private viewerDrain?: Promise<void>;
  private surface: DesktopSurface = null;
  private relay = relayOrigin();

  constructor(private assets: string, private computer: DesktopComputer, private locale: () => Locale,
    private selectedThread: () => Promise<string | undefined>, private ssh?: SshHostProfile) {
    this.session = new LinuxDesktop(new LinuxDesktopVnc(assets, this.relay), () => computer.enabled, () => this.publish());
    ipcMain.handle('pero:linux-desktop', async (event, action: unknown, value: unknown) => {
      const embedded = this.workbench?.webContents === event.sender;
      const window = embedded ? this.workbench : this.window;
      const viewer = window?.webContents;
      if (!window || !viewer || event.sender !== viewer || event.senderFrame !== viewer.mainFrame ||
          event.senderFrame?.url !== (embedded ? 'pero://workbench/' : await this.url)) {
        throw new Error('Untrusted Linux desktop viewer');
      }
      if (embedded && action !== 'state' && !this.surface?.visible) throw new Error('The desktop tab is hidden.');
      switch (action) {
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
          if (!thread || (embedded && this.surface?.thread !== thread)) throw new Error(translate(this.locale(), 'linux_desktop.select_chat'));
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

  private snapshot() { return { ...this.session.state, locale: this.locale(), dark: nativeTheme.shouldUseDarkColors,
    sshHost: this.ssh && { host: this.ssh.host, managed: Boolean(this.ssh.desktop) }, relayAvailable: !!this.relay }; }
  publish() {
    const state = this.snapshot();
    if (this.workbench && !this.workbench.isDestroyed()) this.workbench.webContents.send('pero:linux-desktop-state', state);
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('pero:linux-desktop-state', state);
  }

  async setSurface(parent: BrowserWindow, surface: DesktopSurface) {
    this.workbench = parent;
    const previous = this.surface;
    this.surface = surface;
    if (previous && previous.thread !== surface?.thread) await this.session.returnControl();
    if (this.surface !== surface || !surface?.visible) return;
    if (this.window) {
      this.window.close();
      this.viewerDrain = this.session.vnc.disconnectViewer();
    }
    await this.viewerDrain;
    if (this.surface === surface) return this.viewerUrl();
  }

  private viewerUrl() {
    return this.url ??= this.session.vnc.open().catch(error => { this.url = undefined; throw error; });
  }

  async open() {
    if (this.surface?.visible && this.workbench && !this.workbench.isDestroyed()) {
      this.workbench.focus();
      return;
    }
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return; }
    if (this.workbench && !this.workbench.isDestroyed()) this.workbench.webContents.send('pero:linux-desktop-unmount');
    this.viewerDrain = this.session.vnc.disconnectViewer();
    await this.viewerDrain;
    const url = await this.viewerUrl();
    if (this.window || this.surface?.visible) return;
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
