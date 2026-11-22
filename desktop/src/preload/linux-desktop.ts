import { contextBridge, ipcRenderer } from 'electron';
import type { LinuxDesktopState } from '../main/linux-desktop.ts';
import type { Locale } from '../../../locales/index.ts';

export type DesktopSnapshot = LinuxDesktopState & { locale: Locale; dark: boolean };
export type DesktopAction = 'state' | 'start' | 'takeover' | 'return' | 'enable' | 'attach' | 'detach' | 'stop';
export type LinuxDesktopBridge = {
  invoke(action: DesktopAction): Promise<DesktopSnapshot>;
  listen(callback: (state: DesktopSnapshot) => void): () => void;
};

contextBridge.exposeInMainWorld('peroLinuxDesktop', {
  invoke: action => ipcRenderer.invoke('pero:linux-desktop', action),
  listen(callback) {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopSnapshot) => callback(state);
    ipcRenderer.on('pero:linux-desktop-state', handler);
    return () => ipcRenderer.removeListener('pero:linux-desktop-state', handler);
  },
} satisfies LinuxDesktopBridge);
