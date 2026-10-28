import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('pero', {
  connect: () => ipcRenderer.invoke('pero:connect'),
  getLocale: () => ipcRenderer.invoke('pero:locale:get'),
  setLocale: (locale: string) => ipcRenderer.invoke('pero:locale:set', locale),
  sendProbe: (request: { id: string; text: string }) => ipcRenderer.invoke('pero:probe', request),
  sessionCommand: (command: object) => ipcRenderer.invoke('pero:session', command),
  remoteCommand: (command: object) => ipcRenderer.invoke('pero:remote', command),
  appsCommand: (command: object) => ipcRenderer.invoke('pero:apps', command),
  chooseWorkspace: () => ipcRenderer.invoke('pero:workspace'),
  chooseContext: () => ipcRenderer.invoke('pero:context'),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on('pero:event', listener);
    return () => ipcRenderer.removeListener('pero:event', listener);
  },
});
