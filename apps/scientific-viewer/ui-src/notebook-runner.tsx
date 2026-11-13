import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadFile, useAppApi } from '@pero/app-sdk';
import { Button, Feedback, Icon, Select, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from './notebook';
import { NotebookOutput } from './notebook-output';
import { SharedNotebook } from './shared-notebook';

type KernelState = {
  session: string;
  status: 'idle' | 'running' | 'closed';
  outputs: unknown[];
  execution_count: number | null;
  error: string;
};

type RunnerProps = {
  notebook: NotebookDocument; edited: boolean; name: string; zh: boolean; onChange(value: NotebookDocument): void;
  onKernel(active: boolean): void;
};

export function NotebookRunner(props: RunnerProps) {
  const [mode, setMode] = useState('shared');
  return <section className="notebook-runner">
    <Select label={props.zh ? '计算会话' : 'Computation session'} value={mode}
      options={[{ value: 'shared', label: props.zh ? '与 Agent 共享会话' : 'Shared Agent session' },
        { value: 'local', label: props.zh ? '独立 Python 内核' : 'Separate Python kernel' }]}
      onChange={value => { setMode(value); props.onKernel(false); }} />
    {mode === 'shared' ? <SharedNotebook {...props} /> : <LocalNotebook {...props} />}
  </section>;
}

function LocalNotebook({ notebook, edited, name, zh, onChange, onKernel }: RunnerProps) {
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
          <NotebookOutput outputs={cell.outputs ?? []} zh={zh} />
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
