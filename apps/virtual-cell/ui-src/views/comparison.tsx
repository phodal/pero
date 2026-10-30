import React, { useRef, useState } from 'react';
import { downloadFile, openDocument } from '@pero/app-sdk';
import { Button, Disclosure, EmptyState, Feedback, Input, ListRow, ResultView, Select, Toolbar } from '@pero/app-sdk/ui';
import { comparisonActive, conditionRows, datasetAction, datasetActive, type ComparisonStatus } from '../comparison';
import type { Translate } from '../messages';
import type { InputRevision } from '../use-workbench';
import type { useComparison, useDatasetDownload } from '../use-comparison';

type Comparison = ReturnType<typeof useComparison>;
type Download = ReturnType<typeof useDatasetDownload>;
const metric = (value: number | null | undefined) => value == null ? null : Number(value.toPrecision(7)).toString();
const date = (value: string) => new Date(value).toLocaleString();

function DatasetPanel({ download: d, t }: { download: Download; t: Translate }) {
  const dataset = d.dataset, action = dataset && datasetAction(dataset.status);
  const active = !!dataset && datasetActive(dataset.status);
  const verifying = dataset?.status === 'verifying';
  return <section className="vc-dataset" aria-label={t('datasetTitle')} aria-busy={active}>
    <Toolbar actions={dataset && <>
      {action && <Button variant="primary" disabled={d.disabled} onClick={() => void d.request(action === 'verify' ? 'verify' : 'download')}>
        {d.pending === 'download' || d.pending === 'verify' ? t('datasetRequesting') : t(action === 'verify' ? 'datasetVerify' : action === 'retry' ? 'datasetRetry' : 'datasetDownload')}
      </Button>}
      {active && <Button disabled={d.disabled || dataset.status === 'cancelling'} onClick={() => void d.request('cancel')}>
        {d.pending === 'cancel' || dataset.status === 'cancelling' ? t('dataset_cancelling') : t('datasetCancel')}
      </Button>}
    </>}><h2>{t('datasetTitle')}</h2>{dataset && <span role="status">{t(`dataset_${dataset.status}`)}</span>}</Toolbar>
    {d.error && <Feedback kind="error">{d.error} <Button onClick={d.refresh}>{t('refresh')}</Button></Feedback>}
    {!dataset && !d.error && <p role="status">{t('busy')}</p>}
    {dataset && <>
      <div className="vc-dataset-source"><span>{dataset.source.filename}</span><span>{Math.round(dataset.source.bytes / 1_000_000)} MB</span>
        <a href={dataset.source.record} target="_blank" rel="noreferrer">{t('sourceLink')}</a>
        <a href={dataset.source.license.url} target="_blank" rel="noreferrer">{dataset.source.license.id}</a>
      </div>
      {dataset.error && <Feedback kind="error">{dataset.error}</Feedback>}
      {(dataset.status === 'downloading' || verifying) && <div className="vc-dataset-progress">
        <span>{t(verifying ? 'datasetVerifiedBytes' : 'datasetReceivedBytes')}: {(verifying ? dataset.verifiedBytes : dataset.receivedBytes).toLocaleString()} / {dataset.expectedBytes.toLocaleString()} {t('datasetBytes')}</span>
        <progress aria-label={t(verifying ? 'datasetVerificationProgress' : 'datasetDownloadProgress')} value={verifying ? dataset.verifiedBytes : dataset.receivedBytes} max={dataset.expectedBytes}/>
      </div>}
      {dataset.status === 'cancelling' && <p>{t('datasetReceivedBytes')}: {dataset.receivedBytes.toLocaleString()} {t('datasetBytes')}. {t('datasetVerifiedBytes')}: {dataset.verifiedBytes.toLocaleString()} {t('datasetBytes')}.</p>}
      {(dataset.status === 'ready' || dataset.status === 'cached') && <p>{t('datasetLocalFile')}: <code>{dataset.path}</code></p>}
      <p>{t('datasetPreparationRequired')}</p>
      {dataset.source.warning && <p className="vc-muted">{dataset.source.warning}</p>}
      <Disclosure summary={t('datasetVerificationDetails')}><dl className="vc-properties">
        <dt>{t('sourceLink')}</dt><dd>{dataset.source.id}</dd><dt>{t('comparisonRevision')}</dt><dd>{dataset.source.revision}</dd>
        <dt>{t('datasetExpectedBytes')}</dt><dd>{dataset.expectedBytes.toLocaleString()}</dd>
        <dt>{t('datasetExpectedMd5')}</dt><dd>{dataset.source.md5}</dd><dt>{t('datasetExpectedSha256')}</dt><dd>{dataset.source.sha256}</dd>
        {dataset.checksums && <><dt>{t('datasetActualMd5')}</dt><dd>{dataset.checksums.md5}</dd><dt>{t('datasetActualSha256')}</dt><dd>{dataset.checksums.sha256}</dd></>}
      </dl><p className="vc-muted">{dataset.source.sha256Evidence}</p></Disclosure>
    </>}
  </section>;
}

export function ComparisonView({ comparison: c, download, input, inputs, t }: { comparison: Comparison; download: Download; input?: InputRevision; inputs: InputRevision[]; t: Translate }) {
  const [search, setSearch] = useState(''), [method, setMethod] = useState(''), [page, setPage] = useState(0);
  const [opening, setOpening] = useState(false), [documentError, setDocumentError] = useState(''), documentGate = useRef(false);
  const run = c.run, output = c.output?.value, source = c.input?.value;
  const models = output?.result.models ?? [];
  const rows = conditionRows(models, search, method);
  const pageCount = Math.max(1, Math.ceil(rows.length / 100)), currentPage = Math.min(page, pageCount - 1);
  const status = (value: ComparisonStatus) => t(`comparison_${value}`);
  const active = !!run && comparisonActive(run.status);
  const selectedSource = source?.dataset.source;
  const sample = input?.source.id.startsWith('synthetic');
  const resultLabels = { source: t('comparisonRun'), empty: t('noSelection') };
  async function viewDocument(kind: 'input' | 'output') {
    const document = kind === 'input' ? c.input : c.output;
    if (documentGate.current || !document || !run) return;
    documentGate.current = true; setOpening(true); setDocumentError('');
    try {
      await openDocument({ id: `${run.id}:${kind}`, title: kind === 'input' ? t('comparisonViewInputs') : t('comparisonViewOutputs'), format: { kind: 'json' }, text: document.content });
    } catch (error) { setDocumentError(error instanceof Error ? error.message : String(error)); }
    finally { documentGate.current = false; setOpening(false); }
  }
  return <section className="vc-comparison" aria-label={t('comparisonMode')}>
    <DatasetPanel download={download} t={t}/>
    {c.error && <Feedback kind="error">{c.error} <Button onClick={c.refresh}>{t('refresh')}</Button></Feedback>}
    {c.availability && !c.availability.available && <Feedback kind="error">{c.availability.reason === 'comparison_platform_unsupported' ? t('comparisonPlatform') : c.availability.reason}</Feedback>}
    {documentError && <Feedback kind="error">{documentError}</Feedback>}
    {!input ? <EmptyState heading={t('comparisonMissingInput')}/> : <Toolbar actions={
      <Button variant="primary" disabled={!c.canStart} onClick={() => void c.start(input.id)}>{c.pending === 'start' ? t('comparison_starting') : t('comparisonStart')}</Button>
    }><span>{t('comparisonMethods')}: control, train_mean, additive</span></Toolbar>}
    {input && <Disclosure summary={t('comparisonInputIdentity')}><dl className="vc-properties">
      <dt>{t('sourceLink')}</dt><dd>{input.source.id}</dd><dt>{t('comparisonRevision')}</dt><dd>{input.source.revision}</dd>
      <dt>{t('comparisonDatasetDigest')}</dt><dd>{input.datasetDigest}</dd><dt>{t('comparisonSpecDigest')}</dt><dd>{input.specDigest}</dd>
      <dt>{t('comparisonSplitDigest')}</dt><dd>{input.splitDigest}</dd>
    </dl></Disclosure>}
    {c.running && c.running.id !== c.selected && <Feedback>{status(c.running.status)} <Button onClick={() => c.choose(c.running!.id)}>{t('comparisonViewRunning')}</Button></Feedback>}
    <p className="vc-muted">{t('comparisonBoundary')}</p>
    {sample && <Feedback>{t('comparisonSample')}</Feedback>}
    {!c.loaded ? <p role="status">{t('busy')}</p> : !input && !c.items.length ? null : <div className="vc-comparison-layout">
      <aside className="vc-comparison-history" aria-label={t('comparisonHistory')}><h2>{t('comparisonHistory')}</h2>
        {c.items.length ? <ul className="vc-comparison-runs">{c.items.map(item => <li key={item.id} aria-current={item.id === c.selected ? 'true' : undefined}><ListRow title={`${date(item.createdAt)} (${item.id.slice(0, 8)})`}
          meta={`${status(item.status)} — ${inputs.find(value => value.id === item.inputId)?.source.id ?? item.inputId.slice(0, 12)}`}
          current={item.id === c.selected} onOpen={() => c.choose(item.id)}/></li>)}</ul> : <p className="vc-muted">{t('comparisonNoRuns')}</p>}
      </aside>
      <main className="vc-comparison-detail">
        {c.selected && !run && <p role="status">{t('busy')}</p>}
        {run && <>
          <Toolbar actions={<>
            {active ? <Button disabled={!!c.pending || run.status === 'cancelling'} onClick={() => void c.cancel()}>{run.status === 'cancelling' || c.pending === 'cancel' ? t('comparison_cancelling') : t('comparisonCancel')}</Button>
              : <Button disabled={!c.canStart} onClick={() => void c.start(run.inputId)}>{t('comparisonRerun')}</Button>}
            <Button disabled={!!c.pending} onClick={() => void c.exportRun()}>{t('comparisonExport')}</Button>
          </>}><h2>{t('comparisonRun')} {run.id.slice(0, 8)}</h2><span role="status">{status(run.status)}</span></Toolbar>
          {(run.error || run.status === 'interrupted') && <Feedback kind="error">
            {run.error}{run.status === 'interrupted' && <p>{t('comparisonInterrupted')}</p>}
          </Feedback>}
          {run.inputId !== input?.id && selectedSource?.id.startsWith('synthetic') && <Feedback>{t('comparisonSample')}</Feedback>}
          <div className="vc-comparison-meta"><span>{t('comparisonCreated')}: {date(run.createdAt)}</span>
            {run.finishedAt && <span>{t('comparisonFinished')}: {date(run.finishedAt)}</span>}
          </div>
          {c.loadingArtifacts && <p role="status">{t('comparisonLoadingFiles')}</p>}
          {output && <>
            <ResultView className="vc-comparison-models" labels={resultLabels} result={{ title: t('comparisonMethods'), provenance: { label: run.id },
              columns: [t('model'), t('metric'), t('comparisonEvaluated'), t('comparisonFailedCount'), t('targets'), t('comparisonBatchMatched'), t('mse'), t('skill'), t('comparisonSkillExcluded')],
              rows: models.map(model => [model.model.id, t((model.metric_status === 'reference' ? 'referenceStatus' : model.metric_status) as Parameters<Translate>[0]),
                `${model.denominator.evaluated} / ${model.denominator.attempted}`, model.denominator.failed,
                `${model.coverage.target_readouts_complete} / ${model.coverage.attempted}`, `${model.coverage.batch_matched} / ${model.coverage.attempted}`,
                metric(model.delta_mse.median), metric(model.skill_vs_reference.median), model.skill_vs_reference.excluded.length]),
            }}/>
            {models.some(model => model.denominator.failed) && <Feedback kind="error">{t('comparisonFailures')}</Feedback>}
            <Toolbar>
              <Input type="search" aria-label={t('findCondition')} placeholder={t('findCondition')} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }}/>
              <Select label={t('model')} value={method} onChange={value => { setMethod(value); setPage(0); }} options={[{ value: '', label: t('comparisonAllMethods') }, ...models.map(model => ({ value: model.model.id, label: model.model.id }))]}/>
            </Toolbar>
            <ResultView className="vc-comparison-conditions" labels={resultLabels} result={{ title: t('comparisonConditionResults'), provenance: { label: run.id },
              columns: [t('condition'), t('model'), t('comparisonStatus'), 'Δ MSE', t('comparisonSkill'), t('targets'), t('comparisonBatchMatched'), t('reasons')],
              rows: rows.slice(currentPage * 100, (currentPage + 1) * 100).map(row => [row.id, row.method, row.status,
                metric(row.delta_mse), metric(row.skill_vs_reference), `${row.support.readouts.targets_present} / ${row.support.readouts.targets_expected}`,
                row.support.design.status, row.reasons.join('; ') || null]),
            }}/>
            {pageCount > 1 && <Toolbar actions={<><Button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t('comparisonPrevious')}</Button><Button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{t('comparisonNext')}</Button></>}>
              <span>{currentPage * 100 + 1}–{Math.min((currentPage + 1) * 100, rows.length)} / {rows.length}</span>
            </Toolbar>}
          </>}
          <section className="vc-comparison-files"><h3>{t('comparisonSourceFiles')}</h3>
            <dl className="vc-properties">
              <dt>{t('inputs')}</dt><dd>{run.inputId}</dd>
              {source && <><dt>{t('sourceLink')}</dt><dd>{source.dataset.source.id}</dd><dt>{t('comparisonRevision')}</dt><dd>{source.dataset.source.revision}</dd>
                <dt>{t('genes')} / {t('conditions')}</dt><dd>{source.dataset.genes.length} / {source.dataset.conditions.length}</dd>
                <dt>{t('scale')}</dt><dd>{source.dataset.scale}</dd><dt>{t('control')}</dt><dd>{source.dataset.control}</dd>
                <dt>{t('comparisonDatasetDigest')}</dt><dd>{source.spec.dataset.digest}</dd><dt>{t('comparisonSpecDigest')}</dt><dd>{source.split.spec_digest}</dd><dt>{t('comparisonSplitDigest')}</dt><dd>{source.split.digest}</dd></>}
              <dt>{t('comparisonMethods')}</dt><dd>{(models.length ? models.map(value => value.model) : run.methods).map(value => `${value.id} (${value.version})`).join(', ')}</dd>
              <dt>{t('comparisonEvaluator')}</dt><dd>{run.evaluator}</dd>
              {run.outputId && <><dt>{t('result')}</dt><dd>{run.outputId}</dd></>}
            </dl>
            {source && <>
              <ResultView labels={resultLabels} result={{ title: t('comparisonSplitCounts'), provenance: { label: run.id },
                columns: [t('comparisonGroup'), t('comparisonCandidates'), t('comparisonTrain'), t('comparisonValidation'), t('comparisonTest'), t('comparisonExcluded')],
                rows: [[t('comparisonCombinations'), source.split.counts.combination_candidates, source.split.counts.combination_train, source.split.counts.combination_validation, source.split.counts.combination_test, source.split.counts.combination_excluded],
                  [t('comparisonSingles'), source.split.counts.single_train + source.split.counts.single_excluded, source.split.counts.single_train, null, null, source.split.counts.single_excluded]],
              }}/>
              {!!source.split.excluded.length && <Disclosure summary={t('comparisonExclusionReasons')}><ResultView labels={resultLabels} result={{ title: t('comparisonExcluded'), provenance: { label: run.id }, columns: [t('condition'), t('reasons')], rows: source.split.excluded.map(row => [row.id, row.reason]) }}/></Disclosure>}
            </>}
            <Toolbar>
              <Button disabled={!c.input || opening} onClick={() => void viewDocument('input')}>{t('comparisonViewInputs')}</Button>
              <Button disabled={!c.output || opening} onClick={() => void viewDocument('output')}>{t('comparisonViewOutputs')}</Button>
              {c.input && <Button onClick={() => downloadFile(`virtual-cell-inputs-${run.inputId}.json`, c.input!.content, 'application/json')}>{t('comparisonExportInputs')}</Button>}
            </Toolbar>
            <Disclosure summary={t('receipt')}><pre>{JSON.stringify({ id: run.id, inputId: run.inputId, outputId: run.outputId, process: run.process, sourceHashes: run.sourceHashes, environment: run.environment, scope: run.scope, isolation: run.isolation, acceptance: run.acceptance }, null, 2)}</pre></Disclosure>
          </section>
          <section className="vc-comparison-log"><h3>{t('comparisonLogs')}</h3>
            {run.logs ? <pre aria-label={t('comparisonLogs')}>{run.logs}</pre> : <p className="vc-muted">{t('comparisonNoLogs')}</p>}
            {run.logsTruncated && <p>{t('comparisonLogsTruncated')}</p>}
          </section>
        </>}
      </main>
    </div>}
  </section>;
}
