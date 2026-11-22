import type { ClientRequest, ClientRequestConstructorOptions, Session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactDeliveryPort } from '../artifact-delivery.ts';

const LIMIT = 10 * 1024 * 1024;

export type DownloadRequest = (options: ClientRequestConstructorOptions) => ClientRequest;

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
  requestDownload: DownloadRequest, session: Session, source: { url: string; name?: string }, scope: { thread: string; workspace: string },
  deliver: ArtifactDeliveryPort, check: () => void, approve: (url: string) => string | undefined,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const { url, disposition, data } = await readDownload(requestDownload, session, source.url, approve, check, bounded);
  check();
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const suggested = /(?:^|;)\s*filename=(?:"([^"]*)"|([^;]*))/i.exec(disposition);
  const fallback = new URL(url).pathname.split('/').pop();
  const title = (source.name || (encoded ? decodeURIComponent(encoded) : suggested?.[1] ?? suggested?.[2]) || fallback || 'download')
    .split(/[\\/]/).at(-1)!.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim().replace(/^\.+/, '');
  if (!title || Buffer.byteLength(title) > 250) throw new Error('The browser download has an unsupported filename.');
  const directory = await mkdtemp(join(scope.workspace, '.pero-browser-download-'));
  try {
    const path = join(directory, title);
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    check();
    return { artifactReceipt: await deliver(scope.thread, { path, title }, bounded), bytes: data.length, url };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
