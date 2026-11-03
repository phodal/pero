import createDOMPurify from 'dompurify';

export type ArticleSource = Readonly<{
  id: string;
  html: string;
  sourceUrl: string;
  assets?: ReadonlyMap<string, string>;
}>;
export type OutlineEntry = Readonly<{ id: string; title: string; level: number }>;

/** Display projection of one caller-owned snapshot; never an evidence document. */
export class Article {
  readonly body: DocumentFragment;
  readonly outline: readonly OutlineEntry[];
  constructor(window: Window & typeof globalThis, readonly source: ArticleSource) {
    const purifier = createDOMPurify(window as never);
    const parsed = new window.DOMParser().parseFromString(source.html, 'text/html');
    const article = parsed.querySelector('article.ltx_document, article') ?? parsed.body;
    this.body = purifier.sanitize(article.outerHTML, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['script', 'style', 'link', 'base', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'audio', 'video', 'source'],
      FORBID_ATTR: ['style', 'srcset', 'background', 'action', 'formaction', 'poster'],
    }) as DocumentFragment;
    for (const element of this.body.querySelectorAll('[href], [src], [xlink\\:href]')) {
      for (const attribute of ['href', 'src', 'xlink:href']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        element.removeAttribute(attribute);
        if (attribute === 'href' && element.localName === 'a') {
          if (!URL.canParse(value, source.sourceUrl)) continue;
          const url = new URL(value, source.sourceUrl);
          if (url.protocol === 'https:' || url.protocol === 'http:') element.setAttribute('href', url.href);
        } else if (value.startsWith('#') && element.namespaceURI === 'http://www.w3.org/2000/svg') {
          element.setAttribute(attribute, value);
        } else if (attribute === 'src' && element.localName === 'img') {
          if (!URL.canParse(value, source.sourceUrl)) continue;
          const url = new URL(value, source.sourceUrl).href;
          const asset = source.assets?.get(url);
          if (asset) element.setAttribute('src', asset);
          else {
            const placeholder = parsed.createElement('span');
            placeholder.className = 'reader-missing-image';
            const alt = element.getAttribute('alt');
            placeholder.textContent = 'Image not downloaded' + (alt && alt !== 'Refer to caption' ? `: ${alt}` : '');
            element.replaceWith(placeholder);
          }
        }
      }
    }
    this.outline = Array.from(this.body.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((heading, index) => {
      const id = heading.id || heading.parentElement?.id || `reader-heading-${index}`;
      if (!heading.id && !heading.parentElement?.id) heading.id = id;
      const copy = heading.cloneNode(true) as Element;
      copy.querySelectorAll('annotation,annotation-xml').forEach(node => node.remove());
      return { id, title: copy.textContent?.replace(/\s+/g, ' ').trim() ?? '', level: Number(heading.localName[1]) };
    });
  }
}
