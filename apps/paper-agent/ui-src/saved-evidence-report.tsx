import { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { Experiments, ReportView, type Citation } from './report-content';
import { messages } from './i18n';
import type { Api, Intent, Report } from './types';

/** Open the frozen report before choosing a quotation; a manual link identifies no single quote. */
export function SavedEvidenceReport({ api, reportId, onCite, onClose }: {
  api: Api; reportId: string; onCite(value: Citation, intent: Intent): void; onClose(): void;
}) {
  const { t } = useAppI18n(messages);
  const region = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState<{ report: Report; intent: Intent } | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    region.current?.focus();
    setSaved(null); setError('');
    void (async () => {
      const report = await api.get<Report>(`/api/reports/${reportId}`);
      const intent = await api.get<Intent>(`/api/intents/${report.intentId}`);
      if (alive) setSaved({ report, intent });
    })().catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [api, reportId, retry]);
  return <section ref={region} tabIndex={-1} aria-label="Saved evidence report">
    <Button onClick={onClose}>Close report</Button>
    {error ? <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>Retry report</Button></Feedback>
      : !saved && <p role="status">Loading saved report…</p>}
    {saved && <>
      <ReportView report={saved.report} intent={saved.intent} onCite={value => onCite(value, saved.intent)} t={t}/>
      {!!saved.report.experiments?.length && <Experiments report={saved.report} intent={saved.intent} onCite={value => onCite(value, saved.intent)} t={t}/>}
    </>}
  </section>;
}
