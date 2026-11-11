import type { MystNode, MystDiagnostic, MystDocument } from './myst.ts';
import type { MystProjectEntry } from './myst-project.ts';
import type { MystPublicationAsset, MystPublicationInput } from './myst-publication.ts';
import { ipynbText, type IpynbCell } from './ipynb.ts';
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
      children.push(...(visit(ast).children ?? []));
      for (const [id, target] of Object.entries(compiled.document.references)) references[scope + id] = { ...target, identifier: scope + target.identifier };
      Object.assign(bibliography, compiled.document.bibliography); diagnostics.push(...compiled.document.diagnostics);
      if (cell.raw.attachments) report(`Cell ${cell.index + 1}: complete attachment bundles remain in notebook.ipynb; only referenced supported raster images are embedded.`);
    } else if (visible.input) children.push(paragraph(cell.kind === 'code' ? 'Inert code input. Never executed here.' : 'Raw cell, shown as literal text.'), literal(cell.source));
    if (cell.kind !== 'code' || !visible.output) continue;
    children.push(paragraph(cell.stale ? 'Stale recorded outputs: code was edited, outputs were not re-executed.' : 'Recorded outputs only; execution and freshness are unverified.'));
    if (cell.outputs.length > 128) report(`Cell ${cell.index + 1}: only the first 128 outputs are published; all retained in notebook.ipynb.`);
    cell.outputs.slice(0, 128).forEach((output, index) => {
      const label = `Cell ${cell.index + 1}, recorded output ${index + 1}`;
      if (output.output_type === 'stream') {
        if (output.name === 'stdout' && !visible.stdout || output.name === 'stderr' && !visible.stderr) return;
        children.push(paragraph(label), literal(ipynbText(output.text) ?? '[Unsupported stream text retained]')); return;
      }
      if (output.output_type === 'error') { children.push(paragraph(label), literal(`${String(output.ename ?? '')}: ${String(output.evalue ?? '')}\n${ipynbText(output.traceback) ?? ''}`)); return; }
      const data = output.data && typeof output.data === 'object' && !Array.isArray(output.data) ? output.data : {};
      let selected: string | undefined; let node: MystNode | undefined;
      for (const mime of ['image/png', 'image/jpeg']) { node = addImage(cell, `Output ${index + 1}`, mime); if (node) { selected = mime; break; } }
      if (!node) for (const mime of ['text/latex', 'text/plain']) {
        const text = ipynbText(data[mime]); if (text === undefined) continue;
        selected = mime;
        if (mime === 'text/latex' && text.length <= 16384) node = { type: 'math', value: text.replace(/^\$\$|\$\$$/g, '') };
        else { node = literal(text); if (mime === 'text/latex') report(`${label}: oversized LaTeX shown as literal text.`); }
        break;
      }
      children.push(paragraph(label), node ?? paragraph('Unsupported recorded output retained in notebook.ipynb.'));
      for (const mime of Object.keys(data)) if (mime !== selected) report(`${label}: ${mime} is retained in notebook.ipynb, not rendered in this publication.`);
      if (!node) report(`${label}: unsupported output retained without execution.`);
    });
  }
  return { document: { ast: { type: 'root', children }, scholarly: entry.scholarly, references, bibliography, diagnostics, ...(entry.citationRendering ? { citationRendering: entry.citationRendering } : {}) }, recovery: { kind: 'ipynb', filename: 'notebook.ipynb', source: entry.document.source }, assets };
}
