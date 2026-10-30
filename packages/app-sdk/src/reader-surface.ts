import type { DocumentHeader, ReaderLocation } from '../../../protocol/generated/host';
import type { AppDocumentInput } from '../../content-source/app-document';
import type { AppearanceSnapshot } from './appearance';
import { normalizeLocale, translate } from '../../../locales';
import {getActiveIconTheme,type IconThemePackage} from '../../icons/theme';

export type ReaderContext = { locale: string; dark: boolean; appearance?: AppearanceSnapshot; iconTheme?: IconThemePackage|null };
export type ReadingSource = { header: DocumentHeader; text: string; location?: ReaderLocation } | { document: AppDocumentInput };

/** A complete source enters the same GPUI reader; this shell grants no Host commands. */
export function mountReaderSurface(container: HTMLElement, options: {
  source: ReadingSource; context: ReaderContext; url: string; link?(url: string): void;
}) {
  const url = new URL(options.url, location.href), nonce = crypto.randomUUID();
  const origin = `${url.protocol}//${url.host}`;
  url.searchParams.set('nonce', nonce); url.searchParams.set('parent', `${location.protocol}//${location.host}`);
  const frame = document.createElement('iframe');
  frame.dataset.peroReader = '';
  frame.title = 'document' in options.source ? options.source.document.title : options.source.header.source.title;
  frame.sandbox.add('allow-scripts', 'allow-same-origin');
  const status = document.createElement('div'); status.className = 'pero-reader-status'; status.setAttribute('role', 'status');
  const label = document.createElement('span');
  const retry = document.createElement('button'); retry.type = 'button';
  const download = document.createElement('button'); download.type = 'button';
  status.append(label, retry, download); container.append(frame, status);
  let context = options.context, source = options.source, connected = false, failure = false;
  let sentTheme:IconThemePackage|null|undefined;
  let sentSource:ReadingSource|undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const post = (type: string, value: object) => frame.contentWindow?.postMessage({ type, nonce, ...value }, origin);
  const render = (failed = failure) => {
    failure = failed;
    const locale = normalizeLocale(context.locale);
    label.textContent = translate(locale, failed ? 'content.reader_failed' : 'workspace.source_loading');
    retry.textContent = translate(locale, 'workspace.source_retry');
    download.textContent = translate(locale, 'content.download_source');
    retry.hidden = download.hidden = !failed; status.hidden = connected;
  };
  const readerContext = () => {
    const iconTheme=context.iconTheme===undefined?getActiveIconTheme():context.iconTheme;
    const payload={...context,iconTheme:iconTheme===sentTheme?undefined:iconTheme};sentTheme=iconTheme;return payload;
  };
  const start = () => {
    sentTheme=undefined;
    sentSource=undefined;
    clearTimeout(timer); connected = false; render(false); frame.src = url.href;
    timer = setTimeout(() => { render(true); }, 30000);
  };
  const publish = () => {
    sentSource=source;
    const reading='document' in source ? {...source,context:readerContext()} : {source,context:readerContext()};
    post('pero:reader:document',{reading});
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'pero:reader:connect') publish();
    else if (event.data.type === 'pero:reader:ready') {
      clearTimeout(timer); connected = true; render(false);
      if(source!==sentSource)publish();else post('pero:reader:context',{context:readerContext()});
    }
    else if (event.data.type === 'pero:reader:error') { clearTimeout(timer); connected = false; render(true); }
    else if (event.data.type === 'pero:reader:link' && typeof event.data.url === 'string') {
      const url = new URL(event.data.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') options.link?.(url.href);
    }
  };
  retry.onclick = start;
  download.onclick = () => {
    const input = 'document' in source ? source.document : { title: source.header.source.title, text: source.text };
    const url = URL.createObjectURL(new Blob([input.text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.download = input.title; anchor.href = url; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  window.addEventListener('message', receive); start();
  return {
    frame,
    source(value: ReadingSource) { source = value; frame.title = 'document' in source ? source.document.title : source.header.source.title; if (connected) publish(); },
    context(value: ReaderContext) { context = value; render(); if(connected)post('pero:reader:context', { context:readerContext() }); },
    dispose() { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); status.remove(); },
  };
}
