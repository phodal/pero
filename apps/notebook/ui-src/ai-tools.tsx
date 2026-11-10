import { AICheckReview } from './ai-check-review';
import { freezeCheckGeneration, isCheckGeneration, readGeneratedChecks } from '@pero/notebook/ai-generation';
import { SourceExtractionPicker, SourceExtractionDetails } from './source-extraction';
import { type AttachmentAttributes } from '@pero/notebook/attachment';
import { createAttachment } from './content-blocks';
import { useNotebookContext } from './notebook-context';
import { notebookContentRoots } from '@pero/notebook/workspace';
import { useEffect, useRef, useState } from 'react';
import { openAppSession, useAppAgent, useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Field, FilePicker, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { freezeGeneration, freezeTypedGeneration, isAIUnresolved, isTypedGeneration, listAISources, listAITables, readAIBlockSource, readAISourceBytes, sourceNeedsExtraction, readGeneratedCandidates, readTypedProposal, sourceFormatMessage, hasAIApplication,
  type AIApplication, type AIRecovery, type AISource, type FrozenGeneration, type FrozenTypedGeneration, type GenerationTarget } from '@pero/notebook/ai-generation';
import { CandidateReviewPanel } from './science-tools-review';
import { AICellReview } from './ai-cell-review';
import { AIHistory } from './ai-history';
import { useAIRecovery } from './ai-recovery';
import type { SciencePanelProps } from './science-tools-shared';

const messages = {
  generateNote: { en: 'Generate sends the listed selected sources and target table to the selected configured Host agent. New-row and check modes send the current draft. Review all changes before applying. Closing this panel stops polling, not the Host session.', zh: '生成将所选来源和目标表格发送至所选 Host Agent；新行及检查模式发送当前草稿。修改须经复核，关闭面板不会取消 Host 会话。' },
  noAgent: { en: 'No configured Host agent is available. Configure one in Host and refresh. No synthetic output is substituted.', zh: '没有可用的 Host Agent，请在 Host 配置后刷新，不使用模拟输出。' },
  refreshAvailability: { en: 'Refresh availability', zh: '刷新可用性' },
  reloadRecovery: { en: 'Reload saved recovery', zh: '重新载入恢复记录' },
  openSavedEntry: { en: 'Open a saved entry first.', zh: '请先打开已保存条目。' },
  configuredAgent: { en: 'Configured Host agent', zh: '已配置 Host Agent' },
  proposalMode: { en: 'Proposal mode', zh: '建议模式' },
  proposalCells: { en: 'Extract and fill typed cells', zh: '提取并填充类型单元格' },
  proposalRows: { en: 'Generate new literal-text rows', zh: '生成新的字面文本行' },
  proposalChecks: { en: 'Generate check suggestions', zh: '生成检查建议' },
  proposalGoal: { en: 'Proposal goal', zh: '建议目标' },
  targetTable: { en: 'Editable target table', zh: '可编辑目标表' },
  addTableFirst: { en: 'Add an input or registration table with a valid schema first. Protected, computed, lookup and source snapshots are not editable AI targets.', zh: '请先添加具有有效字段定义的输入表或登记表，受保护、计算及来源快照不可作为写入目标。' },
  emptyOnly: { en: 'Fill empty cells only', zh: '仅填充空单元格' },
  selectSource: { en: 'Select a local notebook source', zh: '选择笔记本地来源' },
  chooseSource: { en: 'Choose source', zh: '选择来源' },
  unsupported: { en: ' · Unsupported', zh: ' · 不支持' },
  readLocalSource: { en: 'Read local source file', zh: '读取本地来源文件' },
  closeExtraction: { en: 'Close extraction', zh: '关闭提取' },
  removeSource: { en: 'Remove', zh: '移除' },
  previewSource: { en: 'Preview source sent to Host', zh: '预览发送至 Host 的来源' },
  typedUnavailable: { en: 'Typed application is unavailable in this surface.', zh: '此界面无法应用类型单元格修改。' },
  generate: { en: 'Generate candidates', zh: '生成候选' },
  frozenSources: { en: 'Frozen sources', zh: '冻结来源' },
  frozenDetails: { en: 'Frozen source content and digests', zh: '冻结来源内容及摘要' },
  outcomeUnknown: { en: 'Request outcome unknown. Reconcile the same frozen request; do not start another.', zh: '请求结果未知，请核对同一冻结请求，不要重新发起。' },
  reconcile: { en: 'Reconcile original request', zh: '核对原请求' },
  openSession: { en: 'Open Host session', zh: '打开 Host 会话' },
  refreshSession: { en: 'Refresh session status', zh: '刷新会话状态' },
  cancelSession: { en: 'Cancel session', zh: '取消会话' },
  transcript: { en: 'Host transcript', zh: 'Host 对话记录' },
  confirmApplication: { en: 'Confirm recovered application', zh: '确认恢复的应用记录' },
  provenanceAbsent: { en: 'Previously applied, but its provenance is absent from this draft. Check saved revisions or undo history before starting another proposal. No changes were replayed.', zh: '此建议曾应用，但当前草稿中没有来源记录，请检查修订或撤销历史；未自动重复应用。' },
  hostChecksTitle: { en: 'Host check suggestions', zh: 'Host 检查建议' },
  dismissReview: { en: 'Dismiss this review', zh: '放弃此次复核' },
} as const;

export function NotebookAITools({ getTarget, onApply, ...props }: SciencePanelProps & { getTarget(): GenerationTarget | null; onApply?(application: AIApplication): boolean }) {
  const { t } = useAppI18n(messages);
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
    <p className="notebook-note">{t('generateNote')}</p>
    {!agent.available && <Feedback kind="warning">{t('noAgent')}</Feedback>}
    <div className="notebook-science-actions"><Button disabled={locked} onClick={() => void agent.refresh()}>{t('refreshAvailability')}</Button><Button disabled={busy || recovery.busy} onClick={() => void recovery.load()}>{t('reloadRecovery')}</Button></div>
    {recovery.error && <Feedback kind="error">{recovery.error}</Feedback>}
    {!target && <Feedback kind="warning">{t('openSavedEntry')}</Feedback>}
    <Field label={t('configuredAgent')}>{control => <NativeSelect {...control} value={selected} disabled={locked || pending} onChange={event => setAgentId(event.target.value)}><option value="">—</option>{agent.agents.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}</option>)}</NativeSelect>}</Field>
    <Field label={t('proposalMode')}>{control => <NativeSelect {...control} value={mode} disabled={locked || pending} onChange={event => setMode(event.target.value)}><option value="cells">{t('proposalCells')}</option><option value="rows">{t('proposalRows')}</option><option value="checks">{t('proposalChecks')}</option></NativeSelect>}</Field>
    <Field label={t('proposalGoal')}>{control => <Textarea {...control} value={goal} maxLength={4000} disabled={locked || pending} onChange={event => setGoal(event.target.value)} />}</Field>
    {mode === 'cells' && <>
      <Field label={t('targetTable')}>{control => <NativeSelect {...control} value={selectedTable} disabled={locked || pending} onChange={event => setBlockId(event.target.value)}><option value="">—</option>{tables.map(table => <option key={table.blockId} value={table.blockId}>{table.table.name || table.blockId} · {table.kind}</option>)}</NativeSelect>}</Field>
      {!tables.length && <Feedback kind="info">{t('addTableFirst')}</Feedback>}
      <label><Checkbox checked={emptyOnly} disabled={locked || pending} onCheckedChange={value => setEmptyOnly(value === true)} /> {t('emptyOnly')}</label>
      <p>{sourceFormatMessage}</p>
      <Field label={t('selectSource')}>{control => <NativeSelect {...control} value="" disabled={locked || pending} onChange={event => {
        const option = options.find(item => item.id === event.target.value);
        if (option?.node.type === 'attachment' && sourceNeedsExtraction(String(option.node.attrs?.mime))) { const { filename, mime, data, caption, sha256 } = option.node.attrs as unknown as AttachmentAttributes; setExtracting({ id: option.id, kind: 'attachment', file: { filename, mime, data, caption, sha256 } }); }
        else if (option) void act(async () => addSource(await readAIBlockSource(option)));
      }}><option value="">{t('chooseSource')}</option>{options.map(option => <option key={option.id} value={option.id} disabled={!option.supported}>{option.name}{option.supported ? '' : t('unsupported')}</option>)}</NativeSelect>}</Field>
      <FilePicker label={t('readLocalSource')} compact emptyLabel="" disabled={locked || pending} onFile={file => void act(async () => {
        if (sourceNeedsExtraction(file.type)) { setExtracting({ id: crypto.randomUUID(), kind: 'file', file: await createAttachment(file) }); return; }
        if (file.size > 65_536) throw new Error('Source exceeds 64 KiB; nothing was sent.');
        addSource(await readAISourceBytes(crypto.randomUUID(), file.name, file.type, new Uint8Array(await file.arrayBuffer())));
      })} />
      {extracting && <><SourceExtractionPicker key={`${extracting.id}:${extracting.file.sha256}`} file={extracting.file} disabled={locked || pending} onExtract={result => {
        void act(async () => { const source = await readAISourceBytes(extracting.id, extracting.file.filename, 'text/plain', new TextEncoder().encode(result.text), extracting.kind); addSource({ ...source, extraction: result.extraction }); setExtracting(null); });
      }} /><Button disabled={locked} onClick={() => setExtracting(null)}>{t('closeExtraction')}</Button></>}
      <ul>{sources.map(source => <li key={source.id}>{source.name} · {source.bytes} bytes · SHA-256 {source.sha256.slice(0, 12)}<Button disabled={locked || pending} onClick={() => setSources(sources.filter(item => item.id !== source.id))}>{t('removeSource')}</Button><Disclosure summary={t('previewSource')}><pre className="notebook-science-json">{source.text}</pre></Disclosure>{source.extraction && <SourceExtractionDetails extraction={source.extraction} />}</li>)}</ul>
      {!onApply && <Feedback kind="warning">{t('typedUnavailable')}</Feedback>}
    </>}
    <Button variant="primary" disabled={locked || !canStart || !agent.available || !selected || !goal.trim() || !target || mode === 'cells' && (!selectedTable || !sources.length || !onApply)} onClick={() => void act(async () => {
      const currentTarget = getTarget(); if (!currentTarget) throw new Error(t('openSavedEntry'));
      const frozen = mode === 'cells' ? await freezeTypedGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal, selectedTable, sources, emptyOnly) : mode === 'checks' ? freezeCheckGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal) : freezeGeneration(crypto.randomUUID(), selected, currentTarget, props.getContent(), goal);
      await start(frozen);
    })}>{t('generate')}</Button>
    {record && <>
      <p role="status">{record.status} · {record.frozen.agentId} · {record.sessionId || record.frozen.requestId}</p>
      {isTypedGeneration(record.frozen) && <><p>{t('frozenSources')}: {record.frozen.sources.map(source => source.name).join(', ')}</p><Disclosure summary={t('frozenDetails')}><pre className="notebook-science-json">{JSON.stringify(record.frozen.sources, null, 2)}</pre></Disclosure></>}
      {['unknown', 'starting'].includes(record.status) && !record.sessionId && <><Feedback kind="warning">{t('outcomeUnknown')}</Feedback><Button disabled={locked} onClick={() => void act(() => start(record.frozen))}>{t('reconcile')}</Button></>}
      {record.sessionId && <div className="notebook-science-actions">
        <Button onClick={() => void openAppSession(record.sessionId).catch(cause => setError(String(cause)))}>{t('openSession')}</Button>
        <Button disabled={locked || ['applied', 'dismissed'].includes(record.application)} onClick={() => void act(poll)}>{t('refreshSession')}</Button>
        <Button disabled={locked || !pending} onClick={() => void act(async () => {
          await recovery.save({ ...record, status: 'cancelling' });
          await latest.current.cancel({ sessionId: record.sessionId });
          // Only the next Host observation can confirm cancellation.
        })}>{t('cancelSession')}</Button>
      </div>}
      {record.transcript && <Disclosure summary={t('transcript')}><pre className="notebook-science-json">{record.transcript}</pre></Disclosure>}
      {parseError && <Feedback kind="error">{parseError}</Feedback>}
      {record.application === 'applying' && applicationPresent && <Button disabled={locked} onClick={() => void act(async () => { await recovery.save({ ...record, application: 'applied' }); })}>{t('confirmApplication')}</Button>}
      {record.application === 'applied' && !applicationPresent && (isTypedGeneration(record.frozen) || isCheckGeneration(record.frozen)) && <Feedback kind="warning">{t('provenanceAbsent')}</Feedback>}
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
            if (!props.onSnapshot(t('hostChecksTitle'), snapshot)) throw new Error('The editor did not insert the review. Check the draft before retrying.');
            await recovery.save({ ...record, application: 'applied' });
          } finally { operation.current = false; if (live.current) setBusy(false); }
        }} />}
      {generated && record.application !== 'applied' && record.application !== 'dismissed' && <CandidateReviewPanel {...props} generated={generated} getTarget={getTarget} onSnapshot={(title, snapshot, rows) => {
        if (locked) return false; const applied = props.onSnapshot(title, snapshot, rows);
        if (applied) void act(async () => { await recovery.save({ ...record, application: 'applied' }); });
        return applied;
      }} />}
      {!pending && !['applied', 'dismissed'].includes(record.application) && <Button disabled={locked} onClick={() => void act(async () => { await recovery.save({ ...record, application: 'dismissed' }); })}>{t('dismissReview')}</Button>}
    </>}
    {target && <AIHistory entryId={target.entryId} />}
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}
