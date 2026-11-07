import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadFile, useAppApi } from '@pero/app-sdk';
import { Button, Feedback, Icon, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from './notebook';

type CellOutput = { output_type?: string; text?: string | string[]; traceback?: string[]; data?: Record<string, string | string[]> };

type KernelState = {
  session: string;
  status: 'idle' | 'running' | 'closed';
  outputs: unknown[];
  execution_count: number | null;
  error: string;
};

export function NotebookRunner({ notebook, edited, name, zh, onChange, onKernel }: {
  notebook: NotebookDocument; edited: boolean; name: string; zh: boolean; onChange(value: NotebookDocument): void;
  onKernel(active: boolean): void;
}) {
  const api = useAppApi();
  const [kernel, setKernel] = useState<KernelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runningCell, setRunningCell] = useState<number | null>(null);
  const addedCell = useRef<string | null>(null);
  const session = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const current = useRef(notebook);
  current.current = notebook;
  const sourceOf = (cell: NotebookDocument['cells'][number]) => Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '';
  const command = (action: string, code?: string) =>
    api.post<KernelState>('/api/notebooks', { action, session: session.current, code });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      const id = session.current;
      session.current = undefined;
      if (id) void api.post('/api/notebooks', { action: 'close', session: id }).catch(() => {});
    };
  }, [api]);

  useEffect(() => {
    if (runningCell === null) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await command('status');
        if (stopped) return;
        setKernel(value);
        const draft = current.current;
        onChange({ ...draft, cells: draft.cells.map((cell, index) => index === runningCell
          ? { ...cell, outputs: value.outputs, execution_count: value.execution_count } : cell) });
        if (value.status === 'running') timer = setTimeout(() => void poll(), 350);
        else { setRunningCell(null); setError(value.error); }
      } catch (reason) {
        if (!stopped) { setError(String(reason)); setRunningCell(null); }
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [runningCell, api]);

  async function perform(action: string, index?: number) {
    setBusy(true); setError('');
    try {
      const value = await command(action, index === undefined ? undefined : sourceOf(current.current.cells[index]));
      if (!active.current) {
        if (action === 'start') await api.post('/api/notebooks', { action: 'close', session: value.session });
        return;
      }
      setKernel(action === 'close' ? null : value);
      if (action === 'start' || action === 'close') onKernel(action === 'start');
      session.current = action === 'close' ? undefined : value.session;
      if (index !== undefined) setRunningCell(index);
      if (action === 'close') setRunningCell(null);
    } catch (reason) {
      if (active.current) setError(String(reason));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  const running = runningCell !== null;
  const language = (notebook.metadata?.kernelspec as { language?: string } | undefined)?.language ?? notebook.metadata?.language_info?.name;
  if (language && !/^python/i.test(language)) return <p>{zh ? '实时执行需要 Python Notebook。' : 'Live execution requires a Python notebook.'}</p>;
  return <section className="notebook-runner" aria-label={zh ? 'Notebook 执行' : 'Notebook execution'}>
    <div className="notebook-run-actions">
      <span className="notebook-kernel-label"><Icon name="terminal" size={14} /> Python</span>
      <span className="notebook-kernel-status" data-kernel={kernel?.status ?? 'closed'}>{kernel?.status === 'idle' ? (zh ? '内核就绪' : 'Kernel ready') : kernel?.status === 'running' ? (zh ? '正在运行' : 'Running') : (zh ? '内核已停止' : 'Kernel stopped')}</span>
      <span className="notebook-run-spacer" />
      {!kernel ? <Button variant="primary" disabled={busy} onClick={() => void perform('start')}>{zh ? '启动 Python 内核' : 'Start Python kernel'}</Button> : <>
        {running && <Button disabled={busy} onClick={() => void perform('interrupt')}>{zh ? '中断' : 'Interrupt'}</Button>}
        <Button disabled={busy || running} onClick={() => void perform('restart')}>{zh ? '重启内核' : 'Restart kernel'}</Button>
        <Button disabled={busy} onClick={() => void perform('close')}>{zh ? '关闭内核' : 'Close kernel'}</Button>
      </>}
      {edited && <Button disabled={running} onClick={() => downloadFile(name.replace(/\.ipynb$/i, '') + '-executed.ipynb', JSON.stringify(notebook, null, 2), 'application/x-ipynb+json')}>
        {zh ? '下载工作副本' : 'Download working copy'}
      </Button>}
    </div>
    {!kernel && <p className="muted">{zh ? '启动后可逐单元运行代码。运行使用本机 Python，输出保存在工作副本中。' : 'Run cells in local Python. Outputs stay in the working copy.'}</p>}
    {(running || busy) && <p role="status">{running ? (zh ? '单元执行中…' : 'Running cell…') : (zh ? '正在处理内核…' : 'Updating kernel…')}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {(kernel || edited) && <div className="notebook-live-cells">
      {notebook.cells.map((cell, index) => {
        const source = sourceOf(cell);
        if (cell.cell_type !== 'code') return <div key={cell.id ?? index} className="notebook-live-markdown">
          {cell.cell_type === 'markdown' ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
            components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{source}</ReactMarkdown> : <pre>{source}</pre>}
        </div>;
        const canRun = !busy && !running && kernel?.status === 'idle';
        return <section key={cell.id ?? index} className="notebook-live-cell" aria-label={zh ? `单元 ${index + 1}` : `Cell ${index + 1}`}>
          <div className="notebook-cell-toolbar">
            <span className="notebook-cell-count">[{runningCell === index ? '*' : cell.execution_count ?? ' '}]</span>
            <span>{zh ? `代码单元 ${index + 1}` : `Code cell ${index + 1}`}</span><span className="notebook-run-spacer" />
            <Button variant="ghost" aria-label={zh ? `运行单元 ${index + 1}` : `Run cell ${index + 1}`}
              title={zh ? '运行单元（Shift + Enter）' : 'Run cell (Shift + Enter)'} aria-keyshortcuts="Shift+Enter"
              disabled={!canRun} onClick={() => void perform('execute', index)}>
              <Icon name="play" size={14} /> {zh ? '运行' : 'Run'}
            </Button>
          </div>
          <Textarea autoFocus={cell.id === addedCell.current} rows={Math.min(12, Math.max(2, source.split('\n').length))} spellCheck={false}
            aria-label={zh ? `代码单元 ${index + 1}` : `Code cell ${index + 1}`} disabled={running || busy} value={source}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing && canRun) {
                event.preventDefault();
                void perform('execute', index);
              }
            }}
            onChange={event => onChange({ ...notebook, cells: notebook.cells.map((cell, at) => at === index
              ? { ...cell, source: event.target.value, outputs: [], execution_count: null } : cell) })} />
          {!!cell.outputs?.length && <div className="notebook-live-output" aria-label={zh ? '单元输出' : 'Cell output'}
            data-error={cell.outputs.some(value => (value as CellOutput)?.output_type === 'error') || undefined}>
              <div className="notebook-output-label">{zh ? '输出' : 'Output'}</div>
              {cell.outputs.map((value, offset) => {
                const output = value as CellOutput;
                const image = output?.data?.['image/png'];
                const png = Array.isArray(image) ? image.join('') : image;
                const imageShown = typeof png === 'string' && /^[a-z0-9+/=\s]+$/i.test(png);
                const text = output?.text ?? output?.traceback?.join('\n') ?? (imageShown ? undefined : output?.data?.['text/plain']);
                return <React.Fragment key={offset}>
                  {imageShown && <img src={`data:image/png;base64,${png}`} alt={zh ? '单元图像输出' : 'Cell image output'} />}
                  {text != null && <pre>{Array.isArray(text) ? text.join('') : text}</pre>}
                </React.Fragment>;
              })}
          </div>}
        </section>;
      })}
      <Button variant="ghost" className="notebook-add-cell" disabled={busy || running || notebook.cells.length >= 500}
        onClick={() => {
          const id = crypto.randomUUID().slice(0, 8);
          addedCell.current = id;
          onChange({ ...notebook, cells: [...notebook.cells, {
            id, cell_type: 'code', metadata: {}, source: '', outputs: [], execution_count: null,
          }] });
        }}>
        <Icon name="plus" size={14} />{zh ? '添加单元' : 'Add cell'}
      </Button>
    </div>}
  </section>;
}
