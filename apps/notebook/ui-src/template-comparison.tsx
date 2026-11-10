import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Select, Table } from '@pero/app-sdk/ui';
import { compareTemplateRevisions, type PublishedTemplate } from '@pero/notebook/templates';
import type { RevisionComparison } from '@pero/notebook/review';

const messages = {
  heading: { en: 'Compare template revisions', zh: '比较模板版本' }, before: { en: 'Earlier revision', zh: '原版本' }, after: { en: 'Later revision', zh: '目标版本' },
  compare: { en: 'Compare published revisions', zh: '比较已发布版本' }, same: { en: 'No definition changes.', zh: '定义没有变化。' },
  scope: { en: 'Read-only comparison of published content and parameter bindings. Existing instances stay unchanged.', zh: '只读比较已发布内容与参数绑定，不会修改已有实例。' },
  only: { en: 'Publish another revision to compare this template.', zh: '发布新版本后可比较此模板。' },
  changes: { en: '{count} changes', zh: '{count} 项变化' }, limited: { en: 'Showing the first {count}; all fields were compared.', zh: '显示前 {count} 项；已比较所有字段。' },
  field: { en: 'Field / stable identity', zh: '字段 / 稳定标识' }, kind: { en: 'Change', zh: '变化' }, old: { en: 'Before', zh: '原值' }, next: { en: 'After', zh: '新值' },
};

export function TemplateRevisionComparison({ template, latestRevision }: { template: PublishedTemplate; latestRevision: number }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [before, setBefore] = useState(String(template.revision > 1 ? template.revision - 1 : 1));
  const [after, setAfter] = useState(String(template.revision > 1 ? template.revision : latestRevision));
  const [result, setResult] = useState<RevisionComparison | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const invalidate = () => { request.current++; setBusy(false); setResult(null); setError(''); };
  const compare = async () => {
    const id = ++request.current; setBusy(true); setError(''); setResult(null);
    try {
      const path = `/api/templates/${encodeURIComponent(template.id)}?revision=`;
      const [left, right] = await Promise.all([api.get<PublishedTemplate>(path + before), api.get<PublishedTemplate>(path + after)]);
      if (left.id !== template.id || right.id !== template.id || left.revision !== Number(before) || right.revision !== Number(after)) throw new Error('The template owner returned a different revision. Reload and try again.');
      const comparison = compareTemplateRevisions(left, right);
      if (request.current === id) setResult(comparison);
    } catch (cause) { if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request.current === id) setBusy(false); }
  };
  const options = Array.from({ length: latestRevision }, (_, index) => ({ value: String(index + 1), label: `v${index + 1}` }));
  return <section aria-label={t('heading')}>
    <h4>{t('heading')}</h4><p>{t('scope')}</p>
    {latestRevision < 2 ? <p>{t('only')}</p> : <>
      <div className="notebook-template-actions"><Select label={t('before')} value={before} options={options} onChange={value => { invalidate(); setBefore(value); }} /><Select label={t('after')} value={after} options={options} onChange={value => { invalidate(); setAfter(value); }} />
        <Button busy={busy} disabled={busy || before === after} onClick={() => void compare()}>{t('compare')}</Button></div>
      {error && <Feedback kind="error">{error}</Feedback>}
      {result && <><p role="status">{result.total ? t('changes', { count: result.total }) : t('same')}</p>{result.limited && <p>{t('limited', { count: result.changes.length })}</p>}
        {!!result.total && <Table label={t('heading')} density="compact"><thead><tr><th>{t('field')}</th><th>{t('kind')}</th><th>{t('old')}</th><th>{t('next')}</th></tr></thead><tbody>{result.changes.map((change, index) => <tr key={index}><th scope="row">{change.path}</th><td>{change.kind}</td><td><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{change.before}</pre></td><td><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{change.after}</pre></td></tr>)}</tbody></Table>}
      </>}
    </>}
  </section>;
}
