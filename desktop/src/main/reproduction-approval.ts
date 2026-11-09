import { dialog, type BrowserWindow } from 'electron';
import { confirmLinuxReproduction } from './reproduction-approval-linux.ts';

export function confirmReproduction(window: BrowserWindow, summary: string, signal: AbortSignal, canvas: boolean | 'project' = false): Promise<boolean> {
  return process.platform === 'linux' ? confirmLinuxReproduction(window, summary, signal, canvas) :
    confirmNativeReproduction(window, summary, signal, canvas);
}

/** The main process renders Host-frozen plain text; no App script answers this dialog. */
export async function confirmNativeReproduction(window: BrowserWindow, summary: string, signal: AbortSignal, canvas: boolean | 'project' = false): Promise<boolean> {
  if (signal.aborted || window.isDestroyed()) return false;
  const closed = new AbortController();
  const stop = () => closed.abort();
  // Revoke while the native owner is still alive, before normal teardown.
  window.once('close', stop);
  window.once('closed', stop);
  const cancellation = AbortSignal.any([signal, closed.signal]);
  try {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: canvas === 'project' ? 'Host project reference' : canvas ? 'App Canvas action' : 'Paper reproduction', message: canvas === 'project' ? 'Update this Host project reference?' : canvas ? 'Run this declared App action once?' : 'Run this frozen local computation once?',
      detail: summary, buttons: ['Cancel', canvas === 'project' ? 'Update reference' : 'Run once'], defaultId: 0, cancelId: 0,
      noLink: true, signal: cancellation,
    });
    return answer.response === 1 && !cancellation.aborted && !window.isDestroyed();
  } finally { window.removeListener('close', stop); window.removeListener('closed', stop); }
}
