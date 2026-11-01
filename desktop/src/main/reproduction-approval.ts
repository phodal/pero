import { dialog, type BrowserWindow } from 'electron';

/** The main process renders Host-frozen plain text; no App script answers this dialog. */
export async function confirmReproduction(window: BrowserWindow, summary: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || window.isDestroyed()) return false;
  const closed = new AbortController();
  const stop = () => closed.abort();
  window.once('closed', stop);
  const cancellation = AbortSignal.any([signal, closed.signal]);
  try {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Paper reproduction', message: 'Run this frozen local computation once?',
      detail: summary, buttons: ['Cancel', 'Run once'], defaultId: 0, cancelId: 0,
      noLink: true, signal: cancellation,
    });
    return answer.response === 1 && !cancellation.aborted && !window.isDestroyed();
  } finally { window.removeListener('closed', stop); }
}
