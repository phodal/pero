/** One immutable source, independent of its App or conversation storage owner. */
export type PreviewSource = Readonly<{
  id: string;
  name: string;
  mediaType: string;
  sha256: string;
  bytes: Uint8Array;
}>;

export type PreviewKind = 'mesh' | 'image' | 'code' | 'markdown' | 'table' | 'pdf' | 'html' | 'notebook' | 'text' | 'opaque';

export function previewKind(source: Pick<PreviewSource, 'name' | 'mediaType'>): PreviewKind {
  const mime = source.mediaType.split(';', 1)[0].toLowerCase();
  const extension = source.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (mime === 'model/gltf-binary' || extension === 'glb') return 'mesh';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return 'image';
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mime === 'application/x-ipynb+json' || extension === 'ipynb') return 'notebook';
  if (mime === 'text/html' || ['html', 'htm'].includes(extension)) return 'html';
  if (mime === 'text/markdown' || ['md', 'markdown'].includes(extension)) return 'markdown';
  if (['text/csv', 'text/tab-separated-values'].includes(mime) || ['csv', 'tsv'].includes(extension)) return 'table';
  if (['json', 'jsonl', 'ndjson', 'py', 'rs', 'go', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'c', 'h', 'cpp', 'r', 'jl', 'sql', 'sh', 'bash', 'css', 'yaml', 'yml', 'toml', 'xml'].includes(extension) || mime === 'application/json') return 'code';
  if (mime.startsWith('text/') || ['txt', 'log'].includes(extension)) return 'text';
  return 'opaque';
}

export function sourceText(source: PreviewSource): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
}
