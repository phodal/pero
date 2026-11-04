import React, { useMemo } from 'react';
import { Viewer } from '@datalayer/jupyter-react/viewer';
import '@jupyterlab/nbconvert-css/style/index.css';
import type { Asset } from './files';
import { parseNotebook } from './notebook';
import './notebook-preview.css';

/** Static nbformat preview via Datalayer Viewer. No kernel or cell execution. */
export function NotebookPreview({ asset }: { asset: Asset }) {
  const notebook = useMemo(() => parseNotebook(asset.bytes), [asset]);
  return <section className="notebook-preview" aria-label="Notebook preview">
    <h2>Notebook</h2>
    <p className="muted">{notebook.cells.length} {notebook.cells.length === 1 ? 'cell' : 'cells'} · Read-only · Outputs shown when stored · Kernel not started · Unverified</p>
    <div className="notebook-viewer" data-jp-theme-light="true">
      <Viewer nbformat={notebook as never} outputs />
    </div>
  </section>;
}
