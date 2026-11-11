import { mystProofHeading } from './myst-proof.ts';
import { exportMystBundle, type MystDocument, type MystNode } from './myst.ts';
export type MystPublicationKind = 'docx' | 'latex' | 'typst';
export interface MystPublicationAsset { path: string; mediaType: string; base64: string }
export type MystPublicationDocument = Pick<MystDocument, 'ast' | 'scholarly' | 'references' | 'bibliography' | 'diagnostics' | 'citationRendering'>;
export interface MystNotebookRecovery { kind: 'ipynb'; filename: 'notebook.ipynb'; source: string }
export type MystPublicationInput = ({ document: MystDocument; recovery?: undefined } | { document: MystPublicationDocument; recovery: MystNotebookRecovery }) & { assets?: readonly MystPublicationAsset[]; assetMode?: 'archive' };
export function mystPublicationRecovery(input: MystPublicationInput): { filename: string; content: string; record: string } {
  if (input.recovery) return { filename: input.recovery.filename, content: input.recovery.source, record: JSON.stringify({ format: 'ipynb', source: input.recovery.source }, null, 2) + '\n' };
  const record = exportMystBundle(input.document);
  return { filename: 'source.json', content: record, record };
}
const plain = (value: string): MystNode => ({ type: 'text', value });
const paragraph = (value: string): MystNode => ({ type: 'paragraph', children: [plain(value)] });
const commands = new Set('frac dfrac tfrac sqrt sum prod int iint iiint lim sin cos tan log ln exp min max left right cdot times div pm mp le leq ge geq neq approx equiv in notin subset supset subseteq supseteq cup cap emptyset infinity infty alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega mathrm mathit mathbf mathsf mathtt mathcal mathbb operatorname text overline underline hat bar vec dot ddot quad qquad displaystyle limits nolimits'.split(' '));
/** No templates or authored macros. TeX ^^ preprocessing must not escape the whitelist. */
export function inertPublicationMath(value: string): boolean {
  return !value.includes('^^') && !/[\u0000-\u001f%#]/.test(value.replaceAll('\n', '')) && [...value.matchAll(/\\([A-Za-z]+|[^A-Za-z])/g)].every(m => commands.has(m[1]) || /^[,;! {}|]$/.test(m[1]));
}
export const MYST_PUBLICATION_IMAGE_MAX_PLACEMENTS = 128;
export const MYST_PUBLICATION_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
/** Counts decoded payload bytes per placement, since DOCX repeats media per ImageRun. */
export function boundMystPublicationImages(input: MystPublicationInput): MystPublicationInput {
  const assets = new Map((input.assets ?? []).map(a => [a.path, a]));
  let placements = 0, bytes = 0, omitted = 0;
  const visit = (node: MystNode): MystNode => {
    const asset = node.type === 'image' && typeof node.url === 'string' ? assets.get(node.url) : undefined;
    if (asset && ['image/png', 'image/jpeg'].includes(asset.mediaType)) {
      const size = Math.floor(asset.base64.length * 3 / 4) - (asset.base64.endsWith('==') ? 2 : asset.base64.endsWith('=') ? 1 : 0);
      if (placements >= MYST_PUBLICATION_IMAGE_MAX_PLACEMENTS || size > MYST_PUBLICATION_IMAGE_MAX_BYTES - bytes) {
        omitted++;
        return { type: 'image', url: '', alt: `[Image omitted: publication image budget exceeded; ${typeof node.alt === 'string' ? node.alt : asset.path}]` };
      }
      placements++; bytes += size;
    }
    return { ...node, ...(node.children ? { children: node.children.map(visit) } : {}) };
  };
  const ast = visit(input.document.ast), diagnostics = [...input.document.diagnostics];
  if (omitted) diagnostics.push({ severity: 'warning', code: 'publication-image-budget', message: `${omitted} image placement(s) omitted: publication allows at most 128 placements and 16777216 decoded image bytes counted per placement. Exact original source is retained.` });
  if (input.recovery) return { ...input, document: { ...input.document, ast, diagnostics } };
  return { ...input, document: { ...input.document, ast, diagnostics } };
}
/** Only inert, allowlisted node fields reach conversion SDKs. */
export function projectMystPublication(input: MystPublicationInput, kind: MystPublicationKind): { ast: MystNode; losses: string[] } {
  input = boundMystPublicationImages(input);
  const { document } = input, assets = new Map((input.assets ?? []).map(a => [a.path, a]));
  const losses = new Set(document.diagnostics.map(d => `${d.code}: ${d.message}`));
  const read = (n: MystNode, key: string) => typeof n[key] === 'string' ? n[key] as string : '';
  const visit = (node: MystNode): MystNode => {
    const formatted = typeof node.citationId === 'string' ? document.citationRendering?.citations[node.citationId] : undefined;
    if (formatted && (node.type === 'cite' || node.type === 'citeGroup')) { losses.add('CSL text preserved; rich styling and editable citation fields are not.'); return plain(formatted.text); }
    const children = () => (node.children ?? []).map(visit);
    const fallback = (reason: string, value?: string) => { losses.add(reason); return paragraph(value ?? `[${reason}]`); };
    if (node.projectTarget) losses.add('Cross-document reference exported as display text; other project pages are not included in this entry-only publication.');
    switch (node.type) {
      case 'root': case 'paragraph': case 'strong': case 'emphasis': case 'subscript': case 'superscript': case 'delete': case 'blockquote': case 'listItem': case 'definitionList': case 'definitionTerm': case 'definitionDescription': return { type: node.type, children: children() };
      case 'block': return { type: 'root', children: children() };
      case 'text': return plain(node.value ?? '');
      case 'heading': return { type: 'heading', depth: Math.max(1, Math.min(6, Number(node.depth) || 1)), children: children() };
      case 'break': case 'thematicBreak': return { type: node.type };
      case 'inlineCode': return { type: node.type, value: node.value ?? '' };
      case 'code': return kind === 'latex' ? fallback('Code exported as escaped prose in LaTeX (no verbatim command boundary).', node.value ?? '') : { type: 'code', value: node.value ?? '', lang: /^[A-Za-z0-9_-]+$/.test(read(node, 'lang')) ? read(node, 'lang') : '' };
      case 'math': case 'inlineMath':
        if (kind !== 'docx' && !inertPublicationMath(node.value ?? '')) { losses.add('Unsupported math commands retained as literal text.'); return node.type === 'inlineMath' ? plain(node.value ?? '') : paragraph(node.value ?? ''); }
        return { type: node.type, value: node.value ?? '' };
      case 'list': return { type: 'list', ordered: !!node.ordered, start: Number.isSafeInteger(node.start) && Number(node.start) > 0 ? node.start : 1, children: children() };
      case 'table': case 'tableRow': return { type: node.type, children: children() };
      case 'tableCell': return { type: node.type, header: !!node.header, children: children() };
      case 'figure': case 'container': losses.add('Figure/table numbering rendered as text, not an editable field.'); return { type: 'root', children: [...(document.references[read(node, 'identifier')] ? [paragraph(document.references[read(node, 'identifier')].label)] : []), ...children()] };
      case 'caption': case 'admonitionTitle': return { type: 'paragraph', children: children() };
      case 'proof': losses.add('Proof presentation converted to quotation; numbering is visible text, not an editable field.'); return { type: 'blockquote', children: [{ type: 'paragraph', children: [visit(mystProofHeading(node))] }, ...(node.children ?? []).filter(child => child.type !== 'admonitionTitle').map(visit)] };
      case 'admonition': losses.add('Admonition presentation converted to a quotation.'); return { type: 'blockquote', children: children() };
      case 'image': {
        const url = read(node, 'url'), asset = assets.get(url);
        if (asset && ['image/png', 'image/jpeg'].includes(asset.mediaType) && (kind === 'docx' || (input.assetMode === 'archive' && /^assets\/image-[0-9]+\.(png|jpg)$/.test(url)))) return { type: 'image', url, alt: read(node, 'alt') };
        return fallback(`Image not embedded in ${kind}: ${url}`, `[Image: ${read(node, 'alt') || url}]`);
      }
      case 'link': losses.add('Hyperlinks exported as visible text and URL, not active links.'); return { type: 'strong', children: [...children(), plain(` (${read(node, 'url')})`)] };
      case 'crossReference': {
        losses.add('Cross references exported as resolved text, not editable fields.');
        const target = node.projectTarget;
        return plain(target && typeof target === 'object' && 'label' in target && typeof target.label === 'string' ? target.label : document.references[read(node, 'identifier')]?.label ?? `[Unresolved reference: ${read(node, 'identifier')}]`);
      }
      case 'cite': { const ref = document.bibliography[read(node, 'identifier')]; losses.add('Citations use authored author/year text when no CSL rendering is supplied.'); return plain(ref ? `[${[ref.author, ref.year].filter(Boolean).join(', ') || ref.id}]` : `[Unresolved citation: ${read(node, 'identifier')}]`); }
      case 'citeGroup': return { type: 'strong', children: children() };
      case 'comment': case 'mystTarget': return plain('');
      case 'footnoteReference': losses.add('Footnotes exported as labelled text, not editable fields.'); return plain(`[${read(node, 'identifier')}]`);
      case 'footnoteDefinition': return { type: 'blockquote', children: [paragraph(`[${read(node, 'identifier')}]`), ...children()] };
      default: return fallback(`Unsupported ${kind} node: ${node.type}; original source retained.`, node.value);
    }
  };
  const ast = visit(document.ast);
  const flatten = (n: MystNode) => { n.children?.forEach(flatten); if (n.children) n.children = n.children.flatMap(c => c.type === 'root' ? c.children ?? [] : [c]); };
  flatten(ast); ast.children ??= [];
  const text = (n: MystNode): string => n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(text).join('');
  if (document.scholarly.title && !(ast.children[0]?.type === 'heading' && text(ast.children[0]) === document.scholarly.title)) ast.children.unshift({ type: 'heading', depth: 1, children: [plain(document.scholarly.title)] });
  const metadata = [document.scholarly.authors?.map(a => a.name).join(', '), document.scholarly.doi ? `DOI: ${document.scholarly.doi}` : ''].filter(Boolean).join('\n');
  if (metadata) ast.children.splice(document.scholarly.title ? 1 : 0, 0, paragraph(metadata));
  const refs = document.citationRendering?.bibliography.map(r => r.text) ?? Object.values(document.bibliography).map(r => [r.id, r.author, r.year, r.title, r.url].filter(Boolean).join('. '));
  if (refs.length) ast.children.push({ type: 'heading', depth: 1, children: [plain('References')] }, ...refs.map(paragraph));
  losses.add('Full frontmatter and exact source retained in source record; only title, author names and DOI projected into document metadata.');
  return { ast, losses: [...losses] };
}
