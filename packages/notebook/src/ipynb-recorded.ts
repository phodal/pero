import { ipynbText, type IpynbCell } from './ipynb.ts';
import { ipynbCellVisibility } from './ipynb-visibility.ts';
import type { MystNode } from './myst.ts';

export interface RecordedCellProjection { children: MystNode[]; notices: string[] }
/** The shared inert publication view of admitted code. Never discovers or executes resources. */
export function projectRecordedCell(cell: IpynbCell): RecordedCellProjection {
  const visible = ipynbCellVisibility(cell), notices = [...visible.notices];
  const children: MystNode[] = [];
  const paragraph = (value: string): MystNode => ({ type: 'paragraph', children: [{ type: 'text', value }] });
  const literal = (value: string): MystNode => {
    if (value.length > 65536) notices.push('Publication text truncated at 65536 characters; complete value retained in original notebook.');
    return { type: 'code', lang: '', value: value.slice(0, 65536) };
  };
  if (!visible.cell || cell.kind !== 'code') return { children, notices };
  if (visible.input) children.push({ type: 'block', recordedPart: 'input', children: [paragraph('Inert code input. Never executed here.'), literal(cell.source)] });
  if (!visible.output) return { children, notices };
  const outputs: MystNode[] = [paragraph(cell.stale ? 'Stale recorded outputs: code was edited, outputs were not re-executed.' : 'Recorded outputs only; execution and freshness are unverified.')];
  if (cell.outputs.length > 128) notices.push(`Cell ${cell.index + 1}: only the first 128 outputs are published; all retained in original notebook.`);
  cell.outputs.slice(0, 128).forEach((output, index) => {
    const label = `Cell ${cell.index + 1}, recorded output ${index + 1}`;
    if (output.output_type === 'stream') {
      if (output.name === 'stdout' && !visible.stdout || output.name === 'stderr' && !visible.stderr) return;
      outputs.push(paragraph(label), literal(ipynbText(output.text) ?? '[Unsupported stream text retained]')); return;
    }
    if (output.output_type === 'error') { outputs.push(paragraph(label), literal(`${String(output.ename ?? '')}: ${String(output.evalue ?? '')}\n${ipynbText(output.traceback) ?? ''}`)); return; }
    const data = output.data && typeof output.data === 'object' && !Array.isArray(output.data) ? output.data : {};
    let selected: string | undefined, node: MystNode | undefined;
    if (['display_data', 'execute_result'].includes(String(output.output_type))) {
      for (const mime of ['image/png', 'image/jpeg']) {
        const admitted = cell.images.find(item => item.location === `Output ${index + 1}` && item.image.mediaType === mime && item.image.renderable);
        if (admitted) { selected = mime; node = { type: 'image', url: '', imageData: admitted.image, alt: label }; break; }
      }
      if (!node) for (const mime of ['text/latex', 'text/plain']) {
        const text = ipynbText(data[mime]); if (text === undefined) continue;
        selected = mime;
        if (mime === 'text/latex' && text.length <= 16384) node = { type: 'math', value: text.replace(/^\$\$|\$\$$/g, '') };
        else { node = literal(text); if (mime === 'text/latex') notices.push(`${label}: oversized LaTeX shown as literal text.`); }
        break;
      }
    }
    outputs.push(paragraph(label), node ?? paragraph('Unsupported recorded output retained in original notebook.'));
    for (const mime of Object.keys(data)) if (mime !== selected) notices.push(`${label}: ${mime} is retained in original notebook, not rendered in this publication.`);
    if (!node) notices.push(`${label}: unsupported output retained without execution.`);
  });
  children.push({ type: 'block', recordedPart: 'output', children: outputs });
  return { children, notices };
}
