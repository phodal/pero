import katex from 'katex';
import { normalizeMystIdentifier, type MystDocument, type MystNode } from './myst.ts';

/** Static publication styling, independent of app chrome. System colors respect
 * the reader's contrast preferences; printing remains browser-native. */
const publicationStyle = `
:root { color-scheme: light dark; font: 16px/1.65 system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { max-width: 72ch; margin: auto; padding: 2rem 1.25rem; overflow-wrap: anywhere; }
h1,h2,h3,h4,h5,h6 { line-height: 1.25; break-after: avoid; }
a { color: LinkText; text-underline-offset: .15em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid; padding: 1rem; }
code { font-family: ui-monospace, monospace; }
blockquote, aside { margin: 1rem 0; border-inline-start: .2rem solid; padding: .25rem 1rem; }
figure { margin: 1.5rem 0; }
figcaption, .notice { font-size: .9rem; }
.equation { display: flex; gap: 1rem; align-items: center; justify-content: space-between; overflow-x: auto; padding: 1rem 0; }
math[display="block"] { margin: .5rem 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th,td { text-align: start; border: 1px solid; padding: .35rem .6rem; }
.diagnostics { border: 1px solid; padding: 1rem; margin-top: 2rem; }
.source { margin-top: 2rem; }
@page { margin: 18mm; }
@media print { :root { color-scheme: light; font-size: 11pt; } main { max-width: none; padding: 0; } .source { display: none; } a { color: inherit; } pre, figure, aside { break-inside: avoid; } }
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** No relative URLs: the downloaded document has no trusted base or assets.
 * Resource URLs are only ever links, never embedded or automatically fetched. */
function safeHref(value: string): string | undefined {
  if (value.startsWith('#')) return value;
  if (!/^https?:\/\//i.test(value) && !/^mailto:/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

function math(value: string, displayMode: boolean): string {
  // MathML is self-contained: no CDN, fonts, stylesheet, script or HTML extension.
  return katex.renderToString(value, { displayMode, output: 'mathml', trust: false,
    throwOnError: false, strict: 'error', maxExpand: 1000, maxSize: 20 });
}

/** A publication is inert, self-contained HTML. Use an empty iframe sandbox
 * for previews. Authored HTML, includes, plugins and code never execute. */
export function renderMystHtml(document: MystDocument): string {
  const notices = new Set<string>();
  const text = (node: MystNode, key: string) => typeof node[key] === 'string' ? node[key] as string : '';
  const anchor = (identifier: string) => `myst-${identifier.replace(/[^a-zA-Z0-9_-]/gu, char => `~${char.codePointAt(0)!.toString(16)}~`)}`;
  const id = (node: MystNode) => {
    const identifier = text(node, 'identifier');
    return identifier ? ` id="${escapeHtml(anchor(identifier))}"` : '';
  };
  const label = (node: MystNode) => document.references[text(node, 'identifier')]?.label ?? '';
  const link = (url: string, content: string) => {
    const href = safeHref(url);
    if (!href) { notices.add(`Link not activated: ${url}`); return content; }
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${content}</a>`;
  };
  const render = (node: MystNode): string => {
    const children = () => (node.children ?? []).map(render).join('');
    const value = text(node, 'value');
    switch (node.type) {
      case 'root': case 'block': return id(node) ? `<div${id(node)}>${children()}</div>` : children();
      case 'text': return id(node) ? `<span${id(node)}>${escapeHtml(value)}</span>` : escapeHtml(value);
      case 'paragraph': return `<p${id(node)}>${children()}</p>`;
      case 'heading': {
        const depth = typeof node.depth === 'number' && Number.isInteger(node.depth) && node.depth >= 1 && node.depth <= 6 ? node.depth : 2;
        return `<h${depth}${id(node)}>${children()}</h${depth}>`;
      }
      case 'emphasis': return `<em${id(node)}>${children()}</em>`;
      case 'strong': return `<strong${id(node)}>${children()}</strong>`;
      case 'delete': return `<del${id(node)}>${children()}</del>`;
      case 'subscript': return `<sub${id(node)}>${children()}</sub>`;
      case 'superscript': return `<sup${id(node)}>${children()}</sup>`;
      case 'inlineCode': return `<code${id(node)}>${escapeHtml(value)}</code>`;
      case 'code': return `<pre${id(node)}><code>${escapeHtml(value)}</code></pre>`;
      case 'break': return `<br${id(node)}>`;
      case 'thematicBreak': return `<hr${id(node)}>`;
      case 'blockquote': return `<blockquote${id(node)}>${children()}</blockquote>`;
      case 'list': {
        const tag = node.ordered === true ? 'ol' : 'ul';
        const start = tag === 'ol' && typeof node.start === 'number' && Number.isSafeInteger(node.start) ? ` start="${node.start}"` : '';
        return `<${tag}${id(node)}${start}>${children()}</${tag}>`;
      }
      case 'listItem': return `<li${id(node)}>${typeof node.checked === 'boolean' ? `<span class="notice">[${node.checked ? 'Completed' : 'Not completed'}] </span>` : ''}${children()}</li>`;
      case 'definitionList': return `<dl${id(node)}>${children()}</dl>`;
      case 'definitionTerm': return `<dt${id(node)}>${children()}</dt>`;
      case 'definitionDescription': return `<dd${id(node)}>${children()}</dd>`;
      case 'link': {
        let url = text(node, 'url');
        if (url.startsWith('#')) {
          let fragment: string;
          try { fragment = decodeURIComponent(url.slice(1)); }
          catch { fragment = url.slice(1); }
          const target = normalizeMystIdentifier(fragment);
          if (document.references[target]) url = `#${anchor(target)}`;
          else { notices.add(`Unresolved local link: ${url}`); return `<span${id(node)}>${children()} [unresolved]</span>`; }
        }
        const content = link(url, children());
        return id(node) ? `<span${id(node)}>${content}</span>` : content;
      }
      case 'image': {
        const url = text(node, 'url');
        const alt = text(node, 'alt') || 'Image asset';
        notices.add('Images are linked rather than fetched or embedded. Local assets remain in the original source.');
        return `<span class="notice"${id(node)}>${link(url, escapeHtml(alt))} (image not embedded)</span>`;
      }
      case 'inlineMath': return id(node) ? `<span${id(node)}>${math(value, false)}</span>` : math(value, false);
      case 'math': return `<div class="equation"${id(node)}>${math(value, true)}${label(node) ? `<span>${escapeHtml(label(node))}</span>` : ''}</div>`;
      case 'figure': case 'container': return `<figure${id(node)}>${label(node) ? `<div>${escapeHtml(label(node))}</div>` : ''}${children()}</figure>`;
      case 'caption': return `<figcaption${id(node)}>${children()}</figcaption>`;
      case 'admonition': return `<aside${id(node)}>${children()}</aside>`;
      case 'admonitionTitle': return `<strong${id(node)}>${children()}</strong>`;
      case 'table': return `<table${id(node)}>${label(node) ? `<caption>${escapeHtml(label(node))}</caption>` : ''}<tbody>${children()}</tbody></table>`;
      case 'tableRow': return `<tr${id(node)}>${children()}</tr>`;
      case 'tableCell': return node.header === true ? `<th scope="col"${id(node)}>${children()}</th>` : `<td${id(node)}>${children()}</td>`;
      case 'crossReference': {
        const target = text(node, 'target') || text(node, 'identifier');
        const reference = document.references[target];
        const content = children() || escapeHtml(reference?.label || target);
        if (!reference) { notices.add(`Unresolved reference: ${target}`); return `<span>${content} [unresolved]</span>`; }
        return link(`#${anchor(target)}`, content);
      }
      case 'cite': {
        const target = text(node, 'target') || text(node, 'identifier') || text(node, 'label');
        if (!document.bibliography[target]) { notices.add(`Unresolved citation: ${target}`); return `<span>[${escapeHtml(target)}: unresolved]</span>`; }
        return link(`#${anchor(`citation-${target}`)}`, `[${escapeHtml(target)}]`);
      }
      case 'citeGroup': return children();
      case 'comment': return '';
      case 'footnoteDefinition': return `<aside${id(node)}>${children()}</aside>`;
      case 'footnoteReference': return `<sup>${link(`#${anchor(text(node, 'identifier'))}`, escapeHtml(text(node, 'label') || text(node, 'identifier')))}</sup>`;
      case 'mystTarget': case 'target': return `<span${id(node)}></span>`;
      default: {
        notices.add(`Unsupported preview node: ${node.type}. Original source is preserved.`);
        return `<span class="notice"${id(node)}>[${escapeHtml(node.type)}: preview unavailable]</span>${value ? `<pre>${escapeHtml(value)}</pre>` : ''}${children()}`;
      }
    }
  };
  const body = render(document.ast);
  const title = typeof document.metadata.title === 'string' ? document.metadata.title : 'MyST publication';
  const bibliography = Object.entries(document.bibliography).map(([key, entry]) => {
    const description = [entry.author, entry.year, entry.title].filter(Boolean).join('. ') || entry.id;
    return `<li id="${escapeHtml(anchor(`citation-${key}`))}">[${escapeHtml(entry.id)}] ${entry.url ? link(entry.url, escapeHtml(description)) : escapeHtml(description)}</li>`;
  }).join('');
  const diagnostics = [...document.diagnostics.map(diagnostic => `${diagnostic.severity}: ${diagnostic.message}${diagnostic.line ? ` (line ${diagnostic.line})` : ''}`), ...notices];
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${publicationStyle}</style></head>
<body><main>${body}${bibliography ? `<section aria-label="References"><h2>References</h2><p class="notice">Authored citation metadata; not externally verified.</p><ul>${bibliography}</ul></section>` : ''}${diagnostics.length ? `<section class="diagnostics" aria-label="Publication diagnostics"><h2>Publication diagnostics</h2><ul>${diagnostics.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul></section>` : ''}<details class="source"><summary>Original MyST source</summary><pre>${escapeHtml(document.source)}</pre></details></main></body></html>`;
}
