import { contextBridge, ipcRenderer } from 'electron';
import type { LinuxDesktopState } from '../main/linux-desktop.ts';
import type { Locale } from '../../../locales/index.ts';
import type { SshVncProfile } from '../main/ssh-desktop.ts';

export type DesktopSnapshot = LinuxDesktopState & {
  dockSide?: 'left' | 'right'; locale: Locale; dark: boolean; sshHost?: { host: string; managed: boolean }; relayAvailable: boolean;
  pair?: { origin: string; id: string; ticket: string; invite: string; endpoint: string };
};
export type DesktopAction = 'state' | 'move' | 'hide' | 'start' | 'connect' | 'share' | 'end-share' | 'takeover' | 'return' | 'enable' | 'attach' | 'detach' | 'stop';
export type LinuxDesktopBridge = {
  invoke(action: DesktopAction, value?: SshVncProfile): Promise<DesktopSnapshot>;
  listen(callback: (state: DesktopSnapshot) => void): () => void;
};

contextBridge.exposeInMainWorld('peroLinuxDesktop', {
  invoke: (action, value) => ipcRenderer.invoke('pero:linux-desktop', action, value),
  listen(callback) {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopSnapshot) => callback(state);
    ipcRenderer.on('pero:linux-desktop-state', handler);
    return () => ipcRenderer.removeListener('pero:linux-desktop-state', handler);
  },
} satisfies LinuxDesktopBridge);
