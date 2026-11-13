import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadFile, useHostAgent, useAppChat, type AppScienceSnapshot, type AppScienceCommand } from '@pero/app-sdk';
import { Button, Feedback, Icon, Select, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from './notebook';
import { NotebookOutput } from './notebook-output';

type Language = AppScienceCommand['language'];
type Action = AppScienceCommand['action'];
type ScienceSession = { sessionId: string; title?: string; ready: boolean };

/** A view of the Agent's kernel. Detaching this view never closes that kernel. */
export function SharedNotebook({ notebook, edited, name, zh, onChange, onKernel }: {
  notebook: NotebookDocument; edited: boolean; name: string; zh: boolean;
  onChange(value: NotebookDocument): void; onKernel(active: boolean): void;
}) {
  const agent = useHostAgent();
  const supported = agent !== null;
  const chat = useAppChat();
  const metadataLanguage = (notebook.metadata?.kernelspec as { language?: string } | undefined)?.language ?? notebook.metadata?.language_info?.name;
  const [language, setLanguage] = useState<Language>(metadataLanguage?.toLowerCase() === 'r' ? 'r' : 'python');
  const [sessions, setSessions] = useState<ScienceSession[]>([]);
  const [selected, setSelected] = useState('');
  const [kernel, setKernel] = useState<AppScienceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollRevision, setPollRevision] = useState(0);
  const [pending, setPending] = useState<{ cell: number; execution: number } | null>(null);
  const addedCell = useRef<string | null>(null);
  const current = useRef({ notebook, onChange, onKernel, agent, selected, language, pending });
  current.current = { notebook, onChange, onKernel, agent, selected, language, pending };
  const mounted = useRef(true);
  const sourceOf = (cell: NotebookDocument['cells'][number]) => Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '';

  async function refreshSessions() {
    setLoading(true); setError('');
    try {
      const owner = current.current.agent;
      if (!owner) { setSelected(''); setSessions([]); setKernel(null); setPending(null); return; }
      const value = await owner.scienceSessions();
      if (!mounted.current) return;
      setSessions(value.sessions);
      if (!value.sessions.some(item => item.sessionId === current.current.selected)) {
        setSelected(value.sessions.find(item => item.ready)?.sessionId ?? '');
        setKernel(null); setPending(null);
      }
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { void refreshSessions(); }, [supported]);

  // The receipt ID pins a user's notebook cell even if the Agent runs another
  // cell before the next poll. Shared history is always the owner's projection.
  function receive(value: AppScienceSnapshot) {
    setKernel(value);
    const target = current.current.pending;
    const receipt = target && value.history.find(cell => cell.id === target.execution);
    if (target && receipt && receipt.status !== 'running') {
      const draft = current.current.notebook;
      current.current.onChange({ ...draft, cells: draft.cells.map((cell, index) => index === target.cell
        ? { ...cell, outputs: receipt.outputs, execution_count: receipt.execution_count } : cell) });
      setPending(null);
    }
  }

  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const owner = current.current.agent;
        if (!owner) return;
        const value = await owner.science({ sessionId: selected, action: 'status', language });
        if (stopped) return;
        receive(value);
        timer = setTimeout(() => void poll(), 750);
      } catch (reason) {
        if (!stopped) setError(String(reason));
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [selected, language, pollRevision]);

  useEffect(() => {
    onKernel(!!selected);
  }, [selected, onKernel]);

  async function perform(action: Action, index?: number) {
    setBusy(true); setError('');
    try {
      const owner = current.current.agent;
      if (!owner) throw new Error(zh ? '本视图无法访问 Agent 会话。' : 'Agent sessions are unavailable in this view.');
      const code = index === undefined ? undefined : sourceOf(current.current.notebook.cells[index]);
      const value = await owner.science({ sessionId: selected, action, language, ...(code === undefined ? {} : { code }) });
      if (!mounted.current || current.current.selected !== selected || current.current.language !== language) return;
      receive(value);
      setPollRevision(revision => revision + 1);
      if (index !== undefined) {
        const receipt = [...value.history].reverse().find(cell => cell.origin === 'user' && cell.code === code);
        if (receipt) {
          if (receipt.status === 'running') setPending({ cell: index, execution: receipt.id });
          else {
            const draft = current.current.notebook;
            onChange({ ...draft, cells: draft.cells.map((cell, at) => at === index
              ? { ...cell, outputs: receipt.outputs, execution_count: receipt.execution_count } : cell) });
          }
        }
      }
    } catch (reason) {
      if (mounted.current && current.current.selected === selected) setError(String(reason));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const running = kernel?.status === 'running';
  const canRun = !busy && !pending && kernel?.status === 'idle';
  const available = kernel?.status === 'idle' || running;
  return <section className="notebook-runner" aria-label={zh ? '共享科学会话' : 'Shared science session'}>
    <div className="notebook-run-actions">
      <Select label={zh ? 'Agent 会话' : 'Agent session'} value={selected}
        placeholder={zh ? '选择 Agent 会话' : 'Choose an Agent session'} disabled={busy || loading}
        options={sessions.map(item => ({ value: item.sessionId, label: item.title || item.sessionId,
          disabled: !item.ready, hint: !item.ready ? (zh ? '会话尚未连接' : 'Session is not connected') : undefined }))}
        onChange={value => { setSelected(value); setKernel(null); setPending(null); setError(''); }} />
      <Button variant="ghost" aria-label={zh ? '刷新 Agent 会话' : 'Refresh Agent sessions'} disabled={loading || busy}
        onClick={() => { void refreshSessions(); setPollRevision(value => value + 1); }}><Icon name="refresh" size={14} /></Button>
      <Select label={zh ? '内核语言' : 'Kernel language'} value={language} disabled={busy}
        options={[{ value: 'python', label: 'Python' }, { value: 'r', label: 'R' }, { value: 'repl', label: 'Python repl' }]}
        onChange={value => { setLanguage(value as Language); setKernel(null); setPending(null); setError(''); }} />
      <Button variant="ghost" onClick={() => void chat.open(selected ? { sessionId: selected } : {})}>
        {zh ? '打开 Agent 对话' : 'Open Agent chat'}
      </Button>
    </div>
    {!selected && !loading && <p className="muted">{zh
      ? '打开本应用的 Agent 对话并开始会话，然后刷新。连接后，人和 Agent 使用同一内核中的变量。'
      : 'Start a conversation in this App, then refresh. Connect to use the same variables as the Agent.'}</p>}
    {loading && <p role="status">{zh ? '正在读取 Agent 会话…' : 'Loading Agent sessions…'}</p>}
    {selected && <>
      <div className="notebook-run-actions">
        <span className="notebook-kernel-label"><Icon name="terminal" size={14} />{language === 'r' ? 'R' : language === 'repl' ? 'Python repl' : 'Python'}</span>
        <span className="notebook-kernel-status" data-kernel={kernel?.status ?? 'closed'} aria-live="polite">{kernel?.status === 'idle'
          ? (zh ? '共享内核就绪' : 'Shared kernel ready') : running ? (zh ? '正在运行' : 'Running')
          : kernel?.status === 'unavailable' ? (zh ? '环境不可用' : 'Environment unavailable') : (zh ? '内核已停止' : 'Kernel stopped')}</span>
        <span className="notebook-run-spacer" />
        {!available ? <Button variant="primary" disabled={busy} onClick={() => void perform('start')}>
          {zh ? '启动共享内核' : 'Start shared kernel'}
        </Button> : <>
          {running && <Button disabled={busy} onClick={() => void perform('interrupt')}>{zh ? '中断' : 'Interrupt'}</Button>}
          <Button disabled={busy || running} onClick={() => void perform('restart')}>{zh ? '重启内核' : 'Restart kernel'}</Button>
          <Button disabled={busy} onClick={() => void perform('close')}>{zh ? '关闭内核' : 'Close kernel'}</Button>
        </>}
      </div>
      <p className="muted">{zh
        ? '切换或关闭视图会保留共享内核。中断会停止进程并清空变量；重启和关闭也会清空变量，执行历史保留。'
        : 'The shared kernel survives switching or closing this view. Interrupt, restart and close discard variables; execution history stays available.'}</p>
    </>}
    {busy && <p role="status">{zh ? '正在处理内核…' : 'Updating kernel…'}</p>}
    {(error || kernel?.error) && <Feedback kind="error">{error || kernel?.error}
      <Button variant="ghost" onClick={() => { setError(''); setPollRevision(value => value + 1); }}>{zh ? '重试状态' : 'Retry status'}</Button>
    </Feedback>}
    {kernel?.status === 'unavailable' && language === 'r' && <p>{zh
      ? '安装 R 并确保 Rscript 可用，然后重试启动；也可选择已准备的 Python 内核。'
      : 'Install R with Rscript available, then retry Start shared kernel, or select a prepared Python kernel.'}</p>}
    {!!kernel?.history.length && <div className="notebook-live-cells" aria-label={zh ? '共享执行历史' : 'Shared execution history'}>
      {kernel.history.map(cell => <section key={cell.id} className="notebook-live-cell" data-origin={cell.origin}
        aria-label={`${cell.origin === 'agent' ? 'Agent' : zh ? '用户' : 'User'} [${cell.execution_count ?? cell.id}]`}>
        <div className="notebook-cell-toolbar"><span className="notebook-cell-count">[{cell.status === 'running' ? '*' : cell.execution_count ?? cell.id}]</span>
          <span>{cell.origin === 'agent' ? 'Agent' : zh ? '用户' : 'User'}</span><span className="notebook-run-spacer" />
          <span>{cell.status === 'running' ? (zh ? '运行中' : 'Running') : cell.status === 'completed' ? (zh ? '已完成' : 'Completed')
            : cell.status === 'interrupted' ? (zh ? '已中断' : 'Interrupted') : cell.status === 'unknown' ? (zh ? '结果未知' : 'Outcome unknown') : (zh ? '执行失败' : 'Failed')}</span>
          <span>{zh ? `第 ${cell.generation} 代内核` : `Kernel ${cell.generation}`}</span>
        </div>
        <pre className="notebook-history-code">{cell.code}</pre>
        <NotebookOutput outputs={cell.outputs} zh={zh} />
        {cell.error && !cell.outputs.length && <Feedback kind="error">{cell.error}</Feedback>}
      </section>)}
    </div>}
    {(selected || edited) && <div className="notebook-live-cells" aria-label={zh ? 'Notebook 工作副本' : 'Notebook working copy'}>
      {notebook.cells.map((cell, index) => {
        const source = sourceOf(cell);
        if (cell.cell_type !== 'code') return <div key={cell.id ?? index} className="notebook-live-markdown">
          {cell.cell_type === 'markdown' ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
            components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{source}</ReactMarkdown> : <pre>{source}</pre>}
        </div>;
        return <section key={cell.id ?? index} className="notebook-live-cell" aria-label={zh ? `单元 ${index + 1}` : `Cell ${index + 1}`}>
          <div className="notebook-cell-toolbar">
            <span className="notebook-cell-count">[{pending?.cell === index ? '*' : cell.execution_count ?? ' '}]</span>
            <span>{zh ? `代码单元 ${index + 1}` : `Code cell ${index + 1}`}</span><span className="notebook-run-spacer" />
            <Button variant="ghost" aria-label={zh ? `运行单元 ${index + 1}` : `Run cell ${index + 1}`}
              title={zh ? '运行单元（Shift + Enter）' : 'Run cell (Shift + Enter)'} aria-keyshortcuts="Shift+Enter"
              disabled={!canRun} onClick={() => void perform('execute', index)}><Icon name="play" size={14} />{zh ? '运行' : 'Run'}</Button>
          </div>
          <Textarea autoFocus={cell.id === addedCell.current} rows={Math.min(12, Math.max(2, source.split('\n').length))} spellCheck={false}
            aria-label={zh ? `代码单元 ${index + 1}` : `Code cell ${index + 1}`} disabled={busy || !!pending} value={source}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing && canRun) {
                event.preventDefault(); void perform('execute', index);
              }
            }}
            onChange={event => onChange({ ...notebook, cells: notebook.cells.map((cell, at) => at === index
              ? { ...cell, source: event.target.value, outputs: [], execution_count: null } : cell) })} />
          <NotebookOutput outputs={cell.outputs ?? []} zh={zh} />
        </section>;
      })}
      <Button variant="ghost" className="notebook-add-cell" disabled={busy || !!pending || notebook.cells.length >= 500}
        onClick={() => {
          const id = crypto.randomUUID().slice(0, 8); addedCell.current = id;
          onChange({ ...notebook, cells: [...notebook.cells, { id, cell_type: 'code', metadata: {}, source: '', outputs: [], execution_count: null }] });
        }}><Icon name="plus" size={14} />{zh ? '添加单元' : 'Add cell'}</Button>
      {edited && <Button disabled={!!pending} onClick={() => downloadFile(name.replace(/\.ipynb$/i, '') + '-executed.ipynb', JSON.stringify(notebook, null, 2), 'application/x-ipynb+json')}>
        {zh ? '下载工作副本' : 'Download working copy'}
      </Button>}
    </div>}
  </section>;
}
