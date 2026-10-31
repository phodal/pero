// Main-process text for a device operation a remote Host cannot do; shown in the active language.
const LOCAL_ONLY = '此本地设备操作不适用于远程项目';
// Electron wraps IPC failures as "Error invoking remote method '<channel>': Error: <message>".
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

export const errorMessage = (error: unknown): string => {
  const message = (error instanceof Error ? error.message : String(error)).replace(IPC_PREFIX, '');
  return message.includes(LOCAL_ONLY) ? (document.documentElement.lang?.toLowerCase().startsWith('zh') ? '此操作需要本机 Host。' : 'This action requires the local Host.') : message;
};
