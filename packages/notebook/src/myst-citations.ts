import { init, decode, Style, Locale, Document, Citation, CitationGroup, Cite, type RenderedNode, type RenderedTree, type CitePurpose } from 'refkit-js/browser';
import { xml2js, type Element } from 'xml-js';
import { normalizeMystIdentifier, type MystDocument, type MystNode, type MystCitationRendering } from './myst.ts';
import type { MystBibliographyRecord } from './myst-bibliography.ts';
import type { MystTextResource } from './myst-project-snapshot.ts';

/** The shell supplies the bundled bytes. No URL or authored resource is fetched. */
export async function initializeMystCitations(wasm: BufferSource | WebAssembly.Module): Promise<void> {
  await init({ module_or_path: wasm });
}
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const string = (value: unknown): string => typeof value === 'string' ? value : '';

/** Only structured engine output is admitted; its raw HTML/URLs are never used. */
function renderNodes(nodes: RenderedTree): { text: string; html: string } {
  const render = (node: RenderedTree[number]): { text: string; html: string } => {
    if (node.kind === 'bibliography-entry') return renderNodes([...(node.label ? [node.label] : []), ...node.content]);
    if (node.kind === 'Element') return renderNodes(node.children);
    if (node.kind === 'Transparent') return { text: '', html: '' };
    const text = node.kind === 'Markup' ? node.value : node.text;
    let html = escape(text);
    if (node.kind !== 'Markup') {
      const marks = node.formatting;
      if (marks.fontStyle === 'Italic') html = `<i>${html}</i>`;
      if (marks.fontWeight === 'Bold') html = `<b>${html}</b>`;
      if (marks.textDecoration === 'Underline') html = `<u>${html}</u>`;
      if (marks.fontVariant === 'SmallCaps') html = `<span class="csl-small-caps">${html}</span>`;
      if (marks.verticalAlign === 'Sup') html = `<sup>${html}</sup>`;
      if (marks.verticalAlign === 'Sub') html = `<sub>${html}</sub>`;
    }
    return { text, html };
  };
  const result = nodes.map(render);
  return { text: result.map(item => item.text).join(''), html: result.map(item => item.html).join('') };
}

/** Derive genuine CSL formatting from admitted local records without mutating source.
 * RefKit validates XML/macro budgets; this boundary also limits document work.
 * Synchronous Wasm rendering has no hard worker deadline. See myst-citations.md. */
export function renderMystCitations(document: MystDocument, records: readonly MystBibliographyRecord[], resource?: MystTextResource, options: { namespace: string; locale?: string } = { namespace: 'document' }): MystDocument {
  let code = 'citation-formatting';
  try {
    if (records.length > 1000) throw new RangeError('Citation formatting supports at most 1000 bibliography records');
    const locale = Locale.load(options.locale ?? 'en-US');
    const style = resource ? Style.fromXml(resource.text) : Style.load('apa');
    if (resource) {
      // SDK has already validated bounded XML. Parse its root attribute rather
      // than a regex, which would miss e.g. class="n&#111;te".
      const xml = xml2js(resource.text, { compact: false }) as Element;
      const root = xml.elements?.find(element => element.type === 'element');
      if (root?.attributes?.class === 'note') {
        code = 'citation-style-unsupported';
        throw new TypeError('Note-class CSL requires numbered note placement, which this publication renderer does not support');
      }
    }
    const known = new Map(records.map(record => [normalizeMystIdentifier(record.id), record]));
    const ast = structuredClone(document.ast);
    const citations: Citation[] = [];
    const cite = (node: MystNode): Cite => {
      const key = normalizeMystIdentifier(string(node.target) || string(node.identifier) || string(node.label));
      if (!known.has(key) || !document.bibliography[key]) throw new TypeError(`Citation ${key} has no unambiguous full CSL record`);
      if (node.prefix) throw new TypeError('Arbitrary citation prefixes are not supported');
      const suffix = string(node.suffix).trim();
      let locator: string | undefined, label: string | undefined;
      if (suffix) {
        const matched = /^(pp?\.?|pages?|chapters?|ch\.?|sections?|sec\.?|volumes?|vol\.?|paragraphs?|paras?\.?|figures?|fig\.?|lines?)\s+(.+)$/i.exec(suffix);
        if (!matched) throw new TypeError(`Unsupported citation suffix: ${suffix}`);
        locator = matched[2];
        const word = matched[1].toLowerCase();
        label = /^p(?:p?\.?|ages?)$/.test(word) ? 'page' : /^ch/.test(word) ? 'chapter' : /^s/.test(word) ? 'section' : /^v/.test(word) ? 'volume' : /^para/.test(word) ? 'paragraph' : /^f/.test(word) ? 'figure' : 'line';
      }
      const partial = string(node.partial);
      if (partial && !['author', 'year'].includes(partial)) throw new TypeError(`Unsupported citation partial: ${partial}`);
      const purpose: CitePurpose = partial === 'author' ? 'author' : partial === 'year' ? 'year' : node.kind === 'narrative' ? 'prose' : 'normal';
      return new Cite(key, { locator, label, purpose });
    };
    const visit = (node: MystNode) => {
      if (node.type === 'cite' || node.type === 'citeGroup') {
        if (citations.length >= 1000) throw new RangeError('Citation formatting supports at most 1000 citation groups');
        const nodes = node.type === 'cite' ? [node] : node.children ?? [];
        if (!nodes.length || nodes.some(child => child.type !== 'cite')) throw new TypeError('Unsupported citation group structure');
        const id = `${options.namespace}:cite-${citations.length + 1}`;
        node.citationId = id;
        citations.push(new Citation(id, new CitationGroup(nodes.map(cite))));
        return; // A group is one ordered occurrence, never rendered a second time per child.
      }
      node.children?.forEach(visit);
    };
    visit(ast);
    if (!citations.length) return document;
    const items = records.filter(record => document.bibliography[normalizeMystIdentifier(record.id)]).map(record => ({ ...record.csl, id: normalizeMystIdentifier(record.id) }));
    const { library } = decode(JSON.stringify(items), { format: 'csl-json', loss: 'error', recovery: 'error' });
    const rendered = new Document(library, style, { locale }).render(citations);
    const rendering: MystCitationRendering = { engine: 'refkit-js@0.4.0', style: { path: resource?.path ?? 'bundled:apa', id: style.cslId, title: style.title }, locale: locale.code, citations: Object.create(null), bibliography: [] };
    for (const id of rendered.citationOrder) rendering.citations[id] = renderNodes(rendered.get(id).tree);
    for (const entry of rendered.bibliography.tree) {
      if (entry.kind !== 'bibliography-entry') throw new TypeError('Unsupported bibliography result structure');
      rendering.bibliography.push({ id: entry.key, ...renderNodes([entry]) });
    }
    return { ...document, ast, citationRendering: rendering };
  } catch (error) {
    return { ...document, diagnostics: [...document.diagnostics, { severity: 'warning', code, message: `${error instanceof Error ? error.message : String(error)}. Original source and unstyled citations retained; no styled output.` }] };
  }
}
