import type { ReaderContext } from './reader-surface';

/** Mounts a GPUI Kit chart using the same isolated GPUI surface as the reader. */
export function mountChartSurface(container: HTMLElement, options: {
  document: object; context: ReaderContext; url: string;
}) {
  const url = new URL(options.url, location.href), nonce = crypto.randomUUID();
  const origin = `${url.protocol}//${url.host}`;
  url.searchParams.set('nonce', nonce); url.searchParams.set('parent', `${location.protocol}//${location.host}`);
  const frame = document.createElement('iframe');
  frame.dataset.peroChart = ''; frame.title = 'Chart'; frame.style.visibility = 'hidden'; frame.sandbox.add('allow-scripts', 'allow-same-origin');
  const status = document.createElement('div'); status.setAttribute('role', 'status');
  const label = document.createElement('span'), retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'Retry'; retry.hidden = true;
  status.append(label, retry); container.append(frame, status);
  let chartDocument = options.document, context = options.context, connected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const post = (type: string, value: object) => frame.contentWindow?.postMessage({ type, nonce, ...value }, origin);
  const publish = () => post('pero:reader:chart', { reading: { chart: chartDocument, context } });
  const fail = (message: string) => { clearTimeout(timer); connected = false; frame.style.visibility = 'hidden'; status.hidden = false; label.textContent = message; retry.hidden = false; };
  const start = () => {
    clearTimeout(timer); connected = false; frame.style.visibility = 'hidden'; status.hidden = false; retry.hidden = true; retry.textContent = context.locale === 'zh-CN' ? '重试' : 'Retry';
    label.textContent = context.locale === 'zh-CN' ? '正在加载图表…' : 'Loading chart…';
    frame.src = url.href;
    timer = setTimeout(() => fail(context.locale === 'zh-CN' ? '图表加载失败。' : 'Chart failed to load.'), 30000);
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'pero:reader:connect') publish();
    else if (event.data.type === 'pero:reader:ready') { clearTimeout(timer); connected = true; frame.style.visibility = 'visible'; status.hidden = true; publish(); }
    else if (event.data.type === 'pero:reader:error') fail(String(event.data.error || 'Chart failed to render'));
  };
  retry.onclick = start; window.addEventListener('message', receive); start();
  return {
    frame,
    document(value: object) { chartDocument = value; if (connected) publish(); },
    context(value: ReaderContext) { context = value; if (connected) post('pero:reader:context', { context }); },
    dispose() { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); status.remove(); },
  };
}
