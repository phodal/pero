import { useEffect, useRef, useState } from 'react';
import { openAppSession, useAppAgent, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { freezeGeneration, readGeneratedCandidates, type FrozenGeneration, type GeneratedCandidates, type GenerationTarget } from '@pero/notebook/ai-generation';
import { CandidateReviewPanel } from './science-tools-review';
import type { SciencePanelProps } from './science-tools-shared';
const messages = {
  goal: { en: 'Proposal goal', zh: '建议目标' }, agent: { en: 'Configured Host agent', zh: '已配置 Host Agent' }, generate: { en: 'Generate candidates', zh: '生成候选数据' },
  unavailable: { en: 'No configured Host agent is available. Configure an agent in Host, then refresh. No model request or synthetic result is substituted.', zh: '没有可用的 Host Agent。请在 Host 配置 Agent 后刷新；不会用模拟结果替代。' },
  refresh: { en: 'Refresh availability', zh: '刷新可用性' }, cancel: { en: 'Cancel session', zh: '取消会话' }, recover: { en: 'Reconcile original request', zh: '核对原请求' }, poll: { en: 'Refresh session status', zh: '刷新会话状态' }, open: { en: 'Open Host session', zh: '打开 Host 会话' },
  scope: { en: 'Explicitly sends the current draft and saved revision to the selected Host agent. Output is reviewed as new literal-text rows; it never overwrites existing or protected cells. Closing this panel stops polling, not the Host session. Open the session to handle approvals or cancel.', zh: '点击后向所选 Host Agent 发送当前草稿与保存版本。输出需复核并作为新的字面文本行插入，不覆盖已有或受保护单元格。关闭面板仅停止轮询，不停止 Host 会话；可打开会话处理审批或取消。' },
  transcript: { en: 'Host transcript', zh: 'Host 对话记录' }, unknown: { en: 'Request outcome unknown. Reconcile the same frozen request; do not start another.', zh: '请求结果未知。请核对同一个冻结请求，不要重新发起。' },
};
export function NotebookAITools({ getTarget, ...props }: SciencePanelProps & { getTarget(): GenerationTarget | null }) {
  const agent = useAppAgent(), { t } = useAppI18n(messages);
  const [goal, setGoal] = useState(''), [agentId, setAgentId] = useState(''), [frozen, setFrozen] = useState<FrozenGeneration | null>(null);
  const [sessionId, setSession] = useState(''), [status, setStatus] = useState('idle'), [error, setError] = useState(''), [text, setText] = useState('');
  const [generated, setGenerated] = useState<GeneratedCandidates>(), [busy, setBusy] = useState(false);
  const live = useRef(true), polling = useRef(false), latest = useRef(agent); latest.current = agent;
  const currentFrozen = useRef(frozen); currentFrozen.current = frozen;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const selected = agentId || agent.agents.find(item => item.available)?.id || '';
  const pending = ['starting', 'unknown', 'running', 'needs_input', 'cancelling'].includes(status);
  async function start(input: FrozenGeneration) {
    setBusy(true); setStatus('starting'); setError('');
    try { const result = await latest.current.start({ requestId: input.requestId, agentId: input.agentId, prompt: input.prompt }); if (live.current) { setSession(result.sessionId); setStatus('running'); } }
    catch (cause) { if (live.current) { setStatus('unknown'); setError(String(cause)); } }
    finally { if (live.current) setBusy(false); }
  }
  async function poll() {
    if (!sessionId || !frozen || polling.current) return;
    polling.current = true;
    try {
      const result = await latest.current.events({ sessionId, after: 0 });
      if (!live.current || currentFrozen.current !== frozen) return;
      setStatus(result.status); setText(result.text); setError('');
      if (result.status === 'completed') {
        try { setGenerated(readGeneratedCandidates(frozen, sessionId, result.text)); }
        catch (cause) { setGenerated(undefined); setError(String(cause)); }
      }
    } catch (cause) { if (live.current) { setError(String(cause)); setStatus('unavailable'); } }
    finally { polling.current = false; }
  }
  useEffect(() => {
    if (!sessionId || !['running', 'needs_input', 'cancelling'].includes(status)) return;
    void poll(); const timer = setInterval(() => void poll(), 1500); return () => clearInterval(timer);
  }, [sessionId, status, frozen]);
  return <div className="notebook-science-panel">
    <p className="notebook-note">{t('scope')}</p>
    {!agent.available && <Feedback kind="warning">{t('unavailable')}</Feedback>}
    <Button disabled={busy} onClick={() => void agent.refresh()}>{t('refresh')}</Button>
    <Field label={t('agent')}>{control => <NativeSelect {...control} value={selected} disabled={pending} onChange={event => setAgentId(event.target.value)}><option value="">—</option>{agent.agents.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}</option>)}</NativeSelect>}</Field>
    <Field label={t('goal')}>{control => <Textarea {...control} value={goal} maxLength={4000} disabled={pending} onChange={event => setGoal(event.target.value)} />}</Field>
    <Button disabled={busy || pending || status === 'unavailable' || !agent.available || !selected || !goal.trim()} onClick={() => {
      try { const target = getTarget(); if (!target) throw new Error('Open a saved entry first.'); const input = freezeGeneration(crypto.randomUUID(), selected, target, props.getContent(), goal); setFrozen(input); setSession(''); setGenerated(undefined); setText(''); void start(input); }
      catch (cause) { setError(String(cause)); }
    }}>{t('generate')}</Button>
    {status === 'unknown' && frozen && <><Feedback kind="warning">{t('unknown')}</Feedback><Button disabled={busy} onClick={() => void start(frozen)}>{t('recover')}</Button></>}
    {sessionId && <div className="notebook-science-actions">
      <span role="status">{status} · {sessionId}</span>
      <Button onClick={() => void openAppSession(sessionId).catch(cause => setError(String(cause)))}>{t('open')}</Button>
      <Button disabled={busy} onClick={() => void poll()}>{t('poll')}</Button>
      <Button disabled={busy || ['completed', 'failed', 'cancelled'].includes(status)} onClick={async () => { setBusy(true); setGenerated(undefined); try { await agent.cancel({ sessionId }); if (live.current) { setStatus('cancelling'); setGenerated(undefined); } } catch (cause) { if (live.current) setError(String(cause)); } finally { if (live.current) setBusy(false); } }}>{t('cancel')}</Button>
    </div>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {text && <Disclosure summary={t('transcript')}><pre className="notebook-science-json">{text}</pre></Disclosure>}
    {generated && <CandidateReviewPanel {...props} generated={generated} getTarget={getTarget} />}
  </div>;
}
