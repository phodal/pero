/** Read-only nbformat inspection. Imported bytes are never executed as code. */
export type NotebookCell = {
  cell_type: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  id?: string;
};
export type NotebookDocument = {
  nbformat: number;
  nbformat_minor?: number;
  metadata?: { language_info?: { name?: string; mimetype?: string }; [key: string]: unknown };
  cells: NotebookCell[];
};

export function parseNotebook(bytes: Uint8Array): NotebookDocument {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Notebook preview requires valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Notebook preview requires an nbformat object');
  const notebook = value as Record<string, unknown>;
  if (typeof notebook.nbformat !== 'number' || notebook.nbformat < 4) throw new Error('Notebook preview requires nbformat 4 or newer');
  if (!Array.isArray(notebook.cells)) throw new Error('Notebook preview requires a cells array');
  if (notebook.cells.length > 500) throw new Error('Notebook preview is limited to 500 cells');
  for (const cell of notebook.cells) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) throw new Error('Notebook cells must be objects');
    const type = (cell as NotebookCell).cell_type;
    if (typeof type !== 'string' || !type) throw new Error('Notebook cells require cell_type');
  }
  return notebook as NotebookDocument;
}
