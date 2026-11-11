import type { IpynbCell } from './ipynb.ts';
export interface IpynbCellVisibility { readonly cell: boolean; readonly input: boolean; readonly output: boolean; readonly stdout: boolean; readonly stderr: boolean; readonly notices: readonly string[] }
/** Static export has no reveal control. Hide/remove only affect projections, never source. */
export function ipynbCellVisibility(cell: IpynbCell): IpynbCellVisibility {
  const metadata = cell.raw.metadata as Record<string, unknown>;
  const tags = new Set(Array.isArray(metadata.tags) ? metadata.tags.filter((s): s is string => typeof s === 'string') : []);
  const removed = (part: string) => tags.has(`remove-${part}`) || tags.has(`hide-${part}`);
  const shown = !removed('cell'); const notices: string[] = [];
  for (const part of ['cell', ...(cell.kind === 'code' ? ['input', 'output'] : [])]) if (removed(part)) notices.push(`Cell ${cell.index + 1}: ${part} omitted by remove-${part}/hide-${part}; static publication has no reveal control.`);
  const output = shown && !(cell.kind === 'code' && removed('output'));
  return { cell: shown, input: shown && !(cell.kind === 'code' && removed('input')), output, stdout: output && !tags.has('remove-stdout'), stderr: output && !tags.has('remove-stderr'), notices };
}
