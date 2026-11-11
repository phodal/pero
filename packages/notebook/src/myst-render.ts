import { mystProofHeading } from './myst-proof.ts';
import { renderMystCitationBibliography } from './myst-citation-render.ts';
import type { MystScholarlyMetadata } from './myst-metadata.ts';
import { mystAnchor } from './myst-project-references.ts';
import { safeMystImageDataUri } from './myst-assets.ts';
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
img { max-width: 100%; height: auto; }
figure { margin: 1.5rem 0; }
.csl-small-caps { font-variant: small-caps; }
.byline { list-style: none; padding: 0; }
.publication-metadata { margin-bottom: 2rem; }
.metadata-label { font-weight: 600; }
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

export function escapeMystHtml(value: string): string {
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
export interface MystHtmlOptions { namespace?: string; fragment?: boolean; metadata?: boolean; bibliography?: boolean }
export function renderMystHtml(document: MystDocument, options: MystHtmlOptions = {}): string {
  const notices = new Set<string>();
  const text = (node: MystNode, key: string) => typeof node[key] === 'string' ? node[key] as string : '';
  const anchor = (identifier: string) => mystAnchor(identifier, options.namespace);
  const id = (node: MystNode) => {
    const identifier = text(node, 'identifier');
    return identifier ? ` id="${escapeMystHtml(anchor(identifier))}"` : '';
  };
  const label = (node: MystNode) => text(node, 'numberingLabel');
  const link = (url: string, content: string) => {
    const href = safeHref(url);
    if (!href) { notices.add(`Link not activated: ${url}`); return content; }
    return `<a href="${escapeMystHtml(href)}" rel="noopener noreferrer">${content}</a>`;
  };
  const render = (node: MystNode): string => {
    const children = () => (node.children ?? []).map(render).join('');
    const value = text(node, 'value');
    switch (node.type) {
      case 'root': case 'block': return id(node) ? `<div${id(node)}>${children()}</div>` : children();
      case 'text': return id(node) ? `<span${id(node)}>${escapeMystHtml(value)}</span>` : escapeMystHtml(value);
      case 'paragraph': return `<p${id(node)}>${children()}</p>`;
      case 'heading': {
        const depth = typeof node.depth === 'number' && Number.isInteger(node.depth) && node.depth >= 1 && node.depth <= 6 ? node.depth : 2;
        return `<h${depth}${id(node)}>${text(node, 'enumerator') ? `${escapeMystHtml(text(node, 'enumerator'))} ` : ''}${children()}</h${depth}>`;
      }
      case 'emphasis': return `<em${id(node)}>${children()}</em>`;
      case 'strong': return `<strong${id(node)}>${children()}</strong>`;
      case 'delete': return `<del${id(node)}>${children()}</del>`;
      case 'subscript': return `<sub${id(node)}>${children()}</sub>`;
      case 'superscript': return `<sup${id(node)}>${children()}</sup>`;
      case 'inlineCode': return `<code${id(node)}>${escapeMystHtml(value)}</code>`;
      case 'code': return `<pre${id(node)}><code>${escapeMystHtml(value)}</code></pre>`;
      case 'break': return `<br${id(node)}>`;
      case 'thematicBreak': return `<hr${id(node)}>`;
      case 'blockquote': return `<blockquote${id(node)}>${children()}</blockquote>`;
      case 'list': {
        const tag = node.ordered === true ? 'ol' : 'ul';
        const start = tag === 'ol' && typeof node.start === 'number' && Number.isSafeInteger(node.start) ? ` start="${node.start}"` : '';
        return `<${tag}${id(node)}${start}>${children()}</${tag}>`;
      }
      case 'listItem': return `<li${id(node)}>${typeof node.checked === 'boolean' ? `<span class="notice">[${node.checked ? 'Completed' : 'Not completed'}] </span>` : ''}${children()}</li>`;
      case 'glossary': return `<section${id(node)}>${children()}</section>`;
      case 'abbreviation': return text(node, 'title') ? `<abbr${id(node)} title="${escapeMystHtml(text(node, 'title'))}">${children()}</abbr>` : children();
      case 'definitionList': return `<dl${id(node)}>${children()}</dl>`;
      case 'definitionTerm': return `<dt${id(node)}>${children()}</dt>`;
      case 'definitionDescription': return `<dd${id(node)}>${children()}</dd>`;
      case 'link': {
        if (node.projectTarget) return link(`#${mystAnchor(node.projectTarget.identifier, node.projectTarget.path)}`, children() || escapeMystHtml(node.projectTarget.label));
        if (node.resolved === false) return `<span>${children()} [unresolved]</span>`;
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
        const embedded = node.imageData && safeMystImageDataUri(node.imageData);
        if (embedded) return `<img${id(node)} src="${embedded}" alt="${escapeMystHtml(text(node, 'alt'))}" width="${node.imageData!.width}" height="${node.imageData!.height}">`;
        const url = text(node, 'url');
        const alt = text(node, 'alt') || 'Image asset';
        notices.add('Images are linked rather than fetched or embedded. Local assets remain in the original source.');
        return `<span class="notice"${id(node)}>${link(url, escapeMystHtml(alt))} (image not embedded)</span>`;
      }
      case 'inlineMath': return id(node) ? `<span${id(node)}>${math(value, false)}</span>` : math(value, false);
      case 'math': return `<div class="equation"${id(node)}>${math(value, true)}${label(node) ? `<span>${escapeMystHtml(label(node))}</span>` : ''}</div>`;
      case 'figure': case 'container': return `<figure${id(node)}>${label(node) ? `<div>${escapeMystHtml(label(node))}</div>` : ''}${children()}</figure>`;
      case 'caption': return `<figcaption${id(node)}>${children()}</figcaption>`;
      case 'proof': return `<aside${id(node)}><p>${render(mystProofHeading(node))}</p>${(node.children ?? []).filter(child => child.type !== 'admonitionTitle').map(render).join('')}</aside>`;
      case 'admonition': return `<aside${id(node)}>${children()}</aside>`;
      case 'admonitionTitle': return `<strong${id(node)}>${children()}</strong>`;
      case 'table': return `<table${id(node)}>${label(node) ? `<caption>${escapeMystHtml(label(node))}</caption>` : ''}<tbody>${children()}</tbody></table>`;
      case 'tableRow': return `<tr${id(node)}>${children()}</tr>`;
      case 'tableCell': return node.header === true ? `<th scope="col"${id(node)}>${children()}</th>` : `<td${id(node)}>${children()}</td>`;
      case 'crossReference': {
        if (node.projectTarget) return link(`#${mystAnchor(node.projectTarget.identifier, node.projectTarget.path)}`, children() || escapeMystHtml(node.projectTarget.label));
        if (node.resolved === false) return `<span>${children() || escapeMystHtml(text(node, 'identifier'))} [unresolved]</span>`;
        const target = text(node, 'target') || text(node, 'identifier');
        const reference = document.references[target];
        const content = children() || escapeMystHtml(reference?.label || target);
        if (!reference) { notices.add(`Unresolved reference: ${target}`); return `<span>${content} [unresolved]</span>`; }
        return link(`#${anchor(target)}`, content);
      }
      case 'cite': {
        const styled = document.citationRendering?.citations[text(node, 'citationId')];
        if (styled) return styled.html;
        const target = text(node, 'target') || text(node, 'identifier') || text(node, 'label');
        if (!document.bibliography[target]) { notices.add(`Unresolved citation: ${target}`); return `<span>[${escapeMystHtml(target)}: unresolved]</span>`; }
        return link(`#${anchor(`citation-${target}`)}`, `[${escapeMystHtml(target)}]`);
      }
      case 'citeGroup': return document.citationRendering?.citations[text(node, 'citationId')]?.html ?? children();
      case 'comment': return '';
      case 'footnoteDefinition': return `<aside${id(node)}>${children()}</aside>`;
      case 'footnoteReference': return `<sup>${link(`#${anchor(text(node, 'identifier'))}`, escapeMystHtml(text(node, 'label') || text(node, 'identifier')))}</sup>`;
      case 'mystTarget': case 'target': return `<span${id(node)}></span>`;
      default: {
        notices.add(`Unsupported preview node: ${node.type}. Original source is preserved.`);
        return `<span class="notice"${id(node)}>[${escapeMystHtml(node.type)}: preview unavailable]</span>${value ? `<pre>${escapeMystHtml(value)}</pre>` : ''}${children()}`;
      }
    }
  };
  const scholarly = document.scholarly;
  const title = scholarly.title ?? 'MyST publication';
  const plainText = (node: MystNode): string => node.value ?? (node.children ?? []).map(plainText).join('');
  const firstContent = document.ast.children?.find(node => node.type !== 'comment');
  const repeatedTitle = options.metadata !== false && scholarly.title && firstContent?.type === 'heading' && firstContent.depth === 1 && plainText(firstContent).trim() === scholarly.title.trim() ? firstContent : undefined;
  const titleHtml = repeatedTitle ? render(repeatedTitle) : scholarly.title ? `<h1>${escapeMystHtml(scholarly.title)}</h1>` : '';
  const body = render(repeatedTitle ? { ...document.ast, children: document.ast.children?.filter(node => node !== repeatedTitle) } : document.ast);
  const metadataResult = options.metadata === false ? { html: '', notices: [] } : renderMystMetadata(scholarly, options.namespace, titleHtml);
  const header = metadataResult.html;
  metadataResult.notices.forEach(notice => notices.add(notice));

  const bibliography = document.citationRendering || options.bibliography === false ? '' : Object.entries(document.bibliography).map(([key, entry]) => {
    const description = [entry.author, entry.year, entry.title].filter(Boolean).join('. ') || entry.id;
    return `<li id="${escapeMystHtml(anchor(`citation-${key}`))}">[${escapeMystHtml(entry.id)}] ${entry.url ? link(entry.url, escapeMystHtml(description)) : escapeMystHtml(description)}</li>`;
  }).join('');
  const styledBibliography = options.bibliography !== false && document.citationRendering ? renderMystCitationBibliography(document.citationRendering, options.namespace) : '';
  const diagnostics = [...document.diagnostics.map(diagnostic => `${diagnostic.severity}: ${diagnostic.message}${diagnostic.line ? ` (line ${diagnostic.line})` : ''}`), ...notices];
  const content = `${header}${body}${styledBibliography}${bibliography ? `<section aria-label="References"><h2>References</h2><p class="notice">Authored citation metadata; not externally verified.</p><ul>${bibliography}</ul></section>` : ''}${diagnostics.length ? `<section class="diagnostics" aria-label="Publication diagnostics"><h2>Publication diagnostics</h2><ul>${diagnostics.map(message => `<li>${escapeMystHtml(message)}</li>`).join('')}</ul></section>` : ''}<details class="source"><summary>Original MyST source</summary><pre>${escapeMystHtml(document.source)}</pre></details>`;
  if (options.fragment) return `<section id="${anchor('')}">${content}</section>`;
  return renderMystHtmlShell(title, content);
}
export function renderMystHtmlShell(title: string, content: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeMystHtml(title)}</title><style>${publicationStyle}</style></head>
<body><main>${content}</main></body></html>`;
}

/** Shared scholarly header for a document or one whole notebook publication. */
export function renderMystMetadata(scholarly: MystScholarlyMetadata, namespace = '', titleHtml = scholarly.title ? `<h1>${escapeMystHtml(scholarly.title)}</h1>` : ''): { html: string; notices: string[] } {
  const notices = new Set<string>();
  const anchor = (identifier: string) => mystAnchor(identifier, namespace);
  const link = (url: string, content: string) => {
    const href = safeHref(url);
    if (!href) { notices.add(`Link not activated: ${url}`); return content; }
    return `<a href="${escapeMystHtml(href)}" rel="noopener noreferrer">${content}</a>`;
  };
  const affiliations = scholarly.affiliations ?? [];
  const people = [...(scholarly.authors ?? []), ...(scholarly.contributors ?? [])];
  const personName = (person: (typeof people)[number]) => {
    if (person.name) return person.name;
    notices.add(`Contributor ${person.id ?? '(without id)'} has no display name; authored metadata is preserved.`);
    return person.id ?? 'Unnamed contributor';
  };
  const affiliationName = (affiliation: (typeof affiliations)[number]) => {
    const name = [...new Set([affiliation.name, affiliation.institution, affiliation.department, affiliation.address, affiliation.city, affiliation.state, affiliation.postal_code, affiliation.country].filter(Boolean))].join(', ');
    if (name) return name;
    notices.add(`Affiliation ${affiliation.id ?? '(without id)'} has no display details; authored metadata is preserved.`);
    return affiliation.id ?? 'Unnamed affiliation';
  };
  const affiliationLink = (identifier: string) => {
    const index = affiliations.findIndex(item => item.id === identifier);
    if (index < 0) { notices.add(`Unresolved affiliation: ${identifier}`); return escapeMystHtml(`${identifier} [unresolved]`); }
    return link(`#${namespace ? anchor(`publication-affiliation-${index + 1}`) : `publication-affiliation-${index + 1}`}`, String(index + 1));
  };
  const byline = (scholarly.authors ?? []).map(person => `<li>${escapeMystHtml(personName(person))}${person.affiliations?.length ? `<sup> ${person.affiliations.map(affiliationLink).join(', ')}</sup>` : ''}${person.orcid ? ` · ${link(`https://orcid.org/${person.orcid}`, `ORCID ${escapeMystHtml(person.orcid)}`)}` : ''}${person.corresponding ? ` · Corresponding author${person.email ? `: ${link(`mailto:${person.email}`, escapeMystHtml(person.email))}` : ''}` : ''}${person.equal_contributor ? ' · Equal contribution' : ''}${person.deceased ? ' · Deceased' : ''}${person.roles?.length ? `<div class="notice">${escapeMystHtml(person.roles.join(', '))}</div>` : ''}${person.note ? `<div class="notice">${escapeMystHtml(person.note)}</div>` : ''}</li>`).join('');
  const affiliationList = affiliations.map((item, index) => `<li id="${namespace ? anchor(`publication-affiliation-${index + 1}`) : `publication-affiliation-${index + 1}`}">${escapeMystHtml(affiliationName(item))}</li>`).join('');
  const licenses = (['content', 'code'] as const).flatMap(kind => {
    const license = scholarly.license?.[kind];
    if (!license) return [];
    const name = license.name ?? license.id ?? license.url;
    if (!name) notices.add(`${kind} license has no display name or URL; authored metadata is preserved.`);
    const content = escapeMystHtml(name ?? 'Unspecified license');
    return [`<p><span class="metadata-label">${kind === 'content' ? 'Content' : 'Code'} license:</span> ${license.url ? link(license.url, content) : content}${license.note ? ` · ${escapeMystHtml(license.note)}` : ''}</p>`];
  }).join('');
  const funding = (scholarly.funding ?? []).map(item => {
    const awards = (item.awards ?? []).map(award => {
      const sources = (award.sources ?? []).map(identifier => {
        const affiliation = affiliations.find(entry => entry.id === identifier);
        if (!affiliation) notices.add(`Unresolved funding source: ${identifier}`);
        return affiliation ? affiliationName(affiliation) : `${identifier} [unresolved]`;
      });
      const recipients = (ids: string[]) => ids.map(identifier => {
        const person = people.find(entry => entry.id === identifier);
        if (!person) notices.add(`Unresolved funding recipient or investigator: ${identifier}`);
        return person ? personName(person) : `${identifier} [unresolved]`;
      }).join(', ');
      return `<li>${escapeMystHtml([award.name, award.id].filter(Boolean).join(' · ') || 'Award')}${award.description ? `<p>${escapeMystHtml(award.description)}</p>` : ''}${sources.length ? `<p>Funder: ${escapeMystHtml(sources.join('; '))}</p>` : ''}${award.recipients?.length ? `<p>Recipients: ${escapeMystHtml(recipients(award.recipients))}</p>` : ''}${award.investigators?.length ? `<p>Investigators: ${escapeMystHtml(recipients(award.investigators))}</p>` : ''}</li>`;
    }).join('');
    return `${item.statement ? `<p>${escapeMystHtml(item.statement)}</p>` : ''}${item.open_access ? `<p>${escapeMystHtml(item.open_access)}</p>` : ''}${awards ? `<ul>${awards}</ul>` : ''}`;
  }).join('');
  const metadata = `${titleHtml}${scholarly.subtitle ? `<p>${escapeMystHtml(scholarly.subtitle)}</p>` : ''}${byline ? `<ul class="byline" aria-label="Authors">${byline}</ul>` : ''}${affiliationList ? `<ol aria-label="Affiliations">${affiliationList}</ol>` : ''}${scholarly.date ? `<p>Date: <time>${escapeMystHtml(scholarly.date)}</time></p>` : ''}${scholarly.doi ? `<p>DOI: ${link(`https://doi.org/${scholarly.doi}`, escapeMystHtml(scholarly.doi))}</p>` : ''}${licenses}${scholarly.copyright ? `<p>${escapeMystHtml(scholarly.copyright)}</p>` : ''}${scholarly.keywords?.length ? `<p>Keywords: ${escapeMystHtml(scholarly.keywords.join(', '))}</p>` : ''}${funding ? `<section aria-label="Funding"><h2>Funding</h2>${funding}</section>` : ''}`;
  const header = metadata ? `<header class="publication-metadata">${metadata}<p class="notice">Authored publication metadata; not externally verified.</p></header>` : '';
  return { html: header, notices: [...notices] };
}
