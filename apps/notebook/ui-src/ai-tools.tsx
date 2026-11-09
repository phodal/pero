import { AICheckReview } from './ai-check-review';
import { freezeCheckGeneration, isCheckGeneration, readGeneratedChecks } from '@pero/notebook/ai-generation';
import { SourceExtractionPicker, SourceExtractionDetails } from './source-extraction';
import { type AttachmentAttributes } from '@pero/notebook/attachment';
import { createAttachment } from './content-blocks';
import { useNotebookContext } from './notebook-context';
import { notebookContentRoots } from '@pero/notebook/workspace';
import { useEffect, useRef, useState } from 'react';
import { openAppSession, useAppAgent } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Field, FilePicker, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { freezeGeneration, freezeTypedGeneration, isAIUnresolved, isTypedGeneration, listAISources, listAITables, readAIBlockSource, readAISourceBytes, sourceNeedsExtraction, readGeneratedCandidates, readTypedProposal, sourceFormatMessage, hasAIApplication,
  type AIApplication, type AIRecovery, type AISource, type FrozenGeneration, type FrozenTypedGeneration, type GenerationTarget } from '@pero/notebook/ai-generation';
import { CandidateReviewPanel } from './science-tools-review';
import { AICellReview } from './ai-cell-review';
import { AIHistory } from './ai-history';
import { useAIRecovery } from './ai-recovery';
import type { SciencePanelProps } from './science-tools-shared';

export function NotebookAITools({ getTarget, onApply, ...props }: SciencePanelProps & { getTarget(): GenerationTarget | null; onApply?(application: AIApplication): boolean }) {
  const notebook = useNotebookContext();
  const [extracting, setExtracting] = useState<{ id: string; kind: AISource['kind']; file: AttachmentAttributes } | null>(null);
  const agent = useAppAgent(), target = getTarget(), recovery = useAIRecovery(target?.entryId ?? '');
  const [goal, setGoal] = useState(''), [agentId, setAgentId] = useState(''), [mode, setMode] = useState('cells'), [blockId, setBlockId] = useState('');
  const [emptyOnly, setEmptyOnly] = useState(true), [sources, setSources] = useState<AISource[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const live = useRef(true), operation = useRef(false), latest = useRef(agent); latest.current = agent;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const record = recovery.workspace.record, selected = agentId || agent.agents.find(item => item.available)?.id || '';
  const pending = !!record && isAIUnresolved(record), locked = busy || recovery.busy || !recovery.loaded;
  const draft = props.getContent(), tables = listAITables(draft), options = notebook ? notebookContentRoots(notebook.getDocument()).flatMap(root => listAISources(JSON.stringify(root))) : listAISources(draft), selectedTable = blockId || tables[0]?.blockId || '';
  const act = async (work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (live.current) setError(String(cause)); }
    finally { operation.current = false; if (live.current) setBusy(false); }
  };
  async function start(frozen: AIRecovery['frozen']) {
    // Persist the request identity before talking to Host, including on same-request reconciliation.
    const prepared: AIRecovery = { frozen, sessionId: '', status: 'starting', transcript: '', decisions: {}, application: 'reviewing' };
    await recovery.save(prepared);
    let sessionId: string;
    try { sessionId = (await latest.current.start({ requestId: frozen.requestId, agentId: frozen.agentId, prompt: frozen.prompt })).sessionId; }
    catch (cause) {
      await recovery.save({ ...prepared, status: 'unknown' });
      throw cause;
    }
    await recovery.save({ ...prepared, sessionId, status: 'running' });
  }
  async function poll() {
    const current = recovery.state.current.record;
    if (!current?.sessionId || !recovery.loaded || ['applied', 'dismissed'].includes(current.application)) return;
    const result = await latest.current.events({ sessionId: current.sessionId, after: 0 });
    if (result.status !== current.status || result.text !== current.transcript) await recovery.save({ ...current, status: result.status, transcript: result.text, ...(result.text !== current.transcript ? { decisions: {}, application: 'reviewing' as const } : {}) });
  }
  useEffect(() => {
    if (!record?.sessionId || !['running', 'needs_input', 'cancelling'].includes(record.status) || !recovery.loaded) return;
    const timer = setInterval(() => { if (!operation.current) void act(poll); }, 1500);
    return () => clearInterval(timer);
  }, [record?.sessionId, record?.status, recovery.loaded]);
  let generated, typed, checks, parseError = '';
  if (record?.status === 'completed') {
    try { if (isCheckGeneration(record.frozen)) checks = readGeneratedChecks(record.frozen, record.sessionId, record.transcript); else if (isTypedGeneration(record.frozen)) typed = readTypedProposal(record.frozen, record.sessionId, record.transcript); else generated = readGeneratedCandidates(record.frozen, record.sessionId, record.transcript); }
    catch (cause) { parseError = String(cause); }
  }
  const addSource = (source: AISource) => setSources(previous => [...previous.filter(item => item.id !== source.id), source]);
  const canStart = recovery.loaded && (!record || !pending && ['applied', 'dismissed'].includes(record.application));
  const applicationPresent = !!record && hasAIApplication(draft, record.frozen.requestId, record.sessionId);
  return <div className="notebook-science-panel">
    <p className="notebook-note">Generate sends the listed selected sources and target table to the selected configured Host agent. New-row and check modes send the current draft. Review all changes before applying. Closing this panel stops polling, not the Host session. / 生成将所选来源和目标表格发送至所选 Host Agent；新行及检查模式发送当前草稿。修改须经复核，关闭面板不会取消 Host 会话。</p>
    {!agent.available && <Feedback kind="warning">No configured Host agent is available. Configure one in Host and refresh. No synthetic output is substituted. / 没有可用的 Host Agent，请在 Host 配置后刷新，不使用模拟输出。</Feedback>}
    <div className="notebook-science-actions"><Button disabled={locked} onClick={() => void agent.refresh()}>Refresh availability / 刷新可用性</Button><Button disabled={busy || recovery.busy} onClick={() => void recovery.load()}>Reload saved recovery / 重新载入恢复记录</Button></div>
    {recovery.error && <Feedback kind="error">{recovery.error}</Feedback>}
    {!target && <Feedback kind="warning">Open a saved entry first. / 请先打开已保存条目。</Feedback>}
    <Field label="Configured Host agent / 已配置 Host Agent">{control => <NativeSelect {...control} value={selected} disabled={locked || pending} onChange={event => setAgentId(event.target.value)}><option value="">—</option>{agent.agents.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}</option>)}</NativeSelect>}</Field>
    <Field label="Proposal mode / 建议模式">{control => <NativeSelect {...control} value={mode} disabled={locked || pending} onChange={event => setMode(event.target.value)}><option value="cells">Extract and fill typed cells / 提取并填充类型单元格</option><option value="rows">Generate new literal-text rows / 生成新的字面文本行</option><option value="checks">Generate check suggestions / 生成检查建议</option></NativeSelect>}</Field>
    <Field label="Proposal goal / 建议目标">{control => <Textarea {...control} value={goal} maxLength={4000} disabled={locked || pending} onChange={event => setGoal(event.target.value)} />}</Field>
    {mode === 'cells' && <>
      <Field label="Editable target table / 可编辑目标表">{control => <NativeSelect {...control} value={selectedTable} disabled={locked || pending} onChange={event => setBlockId(event.target.value)}><option value="">—</option>{tables.map(table => <option key={table.blockId} value={table.blockId}>{table.table.name || table.blockId} · {table.kind}</option>)}</NativeSelect>}</Field>
      {!tables.length && <Feedback kind="info">Add an input or registration table with a valid schema first. Protected, computed, lookup and source snapshots are not editable AI targets. / 请先添加具有有效字段定义的输入表或登记表，受保护、计算及来源快照不可作为写入目标。</Feedback>}
      <label><Checkbox checked={emptyOnly} disabled={locked || pending} onCheckedChange={value => setEmptyOnly(value === true)} /> Fill empty cells only / 仅填充空单元格</label>
      <p>{sourceFormatMessage}</p>
      <Field label="Select a local notebook source / 选择笔记本地来源">{control => <NativeSelect {...control} value="" disabled={locked || pending} onChange={event => {
        const option = options.find(item => item.id === event.target.value);
        if (option?.node.type === 'attachment' && sourceNeedsExtraction(String(option.node.attrs?.mime))) { const { filename, mime, data, caption, sha256 } = option.node.attrs as unknown as AttachmentAttributes; setExtracting({ id: option.id, kind: 'attachment', file: { filename, mime, data, caption, sha256 } }); }
        else if (option) void act(async () => addSource(await readAIBlockSource(option)));
      }}><option value="">Choose source / 选择来源</option>{options.map(option => <option key={option.id} value={option.id} disabled={!option.supported}>{option.name}{option.supported ? '' : ' · Unsupported / 不支持'}</option>)}</NativeSelect>}</Field>
      <FilePicker label="Read local source file / 读取本地来源文件" compact emptyLabel="" disabled={locked || pending} onFile={file => void act(async () => {
        if (sourceNeedsExtraction(file.type)) { setExtracting({ id: crypto.randomUUID(), kind: 'file', file: await createAttachment(file) }); return; }
        if (file.size > 65_536) throw new Error('Source exceeds 64 KiB; nothing was sent.');
        addSource(await readAISourceBytes(crypto.randomUUID(), file.name, file.type, new Uint8Array(await file.arrayBuffer())));
      })} />
      {extracting && <><SourceExtractionPicker key={`${extracting.id}:${extracting.file.sha256}`} file={extracting.file} disabled={locked || pending} onExtract={result => {
        void act(async () => { const source = await readAISourceBytes(extracting.id, extracting.file.filename, 'text/plain', new TextEncoder().encode(result.text), extracting.kind); addSource({ ...source, extraction: result.extraction }); setExtracting(null); });
      }} /><Button disabled={locked} onClick={() => setExtracting(null)}>Close extraction / 关闭提取</Button></>}
      <ul>{sources.map(source => <li key={source.id}>{source.name} · {source.bytes} bytes · SHA-256 {source.sha256.slice(0, 12)}<Button disabled={locked || pending} onClick={() => setSources(sources.filter(item => item.id !== source.id))}>Remove / 移除</Button><Disclosure summary="Preview source sent to Host / 预览发送至 Host 的来源"><pre className="notebook-science-json">{source.text}</pre></Disclosure>{source.extraction && <SourceExtractionDetails extraction={source.extraction} />}</li>)}</ul>
      {!onApply && <Feedback kind="warning">Typed application is unavailable in this surface. / 此界面无法应用类型单元格修改。</Feedback>}
    </>}
    <Button variant="primary" disabled={locked || !canStart || !agent.available || !selected || !goal.trim() || !target || mode === 'cells' && (!selectedTable || !sources.length || !onApply)} onClick={() => void act(async () => {
      const currentTarget = getTarget(); if (!currentTarget) throw new Error('Open a saved entry first.');
      const frozen = mode === 'cells' ? await freezeTypedGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal, selectedTable, sources, emptyOnly) : mode === 'checks' ? freezeCheckGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal) : freezeGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal);
      await start(frozen);
    })}>Generate candidates</Button>
    {record && <>
      <p role="status">{record.status} · {record.frozen.agentId} · {record.sessionId || record.frozen.requestId}</p>
      {isTypedGeneration(record.frozen) && <><p>Frozen sources / 冻结来源: {record.frozen.sources.map(source => source.name).join(', ')}</p><Disclosure summary="Frozen source content and digests / 冻结来源内容及摘要"><pre className="notebook-science-json">{JSON.stringify(record.frozen.sources, null, 2)}</pre></Disclosure></>}
      {['unknown', 'starting'].includes(record.status) && !record.sessionId && <><Feedback kind="warning">Request outcome unknown. Reconcile the same frozen request; do not start another. / 请求结果未知，请核对同一冻结请求，不要重新发起。</Feedback><Button disabled={locked} onClick={() => void act(() => start(record.frozen))}>Reconcile original request / 核对原请求</Button></>}
      {record.sessionId && <div className="notebook-science-actions">
        <Button onClick={() => void openAppSession(record.sessionId).catch(cause => setError(String(cause)))}>Open Host session / 打开 Host 会话</Button>
        <Button disabled={locked || ['applied', 'dismissed'].includes(record.application)} onClick={() => void act(poll)}>Refresh session status / 刷新会话状态</Button>
        <Button disabled={locked || !pending} onClick={() => void act(async () => {
          await recovery.save({ ...record, status: 'cancelling' });
          await latest.current.cancel({ sessionId: record.sessionId });
          // Only the next Host observation can confirm cancellation.
        })}>Cancel session / 取消会话</Button>
      </div>}
      {record.transcript && <Disclosure summary="Host transcript / Host 对话记录"><pre className="notebook-science-json">{record.transcript}</pre></Disclosure>}
      {parseError && <Feedback kind="error">{parseError}</Feedback>}
      {record.application === 'applying' && applicationPresent && <Button disabled={locked} onClick={() => void act(async () => { await recovery.save({ ...record, application: 'applied' }); })}>Confirm recovered application / 确认恢复的应用记录</Button>}
      {record.application === 'applied' && !applicationPresent && (isTypedGeneration(record.frozen) || isCheckGeneration(record.frozen)) && <Feedback kind="warning">Previously applied, but its provenance is absent from this draft. Check saved revisions or undo history before starting another proposal. No changes were replayed. / 此建议曾应用，但当前草稿中没有来源记录，请检查修订或撤销历史；未自动重复应用。</Feedback>}
      {typed && record.application !== 'dismissed' && isTypedGeneration(record.frozen) && <AICellReview frozen={record.frozen} proposal={typed} decisions={record.decisions} busy={locked} applied={record.application === 'applied' || applicationPresent} getContent={props.getContent} getTarget={getTarget}
        onDecide={decisions => act(async () => { await recovery.save({ ...record, decisions }); })}
        onApply={async application => {
          if (operation.current || !recovery.loaded || !onApply) throw new Error('Application is unavailable while another action is pending.');
          operation.current = true; setBusy(true);
          try {
            await recovery.save({ ...record, application: 'applying' });
            if (!onApply(application)) throw new Error('The editor did not apply the proposal. Check its draft and retry only after reviewing.');
            await recovery.save({ ...record, application: 'applied' });
          } finally { operation.current = false; if (live.current) setBusy(false); }
        }} />}
      {checks && record.application !== 'dismissed' && <AICheckReview key={record.frozen.requestId} result={checks} decisions={record.decisions} busy={locked} applied={record.application === 'applied' || applicationPresent} getContent={props.getContent} getTarget={getTarget}
        onDecide={decisions => act(async () => { await recovery.save({ ...record, decisions }); })}
        onApply={async snapshot => {
          if (operation.current || !recovery.loaded) throw new Error('Another action is pending.');
          operation.current = true; setBusy(true);
          try {
            await recovery.save({ ...record, application: 'applying' });
            if (!props.onSnapshot('Host check suggestions / Host 检查建议', snapshot)) throw new Error('The editor did not insert the review. Check the draft before retrying.');
            await recovery.save({ ...record, application: 'applied' });
          } finally { operation.current = false; if (live.current) setBusy(false); }
        }} />}
      {generated && record.application !== 'applied' && record.application !== 'dismissed' && <CandidateReviewPanel {...props} generated={generated} getTarget={getTarget} onSnapshot={(title, snapshot, rows) => {
        if (locked) return false; const applied = props.onSnapshot(title, snapshot, rows);
        if (applied) void act(async () => { await recovery.save({ ...record, application: 'applied' }); });
        return applied;
      }} />}
      {!pending && !['applied', 'dismissed'].includes(record.application) && <Button disabled={locked} onClick={() => void act(async () => { await recovery.save({ ...record, application: 'dismissed' }); })}>Dismiss this review / 放弃此次复核</Button>}
    </>}
    {target && <AIHistory entryId={target.entryId} />}
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}
