import type { ClientRequest, ClientRequestConstructorOptions, DownloadItem, Event, Session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactDeliveryPort } from '../artifact-delivery.ts';

const LIMIT = 10 * 1024 * 1024;

export type DownloadRequest = (options: ClientRequestConstructorOptions) => ClientRequest;
export type DownloadListener = (event: Event, item: DownloadItem) => void;
type DownloadScope = { thread: string; workspace: string };
type StagedDownload = { path: string; title: string; url: string; bytes: number };

function downloadTitle(name: string) {
  const title = name.split(/[\\/]/).at(-1)!.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim().replace(/^\.+/, '');
  if (!title || Buffer.byteLength(title) > 250) throw new Error('The browser download has an unsupported filename.');
  return title;
}

async function freezeDownload(scope: DownloadScope, deliver: ArtifactDeliveryPort, check: () => void,
  signal: AbortSignal, stage: (directory: string) => Promise<StagedDownload>) {
  const directory = await mkdtemp(join(scope.workspace, '.pero-browser-download-'));
  try {
    const { path, title, bytes, url } = await stage(directory);
    check();
    signal.throwIfAborted();
    return { artifactReceipt: await deliver(scope.thread, { path, title }, signal), bytes, url };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readDownload(
  requestDownload: DownloadRequest, session: Session, initialUrl: string, approve: (url: string) => string | undefined,
  check: () => void, signal: AbortSignal,
) {
  signal.throwIfAborted();
  let url = initialUrl, redirects = 0;
  const request = requestDownload({ url, session, credentials: 'include', redirect: 'manual' });
  return new Promise<{ url: string; disposition: string; data: Buffer }>((resolve, reject) => {
    const fail = (error: unknown) => {
      signal.removeEventListener('abort', abort);
      reject(error);
      request.abort();
    };
    const abort = () => fail(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    request.once('error', fail);
    request.on('redirect', (_status, _method, next) => {
      try {
        check();
        const destination = approve(next);
        if (!destination) throw new Error('The download redirect is outside the authorized site.');
        if (++redirects > 5) throw new Error('The browser download redirected too many times.');
        url = destination;
        request.followRedirect();
      } catch (error) { fail(error); }
    });
    request.once('response', response => {
      response.once('error', fail);
      response.once('aborted', () => fail(new Error('The browser download was interrupted.')));
      if (response.statusCode < 200 || response.statusCode >= 300)
        return fail(new Error(`The browser download returned HTTP ${response.statusCode}.`));
      if (Number(response.headers['content-length']) > LIMIT) return fail(new Error('The browser download exceeds 10 MiB.'));
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.once('end', () => {
        signal.removeEventListener('abort', abort);
        resolve({ url, disposition: String(response.headers['content-disposition'] || ''), data: Buffer.concat(chunks, bytes) });
      });
      response.on('data', chunk => {
        try {
          check();
          bytes += chunk.length;
          if (bytes > LIMIT) throw new Error('The browser download exceeds 10 MiB.');
          chunks.push(chunk);
        } catch (error) { fail(error); }
      });
    });
    request.end();
  });
}

/** Fetch through the selected browser session, freeze into the existing Host artifact store. */
export async function downloadArtifact(
  requestDownload: DownloadRequest, session: Session, source: { url: string; name?: string }, scope: DownloadScope,
  deliver: ArtifactDeliveryPort, check: () => void, approve: (url: string) => string | undefined,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const { url, disposition, data } = await readDownload(requestDownload, session, source.url, approve, check, bounded);
  check();
  return freezeDownloadBytes({ ...source, url }, disposition, data, scope, deliver, check, bounded);
}

export function freezeDownloadBytes(
  source: { url: string; name?: string }, disposition: string, data: Buffer, scope: DownloadScope,
  deliver: ArtifactDeliveryPort, check: () => void, signal: AbortSignal,
) {
  if (data.length > LIMIT) throw new Error('The browser download exceeds 10 MiB.');
  const { url } = source;
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const suggested = /(?:^|;)\s*filename=(?:"([^"]*)"|([^;]*))/i.exec(disposition);
  const fallback = new URL(url).pathname.split('/').pop();
  const title = downloadTitle(source.name || (encoded ? decodeURIComponent(encoded) : suggested?.[1] ?? suggested?.[2]) || fallback || 'download');
  return freezeDownload(scope, deliver, check, signal, async directory => {
    const path = join(directory, title);
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return { path, title, bytes: data.length, url };
  });
}

/** Capture Chromium's native download from this action, including a page-created Blob. */
export function downloadPageArtifact(
  scope: DownloadScope, source: { origin: string; expectedUrl?: string }, deliver: ArtifactDeliveryPort,
  check: () => void, approve: (url: string) => boolean, signal: AbortSignal,
  start: (receive: DownloadListener) => { dispatched: Promise<void>; release(): void },
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  return freezeDownload(scope, deliver, check, bounded, async directory => {
    let resolve!: (download: StagedDownload) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<StagedDownload>((done, failed) => { resolve = done; reject = failed; });
    let claimed = false;
    let active: DownloadItem | undefined;
    let failure: unknown;
    const fail = (error: unknown) => {
      failure ??= error;
      if (active) active.cancel();
      else reject(failure);
    };
    const abort = () => fail(signal.aborted ? signal.reason : new Error('Timed out waiting for the page download.'));
    bounded.throwIfAborted();
    const { dispatched, release } = start((event, item) => {
      if (claimed) { event.preventDefault(); return; }
      claimed = true;
      try {
        bounded.throwIfAborted();
        check();
        const url = item.getURL();
        if (item.getInitiatorOrigin() !== source.origin || (source.expectedUrl && url !== source.expectedUrl) ||
            ![url, ...item.getURLChain()].every(approve))
          throw new Error('The page download is outside the authorized site or does not match the observed link.');
        if (item.getTotalBytes() > LIMIT) throw new Error('The browser download exceeds 10 MiB.');
        const title = downloadTitle(item.getFilename());
        const path = join(directory, title);
        item.setSavePath(path);
        active = item;
        item.on('updated', () => {
          if (item.getReceivedBytes() > LIMIT || item.getTotalBytes() > LIMIT)
            fail(new Error('The browser download exceeds 10 MiB.'));
        });
        item.once('done', (_event, state) => {
          active = undefined;
          const bytes = item.getReceivedBytes();
          if (failure) reject(failure);
          else if (state !== 'completed') reject(new Error(`The browser download was ${state}.`));
          else if (bytes > LIMIT) reject(new Error('The browser download exceeds 10 MiB.'));
          else resolve({ path, title, bytes, url });
        });
      } catch (error) {
        event.preventDefault();
        reject(error);
      }
    });
    bounded.addEventListener('abort', abort, { once: true });
    const dispatch = dispatched.catch(fail);
    try {
      return await result;
    } finally {
      bounded.removeEventListener('abort', abort);
      release();
      await dispatch;
    }
  });
}
