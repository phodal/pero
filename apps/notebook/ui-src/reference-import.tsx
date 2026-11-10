import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Disclosure, Feedback, FilePicker, Select } from '@pero/app-sdk/ui';
import type { ScientificReference, ReferenceSnapshot } from '@pero/notebook';
import { readControlEvidence } from '@pero/notebook/control-evidence';
import { maxPaperReportBytes, readPaperEvidence } from '@pero/notebook/paper-evidence';
import { messages } from './messages';

type ImportedReference = { label: string; reference: ScientificReference; snapshot: ReferenceSnapshot };
type ReferenceKind = 'evidence' | 'experiment';
type ImportState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; options: ImportedReference[]; selection: string }
  | { status: 'error'; message: string };

const verdictTone = { PASS: 'success', FAIL: 'error', INCONCLUSIVE: 'warning' } as const;

export function ReferenceImport({ kind, replacing, onAttach }: {
  kind: ReferenceKind; replacing: boolean; onAttach(imported: ImportedReference): void;
}) {
  const { t } = useAppI18n(messages);
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const [pickerKey, setPickerKey] = useState(0);
  const request = useRef(0);
  const filePicker = useRef<HTMLDivElement>(null);
  const paper = kind === 'evidence';
  useEffect(() => () => { request.current++; }, []);
  useLayoutEffect(() => {
    if (pickerKey) filePicker.current?.querySelector('button')?.focus();
  }, [pickerKey]);
  const selected = state.status === 'ready' && state.selection ? state.options[Number(state.selection)] : undefined;

  const load = async (file: File) => {
    const id = ++request.current;
    setState({ status: 'loading' });
    try {
      let options: ImportedReference[];
      if (paper) {
        if (file.size > maxPaperReportBytes) throw new Error(t('paperReportTooLarge'));
        const report = await readPaperEvidence(await file.arrayBuffer());
        options = report.citations.map(({ label, reference, evidence }) => ({
          label, reference, snapshot: { ...evidence, kind: 'paper-report' },
        }));
      } else {
        const receipts = await readControlEvidence(file);
        options = receipts.map(({ title, reference, snapshot }) => ({ label: title, reference, snapshot }));
      }
      if (!options.length) throw new Error(t(paper ? 'paperNoCitations' : 'controlNoReceipts'));
      if (request.current === id) setState({ status: 'ready', options, selection: options.length === 1 ? '0' : '' });
    } catch (cause) {
      if (request.current === id) setState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const reset = () => {
    request.current++;
    setState({ status: 'idle' });
    setPickerKey(key => key + 1);
  };
  const attach = () => {
    if (!selected) return;
    onAttach(selected);
    reset();
  };
  const options = state.status === 'ready' ? state.options.map(({ label, snapshot }, index) => ({
    value: String(index),
    label: snapshot.kind === 'paper-report' ? label : t('controlTrialOption', {
      trial: snapshot.trialId.slice(0, 12), verdict: snapshot.verdict,
      phase: t(snapshot.phase === 'verification' ? 'controlVerificationPhase' : 'controlSearchPhase'),
    }),
    hint: snapshot.kind === 'paper-report' ? snapshot.quote.slice(0, 160) : label,
  })) : [];

  return <div className="notebook-reference-import">
    <div className="notebook-reference-actions">
      <div ref={filePicker}>
        <FilePicker key={pickerKey} compact label={t(paper ? 'importPaperReport' : 'importControlReceipt')} emptyLabel="" accept=".json,application/json"
          busy={state.status === 'loading'} disabled={state.status === 'ready'} onFile={file => void load(file)} />
      </div>
      {state.status === 'loading' && <Button variant="ghost" onClick={reset}>{t('cancelImport')}</Button>}
    </div>
    {state.status === 'error' && <Feedback kind="error">{t('referenceImportFailed')} {state.message}</Feedback>}
    {state.status === 'ready' && <div className="notebook-reference-picker">
      {state.options.length > 1 && <Select label={t(paper ? 'chooseCitation' : 'chooseControlTrial')}
        placeholder={t(paper ? 'chooseCitation' : 'chooseControlTrial')} value={state.selection}
        onChange={selection => setState(current => current.status === 'ready' ? { ...current, selection } : current)}
        showHint options={options} />}
      {selected && <div className="notebook-reference-preview">
        <strong>{selected.label}</strong>
        {selected.snapshot.kind === 'paper-report'
          ? <p>{selected.snapshot.quote.length > 240 ? `${selected.snapshot.quote.slice(0, 240)}…` : selected.snapshot.quote}</p>
          : <span>{t('controlRecordedVerdict')} <Badge tone={verdictTone[selected.snapshot.verdict]}>{selected.snapshot.verdict}</Badge></span>}
      </div>}
      <div className="notebook-reference-actions">
        <Button variant="primary" disabled={!selected} onClick={attach}>{t(replacing ? 'replaceSnapshot' : 'attachSnapshot')}</Button>
        <Button variant="ghost" onClick={reset}>{t('cancelImport')}</Button>
      </div>
    </div>}
  </div>;
}

export function SnapshotDetails({ snapshot }: { snapshot: ReferenceSnapshot }) {
  const { t } = useAppI18n(messages);
  if (snapshot.kind === 'paper-report') return <div className="notebook-snapshot">
    <p className="notebook-note">{t('paperSnapshotPage', { page: snapshot.page })}</p>
    <blockquote className="notebook-snapshot-quote">{snapshot.quote}</blockquote>
    {snapshot.occurrences > 1 && <Feedback kind="warning">{t('paperRepeatedQuote', { count: snapshot.occurrences })}</Feedback>}
    <Disclosure variant="inline" summary={t('snapshotDetails')}>
      <dl className="notebook-reference-details">
        <div><dt>{t('snapshotReportId')}</dt><dd><code>{snapshot.reportId}</code></dd></div>
        <div><dt>{t('paperPassageId')}</dt><dd><code>{snapshot.passageId}</code></dd></div>
        <div><dt>{t('paperQuoteOffsets')}</dt><dd><code>{snapshot.start}–{snapshot.end}</code></dd></div>
        <div><dt>{t('paperSourceDigest')}</dt><dd><code>{snapshot.fileDigest}</code></dd></div>
        <div><dt>{t('snapshotExportDigest')}</dt><dd><code>{snapshot.exportSha256}</code></dd></div>
      </dl>
    </Disclosure>
  </div>;

  return <div className="notebook-snapshot">
    <div className="notebook-reference-actions">
      <strong>{t('controlRecordedVerdict')}</strong>
      <Badge tone={verdictTone[snapshot.verdict]}>{snapshot.verdict}</Badge>
      <span className="notebook-note">{t(snapshot.phase === 'verification' ? 'controlVerificationPhase' : 'controlSearchPhase')}</span>
    </div>
    <p className="notebook-note">{t('controlSnapshotScope')}</p>
    <Disclosure variant="inline" summary={t('controlSnapshotChecks', { count: snapshot.checks.length })}>
      <ul className="notebook-control-checks">
        {snapshot.checks.map((check, index) => <li key={`${check.name}:${index}`}>
          <div className="notebook-reference-actions"><strong>{check.name}</strong><Badge tone={verdictTone[check.verdict]}>{check.verdict}</Badge></div>
          {check.message && <p>{check.message}</p>}
          {(check.actual !== null || check.limit !== null) && <dl className="notebook-reference-details">
            {check.actual !== null && <div><dt>{t('controlActual')}</dt><dd><code>{check.actual}</code></dd></div>}
            {check.limit !== null && <div><dt>{t('controlLimit')}</dt><dd><code>{check.limit}</code></dd></div>}
          </dl>}
        </li>)}
      </ul>
    </Disclosure>
    <Disclosure variant="inline" summary={t('snapshotDetails')}>
      <dl className="notebook-reference-details">
        <div><dt>{t('controlTrialId')}</dt><dd><code>{snapshot.trialId}</code></dd></div>
        <div><dt>{t('controlObservationId')}</dt><dd><code>{snapshot.observationId}</code></dd></div>
        <div><dt>{t('snapshotReportId')}</dt><dd><code>{snapshot.reportId}</code></dd></div>
        <div><dt>{t('controlVerifier')}</dt><dd><code>{snapshot.verifierVersion}</code></dd></div>
        <div><dt>{t('controlSpecDigest')}</dt><dd><code>{snapshot.specHash}</code></dd></div>
        <div><dt>{t('controlInputDigest')}</dt><dd><code>{snapshot.inputDigest}</code></dd></div>
        <div><dt>{t('snapshotExportDigest')}</dt><dd><code>{snapshot.exportSha256}</code></dd></div>
      </dl>
    </Disclosure>
  </div>;
}
