import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('product', {
  connect: () => ipcRenderer.invoke('product:connect'),
  open: (name?: string) => ipcRenderer.invoke('product:open', name),
  readContent: (request: object) => ipcRenderer.invoke('product:content-read', request),
  appUseCommand: (command: object) => ipcRenderer.invoke('product:app-use', command),
  sessionCommand: (command: object) => ipcRenderer.invoke('product:session', command),
  onEvent: (receive: (event: unknown) => void) => ipcRenderer.on('product:event', (_event, value) => receive(value)),
  onContext: (receive: (context: unknown) => void) => ipcRenderer.on('product:context', (_event, value) => receive(value)),
});
