import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@datalayer/jupyter-react/viewer';
import '@jupyterlab/nbconvert-css/style/index.css';
import type { Asset } from './files';
import { parseNotebook } from './notebook';
import { useAppContext } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { NotebookRunner } from './notebook-runner';
import './notebook-preview.css';

// The standalone Viewer does not import JupyterLab's full Notebook module,
// which normally supplies this compatibility API for Safari / WKWebView.
if (typeof window.requestIdleCallback !== 'function') {
  window.requestIdleCallback = callback => window.setTimeout(() => {
    const start = performance.now();
    callback({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (performance.now() - start)) });
  }, 0);
  window.cancelIdleCallback = handle => window.clearTimeout(handle);
}
const StaticViewer = memo(Viewer);

/** Datalayer renders the original snapshot beside the separately editable working copy. */
export function NotebookPreview({ asset, embedded = false }: { asset: Asset; embedded?: boolean }) {
  const { dark, locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const notebook = useMemo(() => parseNotebook(asset.bytes), [asset]);
  const [draft, setDraft] = useState<typeof notebook | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const node = container.current!;
    setStatus('loading');
    const timeout = window.setTimeout(() => setStatus('failed'), 10000);
    const check = () => {
      const cells = [...node.querySelectorAll('.jp-Cell')];
      if (cells.length === notebook.cells.length && cells.every(cell => cell.getBoundingClientRect().height > 0)) {
        window.clearTimeout(timeout); setStatus('ready');
      }
    };
    const mutations = new MutationObserver(check); mutations.observe(node, { childList: true, subtree: true });
    const resize = new ResizeObserver(check); resize.observe(node); check();
    return () => { window.clearTimeout(timeout); mutations.disconnect(); resize.disconnect(); };
  }, [notebook, attempt]);
  return <section className="notebook-preview" aria-label="Notebook preview">
    {!embedded && <h2>Notebook</h2>}
    <NotebookRunner notebook={draft ?? notebook} edited={draft !== null} name={asset.name} zh={zh} onChange={setDraft} />
    <p className="muted">{zh ? `原始快照 · ${notebook.cells.length} 个单元 · 已保存的输出` : `Original snapshot · ${notebook.cells.length} ${notebook.cells.length === 1 ? 'cell' : 'cells'} · Stored outputs`}</p>
    {status === 'loading' && <p role="status">{zh ? '正在显示 Notebook 单元…' : 'Rendering notebook cells…'}</p>}
    {status === 'failed' && <div><Feedback kind="error">{zh ? 'Notebook 单元未能显示。可查看源码或重试。' : 'Notebook cells could not be displayed. View Source or retry.'}</Feedback><Button onClick={() => setAttempt(value => value + 1)}>{zh ? '重试预览' : 'Retry preview'}</Button></div>}
    {!notebook.cells.length && <p>{zh ? 'Notebook 中没有单元。' : 'This notebook has no cells.'}</p>}
    <div className="notebook-viewer" ref={container} data-jp-theme-light={String(!dark)}>
      <StaticViewer key={attempt} nbformat={notebook as never} outputs />
    </div>
  </section>;
}
