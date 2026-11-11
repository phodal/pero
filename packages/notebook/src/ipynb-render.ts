import katex from 'katex';
import { parseMystDocument, type MystDocument } from './myst.ts';
import { renderMystHtml, renderMystHtmlShell, renderMystMetadata } from './myst-render.ts';
import { renderMystCitationBibliography } from './myst-citation-render.ts';
import { safeMystImageDataUri } from './myst-assets.ts';
import { ipynbText, type IpynbDocument } from './ipynb.ts';
import { ipynbCellVisibility } from './ipynb-visibility.ts';
import type { MystScholarlyMetadata } from './myst-metadata.ts';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const literal = (text: string) => `<pre>${escape(text.slice(0, 65536))}</pre>${text.length > 65536 ? '<p>Preview truncated at 65536 characters; complete value retained in original notebook.</p>' : ''}`;
export interface IpynbRenderOptions { namespace?: string; fragment?: boolean; markdown?: ReadonlyMap<number, MystDocument>; code?: ReadonlyMap<number, MystDocument>; scholarly?: MystScholarlyMetadata; citationRendering?: MystDocument['citationRendering'] }
/** Static, bounded recorded output. No kernel, scripts, plugins or remote assets. */
export function renderIpynbHtml(document: IpynbDocument, options: IpynbRenderOptions = {}): string {
  const content = document.cells.map(cell => {
    const visible = ipynbCellVisibility(cell); if (!visible.cell) return '';
    const namespace = `${options.namespace ?? ''}:cell-${cell.index}`;
    const compiledCode = options.code?.get(cell.index);
    if (cell.kind === 'code' && compiledCode) return `<section aria-label="Cell ${cell.index + 1}"><h2>Cell ${cell.index + 1}: code</h2>${renderMystHtml(compiledCode, { namespace, fragment: true, metadata: false, bibliography: false })}</section>`;
    let input = '';
    if (visible.input) {
      if (cell.kind === 'markdown') {
        try { input = renderMystHtml(options.markdown?.get(cell.index) ?? parseMystDocument(cell.source), { namespace, fragment: true, metadata: !options.scholarly, bibliography: !options.citationRendering }); }
        catch { input = `<p>Markdown preview unavailable; exact source retained.</p>${literal(cell.source)}`; }
      } else input = `<p>${cell.kind === 'code' ? 'Inert code input. Never executed here.' : 'Raw cell, shown as literal text.'}</p>${literal(cell.source)}`;
    }
    const outputs = visible.output ? cell.outputs.slice(0, 128).map(output => {
      if (output.output_type === 'stream') {
        if (output.name === 'stdout' && !visible.stdout || output.name === 'stderr' && !visible.stderr) return '';
        return literal(ipynbText(output.text) ?? '[Unsupported stream text retained]');
      }
      if (output.output_type === 'error') return literal(`${String(output.ename ?? '')}: ${String(output.evalue ?? '')}\n${ipynbText(output.traceback) ?? ''}`);
      const data = output.data && typeof output.data === 'object' && !Array.isArray(output.data) ? output.data : {};
      const text = ipynbText(data['text/plain']); const latex = ipynbText(data['text/latex']);
      let math = '';
      if (latex !== undefined) {
        try { math = katex.renderToString(latex.slice(0, 16384).replace(/^\$\$|\$\$$/g, ''), { output: 'mathml', trust: false, throwOnError: false, maxExpand: 100, maxSize: 20 }); }
        catch { math = literal(latex); }
        if (latex.length > 16384) math += '<p>LaTeX preview truncated at 16384 characters; exact MIME value retained in original notebook.</p>';
      }
      return `${text === undefined ? '' : literal(text)}${math}`;
    }).join('') : '';
    const images = cell.images.filter(item => visible.output || !item.location.startsWith('Output '));
    const gallery = images.slice(0, 128).map(item => { const uri = safeMystImageDataUri(item.image); return uri ? `<figure><img src="${uri}" alt="${escape(item.location)}"><figcaption>${escape(item.location)}: recorded image</figcaption></figure>` : ''; }).join('');
    const mathml = visible.output ? cell.mathml.slice(0, 128).map(item => item.html).join('') : '';
    return `<section aria-label="Cell ${cell.index + 1}"><h2>Cell ${cell.index + 1}: ${cell.kind}</h2>${input}${cell.kind === 'code' && visible.output ? `<p>${cell.stale ? 'Stale recorded outputs: code was edited, outputs were not re-executed.' : 'Recorded outputs only; execution and freshness are unverified.'}</p>` : ''}${outputs}${gallery}${mathml}${cell.outputs.length > 128 && visible.output || images.length > 128 || cell.mathml.length > 128 && visible.output ? '<p>Preview truncated to 128 outputs or rich values; all remaining data retained in original notebook.</p>' : ''}${cell.raw.attachments ? '<p>Attachment bundles retained in original notebook; supported raster previews only.</p>' : ''}<ul>${[...visible.notices, ...cell.diagnostics].map(message => `<li>${escape(message)}</li>`).join('')}</ul></section>`;
  }).join('');
  const header = options.scholarly ? renderMystMetadata(options.scholarly, options.namespace ?? '').html : '';
  const bibliography = options.citationRendering ? renderMystCitationBibliography(options.citationRendering, options.namespace ?? '') : '';
  const body = `${header}<p>Offline notebook publication. No code or plugins execute. Unsupported content remains in the original notebook.</p>${content}${bibliography}`;
  return options.fragment ? body : renderMystHtmlShell(options.scholarly?.title ?? 'Notebook', body);
}
