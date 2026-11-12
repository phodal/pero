import { mystNodeText } from './myst-numbering.ts';
import { projectRecordedCell } from './ipynb-recorded.ts';
import type { MystNode, MystDiagnostic, MystDocument } from './myst.ts';
import type { MystProjectEntry } from './myst-project.ts';
import type { MystPublicationAsset, MystPublicationInput } from './myst-publication.ts';
import { type IpynbCell } from './ipynb.ts';
import { ipynbCellVisibility } from './ipynb-visibility.ts';
/** Derived publication only. Exact notebook recovery is mandatory, never fabricated MyST source. */
export function compiledMystEntryPublication(entry: MystProjectEntry, suppliedAssets: readonly MystPublicationAsset[] = []): MystPublicationInput {
  if (entry.kind === 'invalid') throw new Error('Invalid notebook entry cannot be published; recover its original source first.');
  if (entry.kind === 'myst') return { document: entry.document, assets: suppliedAssets };
  const assets = [...suppliedAssets]; const paths = new Set(assets.map(asset => asset.path));
  const assignedImages = new Map<IpynbCell['images'][number]['image'], string>();
  const children: MystNode[] = []; const diagnostics: MystDiagnostic[] = [];
  const references: MystDocument['references'] = Object.create(null); const bibliography: MystDocument['bibliography'] = Object.create(null);
  const report = (message: string) => diagnostics.push({ severity: 'warning', code: 'notebook-publication', message, path: entry.path });
  report('Derived notebook publication. Full original notebook.ipynb recovery includes IDs, metadata, attachments and MIME bundles, including content omitted by remove/hide tags.');
  const paragraph = (value: string): MystNode => ({ type: 'paragraph', children: [{ type: 'text', value }] });
  const bounded = (value: string) => { if (value.length > 65536) report('Publication text truncated at 65536 characters; complete value retained in notebook.ipynb.'); return value.slice(0, 65536); };
  const literal = (value: string): MystNode => ({ type: 'code', lang: '', value: bounded(value) });
  const addImage = (cell: IpynbCell, location: string, mediaType?: string): MystNode | undefined => {
    const admitted = cell.images.find(item => item.location === location && (!mediaType || item.image.mediaType === mediaType));
    if (!admitted?.image.renderable) return;
    let path = assignedImages.get(admitted.image);
    if (!path) {
      let index = assets.length + 1;
      do { path = `notebook-assets/image-${index++}.${admitted.image.mediaType === 'image/png' ? 'png' : 'jpg'}`; } while (paths.has(path));
      paths.add(path); assignedImages.set(admitted.image, path);
      assets.push({ path, mediaType: admitted.image.mediaType, base64: admitted.image.base64 });
    }
    return { type: 'image', url: path, alt: `Cell ${cell.index + 1}: ${location}` };
  };
  let titleConsidered = false;
  // Only the leading heading of the first published compiled cell can own the
  // notebook title. Move it before generated cell headings, without dropping a
  // legitimate later heading that happens to have the same text.
  const appendCompiled = (nodes: MystNode[]) => {
    if (!titleConsidered) {
      titleConsidered = true;
      const first = nodes.find(node => !['comment', 'mystTarget'].includes(node.type) && !(node.type === 'text' && !node.value));
      if (first?.type === 'heading' && first.depth === 1 && mystNodeText(first) === entry.scholarly.title) {
        children.unshift(first);
        children.push(...nodes.filter(node => node !== first));
        return;
      }
    }
    children.push(...nodes);
  };
  for (const cell of entry.document.cells) {
    const visible = ipynbCellVisibility(cell); visible.notices.forEach(report); if (!visible.cell) continue;
    children.push({ type: 'heading', depth: 2, children: [{ type: 'text', value: `Cell ${cell.index + 1}: ${cell.kind}` }] });
    if (cell.kind === 'markdown') {
      const compiled = entry.markdownCells.find(item => item.index === cell.index);
      if (!compiled) throw new Error(`Compiled Markdown cell ${cell.index + 1} is unavailable`);
      const ast = structuredClone(compiled.document.ast);
      const scope = `${entry.path}:cell-${cell.index}:`;
      const visit = (node: MystNode): MystNode => {
        if (node.type !== 'cite' && node.type !== 'citeGroup' && typeof node.identifier === 'string') node.identifier = scope + node.identifier;
        if (node.type === 'image' && typeof node.url === 'string' && node.url.startsWith('attachment:')) {
          const image = addImage(cell, `Attachment ${node.url.slice('attachment:'.length)}`);
          if (image) return { ...node, ...image };
          report(`Cell ${cell.index + 1}: attachment ${node.url} is retained but not rendered.`);
        }
        if (node.children) node.children = node.children.map(visit);
        return node;
      };
      appendCompiled(visit(ast).children ?? []);
      for (const [id, target] of Object.entries(compiled.document.references)) references[scope + id] = { ...target, identifier: scope + target.identifier };
      Object.assign(bibliography, compiled.document.bibliography); diagnostics.push(...compiled.document.diagnostics);
      if (cell.raw.attachments) report(`Cell ${cell.index + 1}: complete attachment bundles remain in notebook.ipynb; only referenced supported raster images are embedded.`);
    } else if (cell.kind === 'code') {
      const compiled = entry.codeCells?.find(item => item.index === cell.index);
      const recorded = projectRecordedCell(cell);
      if (compiled) {
        const scope = `${entry.path}:cell-${cell.index}:`;
        const visit = (node: MystNode): MystNode => ({ ...node, ...(typeof node.identifier === 'string' ? { identifier: scope + node.identifier } : {}), ...(node.children ? { children: node.children.map(visit) } : {}) });
        appendCompiled(visit(structuredClone(compiled.document.ast)).children ?? []);
        for (const [id, target] of Object.entries(compiled.document.references)) references[scope + id] = { ...target, identifier: scope + target.identifier };
        diagnostics.push(...compiled.document.diagnostics);
      } else { children.push(...recorded.children); recorded.notices.forEach(report); }
    } else if (visible.input) children.push(paragraph('Raw cell, shown as literal text.'), literal(cell.source));
  }
  return { document: { ast: { type: 'root', children }, scholarly: entry.scholarly, references, bibliography, diagnostics, ...(entry.citationRendering ? { citationRendering: entry.citationRendering } : {}) }, recovery: { kind: 'ipynb', filename: 'notebook.ipynb', source: entry.document.source }, assets };
}
