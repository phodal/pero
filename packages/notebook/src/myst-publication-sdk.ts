import { Buffer } from 'buffer';
import JSZip from 'jszip';
import { unified } from 'unified';
import { VFile } from 'vfile';
import texPlugin, { type LatexResult } from 'myst-to-tex';
import typstPlugin, { type TypstResult } from 'myst-to-typst';
import { DocxSerializer, defaultHandlers, createDocFromState, type Handler } from 'myst-to-docx';
import { Packer, Math as DocxMath, Paragraph, Table, TableRow, TableCell, WidthType } from 'docx';
import type { Root } from 'myst-spec';
import type { DocumentExportFormat, DocumentExportContent } from './scientific-block.ts';
import { nativeDocxMath } from './myst-docx-math.ts';
import { exportMystJatsResult } from './myst-jats.ts';
import { boundMystPublicationImages, projectMystPublication, mystPublicationRecovery, type MystPublicationInput } from './myst-publication.ts';
const epoch = new Date('1980-01-01T00:00:00.000Z');
const texComment = (s: string) => s.split('\n').map(line => line ? `% ${line}` : '%').join('\n');
export function exportMystLatex(input: MystPublicationInput): string {
  const projection = projectMystPublication(input, 'latex'), file = new VFile();
  unified().use(texPlugin).stringify(projection.ast as Root, file);
  const result = file.result as LatexResult;
  const imports = [...new Set(['amsmath', 'amssymb', 'graphicx', 'booktabs', ...result.imports])];
  if (imports.some(name => !/^[a-zA-Z0-9-]+$/.test(name))) throw new Error('Unsupported LaTeX package name');
  // A standalone image starts a paragraph in the SDK output. Its normal TeX
  // indent would push a 100%-width figure beyond the manuscript's text block.
  const body = result.value.replace(/^\\includegraphics\[/gm, '\\noindent\\includegraphics[');
  return `\\documentclass{article}\n${imports.map(name => `\\usepackage{${name}}`).join('\n')}\n\\begin{document}\n${body}\n\\end{document}\n${texComment('PERO PUBLICATION LOSSES\n' + projection.losses.join('\n'))}\n% PERO ORIGINAL SOURCE JSON\n${texComment(mystPublicationRecovery(input).record)}\n`;
}
export function exportMystTypst(input: MystPublicationInput): string {
  const projection = projectMystPublication(input, 'typst'), file = new VFile();
  unified().use(typstPlugin).stringify(projection.ast as Root, file);
  const result = file.result as TypstResult;
  const macros = result.macros.map(m => m === '#import "@preview/tablex:0.0.9": tablex, cellx, hlinex, vlinex' ? '#let tablex(columns: 1, header-rows: 0, repeat-header: true, ..args) = table(columns: columns, ..args)' : m);
  if (macros.some(m => /#(?:import|include)\b/.test(m))) throw new Error('External Typst imports are not allowed');
  return `${macros.join('\n')}\n${result.value}\n// PERO PUBLICATION LOSSES ${JSON.stringify(projection.losses)}\n// PERO ORIGINAL SOURCE JSON ${JSON.stringify(JSON.parse(mystPublicationRecovery(input).record))}\n`;
}
export async function exportMystDocx(input: MystPublicationInput): Promise<Uint8Array> {
  input = boundMystPublicationImages(input);
  const projection = projectMystPublication(input, 'docx'), file = new VFile();
  const math: Handler = (state, node) => {
    const result = nativeDocxMath(node.value ?? '');
    if (result.status === 'native') { state.current.push(new DocxMath({ children: result.children })); projection.losses.push(...result.warnings); }
    else { state.text(node.value ?? ''); projection.losses.push(`Equation retained as literal text: ${result.reason}`); }
    if (node.type === 'math') state.closeBlock();
  };
  const table: Handler = (state, node) => {
    state.closeBlock(); const outer = state.children;
    const columns = Math.max(1, ...node.children.map((row: { children: unknown[] }) => row.children.length));
    const rows = node.children.map((row: { children: { header?: boolean }[] }) => new TableRow({ tableHeader: row.children.every(c => !!c.header), children: row.children.map(cell => {
      state.children = []; state.renderChildren(cell as Parameters<typeof state.renderChildren>[0]); state.closeBlock();
      return new TableCell({ width: { size: Math.floor(9000 / columns), type: WidthType.DXA }, children: state.children.length ? state.children : [new Paragraph('')] });
    }) }));
    state.children = outer; outer.push(new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: Array(columns).fill(Math.floor(9000 / columns)), rows }), new Paragraph(''));
  };
  const assets = new Map((input.assets ?? []).map(asset => [asset.path, asset]));
  const state = new DocxSerializer(file, { handlers: { ...defaultHandlers, math, inlineMath: math, table }, getImageBuffer: path => {
    const asset = assets.get(path); if (!asset) throw new Error(`Missing explicit publication asset: ${path}`);
    return Buffer.from(asset.base64, 'base64');
  } }, { title: input.document.scholarly.title });
  state.renderChildren(projection.ast as Root); state.closeBlock();
  projection.losses.push(...file.messages.map(m => String(m)));
  const original = await JSZip.loadAsync(await (await Packer.toBlob(createDocFromState(state))).arrayBuffer());
  const archive = new JSZip();
  const names = new Map(Object.keys(original.files).filter(p => p.startsWith('word/media/') && !original.files[p].dir).map((path, i) => [path, `word/media/image${i + 1}.${path.split('.').pop()}`]));
  for (const [path, file] of Object.entries(original.files)) {
    if (file.dir) continue;
    if (/\.(xml|rels)$/.test(path)) {
      let text = await file.async('string');
      for (const [oldPath, newPath] of names) text = text.replaceAll(oldPath.slice(5), newPath.slice(5));
      text = text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]+/g, '$11980-01-01T00:00:00.000Z');
      archive.file(path, text, { date: epoch, createFolders: false });
    } else archive.file(names.get(path) ?? path, await file.async('uint8array'), { date: epoch, createFolders: false });
  }
  const recovery = mystPublicationRecovery(input);
  archive.file(`pero/${recovery.filename}`, recovery.content, { date: epoch, createFolders: false });
  archive.file('pero/publication-losses.json', JSON.stringify([...new Set(projection.losses)], null, 2) + '\n', { date: epoch, createFolders: false });
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
export async function exportMystPublicationArchive(input: MystPublicationInput, kind: 'latex' | 'typst' | 'jats'): Promise<Uint8Array> {
  const resolved = boundMystPublicationImages(input), provided = new Map((resolved.assets ?? []).map(a => [a.path, a]));
  const used = new Map<string, { path: string; mediaType: string; base64: string }>();
  const rewrite = (node: import('./myst.ts').MystNode) => {
    const asset = node.type === 'image' && typeof node.url === 'string' ? provided.get(node.url) : undefined;
    if (asset && ['image/png', 'image/jpeg'].includes(asset.mediaType)) {
      if (!used.has(asset.path)) used.set(asset.path, { ...asset, path: `assets/image-${used.size + 1}.${asset.mediaType === 'image/png' ? 'png' : 'jpg'}` });
      node.url = used.get(asset.path)!.path;
    }
    node.children?.forEach(rewrite);
  };
  rewrite(resolved.document.ast); resolved.assets = [...used.values()]; resolved.assetMode = 'archive';
  const jats = kind === 'jats' ? exportMystJatsResult(resolved, new Set([...used.values()].map(a => a.path))) : undefined;
  const losses = jats?.losses ?? projectMystPublication(resolved, kind === 'typst' ? 'typst' : 'latex').losses;
  const content = jats?.xml ?? (kind === 'latex' ? exportMystLatex(resolved) : exportMystTypst(resolved));
  const archive = new JSZip(), recovery = mystPublicationRecovery(input);
  archive.file(`article.${kind === 'latex' ? 'tex' : kind === 'typst' ? 'typ' : 'xml'}`, content, { date: epoch, createFolders: false });
  archive.file(recovery.filename, recovery.content, { date: epoch, createFolders: false });
  archive.file('publication-losses.json', JSON.stringify(losses, null, 2) + '\n', { date: epoch, createFolders: false });
  archive.file('assets.json', JSON.stringify([...used].map(([source, asset]) => ({ source, path: asset.path, mediaType: asset.mediaType })), null, 2) + '\n', { date: epoch, createFolders: false });
  for (const asset of used.values()) archive.file(asset.path, Buffer.from(asset.base64, 'base64'), { date: epoch, createFolders: false });
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
export const mystCompiledPublicationFormats: readonly DocumentExportFormat<MystPublicationInput, DocumentExportContent>[] = [
  { id: 'jats', label: 'JATS XML', extensions: ['.xml'], mediaType: 'application/xml', serialize: input => exportMystJatsResult(input).xml },
  { id: 'docx', label: 'Word (DOCX)', extensions: ['.docx'], mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', serialize: exportMystDocx },
  { id: 'latex', label: 'LaTeX source', extensions: ['.tex'], mediaType: 'application/x-tex', serialize: exportMystLatex },
  { id: 'typst', label: 'Typst source', extensions: ['.typ'], mediaType: 'text/plain', serialize: exportMystTypst },
  ...(['latex', 'typst', 'jats'] as const).map(kind => ({ id: `${kind}-archive`, label: `${kind === 'latex' ? 'LaTeX' : kind === 'typst' ? 'Typst' : 'JATS'} + assets (ZIP)`, extensions: [`.${kind}.zip`], mediaType: 'application/zip', serialize: (input: MystPublicationInput) => exportMystPublicationArchive(input, kind) })),
];
