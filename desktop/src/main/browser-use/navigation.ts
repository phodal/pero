import type { WebContents } from 'electron';

export class HistoryRejection extends Error {}

export async function traverseHistory(
  contents: WebContents,
  action: 'back' | 'forward' | 'reload',
  approved: (url: string) => string | undefined,
  signal: AbortSignal,
) {
  const history = contents.navigationHistory;
  const index = history.getActiveIndex() + (action === 'back' ? -1 : action === 'forward' ? 1 : 0);
  const entry = history.getEntryAtIndex(index);
  if (!entry) throw new HistoryRejection('There is no history entry in that direction.');
  if (!approved(entry.url)) throw new HistoryRejection('The history entry is outside the authorized site.');
  const pending = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  pending.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (!contents.isDestroyed()) {
        contents.off('did-finish-load', loaded);
        contents.off('did-navigate-in-page', inPage);
        contents.off('did-fail-load', failed);
        contents.off('will-redirect', redirect);
        contents.off('destroyed', destroyed);
      }
      pending.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (!contents.isDestroyed() && approved(contents.getURL())) resolve(contents.getURL());
      else reject(new Error('The browser left the authorized site.'));
    };
    const loaded = () => finish();
    const inPage = (_event: Electron.Event, _url: string, main: boolean) => { if (main) finish(); };
    const failed = (_event: Electron.Event, _code: number, description: string, _url: string, main: boolean) => {
      if (main) finish(new Error(description));
    };
    const redirect = (event: Electron.Event<Electron.WebContentsWillRedirectEventParams>) => {
      if (event.isMainFrame && !approved(event.url)) {
        event.preventDefault();
        finish(new HistoryRejection('The history entry redirected outside the authorized site.'));
      }
    };
    const destroyed = () => finish(new Error('The tab was closed.'));
    const abort = () => finish(new Error('Browser history navigation was interrupted.'));
    contents.on('did-finish-load', loaded);
    contents.on('did-navigate-in-page', inPage);
    contents.on('did-fail-load', failed);
    contents.on('will-redirect', redirect);
    contents.once('destroyed', destroyed);
    pending.addEventListener('abort', abort, { once: true });
    try {
      if (action === 'reload') contents.reload();
      else history.goToIndex(index);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
