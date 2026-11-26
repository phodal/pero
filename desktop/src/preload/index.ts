import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('peroLinuxDesktopAvailable', process.platform !== 'win32');
contextBridge.exposeInMainWorld('pero', {
  linuxDesktopAction: (action: unknown, value: unknown) => ipcRenderer.invoke('pero:linux-desktop', action, value),
  onLinuxDesktop: (callback: (state: unknown) => void) => {
    ipcRenderer.on('pero:linux-desktop-state', (_, state) => callback(state));
    ipcRenderer.on('pero:linux-desktop-unmount', () => callback(null));
  },
  linuxDesktopSurface: (surface: unknown) => ipcRenderer.invoke('pero:linux-desktop-surface', surface),
  connect: () => ipcRenderer.invoke('pero:connect'),
  getLocale: () => ipcRenderer.invoke('pero:locale:get'),
  setLocale: (locale: string) => ipcRenderer.invoke('pero:locale:set', locale),
  sendProbe: (request: { id: string; text: string }) => ipcRenderer.invoke('pero:probe', request),
  readContent: (request: object) => ipcRenderer.invoke('pero:content-read', request),
  appUseCommand: (command: object) => ipcRenderer.invoke('pero:app-use', command),
  webCommand: (command:object)=>ipcRenderer.invoke('pero:web',command),
  shortcutMenu: (menu: object) => ipcRenderer.invoke('pero:shortcuts', menu),
  sessionCommand: (command: object) => ipcRenderer.invoke('pero:session', command),
  remoteCommand: (command: object) => ipcRenderer.invoke('pero:remote', command),
  appsCommand: (command: object) => ipcRenderer.invoke('pero:apps', command),
  computerCommand: (command: object) => ipcRenderer.invoke('pero:computer', command),
  chooseWorkspace: () => ipcRenderer.invoke('pero:workspace'),
  chooseContext: (command?: object) => ipcRenderer.invoke('pero:context', command),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on('pero:event', listener);
    return () => ipcRenderer.removeListener('pero:event', listener);
  },
});
