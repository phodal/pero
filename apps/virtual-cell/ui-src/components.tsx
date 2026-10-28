import React from 'react';
import { Card, Disclosure, ResultView } from '@pero/app-sdk/ui';
import type { Output } from './use-workbench';
import type { Translate } from './messages';

export function Results({ output, t }: { output: Output; t: Translate }) {
  const r = output.result;
  const status = (value: string) => t((value === 'reference' ? 'referenceStatus' : value) as any) || value;
  let columns: string[], rows: any[][];
  if (r.models) {
    columns = ['model', 'metric', 'coverage', 'targets', 'mse', 'skill'].map(k => t(k as any));
    rows = r.models.map((m: any) => [m.model.id, status(m.metric_status), `${m.denominator.evaluated}/${m.denominator.attempted}`, `${m.coverage.target_readouts_complete}/${m.coverage.attempted}`, m.delta_mse?.median, m.skill_vs_reference?.median]);
  } else if (r.selected_for_review) {
    columns = ['condition', 'selection', 'effect', 'reasons'].map(k => t(k as any));
    rows = r.conditions.map((c: any) => [c.id, status(c.selection), c.predicted_delta, c.reasons.join(', ')]);
  } else if (r.queries) {
    columns = [t('condition'), t('targetsLabel')]; rows = Object.entries(r.queries).map(([id, targets]: any) => [id, targets.join(' + ')]);
  } else {
    columns = [t('split'), t('condition')]; rows = Object.entries(r.assignments ?? {}).flatMap(([part, ids]: any) => ids.map((id: string) => [part, id]));
  }
  const result = { version: 1, kind: 'table', title: output.operation === 'evidence' ? t('evidenceTitle') : t(output.operation as any), columns, rows: rows.slice(0, 100).map(row => row.map(cell => cell ?? null)), provenance: { kind: 'calculated', label: r.dataset_digest || output.inputId || 'Norman SC0 v1' } };
  return <Card className="vc-result">
    <ResultView className={r.models ? 'vc-models' : undefined} result={result} labels={{ source: t('inputs'), empty: t('empty'), provenance: { calculated: t('result'), illustrative: t('sample'), sourced: t('evidence'), 'user-provided': t('inputs') } }}/>
    {rows.length > 100 && <p>{t('truncated')}</p>}
    <Disclosure summary={t('details')}><pre>{JSON.stringify(r.models ? { ...r, models: r.models.map(({ conditions, ...m }: any) => m) } : r, null, 2).slice(0, 24000)}</pre></Disclosure>
    {output.id && <Disclosure summary={t('receipt')}><p>{output.id}</p><pre>{JSON.stringify({ inputId: output.inputId, sourceHashes: output.sourceHashes, environment: output.environment, scope: 'app_local', acceptance: 'not_reviewed' }, null, 2)}</pre></Disclosure>}
  </Card>;
}
