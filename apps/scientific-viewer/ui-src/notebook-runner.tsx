import React, { useEffect, useRef, useState } from 'react';
import { downloadFile, useAppApi } from '@pero/app-sdk';
import { Button, Feedback, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from './notebook';

type CellOutput = { text?: string | string[]; traceback?: string[]; data?: Record<string, string | string[]> };

type KernelState = {
  session: string;
  status: 'idle' | 'running' | 'closed';
  outputs: unknown[];
  execution_count: number | null;
  error: string;
};

export function NotebookRunner({ notebook, edited, name, zh, onChange }: {
  notebook: NotebookDocument; edited: boolean; name: string; zh: boolean; onChange(value: NotebookDocument): void;
}) {
  const api = useAppApi();
  const [kernel, setKernel] = useState<KernelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runningCell, setRunningCell] = useState<number | null>(null);
  const cells = notebook.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.cell_type === 'code');
  const [index, setIndex] = useState(cells[0]?.index ?? 0);
  const session = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const current = useRef(notebook);
  current.current = notebook;
  const cell = notebook.cells[index];
  const source = Array.isArray(cell?.source) ? cell.source.join('') : cell?.source ?? '';
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

  async function perform(action: string) {
    setBusy(true); setError('');
    try {
      const value = await command(action, action === 'execute' ? source : undefined);
      if (!active.current) {
        if (action === 'start') await api.post('/api/notebooks', { action: 'close', session: value.session });
        return;
      }
      setKernel(action === 'close' ? null : value);
      session.current = action === 'close' ? undefined : value.session;
      if (action === 'execute') setRunningCell(index);
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
  if (!cells.length) return null;
  return <section className="notebook-runner" aria-label={zh ? 'Notebook 执行' : 'Notebook execution'}>
    <div className="notebook-run-actions">
      {!kernel ? <Button disabled={busy} onClick={() => void perform('start')}>{zh ? '启动 Python 内核' : 'Start Python kernel'}</Button> : <>
        <Button disabled={busy || running || kernel.status !== 'idle'} onClick={() => void perform('execute')}>{zh ? '运行单元' : 'Run cell'}</Button>
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
    {kernel && <>
      <NativeSelect aria-label={zh ? '选择代码单元' : 'Select code cell'} value={index} disabled={running} onChange={event => setIndex(Number(event.target.value))}>
        {cells.map(({ index }) => <option key={index} value={index}>{zh ? '单元' : 'Cell'} {index + 1}</option>)}
      </NativeSelect>
      <Textarea rows={5} spellCheck={false} aria-label={zh ? '代码单元' : 'Code cell'} disabled={running} value={source}
        onChange={event => onChange({ ...notebook, cells: notebook.cells.map((cell, at) => at === index
          ? { ...cell, source: event.target.value, outputs: [], execution_count: null } : cell) })} />
      <div className="notebook-live-output" aria-label={zh ? '单元输出' : 'Cell output'}>
        {(cell?.outputs ?? []).map((value, offset) => {
          const output = value as CellOutput;
          const image = output?.data?.['image/png'];
          const text = output?.text ?? output?.traceback?.join('\n') ?? output?.data?.['text/plain'];
          return <React.Fragment key={offset}>
            {typeof image === 'string' && /^[a-z0-9+/=\s]+$/i.test(image) && <img src={`data:image/png;base64,${image}`} alt={zh ? '单元图像输出' : 'Cell image output'} />}
            {text != null && <pre>{Array.isArray(text) ? text.join('') : text}</pre>}
          </React.Fragment>;
        })}
      </div>
    </>}
  </section>;
}
