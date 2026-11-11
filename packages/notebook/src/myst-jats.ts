import { boundMystPublicationImages, inertPublicationMath, mystPublicationRecovery, type MystPublicationInput } from './myst-publication.ts';
import type { MystDocument, MystNode } from './myst.ts';
/** JATS Archiving 1.3. No external DTD, resource lookup or executable node handlers. */
export function exportMystJatsResult(input: MystPublicationInput, packagedImages: ReadonlySet<string> = new Set()): { xml: string; losses: string[] } {
  input = boundMystPublicationImages(input);
  const document = input.document, losses = new Set(document.diagnostics.map(d => `${d.code}: ${d.message}`));
  const footnotes: string[] = [];
  losses.add('JATS metadata projects title, author names and DOI; other authored fields are retained in source, not native JATS metadata.');
  const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, () => { losses.add('XML-incompatible controls replaced; exact source retained.'); return '\ufffd'; }).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
  const str = (n: MystNode, k: string) => typeof n[k] === 'string' ? n[k] as string : '';
  const key = (s: string) => 'myst-' + Array.from(s, c => c.codePointAt(0)!.toString(16)).join('-');
  const id = (n: MystNode) => str(n, 'identifier') ? ` id="${key(str(n, 'identifier'))}"` : '';
  const text = (n: MystNode): string => n.value ?? (n.children ?? []).map(text).join('');
  const blocks = (nodes: MystNode[]): string => {
    let out = ''; const levels: number[] = [];
    for (const node of nodes) {
      if (node.type === 'heading') { const depth = Number(node.depth) || 1; while (levels.length && levels.at(-1)! >= depth) { out += '</sec>'; levels.pop(); } out += `<sec${id(node)}><title>${children(node, true)}</title>`; levels.push(depth); }
      else out += render(node);
    }
    return out + '</sec>'.repeat(levels.length);
  };
  const children = (n: MystNode, inline = false): string => (n.children ?? []).map(c => render(c, inline)).join('');
  const render = (n: MystNode, inline = false): string => {
    const formatted = typeof n.citationId === 'string' ? document.citationRendering?.citations[n.citationId] : undefined;
    if (formatted && ['cite', 'citeGroup'].includes(n.type)) { losses.add('CSL text retained without rich styling or citation fields.'); return xml(formatted.text); }
    switch (n.type) {
      case 'root': case 'block': return blocks(n.children ?? []);
      case 'text': return xml(n.value ?? '');
      case 'paragraph': return `<p${id(n)}>${children(n, true)}</p>`;
      case 'strong': return `<bold>${children(n, true)}</bold>`;
      case 'emphasis': return `<italic>${children(n, true)}</italic>`;
      case 'subscript': return `<sub>${children(n, true)}</sub>`;
      case 'superscript': return `<sup>${children(n, true)}</sup>`;
      case 'delete': return `<strike>${children(n, true)}</strike>`;
      case 'inlineCode': return `<monospace>${xml(n.value ?? '')}</monospace>`;
      case 'code': return `<preformat preformat-type="code">${xml(n.value ?? '')}</preformat>`;
      case 'break': return '<break/>';
      case 'thematicBreak': losses.add('Thematic break converted to text.'); return '<p>***</p>';
      case 'math': case 'inlineMath': {
        const value = n.value ?? '';
        if (!inertPublicationMath(value)) { losses.add('Unsupported math commands retained as literal text.'); return n.type === 'inlineMath' ? `<monospace>${xml(value)}</monospace>` : `<p><monospace>${xml(value)}</monospace></p>`; }
        const tag = n.type === 'math' ? 'disp-formula' : 'inline-formula'; return `<${tag}${id(n)}><tex-math>${xml(value)}</tex-math></${tag}>`;
      }
      case 'list': return `<list list-type="${n.ordered ? 'order' : 'bullet'}">${children(n)}</list>`;
      case 'listItem': return `<list-item>${children(n)}</list-item>`;
      case 'blockquote': case 'admonition': if (n.type === 'admonition') losses.add('Admonition presentation converted to quotation.'); return `<disp-quote>${children(n)}</disp-quote>`;
      case 'admonitionTitle': case 'caption': return `<p>${children(n, true)}</p>`;
      case 'figure': case 'container': return `<fig${id(n)}>${(n.children ?? []).some(c => c.type === 'caption') ? `<caption>${(n.children ?? []).filter(c => c.type === 'caption').map(c => render(c)).join('')}</caption>` : ''}${(n.children ?? []).filter(c => c.type !== 'caption').map(c => render(c)).join('')}</fig>`;
      case 'table': return `<table-wrap${id(n)}><table><tbody>${children(n)}</tbody></table></table-wrap>`;
      case 'tableRow': return `<tr>${children(n)}</tr>`;
      case 'tableCell': return `<${n.header ? 'th' : 'td'}>${children(n, true)}</${n.header ? 'th' : 'td'}>`;
      case 'image':
        if (packagedImages.has(str(n, 'url')) && /^assets\/image-[0-9]+\.(png|jpg)$/.test(str(n, 'url'))) return `<graphic${id(n)} xlink:href="${xml(str(n, 'url'))}"><alt-text>${xml(str(n, 'alt'))}</alt-text></graphic>`;
        losses.add(`Image not embedded in JATS: ${str(n, 'url')}`);
        return inline ? `<named-content content-type="missing-image">${xml(str(n, 'alt') || str(n, 'url'))}</named-content>` : `<p>Image not embedded: ${xml(str(n, 'alt') || str(n, 'url'))}</p>`;
      case 'link': losses.add('Links exported as visible text and URL.'); return `${children(n, true)} (${xml(str(n, 'url'))})`;
      case 'crossReference': { const t = n.projectTarget; if (t) losses.add('Cross-document reference is display text; other pages absent from entry-only publication.'); const label = t && typeof t === 'object' && 'label' in t && typeof t.label === 'string' ? t.label : document.references[str(n, 'identifier')]?.label; return xml(label ?? `[Unresolved reference: ${str(n, 'identifier')}]`); }
      case 'cite': { const r = document.bibliography[str(n, 'identifier')]; return r ? `<xref ref-type="bibr" rid="${key(r.id)}">${xml([r.author, r.year].filter(Boolean).join(', ') || r.id)}</xref>` : xml(`[Unresolved citation: ${str(n, 'identifier')}]`); }
      case 'citeGroup': return children(n, true);
      case 'mystTarget': return '';
      case 'footnoteReference': return `<xref ref-type="fn" rid="${key(str(n, 'identifier'))}">${xml(str(n, 'identifier'))}</xref>`;
      case 'footnoteDefinition': footnotes.push(`<fn${id(n)}>${children(n)}</fn>`); return '';
      case 'definitionList': { let out = ''; const list = n.children ?? []; for (let i = 0; i < list.length; i += 2) out += `<def-item><term>${xml(text(list[i]))}</term><def><p>${list[i + 1] ? xml(text(list[i + 1])) : ''}</p></def></def-item>`; return `<def-list>${out}</def-list>`; }
      default: losses.add(`Unsupported JATS node: ${n.type}; original source retained.`); return inline ? xml(`[${n.type}: ${text(n)}]`) : `<p>${xml(`[${n.type}: ${text(n)}]`)}</p>`;
    }
  };
  let nodes = document.ast.children ?? [];
  if (document.scholarly.title && nodes[0]?.type === 'heading' && text(nodes[0]) === document.scholarly.title) nodes = nodes.slice(1);
  const body = blocks(nodes);
  const refs = document.citationRendering?.bibliography ?? Object.values(document.bibliography).map(r => ({ id: r.id, text: [r.author, r.year, r.title, r.url].filter(Boolean).join('. ') }));
  const back = (footnotes.length ? `<fn-group>${footnotes.join('')}</fn-group>` : '') + (refs.length ? `<ref-list><title>References</title>${refs.map(r => `<ref id="${key(r.id)}"><mixed-citation>${xml(r.text)}</mixed-citation></ref>`).join('')}</ref-list>` : '');
  const meta = `${document.scholarly.doi ? `<article-id pub-id-type="doi">${xml(document.scholarly.doi)}</article-id>` : ''}<title-group><article-title>${xml(document.scholarly.title ?? 'Publication')}</article-title></title-group>${document.scholarly.authors?.length ? `<contrib-group>${document.scholarly.authors.map(a => `<contrib contrib-type="author"><string-name>${xml(a.name ?? '')}</string-name></contrib>`).join('')}</contrib-group>` : ''}<custom-meta-group><custom-meta><meta-name>pero-source</meta-name><meta-value>${xml(mystPublicationRecovery(input).record)}</meta-value></custom-meta><custom-meta><meta-name>pero-publication-losses</meta-name><meta-value>${xml(JSON.stringify([...losses]))}</meta-value></custom-meta></custom-meta-group>`;
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<article xmlns:xlink="http://www.w3.org/1999/xlink" dtd-version="1.3" article-type="research-article"><front><journal-meta/><article-meta>${meta}</article-meta></front><body>${body}</body>${back ? `<back>${back}</back>` : ''}</article>\n`, losses: [...losses] };
}
export function exportMystJats(document: MystDocument): string { return exportMystJatsResult({ document }).xml; }
