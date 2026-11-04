import { dialog, type BrowserWindow } from 'electron';

export async function confirmDoclingSetup(window: BrowserWindow, summary: string, signal: AbortSignal, operation: 'install' | 'revoke' = 'install'): Promise<boolean> {
  if (signal.aborted || window.isDestroyed()) return false;
  const closed = new AbortController();
  const stop = () => closed.abort();
  window.once('close', stop); window.once('closed', stop);
  const cancellation = AbortSignal.any([signal, closed.signal]);
  try {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Paper optional OCR', message: operation === 'revoke' ? 'Disable optional OCR?' : 'Install this optional Docling component?',
      detail: operation === 'revoke' ? summary : `${summary}\n\nCancel to continue selecting values manually. Software and model downloads require separate approval.`,
      buttons: ['Cancel', operation === 'revoke' ? 'Disable OCR' : 'Install component'], defaultId: 0, cancelId: 0, noLink: true, signal: cancellation,
    });
    return answer.response === 1 && !cancellation.aborted && !window.isDestroyed();
  } finally { window.removeListener('close', stop); window.removeListener('closed', stop); }
}
