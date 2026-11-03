import { Article, type ArticleSource } from './article';
export { Article, type ArticleSource, type OutlineEntry } from './article';
export type ReaderAppearance = Readonly<{ dark: boolean; fontSize?: number }>;
export type ReaderSelection = Readonly<{ sourceId: string; text: string; anchors: readonly string[] }>;

/** Browser component. The caller owns acquisition, evidence and persistence. */
export function mountPaperReader(root: HTMLElement, options: {
  source: ArticleSource;
  frameUrl: string;
  appearance: ReaderAppearance;
  onSelection?(selection: ReaderSelection | null): void;
  onOpenLink?(url: string): void;
}) {
  const article = new Article(window, options.source);
  const frame = document.createElement('iframe');
  frame.title = article.outline[0]?.title || 'Paper';
  frame.sandbox.add('allow-same-origin');
  frame.style.cssText = 'display:block;width:100%;height:1px;border:0';
  let appearance = options.appearance;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  const events = new AbortController();
  function updateAppearance(next: ReaderAppearance) {
    appearance = next;
    const html = frame.contentDocument?.documentElement;
    if (!html) return;
    html.dataset.theme = next.dark ? 'dark' : 'light';
    html.style.setProperty('--reader-size', `${next.fontSize ?? 16}px`);
  }
  function reveal(id: string) {
    const element = frame.contentDocument?.getElementById(id);
    if (!element) return false;
    frame.contentDocument?.querySelector('.reader-target')?.classList.remove('reader-target');
    element.classList.add('reader-target');
    element.setAttribute('tabindex', '-1');
    element.scrollIntoView({ block: 'center' });
    (element as HTMLElement).focus({ preventScroll: true });
    return true;
  }
  const ready = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => {
      if (disposed) { resolve(); return; }
      const doc = frame.contentDocument;
      if (!doc?.body) { reject(new Error('Paper frame is unavailable')); return; }
      doc.body.replaceChildren(doc.importNode(article.body, true));
      updateAppearance(appearance);
      const resize = () => { frame.style.height = `${Math.ceil(doc.body.getBoundingClientRect().height) + 24}px`; };
      observer = new ResizeObserver(resize); observer.observe(doc.body); resize();
      doc.addEventListener('click', event => {
        const anchor = (event.target as Element).closest('a[href]');
        if (!anchor) return;
        event.preventDefault();
        const url = new URL(anchor.getAttribute('href')!);
        const source = new URL(options.source.sourceUrl);
        if (url.origin === source.origin && url.pathname === source.pathname && url.hash) reveal(decodeURIComponent(url.hash.slice(1)));
        else options.onOpenLink?.(url.href);
      }, { signal: events.signal });
      const select = () => {
        const selection = frame.contentWindow?.getSelection();
        const text = selection?.toString().trim();
        const anchors = new Set<string>();
        if (selection?.rangeCount) for (const node of [selection.anchorNode, selection.focusNode]) {
          const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
          const anchor = element?.closest('[id]');
          if (anchor?.id) anchors.add(anchor.id);
        }
        options.onSelection?.(text ? { sourceId: options.source.id, text, anchors: [...anchors] } : null);
      };
      doc.addEventListener('selectionchange', select, { signal: events.signal });
      doc.addEventListener('mouseup', select, { signal: events.signal });
      doc.addEventListener('keyup', select, { signal: events.signal });
      resolve();
    }, { once: true });
  });
  frame.src = options.frameUrl;
  root.replaceChildren(frame);
  return { ready, outline: article.outline, reveal, updateAppearance, dispose() {
    disposed = true; events.abort(); observer?.disconnect(); frame.remove();
  } };
}
