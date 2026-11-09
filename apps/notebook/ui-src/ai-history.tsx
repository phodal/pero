import { useState } from 'react';
import { openAppSession, useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback } from '@pero/app-sdk/ui';
import { recoveredAIWorkspace, type AIRecovery } from '@pero/notebook/ai-generation';

const messages = {
  open: { en: 'Previous proposals', zh: '历史建议' },
  scope: { en: 'Latest 50 archived proposals. Read-only input, transcript and review decisions.', zh: '最近 50 条历史建议，仅供查看来源、会话记录和复核决定。' },
  empty: { en: 'No archived proposals.', zh: '暂无历史建议。' },
  session: { en: 'Open archived Host session', zh: '打开历史 Host 会话' },
  frozen: { en: 'Frozen input, output and review', zh: '冻结输入、输出与复核' },
  invalid: { en: 'Invalid AI history response.', zh: '历史建议响应无效。' },
} as const;

/** Read-only access to durable previous proposals; history never restarts a Host request. */
export function AIHistory({ entryId }: { entryId: string }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [requests, setRequests] = useState<{ requestId: string; sessionId: string }[] | null>(null), [record, setRecord] = useState<AIRecovery | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const read = async (requestId?: string) => {
    setBusy(true); setError('');
    try {
      const path = `/api/entries/${entryId}/ai-workspace/archive`;
      if (requestId) {
        const result = await api.get<{ record: AIRecovery }>(`${path}/${encodeURIComponent(requestId)}`);
        setRecord((await recoveredAIWorkspace({ version: 0, record: result.record })).record);
      } else {
        const result = await api.get<{ requests: { requestId: string; sessionId: string }[] }>(path);
        if (!Array.isArray(result.requests) || result.requests.some(item => !/^[A-Za-z0-9_-]{1,128}$/.test(item.requestId) || typeof item.sessionId !== 'string')) throw new Error(t('invalid'));
        setRequests(result.requests);
      }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div>
    <Button disabled={busy} onClick={() => void read()}>{t('open')}</Button>
    {requests && <><p>{t('scope')}</p>
      {!requests.length && <p>{t('empty')}</p>}<ul>{requests.map(item => <li key={item.requestId}><Button disabled={busy} onClick={() => void read(item.requestId)}>{item.requestId}</Button></li>)}</ul></>}
    {record && <><p>{record.status} · {record.application} · {record.sessionId}</p>{record.sessionId && <Button onClick={() => void openAppSession(record.sessionId).catch(cause => setError(String(cause)))}>{t('session')}</Button>}
      <Disclosure summary={t('frozen')}><pre className="notebook-science-json">{JSON.stringify(record, null, 2)}</pre></Disclosure></>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}
